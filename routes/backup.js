import express from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Student, Class, Staff, SchoolSettings } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/auth/permissions.js';
import FeeHead from '../models/FeeHead.js';
import BackupRecord from '../models/BackupRecord.js';

const router = express.Router();
router.use(authenticate);
// Backup create/restore/delete are destructive, admin-only operations.
router.use(requireAdmin);

const createBackupSchema = z.object({
  label: z.string().max(100).trim().optional().default(''),
});

const restoreBackupSchema = z.object({
  confirmText: z.string().refine((v) => v === 'RESTORE', {
    message: 'Type RESTORE to confirm the restore operation',
  }),
});

// POST /backup/create — generate a full school data snapshot
router.post('/create', async (req, res) => {
  const parsed = createBackupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: req.t('common:routes.validationFailed'), details: parsed.error.errors });
  }

  const { label } = parsed.data;
  const schoolId = req.user.schoolId;

  try {
    const [students, classes, staff, settings, feeHeads] = await Promise.all([
      Student.find({ schoolId, isDeleted: { $ne: true } }).lean(),
      Class.find({ schoolId }).lean(),
      Staff.find({ schoolId, isActive: true }).select('-password').lean(),
      SchoolSettings.findOne({ schoolId }).lean(),
      FeeHead.find({ schoolId }).lean(),
    ]);

    const backupData = {
      version: '1.0',
      schoolId: schoolId.toString(),
      createdAt: new Date().toISOString(),
      collections: { students, classes, staff, settings: settings ? [settings] : [], feeHeads },
    };

    const sizeBytes = Buffer.byteLength(JSON.stringify(backupData), 'utf8');

    const record = await BackupRecord.create({
      schoolId,
      createdBy: req.user._id || req.user.id,
      label,
      status: 'completed',
      collections: ['students', 'classes', 'staff', 'settings', 'feeHeads'],
      recordCounts: {
        students: students.length,
        classes: classes.length,
        staff: staff.length,
        feeHeads: feeHeads.length,
      },
      sizeBytes,
      data: backupData,
    });

    res.json({
      success: true,
      backup: {
        _id: record._id,
        label: record.label,
        status: record.status,
        collections: record.collections,
        recordCounts: record.recordCounts,
        sizeBytes: record.sizeBytes,
        createdAt: record.createdAt,
      },
    });
  } catch (error) {
    console.error('Error creating backup:', error);
    res.status(500).json({ error: req.t('common:routes.failedToCreateBackup') });
  }
});

// GET /backup/list — list backups for this school (no data payload)
router.get('/list', async (req, res) => {
  const schoolId = req.user.schoolId;
  try {
    const backups = await BackupRecord.find({ schoolId })
      .select('-data')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    res.json({ success: true, backups });
  } catch (error) {
    console.error('Error listing backups:', error);
    res.status(500).json({ error: req.t('common:routes.failedToListBackups') });
  }
});

// GET /backup/:id/download — stream backup JSON as a file download
router.get('/:id/download', async (req, res) => {
  const schoolId = req.user.schoolId;
  try {
    const backup = await BackupRecord.findOne({ _id: req.params.id, schoolId }).lean();
    if (!backup) return res.status(404).json({ error: req.t('common:routes.backupNotFound') });

    const dateStr = new Date(backup.createdAt).toISOString().split('T')[0];
    const slug = (backup.label || 'school').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filename = `backup_${slug}_${dateStr}.json`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(backup.data, null, 2));
  } catch (error) {
    console.error('Error downloading backup:', error);
    res.status(500).json({ error: req.t('common:routes.failedToDownloadBackup') });
  }
});

// POST /backup/:id/restore — restore school data from a stored backup
router.post('/:id/restore', async (req, res) => {
  const parsed = restoreBackupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: req.t('common:routes.validationFailed'), details: parsed.error.errors });
  }

  const schoolId = req.user.schoolId;
  try {
    const backup = await BackupRecord.findOne({ _id: req.params.id, schoolId }).lean();
    if (!backup) return res.status(404).json({ error: req.t('common:routes.backupNotFound') });

    const { collections } = backup.data;
    const restored = {};

    // Atomic restore: every deleteMany + insertMany must commit together or
    // none of them. Previously deleteMany committed first and insertMany ran
    // separately — if insertMany threw (validation, duplicate key, ordered
    // partial failure) the collection was already wiped with no rollback,
    // permanently destroying school data and returning a generic 500. Wrapping
    // the whole restore in a transaction guarantees a failed restore leaves
    // the live data untouched.
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        if (collections.students?.length) {
          await Student.deleteMany({ schoolId }, { session });
          await Student.insertMany(
            collections.students.map((s) => ({ ...s, schoolId })),
            { ordered: false, session }
          );
          restored.students = collections.students.length;
        }

        if (collections.classes?.length) {
          await Class.deleteMany({ schoolId }, { session });
          await Class.insertMany(
            collections.classes.map((c) => ({ ...c, schoolId })),
            { ordered: false, session }
          );
          restored.classes = collections.classes.length;
        }

        if (collections.staff?.length) {
          await Staff.deleteMany({ schoolId }, { session });
          await Staff.insertMany(
            collections.staff.map((sDoc) => ({ ...sDoc, schoolId })),
            { ordered: false, session }
          );
          restored.staff = collections.staff.length;
        }

        if (collections.feeHeads?.length) {
          await FeeHead.deleteMany({ schoolId }, { session });
          await FeeHead.insertMany(
            collections.feeHeads.map((f) => ({ ...f, schoolId })),
            { ordered: false, session }
          );
          restored.feeHeads = collections.feeHeads.length;
        }

        if (collections.settings?.[0]) {
          const { _id, ...settingsData } = collections.settings[0];
          await SchoolSettings.findOneAndUpdate(
            { schoolId },
            { ...settingsData, schoolId },
            { upsert: true, new: true, session }
          );
          restored.settings = 1;
        }
      });
    } finally {
      await session.endSession();
    }

    res.json({ success: true, restored });
  } catch (error) {
    console.error('Error restoring backup:', error);
    res.status(500).json({ error: req.t('common:routes.failedToRestoreBackup') });
  }
});

// ─── Schedule Settings ─────────────────────────────────────────────────────────

const backupScheduleSchema = z.object({
  enabled: z.boolean(),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  notifyEmail: z.string().email('Invalid email').or(z.literal('')).optional(),
});

// GET /backup/schedule — get this school's backup schedule settings
router.get('/schedule', async (req, res) => {
  const schoolId = req.user.schoolId;
  try {
    const settings = await SchoolSettings.findOne({ schoolId }).select('backupSchedule').lean();
    res.json({ success: true, schedule: settings?.backupSchedule || {} });
  } catch (error) {
    console.error('Error fetching backup schedule:', error);
    res.status(500).json({ error: req.t('common:routes.failedToFetchBackupSchedule') });
  }
});

// PUT /backup/schedule — save backup schedule settings
router.put('/schedule', async (req, res) => {
  const parsed = backupScheduleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: req.t('common:routes.validationFailed'), details: parsed.error.errors });
  }

  const schoolId = req.user.schoolId;
  try {
    const settings = await SchoolSettings.findOneAndUpdate(
      { schoolId },
      { $set: { backupSchedule: parsed.data } },
      { upsert: true, new: true, runValidators: true }
    );
    res.json({ success: true, schedule: settings.backupSchedule });
  } catch (error) {
    console.error('Error saving backup schedule:', error);
    res.status(500).json({ error: req.t('common:routes.failedToSaveBackupSchedule') });
  }
});

// DELETE /backup/:id — remove a backup record
router.delete('/:id', async (req, res) => {
  const schoolId = req.user.schoolId;
  try {
    const backup = await BackupRecord.findOneAndDelete({ _id: req.params.id, schoolId });
    if (!backup) return res.status(404).json({ error: req.t('common:routes.backupNotFound') });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting backup:', error);
    res.status(500).json({ error: req.t('common:routes.failedToDeleteBackup') });
  }
});

export default router;
