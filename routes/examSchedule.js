import express from 'express';
import mongoose from 'mongoose';
import {
  Class,
  Exam,
  ExamHall,
  ExamSchedule,
  Result,
  Student,
  Parent,
  SchoolSettings,
} from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { validateZod, sanitizeQueryStr } from '../middleware/validation.js';
import {
  createExamScheduleSchema,
  updateExamScheduleSchema,
  seatExamScheduleSchema,
  emptyExamScheduleActionSchema,
} from '../validators/index.js';
import { sendNotification } from './notifications.js';
import { extractSchoolId, ensureDefaultSchool } from '../utils/schoolContext.js';
import { EVENTS, emitEvent } from '../utils/socketEvents.js';
import { logToTrash } from '../services/trashService.js';
import { generateScheduleSeating, buildClassroomVenues } from '../services/examSeating.js';
import { DAY_CODE_TO_INDEX, DEFAULT_WORKING_DAY_CODES } from '../utils/weekdays.js';

const router = express.Router();
router.use(authenticate);

/**
 * Check for time overlaps between a new exam schedule and existing ones
 * for the same classes in the same date range.
 * @returns {Array} Array of conflict descriptions, empty if no conflicts
 */
async function checkScheduleConflicts(schoolId, classIds, startDate, endDate, excludeId = null) {
  const conflictQuery = scopeBySchool(schoolId, {
    isDeleted: { $ne: true },
    status: { $ne: 'draft' }, // Only check confirmed/sent schedules
    classIds: { $in: classIds },
    startDate: { $lte: endDate },
    endDate: { $gte: startDate },
  });
  if (excludeId) conflictQuery._id = { $ne: excludeId };

  const overlapping = await ExamSchedule.find(conflictQuery)
    .select('name startDate endDate classIds')
    .lean();

  return overlapping.map((s) => ({
    scheduleId: s._id,
    scheduleName: s.name,
    startDate: s.startDate,
    endDate: s.endDate,
  }));
}

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

async function validateScheduleReferences(schoolId, classIds, entries = [], session = null) {
  const selectedIds = [...new Set((classIds || []).map((id) => String(id?._id || id)))];
  let classQuery = Class.find(
    scopeBySchool(schoolId, {
      _id: { $in: selectedIds },
      isDeleted: { $ne: true },
    })
  ).select('_id name section subjects');
  if (session) classQuery = classQuery.session(session);
  const classes = await classQuery;
  if (classes.length !== selectedIds.length) {
    const error = new Error('One or more selected classes were not found in this school');
    error.statusCode = 400;
    throw error;
  }

  const classById = new Map(classes.map((cls) => [String(cls._id), cls]));
  for (const entry of entries || []) {
    for (const classId of entry.classIds || []) {
      const cls = classById.get(String(classId?._id || classId));
      if (!cls) {
        const error = new Error(
          'A schedule entry references a class outside the selected school classes'
        );
        error.statusCode = 400;
        throw error;
      }
      if (entry.subjectName && !(cls.subjects || []).includes(entry.subjectName)) {
        const error = new Error(
          `Subject "${entry.subjectName}" is not configured for ${cls.name}${cls.section ? `-${cls.section}` : ''}`
        );
        error.statusCode = 400;
        throw error;
      }
    }
  }
  return classes;
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
  defaultPassingMarks,
  {
    workingDayCodes = DEFAULT_WORKING_DAY_CODES,
    holidayDates = new Set(),
    secondFourthSaturdayOff = false,
  } = {}
) {
  // Calculate available slots from the school's own working-week and holiday
  // configuration. This intentionally does not hard-code Sunday: schools with
  // a Sun-Thu week can schedule Sunday exams, while a configured holiday is
  // always excluded.
  const workingDayIndexes = new Set(
    workingDayCodes.map((code) => DAY_CODE_TO_INDEX[code]).filter((day) => day !== undefined)
  );
  const slots = [];
  const current = new Date(startDate);
  const end = new Date(endDate);
  current.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(23, 59, 59, 999);

  while (current <= end) {
    const dateString = current.toISOString().slice(0, 10);
    const dayIndex = current.getUTCDay();
    const occurrenceInMonth = Math.ceil(current.getUTCDate() / 7);
    const configuredSaturdayOff =
      secondFourthSaturdayOff && dayIndex === 6 && [2, 4].includes(occurrenceInMonth);
    if (
      workingDayIndexes.has(dayIndex) &&
      !holidayDates.has(dateString) &&
      !configuredSaturdayOff
    ) {
      if (sessionType === 'morning' || sessionType === 'both') {
        slots.push({ date: new Date(current), session: 'morning' });
      }
      if (sessionType === 'afternoon' || sessionType === 'both') {
        slots.push({ date: new Date(current), session: 'afternoon' });
      }
    }
    current.setUTCDate(current.getUTCDate() + 1);
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
router.get('/exam-schedules', checkPermission('academics', 'view'), async (req, res) => {
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
});

// GET /exam-schedules/:id - Get single schedule with full details
router.get('/exam-schedules/:id', checkPermission('academics', 'view'), async (req, res) => {
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

    // Attach result-entry progress to each generated exam so the UI can show
    // "28/34 entered". Denominator = active students in the exam's class
    // (matches GET /classes/:id/students). Numerator = non-deleted Result
    // docs with marks entered (marksObtained != null). Everything is scoped
    // by schoolId — no cross-tenant leakage.
    const generatedExams = await attachGeneratedExamProgress(schoolId, schedule);

    res.json({ ...schedule, generatedExams });
  } catch (error) {
    console.error('Error fetching exam schedule:', error);
    res.status(500).json({ error: 'An internal error occurred. Please try again.' });
  }
});

/**
 * Build the `generatedExams` array for a schedule: each generated Exam with a
 * resolved class name + a `resultEntry: { total, entered }` progress object.
 * `total` counts active, non-deleted students in the exam's class; `entered`
 * counts non-deleted Result docs for that exam whose marksObtained is not null.
 * Computed with two batched aggregates to avoid N+1 queries.
 *
 * @param {string} schoolId - normalized school id (already scoped)
 * @param {object} schedule - lean schedule doc with populated generatedExamIds + classIds
 * @returns {Promise<Array>} generated exam view objects (empty if none)
 */
async function attachGeneratedExamProgress(schoolId, schedule) {
  const populatedExams = Array.isArray(schedule.generatedExamIds)
    ? schedule.generatedExamIds.filter(Boolean)
    : [];
  if (populatedExams.length === 0) return [];

  // Index the schedule's own classes so we can resolve classId → display name
  // without an extra query.
  const classNameById = new Map();
  (schedule.classIds || []).forEach((c) => {
    if (c?._id) {
      classNameById.set(String(c._id), c.section ? `${c.name}-${c.section}` : c.name);
    }
  });

  const examIds = populatedExams.map((e) => e._id);
  const classIds = [
    ...new Set(
      populatedExams
        .map((e) => e.classId)
        .filter(Boolean)
        .map((id) => String(typeof id === 'object' ? id._id : id))
    ),
  ];

  // Cast ObjectIds explicitly: aggregate $match does NOT apply schema casting,
  // so passing a string schoolId/examId/classId would silently match nothing.
  // (Same pattern as routes/fees.js `toObjectIdOrLeave`.)
  const schoolObjectId = new mongoose.Types.ObjectId(String(schoolId));
  const examObjectIds = examIds.map((id) => new mongoose.Types.ObjectId(String(id)));
  const classObjectIds = classIds.map((id) => new mongoose.Types.ObjectId(String(id)));

  // Two scoped aggregates — both $match on schoolId for multi-tenant safety.
  const matchStages = [];
  if (examObjectIds.length > 0) {
    matchStages.push(
      Result.aggregate([
        {
          $match: {
            schoolId: schoolObjectId,
            examId: { $in: examObjectIds },
            isDeleted: { $ne: true },
            marksObtained: { $ne: null },
          },
        },
        { $group: { _id: '$examId', count: { $sum: 1 } } },
      ])
    );
  }
  if (classObjectIds.length > 0) {
    matchStages.push(
      Student.aggregate([
        {
          $match: {
            schoolId: schoolObjectId,
            classId: { $in: classObjectIds },
            status: 'active',
            isDeleted: { $ne: true },
          },
        },
        { $group: { _id: '$classId', count: { $sum: 1 } } },
      ])
    );
  }
  const aggregateResults = await Promise.all(matchStages);
  // Order matches how we pushed into matchStages above (results first, then students).
  const enteredByExam = examObjectIds.length > 0 ? aggregateResults.shift() : [];
  const totalByClass = classObjectIds.length > 0 ? aggregateResults.shift() : [];

  const enteredMap = new Map(enteredByExam.map((r) => [String(r._id), r.count]));
  const totalMap = new Map(totalByClass.map((r) => [String(r._id), r.count]));

  return populatedExams.map((exam) => {
    const classId = typeof exam.classId === 'object' ? exam.classId?._id : exam.classId;
    const classIdStr = classId ? String(classId) : null;
    return {
      id: exam._id,
      _id: exam._id,
      name: exam.name,
      classId,
      className: classIdStr ? classNameById.get(classIdStr) || null : null,
      status: exam.status,
      isPublished: exam.isPublished,
      resultEntry: {
        total: classIdStr ? totalMap.get(classIdStr) || 0 : 0,
        entered: enteredMap.get(String(exam._id)) || 0,
      },
    };
  });
}

// POST /exam-schedules - Create a new draft schedule
router.post(
  '/exam-schedules',
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

      // Check for time overlaps with existing confirmed schedules
      const conflicts = await checkScheduleConflicts(
        schoolId,
        req.body.classIds,
        req.body.startDate,
        req.body.endDate
      );
      if (conflicts.length > 0) {
        return res.status(409).json({
          error: 'Schedule overlaps with existing exam schedules for the same class(es)',
          conflicts,
        });
      }

      const schedule = new ExamSchedule({
        ...req.body,
        schoolId,
        status: 'draft',
        createdBy: req.user?.id || req.body.createdBy,
      });

      await schedule.save();

      const populated = await ExamSchedule.findOne(scopeBySchool(schoolId, { _id: schedule._id }))
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
  checkPermission('academics', 'create'),
  validateZod(emptyExamScheduleActionSchema),
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

      const conflicts = await checkScheduleConflicts(
        schoolId,
        schedule.classIds,
        schedule.startDate,
        schedule.endDate,
        schedule._id
      );
      if (conflicts.length > 0) {
        return res.status(409).json({
          error: 'Schedule overlaps with existing confirmed exam schedules for the same class(es)',
          conflicts,
        });
      }

      // Fetch the participating classes and calendar policy together. Calendar
      // events are optional here because the model is registered by the
      // calendar module; SchoolSettings holidays remain the persisted fallback.
      const calendarEventModel = mongoose.models.CalendarEvent;
      const [classes, settings, calendarHolidays] = await Promise.all([
        Class.find(
          scopeBySchool(schoolId, {
            _id: { $in: schedule.classIds },
            isDeleted: { $ne: true },
          })
        ).select('name section subjects'),
        SchoolSettings.findOne(scopeBySchool(schoolId, {}))
          .select('workingDays holidays secondFourthSaturdayOff')
          .lean(),
        calendarEventModel
          ? calendarEventModel
              .find(
                scopeBySchool(schoolId, {
                  isDeleted: { $ne: true },
                  type: 'holiday',
                  date: {
                    $gte: schedule.startDate.toISOString().slice(0, 10),
                    $lte: schedule.endDate.toISOString().slice(0, 10),
                  },
                })
              )
              .select('date')
              .lean()
          : Promise.resolve([]),
      ]);
      if (classes.length !== schedule.classIds.length) {
        return res.status(400).json({
          error: 'One or more scheduled classes no longer exist in this school',
        });
      }

      const holidayDates = new Set([
        ...(settings?.holidays || []).map((holiday) => holiday.date),
        ...calendarHolidays.map((holiday) => holiday.date),
      ]);
      const result = generateTimetableEntries(
        classes,
        schedule.startDate,
        schedule.endDate,
        schedule.sessionType,
        schedule.defaultMaxMarks,
        schedule.defaultPassingMarks,
        {
          workingDayCodes:
            settings?.workingDays?.length > 0 ? settings.workingDays : DEFAULT_WORKING_DAY_CODES,
          holidayDates,
          secondFourthSaturdayOff: settings?.secondFourthSaturdayOff === true,
        }
      );

      if (result.error) {
        return res.status(400).json(result);
      }

      // Save generated entries
      schedule.entries = result.entries;
      await schedule.save();

      const populated = await ExamSchedule.findOne(scopeBySchool(schoolId, { _id: schedule._id }))
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

      // Explicit field assignment to prevent overwriting protected fields
      // (status, generatedExamIds, schoolId, createdBy, etc.)
      const allowedFields = [
        'name',
        'type',
        'classIds',
        'startDate',
        'endDate',
        'sessionType',
        'morningSlot',
        'afternoonSlot',
        'defaultMaxMarks',
        'defaultPassingMarks',
        'entries',
      ];
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          schedule[field] = req.body[field];
        }
      }
      if (req.body.entries !== undefined) {
        schedule.seatingVenues = [];
        schedule.seatingOptions = { shareBenches: false };
      }
      if (schedule.endDate < schedule.startDate) {
        return res.status(400).json({ error: 'End date must be on or after start date' });
      }
      if (schedule.defaultPassingMarks > schedule.defaultMaxMarks) {
        return res.status(400).json({
          error: 'Default passing marks cannot exceed default maximum marks',
        });
      }
      await validateScheduleReferences(schoolId, schedule.classIds, schedule.entries || []);
      const conflicts = await checkScheduleConflicts(
        schoolId,
        schedule.classIds,
        schedule.startDate,
        schedule.endDate,
        schedule._id
      );
      if (conflicts.length > 0) {
        return res.status(409).json({
          error: 'Schedule overlaps with existing confirmed exam schedules for the same class(es)',
          conflicts,
        });
      }
      await schedule.save();

      const populated = await ExamSchedule.findOne(scopeBySchool(schoolId, { _id: schedule._id }))
        .populate('classIds', 'name section subjects')
        .lean();

      res.json(populated);
    } catch (error) {
      console.error('Error updating exam schedule:', error);
      if (error.statusCode) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

// POST /exam-schedules/:id/seat - Generate exam seating across venues
// Venues = configured exam halls PLUS each participating class's own classroom.
// One student per bench by default; pass { shareBenches: true } to let
// double-seater benches hold two. Only valid for a schedule that has generated
// timetable entries. Idempotent: re-running replaces prior seating for every entry.
router.post(
  '/exam-schedules/:id/seat',
  checkPermission('academics', 'create'),
  validateZod(seatExamScheduleSchema),
  async (req, res) => {
    try {
      const shareBenches = !!req.body?.shareBenches;
      const schoolId = await resolveRequestSchoolId(req);
      const schedule = await ExamSchedule.findOne(
        scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
      )
        .populate('classIds', 'name section room block strengthLimit')
        .lean();

      if (!schedule) return res.status(404).json({ error: 'Exam schedule not found' });
      if (!schedule.entries || schedule.entries.length === 0) {
        return res.status(400).json({ error: 'Generate a timetable before seating' });
      }

      // Load active halls (sorted for deterministic layout: block then name).
      const halls = await ExamHall.find(
        scopeBySchool(schoolId, { isDeleted: { $ne: true }, isActive: { $ne: false } })
      )
        .sort({ block: 1, name: 1 })
        .lean();

      // Build the venue pool: dedicated halls first, then participating classrooms.
      const hallVenues = halls.map((h) => ({
        _id: String(h._id),
        name: h.name,
        block: h.block || '',
        kind: 'hall',
        benchCapacity: h.benchCapacity || 2,
        rows: h.rows || 1,
        columns: h.columns || 1,
        capacity: h.capacity,
      }));
      const classroomVenues = buildClassroomVenues(schedule.classIds || []);
      const venues = [...hallVenues, ...classroomVenues];

      // Gather every distinct classId across entries and load their students once.
      const allClassIds = new Set();
      schedule.entries.forEach((e) => {
        (e.classIds || []).forEach((cid) =>
          allClassIds.add(String(typeof cid === 'object' ? cid._id : cid))
        );
      });
      const classIdsArr = Array.from(allClassIds);
      const students = await Student.find(
        scopeBySchool(schoolId, {
          classId: { $in: classIdsArr },
          isDeleted: { $ne: true },
        })
      )
        .select('_id name classId rollNo')
        .lean();

      // Index students by classId, attaching class display info.
      const classNameById = new Map();
      schedule.classIds.forEach((c) => classNameById.set(String(c._id), c));
      const studentsByClass = new Map();
      for (const s of students) {
        const key = String(s.classId);
        if (!studentsByClass.has(key)) studentsByClass.set(key, []);
        const cls = classNameById.get(key);
        studentsByClass.get(key).push({
          ...s,
          className: cls?.name || '',
          section: cls?.section || '',
        });
      }

      // Run the pure seating generator.
      const { perEntry, warnings } = generateScheduleSeating(
        schedule.entries,
        studentsByClass,
        venues,
        {
          shareBenches,
        }
      );

      // Snapshot the venues actually used, so the seat map survives a reload.
      const usedVenueIds = new Set();
      perEntry.forEach((r) => r.seating.forEach((seat) => usedVenueIds.add(String(seat.hallId))));
      const seatingVenues = venues
        .filter((v) => usedVenueIds.has(String(v._id)))
        .map((v) => ({
          venueId: String(v._id),
          name: v.name,
          kind: v.kind,
          block: v.block || '',
          rows: v.rows,
          columns: v.columns,
          benchCapacity: v.benchCapacity,
          capacity: v.capacity,
        }));

      // Persist seating onto each entry (positional update by entry _id), plus
      // the seating options + venue snapshot on the schedule itself.
      const updates = schedule.entries.map((entry) => ({
        updateOne: {
          filter: scopeBySchool(schoolId, { _id: schedule._id, 'entries._id': entry._id }),
          update: { $set: { 'entries.$.seating': perEntry.get(String(entry._id))?.seating || [] } },
        },
      }));
      updates.push({
        updateOne: {
          filter: { _id: schedule._id },
          update: { $set: { 'seatingOptions.shareBenches': shareBenches, seatingVenues } },
        },
      });
      if (updates.length > 0) await ExamSchedule.bulkWrite(updates);

      const populated = await ExamSchedule.findOne(scopeBySchool(schoolId, { _id: schedule._id }))
        .populate('classIds', 'name section subjects')
        .lean();

      // Stats summary for the response.
      const totalSeated = Array.from(perEntry.values()).reduce((n, r) => n + r.stats.seated, 0);
      const totalStudents = Array.from(perEntry.values()).reduce((n, r) => n + r.stats.total, 0);

      res.json({
        ...populated,
        seatingVenues,
        seatingStats: {
          halls: seatingVenues.length,
          venues: seatingVenues.length,
          classrooms: seatingVenues.filter((v) => v.kind === 'classroom').length,
          entries: schedule.entries.length,
          totalSeated,
          totalStudents,
          shareBenches,
        },
        warnings,
      });
    } catch (error) {
      console.error('Error generating exam seating:', error);
      if (error.code === 'NOT_ENOUGH_SEATS' || error.code === 'NO_HALLS') {
        return res.status(400).json({ error: error.message, code: error.code });
      }
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

// POST /exam-schedules/:id/confirm - Confirm schedule and create individual Exam documents
router.post(
  '/exam-schedules/:id/confirm',
  checkPermission('academics', 'create'),
  validateZod(emptyExamScheduleActionSchema),
  async (req, res) => {
    const mongoSession = await mongoose.startSession();
    try {
      const schoolId = await resolveRequestSchoolId(req);
      let scheduleId;
      await mongoSession.withTransaction(async () => {
        const schedule = await ExamSchedule.findOne(
          scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
        ).session(mongoSession);

        if (!schedule) {
          const error = new Error('Exam schedule not found');
          error.statusCode = 404;
          throw error;
        }
        if (schedule.status !== 'draft') {
          const error = new Error('Schedule is already confirmed');
          error.statusCode = 400;
          throw error;
        }
        if (!schedule.entries || schedule.entries.length === 0) {
          const error = new Error('Generate a timetable before confirming');
          error.statusCode = 400;
          throw error;
        }

        const classes = await validateScheduleReferences(
          schoolId,
          schedule.classIds,
          schedule.entries,
          mongoSession
        );
        const conflicts = await checkScheduleConflicts(
          schoolId,
          schedule.classIds,
          schedule.startDate,
          schedule.endDate,
          schedule._id
        );
        if (conflicts.length > 0) {
          const error = new Error(
            'Schedule overlaps with existing confirmed exam schedules for the same class(es)'
          );
          error.statusCode = 409;
          error.conflicts = conflicts;
          throw error;
        }

        const examDocs = [];
        for (const cls of classes) {
          const classEntries = schedule.entries.filter((entry) =>
            entry.classIds.some((id) => String(id) === String(cls._id))
          );
          if (classEntries.length === 0) continue;
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
          examDocs.push({
            schoolId,
            name: schedule.name,
            type: schedule.type,
            classId: cls._id,
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
        }
        if (examDocs.length === 0) {
          const error = new Error('The schedule has no valid class exam entries');
          error.statusCode = 400;
          throw error;
        }

        const generatedExams = await Exam.create(examDocs, {
          session: mongoSession,
          ordered: true,
        });
        schedule.generatedExamIds = generatedExams.map((exam) => exam._id);
        schedule.status = 'scheduled';
        await schedule.save({ session: mongoSession });
        scheduleId = schedule._id;
      });

      const populated = await ExamSchedule.findOne(scopeBySchool(schoolId, { _id: scheduleId }))
        .populate('classIds', 'name section subjects')
        .populate('generatedExamIds', 'name classId status')
        .lean();

      res.json(populated);
    } catch (error) {
      console.error('Error confirming exam schedule:', error);
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          error: error.message,
          ...(error.conflicts ? { conflicts: error.conflicts } : {}),
        });
      }
      if (error.code === 11000) {
        return res.status(409).json({
          error:
            'An exam with this name already exists for one of the selected classes. Please use a different schedule name.',
        });
      }
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    } finally {
      await mongoSession.endSession();
    }
  }
);

// POST /exam-schedules/:id/send - Send timetable to parents
router.post(
  '/exam-schedules/:id/send',
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

      // Find parents linked to these students (scoped by schoolId)
      if (studentIds.length > 0) {
        const parents = await Parent.find(
          scopeBySchool(schoolId, {
            'children.studentId': { $in: studentIds },
          })
        ).select('_id');

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
router.delete('/exam-schedules/:id', checkPermission('academics', 'delete'), async (req, res) => {
  const mongoSession = await mongoose.startSession();
  try {
    const schoolId = await resolveRequestSchoolId(req);
    const cascadeDeletedAt = new Date();
    await mongoSession.withTransaction(async () => {
      const schedule = await ExamSchedule.findOne(
        scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
      ).session(mongoSession);

      if (!schedule) {
        const error = new Error('Exam schedule not found');
        error.statusCode = 404;
        throw error;
      }

      const scheduleSnapshot = schedule.toObject();
      schedule.isDeleted = true;
      schedule.deletedAt = cascadeDeletedAt;
      await schedule.save({ session: mongoSession });

      const generatedExamIds = schedule.generatedExamIds || [];
      if (generatedExamIds.length > 0) {
        // Preserve older, independently deleted children by archiving only
        // currently-active records with this operation's exact marker.
        await Exam.updateMany(
          scopeBySchool(schoolId, {
            _id: { $in: generatedExamIds },
            isDeleted: { $ne: true },
          }),
          { $set: { isDeleted: true, deletedAt: cascadeDeletedAt } },
          { session: mongoSession }
        );
        await Result.updateMany(
          scopeBySchool(schoolId, {
            examId: { $in: generatedExamIds },
            isDeleted: { $ne: true },
          }),
          { $set: { isDeleted: true, deletedAt: cascadeDeletedAt } },
          { session: mongoSession }
        );
      }

      await logToTrash({
        itemType: 'ExamSchedule',
        itemId: schedule._id,
        itemName: scheduleSnapshot.name || 'Exam Schedule',
        originalData: scheduleSnapshot,
        deletedBy: req.user?.id || req.user?._id,
        schoolId,
        deletionContext: { cascadeDeletedAt },
        session: mongoSession,
      });
    });

    res.json({ message: 'Exam schedule deleted successfully' });
  } catch (error) {
    console.error('Error deleting exam schedule:', error);
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    res.status(500).json({ error: 'An internal error occurred. Please try again.' });
  } finally {
    await mongoSession.endSession();
  }
});

export default router;
