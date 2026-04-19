import express from 'express';
import {
  Staff,
  Class,
  Student,
  Attendance,
  Timetable,
  TeacherTimetable,
  Substitution,
  StaffAttendance,
  Remark,
  Exam,
  Result,
  Announcement,
  GatePass,
  Appointment,
} from '../database.js';
import Homework from '../models/Homework.js';
import StaffProfileAudit from '../models/StaffProfileAudit.js';
import { authenticate } from '../middleware/auth.js';
import { validateStaffProfileUpdate } from '../middleware/staffValidation.js';
import { emitStaffUpdate } from '../utils/socketEmitter.js';
import { EVENTS, emitEvent } from '../utils/socketEvents.js';
import { extractSchoolId, ensureDefaultSchool } from '../utils/schoolContext.js';
import { createLogger } from '../utils/logger.js';

const router = express.Router();

/** Configure via environment variables:
 *   STAFF_APP_MIN_VERSION       e.g. "1.0.0"
 *   STAFF_APP_LATEST_VERSION    e.g. "1.2.0"
 *   STAFF_APP_FORCE_UPDATE      "true" | "false"
 *   STAFF_APP_STORE_URL_IOS     App Store URL
 *   STAFF_APP_STORE_URL_ANDROID Play Store URL
 *   STAFF_APP_UPDATE_MESSAGE    Custom message shown in the update prompt
 */
router.get('/app-version', async (req, res) => {
  try {
    const minimumVersion = process.env.STAFF_APP_MIN_VERSION || '1.0.0';
    const latestVersion = process.env.STAFF_APP_LATEST_VERSION || '1.0.0';
    const forceUpdate = process.env.STAFF_APP_FORCE_UPDATE === 'true';
    const storeUrlIos = process.env.STAFF_APP_STORE_URL_IOS || null;
    const storeUrlAndroid = process.env.STAFF_APP_STORE_URL_ANDROID || null;
    const updateMessage =
      process.env.STAFF_APP_UPDATE_MESSAGE ||
      'A new version of the app is required. Please update to continue.';

    return res.json({
      success: true,
      minimumVersion,
      latestVersion,
      forceUpdate,
      storeUrlIos,
      storeUrlAndroid,
      updateMessage,
    });
  } catch (error) {
    logger.error({ err: error }, 'Error fetching app version config');
    res.status(500).json({ error: 'Failed to fetch app version' });
  }
});
router.use(authenticate);
const logger = createLogger('Mobile');

/**
 * Middleware: only allow a teacher to access their own /:teacherId routes.
 * Admins (role contains 'Admin' or 'admin') may access any teacher's routes.
 */
function requireSelfOrAdmin(req, res, next) {
  const { teacherId } = req.params;
  const userId = req.user?.id || req.user?.userId;
  const roles = Array.isArray(req.user?.role) ? req.user.role : [req.user?.role || ''];
  const isAdmin = roles.some((r) => /admin/i.test(r));
  if (isAdmin || userId === teacherId) {
    return next();
  }
  return res.status(403).json({ error: 'Forbidden: you may only access your own data' });
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

// ============ TEACHER MOBILE API ============

// Get teacher dashboard data
router.get('/teacher/:teacherId/dashboard', requireSelfOrAdmin, async (req, res) => {
  try {
    const { teacherId } = req.params;
    const today = new Date().toISOString().split('T')[0];
    const schoolId = req.user?.schoolId;

    // Get teacher details
    const teacher = await Staff.findOne(scopeBySchool(schoolId, { _id: teacherId }));
    if (!teacher) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    // Run queries in parallel for better performance
    const [classTeacherOf, todayAttendance, teacherTimetable, substitutions, unreadAnnouncements] =
      await Promise.all([
        // Check if class teacher
        Class.findOne(scopeBySchool(schoolId, { classTeacherId: teacherId })).lean(),

        // Get today's attendance status
        StaffAttendance.findOne(
          scopeBySchool(schoolId, {
            staffId: teacherId,
            date: today,
          })
        ).lean(),

        // Get today's timetable
        TeacherTimetable.findOne(scopeBySchool(schoolId, { teacherId })).lean(),

        // Get substitution alerts (assigned as substitute)
        Substitution.find(
          scopeBySchool(schoolId, {
            substituteTeacherId: teacherId,
            date: { $gte: today },
            status: { $in: ['pending', 'confirmed'] },
          })
        )
          .populate('classId', 'name section')
          .populate('absentTeacherId', 'name')
          .limit(10)
          .lean(),

        // Get unread announcements count
        Announcement.countDocuments(
          scopeBySchool(schoolId, {
            targetAudience: { $in: ['all', 'staff'] },
            createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          })
        ),
      ]);

    // Get today's schedule
    const timezone = req.query.timezone || 'Asia/Kolkata';
    const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: timezone });
    const todaySchedule = teacherTimetable?.schedule?.[dayName] || [];

    // Get gate pass requests and appointments (if class teacher)
    let gatePasses = [];
    let appointments = [];

    if (classTeacherOf) {
      // Run class teacher queries in parallel
      // FIXED: Filter by status and isDeleted for consistency
      const [students, classAppointments] = await Promise.all([
        Student.find(
          scopeBySchool(schoolId, {
            classId: classTeacherOf._id,
            status: 'active',
            isDeleted: { $ne: true },
          })
        )
          .select('_id')
          .lean(),
        Appointment.find(
          scopeBySchool(schoolId, {
            meetingWith: teacher.name,
            fromDateTime: { $gte: new Date() },
            status: 'scheduled',
          })
        )
          .sort({ fromDateTime: 1 })
          .limit(5)
          .lean(),
      ]);

      const studentIds = students.map((s) => s._id);

      // Get gate passes
      if (studentIds.length > 0) {
        gatePasses = await GatePass.find(
          scopeBySchool(schoolId, {
            studentId: { $in: studentIds },
            date: { $gte: today },
            status: 'pending',
          })
        )
          .populate('studentId', 'name rollNo')
          .limit(10)
          .lean();
      }

      appointments = classAppointments;
    }

    res.json({
      teacher: {
        id: teacher._id,
        name: teacher.name,
        code: teacher.code,
        role: teacher.role,
        photo: teacher.picture,
      },
      classTeacher: classTeacherOf
        ? {
            id: classTeacherOf._id,
            name: classTeacherOf.name,
            section: classTeacherOf.section,
          }
        : null,
      attendance: {
        date: today,
        status: todayAttendance?.status || null,
        inTime: todayAttendance?.inTime || null,
        outTime: todayAttendance?.outTime || null,
      },
      timetable: todaySchedule,
      substitutions: substitutions || [],
      gatePasses: gatePasses || [],
      appointments: appointments || [],
      unreadAnnouncements: unreadAnnouncements || 0,
    });
  } catch (error) {
    logger.error({ err: error }, 'Error loading teacher dashboard');
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// Get teacher's full timetable
router.get('/teacher/:teacherId/timetable', requireSelfOrAdmin, async (req, res) => {
  try {
    const { teacherId } = req.params;
    const schoolId = req.user?.schoolId;

    const teacherTimetable = await TeacherTimetable.findOne(scopeBySchool(schoolId, { teacherId }))
      .populate('schedule.Monday.classId', 'name section room')
      .populate('schedule.Tuesday.classId', 'name section room')
      .populate('schedule.Wednesday.classId', 'name section room')
      .populate('schedule.Thursday.classId', 'name section room')
      .populate('schedule.Friday.classId', 'name section room')
      .populate('schedule.Saturday.classId', 'name section room');

    if (!teacherTimetable) {
      return res.json({ schedule: {} });
    }

    res.json(teacherTimetable.schedule);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark teacher attendance (self)
router.post(
  '/teacher/:teacherId/attendance',
  requireSelfOrAdmin,
  async (req, res) => {
    try {
      const { teacherId } = req.params;
      const { status, inTime, outTime } = req.body;
      const today = new Date().toISOString().split('T')[0];
      const schoolId = await resolveRequestSchoolId(req);

      const attendance = await StaffAttendance.findOneAndUpdate(
        scopeBySchool(schoolId, { staffId: teacherId, date: today }),
        { status, checkInTime: inTime, checkOutTime: outTime, schoolId },
        { new: true, upsert: true }
      );

      // Emit socket event (matches webapp's expected event structure)
      const io = req.app.get('io');

      emitEvent(io, EVENTS.ATTENDANCE_UPDATED, {
        schoolId: req.user?.schoolId?.toString(),
        type: 'staff',
        staffId: teacherId?.toString(),
        date: today,
        status,
        inTime: attendance.checkInTime || '-',
        outTime: attendance.checkOutTime || '-',
        reason: attendance.reason || '',
      });

      res.json(attendance);
    } catch (error) {
      logger.error({ err: error }, 'Error marking teacher attendance');
      res.status(500).json({ error: 'Failed to mark attendance' });
    }
  }
);

// Reset teacher attendance (dev/admin only)
router.delete(
  '/teacher/:teacherId/attendance',
  requireSelfOrAdmin,
  async (req, res) => {
    try {
      const { teacherId } = req.params;
      const today = new Date().toISOString().split('T')[0];
      const schoolId = await resolveRequestSchoolId(req);

      const result = await StaffAttendance.findOneAndDelete(
        scopeBySchool(schoolId, { staffId: teacherId, date: today })
      );

      if (!result) {
        return res.status(404).json({ error: 'No attendance record found for today' });
      }

      // Emit socket event to update real-time views
      const io = req.app.get('io');
      emitEvent(io, EVENTS.ATTENDANCE_UPDATED, {
        schoolId: req.user?.schoolId?.toString(),
        type: 'staff',
        staffId: teacherId?.toString(),
        date: today,
        status: 'unmarked',
        inTime: '-',
        outTime: '-',
        reason: '',
      });

      res.json({ success: true, message: 'Attendance reset successfully' });
    } catch (error) {
      logger.error({ err: error }, 'Error resetting teacher attendance');
      res.status(500).json({ error: 'Failed to reset attendance' });
    }
  }
);

// Get class students for attendance (class teacher only)
router.get(
  '/teacher/:teacherId/class-students',
  requireSelfOrAdmin,
  async (req, res) => {
    try {
      const { teacherId } = req.params;
      const schoolId = req.user?.schoolId;

      // Find class where teacher is class teacher
      const classData = await Class.findOne(scopeBySchool(schoolId, { classTeacherId: teacherId }));
      if (!classData) {
        return res.status(404).json({ error: 'Not a class teacher' });
      }

      // FIXED: Filter by status='active' AND isDeleted!=true for consistency
      const students = await Student.find(
        scopeBySchool(schoolId, {
          classId: classData._id,
          status: 'active',
          isDeleted: { $ne: true },
        })
      ).sort({ rollNo: 1 });

      res.json({
        class: {
          id: classData._id.toString(), // FIX: id as string
          name: classData.name,
          section: classData.section,
        },
        students: students.map((s) => ({
          id: s._id.toString(), // FIX: id as string
          name: s.name,
          rollNo: s.rollNo,
          admissionId: s.admissionId,
          photo: s.photo,
        })),
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// Get class attendance for a date
router.get(
  '/teacher/:teacherId/class-attendance/:date',
  requireSelfOrAdmin,
  async (req, res) => {
    try {
      const { teacherId, date } = req.params;
      const schoolId = req.user?.schoolId;

      // Find class where teacher is class teacher
      const classData = await Class.findOne(scopeBySchool(schoolId, { classTeacherId: teacherId }));
      if (!classData) {
        return res.status(404).json({ error: 'Not a class teacher' });
      }

      const attendance = await Attendance.find({
        classId: classData._id,
        date,
      });

      const attendanceMap = {};
      attendance.forEach((att) => {
        attendanceMap[att.studentId.toString()] = att.status;
      });

      res.json(attendanceMap);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// Mark class attendance (class teacher only)
router.post(
  '/teacher/:teacherId/class-attendance',
  requireSelfOrAdmin,
  async (req, res) => {
    try {
      const { teacherId } = req.params;
      const { date, attendance } = req.body; // attendance: [{ studentId, status }]
      const schoolId = req.user?.schoolId;

      // Verify teacher is class teacher
      const classData = await Class.findOne(scopeBySchool(schoolId, { classTeacherId: teacherId }));
      if (!classData) {
        return res.status(403).json({ error: 'Not authorized' });
      }

      // Validate date is not in the future
      const today = new Date().toISOString().split('T')[0];
      if (date > today) {
        return res.status(400).json({ error: 'Cannot mark attendance for a future date' });
      }

      if (!Array.isArray(attendance) || attendance.length === 0) {
        return res.status(400).json({ error: 'attendance array is required' });
      }

      // Validate status values
      const validStatuses = ['present', 'absent', 'late', 'leave', 'halfday'];
      const invalidRecords = attendance.filter((r) => !validStatuses.includes(r.status));
      if (invalidRecords.length > 0) {
        return res
          .status(400)
          .json({ error: `Invalid status values. Must be one of: ${validStatuses.join(', ')}` });
      }

      // Validate all student IDs belong to this class
      const studentIds = attendance.map((r) => r.studentId);
      const classStudents = await Student.find(
        scopeBySchool(schoolId, {
          _id: { $in: studentIds },
          classId: classData._id,
          status: 'active',
          isDeleted: { $ne: true },
        })
      ).select('_id');
      const validStudentIds = new Set(classStudents.map((s) => s._id.toString()));
      const invalidStudents = studentIds.filter((id) => !validStudentIds.has(id));
      if (invalidStudents.length > 0) {
        return res
          .status(400)
          .json({ error: `${invalidStudents.length} student(s) do not belong to this class` });
      }

      const results = [];
      for (const record of attendance) {
        const att = await Attendance.findOneAndUpdate(
          scopeBySchool(schoolId, { studentId: record.studentId, date }),
          {
            studentId: record.studentId,
            classId: classData._id,
            date,
            status: record.status,
            markedBy: teacherId,
            schoolId: extractSchoolId(schoolId),
          },
          { new: true, upsert: true }
        );
        results.push(att);
      }

      // Emit socket event
      const io = req.app.get('io');
      io?.emit('class_attendance_marked', {
        classId: classData._id,
        date,
        count: results.length,
        timestamp: new Date(),
      });

      res.json({
        success: true,
        message: `Attendance marked for ${results.length} students`,
        results,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// Get class overview (for class teacher)
router.get(
  '/teacher/:teacherId/class-overview',
  requireSelfOrAdmin,
  async (req, res) => {
    try {
      const { teacherId } = req.params;
      const schoolId = req.user?.schoolId;

      const classData = await Class.findOne(scopeBySchool(schoolId, { classTeacherId: teacherId }));
      if (!classData) {
        return res.status(404).json({ error: 'Not a class teacher' });
      }

      // Get all students
      // FIXED: Filter by status and isDeleted for consistency
      const students = await Student.find(
        scopeBySchool(schoolId, {
          classId: classData._id,
          status: 'active',
          isDeleted: { $ne: true },
        })
      );

      // Get low attendance students (< 75%)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const attendanceRecords = await Attendance.find(
        scopeBySchool(schoolId, {
          studentId: { $in: students.map((s) => s._id) },
          date: { $gte: thirtyDaysAgo.toISOString().split('T')[0] },
        })
      );

      const studentAttendance = {};
      attendanceRecords.forEach((att) => {
        const sid = att.studentId.toString();
        if (!studentAttendance[sid]) {
          studentAttendance[sid] = { present: 0, total: 0 };
        }
        studentAttendance[sid].total++;
        if (att.status === 'present' || att.status === 'late') {
          studentAttendance[sid].present++;
        }
      });

      const lowAttendanceStudents = students
        .filter((s) => {
          const stats = studentAttendance[s._id.toString()];
          if (!stats || stats.total === 0) return true;
          const percentage = (stats.present / stats.total) * 100;
          return percentage < 75;
        })
        .map((s) => ({
          id: s._id,
          name: s.name,
          rollNo: s.rollNo,
          attendancePercentage: (!studentAttendance[s._id.toString()] || studentAttendance[s._id.toString()].total === 0)
            ? 0
            : Math.round(
                (studentAttendance[s._id.toString()].present /
                  studentAttendance[s._id.toString()].total) *
                  100
              ),
        }));

      // Get failed students (from recent results)
      const recentResults = await Result.find({
        studentId: { $in: students.map((s) => s._id) },
        isPublished: true,
      })
        .sort({ createdAt: -1 })
        .limit(100);

      const failedStudents = [];
      recentResults.forEach((r) => {
        if (r.status === 'failed') {
          const student = students.find((s) => s._id.toString() === r.studentId.toString());
          if (student && !failedStudents.find((f) => f.id.toString() === student._id.toString())) {
            failedStudents.push({
              id: student._id,
              name: student.name,
              rollNo: student.rollNo,
              percentage: r.percentage,
            });
          }
        }
      });

      // Get fee pending students
      const StudentFeeStructure = (await import('../models/StudentFeeStructure.js')).default;
      const feeStructures = await StudentFeeStructure.find({
        studentId: { $in: students.map((s) => s._id) },
        overallStatus: { $in: ['pending', 'partial'] },
      }).populate('studentId', 'name rollNo');

      const feePendingStudents = feeStructures.map((fs) => ({
        id: fs.studentId._id,
        name: fs.studentId.name,
        rollNo: fs.studentId.rollNo,
        totalFee: fs.totalFee,
        totalPaid: fs.totalPaid,
        balance: fs.totalBalance,
        status: fs.overallStatus,
      }));

      res.json({
        class: {
          id: classData._id,
          name: classData.name,
          section: classData.section,
          totalStudents: students.length,
        },
        lowAttendanceStudents,
        failedStudents,
        feePendingStudents,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// Get announcements for teachers
router.get(
  '/teacher/:teacherId/announcements',
  requireSelfOrAdmin,
  async (req, res) => {
    try {
      const { limit = 20 } = req.query;

      const announcements = await Announcement.find({
        targetAudience: { $in: ['all', 'staff'] },
      })
        .sort({ createdAt: -1 })
        .limit(parseInt(limit));

      res.json(announcements);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// Get teacher leaves (mobile-specific endpoint)
router.get('/teacher/:teacherId/leaves', requireSelfOrAdmin, async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { status } = req.query;

    // Import TeacherLeave model
    const TeacherLeave = (await import('../models/TeacherLeave.js')).default;

    const query = { teacherId };
    if (status) query.status = status;

    const leaves = await TeacherLeave.find(query)
      .populate('approvedBy', 'name')
      .sort({ appliedAt: -1 })
      .lean();

    res.json(leaves);
  } catch (error) {
    logger.error({ err: error }, 'Error loading teacher leaves');
    res.status(500).json({ error: 'Failed to load leaves' });
  }
});

// Apply for leave (mobile-specific endpoint)
router.post('/teacher/:teacherId/leaves', requireSelfOrAdmin, async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { leaveType, reason, startDate, endDate, days, attachments } = req.body;

    // Import TeacherLeave model
    const TeacherLeave = (await import('../models/TeacherLeave.js')).default;

    // Calculate days if not provided
    let calculatedDays = days;
    if (!calculatedDays) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      calculatedDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
    }

    const leave = new TeacherLeave({
      teacherId,
      leaveType,
      reason,
      startDate,
      endDate,
      days: calculatedDays,
      attachments: attachments || [],
    });

    await leave.save();

    // Emit socket event for real-time notification
    const io = req.app.get('io');
    emitEvent(io, EVENTS.LEAVE_APPLIED, {
      schoolId: req.user?.schoolId?.toString(),
      leaveId: leave._id.toString(),
      teacherId: teacherId?.toString(),
      leaveType,
      startDate,
      endDate,
      days: calculatedDays,
    });

    const populatedLeave = await TeacherLeave.findById(leave._id)
      .populate('teacherId', 'name code')
      .lean();

    res.status(201).json(populatedLeave);
  } catch (error) {
    logger.error({ err: error }, 'Error applying for leave');
    res.status(500).json({ error: 'Failed to apply for leave' });
  }
});

// Get student details (for mobile view)
router.get(
  '/teacher/:teacherId/student/:studentId',
  requireSelfOrAdmin,
  async (req, res) => {
    try {
      const { teacherId, studentId } = req.params;
      const schoolId = req.user?.schoolId;

      // Get student with class info (MongoDB/Mongoose)
      const student = await Student.findOne(scopeBySchool(schoolId, { _id: studentId }))
        .populate('classId', 'name section')
        .lean();

      if (!student) {
        return res.status(404).json({ error: req.t('students:errors.notFound') });
      }

      // Get attendance stats (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const dateStr = thirtyDaysAgo.toISOString().split('T')[0];

      const attendanceRecords = await Attendance.find({
        studentId: student._id,
        date: { $gte: dateStr },
      }).lean();

      const stats = { present: 0, absent: 0, late: 0 };
      attendanceRecords.forEach((record) => {
        const status = record.status.toLowerCase();
        if (stats[status] !== undefined) {
          stats[status]++;
        }
      });

      // Handle legacy parent fields if parents array is empty
      let parents = student.parents || [];

      if (!parents || parents.length === 0) {
        parents = [
          {
            name: student.parentName,
            phone: student.parentPhone,
            email: student.parentEmail,
            relationship: student.parentRelationship || 'Parent',
          },
        ];
      }

      res.json({
        student: {
          id: student._id,
          name: student.name,
          rollNo: student.rollNo,
          admissionId: student.admissionId,
          photo: student.photo,
          class: student.classId
            ? {
                name: student.classId.name,
                section: student.classId.section,
              }
            : null,
          dob: student.dateOfBirth,
          gender: student.gender,
          address: student.address,
          phone: student.phone,
        },
        parents,
        attendance: stats,
      });
    } catch (error) {
      logger.error({ err: error }, 'Error fetching student details');
      res.status(500).json({ error: 'Failed to fetch student details' });
    }
  }
);

// ============ STAFF PROFILE API ============

/**
 * GET /api/mobile/staff/:staffId/profile
 * Get staff profile for self-service updates
 * - Returns only editable fields (no sensitive data like salary)
 * - Authentication required
 */
router.get('/staff/:staffId/profile', async (req, res) => {
  try {
    const { staffId } = req.params;

    // Find staff member
    const staff = await Staff.findOne(scopeBySchool(req.user?.schoolId, { _id: staffId })).lean();

    if (!staff) {
      return res.status(404).json({
        error: req.t('common:errors.staffNotFound'),
        message: `No staff member found with ID: ${staffId}`,
      });
    }

    // Extract only allowed/editable fields for mobile app
    const profileData = {
      id: staff._id,
      name: staff.name,
      code: staff.code,
      email: staff.email,
      phone: staff.phone,
      whatsappNumber: staff.whatsappNumber,
      bloodGroup: staff.bloodGroup,
      maritalStatus: staff.maritalStatus,
      address: staff.address,
      emergencyContacts: staff.emergencyContacts || [],
      picture: staff.picture,
      role: staff.role,
      department: staff.department,
      updatedAt: staff.updatedAt,
    };

    res.json(profileData);
  } catch (error) {
    logger.error({ err: error }, 'Error fetching staff profile');
    res.status(500).json({
      error: 'Failed to fetch profile',
      message: error.message,
    });
  }
});

/**
 * PUT /api/mobile/staff/:staffId/profile
 * Update staff profile (self-service)
 * - Validates input using staffValidation middleware
 * - Enforces self-service only (staff can only edit their own profile)
 * - Creates audit log entry
 * - Emits socket event for real-time updates
 * - Authentication required
 */
router.put(
  '/staff/:staffId/profile',
  validateStaffProfileUpdate,
  async (req, res) => {
    try {
      const { staffId } = req.params;
      const updateData = req.body;

      // Verify staffId matches authenticated user (self-service only)
      if (req.user.userId !== staffId) {
        // Check if user is admin (admin can edit any profile)
        const UserPermission = (await import('../database.js')).UserPermission;
        const permissions = await UserPermission.findOne({ userId: req.user.userId });

        if (!permissions || permissions.role !== 'admin') {
          return res.status(403).json({
            error: req.t('common:errors.forbidden'),
            message: 'You can only edit your own profile',
          });
        }
      }

      // Find staff member
      const staff = await Staff.findOne(scopeBySchool(req.user?.schoolId, { _id: staffId }));

      if (!staff) {
        return res.status(404).json({ error: req.t('common:errors.staffNotFound') });
      }

      // Detect which fields changed for audit log and socket event
      const fieldsChanged = [];
      const previousValues = {};

      Object.keys(updateData).forEach((field) => {
        const oldValue = staff[field];
        const newValue = updateData[field];

        // Compare values (handle arrays and nested objects)
        if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
          fieldsChanged.push(field);
          previousValues[field] = oldValue;
        }
      });

      if (fieldsChanged.length === 0) {
        return res.json({
          success: true,
          message: 'No changes to update',
          profile: staff,
        });
      }

      // Update staff profile
      Object.keys(updateData).forEach((field) => {
        staff[field] = updateData[field];
      });

      await staff.save();

      // Create audit log entry
      const auditLog = new StaffProfileAudit({
        timestamp: new Date(),
        staffId: staffId,
        action: 'profile_update',
        fieldsChanged: fieldsChanged,
        previousValues: previousValues,
        newValues: updateData,
        source: 'mobile_app',
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent'),
      });

      await auditLog.save();

      // Emit socket event for real-time updates
      emitStaffUpdate(staffId, fieldsChanged, 'mobile_app', {
        name: staff.name,
        role: staff.role,
        department: staff.department,
        status: staff.status,
        phone: staff.phone,
        email: staff.email,
        picture: staff.picture,
      });

      // Return updated profile
      const updatedProfile = {
        id: staff._id,
        name: staff.name,
        code: staff.code,
        email: staff.email,
        phone: staff.phone,
        whatsappNumber: staff.whatsappNumber,
        bloodGroup: staff.bloodGroup,
        maritalStatus: staff.maritalStatus,
        address: staff.address,
        emergencyContacts: staff.emergencyContacts || [],
        picture: staff.picture,
        role: staff.role,
        department: staff.department,
        updatedAt: staff.updatedAt,
      };

      res.json({
        success: true,
        message: 'Profile updated successfully',
        fieldsChanged: fieldsChanged,
        profile: updatedProfile,
      });
    } catch (error) {
      logger.error({ err: error }, 'Error updating staff profile');
      res.status(500).json({ error: 'Failed to update profile' });
    }
  }
);

// ============ STAFF PHOTO UPLOAD ============

/**
 * POST /api/mobile/staff/:staffId/photo
 * Upload staff profile photo from mobile app
 * - Authentication required
 * - Self-service only (staff can only upload their own photo, unless admin)
 * - Uploads to Cloudinary folder: 'staff-photos'
 * - Public ID: staff-${staffId}
 * - Overwrites existing photo
 * - Emits socket event for real-time updates
 */
router.post('/staff/:staffId/photo', async (req, res) => {
  try {
    const { staffId } = req.params;

    // Verify staffId matches authenticated user (self-service only)
    if (req.user.userId !== staffId) {
      // Check if user is admin (admin can upload any staff photo)
      const UserPermission = (await import('../database.js')).UserPermission;
      const permissions = await UserPermission.findOne({ userId: req.user.userId });

      if (!permissions || permissions.role !== 'admin') {
        return res.status(403).json({
          error: req.t('common:errors.forbidden'),
          message: 'You can only upload your own photo',
        });
      }
    }

    // Find staff member
    const staff = await Staff.findOne(scopeBySchool(req.user?.schoolId, { _id: staffId }));

    if (!staff) {
      return res.status(404).json({ error: req.t('common:errors.staffNotFound') });
    }

    // Check if photo file is present
    if (!req.body || !req.body.photo) {
      return res.status(400).json({ error: 'Photo data is required' });
    }

    const photoData = req.body.photo;

    // Import cloudinary
    const { v2: cloudinary } = await import('cloudinary');

    // Check if Cloudinary is configured
    const config = (await import('../config/environment.js')).config;
    if (!config.cloudinary.configured) {
      staff.picture = photoData;
      await staff.save();
    } else {
      // Upload to Cloudinary
      try {
        const uploadOptions = {
          folder: 'staff-photos',
          public_id: `staff-${staffId}`,
          overwrite: true,
          transformation: [{ width: 300, height: 300, crop: 'fill' }, { quality: 'auto' }],
          resource_type: 'image',
        };

        // Upload to Cloudinary
        const result = await cloudinary.uploader.upload(photoData, uploadOptions);

        const photoUrl = result.secure_url;

        // Update staff picture
        const previousPicture = staff.picture;
        staff.picture = photoUrl;
        await staff.save();

        // Create audit log entry
        const auditLog = new StaffProfileAudit({
          timestamp: new Date(),
          staffId: staffId,
          action: 'profile_update',
          fieldsChanged: ['picture'],
          previousValues: { picture: previousPicture },
          newValues: { picture: photoUrl },
          source: 'mobile_app',
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('user-agent'),
        });

        await auditLog.save();
        emitStaffUpdate(staffId, ['picture'], 'mobile_app', {
          name: staff.name,
          role: staff.role,
          department: staff.department,
          status: staff.status,
          phone: staff.phone,
          email: staff.email,
          picture: photoUrl,
        });

        // Return success response
        return res.json({
          success: true,
          url: photoUrl,
          message: 'Photo uploaded successfully',
        });
      } catch (cloudinaryError) {
        logger.warn({ err: cloudinaryError }, 'Cloudinary upload failed, using base64 fallback');

        // Fallback: store as base64
        staff.picture = photoData;
        await staff.save();

        // Create audit log and emit event even for fallback
        const auditLog = new StaffProfileAudit({
          timestamp: new Date(),
          staffId: staffId,
          action: 'profile_update',
          fieldsChanged: ['picture'],
          previousValues: { picture: staff.picture },
          newValues: { picture: photoData },
          source: 'mobile_app',
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('user-agent'),
        });

        await auditLog.save();

        emitStaffUpdate(staffId, ['picture'], 'mobile_app', {
          name: staff.name,
          role: staff.role,
          picture: photoData,
        });

        return res.json({
          success: true,
          url: photoData,
          warning: 'Photo stored locally. Cloud upload failed.',
          message: 'Photo uploaded successfully (local fallback)',
        });
      }
    }
  } catch (error) {
    logger.error({ err: error }, 'Error uploading staff photo');
    res.status(500).json({ error: 'Failed to upload photo' });
  }
});

// ============ APP VERSION CHECK ============

export default router;
