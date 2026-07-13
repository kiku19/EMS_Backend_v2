/**
 * @swagger
 * tags:
 *   name: Timetable
 *   description: Class timetable management — generate, view, and update weekly schedules
 */

/**
 * @swagger
 * /timetable:
 *   get:
 *     summary: List all timetables for the school
 *     tags: [Timetable]
 *     parameters:
 *       - $ref: '#/components/parameters/AcademicYearQuery'
 *     responses:
 *       200:
 *         description: Array of timetables, each with classId populated
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *   post:
 *     summary: Create a timetable for a class
 *     tags: [Timetable]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [classId]
 *             properties:
 *               classId:
 *                 $ref: '#/components/schemas/ObjectId'
 *               academicYear:
 *                 $ref: '#/components/schemas/AcademicYear'
 *               periods:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                     startTime:
 *                       type: string
 *                       example: '09:00'
 *                     endTime:
 *                       type: string
 *                       example: '09:45'
 *                     isBreak:
 *                       type: boolean
 *               schedule:
 *                 type: object
 *                 description: Day → period slot assignments (Monday…Sunday; UI uses configured school working days)
 *     responses:
 *       201:
 *         description: Timetable created
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @swagger
 * /timetable/generate-all:
 *   post:
 *     summary: Auto-generate timetables for all classes
 *     description: Creates or regenerates schedules for every class, distributing subjects across periods while avoiding teacher double-booking.
 *     tags: [Timetable]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               academicYear:
 *                 $ref: '#/components/schemas/AcademicYear'
 *               periodRules:
 *                 type: object
 *                 description: Optional custom period configuration
 *     responses:
 *       200:
 *         description: Generation results with per-class success/error breakdown
 *       404:
 *         description: No classes found
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @swagger
 * /timetable/{classId}:
 *   get:
 *     summary: Get timetable for a specific class
 *     tags: [Timetable]
 *     parameters:
 *       - in: path
 *         name: classId
 *         required: true
 *         schema:
 *           $ref: '#/components/schemas/ObjectId'
 *       - $ref: '#/components/parameters/AcademicYearQuery'
 *     responses:
 *       200:
 *         description: Class timetable with period and schedule data
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   put:
 *     summary: Replace an entire class timetable
 *     tags: [Timetable]
 *     parameters:
 *       - in: path
 *         name: classId
 *         required: true
 *         schema:
 *           $ref: '#/components/schemas/ObjectId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               periods:
 *                 type: array
 *                 items:
 *                   type: object
 *               schedule:
 *                 type: object
 *     responses:
 *       200:
 *         description: Updated timetable
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   delete:
 *     summary: Delete a class timetable
 *     tags: [Timetable]
 *     parameters:
 *       - in: path
 *         name: classId
 *         required: true
 *         schema:
 *           $ref: '#/components/schemas/ObjectId'
 *     responses:
 *       200:
 *         description: Timetable deleted
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @swagger
 * /timetable/{classId}/slot:
 *   put:
 *     summary: Update a single period slot in a class timetable
 *     tags: [Timetable]
 *     parameters:
 *       - in: path
 *         name: classId
 *         required: true
 *         schema:
 *           $ref: '#/components/schemas/ObjectId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [day, periodIndex]
 *             properties:
 *               day:
 *                 type: string
 *                 enum: [Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday]
 *               periodIndex:
 *                 type: integer
 *               subject:
 *                 type: string
 *               teacherId:
 *                 $ref: '#/components/schemas/ObjectId'
 *               room:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated slot
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @swagger
 * /timetable/{classId}/batch:
 *   post:
 *     summary: Batch update multiple period slots for a class
 *     tags: [Timetable]
 *     parameters:
 *       - in: path
 *         name: classId
 *         required: true
 *         schema:
 *           $ref: '#/components/schemas/ObjectId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [slots]
 *             properties:
 *               slots:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     day:
 *                       type: string
 *                     periodIndex:
 *                       type: integer
 *                     subject:
 *                       type: string
 *                     teacherId:
 *                       $ref: '#/components/schemas/ObjectId'
 *     responses:
 *       200:
 *         description: Batch update result
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @swagger
 * /timetable/{classId}/periods:
 *   put:
 *     summary: Update period definitions (time slots) for a class timetable
 *     tags: [Timetable]
 *     parameters:
 *       - in: path
 *         name: classId
 *         required: true
 *         schema:
 *           $ref: '#/components/schemas/ObjectId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [periods]
 *             properties:
 *               periods:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                     startTime:
 *                       type: string
 *                     endTime:
 *                       type: string
 *                     isBreak:
 *                       type: boolean
 *     responses:
 *       200:
 *         description: Periods updated
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */

import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';
import { SCHEDULE_DAYS, resolveWorkingScheduleDays } from '../utils/weekdays.js';
import express from 'express';
import mongoose from 'mongoose';
import { Timetable, Class, Staff, SchoolSettings } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import {
  validate,
  schemas,
  validateZod,
  zodSchemas,
  validateObjectIdParam,
} from '../middleware/validation.js';
import { extractSchoolId, ensureDefaultSchool } from '../utils/schoolContext.js';
import timetableService from '../services/timetableService.js';
import conflictDetectionService from '../services/conflictDetectionService.js';
import { TeacherTimetable } from '../database.js';
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

async function validateClassScheduleAssignments({ schoolId, classData, schedule, academicYear }) {
  if (!schedule) return;
  const teacherIds = new Set();
  for (const day of SCHEDULE_DAYS) {
    for (const slot of schedule[day] || []) {
      if (slot.subject && !(classData.subjects || []).includes(slot.subject)) {
        const error = new Error(`Subject "${slot.subject}" is not configured for this class`);
        error.statusCode = 400;
        throw error;
      }
      if (slot.teacherId) {
        if (!slot.subject) {
          const error = new Error('A teacher assignment requires a subject');
          error.statusCode = 400;
          throw error;
        }
        teacherIds.add(String(slot.teacherId));
      }
    }
  }
  if (teacherIds.size === 0) return;
  const teachers = await Staff.find(
    scopeBySchool(schoolId, {
      _id: { $in: [...teacherIds] },
      isDeleted: { $ne: true },
    })
  ).select('_id name teacherAssignments');
  if (teachers.length !== teacherIds.size) {
    const error = new Error('One or more selected teachers were not found in this school');
    error.statusCode = 400;
    throw error;
  }
  const teacherById = new Map(teachers.map((teacher) => [String(teacher._id), teacher]));
  for (const day of SCHEDULE_DAYS) {
    const slots = schedule[day] || [];
    for (let periodIndex = 0; periodIndex < slots.length; periodIndex++) {
      const slot = slots[periodIndex];
      if (!slot.teacherId) continue;
      const teacher = teacherById.get(String(slot.teacherId));
      const assigned = (teacher.teacherAssignments || []).some(
        (assignment) =>
          assignment.subject === slot.subject &&
          (assignment.classes || []).some((id) => String(id) === String(classData._id))
      );
      if (!assigned) {
        const error = new Error(
          `${teacher.name || 'Teacher'} is not assigned to teach ${slot.subject} in this class`
        );
        error.statusCode = 400;
        throw error;
      }
      const conflict = await conflictDetectionService.checkTeacherConflict(
        slot.teacherId,
        day,
        periodIndex,
        classData._id,
        true,
        schoolId,
        academicYear
      );
      if (conflict) {
        const error = new Error(
          `${teacher.name || 'Teacher'} is already assigned at ${day} period ${periodIndex + 1}`
        );
        error.statusCode = 409;
        error.conflict = conflict;
        throw error;
      }
    }
  }
}

async function captureTimetableSnapshot(schoolId, academicYear) {
  const [classTimetables, teacherTimetables] = await Promise.all([
    Timetable.find(scopeBySchool(schoolId, { academicYear })).lean(),
    TeacherTimetable.find(scopeBySchool(schoolId, { academicYear })).lean(),
  ]);
  return { classTimetables, teacherTimetables };
}

async function restoreTimetableSnapshot(schoolId, academicYear, snapshot) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Promise.all([
        Timetable.deleteMany(scopeBySchool(schoolId, { academicYear }), { session }),
        TeacherTimetable.deleteMany(scopeBySchool(schoolId, { academicYear }), { session }),
      ]);
      if (snapshot.classTimetables.length > 0) {
        await Timetable.insertMany(snapshot.classTimetables, { session, ordered: true });
      }
      if (snapshot.teacherTimetables.length > 0) {
        await TeacherTimetable.insertMany(snapshot.teacherTimetables, {
          session,
          ordered: true,
        });
      }
    });
  } finally {
    await session.endSession();
  }
}

/**
 * True if a thrown error is a MongoDB duplicate-key violation (E11000).
 * Mongoose surfaces these as MongoServerError (single insert) or
 * MongoBulkWriteError (bulk/insertMany), and the code lives at the top level
 * for the former and in writeErrors for the latter.
 */
function isDuplicateKeyError(err) {
  if (!err) return false;
  if (err.code === 11000 || err.code === 11001) return true;
  if (
    Array.isArray(err.writeErrors) &&
    err.writeErrors.some((e) => e?.code === 11000 || e?.err?.code === 11000)
  ) {
    return true;
  }
  return false;
}

/**
 * Atomically find-or-create a Timetable for a given class + academic year.
 *
 * The previous pattern (`findOne` → if missing `new Timetable().save()`) is a
 * classic check-then-act race: two concurrent writes (e.g. the wizard's
 * "Generate" firing while a per-slot save lands, or two Generate calls) both
 * see `null`, both insert, and you end up with duplicate Timetable documents
 * per class+year. If the unique index { schoolId, classId, academicYear }
 * wasn't created in MongoDB (common when autoIndex is off in prod), nothing
 * stops the second insert.
 *
 * `findOneAndUpdate({ ...uniqueKey }, { $setOnInsert: defaults }, { upsert: true })`
 * is a single atomic operation — only one concurrent caller wins the insert,
 * the rest update the same doc. The `$setOnInsert` operator ensures defaults
 * are applied ONLY on insert, never clobbering an existing timetable's data.
 *
 * @returns {Promise<TimetableDocument>}
 */
async function findOrCreateTimetable({ schoolId, classId, academicYear, periods, schedule }) {
  const filter = scopeBySchool(schoolId, { classId, academicYear, isDeleted: { $ne: true } });
  const setOnInsert = {
    schoolId: extractSchoolId(schoolId),
    classId,
    academicYear,
    periods: periods || [],
    schedule: schedule || {
      Monday: [],
      Tuesday: [],
      Wednesday: [],
      Thursday: [],
      Friday: [],
      Saturday: [],
      Sunday: [],
    },
  };
  return Timetable.findOneAndUpdate(
    filter,
    { $setOnInsert: setOnInsert },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

// IMPORTANT: More specific routes must be defined BEFORE parameterized routes (:classId)
// Otherwise, /generate-all would be matched by /:classId

/**
 * GET /api/timetable
 * Get all timetables for school
 * Query params: academicYear (optional, defaults to CURRENT_ACADEMIC_YEAR)
 */
router.get('/', checkPermission('classes', 'view'), async (req, res) => {
  try {
    const { academicYear = CURRENT_ACADEMIC_YEAR } = req.query;

    const all = await Timetable.find(
      scopeBySchool(req.user?.schoolId, { academicYear, isDeleted: { $ne: true } })
    )
      .populate('classId', 'name section teacher')
      .sort({ 'classId.name': 1, 'classId.section': 1 });

    // Defensive collapse: in case duplicate Timetable documents per
    // class+year exist in the DB (from a pre-fix race before the unique index
    // was enforced), keep only the most-recently-synced one per classId so the
    // UI never shows 2 timetables for the same class. The dedup migration
    // (008_timetable_dedupe) cleans this up at the source.
    const seen = new Map();
    for (const tt of all) {
      const key = String(tt.classId?._id || tt.classId || '');
      if (!key) continue;
      const prev = seen.get(key);
      if (!prev) {
        seen.set(key, tt);
      } else {
        // Prefer the one with the latest lastSyncedAt (fallback updatedAt).
        const a = new Date(prev.lastSyncedAt || prev.updatedAt || 0).getTime();
        const b = new Date(tt.lastSyncedAt || tt.updatedAt || 0).getTime();
        if (b > a) seen.set(key, tt);
      }
    }

    res.json([...seen.values()]);
  } catch (error) {
    console.error('Error fetching all timetables:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/timetable/generate-all
 * Generate/regenerate timetables for all classes
 */
router.post(
  '/generate-all',
  checkPermission('classes', 'edit'),
  validateZod(zodSchemas.generateAll),
  async (req, res) => {
    let rollbackSnapshot = null;
    let rollbackSchoolId = null;
    let rollbackAcademicYear = null;
    try {
      const { academicYear = CURRENT_ACADEMIC_YEAR, periodRules } = req.body;

      const resolvedSchoolId = await resolveRequestSchoolId(req);
      // Load the generation inputs once. Previously every class triggered its
      // own Staff query, creating a linear N+1 slowdown on larger schools.
      const [classes, settings, assignedStaff] = await Promise.all([
        Class.find(scopeBySchool(resolvedSchoolId, { isDeleted: { $ne: true } })).sort({
          name: 1,
          section: 1,
        }),
        SchoolSettings.findOne(scopeBySchool(resolvedSchoolId, {})).select('workingDays').lean(),
        Staff.find(
          scopeBySchool(resolvedSchoolId, {
            isDeleted: { $ne: true },
            'teacherAssignments.0': { $exists: true },
          })
        )
          .select('_id teacherAssignments')
          .lean(),
      ]);
      const generationDays = resolveWorkingScheduleDays(settings?.workingDays);

      if (classes.length === 0) {
        return res.status(404).json({ error: 'No classes found' });
      }

      const classesWithoutSubjects = classes.filter(
        (cls) => !Array.isArray(cls.subjects) || cls.subjects.length === 0
      );
      if (classesWithoutSubjects.length > 0) {
        return res.status(422).json({
          error: 'Generation was not started because some classes have no subjects',
          classes: classesWithoutSubjects.map((cls) => ({
            classId: cls._id,
            className: `${cls.name}-${cls.section}`,
          })),
        });
      }

      rollbackSchoolId = resolvedSchoolId;
      rollbackAcademicYear = academicYear;
      rollbackSnapshot = await captureTimetableSnapshot(rollbackSchoolId, academicYear);

      const results = [];
      const errors = [];

      // Default periods if not provided
      const defaultPeriods = [
        { name: 'Period 1', startTime: '08:00', endTime: '08:45', isBreak: false },
        { name: 'Period 2', startTime: '08:45', endTime: '09:30', isBreak: false },
        { name: 'Break', startTime: '09:30', endTime: '09:45', isBreak: true },
        { name: 'Period 3', startTime: '09:45', endTime: '10:30', isBreak: false },
        { name: 'Period 4', startTime: '10:30', endTime: '11:15', isBreak: false },
        { name: 'Lunch', startTime: '11:15', endTime: '12:00', isBreak: true },
        { name: 'Period 5', startTime: '12:00', endTime: '12:45', isBreak: false },
        { name: 'Period 6', startTime: '12:45', endTime: '13:30', isBreak: false },
      ];

      // Track teacher busy slots across all classes to prevent double-booking
      const globalTeacherBusy = {};
      // Track what each teacher is teaching at each busy slot for conflict descriptions
      const globalTeacherBusyClass = {}; // teacherId → day → periodIdx → { className, subject }

      for (const cls of classes) {
        try {
          // Atomically find-or-create to avoid duplicate Timetable documents
          // under concurrent generate calls (see findOrCreateTimetable).
          const timetable = await findOrCreateTimetable({
            schoolId: resolvedSchoolId,
            classId: cls._id,
            academicYear,
            periods: defaultPeriods,
            schedule: {
              Monday: [],
              Tuesday: [],
              Wednesday: [],
              Thursday: [],
              Friday: [],
              Saturday: [],
              Sunday: [],
            },
          });

          // Generate schedule using same logic as wizard
          const days = generationDays;
          const periods = timetable.periods || defaultPeriods;

          // Collect conflict descriptions for this class
          const classConflicts = [];

          // Initialize empty schedule
          const schedule = {};
          SCHEDULE_DAYS.forEach((day) => {
            schedule[day] = periods.map(() => ({
              subject: '',
              teacherId: null,
              room: '',
            }));
          });

          // Get non-break periods
          const nonBreakIndices = periods
            .map((p, i) => (!p.isBreak ? i : -1))
            .filter((i) => i !== -1);

          // Track subject usage
          const subjectUsage = {};
          cls.subjects.forEach((s) => {
            subjectUsage[s] = { perDay: {}, perWeek: 0 };
            days.forEach((d) => {
              subjectUsage[s].perDay[d] = 0;
            });
          });

          const assignedTeachers = assignedStaff.filter((teacher) =>
            (teacher.teacherAssignments || []).some((assignment) =>
              (assignment.classes || []).some((classRef) => String(classRef) === String(cls._id))
            )
          );

          // Build subject → teacher map for this class
          const subjectTeacherMap = {};
          for (const teacher of assignedTeachers) {
            for (const assignment of teacher.teacherAssignments || []) {
              if (assignment.classes.some((c) => c.toString() === cls._id.toString())) {
                if (!subjectTeacherMap[assignment.subject]) {
                  subjectTeacherMap[assignment.subject] = [];
                }
                subjectTeacherMap[assignment.subject].push(teacher._id.toString());
              }
            }
          }

          // Calculate periods per subject
          const totalAvailablePeriods = nonBreakIndices.length * days.length;
          const periodsPerSubject = Math.floor(totalAvailablePeriods / cls.subjects.length);

          // Build subject pool
          const subjectPool = [];
          cls.subjects.forEach((subject) => {
            for (let i = 0; i < Math.max(1, periodsPerSubject); i++) {
              subjectPool.push(subject);
            }
          });

          // Deterministic shuffle seeded off classId + academicYear so
          // regenerating a class's timetable produces the same output.
          // Math.random() made every generation run produce a different
          // schedule — admins had no way to reproduce or diff a generation.
          const seedStr = `${cls._id.toString()}:${academicYear}`;
          let seed = 0;
          for (let i = 0; i < seedStr.length; i++) {
            seed = ((seed << 5) - seed + seedStr.charCodeAt(i)) | 0;
          }
          // mulberry32 — deterministic, fast, plenty good for shuffling
          const rng = () => {
            seed = (seed + 0x6d2b79f5) | 0;
            let t = seed;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
          };
          const shuffleArray = (arr) => {
            const shuffled = [...arr];
            for (let i = shuffled.length - 1; i > 0; i--) {
              const j = Math.floor(rng() * (i + 1));
              [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            return shuffled;
          };

          for (const day of days) {
            const pool = shuffleArray(subjectPool);

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
                  if (
                    !periods[prevPeriod]?.isBreak &&
                    schedule[day][prevPeriod]?.subject === subject
                  ) {
                    continue;
                  }
                }

                selectedSubject = subject;
                pool.splice(i, 1);
                break;
              }

              if (selectedSubject) {
                // Try to auto-assign a teacher
                let assignedTeacherId = null;
                const candidateTeachers = subjectTeacherMap[selectedSubject] || [];

                if (candidateTeachers.length === 0) {
                  classConflicts.push({
                    type: 'no_teacher_assigned',
                    day,
                    periodIndex: periodIdx,
                    subject: selectedSubject,
                    description: `No teacher is assigned to teach "${selectedSubject}" in class ${cls.name}-${cls.section}`,
                  });
                } else {
                  for (const tId of candidateTeachers) {
                    if (!globalTeacherBusy[tId]) globalTeacherBusy[tId] = {};
                    if (!globalTeacherBusy[tId][day]) globalTeacherBusy[tId][day] = new Set();
                    if (!globalTeacherBusy[tId][day].has(periodIdx)) {
                      assignedTeacherId = tId;
                      globalTeacherBusy[tId][day].add(periodIdx);
                      if (!globalTeacherBusyClass[tId]) globalTeacherBusyClass[tId] = {};
                      if (!globalTeacherBusyClass[tId][day]) globalTeacherBusyClass[tId][day] = {};
                      globalTeacherBusyClass[tId][day][periodIdx] = {
                        className: `${cls.name}-${cls.section}`,
                        subject: selectedSubject,
                      };
                      break;
                    }
                  }

                  if (!assignedTeacherId) {
                    const conflictDetails = candidateTeachers.map((tId) => {
                      const busyInfo = globalTeacherBusyClass[tId]?.[day]?.[periodIdx];
                      return busyInfo
                        ? `already teaching "${busyInfo.subject}" in class ${busyInfo.className}`
                        : 'already occupied';
                    });
                    classConflicts.push({
                      type: 'teacher_conflict',
                      day,
                      periodIndex: periodIdx,
                      subject: selectedSubject,
                      description: `All ${candidateTeachers.length} teacher(s) for "${selectedSubject}" are unavailable on ${day} period ${periodIdx + 1}: ${conflictDetails.join('; ')}`,
                    });
                  }
                }

                schedule[day][periodIdx] = {
                  subject: selectedSubject,
                  teacherId: assignedTeacherId,
                  room: `Room ${cls.name.replace('Class ', '')}-${cls.section}`,
                };

                subjectUsage[selectedSubject].perDay[day]++;
                subjectUsage[selectedSubject].perWeek++;
              } else {
                classConflicts.push({
                  type: 'subject_pool_exhausted',
                  day,
                  periodIndex: periodIdx,
                  description: `No eligible subject could be assigned to period ${periodIdx + 1} on ${day} — all subjects reached their daily/weekly limit or consecutive-period constraint`,
                });
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
            success: true,
            conflicts: classConflicts,
            conflictCount: classConflicts.length,
          });
        } catch (err) {
          console.error(`Error generating timetable for class ${cls.name}-${cls.section}:`, err);
          throw new Error(`Generation failed for ${cls.name}-${cls.section}: ${err.message}`, {
            cause: err,
          });
        }
      }

      // --- Sync TeacherTimetable documents from generated class timetables ---
      try {
        const days = SCHEDULE_DAYS;

        // AUDIT-328: Clean up all existing TeacherTimetable docs before rebuilding
        await TeacherTimetable.deleteMany(scopeBySchool(resolvedSchoolId, { academicYear }));

        // Reload all generated timetables (exclude soft-deleted)
        const allTimetables = await Timetable.find(
          scopeBySchool(req.user?.schoolId, { academicYear, isDeleted: { $ne: true } })
        ).lean();

        // Build teacher → schedule map
        const teacherScheduleMap = {}; // teacherId → { Monday: [...], ... }
        for (const tt of allTimetables) {
          for (const day of days) {
            const slots = tt.schedule?.[day] || [];
            slots.forEach((slot, idx) => {
              if (slot.teacherId) {
                const tid = slot.teacherId.toString();
                if (!teacherScheduleMap[tid]) {
                  teacherScheduleMap[tid] = {};
                  days.forEach((d) => {
                    teacherScheduleMap[tid][d] = [];
                  });
                }
                teacherScheduleMap[tid][day].push({
                  periodIndex: idx,
                  classId: tt.classId,
                  subject: slot.subject || '',
                  room: slot.room || '',
                  lastModified: new Date(),
                });
              }
            });
          }
        }

        // Upsert TeacherTimetable for each teacher
        const teacherTimetableOps = Object.entries(teacherScheduleMap).map(
          ([teacherId, schedule]) => {
            const totalPeriods = days.reduce((sum, d) => sum + schedule[d].length, 0);
            return {
              updateOne: {
                filter: { schoolId: resolvedSchoolId, teacherId, academicYear },
                update: {
                  $set: {
                    schedule,
                    totalPeriodsPerWeek: totalPeriods,
                    lastSyncedAt: new Date(),
                  },
                  $inc: { version: 1 },
                  $setOnInsert: { schoolId: resolvedSchoolId, teacherId, academicYear },
                },
                upsert: true,
              },
            };
          }
        );
        if (teacherTimetableOps.length > 0) {
          await TeacherTimetable.bulkWrite(teacherTimetableOps, { ordered: true });
        }
        const syncedTeachers = teacherTimetableOps.length;

        res.json({
          success: true,
          generated: results.length,
          syncedTeachers,
          errorCount: errors.length,
          totalConflicts: results.reduce((sum, r) => sum + (r.conflictCount || 0), 0),
          results,
          errors,
        });
      } catch (syncError) {
        throw new Error(`Teacher timetable rebuild failed: ${syncError.message}`, {
          cause: syncError,
        });
      }
    } catch (error) {
      console.error('Error generating all timetables:', error);
      if (rollbackSnapshot && rollbackSchoolId && rollbackAcademicYear) {
        try {
          await restoreTimetableSnapshot(rollbackSchoolId, rollbackAcademicYear, rollbackSnapshot);
        } catch (rollbackError) {
          console.error('Timetable generation rollback failed:', rollbackError);
          return res.status(500).json({
            error: 'Timetable generation failed and automatic rollback also failed',
            details: rollbackError.message,
          });
        }
      }
      res.status(500).json({
        error: 'No timetable changes were kept because generation could not be completed',
        details: error.message,
      });
    }
  }
);

/**
 * GET /api/timetable/:classId
 * Get timetable for a class
 * Query params: academicYear (optional, defaults to CURRENT_ACADEMIC_YEAR)
 */
router.get(
  '/:classId',
  checkPermission('classes', 'view'),
  validateObjectIdParam('classId'),
  async (req, res) => {
    try {
      const { classId } = req.params;
      const { academicYear = CURRENT_ACADEMIC_YEAR } = req.query;

      const timetable = await Timetable.findOne(
        scopeBySchool(req.user?.schoolId, { classId, academicYear, isDeleted: { $ne: true } })
      );

      if (!timetable) {
        return res.status(404).json({ error: 'Timetable not found for this class' });
      }

      res.json(timetable);
    } catch (error) {
      console.error('Error fetching timetable:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * POST /api/timetable
 * Create new timetable
 */
router.post(
  '/',
  checkPermission('classes', 'edit'),
  validateZod(zodSchemas.createTimetable),
  async (req, res) => {
    try {
      const { classId, academicYear = CURRENT_ACADEMIC_YEAR, periods, schedule } = req.body;

      // Validate class exists
      const classData = await Class.findOne(
        scopeBySchool(req.user?.schoolId, { _id: classId, isDeleted: { $ne: true } })
      );
      if (!classData) {
        return res.status(404).json({ error: req.t('common:errors.classNotFound') });
      }
      const resolvedSchoolId = await resolveRequestSchoolId(req);
      await validateClassScheduleAssignments({
        schoolId: resolvedSchoolId,
        classData,
        schedule,
        academicYear,
      });

      // Reject if a non-deleted timetable already exists for this class+year.
      const existing = await Timetable.findOne(
        scopeBySchool(req.user?.schoolId, { classId, academicYear, isDeleted: { $ne: true } })
      );
      if (existing) {
        return res
          .status(400)
          .json({ error: 'Timetable already exists for this class and academic year' });
      }

      const timetable = new Timetable({
        classId,
        academicYear,
        schoolId: resolvedSchoolId,
        periods: periods || [],
        schedule: schedule || {
          Monday: [],
          Tuesday: [],
          Wednesday: [],
          Thursday: [],
          Friday: [],
          Saturday: [],
          Sunday: [],
        },
      });

      const mongoSession = await mongoose.startSession();
      try {
        await mongoSession.withTransaction(async () => {
          await timetable.save({ session: mongoSession });
          if (schedule) {
            for (const day of SCHEDULE_DAYS) {
              const slots = schedule[day] || [];
              for (let periodIndex = 0; periodIndex < slots.length; periodIndex++) {
                const slot = slots[periodIndex];
                if (!slot?.teacherId) continue;
                await timetableService.syncTimetables({
                  sourceType: 'class',
                  sourceId: classId,
                  day,
                  periodIndex,
                  slotData: slot,
                  academicYear,
                  modifiedBy: req.user?.id,
                  schoolId: resolvedSchoolId,
                  session: mongoSession,
                });
              }
            }
          }
        });
      } catch (err) {
        // E11000 = unique-index violation. A concurrent create beat us to it;
        // surface the same friendly 400 the explicit check above would have.
        if (isDuplicateKeyError(err)) {
          return res
            .status(400)
            .json({ error: 'Timetable already exists for this class and academic year' });
        }
        throw err;
      } finally {
        await mongoSession.endSession();
      }

      // Populate class info for response
      timetable.$session(null);
      await timetable.populate('classId', 'name section');

      const io = req.app.get('io');
      emitEvent(io, EVENTS.TIMETABLE_UPDATED, {
        schoolId: timetable.schoolId?.toString(),
        classId: classId?.toString(),
        academicYear,
      });

      res.status(201).json(timetable);
    } catch (error) {
      console.error('Error creating timetable:', error);
      if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * PUT /api/timetable/:classId/slot
 * Update a single slot in timetable
 * Body: { day, periodIndex, subject, teacherId, room }
 */
router.put(
  '/:classId/slot',
  checkPermission('classes', 'edit'),
  validateObjectIdParam('classId'),
  validateZod(zodSchemas.updateSlot),
  async (req, res) => {
    try {
      const { classId } = req.params;
      const {
        day,
        periodIndex,
        subject,
        teacherId,
        room,
        academicYear = CURRENT_ACADEMIC_YEAR,
      } = req.body;

      // Validate teacher if provided
      if (teacherId) {
        const teacher = await Staff.findOne(scopeBySchool(req.user?.schoolId, { _id: teacherId }));
        if (!teacher) {
          return res.status(404).json({ error: 'Teacher not found' });
        }

        // Check for teacher double-booking at this day/period across other classes
        const conflict = await conflictDetectionService.checkTeacherConflict(
          teacherId,
          day,
          periodIndex,
          classId, // exclude current class from conflict check
          true, // skip debounce for immediate server-side check
          req.user?.schoolId,
          academicYear
        );
        if (conflict) {
          return res.status(422).json({
            error: 'Teacher already has class at this time',
            type: 'ConflictError',
            details: {
              teacherName: conflict.teacherName,
              conflictingClass: conflict.conflicts[0]?.className,
              day: conflict.day,
              periodIndex: conflict.periodIndex,
            },
          });
        }
      }

      // Find timetable
      const timetable = await Timetable.findOne(
        scopeBySchool(req.user?.schoolId, { classId, academicYear })
      );
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
          modifiedBy: req.user?.id,
        });
      }

      // Use timetableService to sync both class and teacher timetables
      try {
        await timetableService.syncTimetables({
          sourceType: 'class',
          sourceId: classId,
          day,
          periodIndex,
          slotData: {
            subject: subject || '',
            teacherId: teacherId || null,
            room: room || '',
          },
          academicYear,
          modifiedBy: req.user?.id,
          schoolId: req.user?.schoolId,
        });
      } catch (syncError) {
        console.error(
          'Timetable sync failed — NOT falling back to unsynchronized save:',
          syncError
        );
        // Do NOT silently save only the class timetable. A partial save leaves the
        // teacher timetable out-of-sync, which is worse than a visible error.
        return res.status(syncError.statusCode || 500).json({
          error: 'Timetable synchronization failed. The slot was not updated.',
          details: syncError.message,
        });
      }

      // Reload and populate for response
      const updated = await Timetable.findOne(
        scopeBySchool(req.user?.schoolId, { classId, academicYear })
      ).populate('classId', 'name section');

      const io = req.app.get('io');
      emitEvent(io, EVENTS.TIMETABLE_UPDATED, {
        schoolId: req.user?.schoolId?.toString(),
        classId: classId?.toString(),
        academicYear,
      });

      res.json(updated);
    } catch (error) {
      console.error('Error updating timetable slot:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * POST /api/timetable/:classId/batch
 * Batch update slots in timetable
 * Body: { slots: [{ day, periodIndex, subject, teacherId, room }], academicYear }
 */
router.post(
  '/:classId/batch',
  checkPermission('classes', 'edit'),
  validateObjectIdParam('classId'),
  validateZod(zodSchemas.batchUpdateSlots),
  async (req, res) => {
    try {
      const { classId } = req.params;
      const { slots: updates, academicYear = CURRENT_ACADEMIC_YEAR } = req.body;

      // Find timetable
      const timetable = await Timetable.findOne(
        scopeBySchool(req.user?.schoolId, { classId, academicYear })
      );
      if (!timetable) {
        return res.status(404).json({ error: 'Timetable not found' });
      }

      // Pre-flight: check every slot with a teacherId for double-booking before
      // writing anything. The single-slot PUT /:classId/slot enforces this
      // (line ~832); without the same check here, batch writes could silently
      // double-book a teacher across classes.
      const conflicts = [];
      for (const update of updates) {
        const { day, periodIndex, teacherId } = update;
        if (!teacherId) continue;
        const conflict = await conflictDetectionService.checkTeacherConflict(
          teacherId,
          day,
          periodIndex,
          classId, // exclude this class from the conflict search
          true, // skipDebounce — batch write needs the immediate answer
          req.user?.schoolId,
          academicYear
        );
        if (conflict) {
          conflicts.push({ day, periodIndex, teacherId, conflict });
        }
      }
      if (conflicts.length > 0) {
        return res.status(409).json({
          error: 'Teacher double-booking detected',
          conflicts,
        });
      }

      const mongoSession = await mongoose.startSession();
      try {
        await mongoSession.withTransaction(async () => {
          for (const update of updates) {
            const { day, periodIndex, subject, teacherId, room } = update;
            await timetableService.syncTimetables({
              sourceType: 'class',
              sourceId: classId,
              day,
              periodIndex,
              slotData: {
                subject: subject || '',
                teacherId: teacherId || null,
                room: room || '',
              },
              academicYear,
              modifiedBy: req.user?.id,
              schoolId: req.user?.schoolId,
              session: mongoSession,
            });
          }
        });
      } catch (syncError) {
        console.error('Atomic timetable batch failed:', syncError);
        return res.status(409).json({
          error: 'No timetable slots were changed because the batch could not be completed',
          details: syncError.message,
        });
      } finally {
        await mongoSession.endSession();
      }

      // Reload and populate for response
      const updated = await Timetable.findOne(
        scopeBySchool(req.user?.schoolId, { classId, academicYear })
      ).populate('classId', 'name section');

      const io = req.app.get('io');
      emitEvent(io, EVENTS.TIMETABLE_UPDATED, {
        schoolId: req.user?.schoolId?.toString(),
        classId: classId?.toString(),
        academicYear,
      });

      res.json(updated);
    } catch (error) {
      console.error('Error batch updating timetable:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * PUT /api/timetable/:classId/periods
 * Update period configuration
 * Body: { periods: [{ name, startTime, endTime, isBreak }], academicYear }
 */
router.put(
  '/:classId/periods',
  checkPermission('classes', 'edit'),
  validateObjectIdParam('classId'),
  validateZod(zodSchemas.updatePeriods),
  async (req, res) => {
    try {
      const { classId } = req.params;
      const { periods, academicYear = CURRENT_ACADEMIC_YEAR } = req.body;

      const mongoSession = await mongoose.startSession();
      let timetable;
      try {
        await mongoSession.withTransaction(async () => {
          timetable = await Timetable.findOne(
            scopeBySchool(req.user?.schoolId, {
              classId,
              academicYear,
              isDeleted: { $ne: true },
            })
          ).session(mongoSession);
          if (!timetable) {
            const error = new Error('Timetable not found');
            error.statusCode = 404;
            throw error;
          }

          const oldPeriods = [...(timetable.periods || [])];
          const usedOldIndexes = new Set();
          const newToOld = periods.map((period) => {
            let oldIndex = period._id
              ? oldPeriods.findIndex((old) => String(old._id) === String(period._id))
              : -1;
            if (oldIndex < 0) {
              oldIndex = oldPeriods.findIndex(
                (old, index) =>
                  !usedOldIndexes.has(index) &&
                  old.name === period.name &&
                  old.startTime === period.startTime &&
                  old.endTime === period.endTime &&
                  Boolean(old.isBreak) === Boolean(period.isBreak)
              );
            }
            if (oldIndex >= 0) usedOldIndexes.add(oldIndex);
            return oldIndex;
          });
          const oldToNew = new Map();
          newToOld.forEach((oldIndex, newIndex) => {
            if (oldIndex >= 0) oldToNew.set(oldIndex, newIndex);
          });

          for (const day of SCHEDULE_DAYS) {
            const oldSlots = Array.isArray(timetable.schedule?.[day])
              ? timetable.schedule[day]
              : [];
            timetable.schedule[day] = newToOld.map((oldIndex) =>
              oldIndex >= 0 && oldSlots[oldIndex]
                ? oldSlots[oldIndex]
                : { subject: '', teacherId: null, room: '' }
            );
          }
          timetable.markModified('schedule');
          timetable.periods = periods;
          timetable.version += 1;
          timetable.lastSyncedAt = new Date();
          await timetable.save({ session: mongoSession });

          // Remap or remove this class's mirrored teacher slots in the same
          // transaction. Deleting a middle period must shift later indexes.
          const teacherTimetables = await TeacherTimetable.find(
            scopeBySchool(req.user?.schoolId, { academicYear })
          ).session(mongoSession);
          for (const teacherTimetable of teacherTimetables) {
            let modified = false;
            for (const day of SCHEDULE_DAYS) {
              const next = [];
              for (const slot of teacherTimetable.schedule?.[day] || []) {
                if (String(slot.classId) !== String(classId)) {
                  next.push(slot);
                  continue;
                }
                const newIndex = oldToNew.get(slot.periodIndex);
                if (newIndex !== undefined) {
                  slot.periodIndex = newIndex;
                  next.push(slot);
                }
                modified = true;
              }
              teacherTimetable.schedule[day] = next;
            }
            if (modified) {
              teacherTimetable.totalPeriodsPerWeek = SCHEDULE_DAYS.reduce(
                (sum, day) => sum + (teacherTimetable.schedule?.[day]?.length || 0),
                0
              );
              teacherTimetable.version += 1;
              teacherTimetable.lastSyncedAt = new Date();
              teacherTimetable.markModified('schedule');
              await teacherTimetable.save({ session: mongoSession });
            }
          }
        });
      } catch (error) {
        if (error.statusCode === 404) {
          return res.status(404).json({ error: error.message });
        }
        throw error;
      } finally {
        await mongoSession.endSession();
      }
      timetable.$session(null);
      await timetable.populate('classId', 'name section');

      const io = req.app.get('io');
      emitEvent(io, EVENTS.TIMETABLE_UPDATED, {
        schoolId: timetable.schoolId?.toString(),
        classId: classId?.toString(),
        academicYear,
      });

      res.json(timetable);
    } catch (error) {
      console.error('Error updating periods:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * PUT /api/timetable/:classId
 * Update entire timetable
 * Body: { academicYear, periods, schedule }
 * Note: This must come AFTER more specific routes like /:classId/slot, /:classId/periods
 */
router.put(
  '/:classId',
  checkPermission('classes', 'edit'),
  validateObjectIdParam('classId'),
  validateZod(zodSchemas.updateTimetable),
  async (req, res) => {
    try {
      const { classId } = req.params;
      const { academicYear = CURRENT_ACADEMIC_YEAR, periods, schedule } = req.body;

      // Validate class exists
      const classData = await Class.findOne(
        scopeBySchool(req.user?.schoolId, { _id: classId, isDeleted: { $ne: true } })
      );
      if (!classData) {
        return res.status(404).json({ error: req.t('common:errors.classNotFound') });
      }
      const resolvedSchoolId = await resolveRequestSchoolId(req);
      await validateClassScheduleAssignments({
        schoolId: resolvedSchoolId,
        classData,
        schedule,
        academicYear,
      });

      // Atomic upsert: exactly one winner creates, the rest update the same
      // doc. Using findOneAndUpdate (not find-modify-save) avoids both the
      // duplicate-insert race AND the optimistic-concurrency save() race that
      // fires when concurrent updaters each load the same version.
      // $inc: { version: 1 } bumps the app-level schedule version atomically;
      // $currentDate stamps lastSyncedAt at the server.
      //
      // IMPORTANT: a field must NOT appear in both $set and $setOnInsert —
      // MongoDB rejects that with "path conflict". So $setOnInsert only seeds
      // identity/defaults that are NEVER updated on this path; any field the
      // caller can change goes in $set (which also applies on insert).
      const setOnInsert = {
        schoolId: resolvedSchoolId,
        classId,
        academicYear,
        // Seed empty periods/schedule only when the caller didn't supply them.
        ...(periods ? {} : { periods: [] }),
        ...(schedule !== undefined
          ? {}
          : {
              schedule: {
                Monday: [],
                Tuesday: [],
                Wednesday: [],
                Thursday: [],
                Friday: [],
                Saturday: [],
                Sunday: [],
              },
            }),
      };
      const setUpdate = {
        $set: {
          ...(periods ? { periods } : {}),
          ...(schedule !== undefined ? { schedule } : {}),
        },
        $inc: { version: 1 },
        $currentDate: { lastSyncedAt: true },
        $setOnInsert: setOnInsert,
      };

      const timetableFilter = scopeBySchool(req.user?.schoolId, {
        classId,
        academicYear,
        isDeleted: { $ne: true },
      });
      let timetable;
      const mongoSession = await mongoose.startSession();
      try {
        await mongoSession.withTransaction(async () => {
          try {
            timetable = await Timetable.findOneAndUpdate(timetableFilter, setUpdate, {
              upsert: true,
              new: true,
              setDefaultsOnInsert: true,
              rawResult: false,
              session: mongoSession,
            });
          } catch (error) {
            if (error?.code !== 11000) throw error;
            timetable = await Timetable.findOneAndUpdate(timetableFilter, setUpdate, {
              upsert: false,
              new: true,
              rawResult: false,
              session: mongoSession,
            });
          }

          if (schedule === undefined) return;
          const teacherTimetables = await TeacherTimetable.find(
            scopeBySchool(resolvedSchoolId, { academicYear })
          ).session(mongoSession);
          const byTeacherId = new Map(
            teacherTimetables.map((teacherTimetable) => [
              String(teacherTimetable.teacherId),
              teacherTimetable,
            ])
          );
          const changedTeacherIds = new Set();

          // Remove every existing mirror for this class before rebuilding it.
          for (const teacherTimetable of teacherTimetables) {
            for (const day of SCHEDULE_DAYS) {
              const before = teacherTimetable.schedule?.[day]?.length || 0;
              teacherTimetable.schedule[day] = (teacherTimetable.schedule?.[day] || []).filter(
                (slot) => String(slot.classId) !== String(classId)
              );
              if (teacherTimetable.schedule[day].length !== before) {
                changedTeacherIds.add(String(teacherTimetable.teacherId));
              }
            }
          }

          for (const day of SCHEDULE_DAYS) {
            const slots = schedule[day] || [];
            for (let periodIndex = 0; periodIndex < slots.length; periodIndex++) {
              const slot = slots[periodIndex];
              if (!slot?.teacherId) continue;
              const key = String(slot.teacherId);
              let teacherTimetable = byTeacherId.get(key);
              if (!teacherTimetable) {
                teacherTimetable = new TeacherTimetable({
                  schoolId: resolvedSchoolId,
                  teacherId: slot.teacherId,
                  academicYear,
                  schedule: {},
                });
                byTeacherId.set(key, teacherTimetable);
              }
              changedTeacherIds.add(key);
              if (!teacherTimetable.schedule[day]) teacherTimetable.schedule[day] = [];
              teacherTimetable.schedule[day].push({
                periodIndex,
                classId,
                subject: slot.subject || '',
                room: slot.room || '',
                lastModified: new Date(),
              });
            }
          }

          // Persist only teachers whose mirror actually changed. Previously a
          // one-class edit rewrote every teacher timetable in the school,
          // incrementing versions and amplifying transaction work even when a
          // teacher had no slot in the edited class.
          for (const teacherId of changedTeacherIds) {
            const teacherTimetable = byTeacherId.get(teacherId);
            if (!teacherTimetable) continue;
            for (const day of SCHEDULE_DAYS) {
              teacherTimetable.schedule[day] = (teacherTimetable.schedule?.[day] || []).sort(
                (a, b) => a.periodIndex - b.periodIndex
              );
            }
            teacherTimetable.totalPeriodsPerWeek = SCHEDULE_DAYS.reduce(
              (sum, day) => sum + (teacherTimetable.schedule?.[day]?.length || 0),
              0
            );
            teacherTimetable.version += 1;
            teacherTimetable.lastSyncedAt = new Date();
            teacherTimetable.markModified('schedule');
            await teacherTimetable.save({ session: mongoSession });
          }
        });
      } finally {
        await mongoSession.endSession();
      }

      timetable.$session(null);
      await timetable.populate('classId', 'name section');

      const io = req.app.get('io');
      emitEvent(io, EVENTS.TIMETABLE_UPDATED, {
        schoolId: timetable.schoolId?.toString(),
        classId: classId?.toString(),
        academicYear,
      });

      res.json(timetable);
    } catch (error) {
      console.error('Error updating timetable:', error);
      if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * DELETE /api/timetable/:classId
 * Delete timetable
 * Query params: academicYear (optional, defaults to CURRENT_ACADEMIC_YEAR)
 */
router.delete(
  '/:classId',
  checkPermission('classes', 'delete'),
  validateObjectIdParam('classId'),
  async (req, res) => {
    const mongoSession = await mongoose.startSession();
    try {
      const { classId } = req.params;
      const { academicYear = CURRENT_ACADEMIC_YEAR } = req.query;
      let timetable;
      await mongoSession.withTransaction(async () => {
        timetable = await Timetable.findOneAndUpdate(
          scopeBySchool(req.user?.schoolId, {
            classId,
            academicYear,
            isDeleted: { $ne: true },
          }),
          { $set: { isDeleted: true, deletedAt: new Date() } },
          { new: true, session: mongoSession }
        );
        if (!timetable) {
          const error = new Error('Timetable not found');
          error.statusCode = 404;
          throw error;
        }

        const teacherTimetables = await TeacherTimetable.find(
          scopeBySchool(req.user?.schoolId, { academicYear })
        ).session(mongoSession);
        for (const teacherTimetable of teacherTimetables) {
          let modified = false;
          for (const day of SCHEDULE_DAYS) {
            const before = teacherTimetable.schedule?.[day]?.length || 0;
            teacherTimetable.schedule[day] = (teacherTimetable.schedule?.[day] || []).filter(
              (slot) => String(slot.classId) !== String(classId)
            );
            if (teacherTimetable.schedule[day].length !== before) modified = true;
          }
          if (modified) {
            teacherTimetable.totalPeriodsPerWeek = SCHEDULE_DAYS.reduce(
              (sum, day) => sum + (teacherTimetable.schedule?.[day]?.length || 0),
              0
            );
            teacherTimetable.version += 1;
            teacherTimetable.lastSyncedAt = new Date();
            teacherTimetable.markModified('schedule');
            await teacherTimetable.save({ session: mongoSession });
          }
        }
      });

      const io = req.app.get('io');
      emitEvent(io, EVENTS.TIMETABLE_UPDATED, {
        schoolId: timetable.schoolId?.toString(),
        classId: classId?.toString(),
        academicYear,
      });

      res.json({ success: true, message: 'Timetable deleted successfully' });
    } catch (error) {
      console.error('Error deleting timetable:', error);
      if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: error.message });
    } finally {
      await mongoSession.endSession();
    }
  }
);

export default router;
