/**
 * @swagger
 * tags:
 *   name: Classes
 *   description: Class & section management
 */

/**
 * @swagger
 * /classes:
 *   get:
 *     summary: List all classes
 *     tags: [Classes]
 *     parameters:
 *       - $ref: '#/components/parameters/AcademicYearQuery'
 *       - $ref: '#/components/parameters/SearchQuery'
 *     responses:
 *       200:
 *         description: Array of classes
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ClassBase'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *   post:
 *     summary: Create a class
 *     tags: [Classes]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateClassRequest'
 *     responses:
 *       201:
 *         description: Class created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ClassBase'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       409:
 *         description: Class with same name & section already exists
 */

/**
 * @swagger
 * /classes/{id}:
 *   get:
 *     summary: Get a class by ID
 *     tags: [Classes]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: Class details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ClassBase'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   put:
 *     summary: Update a class
 *     tags: [Classes]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateClassRequest'
 *     responses:
 *       200:
 *         description: Updated class
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ClassBase'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   delete:
 *     summary: Delete a class
 *     tags: [Classes]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         $ref: '#/components/responses/NotFound'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @swagger
 * /classes/{id}/students:
 *   get:
 *     summary: List students in a class
 *     tags: [Classes, Students]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *       - $ref: '#/components/parameters/AcademicYearQuery'
 *     responses:
 *       200:
 *         description: Students array
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/StudentBase'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @swagger
 * /classes/{id}/teacher:
 *   put:
 *     summary: Assign class teacher
 *     tags: [Classes]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [classTeacherId]
 *             properties:
 *               classTeacherId:
 *                 $ref: '#/components/schemas/ObjectId'
 *     responses:
 *       200:
 *         description: Teacher assigned
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @swagger
 * /classes/attendance/week:
 *   get:
 *     summary: Per-day covered/total class attendance counts for a week
 *     description: |
 *       Returns the Monday of the requested week plus one entry per past
 *       school day (Mon–Sat by default, configurable via SchoolSettings).
 *       Used by the frontend ClassesRail week-calendar to replace the
 *       "neutral until ..." stub (SCH-191).
 *     tags: [Classes, Attendance]
 *     parameters:
 *       - in: query
 *         name: weekStart
 *         schema:
 *           type: string
 *           format: date
 *         description: Monday of the week to summarise (YYYY-MM-DD). Defaults to the current week.
 *       - in: query
 *         name: academicYear
 *         schema:
 *           type: string
 *         description: Optional YYYY-YY filter (unused for now; reserved for future use).
 *     responses:
 *       200:
 *         description: Week summary
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 weekStart:
 *                   type: string
 *                   format: date
 *                 days:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       date:
 *                         type: string
 *                         format: date
 *                       covered:
 *                         type: integer
 *                       total:
 *                         type: integer
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

import express from 'express';
import {
  Class,
  Staff,
  Student,
  Timetable,
  TeacherTimetable,
  Exam,
  Result,
  Attendance,
  ClassAnnouncement,
  ChapterProgress,
  ClassRating,
  getNextRollNumber,
} from '../database.js';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import Homework from '../models/Homework.js';
import SchoolSettings from '../models/SchoolSettings.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { validateZod } from '../middleware/validation.js';
import {
  createClassSchema,
  createClassesSchema,
  updateClassSchema,
  updateClassTeacherSchema,
  updateClassSubjectsSchema,
  updateClassTagSchema,
  weekAttendanceQuerySchema,
  classRosterQuerySchema,
  classListQuerySchema,
} from '../validators/index.js';
import resolveClassId from '../utils/resolveClassId.js';
import { extractSchoolId, ensureDefaultSchool } from '../utils/schoolContext.js';
import { countActiveStudents, checkClassCapacity } from '../utils/classCapacity.js';
import { sendNotification } from './notifications.js';
import { EVENTS, emitEvent } from '../utils/socketEvents.js';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';
import { localTodayString } from '../utils/dateTimezone.js';
import mongoose from 'mongoose';
import { logToTrash } from '../services/trashService.js';

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
 * Sync Staff document when class teacher assignment changes.
 * Clears the old teacher's fields and sets the new teacher's fields.
 */
async function syncClassTeacherStaff({ oldTeacherId, newTeacherId, classDoc, session = null }) {
  const schoolId = classDoc.schoolId;
  if (oldTeacherId && String(oldTeacherId) !== String(newTeacherId)) {
    await Staff.findOneAndUpdate(
      scopeBySchool(schoolId, { _id: oldTeacherId }),
      {
        classTeacherOf: null,
        isClassTeacher: false,
      },
      { session }
    );
  }

  if (newTeacherId) {
    await Staff.findOneAndUpdate(
      scopeBySchool(schoolId, { _id: newTeacherId }),
      {
        classTeacherOf: `${classDoc.name}-${classDoc.section}`,
        isClassTeacher: true,
      },
      { session }
    );
  }
}

async function ensureTeacherAvailable(
  classTeacherId,
  currentClassId = null,
  schoolId = null,
  session = null
) {
  if (classTeacherId === null || classTeacherId === undefined || classTeacherId === '') {
    return null;
  }

  const teacherQuery = schoolId
    ? scopeBySchool(schoolId, { _id: classTeacherId })
    : { _id: classTeacherId };
  const teacher = await Staff.findOne(teacherQuery).session(session);
  if (!teacher) {
    return { error: { status: 404, body: { error: 'Teacher not found' } } };
  }

  const query = schoolId
    ? scopeBySchool(schoolId, { classTeacherId, isDeleted: { $ne: true } })
    : { classTeacherId, isDeleted: { $ne: true } };
  if (currentClassId) {
    query._id = { $ne: currentClassId };
  }

  const existingClass = await Class.findOne(query).session(session);
  if (existingClass) {
    return {
      error: {
        status: 400,
        body: {
          error: 'Teacher is already assigned as class teacher to another class',
          teacherName: teacher.name,
          teacherCode: teacher.code,
          existingClass: {
            id: existingClass._id,
            name: existingClass.name,
            section: existingClass.section,
          },
          message: `${teacher.name} (${teacher.code}) is already assigned to ${existingClass.name} ${existingClass.section}. Please unassign them first.`,
        },
      },
    };
  }

  return { teacher };
}

router.get('/public', async (req, res) => {
  try {
    const schoolId = await resolveRequestSchoolId(req);
    const { academicYear = CURRENT_ACADEMIC_YEAR } = req.query;
    const classes = await Class.find(
      scopeBySchool(schoolId, { isDeleted: { $ne: true }, academicYear })
    ).sort({
      name: 1,
      section: 1,
    });
    const formatted = classes.map((cls) => ({
      id: cls._id,
      name: cls.name,
      section: cls.section,
      displayName: cls.section ? `${cls.name}-${cls.section}` : cls.name,
    }));

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get(
  '/',
  checkPermission('classes', 'view'),
  validateZod(classListQuerySchema, 'query'),
  async (req, res) => {
    try {
      const { academicYear = CURRENT_ACADEMIC_YEAR, teacherId } = req.query;
      const baseQuery = {};
      if (teacherId) {
        if (!mongoose.isValidObjectId(teacherId)) {
          return res.status(400).json({ error: 'Invalid teacherId format' });
        }
        baseQuery.classTeacherId = teacherId;
      }
      baseQuery.isDeleted = { $ne: true };
      baseQuery.academicYear = academicYear;
      const query = scopeBySchool(req.user?.schoolId, baseQuery);
      const classes = await Class.find(query)
        .populate('classTeacherId', 'name')
        .sort({ name: 1, section: 1 });

      // AUDIT-65: Bulk-fetch student counts instead of N+1 individual queries
      const classIds = classes.map((cls) => cls._id);
      const schoolIdRaw = extractSchoolId(req.user?.schoolId);
      const schoolOid = schoolIdRaw ? new mongoose.Types.ObjectId(schoolIdRaw) : null;
      const schoolMatch = schoolOid ? { schoolId: schoolOid } : {};
      const today = localTodayString();

      // AUDIT-339: Bulk-fetch student counts, attendance, and academic performance in parallel
      const [studentCountAgg, attendanceAgg, academicAgg] = await Promise.all([
        Student.aggregate([
          {
            $match: {
              classId: { $in: classIds },
              status: 'active',
              isDeleted: { $ne: true },
              ...schoolMatch,
            },
          },
          { $group: { _id: '$classId', count: { $sum: 1 } } },
        ]),
        Attendance.aggregate([
          {
            $match: {
              classId: { $in: classIds },
              date: today,
              isDeleted: { $ne: true },
              ...schoolMatch,
            },
          },
          {
            $group: {
              _id: '$classId',
              total: { $sum: 1 },
              present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
              late: { $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] } },
              halfday: { $sum: { $cond: [{ $eq: ['$status', 'halfday'] }, 1, 0] } },
            },
          },
        ]),
        Result.aggregate([
          {
            $match: {
              classId: { $in: classIds },
              academicYear,
              isDeleted: { $ne: true },
              isPublished: true,
              ...schoolMatch,
            },
          },
          {
            $group: {
              _id: '$classId',
              avgPercentage: { $avg: '$percentage' },
            },
          },
        ]),
      ]);

      // Apply the SAME attendance formula the model static and /report use
      // (present + late*lateWeight + halfday*0.5)/total. Previously this list
      // view treated 'late' as 100% present and 'halfday' as 0%, so the class
      // cards' attendance % disagreed with the per-student report for any
      // school that configured a lateWeight below 100%. Load the weight once
      // per request (cheap, single doc).
      const attendanceSettings = await SchoolSettings.findOne(
        scopeBySchool(req.user?.schoolId, {})
      ).lean();
      const lateW = (attendanceSettings?.attendanceRules?.lateWeight ?? 100) / 100;

      const studentCountMap = new Map(
        studentCountAgg.map((item) => [item._id.toString(), item.count])
      );
      const attendanceMap = new Map(
        attendanceAgg.map((item) => {
          const effectivePresent = item.present + item.late * lateW + (item.halfday || 0) * 0.5;
          return [
            item._id.toString(),
            {
              percentage: item.total > 0 ? Math.round((effectivePresent / item.total) * 100) : null,
              marked: item.total,
              present: item.present + item.late,
            },
          ];
        })
      );
      const academicMap = new Map(
        academicAgg.map((item) => [
          item._id.toString(),
          item.avgPercentage != null ? Math.round(item.avgPercentage) : 0,
        ])
      );

      const formatted = classes.map((cls) => ({
        id: cls._id.toString(),
        name: cls.name,
        section: cls.section,
        // [BUG-030] Class display name for selectors/dropdowns. Without this,
        // the Add-Staff "Assigned classes" dropdown fell back to the raw 24-char
        // ObjectId (c.displayName || c.id) because the GET /classes response had
        // no readable label. Matches the GET /classes/public handler's shape.
        displayName: cls.section ? `${cls.name}-${cls.section}` : cls.name,
        subjects: cls.subjects,
        classTeacherId: cls.classTeacherId?._id?.toString(),
        classTeacherName: cls.classTeacherId?.name,
        studentCount: studentCountMap.get(cls._id.toString()) || 0,
        averageAttendance: attendanceMap.get(cls._id.toString())?.percentage ?? null,
        attendanceMarkedToday: Boolean(attendanceMap.get(cls._id.toString())?.marked),
        attendanceMarkedCount: attendanceMap.get(cls._id.toString())?.marked || 0,
        attendancePresentCount: attendanceMap.get(cls._id.toString())?.present || 0,
        attendanceDate: today,
        averageAcademicPerformance: academicMap.get(cls._id.toString()) ?? 0,
        academicYear: cls.academicYear,
        strengthLimit: cls.strengthLimit,
        room: cls.room,
        block: cls.block,
        classTag: cls.classTag,
        assignedSubjects: cls.assignedSubjects,
      }));

      res.json(formatted);
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  }
);

// ─── PER-DAY WEEK ATTENDANCE COVERAGE (SCH-191) ──────────────────────────
// Single-call endpoint that returns per-day covered/total class counts for the
// current (or requested) week. Replaces the frontend's `ClassesRail.weekcal`
// "neutral until ..." stub with real bar colouring.
//
// Mounted BEFORE the `/:id` routes so `attendance` is matched as a literal
// path segment instead of an `:id` parameter.
const WEEK_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function startOfIsoWeek(dateStr) {
  // Anchor to Monday of the ISO week containing the given YYYY-MM-DD.
  // Uses UTC parsing so the result is stable across server timezones.
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function addDaysIso(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayNameFromIso(dateStr) {
  return WEEK_DAY_NAMES[new Date(`${dateStr}T00:00:00Z`).getUTCDay()];
}

router.get(
  '/attendance/week',
  checkPermission('attendance', 'view'),
  validateZod(weekAttendanceQuerySchema, 'query'),
  async (req, res) => {
    try {
      const schoolId = await resolveRequestSchoolId(req);

      // Resolve the week window. `weekStart` defaults to "this Monday".
      const requestedWeekStart = req.query.weekStart || startOfIsoWeek(localTodayString());
      const weekStart = startOfIsoWeek(requestedWeekStart);
      if (!weekStart) {
        return res.status(400).json({ error: 'Invalid weekStart value' });
      }

      // Build the 7-day window (Mon..Sun). Future dates and non-working days
      // are pruned below; this is the inclusive list of candidates.
      const candidateDates = Array.from({ length: 7 }, (_, i) => addDaysIso(weekStart, i));
      const today = localTodayString();

      // Read school settings for workingDays + holidays. Both are optional —
      // fall back to Mon–Sat and an empty holiday list on missing settings.
      let workingDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      let holidaySet = new Set();
      try {
        const settings = await SchoolSettings.findOne({ schoolId }).select('workingDays holidays');
        if (Array.isArray(settings?.workingDays) && settings.workingDays.length > 0) {
          workingDays = settings.workingDays;
        }
        if (Array.isArray(settings?.holidays)) {
          holidaySet = new Set(settings.holidays.map((h) => h.date).filter(Boolean));
        }
      } catch (settingsErr) {
        console.warn('[classes/attendance/week] settings lookup failed:', settingsErr.message);
      }

      // Eligible dates = past school days in the requested week that aren't
      // holidays. "Past" means `date <= today` in the school's local timezone
      // so users looking at the current week still see today's bar (today is
      // included; future days of the current week are omitted).
      const eligibleDates = candidateDates.filter((dateStr) => {
        if (dateStr > today) return false;
        if (holidaySet.has(dateStr)) return false;
        return workingDays.includes(dayNameFromIso(dateStr));
      });

      // Total active classes (school-scoped, non-deleted, current AY by
      // default). Used as `total` for every eligible day — the contract says
      // `total` is the number of classes that *should* have attendance on a
      // school day, which doesn't change day-to-day.
      const baseClassQuery = scopeBySchool(schoolId, {
        isDeleted: { $ne: true },
        academicYear: CURRENT_ACADEMIC_YEAR,
      });
      const total = await Class.countDocuments(baseClassQuery);

      // Covered counts: distinct classIds with any non-deleted attendance
      // record for the eligible dates, grouped by date. Done in one
      // aggregation instead of N queries.
      const coveredByDate = {};
      if (eligibleDates.length > 0) {
        const records = await Attendance.aggregate([
          {
            $match: {
              schoolId: new mongoose.Types.ObjectId(String(schoolId)),
              date: { $in: eligibleDates },
              isDeleted: { $ne: true },
            },
          },
          { $group: { _id: { date: '$date', classId: '$classId' } } },
          { $group: { _id: '$_id.date', classes: { $sum: 1 } } },
        ]);
        for (const row of records) {
          coveredByDate[row._id] = row.classes;
        }
      }

      const days = eligibleDates.map((dateStr) => ({
        date: dateStr,
        covered: coveredByDate[dateStr] || 0,
        total,
      }));

      res.json({ weekStart, days });
    } catch (error) {
      console.error('[classes/attendance/week] error:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

router.post(
  '/bulk',
  checkPermission('classes', 'create'),
  validateZod(createClassesSchema),
  async (req, res) => {
    const schoolId = await resolveRequestSchoolId(req);
    const session = await mongoose.startSession();
    try {
      let createdClasses = [];
      await session.withTransaction(async (transactionSession) => {
        for (const classData of req.body.classes) {
          const duplicate = await Class.findOne(
            scopeBySchool(schoolId, {
              name: classData.name,
              section: classData.section,
              academicYear: classData.academicYear,
              isDeleted: { $ne: true },
            })
          ).session(transactionSession);
          if (duplicate) {
            const error = new Error(
              `${classData.name}-${classData.section} already exists for ${classData.academicYear}`
            );
            error.status = 409;
            throw error;
          }
          if (classData.classTeacherId) {
            const teacher = await Staff.findOne(
              scopeBySchool(schoolId, {
                _id: classData.classTeacherId,
                isDeleted: { $ne: true },
              })
            ).session(transactionSession);
            if (!teacher) {
              const error = new Error('One or more class teachers were not found in your school');
              error.status = 400;
              throw error;
            }
            const assignedClass = await Class.findOne(
              scopeBySchool(schoolId, {
                classTeacherId: classData.classTeacherId,
                isDeleted: { $ne: true },
              })
            ).session(transactionSession);
            if (assignedClass) {
              const error = new Error(
                `${teacher.name} is already assigned to ${assignedClass.name}-${assignedClass.section}`
              );
              error.status = 409;
              throw error;
            }
          }
        }

        createdClasses = await Class.create(
          req.body.classes.map((classData) => ({ ...classData, schoolId })),
          { session: transactionSession }
        );
        for (const classDoc of createdClasses) {
          if (!classDoc.classTeacherId) continue;
          // Reuse the single-create helper so the Staff mirror is written the
          // same way as POST /classes. oldTeacherId is null (fresh class), so
          // only the new teacher's classTeacherOf/isClassTeacher are set — but
          // routing through syncClassTeacherStaff keeps bulk and single paths
          // identical and means any future field added to the mirror (e.g. a
          // denormalized class name) lands in both places automatically.
          await syncClassTeacherStaff({
            oldTeacherId: null,
            newTeacherId: classDoc.classTeacherId,
            classDoc,
            session: transactionSession,
          });
        }
      });

      res.status(201).json({
        success: true,
        classes: createdClasses.map((classDoc) => ({
          id: classDoc._id,
          ...classDoc.toObject(),
        })),
      });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    } finally {
      await session.endSession();
    }
  }
);

router.post(
  '/',
  checkPermission('classes', 'create'),
  validateZod(createClassSchema),
  async (req, res) => {
    try {
      const {
        name,
        section,
        classTeacherId,
        subjects,
        academicYear,
        strengthLimit,
        room,
        block,
        classTag,
        assignedSubjects,
      } = req.body;
      const schoolId = await resolveRequestSchoolId(req);
      if (!schoolId) {
        return res.status(400).json({ error: 'School context is required' });
      }
      const session = await mongoose.startSession();
      // Initialize assignedSubjects alongside subjects so new classes start
      // with both fields populated together. Previously assignedSubjects was
      // only written when explicitly supplied (length > 0), so a class created
      // with just `subjects` had assignedSubjects = [] and the timetable
      // wizard's "Assigned subjects" picker appeared empty until an admin
      // manually mirrored it via PUT /:id/subjects.
      const resolvedAssignedSubjects =
        assignedSubjects && assignedSubjects.length > 0 ? assignedSubjects : subjects || [];
      const classDoc = new Class({
        name,
        section,
        classTeacherId,
        subjects,
        academicYear,
        schoolId,
        ...(strengthLimit && { strengthLimit }),
        ...(room && { room }),
        ...(block && { block }),
        ...(classTag && { classTag }),
        assignedSubjects: resolvedAssignedSubjects,
      });
      try {
        await session.withTransaction(async (transactionSession) => {
          if (classTeacherId) {
            const teacher = await Staff.findOne(
              scopeBySchool(schoolId, {
                _id: classTeacherId,
                isDeleted: { $ne: true },
              })
            ).session(transactionSession);
            const assignedClass = await Class.findOne(
              scopeBySchool(schoolId, {
                classTeacherId,
                isDeleted: { $ne: true },
              })
            ).session(transactionSession);
            if (!teacher || assignedClass) {
              const error = new Error(
                !teacher
                  ? 'Class teacher not found in your school'
                  : `${teacher.name} is already assigned to another class`
              );
              error.status = assignedClass ? 409 : 400;
              throw error;
            }
          }

          await classDoc.save({ session: transactionSession });
          if (classTeacherId) {
            await Staff.updateOne(
              scopeBySchool(schoolId, { _id: classTeacherId }),
              {
                $set: {
                  classTeacherOf: `${classDoc.name}-${classDoc.section}`,
                  isClassTeacher: true,
                },
              },
              { session: transactionSession }
            );
          }
        });
      } finally {
        await session.endSession();
      }

      res.status(201).json({ id: classDoc._id, ...classDoc.toObject() });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(400).json({
          error: 'A class with this name, section, and academic year already exists',
        });
      }

      res.status(error.status || 500).json({ error: error.message });
    }
  }
);

router.put(
  '/:id/class-teacher',
  checkPermission('classes', 'edit'),
  validateZod(updateClassTeacherSchema),
  async (req, res) => {
    const session = await mongoose.startSession();
    try {
      const { classTeacherId, force } = req.body;
      let classDoc;
      let validation;
      let oldTeacherId;
      let previousClassForSocket = null;

      await session.withTransaction(async () => {
        classDoc = await Class.findOne(
          scopeBySchool(req.user?.schoolId, {
            _id: req.params.id,
            isDeleted: { $ne: true },
          })
        ).session(session);
        if (!classDoc) {
          const error = new Error(req.t('common:errors.classNotFound'));
          error.status = 404;
          throw error;
        }

        validation = await ensureTeacherAvailable(
          classTeacherId,
          req.params.id,
          req.user?.schoolId,
          session
        );
        if (validation?.error) {
          // If force=true, unassign the teacher from their current class first.
          // All class + staff mirror writes share this transaction, so a failure
          // cannot leave the teacher detached from both classes.
          if (force && validation.error.body?.existingClass?.id) {
            const prevClassId = validation.error.body.existingClass.id;
            const prevClass = await Class.findOne(
              scopeBySchool(req.user?.schoolId, {
                _id: prevClassId,
                isDeleted: { $ne: true },
              })
            ).session(session);
            if (prevClass) {
              const prevOldTeacherId = prevClass.classTeacherId;
              prevClass.classTeacherId = null;
              await prevClass.save({ session });
              await syncClassTeacherStaff({
                oldTeacherId: prevOldTeacherId,
                newTeacherId: null,
                classDoc: prevClass,
                session,
              });
              previousClassForSocket = prevClass;
            }

            // Re-validate in the same transaction — teacher is now available.
            validation = await ensureTeacherAvailable(
              classTeacherId,
              req.params.id,
              req.user?.schoolId,
              session
            );
          }

          if (validation?.error) {
            const error = new Error(validation.error.body?.error || 'Teacher is unavailable');
            error.status = validation.error.status;
            error.body = validation.error.body;
            throw error;
          }
        }

        oldTeacherId = classDoc.classTeacherId;
        classDoc.classTeacherId = classTeacherId || null;
        await classDoc.save({ session });

        await syncClassTeacherStaff({
          oldTeacherId,
          newTeacherId: classTeacherId,
          classDoc,
          session,
        });
      });

      // Emit only after commit; clients never observe a state that later rolls back.
      if (previousClassForSocket) {
        const io = req.app.get('io');
        if (io) {
          emitEvent(io, EVENTS.CLASS_UPDATED, {
            // Use the class doc's schoolId (always present) rather than
            // req.user.schoolId?.toString() — super-admin / dev tokens can
            // have no schoolId, which would emit a null schoolId and break
            // the per-school socket room routing.
            schoolId: previousClassForSocket.schoolId?.toString(),
            classId: previousClassForSocket._id.toString(),
            name: previousClassForSocket.name,
            section: previousClassForSocket.section,
            classTeacherId: null,
            teacher: null,
            teacherPhoto: null,
          });
        }
      }

      // Notify old and new teachers about the assignment change
      const className = `${classDoc.name}-${classDoc.section}`;
      if (oldTeacherId && String(oldTeacherId) !== String(classTeacherId || '')) {
        sendNotification(
          oldTeacherId,
          'Staff',
          'class_teacher',
          'Class Teacher Unassigned',
          `You have been unassigned as class teacher of ${className}.`,
          { schoolId: classDoc.schoolId, relatedId: classDoc._id, relatedType: 'Class' }
        ).catch((err) => console.error('Notification error (old teacher):', err));
      }
      if (classTeacherId) {
        sendNotification(
          classTeacherId,
          'Staff',
          'class_teacher',
          'Class Teacher Assigned',
          `You have been assigned as class teacher of ${className}.`,
          { schoolId: classDoc.schoolId, relatedId: classDoc._id, relatedType: 'Class' }
        ).catch((err) => console.error('Notification error (new teacher):', err));
      }

      const io = req.app.get('io');
      emitEvent(io, EVENTS.CLASS_UPDATED, {
        // Use the class doc's schoolId (always present) instead of
        // req.user.schoolId?.toString() — see the previousClassForSocket emit
        // above for rationale.
        schoolId: classDoc.schoolId?.toString(),
        classId: classDoc._id.toString(),
        name: classDoc.name,
        section: classDoc.section,
        classTeacherId: classDoc.classTeacherId,
        teacher: validation?.teacher?.name || null,
        teacherPhoto:
          validation?.teacher?.picture ||
          validation?.teacher?.photoURL ||
          validation?.teacher?.photo ||
          null,
      });

      res.json({
        id: classDoc._id,
        ...classDoc.toObject(),
        teacherName: validation?.teacher?.name || null,
        teacherPhoto:
          validation?.teacher?.picture ||
          validation?.teacher?.photoURL ||
          validation?.teacher?.photo ||
          null,
      });
    } catch (error) {
      res.status(error.status || 500).json(error.body || { error: error.message });
    } finally {
      await session.endSession();
    }
  }
);

// AUDIT-36: Added permission check
router.get('/:id/settings', checkPermission('classes', 'view'), async (req, res) => {
  try {
    const classDoc = await Class.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
    );
    if (!classDoc) {
      return res.status(404).json({ error: req.t('common:errors.classNotFound') });
    }

    res.json({
      classId: classDoc._id,
      classTag: classDoc.classTag || '',
      assignedSubjects: classDoc.assignedSubjects || [],
      name: classDoc.name,
      section: classDoc.section,
    });
  } catch (error) {
    console.error('Error fetching class settings:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put(
  '/:id/tag',
  checkPermission('classes', 'edit'),
  validateZod(updateClassTagSchema),
  async (req, res) => {
    try {
      const { classTag } = req.body;

      const classDoc = await Class.findOneAndUpdate(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
        { classTag },
        { new: true, runValidators: true }
      );

      if (!classDoc) {
        return res.status(404).json({ error: req.t('common:errors.classNotFound') });
      }

      res.json({
        success: true,
        classId: classDoc._id,
        classTag: classDoc.classTag,
      });
    } catch (error) {
      console.error('Error updating class tag:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

router.put(
  '/:id/subjects',
  checkPermission('classes', 'edit'),
  validateZod(updateClassSubjectsSchema),
  async (req, res) => {
    try {
      const { assignedSubjects } = req.body;

      // Get previous subjects before update to detect removals
      const prevClass = await Class.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
      );
      if (!prevClass) {
        return res.status(404).json({ error: req.t('common:errors.classNotFound') });
      }

      const prevSubjects = new Set(
        (prevClass.assignedSubjects || []).map((s) => (typeof s === 'string' ? s : s.name))
      );
      const newSubjects = new Set(
        assignedSubjects.map((s) => (typeof s === 'string' ? s : s.name))
      );
      const removedSubjects = [...prevSubjects].filter((s) => !newSubjects.has(s));

      const classDoc = await Class.findOneAndUpdate(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
        { assignedSubjects, subjects: assignedSubjects },
        { new: true, runValidators: true }
      );

      // Clean up timetable slots for removed subjects
      if (removedSubjects.length > 0) {
        try {
          const timetable = await Timetable.findOne(
            scopeBySchool(req.user?.schoolId, {
              classId: req.params.id,
              academicYear: CURRENT_ACADEMIC_YEAR,
              isDeleted: { $ne: true },
            })
          );
          if (timetable) {
            let modified = false;
            const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            for (const day of days) {
              if (!timetable.schedule[day]) continue;
              for (let i = 0; i < timetable.schedule[day].length; i++) {
                const slot = timetable.schedule[day][i];
                if (slot.subject && removedSubjects.includes(slot.subject)) {
                  timetable.schedule[day][i] = {
                    subject: '',
                    teacherId: null,
                    room: '',
                    lastModified: new Date(),
                    modifiedBy: req.user?.id,
                  };
                  modified = true;
                }
              }
            }
            if (modified) {
              timetable.version += 1;
              timetable.lastSyncedAt = new Date();
              await timetable.save();
            }
          }
        } catch (cleanupError) {
          console.error('Error cleaning timetable after subject removal:', cleanupError);
        }
      }

      res.json({
        success: true,
        classId: classDoc._id,
        subjects: classDoc.subjects,
        assignedSubjects: classDoc.assignedSubjects,
        removedSubjects: removedSubjects.length > 0 ? removedSubjects : undefined,
      });
    } catch (error) {
      console.error('Error updating class subjects:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// AUDIT-36: Added permission check
router.get(
  '/:id/students',
  checkPermission('classes', 'view'),
  validateZod(classRosterQuerySchema, 'query'),
  async (req, res) => {
    try {
      const resolved = await resolveClassId(req.params.id, req.user?.schoolId);
      if (!resolved) {
        return res.status(404).json({ error: req.t('common:errors.classNotFound') });
      }

      const scopedClass = await Class.findOne(
        scopeBySchool(req.user?.schoolId, { _id: resolved.classId, isDeleted: { $ne: true } })
      );
      if (!scopedClass) {
        return res.status(404).json({ error: req.t('common:errors.classNotFound') });
      }

      const { skip, limit } = req.query;

      const studentsQuery = scopeBySchool(req.user?.schoolId, {
        classId: resolved.classId,
        status: 'active',
        isDeleted: { $ne: true },
      });
      const total = await Student.countDocuments(studentsQuery);
      const students = await Student.find(studentsQuery)
        .sort({ rollNo: 1 })
        .skip(skip)
        .limit(limit);

      res.json({
        students: students.map((student) => ({ id: student._id, ...student.toObject() })),
        hasMore: skip + students.length < total,
        total,
      });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  }
);

router.get('/:id/next-roll-number', checkPermission('classes', 'view'), async (req, res) => {
  try {
    const rollNumber = await getNextRollNumber(req.params.id, req.user?.schoolId);
    res.json({ rollNumber });
  } catch (error) {
    console.error('Error getting next roll number:', error);
    res.status(500).json({ error: 'Failed to get next roll number' });
  }
});

router.get('/:id/capacity', checkPermission('classes', 'view'), async (req, res) => {
  try {
    const result = await checkClassCapacity(req.params.id, req.user?.schoolId);
    if (!result) {
      return res.status(404).json({ error: req.t('common:errors.classNotFound') });
    }

    res.json({
      classId: result.classData._id,
      name: result.classData.name,
      section: result.classData.section,
      current: result.currentCount,
      capacity: result.capacity,
      available: result.available,
      isFull: result.isFull,
    });
  } catch (error) {
    console.error('Error checking class capacity:', error);
    res.status(500).json({ error: 'Failed to check capacity' });
  }
});

// AUDIT-36: Added permission check
router.get('/:id', checkPermission('classes', 'view'), async (req, res) => {
  try {
    const resolved = await resolveClassId(req.params.id, req.user?.schoolId);
    if (!resolved) {
      return res.status(404).json({ error: req.t('common:errors.classNotFound') });
    }

    const classDoc = await Class.findOne(
      scopeBySchool(req.user?.schoolId, { _id: resolved.classId, isDeleted: { $ne: true } })
    ).populate('classTeacherId', 'name');
    if (!classDoc) {
      return res.status(404).json({ error: req.t('common:errors.classNotFound') });
    }

    const studentCount = await countActiveStudents(classDoc._id, req.user?.schoolId);
    res.json({
      id: classDoc._id,
      name: classDoc.name,
      section: classDoc.section,
      subjects: classDoc.subjects,
      classTeacherId: classDoc.classTeacherId?._id,
      classTeacherName: classDoc.classTeacherId?.name,
      studentCount,
      academicYear: classDoc.academicYear,
      strengthLimit: classDoc.strengthLimit,
      room: classDoc.room,
      block: classDoc.block,
      classTag: classDoc.classTag,
      assignedSubjects: classDoc.assignedSubjects,
      averageAttendance: classDoc.averageAttendance,
      rating: classDoc.rating,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put(
  '/:id',
  checkPermission('classes', 'edit'),
  validateZod(updateClassSchema),
  async (req, res) => {
    try {
      const {
        name,
        section,
        classTeacherId,
        subjects,
        assignedSubjects,
        academicYear,
        classTag,
        room,
        block,
        strengthLimit,
      } = req.body;
      let validation = null;

      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (section !== undefined) updateData.section = section;
      if (classTeacherId !== undefined) updateData.classTeacherId = classTeacherId;
      if (subjects !== undefined) updateData.subjects = subjects;
      if (assignedSubjects !== undefined) updateData.assignedSubjects = assignedSubjects;
      if (academicYear !== undefined) updateData.academicYear = academicYear;
      if (classTag !== undefined) updateData.classTag = classTag;
      if (room !== undefined) updateData.room = room;
      if (block !== undefined) updateData.block = block;
      if (strengthLimit) {
        if (strengthLimit.current != null)
          updateData['strengthLimit.current'] = strengthLimit.current;
        if (strengthLimit.default != null)
          updateData['strengthLimit.default'] = strengthLimit.default;
      }

      let classDoc;
      const mongoSession = await mongoose.startSession();
      try {
        await mongoSession.withTransaction(async () => {
          const scopedCheck = await Class.findOne(
            scopeBySchool(req.user?.schoolId, {
              _id: req.params.id,
              isDeleted: { $ne: true },
            })
          ).session(mongoSession);
          if (!scopedCheck) {
            const error = new Error(req.t('common:errors.classNotFound'));
            error.status = 404;
            throw error;
          }

          // Validate inside the transaction so a retry after a concurrent
          // Staff-mirror write conflict observes the class that won. The old
          // pre-transaction check could be stale on retry and assign one
          // teacher to two classes.
          if (classTeacherId !== undefined) {
            validation = await ensureTeacherAvailable(
              classTeacherId,
              req.params.id,
              req.user?.schoolId,
              mongoSession
            );
            if (validation?.error) {
              const error = new Error(
                validation.error.body?.error || 'Class teacher is unavailable'
              );
              error.status = validation.error.status;
              throw error;
            }
          }

          const oldTeacherId = scopedCheck.classTeacherId;
          classDoc = await Class.findOneAndUpdate(
            scopeBySchool(req.user?.schoolId, {
              _id: req.params.id,
              isDeleted: { $ne: true },
            }),
            updateData,
            { new: true, runValidators: true, session: mongoSession }
          );

          // Omitted means "leave the assignment untouched". Previously an
          // ordinary room/name edit compared the stored teacher to undefined
          // and cleared only the Staff mirror, splitting the relation.
          if (
            classTeacherId !== undefined &&
            String(oldTeacherId || '') !== String(classTeacherId || '')
          ) {
            await syncClassTeacherStaff({
              oldTeacherId,
              newTeacherId: classTeacherId,
              classDoc,
              session: mongoSession,
            });
          }
        });
      } finally {
        await mongoSession.endSession();
      }

      const io = req.app.get('io');
      emitEvent(io, EVENTS.CLASS_UPDATED, {
        // Use the class doc's schoolId (always present) instead of
        // req.user.schoolId?.toString() — super-admin / dev tokens can have
        // no schoolId, which would emit a null schoolId and break per-school
        // socket room routing.
        schoolId: classDoc.schoolId?.toString(),
        classId: classDoc._id.toString(),
        name: classDoc.name,
        section: classDoc.section,
        classTeacherId: classDoc.classTeacherId,
      });

      const updatedDoc = classDoc.toObject();
      res.json({
        id: classDoc._id.toString(),
        ...updatedDoc,
        classTeacherId: updatedDoc.classTeacherId?.toString() || null,
        classTeacherName: validation?.teacher?.name || null,
      });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  }
);

router.delete('/:id', checkPermission('classes', 'delete'), async (req, res) => {
  const schoolId = req.user?.schoolId;
  const classId = req.params.id;
  const session = await mongoose.startSession();

  try {
    let classDoc;
    let trashItem;
    await session.withTransaction(async (transactionSession) => {
      classDoc = await Class.findOne(
        scopeBySchool(schoolId, { _id: classId, isDeleted: { $ne: true } })
      ).session(transactionSession);
      if (!classDoc) {
        const error = new Error(req.t('common:errors.classNotFound'));
        error.status = 404;
        throw error;
      }

      // A class is a durable reference used by academic and financial history.
      // Deleting those children would destroy records; setting fake isDeleted
      // fields on schemas that do not support them only creates invisible
      // orphans. Only a genuinely unused class may be archived.
      const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      // TeacherTimetable has no soft-delete, so its schedule slots for this
      // class used to make the dependency check below block FOREVER (the
      // "teacher timetables" dependency could never be satisfied). Strip the
      // class from every teacher's mirror first — mirrors the DELETE
      // /timetable/:classId logic (routes/timetable.js). This is safe: the
      // class's own Timetable (if any) still blocks deletion via the
      // "timetables" dependency below; we're only dropping stale pointers.
      const teacherTimetables = await TeacherTimetable.find(
        scopeBySchool(schoolId, {
          academicYear: classDoc.academicYear || CURRENT_ACADEMIC_YEAR,
        })
      ).session(transactionSession);
      for (const teacherTimetable of teacherTimetables) {
        let modified = false;
        for (const day of days) {
          const before = teacherTimetable.schedule?.[day]?.length || 0;
          teacherTimetable.schedule[day] = (teacherTimetable.schedule?.[day] || []).filter(
            (slot) => String(slot.classId) !== String(classId)
          );
          if (teacherTimetable.schedule[day].length !== before) modified = true;
        }
        if (modified) {
          teacherTimetable.totalPeriodsPerWeek = days.reduce(
            (sum, day) => sum + (teacherTimetable.schedule?.[day]?.length || 0),
            0
          );
          teacherTimetable.version += 1;
          teacherTimetable.lastSyncedAt = new Date();
          teacherTimetable.markModified('schedule');
          await teacherTimetable.save({ session: transactionSession });
        }
      }
      const dependencyQueries = [
        ['students', Student.findOne(scopeBySchool(schoolId, { classId })).select('_id')],
        ['timetables', Timetable.findOne(scopeBySchool(schoolId, { classId })).select('_id')],
        ['exams', Exam.findOne(scopeBySchool(schoolId, { classId })).select('_id')],
        ['results', Result.findOne(scopeBySchool(schoolId, { classId })).select('_id')],
        ['attendance', Attendance.findOne(scopeBySchool(schoolId, { classId })).select('_id')],
        [
          'fee structures',
          StudentFeeStructure.findOne(
            scopeBySchool(schoolId, { classId, isDeleted: { $ne: true } })
          ).select('_id'),
        ],
        [
          'announcements',
          ClassAnnouncement.findOne(scopeBySchool(schoolId, { classId })).select('_id'),
        ],
        [
          'chapter progress',
          ChapterProgress.findOne(scopeBySchool(schoolId, { classId })).select('_id'),
        ],
        ['class ratings', ClassRating.findOne(scopeBySchool(schoolId, { classId })).select('_id')],
        ['homework', Homework.findOne(scopeBySchool(schoolId, { classId })).select('_id')],
        [
          'teacher timetables',
          TeacherTimetable.findOne(
            scopeBySchool(schoolId, {
              $or: days.map((day) => ({ [`schedule.${day}.classId`]: classId })),
            })
          ).select('_id'),
        ],
      ];
      const dependencyMatches = [];
      for (const [, query] of dependencyQueries) {
        dependencyMatches.push(await query.session(transactionSession).lean());
      }
      const dependencies = dependencyQueries
        .filter((_, index) => Boolean(dependencyMatches[index]))
        .map(([name]) => name);
      if (dependencies.length > 0) {
        const error = new Error(
          `Cannot delete class because it has dependent ${dependencies.join(', ')}`
        );
        error.status = 409;
        error.dependencies = dependencies;
        throw error;
      }

      const snapshot = classDoc.toObject();
      const now = new Date();
      if (classDoc.classTeacherId) {
        await Staff.findOneAndUpdate(
          scopeBySchool(schoolId, { _id: classDoc.classTeacherId }),
          { $set: { classTeacherOf: null, isClassTeacher: false } },
          { session: transactionSession }
        );
      }
      classDoc.isDeleted = true;
      classDoc.deletedAt = now;
      await classDoc.save({ session: transactionSession });

      trashItem = await logToTrash({
        itemType: 'Class',
        itemId: classDoc._id,
        itemName: snapshot.name || 'Class',
        originalData: snapshot,
        deletedBy: req.user?.id || req.user?._id,
        schoolId,
        session: transactionSession,
      });
    });

    res.json({ success: true, trashItemId: trashItem?._id });
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message,
      ...(error.dependencies ? { dependencies: error.dependencies } : {}),
    });
  } finally {
    await session.endSession();
  }
});

export default router;
