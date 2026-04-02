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
import { Attendance } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import resolveClassId from '../utils/resolveClassId.js';
import { extractSchoolId, ensureDefaultSchool } from '../utils/schoolContext.js';
import { dispatchWebhookEvent } from '../services/webhookService.js';
import { EVENTS, emitEvent } from '../utils/socketEvents.js';
import { validateZod } from '../validators/zodHelpers.js';
import { bulkAttendanceSchema, singleAttendanceSchema } from '../validators/attendanceSchema.js';
import { resolveAcademicYear, parseAcademicYear } from '../utils/academicYear.js';
import SchoolSettings from '../models/SchoolSettings.js';

/**
 * Convert an academic year (e.g. "2025-26") into a date range filter object.
 * Academic year runs April 1 to March 31.
 * Returns { $gte, $lte } for the date field, or null if no academic year.
 */
async function getAcademicYearDateRange(academicYear, schoolId) {
  if (!academicYear) return null;
  const resolved = await resolveAcademicYear(academicYear, schoolId);
  const { startYear, endYear } = parseAcademicYear(resolved);
  return {
    $gte: `${startYear}-04-01`,
    $lte: `${endYear}-03-31`,
  };
}

async function notifyParentsOfAbsent(absentStudentIds, date, schoolId) {
  if (!absentStudentIds.length) return;
  try {
    const { sendNotification } = await import('./notifications.js');
    const { Parent, Student } = await import('../database.js');
    const { sendAttendanceAlertWhatsApp } = await import('../services/whatsappService.js');
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
          const student = await Student.findById(studentId).select('name').lean();
          sendAttendanceAlertWhatsApp(parent.phone, {
            studentName: student?.name || 'your child',
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
router.get(
  '/today-snapshot',
  checkPermission('attendance', 'view'),
  async (req, res) => {
    try {
      const schoolId = await resolveRequestSchoolId(req);
      const today = new Date().toISOString().split('T')[0];

      const records = await Attendance.find(scopeBySchool(schoolId, { date: today }))
        .select('classId studentId status')
        .lean();

      // Group by classId → { present, absent, late, leave, halfday, total }
      const byClass = {};
      for (const record of records) {
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
  }
);

router.get(
  '/student/:studentId',
  checkPermission('attendance', 'view'),
  async (req, res) => {
    try {
      const { studentId } = req.params;
      const { start, end, academicYear } = req.query;

      const schoolId = await resolveRequestSchoolId(req);
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

router.get(
  '/class/:classId/:date',
  checkPermission('attendance', 'view'),
  async (req, res) => {
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
  }
);

// Issue #50 Fix: Shared helper for bulk attendance marking (used by POST /class and POST /bulk)
async function markBulkAttendance(req, res) {
  const { classId, date, attendance, clientTimestamp } = req.body;

  if (!classId || !date || !Array.isArray(attendance)) {
    return res.status(400).json({ error: 'classId, date, and attendance array are required' });
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
      const attendanceDate = new Date(date);
      const dayOfWeek = dayNames[attendanceDate.getUTCDay()];
      const workingDays = settings.workingDays || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

      if (!workingDays.includes(dayOfWeek)) {
        return res.status(400).json({
          error: `Cannot mark attendance on ${dayOfWeek} — it is not a working day`,
          nonWorkingDay: true,
        });
      }

      const dateStr = attendanceDate.toISOString().split('T')[0];
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

  for (const record of attendance) {
    const { studentId, status } = record;
    if (!studentId || !status || !validStatuses.includes(status)) {
      skipped.push({
        studentId: studentId || 'missing',
        reason: !studentId ? 'Missing studentId' : !status ? 'Missing status' : `Invalid status: ${status}`,
      });
      continue;
    }

    const attendanceRecord = await Attendance.findOneAndUpdate(
      scopeBySchool(schoolId, { studentId, date }),
      {
        studentId,
        classId: resolved.classId,
        date,
        status,
        markedBy: req.user?.id,
        schoolId,
      },
      { new: true, upsert: true }
    );

    results.push(attendanceRecord);
  }

  dispatchWebhookEvent(schoolId, 'attendance.marked', {
    classId: resolved.classId,
    date,
    count: results.length,
    bulk: true,
  }).catch(() => {});

  const io = req.app.get('io');
  emitEvent(io, EVENTS.STUDENT_ATTENDANCE_BULK_UPDATED, {
    schoolId,
    classId: resolved.classId?.toString(),
    date,
    count: results.length,
  });

  // Notify parents of absent students
  const absentStudentIds = attendance
    .filter((r) => r.status === 'absent')
    .map((r) => r.studentId)
    .filter(Boolean);
  notifyParentsOfAbsent(absentStudentIds, date, schoolId);

  res.json({
    success: true,
    message: `Attendance marked for ${results.length} students` + (skipped.length > 0 ? `, ${skipped.length} skipped` : ''),
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

router.get(
  '/history/:classId',
  checkPermission('attendance', 'view'),
  async (req, res) => {
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
  }
);

router.get(
  '/report/:classId',
  checkPermission('attendance', 'view'),
  async (req, res) => {
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

      const report = Object.values(summary).map((studentSummary) => ({
        ...studentSummary,
        percentage:
          studentSummary.total > 0
            ? (
                ((studentSummary.present + studentSummary.late) / studentSummary.total) *
                100
              ).toFixed(2)
            : 0,
      }));

      res.json(report);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// IMPORTANT: /:classId/:date must be registered BEFORE /:studentId to avoid
// the single-param route shadowing two-param requests.
router.get(
  '/:classId/:date',
  checkPermission('attendance', 'view'),
  async (req, res) => {
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
  }
);

router.get('/:studentId', checkPermission('attendance', 'view'), async (req, res) => {
  try {
    const { studentId } = req.params;
    const { startDate, endDate, academicYear } = req.query;

    const query = scopeBySchool(req.user?.schoolId, { studentId });
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
      const dateRange = await getAcademicYearDateRange(academicYear, req.user?.schoolId);
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
});

router.post(
  '/',
  checkPermission('attendance', 'edit'),
  validateZod(singleAttendanceSchema),
  async (req, res) => {
    try {
      const { studentId, classId, date, status, clientTimestamp } = req.body;

      const schoolId = await resolveRequestSchoolId(req);

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
      );

      dispatchWebhookEvent(schoolId, 'attendance.marked', {
        studentId,
        classId,
        date,
        status,
      }).catch(() => {});

      const io = req.app.get('io');
      emitEvent(io, EVENTS.STUDENT_ATTENDANCE_UPDATED, {
        schoolId,
        studentId: studentId?.toString(),
        classId: classId?.toString(),
        date,
        status,
      });

      if (status === 'absent') {
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
  checkPermission('attendance', 'edit'),
  async (req, res) => {
    try {
      const { classId, date } = req.body;
      if (!classId || !date) {
        return res.status(400).json({ error: 'classId and date are required' });
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
