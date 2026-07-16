import express from 'express';
import { z } from 'zod';
import FeeReminderConfig, { DEFAULT_FEE_REMINDER_CONFIG } from '../models/FeeReminderConfig.js';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { sanitizeQueryStr } from '../middleware/validation.js';
import { createLogger } from '../utils/logger.js';

const router = express.Router();
router.use(authenticate);
const logger = createLogger('FeeReminderConfig');

// ─── Validation ──────────────────────────────────────────────────────────────

const configBodySchema = z
  .object({
    enabled: z.boolean().optional(),
    dueReminder: z
      .object({
        enabled: z.boolean().optional(),
        daysBefore: z.number().int().min(0).max(60).optional(),
        cadence: z.enum(['term', 'quarter', 'year', 'month', 'week', 'custom']).optional(),
        customDates: z.array(z.string()).optional(),
      })
      .optional(),
    overdueReminder: z
      .object({
        enabled: z.boolean().optional(),
        repeatEveryDays: z.number().int().min(1).max(90).optional(),
        maxReminders: z.number().int().min(0).max(30).optional(),
      })
      .optional(),
    channels: z
      .object({
        inApp: z.boolean().optional(),
        push: z.boolean().optional(),
        whatsapp: z.boolean().optional(),
        email: z.boolean().optional(),
      })
      .optional(),
    cooldownHours: z.number().int().min(1).max(168).optional(),
  })
  .strict();

const manualReminderSchema = z.object({
  name: z.string().min(1).max(120),
  message: z.string().max(1000).optional(),
  audience: z
    .object({
      type: z.enum(['all', 'overdue', 'unpaid', 'class']).optional(),
      classIds: z.array(z.string()).optional(),
    })
    .optional(),
  triggerDate: z.string().optional(),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getConfig(schoolId, academicYear) {
  const doc = await FeeReminderConfig.findOne({ schoolId, academicYear }).lean();
  return doc
    ? {
        ...DEFAULT_FEE_REMINDER_CONFIG,
        ...doc,
        dueReminder: { ...DEFAULT_FEE_REMINDER_CONFIG.dueReminder, ...(doc.dueReminder || {}) },
        overdueReminder: {
          ...DEFAULT_FEE_REMINDER_CONFIG.overdueReminder,
          ...(doc.overdueReminder || {}),
        },
        channels: { ...DEFAULT_FEE_REMINDER_CONFIG.channels, ...(doc.channels || {}) },
      }
    : { ...DEFAULT_FEE_REMINDER_CONFIG, schoolId, academicYear };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET / — school's reminder config (defaults if none persisted).
router.get('/', checkPermission('fees', 'view'), async (req, res) => {
  try {
    const academicYear = sanitizeQueryStr(req.query.academicYear) || '';
    const config = await getConfig(req.user.schoolId, academicYear);
    res.json(config);
  } catch (error) {
    logger.error('Error fetching fee reminder config:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT / — upsert the school's reminder config.
router.put('/', checkPermission('fees', 'edit'), async (req, res) => {
  try {
    const parsed = configBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const academicYear = sanitizeQueryStr(req.query.academicYear) || '';
    const updated = await FeeReminderConfig.findOneAndUpdate(
      { schoolId: req.user.schoolId, academicYear },
      {
        $set: {
          ...parsed.data,
          schoolId: req.user.schoolId,
          academicYear,
          updatedBy: req.user.userId || req.user.id,
        },
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();

    const merged = await getConfig(req.user.schoolId, academicYear);
    res.json({ ...merged, ...updated });
  } catch (error) {
    logger.error('Error upserting fee reminder config:', error);
    res.status(400).json({ error: error.message });
  }
});

// GET /manual — list manual reminders (newest first).
router.get('/manual', checkPermission('fees', 'view'), async (req, res) => {
  try {
    const academicYear = sanitizeQueryStr(req.query.academicYear) || '';
    const config = await getConfig(req.user.schoolId, academicYear);
    res.json(config.manualReminders || []);
  } catch (error) {
    logger.error('Error listing manual reminders:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /manual — create a manual reminder and fire it immediately to the audience.
router.post('/manual', checkPermission('fees', 'edit'), async (req, res) => {
  try {
    const parsed = manualReminderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const academicYear = sanitizeQueryStr(req.query.academicYear) || '';

    // Resolve the audience size up front so the UI can show "sent to N parents".
    const audienceType = parsed.data.audience?.type || 'overdue';
    const classIds = parsed.data.audience?.classIds || [];
    const baseQuery = {
      schoolId: req.user.schoolId,
      academicYear,
      totalBalance: { $gt: 0 },
      isDeleted: { $ne: true },
    };
    if (audienceType === 'overdue') baseQuery.overallStatus = { $in: ['pending', 'partial'] };
    if (audienceType === 'unpaid') baseQuery.overallStatus = 'pending';
    if (audienceType === 'class' && classIds.length) baseQuery.classId = { $in: classIds };

    const recipients = await StudentFeeStructure.countDocuments(baseQuery).catch(() => 0);

    const entry = {
      name: parsed.data.name,
      message: parsed.data.message || '',
      audience: {
        type: audienceType,
        classIds,
      },
      triggerDate: parsed.data.triggerDate,
      sentAt: new Date(),
      sentBy: req.user.userId || req.user.id,
      recipientCount: recipients,
    };

    const updated = await FeeReminderConfig.findOneAndUpdate(
      { schoolId: req.user.schoolId, academicYear },
      {
        $set: {
          schoolId: req.user.schoolId,
          academicYear,
          updatedBy: req.user.userId || req.user.id,
        },
        $push: { manualReminders: entry },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    // Fire the actual reminders asynchronously so the request returns fast.
    // The reminder service owns channel gating; calling it with the audience
    // query keeps a single source of truth for delivery.
    import('../services/feeReminderService.js')
      .then(({ processManualReminder }) =>
        processManualReminder
          ? processManualReminder({ ...entry, schoolId: req.user.schoolId, academicYear })
          : Promise.resolve()
      )
      .catch((err) => logger.warn({ err }, 'Manual reminder dispatch failed'));

    res.status(201).json(entry);
  } catch (error) {
    logger.error('Error creating manual reminder:', error);
    res.status(400).json({ error: error.message });
  }
});

export default router;
