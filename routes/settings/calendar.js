import express from 'express';
import { z } from 'zod';
import { SchoolSettings } from '../../database.js';
import { authenticate } from '../../middleware/auth.js';
import { getDefaultSchoolSettings } from '../../utils/academicYear.js';
import { buildSchoolScopedQuery } from '../../utils/schoolContext.js';

const router = express.Router();
router.use(authenticate);

// ─── Zod Validation Schemas ────────────────────────────────────────────────────

const holidaySchema = z
  .object({
    name: z.string().min(1, 'Holiday name is required').max(200).trim(),
    date: z
      .string()
      .min(1, 'Date is required')
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
    type: z.string().max(50).default('General'),
    description: z.string().max(500).default(''),
  })
  .strip();

const leaveTypeSchema = z
  .object({
    name: z.string().min(1, 'Leave type name is required').max(100).trim(),
    quota: z.number().min(0, 'Quota cannot be negative').default(0),
    applicableTo: z.string().max(50).default('both'),
    requiresApproval: z.boolean().default(true),
  })
  .strip();

const getSettingsQuery = (req) => buildSchoolScopedQuery(req.user?.schoolId);
const findSchoolSettings = (req) => SchoolSettings.findOne(getSettingsQuery(req));

// Get holidays
router.get('/holidays', authenticate, async (req, res) => {
  try {
    const settings = await findSchoolSettings(req);
    res.json(settings?.holidays || []);
  } catch (error) {
    console.error('Error fetching holidays:', error);
    res.status(500).json({ error: 'Failed to fetch holidays' });
  }
});

// Add holiday
router.post('/holidays', authenticate, async (req, res) => {
  try {
    const parsed = holidaySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }

    let settings = await findSchoolSettings(req);

    if (!settings) {
      settings = await SchoolSettings.create({
        ...getDefaultSchoolSettings(req.user?.schoolId),
        holidays: [parsed.data],
      });
    } else {
      settings.holidays = settings.holidays || [];
      settings.holidays.push(parsed.data);
      await settings.save();
    }

    res.json(settings.holidays);
  } catch (error) {
    console.error('Error adding holiday:', error);
    res.status(500).json({ error: 'Failed to add holiday' });
  }
});

// Update holiday
router.put('/holidays/:id', authenticate, async (req, res) => {
  try {
    const settings = await findSchoolSettings(req);

    if (!settings) {
      return res.status(404).json({ error: 'Settings not found' });
    }

    const holidayIndex = settings.holidays.findIndex((h) => h._id.toString() === req.params.id);

    if (holidayIndex === -1) {
      return res.status(404).json({ error: 'Holiday not found' });
    }

    const parsed = holidaySchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }

    settings.holidays[holidayIndex] = { ...settings.holidays[holidayIndex], ...parsed.data };
    await settings.save();

    res.json(settings.holidays);
  } catch (error) {
    console.error('Error updating holiday:', error);
    res.status(500).json({ error: 'Failed to update holiday' });
  }
});

// Delete holiday
router.delete('/holidays/:id', authenticate, async (req, res) => {
  try {
    const settings = await findSchoolSettings(req);

    if (!settings) {
      return res.status(404).json({ error: 'Settings not found' });
    }

    settings.holidays = settings.holidays.filter((h) => h._id.toString() !== req.params.id);
    await settings.save();

    res.json(settings.holidays);
  } catch (error) {
    console.error('Error deleting holiday:', error);
    res.status(500).json({ error: 'Failed to delete holiday' });
  }
});

// Get leave types
router.get('/leave-types', authenticate, async (req, res) => {
  try {
    const settings = await findSchoolSettings(req);
    res.json(settings?.leaveTypes || []);
  } catch (error) {
    console.error('Error fetching leave types:', error);
    res.status(500).json({ error: 'Failed to fetch leave types' });
  }
});

// Add leave type
router.post('/leave-types', authenticate, async (req, res) => {
  try {
    const parsed = leaveTypeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }

    let settings = await findSchoolSettings(req);

    if (!settings) {
      settings = await SchoolSettings.create({
        ...getDefaultSchoolSettings(req.user?.schoolId),
        leaveTypes: [parsed.data],
      });
    } else {
      settings.leaveTypes = settings.leaveTypes || [];
      settings.leaveTypes.push(parsed.data);
      await settings.save();
    }

    res.json(settings.leaveTypes);
  } catch (error) {
    console.error('Error adding leave type:', error);
    res.status(500).json({ error: 'Failed to add leave type' });
  }
});

// Update leave type
router.put('/leave-types/:id', authenticate, async (req, res) => {
  try {
    const settings = await findSchoolSettings(req);

    if (!settings) {
      return res.status(404).json({ error: 'Settings not found' });
    }

    const leaveTypeIndex = settings.leaveTypes.findIndex(
      (lt) => lt._id.toString() === req.params.id
    );

    if (leaveTypeIndex === -1) {
      return res.status(404).json({ error: 'Leave type not found' });
    }

    const parsed = leaveTypeSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }

    settings.leaveTypes[leaveTypeIndex] = {
      ...settings.leaveTypes[leaveTypeIndex],
      ...parsed.data,
    };
    await settings.save();

    res.json(settings.leaveTypes);
  } catch (error) {
    console.error('Error updating leave type:', error);
    res.status(500).json({ error: 'Failed to update leave type' });
  }
});

// Delete leave type
router.delete('/leave-types/:id', authenticate, async (req, res) => {
  try {
    const settings = await findSchoolSettings(req);

    if (!settings) {
      return res.status(404).json({ error: 'Settings not found' });
    }

    settings.leaveTypes = settings.leaveTypes.filter((lt) => lt._id.toString() !== req.params.id);
    await settings.save();

    res.json(settings.leaveTypes);
  } catch (error) {
    console.error('Error deleting leave type:', error);
    res.status(500).json({ error: 'Failed to delete leave type' });
  }
});

export default router;
