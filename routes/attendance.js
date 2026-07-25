/**
 * @swagger
 * tags:
 *   name: Attendance
 *   description: Student attendance tracking
 */

/**
 * @swagger
 * /attendance/student/{studentId}:
 *   get:
 *     summary: Get attendance records for a student
 *     tags: [Attendance]
 *     parameters:
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           $ref: '#/components/schemas/ObjectId'
 *       - in: query
 *         name: start
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date filter (YYYY-MM-DD)
 *       - in: query
 *         name: end
 *         schema:
 *           type: string
 *           format: date
 *         description: End date filter (YYYY-MM-DD)
 *     responses:
 *       200:
 *         description: Array of attendance records
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/AttendanceRecord'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

/**
 * @swagger
 * /attendance/class/{classId}/{date}:
 *   get:
 *     summary: Get attendance for a class on a specific date
 *     tags: [Attendance]
 *     parameters:
 *       - in: path
 *         name: classId
 *         required: true
 *         schema:
 *           $ref: '#/components/schemas/ObjectId'
 *       - in: path
 *         name: date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: Date in YYYY-MM-DD format
 *     responses:
 *       200:
 *         description: Map of studentId → attendance status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties:
 *                 type: string
 *                 enum: [present, absent, late, leave, halfday]
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @swagger
 * /attendance:
 *   post:
 *     summary: Mark / update bulk attendance for a class
 *     tags: [Attendance]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BulkAttendanceRequest'
 *     responses:
 *       200:
 *         description: Attendance saved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessMessage'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

import express from 'express';
import mongoose from 'mongoose';
import { Attendance, Student } from '../database.js';
import Class from '../models/Class.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import resolveClassId from '../utils/resolveClassId.js';
import { extractSchoolId, ensureDefaultSchool } from '../utils/schoolContext.js';
import { dispatchWebhookEvent } from '../services/webhookService.js';
import { EVENTS, emitEvent } from '../utils/socketEvents.js';
import { validateZod } from '../validators/zodHelpers.js';
import {
  bulkAttendanceSchema,
  singleAttendanceSchema,
  regularizeStudentAttendanceSchema,
} from '../validators/attendanceSchema.js';
import { resolveAcademicYear, parseAcademicYear } from '../utils/academicYear.js';
import SchoolSettings from '../models/SchoolSettings.js';
import { localTodayString } from '../utils/dateTimezone.js';
import { validateObjectIdParam } from '../middleware/validation.js';
import { rateLimit } from 'express-rate-limit';
import cacheService from '../services/cacheService.js';

// Rate-limit POST /notify-parents — parent absence SMS/push are real
// money (SMS credits) and a spammy admin could repeatedly re-notify the
// same class+date. 3 requests per minute per user is plenty for honest
// retries, brick-walls accidental button-mashing.
const notifyParentsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  keyGenerator: (req) =>
    `${req.user?.id || req.ip}:${req.body?.classId || ''}:${req.body?.date || ''}`,
  handler: (req, res) =>
    res.status(429).json({
      error:
        'Too many notify-parents requests for this class+date. Please wait a minute before retrying.',
    }),
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

/**
 * Convert an academic year (e.g. "2025-26") into a date range filter object.
 *
 * Academic year boundaries come from the school's SchoolSettings
 * (academicYearStart/End, MM-DD format). Defaults to Apr–Mar for Indian
 * schools. Previously hardcoded to `${startYear}-04-01`..`${endYear}-03-31`
 * which silently gave schools on a July-June / Sep-Aug calendar the wrong
 * attendance window for every historical query.
 *
 * Returns { $gte, $lte } for the date field, or null if no academic year.
 */
async function getAcademicYearDateRange(academicYear, schoolId) {
  if (!academicYear) return null;
  const resolved = await resolveAcademicYear(academicYear, schoolId);
  const { startYear, endYear } = parseAcademicYear(resolved);

  let startMonthDay = '04-01';
  let endMonthDay = '03-31';
  try {
    if (schoolId) {
      const settings = await SchoolSettings.findOne({ schoolId }).select(
        'academicYearStart academicYearEnd'
      );
      if (settings?.academicYearStart && /^\d{2}-\d{2}$/.test(settings.academicYearStart)) {
        startMonthDay = settings.academicYearStart;
      }
      if (settings?.academicYearEnd && /^\d{2}-\d{2}$/.test(settings.academicYearEnd)) {
        endMonthDay = settings.academicYearEnd;
      }
    }
  } catch {
    // Fall back to April–March defaults on any settings lookup failure
  }
  return {
    $gte: `${startYear}-${startMonthDay}`,
    $lte: `${endYear}-${endMonthDay}`,
  };
}

async function notifyParentsOfAbsent(absentStudentIds, date, schoolId) {
  if (!absentStudentIds.length) return;
  try {
    const { sendNotification } = await import('./notifications.js');
    const { Parent, Student } = await import('../database.js');
    const { sendAttendanceAlertWhatsApp } = await import('../services/whatsappService.js');

    // Batch load all students upfront to avoid N+1 query (PERF fix).
    // School-scoped: a studentId leaked from another tenant (or a stale
    // request with no schoolId) must never resolve to another school's
    // student name.
    const studentQuery = { _id: { $in: absentStudentIds } };
    if (schoolId) studentQuery.schoolId = schoolId;
    const students = await Student.find(studentQuery).select('name').lean();
    const studentMap = {};
    for (const s of students) studentMap[String(s._id)] = s.name || 'your child';

    for (const studentId of absentStudentIds) {
      const parentQuery = { 'children.studentId': studentId };
      if (schoolId) parentQuery.schoolId = schoolId;
      const parents = await Parent.find(parentQuery).select('_id phone preferences');
      for (const parent of parents) {
        await sendNotification(
          parent._id,
          'Parent',
          'attendance',
          'Attendance Alert',
          `Your child was marked absent on ${date}.`,
          { relatedType: 'Attendance', priority: 'high' }
        );

        // WhatsApp notification for opted-in parents
        if (parent.preferences?.whatsappOptIn && parent.phone) {
          sendAttendanceAlertWhatsApp(parent.phone, {
            studentName: studentMap[String(studentId)] || 'your child',
            date,
            isPresent: false,
          }).catch((err) => console.error('[Attendance] WhatsApp failed:', err.message));
        }
      }
    }
  } catch (err) {
    console.error('Error sending attendance absence notifications:', err.message);
  }
}

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

// ─── Today Snapshot ──────────────────────────────────────────────────────
// Single-call endpoint that returns per-class present/absent counts for today.
// Replaces the dashboard's N+1 pattern of calling GET /:classId/:date for
// every class individually — a school with 20 classes now needs 1 request
// instead of 20.
router.get('/today-snapshot', checkPermission('attendance', 'view'), async (req, res) => {
  try {
    const schoolId = await resolveRequestSchoolId(req);
    // "Today" must be the local date, not UTC. Attendance.date is stored
    // as a YYYY-MM-DD string in the school's local timezone, so a UTC
    // comparison flips to "yesterday" for IST users after ~5:30 IST the
    // next morning (and vice-versa after ~6:30pm IST the prior evening).
    const today = localTodayString();

    const records = await Attendance.find(scopeBySchool(schoolId, { date: today }))
      .select('classId studentId status')
      .lean();

    // AUDIT-457: Exclude attendance records for soft-deleted students
    const studentIds = [...new Set(records.map((r) => r.studentId?.toString()).filter(Boolean))];
    const activeStudents = studentIds.length
      ? await Student.find({ _id: { $in: studentIds }, isDeleted: { $ne: true } })
          .select('_id')
          .lean()
      : [];
    const activeStudentIds = new Set(activeStudents.map((s) => String(s._id)));

    // Group by classId → { present, absent, late, leave, halfday, total }
    const byClass = {};
    for (const record of records) {
      if (!activeStudentIds.has(String(record.studentId))) continue;
      const classKey = String(record.classId);
      if (!byClass[classKey]) {
        byClass[classKey] = { present: 0, absent: 0, late: 0, leave: 0, halfday: 0, total: 0 };
      }
      const status = String(record.status || '').toLowerCase();
      if (byClass[classKey][status] !== undefined) {
        byClass[classKey][status] += 1;
      }
      byClass[classKey].total += 1;
    }

    res.json({ date: today, classes: byClass });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get(
  '/student/:studentId',
  validateObjectIdParam('studentId'),
  checkPermission('attendance', 'view'),
  async (req, res) => {
    try {
      const { studentId } = req.params;
      const { start, end, academicYear } = req.query;

      const schoolId = await resolveRequestSchoolId(req);

      // AUDIT-457: Verify student is not soft-deleted before querying attendance
      const studentDoc = await Student.findOne(
        scopeBySchool(schoolId, { _id: studentId, isDeleted: { $ne: true } })
      )
        .select('_id')
        .lean();
      if (!studentDoc) {
        res.set('X-Total-Count', '0');
        res.set('X-Has-More', 'false');
        return res.json([]);
      }

      const query = scopeBySchool(schoolId, { studentId });
      if (start && end) {
        query.date = { $gte: start, $lte: end };
      } else if (start) {
        query.date = { $gte: start };
      } else if (end) {
        query.date = { $lte: end };
      } else if (academicYear) {
        // Scope to academic year date range when no explicit dates provided
        const dateRange = await getAcademicYearDateRange(academicYear, schoolId);
        if (dateRange) query.date = dateRange;
      }

      // AUDIT-66: Add pagination support
      const skip = parseInt(req.query.skip) || 0;
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const total = await Attendance.countDocuments(query);

      const attendance = await Attendance.find(query)
        .populate({
          path: 'studentId',
          select: 'name rollNo admissionId',
          match: { isDeleted: { $ne: true } },
        })
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit);

      // Filter out records where student was deleted (populate returns null)
      const filtered = attendance.filter((r) => r.studentId != null);
      res.set('X-Total-Count', String(total));
      res.set('X-Has-More', String(skip + attendance.length < total));
      res.json(filtered);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// ─── Regularize Student Attendance (bulk per-student) ───────────────────
// Backs the "Regularize Attendance" drawer on the student profile
// (src/pages/students/components/drawers/RegularizeAttendanceDrawer.jsx).
// Accepts N { date, status, reason } updates for a single student and flips
// each record (upserting when no record exists for that day). Audit trail
// is stored on Attendance.regularization (mirrors StaffAttendance).
router.post(
  '/student/:studentId/regularize',
  validateObjectIdParam('studentId'),
  checkPermission('attendance', 'edit'),
  validateZod(regularizeStudentAttendanceSchema),
  async (req, res) => {
    try {
      const { studentId } = req.params;
      const { updates } = req.body;
      const regularizedBy = req.user?.id;
      const schoolId = await resolveRequestSchoolId(req);

      // Reject future dates — regularization is a backdated correction,
      // never a pre-mark. Mirrors staff regularize guard at line 463.
      const today = localTodayString();
      for (const u of updates) {
        if (u.date > today) {
          return res.status(400).json({
            error: 'Cannot regularize attendance for future dates',
            details: [{ field: 'updates', message: `Future date ${u.date} rejected` }],
          });
        }
      }

      // Verify the student exists and is not soft-deleted (multi-tenancy +
      // AUDIT-457 pattern used by the GET endpoints above).
      const studentDoc = await Student.findOne(
        scopeBySchool(schoolId, { _id: studentId, isDeleted: { $ne: true } })
      )
        .select('_id classId')
        .lean();
      if (!studentDoc) {
        return res.status(404).json({ error: 'Student not found' });
      }

      const results = [];
      for (const { date, status, reason } of updates) {
        // Locate the existing record (school+student+date scope). We use
        // findOne → manual save (instead of findOneAndUpdate) so the
        // `regularization` subdocument is set conditionally only when the
        // record pre-existed (upsert case uses previousStatus='unmarked').
        const existing = await Attendance.findOne(
          scopeBySchool(schoolId, { studentId, date, isDeleted: { $ne: true } })
        );

        const regularizedAt = new Date();
        if (existing) {
          existing.regularization = {
            regularizedBy,
            regularizedAt,
            previousStatus: existing.status,
            regularizationReason: reason || '',
          };
          existing.status = status;
          existing.markedBy = regularizedBy;
          await existing.save();
          results.push(existing.toObject());
        } else {
          // No prior record — create one. classId is required by the schema;
          // fall back to the student's current class. If the student has no
          // class assignment, skip the date with a per-item error rather
          // than 500-ing the whole batch.
          if (!studentDoc.classId) {
            results.push({
              date,
              status,
              skipped: true,
              reason: `Student has no class assignment; cannot create attendance for ${date}`,
            });
            continue;
          }
          const created = await Attendance.create({
            schoolId,
            studentId,
            classId: studentDoc.classId,
            date,
            status,
            markedBy: regularizedBy,
            regularization: {
              regularizedBy,
              regularizedAt,
              previousStatus: 'unmarked',
              regularizationReason: reason || '',
            },
          });
          results.push(created.toObject());
        }

        // Real-time + webhook fan-out (matches POST / handler). One event
        // per updated date so dashboards watching a single day refresh.
        const io = req.app.get('io');
        emitEvent(io, EVENTS.STUDENT_ATTENDANCE_UPDATED, {
          schoolId,
          studentId: studentId?.toString(),
          classId: studentDoc.classId?.toString(),
          date,
          status,
        });
        dispatchWebhookEvent(schoolId, 'attendance.regularized', {
          studentId,
          classId: studentDoc.classId,
          date,
          status,
          reason: reason || '',
        }).catch(() => {});
      }

      res.json({
        success: true,
        message: `Regularized ${results.filter((r) => !r.skipped).length} record(s)`,
        results,
      });
    } catch (error) {
      console.error('[Attendance] Error regularizing student attendance:', error);
      res.status(500).json({ error: error.message || 'Failed to regularize attendance' });
    }
  }
);

router.get('/class/:classId/:date', checkPermission('attendance', 'view'), async (req, res) => {
  try {
    const { classId, date } = req.params;
    const resolved = await resolveClassId(classId, req.user?.schoolId);

    if (!resolved) {
      return res.status(404).json({ error: req.t('common:errors.classNotFound') });
    }

    const attendance = await Attendance.find(
      scopeBySchool(req.user?.schoolId, { classId: resolved.classId, date })
    ).populate({
      path: 'studentId',
      select: 'name rollNo admissionId',
      match: { isDeleted: { $ne: true } },
    });

    const attendanceObj = {};
    attendance.forEach((record) => {
      if (record.studentId) {
        attendanceObj[record.studentId._id.toString()] = {
          status: record.status,
          markedBy: record.markedBy,
        };
      }
    });

    res.json(attendanceObj);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Issue #50 Fix: Shared helper for bulk attendance marking (used by POST /class and POST /bulk)
async function markBulkAttendance(req, res) {
  const { classId, date, attendance, clientTimestamp } = req.body;

  if (!classId || !date || !Array.isArray(attendance)) {
    return res.status(400).json({ error: 'classId, date, and attendance array are required' });
  }

  // Reject future dates — attendance cannot be marked in advance. "Today"
  // MUST be the local date, not UTC; after UTC midnight IST users marking
  // today's attendance were rejected as "future date" because UTC was
  // still the prior day.
  const today = localTodayString();
  if (date > today) {
    return res.status(400).json({ error: 'Cannot mark attendance for a future date' });
  }

  const resolved = await resolveClassId(classId, req.user?.schoolId);
  if (!resolved) {
    return res.status(404).json({ error: req.t('common:errors.classNotFound') });
  }

  const schoolId = await resolveRequestSchoolId(req);

  // Weekend/holiday validation — warn if marking on a non-working day or holiday
  try {
    const settings = await SchoolSettings.findOne({ schoolId });
    if (settings) {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      // Parse the YYYY-MM-DD string as a LOCAL date (not UTC) before deriving
      // the weekday. `new Date('2026-07-15')` is parsed as UTC midnight, so
      // getUTCDay() flips to the prior day for IST users after ~5:30am. The
      // `date` string is already the school's local calendar date, so the
      // 'T00:00:00' suffix pins it to local midnight and .getDay() yields the
      // correct local weekday. Mirrors the localTodayString() pattern used
      // elsewhere in this file (comments at lines 251-256).
      const attendanceDate = new Date(`${date}T00:00:00`);
      const dayOfWeek = dayNames[attendanceDate.getDay()];
      const workingDays = settings.workingDays || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

      if (!workingDays.includes(dayOfWeek)) {
        return res.status(400).json({
          error: `Cannot mark attendance on ${dayOfWeek} — it is not a working day`,
          nonWorkingDay: true,
        });
      }

      // `date` is already the canonical YYYY-MM-DD calendar date — compare it
      // directly against holidays instead of round-tripping through a UTC
      // Date which can shift the day (the prior `toISOString().split('T')[0]`
      // re-derived the date from a UTC instant and drifted by a day off-UTC).
      const dateStr = date;
      const holiday = (settings.holidays || []).find((h) => h.date === dateStr);
      if (holiday) {
        return res.status(400).json({
          error: `Cannot mark attendance on ${dateStr} — it is a holiday (${holiday.name})`,
          holiday: true,
        });
      }
    }
  } catch (settingsErr) {
    // Non-blocking — if settings can't be fetched, allow attendance marking
  }

  // Dirty-state detection: reject if another user saved after the client loaded the data
  if (clientTimestamp) {
    const since = new Date(clientTimestamp);
    if (!isNaN(since.getTime())) {
      const changed = await Attendance.find(
        scopeBySchool(schoolId, { classId: resolved.classId, date, updatedAt: { $gt: since } })
      )
        .select('studentId')
        .lean();
      if (changed.length > 0) {
        return res.status(409).json({
          conflict: true,
          message:
            'Attendance was modified by another user after you loaded this page. Please refresh and try again.',
          conflictingStudentIds: changed.map((r) => r.studentId.toString()),
        });
      }
    }
  }

  const validStatuses = ['present', 'absent', 'late', 'leave', 'halfday'];
  const results = [];
  const skipped = [];

  // AUDIT-344: Verify all submitted students belong to this class
  const submittedStudentIds = attendance.map((r) => r.studentId).filter(Boolean);
  const validStudents = await Student.find(
    scopeBySchool(schoolId, {
      _id: { $in: submittedStudentIds },
      classId: resolved.classId,
      isDeleted: { $ne: true },
    })
  )
    .select('_id')
    .lean();
  const validStudentIdSet = new Set(validStudents.map((s) => s._id.toString()));

  // Pre-filter valid records vs skipped before the transaction
  const validRecords = [];
  for (const record of attendance) {
    const { studentId, status } = record;
    if (!studentId || !status || !validStatuses.includes(status)) {
      skipped.push({
        studentId: studentId || 'missing',
        reason: !studentId
          ? 'Missing studentId'
          : !status
            ? 'Missing status'
            : `Invalid status: ${status}`,
      });
      continue;
    }

    // AUDIT-344: Skip students not in this class
    if (!validStudentIdSet.has(studentId.toString())) {
      skipped.push({ studentId, reason: 'Student does not belong to this class' });
      continue;
    }

    validRecords.push(record);
  }

  // Look up existing attendance for this date BEFORE the upsert so we can
  // emit parent notifications only for students whose status actually
  // TRANSITIONED to absent. Previously every bulk-save dispatched an
  // absent notification for every 'absent' row, so saving the same sheet
  // twice sent duplicate SMS/push to every absent-student's parent.
  const priorDocs = await Attendance.find(
    scopeBySchool(schoolId, {
      studentId: { $in: validRecords.map((r) => r.studentId) },
      date,
    })
  )
    .select('studentId status')
    .lean();
  const priorStatusByStudent = new Map(priorDocs.map((d) => [d.studentId.toString(), d.status]));

  // AUDIT-443: Use a transaction so bulk attendance is atomic — all succeed or none
  const mongoSession = await mongoose.startSession();
  try {
    await mongoSession.withTransaction(async () => {
      for (const record of validRecords) {
        const attendanceRecord = await Attendance.findOneAndUpdate(
          scopeBySchool(schoolId, { studentId: record.studentId, date }),
          {
            studentId: record.studentId,
            classId: resolved.classId,
            date,
            status: record.status,
            markedBy: req.user?.id,
            schoolId,
          },
          { new: true, upsert: true, session: mongoSession }
        ).lean();

        results.push(attendanceRecord);
      }
    });
  } finally {
    await mongoSession.endSession();
  }

  dispatchWebhookEvent(schoolId, 'attendance.marked', {
    classId: resolved.classId,
    date,
    count: results.length,
    bulk: true,
  }).catch(() => {});

  // Recompute the class's averageAttendance so Class.averageAttendance isn't
  // permanently stale. Bulk marking touches a single class, so one call is
  // enough. Fire-and-forget — a recalculation failure must not fail the write.
  Class.updateAverageAttendance(resolved.classId, schoolId).catch((err) =>
    console.error('[Attendance] Failed to refresh class average attendance:', err.message)
  );

  const io = req.app.get('io');
  emitEvent(io, EVENTS.STUDENT_ATTENDANCE_BULK_UPDATED, {
    schoolId,
    classId: resolved.classId?.toString(),
    date,
    count: results.length,
  });

  // Notify parents only for students who TRANSITIONED to absent —
  // re-submitting the same sheet (or re-saving a correction) must not
  // trigger duplicate parent notifications.
  const absentStudentIds = validRecords
    .filter((r) => {
      if (r.status !== 'absent') return false;
      const prior = priorStatusByStudent.get(String(r.studentId));
      return prior !== 'absent';
    })
    .map((r) => r.studentId)
    .filter(Boolean);
  notifyParentsOfAbsent(absentStudentIds, date, schoolId);

  res.json({
    success: true,
    message:
      `Attendance marked for ${results.length} students` +
      (skipped.length > 0 ? `, ${skipped.length} skipped` : ''),
    results,
    ...(skipped.length > 0 && { skipped }),
  });
}

router.post(
  '/class',
  checkPermission('attendance', 'edit'),
  validateZod(bulkAttendanceSchema),
  async (req, res) => {
    try {
      await markBulkAttendance(req, res);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

router.get('/history/:classId', checkPermission('attendance', 'view'), async (req, res) => {
  try {
    const { classId } = req.params;
    const { start, end, academicYear } = req.query;

    const resolved = await resolveClassId(classId, req.user?.schoolId);
    if (!resolved) {
      return res.json([]);
    }

    const schoolId = await resolveRequestSchoolId(req);
    const query = scopeBySchool(schoolId, { classId: resolved.classId });
    if (start && end) {
      query.date = { $gte: start, $lte: end };
    } else if (start) {
      query.date = { $gte: start };
    } else if (end) {
      query.date = { $lte: end };
    } else if (academicYear) {
      // Scope to academic year date range when no explicit dates provided
      const dateRange = await getAcademicYearDateRange(academicYear, schoolId);
      if (dateRange) query.date = dateRange;
    }

    const attendance = await Attendance.find(query)
      .populate({
        path: 'studentId',
        select: 'name rollNo admissionId',
        match: { isDeleted: { $ne: true } },
      })
      .sort({ date: -1 });

    // Filter out records where student was deleted
    res.json(attendance.filter((r) => r.studentId != null));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/report/:classId', checkPermission('attendance', 'view'), async (req, res) => {
  try {
    const { classId } = req.params;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    const resolved = await resolveClassId(classId, req.user?.schoolId);
    if (!resolved) {
      return res.status(404).json({ error: req.t('common:errors.classNotFound') });
    }

    const attendance = await Attendance.find(
      scopeBySchool(req.user?.schoolId, {
        classId: resolved.classId,
        date: { $gte: startDate, $lte: endDate },
      })
    ).populate({
      path: 'studentId',
      select: 'name rollNo admissionId',
      match: { isDeleted: { $ne: true } },
    });

    const summary = {};
    attendance.forEach((record) => {
      if (!record.studentId) {
        return;
      }

      const studentKey = record.studentId._id.toString();
      if (!summary[studentKey]) {
        summary[studentKey] = {
          studentId: record.studentId._id,
          studentName: record.studentId.name,
          rollNo: record.studentId.rollNo,
          admissionId: record.studentId.admissionId,
          present: 0,
          absent: 0,
          late: 0,
          leave: 0,
          halfday: 0,
          total: 0,
        };
      }

      summary[studentKey][record.status] += 1;
      summary[studentKey].total += 1;
    });

    // AUDIT-456: Use configurable late weight from school settings
    const settings = await SchoolSettings.findOne({ schoolId: req.user?.schoolId }).lean();
    const lateW = (settings?.attendanceRules?.lateWeight ?? 100) / 100;

    const report = Object.values(summary).map((studentSummary) => ({
      ...studentSummary,
      percentage:
        studentSummary.total > 0
          ? (
              ((studentSummary.present +
                studentSummary.late * lateW +
                studentSummary.halfday * 0.5) /
                studentSummary.total) *
              100
            ).toFixed(2)
          : 0,
    }));

    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// IMPORTANT: /:classId/:date must be registered BEFORE /:studentId to avoid
// the single-param route shadowing two-param requests.
router.get('/:classId/:date', checkPermission('attendance', 'view'), async (req, res) => {
  try {
    const { classId, date } = req.params;
    const resolved = await resolveClassId(classId, req.user?.schoolId);

    if (!resolved) {
      return res.status(404).json({ error: req.t('common:errors.classNotFound') });
    }

    const schoolId = await resolveRequestSchoolId(req);
    const attendance = await Attendance.find(
      scopeBySchool(schoolId, { classId: resolved.classId, date })
    ).populate({
      path: 'studentId',
      select: 'name rollNo admissionId',
      match: { isDeleted: { $ne: true } },
    });

    // Return same shape as GET /class/:classId/:date for consistency
    const attendanceObj = {};
    attendance.forEach((record) => {
      if (record.studentId) {
        attendanceObj[record.studentId._id.toString()] = {
          status: record.status,
          markedBy: record.markedBy,
        };
      }
    });

    res.json(attendanceObj);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get(
  '/:studentId',
  validateObjectIdParam('studentId'),
  checkPermission('attendance', 'view'),
  async (req, res) => {
    try {
      const { studentId } = req.params;
      const { startDate, endDate, academicYear } = req.query;

      const schoolId = req.user?.schoolId;

      // AUDIT-457: Verify student is not soft-deleted before querying attendance
      const studentDoc = await Student.findOne(
        scopeBySchool(schoolId, { _id: studentId, isDeleted: { $ne: true } })
      )
        .select('_id')
        .lean();
      if (!studentDoc) {
        res.set('X-Total-Count', '0');
        res.set('X-Has-More', 'false');
        return res.json({});
      }

      const query = scopeBySchool(schoolId, { studentId });
      if (startDate || endDate) {
        query.date = {};
        if (startDate) {
          query.date.$gte = startDate;
        }
        if (endDate) {
          query.date.$lte = endDate;
        }
      } else if (academicYear) {
        // Scope to academic year date range when no explicit dates provided
        const dateRange = await getAcademicYearDateRange(academicYear, schoolId);
        if (dateRange) query.date = dateRange;
      }

      // AUDIT-66: Add pagination support
      const skip = parseInt(req.query.skip) || 0;
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const total = await Attendance.countDocuments(query);

      const attendance = await Attendance.find(query).sort({ date: -1 }).skip(skip).limit(limit);
      const attendanceObj = {};

      attendance.forEach((record) => {
        attendanceObj[record.date] = {
          status: record.status,
          markedBy: record.markedBy,
          classId: record.classId,
        };
      });

      res.set('X-Total-Count', String(total));
      res.set('X-Has-More', String(skip + attendance.length < total));
      res.json(attendanceObj);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

router.post(
  '/',
  checkPermission('attendance', 'edit'),
  validateZod(singleAttendanceSchema),
  async (req, res) => {
    try {
      const { studentId, classId, date, status, clientTimestamp } = req.body;

      const schoolId = await resolveRequestSchoolId(req);

      // AUDIT-345: Verify student belongs to the specified class
      if (classId && studentId) {
        const cacheKey = `attendance:student-class:${schoolId}:${studentId}`;
        let studentDoc = await cacheService.get(cacheKey);
        if (!studentDoc) {
          studentDoc = await Student.findOne(
            scopeBySchool(schoolId, { _id: studentId, isDeleted: { $ne: true } })
          )
            .select('classId')
            .lean();
          if (studentDoc) {
            await cacheService.set(cacheKey, studentDoc, 30_000); // 30s TTL
          }
        }
        if (!studentDoc) {
          return res.status(404).json({ error: 'Student not found' });
        }
        if (studentDoc.classId && classId !== studentDoc.classId.toString()) {
          return res.status(400).json({ error: 'Student does not belong to the specified class' });
        }
      }

      // Dirty-state detection for single record
      if (clientTimestamp) {
        const since = new Date(clientTimestamp);
        if (!isNaN(since.getTime())) {
          const existing = await Attendance.findOne(
            scopeBySchool(schoolId, { studentId, date, updatedAt: { $gt: since } })
          )
            .select('_id')
            .lean();
          if (existing) {
            return res.status(409).json({
              conflict: true,
              message:
                'Attendance record was modified after you loaded it. Please refresh and try again.',
            });
          }
        }
      }

      // Look up the existing attendance record BEFORE the upsert so we can
      // notify parents only on a genuine TRANSITION to absent. Re-saving an
      // already-absent record (e.g. correcting a different field) must not
      // re-fire the parent SMS/push — mirrors the bulk path's
      // priorStatusByStudent transition check.
      const priorAttendance = await Attendance.findOne(scopeBySchool(schoolId, { studentId, date }))
        .select('status')
        .lean();
      const priorStatus = priorAttendance?.status;

      const attendance = await Attendance.findOneAndUpdate(
        scopeBySchool(schoolId, { studentId, date }),
        {
          studentId,
          classId,
          date,
          status,
          markedBy: req.user?.id,
          schoolId,
        },
        { new: true, upsert: true }
      ).lean();

      dispatchWebhookEvent(schoolId, 'attendance.marked', {
        studentId,
        classId,
        date,
        status,
      }).catch(() => {});

      // Recompute the affected class's averageAttendance so the stored value
      // stays current. Fire-and-forget — a recalculation failure must not fail
      // the attendance write.
      if (classId) {
        Class.updateAverageAttendance(classId, schoolId).catch((err) =>
          console.error('[Attendance] Failed to refresh class average attendance:', err.message)
        );
      }

      const io = req.app.get('io');
      emitEvent(io, EVENTS.STUDENT_ATTENDANCE_UPDATED, {
        schoolId,
        studentId: studentId?.toString(),
        classId: classId?.toString(),
        date,
        status,
      });

      // Notify parents only on a transition INTO absent (mirrors the bulk
      // path). Re-saving an already-absent record must not re-notify.
      if (status === 'absent' && priorStatus !== 'absent') {
        notifyParentsOfAbsent([studentId], date, schoolId);
      }

      res.json(attendance);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

router.post(
  '/bulk',
  checkPermission('attendance', 'edit'),
  validateZod(bulkAttendanceSchema),
  async (req, res) => {
    try {
      await markBulkAttendance(req, res);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// ─── Notify Parents of Absent Students ──────────────────────────────────
// On-demand endpoint to send absence notifications for a specific class+date.
// Used by the "Notify Parents" button in the dashboard attendance page.
router.post(
  '/notify-parents',
  notifyParentsLimiter,
  checkPermission('attendance', 'edit'),
  async (req, res) => {
    try {
      const { classId, date } = req.body;
      if (!classId || !date) {
        return res.status(400).json({ error: 'classId and date are required' });
      }
      // Validate classId is a valid ObjectId
      if (!/^[0-9a-fA-F]{24}$/.test(classId)) {
        return res.status(400).json({ error: 'Invalid classId format' });
      }
      // Validate date format is YYYY-MM-DD
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'Date must be in YYYY-MM-DD format' });
      }

      const schoolId = await resolveRequestSchoolId(req);

      // Find all absent students for the given class and date
      const absentRecords = await Attendance.find(
        scopeBySchool(schoolId, { classId, date, status: 'absent' })
      )
        .select('studentId')
        .lean();

      const absentStudentIds = absentRecords.map((r) => r.studentId?.toString()).filter(Boolean);

      if (absentStudentIds.length === 0) {
        return res.json({ success: true, message: 'No absent students to notify', notified: 0 });
      }

      // Send notifications (fire-and-forget, but we await to report count)
      await notifyParentsOfAbsent(absentStudentIds, date, schoolId);

      res.json({
        success: true,
        message: `Notifications sent for ${absentStudentIds.length} absent student(s)`,
        notified: absentStudentIds.length,
      });
    } catch (error) {
      console.error('Error notifying parents:', error);
      res.status(500).json({ error: error.message || 'Failed to notify parents' });
    }
  }
);

export default router;
