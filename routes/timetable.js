import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';
import express from 'express';
import { Timetable, Class, Staff } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { validate, schemas } from '../middleware/validation.js';

const router = express.Router();

// IMPORTANT: More specific routes must be defined BEFORE parameterized routes (:classId)
// Otherwise, /generate-all would be matched by /:classId

/**
 * GET /api/timetable
 * Get all timetables for school
 * Query params: academicYear (optional, defaults to CURRENT_ACADEMIC_YEAR)
 */
router.get('/', authenticate, checkPermission('classes', 'view'), async (req, res) => {
  try {
    const { academicYear = CURRENT_ACADEMIC_YEAR } = req.query;

    const timetables = await Timetable.find({ academicYear })
      .populate('classId', 'name section teacher')
      .sort({ 'classId.name': 1, 'classId.section': 1 });

    res.json(timetables);
  } catch (error) {
    console.error('Error fetching all timetables:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/timetable/generate-all
 * Generate/regenerate timetables for all classes
 */
router.post('/generate-all', authenticate, checkPermission('classes', 'edit'), async (req, res) => {
  try {
    const { academicYear = CURRENT_ACADEMIC_YEAR, periodRules } = req.body;

    // Get all classes
    const classes = await Class.find({}).sort({ name: 1, section: 1 });

    if (classes.length === 0) {
      return res.status(404).json({ error: 'No classes found' });
    }

    const results = [];
    const errors = [];

    // Default periods if not provided
    const defaultPeriods = [
      { name: 'Period 1', startTime: '09:00', endTime: '09:45', isBreak: false },
      { name: 'Period 2', startTime: '09:45', endTime: '10:30', isBreak: false },
      { name: 'Break', startTime: '10:30', endTime: '10:45', isBreak: true },
      { name: 'Period 3', startTime: '10:45', endTime: '11:30', isBreak: false },
      { name: 'Period 4', startTime: '11:30', endTime: '12:15', isBreak: false },
      { name: 'Lunch', startTime: '12:15', endTime: '13:00', isBreak: true },
      { name: 'Period 5', startTime: '13:00', endTime: '13:45', isBreak: false },
      { name: 'Period 6', startTime: '13:45', endTime: '14:30', isBreak: false },
    ];

    for (const cls of classes) {
      try {
        // Skip if class has no subjects
        if (!cls.subjects || cls.subjects.length === 0) {
          errors.push({
            classId: cls._id,
            className: `${cls.name}-${cls.section}`,
            error: 'No subjects assigned'
          });
          continue;
        }

        // Check if timetable exists
        let timetable = await Timetable.findOne({ classId: cls._id, academicYear });

        if (!timetable) {
          // Create new timetable
          timetable = new Timetable({
            classId: cls._id,
            academicYear,
            periods: defaultPeriods,
            schedule: {
              Monday: [],
              Tuesday: [],
              Wednesday: [],
              Thursday: [],
              Friday: [],
              Saturday: []
            }
          });
        }

        // Generate schedule using same logic as wizard
        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const periods = timetable.periods || defaultPeriods;

        // Initialize empty schedule
        const schedule = {};
        days.forEach(day => {
          schedule[day] = periods.map(() => ({
            subject: '',
            teacherId: null,
            room: ''
          }));
        });

        // Get non-break periods
        const nonBreakIndices = periods
          .map((p, i) => (!p.isBreak ? i : -1))
          .filter(i => i !== -1);

        // Track subject usage
        const subjectUsage = {};
        cls.subjects.forEach(s => {
          subjectUsage[s] = { perDay: {}, perWeek: 0 };
          days.forEach(d => {
            subjectUsage[s].perDay[d] = 0;
          });
        });

        // Calculate periods per subject
        const totalAvailablePeriods = nonBreakIndices.length * days.length;
        const periodsPerSubject = Math.floor(totalAvailablePeriods / cls.subjects.length);

        // Build subject pool
        const subjectPool = [];
        cls.subjects.forEach(subject => {
          for (let i = 0; i < Math.max(1, periodsPerSubject); i++) {
            subjectPool.push(subject);
          }
        });

        // Shuffle and fill schedule
        const shuffleArray = (arr) => {
          const shuffled = [...arr];
          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          }
          return shuffled;
        };

        for (const day of days) {
          let pool = shuffleArray(subjectPool);

          for (const periodIdx of nonBreakIndices) {
            let selectedSubject = null;

            for (let i = 0; i < pool.length; i++) {
              const subject = pool[i];
              const usage = subjectUsage[subject];

              // Check constraints
              const maxPerDay = periodRules?.maxPeriodsPerSubjectPerDay || 1;
              const maxPerWeek = periodRules?.maxPeriodsPerSubjectPerWeek || 5;
              const noConsecutive = periodRules?.noConsecutiveSame !== false;

              if (usage.perDay[day] >= maxPerDay) continue;
              if (usage.perWeek >= maxPerWeek) continue;

              if (noConsecutive && periodIdx > 0) {
                const prevPeriod = periodIdx - 1;
                if (!periods[prevPeriod]?.isBreak &&
                    schedule[day][prevPeriod]?.subject === subject) {
                  continue;
                }
              }

              selectedSubject = subject;
              pool.splice(i, 1);
              break;
            }

            if (selectedSubject) {
              schedule[day][periodIdx] = {
                subject: selectedSubject,
                teacherId: null,
                room: `Room ${cls.name.replace('Class ', '')}-${cls.section}`
              };

              subjectUsage[selectedSubject].perDay[day]++;
              subjectUsage[selectedSubject].perWeek++;
            }
          }
        }

        timetable.schedule = schedule;
        timetable.version += 1;
        timetable.lastSyncedAt = new Date();

        await timetable.save();
        await timetable.populate('classId', 'name section teacher');

        results.push({
          classId: cls._id,
          className: `${cls.name}-${cls.section}`,
          success: true
        });
      } catch (err) {
        console.error(`Error generating timetable for class ${cls.name}-${cls.section}:`, err);
        errors.push({
          classId: cls._id,
          className: `${cls.name}-${cls.section}`,
          error: err.message
        });
      }
    }

    res.json({
      success: true,
      generated: results.length,
      errors: errors.length,
      results,
      errors
    });
  } catch (error) {
    console.error('Error generating all timetables:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/timetable/:classId
 * Get timetable for a class
 * Query params: academicYear (optional, defaults to CURRENT_ACADEMIC_YEAR)
 */
router.get('/:classId', authenticate, checkPermission('classes', 'view'), async (req, res) => {
  try {
    const { classId } = req.params;
    const { academicYear = CURRENT_ACADEMIC_YEAR } = req.query;

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
    const { classId, academicYear = CURRENT_ACADEMIC_YEAR, periods, schedule } = req.body;

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
 * Update a single slot in timetable
 * Body: { day, periodIndex, subject, teacherId, room }
 */
router.put('/:classId/slot', authenticate, checkPermission('classes', 'edit'), async (req, res) => {
  try {
    const { classId } = req.params;
    const { day, periodIndex, subject, teacherId, room, academicYear = CURRENT_ACADEMIC_YEAR } = req.body;

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
 * Batch update slots in timetable
 * Body: { updates: [{ day, periodIndex, subject, teacherId, room }], academicYear }
 */
router.post('/:classId/batch', authenticate, checkPermission('classes', 'edit'), async (req, res) => {
  try {
    const { classId } = req.params;
    const { updates, academicYear = CURRENT_ACADEMIC_YEAR } = req.body;

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
    const { periods, academicYear = CURRENT_ACADEMIC_YEAR } = req.body;

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
 * PUT /api/timetable/:classId
 * Update entire timetable
 * Body: { academicYear, periods, schedule }
 * Note: This must come AFTER more specific routes like /:classId/slot, /:classId/periods
 */
router.put('/:classId', authenticate, checkPermission('classes', 'edit'), async (req, res) => {
  try {
    const { classId } = req.params;
    const { academicYear = CURRENT_ACADEMIC_YEAR, periods, schedule } = req.body;

    // Validate class exists
    const classData = await Class.findById(classId);
    if (!classData) {
      return res.status(404).json({ error: 'Class not found' });
    }

    // Find existing timetable
    let timetable = await Timetable.findOne({ classId, academicYear });

    if (timetable) {
      // Update existing timetable
      if (periods) timetable.periods = periods;
      if (schedule) timetable.schedule = schedule;
      timetable.version += 1;
      timetable.lastSyncedAt = new Date();
    } else {
      // Create new timetable
      timetable = new Timetable({
        classId,
        academicYear,
        periods: periods || [],
        schedule: schedule || {
          Monday: [], Tuesday: [], Wednesday: [],
          Thursday: [], Friday: [], Saturday: []
        }
      });
    }

    await timetable.save();
    await timetable.populate('classId', 'name section');

    res.json(timetable);
  } catch (error) {
    console.error('Error updating timetable:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/timetable/:classId
 * Delete timetable
 * Query params: academicYear (optional, defaults to CURRENT_ACADEMIC_YEAR)
 */
router.delete('/:classId', authenticate, checkPermission('classes', 'delete'), async (req, res) => {
  try {
    const { classId } = req.params;
    const { academicYear = CURRENT_ACADEMIC_YEAR } = req.query;

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
