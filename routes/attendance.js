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
 *                 enum: [present, absent, late, half-day, excused]
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

async function notifyParentsOfAbsent(absentStudentIds, date) {
  if (!absentStudentIds.length) return;
  try {
    const { sendNotification } = await import('./notifications.js');
    const { Parent, Student } = await import('../database.js');
    const { sendAttendanceAlertWhatsApp } = await import('../services/whatsappService.js');
    for (const studentId of absentStudentIds) {
      const parents = await Parent.find({ 'children.studentId': studentId }).select(
        '_id phone preferences'
      );
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

router.get('/student/:studentId', authenticate, async (req, res) => {
  try {
    const { studentId } = req.params;
    const { start, end } = req.query;

    const schoolId = await resolveRequestSchoolId(req);
    const query = scopeBySchool(schoolId, { studentId });
    if (start && end) {
      query.date = { $gte: start, $lte: end };
    } else if (start) {
      query.date = { $gte: start };
    } else if (end) {
      query.date = { $lte: end };
    }

    const attendance = await Attendance.find(query)
      .populate('studentId', 'name rollNo admissionId')
      .sort({ date: -1 });

    res.json(attendance);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get(
  '/class/:classId/:date',
  authenticate,
  checkPermission('students', 'view'),
  async (req, res) => {
    try {
      const { classId, date } = req.params;
      const resolved = await resolveClassId(classId);

      if (!resolved) {
        return res.status(404).json({ error: 'Class not found' });
      }

      const attendance = await Attendance.find(
        scopeBySchool(req.user?.schoolId, { classId: resolved.classId, date })
      ).populate('studentId', 'name rollNo admissionId');

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

  const resolved = await resolveClassId(classId);
  if (!resolved) {
    return res.status(404).json({ error: 'Class not found' });
  }

  const schoolId = await resolveRequestSchoolId(req);

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

  for (const record of attendance) {
    const { studentId, status } = record;
    if (!studentId || !status || !validStatuses.includes(status)) {
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
  notifyParentsOfAbsent(absentStudentIds, date);

  res.json({
    success: true,
    message: `Attendance marked for ${results.length} students`,
    results,
  });
}

router.post(
  '/class',
  authenticate,
  checkPermission('students', 'edit'),
  validateZod(bulkAttendanceSchema),
  async (req, res) => {
    try {
      await markBulkAttendance(req, res);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

router.get('/history/:classId', authenticate, async (req, res) => {
  try {
    const { classId } = req.params;
    const { start, end } = req.query;

    const resolved = await resolveClassId(classId);
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
    }

    const attendance = await Attendance.find(query)
      .populate('studentId', 'name rollNo admissionId')
      .sort({ date: -1 });

    res.json(attendance);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get(
  '/report/:classId',
  authenticate,
  checkPermission('students', 'view'),
  async (req, res) => {
    try {
      const { classId } = req.params;
      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({ error: 'startDate and endDate are required' });
      }

      const resolved = await resolveClassId(classId);
      if (!resolved) {
        return res.status(404).json({ error: 'Class not found' });
      }

      const attendance = await Attendance.find(
        scopeBySchool(req.user?.schoolId, {
          classId: resolved.classId,
          date: { $gte: startDate, $lte: endDate },
        })
      ).populate('studentId', 'name rollNo admissionId');

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

router.get('/:studentId', authenticate, checkPermission('students', 'view'), async (req, res) => {
  try {
    const { studentId } = req.params;
    const { startDate, endDate } = req.query;

    const query = scopeBySchool(req.user?.schoolId, { studentId });
    if (startDate || endDate) {
      query.date = {};
      if (startDate) {
        query.date.$gte = startDate;
      }
      if (endDate) {
        query.date.$lte = endDate;
      }
    }

    const attendance = await Attendance.find(query).sort({ date: -1 });
    const attendanceObj = {};

    attendance.forEach((record) => {
      attendanceObj[record.date] = {
        status: record.status,
        markedBy: record.markedBy,
        classId: record.classId,
      };
    });

    res.json(attendanceObj);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:classId/:date', authenticate, async (req, res) => {
  try {
    const { classId, date } = req.params;
    const resolved = await resolveClassId(classId);

    if (!resolved) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const schoolId = await resolveRequestSchoolId(req);
    const attendance = await Attendance.find(
      scopeBySchool(schoolId, { classId: resolved.classId, date })
    ).populate('studentId', 'name rollNo admissionId');

    const attendanceArray = attendance.map((record) => ({
      studentId: (record.studentId?._id || record.studentId)?.toString() || null,
      studentName: record.studentId?.name || null,
      rollNo: record.studentId?.rollNo || null,
      status: record.status,
      markedBy: record.markedBy,
    }));

    res.json(attendanceArray);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post(
  '/',
  authenticate,
  checkPermission('students', 'edit'),
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
        notifyParentsOfAbsent([studentId], date);
      }

      res.json(attendance);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

router.post(
  '/bulk',
  authenticate,
  checkPermission('students', 'edit'),
  validateZod(bulkAttendanceSchema),
  async (req, res) => {
    try {
      await markBulkAttendance(req, res);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

export default router;
