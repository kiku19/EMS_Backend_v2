import express from 'express';
import { SchoolSettings } from '../../database.js';
import { authenticate } from '../../middleware/auth.js';
import { getDefaultSchoolSettings } from '../../utils/academicYear.js';
import { buildSchoolScopedQuery } from '../../utils/schoolContext.js';

const router = express.Router();
router.use(authenticate);

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
    let settings = await findSchoolSettings(req);

    if (!settings) {
      settings = await SchoolSettings.create({
        ...getDefaultSchoolSettings(req.user?.schoolId),
        holidays: [req.body],
      });
    } else {
      settings.holidays = settings.holidays || [];
      settings.holidays.push(req.body);
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

    settings.holidays[holidayIndex] = { ...settings.holidays[holidayIndex], ...req.body };
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
    let settings = await findSchoolSettings(req);

    if (!settings) {
      settings = await SchoolSettings.create({
        ...getDefaultSchoolSettings(req.user?.schoolId),
        leaveTypes: [req.body],
      });
    } else {
      settings.leaveTypes = settings.leaveTypes || [];
      settings.leaveTypes.push(req.body);
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

    settings.leaveTypes[leaveTypeIndex] = { ...settings.leaveTypes[leaveTypeIndex], ...req.body };
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
