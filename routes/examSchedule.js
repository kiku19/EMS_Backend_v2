import express from 'express';
import { Class, Exam, ExamSchedule, Student, Parent } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { validateZod, sanitizeQueryStr } from '../middleware/validation.js';
import { createExamScheduleSchema, updateExamScheduleSchema } from '../validators/index.js';
import { sendNotification } from './notifications.js';
import { extractSchoolId, ensureDefaultSchool } from '../utils/schoolContext.js';
import { EVENTS, emitEvent } from '../utils/socketEvents.js';

const router = express.Router();
router.use(authenticate);

function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) throw new Error('schoolId is required for scoped queries');
  return { ...query, schoolId: normalizedSchoolId };
}

async function resolveRequestSchoolId(req) {
  if (req.user?.schoolId) return extractSchoolId(req.user.schoolId);
  const school = await ensureDefaultSchool();
  return extractSchoolId(school._id);
}

/**
 * Auto-generate timetable entries from classes, date range, and session config.
 */
function generateTimetableEntries(
  classes,
  startDate,
  endDate,
  sessionType,
  defaultMaxMarks,
  defaultPassingMarks
) {
  // Calculate available slots (skip Sundays)
  const slots = [];
  const current = new Date(startDate);
  const end = new Date(endDate);
  current.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  while (current <= end) {
    if (current.getDay() !== 0) {
      // Skip Sundays
      if (sessionType === 'morning' || sessionType === 'both') {
        slots.push({ date: new Date(current), session: 'morning' });
      }
      if (sessionType === 'afternoon' || sessionType === 'both') {
        slots.push({ date: new Date(current), session: 'afternoon' });
      }
    }
    current.setDate(current.getDate() + 1);
  }

  // Find the class with the most subjects — that determines minimum slots needed
  const maxSubjectsCount = Math.max(...classes.map((c) => (c.subjects || []).length), 0);

  if (maxSubjectsCount > slots.length) {
    return {
      error: 'NOT_ENOUGH_SLOTS',
      message: `A class has ${maxSubjectsCount} subjects but only ${slots.length} slots available. Expand the date range or use "both" sessions.`,
      required: maxSubjectsCount,
      available: slots.length,
    };
  }

  // Build per-class subject queues
  // Each class gets its own independent schedule across the slots
  const classQueues = classes.map((cls) => ({
    classId: cls._id,
    subjects: [...(cls.subjects || [])], // copy
  }));

  // Generate entries: for each slot, assign one subject per class
  // Each entry = one slot + one subject + which classes have that subject in this slot
  const entries = [];

  for (let slotIdx = 0; slotIdx < slots.length; slotIdx++) {
    const slot = slots[slotIdx];
    // Group classes by what subject they have in this slot
    const subjectGroupMap = {}; // subjectName → [classId, ...]

    for (const cq of classQueues) {
      if (cq.subjects.length === 0) continue; // This class is done

      const subject = cq.subjects.shift(); // Take next subject
      if (!subjectGroupMap[subject]) subjectGroupMap[subject] = [];
      subjectGroupMap[subject].push(cq.classId);
    }

    // Create one entry per subject group in this slot
    for (const [subjectName, classIds] of Object.entries(subjectGroupMap)) {
      entries.push({
        date: slot.date,
        session: slot.session,
        subjectName,
        classIds,
        maxMarks: defaultMaxMarks || 100,
        passingMarks: defaultPassingMarks || 35,
      });
    }

    // Check if all classes are done
    const allDone = classQueues.every((cq) => cq.subjects.length === 0);
    if (allDone) break;
  }

  return {
    entries,
    unusedSlots: slots.length - Math.ceil(entries.length / Math.max(classes.length, 1)),
  };
}

// GET /exam-schedules - List all exam schedules
router.get(
  '/exam-schedules',
  authenticate,
  checkPermission('academics', 'view'),
  async (req, res) => {
    try {
      const schoolId = await resolveRequestSchoolId(req);
      const query = scopeBySchool(schoolId, { isDeleted: { $ne: true } });

      const academicYear = sanitizeQueryStr(req.query.academicYear);
      const status = sanitizeQueryStr(req.query.status);
      if (academicYear) query.academicYear = academicYear;
      if (status) query.status = status;

      const schedules = await ExamSchedule.find(query)
        .populate('classIds', 'name section')
        .sort({ createdAt: -1 })
        .lean();

      res.json(schedules);
    } catch (error) {
      console.error('Error fetching exam schedules:', error);
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

// GET /exam-schedules/:id - Get single schedule with full details
router.get(
  '/exam-schedules/:id',
  authenticate,
  checkPermission('academics', 'view'),
  async (req, res) => {
    try {
      const schoolId = await resolveRequestSchoolId(req);
      const schedule = await ExamSchedule.findOne(
        scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
      )
        .populate('classIds', 'name section subjects')
        .populate('generatedExamIds', 'name classId status isPublished')
        .lean();

      if (!schedule) {
        return res.status(404).json({ error: 'Exam schedule not found' });
      }

      res.json(schedule);
    } catch (error) {
      console.error('Error fetching exam schedule:', error);
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

// POST /exam-schedules - Create a new draft schedule
router.post(
  '/exam-schedules',
  authenticate,
  checkPermission('academics', 'create'),
  validateZod(createExamScheduleSchema),
  async (req, res) => {
    try {
      const schoolId = await resolveRequestSchoolId(req);

      // Validate that all classes exist and have subjects
      const classes = await Class.find(
        scopeBySchool(schoolId, { _id: { $in: req.body.classIds }, isDeleted: { $ne: true } })
      ).select('name section subjects');

      if (classes.length !== req.body.classIds.length) {
        return res.status(400).json({ error: 'One or more selected classes were not found' });
      }

      const classesWithoutSubjects = classes.filter((c) => !c.subjects || c.subjects.length === 0);
      if (classesWithoutSubjects.length > 0) {
        return res.status(400).json({
          error: 'Some classes have no subjects configured',
          classes: classesWithoutSubjects.map(
            (c) => `${c.name}${c.section ? ' - ' + c.section : ''}`
          ),
        });
      }

      // Check for duplicate schedule name in same academic year
      const existing = await ExamSchedule.findOne(
        scopeBySchool(schoolId, {
          name: req.body.name,
          academicYear: req.body.academicYear || undefined,
          isDeleted: { $ne: true },
        })
      );
      if (existing) {
        return res
          .status(409)
          .json({ error: 'An exam schedule with this name already exists for this academic year' });
      }

      const schedule = new ExamSchedule({
        ...req.body,
        schoolId,
        status: 'draft',
        createdBy: req.user?.id || req.body.createdBy,
      });

      await schedule.save();

      const populated = await ExamSchedule.findById(schedule._id)
        .populate('classIds', 'name section subjects')
        .lean();

      res.status(201).json(populated);
    } catch (error) {
      console.error('Error creating exam schedule:', error);
      if (error.code === 11000) {
        return res
          .status(409)
          .json({ error: 'An exam schedule with this name already exists for this academic year' });
      }
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

// POST /exam-schedules/:id/generate - Auto-generate timetable entries
router.post(
  '/exam-schedules/:id/generate',
  authenticate,
  checkPermission('academics', 'create'),
  async (req, res) => {
    try {
      const schoolId = await resolveRequestSchoolId(req);
      const schedule = await ExamSchedule.findOne(
        scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
      );

      if (!schedule) {
        return res.status(404).json({ error: 'Exam schedule not found' });
      }

      if (schedule.status !== 'draft') {
        return res.status(400).json({ error: 'Can only generate timetable for draft schedules' });
      }

      // Fetch classes with their subjects
      const classes = await Class.find(
        scopeBySchool(schoolId, { _id: { $in: schedule.classIds }, isDeleted: { $ne: true } })
      ).select('name section subjects');

      const result = generateTimetableEntries(
        classes,
        schedule.startDate,
        schedule.endDate,
        schedule.sessionType,
        schedule.defaultMaxMarks,
        schedule.defaultPassingMarks
      );

      if (result.error) {
        return res.status(400).json(result);
      }

      // Save generated entries
      schedule.entries = result.entries;
      await schedule.save();

      const populated = await ExamSchedule.findById(schedule._id)
        .populate('classIds', 'name section subjects')
        .lean();

      res.json({ ...populated, unusedSlots: result.unusedSlots });
    } catch (error) {
      console.error('Error generating timetable:', error);
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

// PUT /exam-schedules/:id - Update a draft schedule
router.put(
  '/exam-schedules/:id',
  authenticate,
  checkPermission('academics', 'edit'),
  validateZod(updateExamScheduleSchema),
  async (req, res) => {
    try {
      const schoolId = await resolveRequestSchoolId(req);
      const schedule = await ExamSchedule.findOne(
        scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
      );

      if (!schedule) {
        return res.status(404).json({ error: 'Exam schedule not found' });
      }

      if (schedule.status !== 'draft') {
        return res.status(400).json({ error: 'Can only edit draft schedules' });
      }

      Object.assign(schedule, req.body);
      await schedule.save();

      const populated = await ExamSchedule.findById(schedule._id)
        .populate('classIds', 'name section subjects')
        .lean();

      res.json(populated);
    } catch (error) {
      console.error('Error updating exam schedule:', error);
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

// POST /exam-schedules/:id/confirm - Confirm schedule and create individual Exam documents
router.post(
  '/exam-schedules/:id/confirm',
  authenticate,
  checkPermission('academics', 'create'),
  async (req, res) => {
    try {
      const schoolId = await resolveRequestSchoolId(req);
      const schedule = await ExamSchedule.findOne(
        scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
      ).populate('classIds', 'name section subjects');

      if (!schedule) {
        return res.status(404).json({ error: 'Exam schedule not found' });
      }

      if (schedule.status !== 'draft') {
        return res.status(400).json({ error: 'Schedule is already confirmed' });
      }

      if (!schedule.entries || schedule.entries.length === 0) {
        return res.status(400).json({ error: 'Generate a timetable before confirming' });
      }

      const generatedExamIds = [];

      // For each class, create an individual Exam document
      for (const cls of schedule.classIds) {
        const classId = cls._id || cls;

        // Filter entries relevant to this class
        const classEntries = schedule.entries.filter((entry) =>
          entry.classIds.some((id) => id.toString() === classId.toString())
        );

        if (classEntries.length === 0) continue;

        // Build subjects subdocument array from entries
        const subjects = classEntries.map((entry) => ({
          subjectName: entry.subjectName,
          date: entry.date,
          startTime:
            entry.session === 'morning'
              ? schedule.morningSlot?.startTime || '09:00'
              : schedule.afternoonSlot?.startTime || '14:00',
          endTime:
            entry.session === 'morning'
              ? schedule.morningSlot?.endTime || '12:00'
              : schedule.afternoonSlot?.endTime || '17:00',
          maxMarks: entry.maxMarks || schedule.defaultMaxMarks,
          passingMarks: entry.passingMarks || schedule.defaultPassingMarks,
        }));

        const exam = new Exam({
          schoolId,
          name: schedule.name,
          type: schedule.type,
          classId,
          academicYear: schedule.academicYear,
          startDate: schedule.startDate,
          endDate: schedule.endDate,
          maxMarks: schedule.defaultMaxMarks,
          passingMarks: schedule.defaultPassingMarks,
          subjects,
          status: 'scheduled',
          createdBy: schedule.createdBy,
          examScheduleId: schedule._id,
        });

        await exam.save();
        generatedExamIds.push(exam._id);
      }

      // Update schedule status
      schedule.generatedExamIds = generatedExamIds;
      schedule.status = 'scheduled';
      await schedule.save();

      const populated = await ExamSchedule.findById(schedule._id)
        .populate('classIds', 'name section subjects')
        .populate('generatedExamIds', 'name classId status')
        .lean();

      res.json(populated);
    } catch (error) {
      console.error('Error confirming exam schedule:', error);
      if (error.code === 11000) {
        return res.status(409).json({
          error:
            'An exam with this name already exists for one of the selected classes. Please use a different schedule name.',
        });
      }
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

// POST /exam-schedules/:id/send - Send timetable to parents
router.post(
  '/exam-schedules/:id/send',
  authenticate,
  checkPermission('academics', 'publish'),
  async (req, res) => {
    try {
      const schoolId = await resolveRequestSchoolId(req);
      const schedule = await ExamSchedule.findOne(
        scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
      );

      if (!schedule) {
        return res.status(404).json({ error: 'Exam schedule not found' });
      }

      if (schedule.status === 'draft') {
        return res.status(400).json({ error: 'Confirm the schedule before sending to parents' });
      }

      // Find all students in the schedule's classes
      const students = await Student.find(
        scopeBySchool(schoolId, {
          classId: { $in: schedule.classIds },
          isDeleted: { $ne: true },
        })
      ).select('_id');

      const studentIds = students.map((s) => s._id);

      // Find parents linked to these students
      if (studentIds.length > 0) {
        const parents = await Parent.find({
          'children.studentId': { $in: studentIds },
        }).select('_id');

        // Send notifications in batches
        for (const parent of parents) {
          sendNotification(
            parent._id,
            'Parent',
            'academic',
            'Exam Timetable Published',
            `The exam timetable for "${schedule.name}" has been published. Check the schedule for your child's exams.`,
            { relatedId: schedule._id, relatedType: 'ExamSchedule', priority: 'normal' }
          ).catch((err) => console.error('Notification error (exam schedule send):', err));
        }
      }

      // Emit socket event
      const io = req.app.get('io');
      emitEvent(io, EVENTS.EXAM_SCHEDULE_SENT, {
        schoolId: schoolId.toString(),
        scheduleId: schedule._id.toString(),
        scheduleName: schedule.name,
        classIds: schedule.classIds.map((id) => id.toString()),
      });

      // Update schedule status
      schedule.status = 'sent';
      schedule.sentAt = new Date();
      schedule.sentToParents = true;
      await schedule.save();

      res.json(schedule);
    } catch (error) {
      console.error('Error sending exam schedule:', error);
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

// DELETE /exam-schedules/:id - Soft delete
router.delete(
  '/exam-schedules/:id',
  authenticate,
  checkPermission('academics', 'delete'),
  async (req, res) => {
    try {
      const schoolId = await resolveRequestSchoolId(req);
      const schedule = await ExamSchedule.findOne(
        scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
      );

      if (!schedule) {
        return res.status(404).json({ error: 'Exam schedule not found' });
      }

      // Soft delete the schedule
      schedule.isDeleted = true;
      schedule.deletedAt = new Date();
      await schedule.save();

      // Also soft-delete generated exams
      if (schedule.generatedExamIds?.length > 0) {
        await Exam.updateMany(
          { _id: { $in: schedule.generatedExamIds }, schoolId },
          { $set: { isDeleted: true, deletedAt: new Date() } }
        );
      }

      res.json({ message: 'Exam schedule deleted successfully' });
    } catch (error) {
      console.error('Error deleting exam schedule:', error);
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

export default router;
