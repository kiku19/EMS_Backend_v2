import express from 'express';
import { Attendance } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import resolveClassId from '../utils/resolveClassId.js';
import { extractSchoolId, ensureDefaultSchool } from '../utils/schoolContext.js';

const router = express.Router();

function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) return { ...query };
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

router.get('/class/:classId/:date', authenticate, checkPermission('students', 'view'), async (req, res) => {
  try {
    const { classId, date } = req.params;
    const resolved = await resolveClassId(classId);

    if (!resolved) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const attendance = await Attendance.find(scopeBySchool(req.user?.schoolId, { classId: resolved.classId, date }))
      .populate('studentId', 'name rollNo admissionId');

    const attendanceObj = {};
    attendance.forEach((record) => {
      if (record.studentId) {
        attendanceObj[record.studentId._id.toString()] = {
          status: record.status,
          markedBy: record.markedBy
        };
      }
    });

    res.json(attendanceObj);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/class', authenticate, checkPermission('students', 'edit'), async (req, res) => {
  try {
    const { classId, date, attendance } = req.body;

    if (!classId || !date || !Array.isArray(attendance)) {
      return res.status(400).json({ error: 'classId, date, and attendance array are required' });
    }

    const resolved = await resolveClassId(classId);
    if (!resolved) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const schoolId = await resolveRequestSchoolId(req);
    const validStatuses = ['present', 'absent', 'late'];
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
          schoolId
        },
        { new: true, upsert: true }
      );

      results.push(attendanceRecord);
    }

    const io = req.app.get('io');
    if (io) {
      io.emit('student_attendance_bulk_updated', {
        type: 'bulk',
        classId: resolved.classId,
        date,
        count: results.length,
        timestamp: new Date()
      });
    }

    res.json({
      success: true,
      message: `Attendance marked for ${results.length} students`,
      results
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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

router.get('/report/:classId', authenticate, checkPermission('students', 'view'), async (req, res) => {
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
        date: { $gte: startDate, $lte: endDate }
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
          total: 0
        };
      }

      summary[studentKey][record.status] += 1;
      summary[studentKey].total += 1;
    });

    const report = Object.values(summary).map((studentSummary) => ({
      ...studentSummary,
      percentage: studentSummary.total > 0
        ? ((studentSummary.present + studentSummary.late) / studentSummary.total * 100).toFixed(2)
        : 0
    }));

    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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
        classId: record.classId
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
    const attendance = await Attendance.find(scopeBySchool(schoolId, { classId: resolved.classId, date }))
      .populate('studentId', 'name rollNo admissionId');

    const attendanceArray = attendance.map((record) => ({
      studentId: record.studentId?._id,
      studentName: record.studentId?.name,
      rollNo: record.studentId?.rollNo,
      status: record.status,
      markedBy: record.markedBy
    }));

    res.json(attendanceArray);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', authenticate, checkPermission('students', 'edit'), async (req, res) => {
  try {
    const { studentId, classId, date, status } = req.body;

    if (!studentId || !classId || !date || !status) {
      return res.status(400).json({ error: 'studentId, classId, date, and status are required' });
    }

    const validStatuses = ['present', 'absent', 'late'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be present, absent, or late' });
    }

    const schoolId = await resolveRequestSchoolId(req);
    const attendance = await Attendance.findOneAndUpdate(
      scopeBySchool(schoolId, { studentId, date }),
      {
        studentId,
        classId,
        date,
        status,
        markedBy: req.user?.id,
        schoolId
      },
      { new: true, upsert: true }
    );

    const io = req.app.get('io');
    if (io) {
      io.emit('student_attendance_updated', {
        type: 'student',
        studentId,
        classId,
        date,
        status,
        timestamp: new Date()
      });
    }

    res.json(attendance);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/bulk', authenticate, checkPermission('students', 'edit'), async (req, res) => {
  try {
    const { classId, date, attendance } = req.body;

    if (!classId || !date || !Array.isArray(attendance)) {
      return res.status(400).json({ error: 'classId, date, and attendance array are required' });
    }

    const resolved = await resolveClassId(classId);
    if (!resolved) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const schoolId = await resolveRequestSchoolId(req);
    const validStatuses = ['present', 'absent', 'late'];
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
          schoolId
        },
        { new: true, upsert: true }
      );

      results.push(attendanceRecord);
    }

    const io = req.app.get('io');
    if (io) {
      io.emit('student_attendance_bulk_updated', {
        type: 'bulk',
        classId: resolved.classId,
        date,
        count: results.length,
        timestamp: new Date()
      });
    }

    res.json({
      success: true,
      message: `Attendance marked for ${results.length} students`,
      results
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
