import express from 'express';
import { Timetable, Class, Staff } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { validate, schemas } from '../middleware/validation.js';

const router = express.Router();

/**
 * GET /api/timetable/:classId
 * Get timetable for a class
 * Query params: academicYear (optional, defaults to '2024-25')
 */
router.get('/:classId', authenticate, checkPermission('classes', 'view'), async (req, res) => {
  try {
    const { classId } = req.params;
    const { academicYear = '2024-25' } = req.query;

    const timetable = await Timetable.findOne({ classId, academicYear });

    if (!timetable) {
      return res.status(404).json({ error: 'Timetable not found for this class' });
    }

    res.json(timetable);
  } catch (error) {
    console.error('Error fetching timetable:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/timetable
 * Create new timetable
 */
router.post('/', authenticate, checkPermission('classes', 'edit'), async (req, res) => {
  try {
    const { classId, academicYear = '2024-25', periods, schedule } = req.body;

    // Validate class exists
    const classData = await Class.findById(classId);
    if (!classData) {
      return res.status(404).json({ error: 'Class not found' });
    }

    // Check if timetable already exists
    const existing = await Timetable.findOne({ classId, academicYear });
    if (existing) {
      return res.status(400).json({ error: 'Timetable already exists for this class and academic year' });
    }

    const timetable = new Timetable({
      classId,
      academicYear,
      periods: periods || [],
      schedule: schedule || {
        Monday: [],
        Tuesday: [],
        Wednesday: [],
        Thursday: [],
        Friday: [],
        Saturday: []
      }
    });

    await timetable.save();

    // Populate class info for response
    await timetable.populate('classId', 'name section');

    res.status(201).json(timetable);
  } catch (error) {
    console.error('Error creating timetable:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/timetable/:classId/slot
 * Update a single slot in the timetable
 * Body: { day, periodIndex, subject, teacherId, room }
 */
router.put('/:classId/slot', authenticate, checkPermission('classes', 'edit'), async (req, res) => {
  try {
    const { classId } = req.params;
    const { day, periodIndex, subject, teacherId, room, academicYear = '2024-25' } = req.body;

    // Validate day
    const validDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    if (!validDays.includes(day)) {
      return res.status(400).json({ error: 'Invalid day' });
    }

    // Validate periodIndex
    if (typeof periodIndex !== 'number' || periodIndex < 0) {
      return res.status(400).json({ error: 'Invalid period index' });
    }

    // Validate teacher if provided
    if (teacherId) {
      const teacher = await Staff.findById(teacherId);
      if (!teacher) {
        return res.status(404).json({ error: 'Teacher not found' });
      }
    }

    // Find timetable
    const timetable = await Timetable.findOne({ classId, academicYear });
    if (!timetable) {
      return res.status(404).json({ error: 'Timetable not found' });
    }

    // Ensure schedule array has enough slots
    while (timetable.schedule[day].length <= periodIndex) {
      timetable.schedule[day].push({
        subject: '',
        teacherId: null,
        room: '',
        lastModified: new Date(),
        modifiedBy: req.user?.id
      });
    }

    // Update the slot
    timetable.schedule[day][periodIndex] = {
      subject: subject || '',
      teacherId: teacherId || null,
      room: room || '',
      lastModified: new Date(),
      modifiedBy: req.user?.id
    };

    // Increment version
    timetable.version += 1;
    timetable.lastSyncedAt = new Date();

    await timetable.save();
    await timetable.populate('classId', 'name section');
    await timetable.populate(`schedule.${day}.${periodIndex}.teacherId`, 'name');

    res.json(timetable);
  } catch (error) {
    console.error('Error updating timetable slot:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/timetable/:classId/batch
 * Batch update slots in the timetable
 * Body: { updates: [{ day, periodIndex, subject, teacherId, room }], academicYear }
 */
router.post('/:classId/batch', authenticate, checkPermission('classes', 'edit'), async (req, res) => {
  try {
    const { classId } = req.params;
    const { updates, academicYear = '2024-25' } = req.body;

    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: 'Updates array is required' });
    }

    // Find timetable
    const timetable = await Timetable.findOne({ classId, academicYear });
    if (!timetable) {
      return res.status(404).json({ error: 'Timetable not found' });
    }

    const validDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    // Process each update
    for (const update of updates) {
      const { day, periodIndex, subject, teacherId, room } = update;

      // Validate day
      if (!validDays.includes(day)) {
        continue; // Skip invalid days
      }

      // Validate periodIndex
      if (typeof periodIndex !== 'number' || periodIndex < 0) {
        continue; // Skip invalid indices
      }

      // Ensure schedule array has enough slots
      while (timetable.schedule[day].length <= periodIndex) {
        timetable.schedule[day].push({
          subject: '',
          teacherId: null,
          room: '',
          lastModified: new Date(),
          modifiedBy: req.user?.id
        });
      }

      // Update the slot
      timetable.schedule[day][periodIndex] = {
        subject: subject || '',
        teacherId: teacherId || null,
        room: room || '',
        lastModified: new Date(),
        modifiedBy: req.user?.id
      };
    }

    // Increment version
    timetable.version += 1;
    timetable.lastSyncedAt = new Date();

    await timetable.save();
    await timetable.populate('classId', 'name section');

    res.json(timetable);
  } catch (error) {
    console.error('Error batch updating timetable:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/timetable/:classId/periods
 * Update period configuration
 * Body: { periods: [{ name, startTime, endTime, isBreak }], academicYear }
 */
router.put('/:classId/periods', authenticate, checkPermission('classes', 'edit'), async (req, res) => {
  try {
    const { classId } = req.params;
    const { periods, academicYear = '2024-25' } = req.body;

    if (!Array.isArray(periods)) {
      return res.status(400).json({ error: 'Periods must be an array' });
    }

    // Find timetable
    const timetable = await Timetable.findOne({ classId, academicYear });
    if (!timetable) {
      return res.status(404).json({ error: 'Timetable not found' });
    }

    // Update periods
    timetable.periods = periods;
    timetable.version += 1;
    timetable.lastSyncedAt = new Date();

    await timetable.save();
    await timetable.populate('classId', 'name section');

    res.json(timetable);
  } catch (error) {
    console.error('Error updating periods:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/timetable/:classId
 * Delete timetable
 * Query params: academicYear (optional, defaults to '2024-25')
 */
router.delete('/:classId', authenticate, checkPermission('classes', 'delete'), async (req, res) => {
  try {
    const { classId } = req.params;
    const { academicYear = '2024-25' } = req.query;

    const timetable = await Timetable.findOneAndDelete({ classId, academicYear });

    if (!timetable) {
      return res.status(404).json({ error: 'Timetable not found' });
    }

    res.json({ success: true, message: 'Timetable deleted successfully' });
  } catch (error) {
    console.error('Error deleting timetable:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
