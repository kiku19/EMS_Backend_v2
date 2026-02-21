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
  Appointment
} from '../database.js';
import Homework from '../models/Homework.js';
import StaffProfileAudit from '../models/StaffProfileAudit.js';
import { authenticate } from '../middleware/auth.js';
import { validateStaffProfileUpdate } from '../middleware/staffValidation.js';
import { emitStaffUpdate } from '../utils/socketEmitter.js';

const router = express.Router();

// ============ TEACHER MOBILE API ============

// Get teacher dashboard data
router.get('/teacher/:teacherId/dashboard', async (req, res) => {
  try {
    const { teacherId } = req.params;
    const today = new Date().toISOString().split('T')[0];

    console.log(`[Dashboard] Loading dashboard for teacher: ${teacherId}`);

    // Get teacher details
    const teacher = await Staff.findById(teacherId);
    if (!teacher) {
      console.log(`[Dashboard] Teacher not found: ${teacherId}`);
      return res.status(404).json({ error: 'Teacher not found' });
    }

    console.log(`[Dashboard] Teacher found: ${teacher.name}`);

    // Run queries in parallel for better performance
    const [
      classTeacherOf,
      todayAttendance,
      teacherTimetable,
      substitutions,
      unreadAnnouncements
    ] = await Promise.all([
      // Check if class teacher
      Class.findOne({ classTeacherId: teacherId }).lean(),
      
      // Get today's attendance status
      StaffAttendance.findOne({
        staffId: teacherId,
        date: today
      }).lean(),
      
      // Get today's timetable
      TeacherTimetable.findOne({ teacherId }).lean(),
      
      // Get substitution alerts (assigned as substitute)
      Substitution.find({
        substituteTeacherId: teacherId,
        date: { $gte: today },
        status: { $in: ['pending', 'confirmed'] }
      })
        .populate('classId', 'name section')
        .populate('absentTeacherId', 'name')
        .limit(10)
        .lean(),
      
      // Get unread announcements count
      Announcement.countDocuments({
        targetAudience: { $in: ['all', 'staff'] },
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      })
    ]);

    console.log(`[Dashboard] Parallel queries completed`);

    // Get today's schedule
    const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const todaySchedule = teacherTimetable?.schedule?.[dayName] || [];

    // Get gate pass requests and appointments (if class teacher)
    let gatePasses = [];
    let appointments = [];
    
    if (classTeacherOf) {
      console.log(`[Dashboard] Loading class teacher data for class: ${classTeacherOf.name}`);
      
      // Run class teacher queries in parallel
      // FIXED: Filter by status and isDeleted for consistency
      const [students, classAppointments] = await Promise.all([
        Student.find({ classId: classTeacherOf._id, status: 'active', isDeleted: { $ne: true } }).select('_id').lean(),
        Appointment.find({
          meetingWith: teacher.name,
          fromDateTime: { $gte: new Date() },
          status: 'scheduled'
        })
          .sort({ fromDateTime: 1 })
          .limit(5)
          .lean()
      ]);

      const studentIds = students.map(s => s._id);
      
      // Get gate passes
      if (studentIds.length > 0) {
        gatePasses = await GatePass.find({
          studentId: { $in: studentIds },
          date: { $gte: today },
          status: 'pending'
        })
          .populate('studentId', 'name rollNo')
          .limit(10)
          .lean();
      }
      
      appointments = classAppointments;
      console.log(`[Dashboard] Class teacher data loaded`);
    }

    console.log(`[Dashboard] Sending response`);

    res.json({
      teacher: {
        id: teacher._id,
        name: teacher.name,
        code: teacher.code,
        role: teacher.role,
        photo: teacher.picture
      },
      classTeacher: classTeacherOf ? {
        id: classTeacherOf._id,
        name: classTeacherOf.name,
        section: classTeacherOf.section
      } : null,
      attendance: {
        date: today,
        status: todayAttendance?.status || null,
        inTime: todayAttendance?.inTime || null,
        outTime: todayAttendance?.outTime || null
      },
      timetable: todaySchedule,
      substitutions: substitutions || [],
      gatePasses: gatePasses || [],
      appointments: appointments || [],
      unreadAnnouncements: unreadAnnouncements || 0
    });
  } catch (error) {
    console.error('[Dashboard] Error loading dashboard:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get teacher's full timetable
router.get('/teacher/:teacherId/timetable', async (req, res) => {
  try {
    const { teacherId } = req.params;

    const teacherTimetable = await TeacherTimetable.findOne({ teacherId })
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
router.post('/teacher/:teacherId/attendance', async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { status, inTime, outTime } = req.body;
    const today = new Date().toISOString().split('T')[0];

    console.log(`[Mobile Attendance] Marking attendance for teacher: ${teacherId}`);
    console.log(`[Mobile Attendance] Status: ${status}, InTime: ${inTime}, OutTime: ${outTime}`);

    const attendance = await StaffAttendance.findOneAndUpdate(
      { staffId: teacherId, date: today },
      { status, checkInTime: inTime, checkOutTime: outTime },
      { new: true, upsert: true }
    );

    console.log(`[Mobile Attendance] Saved to DB:`, {
      staffId: attendance.staffId,
      date: attendance.date,
      status: attendance.status,
      checkInTime: attendance.checkInTime,
      checkOutTime: attendance.checkOutTime
    });

    // Emit socket event (matches webapp's expected event structure)
    const io = req.app.get('io');

    const socketData = {
      type: 'staff',
      staffId: teacherId,
      date: today,
      status,
      inTime: attendance.checkInTime || '-',
      outTime: attendance.checkOutTime || '-',
      reason: attendance.reason || ''
    };

    console.log(`[Mobile Attendance] Emitting socket event:`, socketData);
    io.emit('attendance_updated', socketData);
    console.log(`[Mobile Attendance] Socket event emitted to all clients`);

    res.json(attendance);
  } catch (error) {
    console.error(`[Mobile Attendance] Error:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Reset teacher attendance (for testing)
router.delete('/teacher/:teacherId/attendance', async (req, res) => {
  try {
    const { teacherId } = req.params;
    const today = new Date().toISOString().split('T')[0];

    console.log(`[Mobile Attendance] Resetting attendance for teacher: ${teacherId}`);

    const result = await StaffAttendance.findOneAndDelete({
      staffId: teacherId,
      date: today
    });

    if (!result) {
      console.log(`[Mobile Attendance] No attendance record found for today`);
      return res.status(404).json({ error: 'No attendance record found for today' });
    }

    console.log(`[Mobile Attendance] Deleted attendance record:`, {
      staffId: result.staffId,
      date: result.date,
      status: result.status
    });

    // Emit socket event to update real-time views
    const io = req.app.get('io');
    io.emit('attendance_updated', {
      type: 'staff',
      staffId: teacherId,
      date: today,
      status: 'unmarked',
      inTime: '-',
      outTime: '-',
      reason: ''
    });

    res.json({
      success: true,
      message: 'Attendance reset successfully'
    });
  } catch (error) {
    console.error(`[Mobile Attendance] Error resetting:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Get class students for attendance (class teacher only)
router.get('/teacher/:teacherId/class-students', async (req, res) => {
  try {
    const { teacherId } = req.params;

    // Find class where teacher is class teacher
    const classData = await Class.findOne({ classTeacherId: teacherId });
    if (!classData) {
      return res.status(404).json({ error: 'Not a class teacher' });
    }

    // FIXED: Filter by status='active' AND isDeleted!=true for consistency
    const students = await Student.find({
      classId: classData._id,
      status: 'active',
      isDeleted: { $ne: true }
    }).sort({ rollNo: 1 });

    res.json({
      class: {
        id: classData._id.toString(), // FIX: id as string
        name: classData.name,
        section: classData.section
      },
      students: students.map(s => ({
        id: s._id.toString(), // FIX: id as string
        name: s.name,
        rollNo: s.rollNo,
        admissionId: s.admissionId,
        photo: s.photo
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get class attendance for a date
router.get('/teacher/:teacherId/class-attendance/:date', async (req, res) => {
  try {
    const { teacherId, date } = req.params;

    // Find class where teacher is class teacher
    const classData = await Class.findOne({ classTeacherId: teacherId });
    if (!classData) {
      return res.status(404).json({ error: 'Not a class teacher' });
    }

    const attendance = await Attendance.find({
      classId: classData._id,
      date
    });

    const attendanceMap = {};
    attendance.forEach(att => {
      attendanceMap[att.studentId.toString()] = att.status;
    });

    res.json(attendanceMap);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark class attendance (class teacher only)
router.post('/teacher/:teacherId/class-attendance', async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { date, attendance } = req.body; // attendance: [{ studentId, status }]

    // Verify teacher is class teacher
    const classData = await Class.findOne({ classTeacherId: teacherId });
    if (!classData) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const results = [];
    for (const record of attendance) {
      const att = await Attendance.findOneAndUpdate(
        { studentId: record.studentId, date },
        {
          studentId: record.studentId,
          classId: classData._id,
          date,
          status: record.status,
          markedBy: teacherId
        },
        { new: true, upsert: true }
      );
      results.push(att);
    }

    // Emit socket event
    const io = req.app.get('io');
    io.emit('class_attendance_marked', {
      classId: classData._id,
      date,
      count: results.length,
      timestamp: new Date()
    });

    res.json({
      success: true,
      message: `Attendance marked for ${results.length} students`,
      results
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get class overview (for class teacher)
router.get('/teacher/:teacherId/class-overview', async (req, res) => {
  try {
    const { teacherId } = req.params;

    const classData = await Class.findOne({ classTeacherId: teacherId });
    if (!classData) {
      return res.status(404).json({ error: 'Not a class teacher' });
    }

    // Get all students
    // FIXED: Filter by status and isDeleted for consistency
    const students = await Student.find({ classId: classData._id, status: 'active', isDeleted: { $ne: true } });

    // Get low attendance students (< 75%)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const attendanceRecords = await Attendance.find({
      studentId: { $in: students.map(s => s._id) },
      date: { $gte: thirtyDaysAgo.toISOString().split('T')[0] }
    });

    const studentAttendance = {};
    attendanceRecords.forEach(att => {
      const sid = att.studentId.toString();
      if (!studentAttendance[sid]) {
        studentAttendance[sid] = { present: 0, total: 0 };
      }
      studentAttendance[sid].total++;
      if (att.status === 'present' || att.status === 'late') {
        studentAttendance[sid].present++;
      }
    });

    const lowAttendanceStudents = students.filter(s => {
      const stats = studentAttendance[s._id.toString()];
      if (!stats || stats.total === 0) return true;
      const percentage = (stats.present / stats.total) * 100;
      return percentage < 75;
    }).map(s => ({
      id: s._id,
      name: s.name,
      rollNo: s.rollNo,
      attendancePercentage: studentAttendance[s._id.toString()] ?
        Math.round((studentAttendance[s._id.toString()].present / studentAttendance[s._id.toString()].total) * 100) : 0
    }));

    // Get failed students (from recent results)
    const recentResults = await Result.find({
      studentId: { $in: students.map(s => s._id) },
      isPublished: true
    }).sort({ createdAt: -1 }).limit(100);

    const failedStudents = [];
    recentResults.forEach(r => {
      if (r.status === 'failed') {
        const student = students.find(s => s._id.toString() === r.studentId.toString());
        if (student && !failedStudents.find(f => f.id.toString() === student._id.toString())) {
          failedStudents.push({
            id: student._id,
            name: student.name,
            rollNo: student.rollNo,
            percentage: r.percentage
          });
        }
      }
    });

    // Get fee pending students
    const StudentFeeStructure = (await import('../models/StudentFeeStructure.js')).default;
    const feeStructures = await StudentFeeStructure.find({
      studentId: { $in: students.map(s => s._id) },
      overallStatus: { $in: ['pending', 'partial'] }
    }).populate('studentId', 'name rollNo');

    const feePendingStudents = feeStructures.map(fs => ({
      id: fs.studentId._id,
      name: fs.studentId.name,
      rollNo: fs.studentId.rollNo,
      totalFee: fs.totalFee,
      totalPaid: fs.totalPaid,
      balance: fs.totalBalance,
      status: fs.overallStatus
    }));

    res.json({
      class: {
        id: classData._id,
        name: classData.name,
        section: classData.section,
        totalStudents: students.length
      },
      lowAttendanceStudents,
      failedStudents,
      feePendingStudents
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get announcements for teachers
router.get('/teacher/:teacherId/announcements', async (req, res) => {
  try {
    const { limit = 20 } = req.query;

    const announcements = await Announcement.find({
      targetAudience: { $in: ['all', 'staff'] }
    })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    res.json(announcements);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get teacher leaves (mobile-specific endpoint)
router.get('/teacher/:teacherId/leaves', async (req, res) => {
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
    console.error('Error loading leaves:', error);
    res.status(500).json({ error: error.message });
  }
});

// Apply for leave (mobile-specific endpoint)
router.post('/teacher/:teacherId/leaves', async (req, res) => {
  try {
    const { teacherId } = req.params;
    const {
      leaveType,
      reason,
      startDate,
      endDate,
      days,
      attachments
    } = req.body;

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
      attachments: attachments || []
    });

    await leave.save();

    // Emit socket event for real-time notification
    const io = req.app.get('io');
    if (io) {
      io.emit('leave_applied', {
        leaveId: leave._id,
        teacherId,
        leaveType,
        startDate,
        endDate,
        days: calculatedDays,
        timestamp: new Date()
      });
    }

    const populatedLeave = await TeacherLeave.findById(leave._id)
      .populate('teacherId', 'name code')
      .lean();

    res.status(201).json(populatedLeave);
  } catch (error) {
    console.error('Error applying for leave:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get student details (for mobile view)
router.get('/teacher/:teacherId/student/:studentId', async (req, res) => {
  try {
    const { teacherId, studentId } = req.params;

    // Get student with class info (MongoDB/Mongoose)
    const student = await Student.findById(studentId)
      .populate('classId', 'name section')
      .lean();

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Get attendance stats (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateStr = thirtyDaysAgo.toISOString().split('T')[0];

    const attendanceRecords = await Attendance.find({
      studentId: student._id,
      date: { $gte: dateStr }
    }).lean();

    const stats = { present: 0, absent: 0, late: 0 };
    attendanceRecords.forEach(record => {
      const status = record.status.toLowerCase();
      if (stats[status] !== undefined) {
        stats[status]++;
      }
    });

    // Handle legacy parent fields if parents array is empty
    let parents = student.parents || [];

    if (!parents || parents.length === 0) {
      parents = [{
        name: student.parentName,
        phone: student.parentPhone,
        email: student.parentEmail,
        relationship: student.parentRelationship || 'Parent'
      }];
    }

    res.json({
      student: {
        id: student._id,
        name: student.name,
        rollNo: student.rollNo,
        admissionId: student.admissionId,
        photo: student.photo,
        class: student.classId ? {
          name: student.classId.name,
          section: student.classId.section
        } : null,
        dob: student.dateOfBirth,
        gender: student.gender,
        address: student.address,
        phone: student.phone
      },
      parents,
      attendance: stats
    });

  } catch (error) {
    console.error('Error fetching student details:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ STAFF PROFILE API ============

/**
 * GET /api/mobile/staff/:staffId/profile
 * Get staff profile for self-service updates
 * - Returns only editable fields (no sensitive data like salary)
 * - Authentication required
 */
router.get('/staff/:staffId/profile', authenticate, async (req, res) => {
  try {
    const { staffId } = req.params;

    console.log(`[Staff Profile] Fetching profile for staff: ${staffId}`);

    // Find staff member
    const staff = await Staff.findById(staffId).lean();

    if (!staff) {
      console.log(`[Staff Profile] Staff not found: ${staffId}`);
      return res.status(404).json({
        error: 'Staff not found',
        message: `No staff member found with ID: ${staffId}`
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
      updatedAt: staff.updatedAt
    };

    console.log(`[Staff Profile] Profile loaded successfully for: ${staff.name}`);

    res.json(profileData);
  } catch (error) {
    console.error('[Staff Profile] Error fetching profile:', error);
    res.status(500).json({
      error: 'Failed to fetch profile',
      message: error.message
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
router.put('/staff/:staffId/profile',
  authenticate,
  validateStaffProfileUpdate,
  async (req, res) => {
    try {
      const { staffId } = req.params;
      const updateData = req.body;

      console.log(`[Staff Profile] Updating profile for staff: ${staffId}`);
      console.log(`[Staff Profile] Update data:`, Object.keys(updateData));

      // Verify staffId matches authenticated user (self-service only)
      if (req.user.userId !== staffId) {
        // Check if user is admin (admin can edit any profile)
        const UserPermission = (await import('../database.js')).UserPermission;
        const permissions = await UserPermission.findOne({ userId: req.user.userId });

        if (!permissions || permissions.role !== 'admin') {
          console.warn(`[Staff Profile] Forbidden: User ${req.user.userId} attempted to edit staff ${staffId}`);
          return res.status(403).json({
            error: 'Access denied',
            message: 'You can only edit your own profile'
          });
        }
        console.log(`[Staff Profile] Admin override: User ${req.user.userId} editing staff ${staffId}`);
      }

      // Find staff member
      const staff = await Staff.findById(staffId);

      if (!staff) {
        console.log(`[Staff Profile] Staff not found: ${staffId}`);
        return res.status(404).json({
          error: 'Staff not found',
          message: `No staff member found with ID: ${staffId}`
        });
      }

      // Detect which fields changed for audit log and socket event
      const fieldsChanged = [];
      const previousValues = {};

      Object.keys(updateData).forEach(field => {
        const oldValue = staff[field];
        const newValue = updateData[field];

        // Compare values (handle arrays and nested objects)
        if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
          fieldsChanged.push(field);
          previousValues[field] = oldValue;
        }
      });

      if (fieldsChanged.length === 0) {
        console.log(`[Staff Profile] No changes detected`);
        return res.json({
          success: true,
          message: 'No changes to update',
          profile: staff
        });
      }

      console.log(`[Staff Profile] Fields changed:`, fieldsChanged);

      // Update staff profile
      Object.keys(updateData).forEach(field => {
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
        userAgent: req.get('user-agent')
      });

      await auditLog.save();
      console.log(`[Staff Profile] Audit log created`);

      // Emit socket event for real-time updates
      emitStaffUpdate(
        staffId,
        fieldsChanged,
        'mobile_app',
        {
          name: staff.name,
          role: staff.role,
          department: staff.department,
          status: staff.status,
          phone: staff.phone,
          email: staff.email,
          picture: staff.picture
        }
      );

      console.log(`[Staff Profile] Socket event emitted: staff_updated`);

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
        updatedAt: staff.updatedAt
      };

      res.json({
        success: true,
        message: 'Profile updated successfully',
        fieldsChanged: fieldsChanged,
        profile: updatedProfile
      });

    } catch (error) {
      console.error('[Staff Profile] Error updating profile:', error);
      res.status(500).json({
        error: 'Failed to update profile',
        message: error.message
      });
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
router.post('/staff/:staffId/photo',
  authenticate,
  async (req, res) => {
    try {
      const { staffId } = req.params;

      console.log(`[Staff Photo] Photo upload request for staff: ${staffId}`);

      // Verify staffId matches authenticated user (self-service only)
      if (req.user.userId !== staffId) {
        // Check if user is admin (admin can upload any staff photo)
        const UserPermission = (await import('../database.js')).UserPermission;
        const permissions = await UserPermission.findOne({ userId: req.user.userId });

        if (!permissions || permissions.role !== 'admin') {
          console.warn(`[Staff Photo] Forbidden: User ${req.user.userId} attempted to upload photo for staff ${staffId}`);
          return res.status(403).json({
            error: 'Access denied',
            message: 'You can only upload your own photo'
          });
        }
        console.log(`[Staff Photo] Admin override: User ${req.user.userId} uploading photo for staff ${staffId}`);
      }

      // Find staff member
      const staff = await Staff.findById(staffId);

      if (!staff) {
        console.log(`[Staff Photo] Staff not found: ${staffId}`);
        return res.status(404).json({
          error: 'Staff not found',
          message: `No staff member found with ID: ${staffId}`
        });
      }

      // Check if photo file is present
      if (!req.body || !req.body.photo) {
        console.log(`[Staff Photo] No photo data provided`);
        return res.status(400).json({
          error: 'No photo provided',
          message: 'Photo data is required'
        });
      }

      const photoData = req.body.photo;

      console.log(`[Staff Photo] Processing photo upload (${photoData.length} bytes)`);

      // Import cloudinary
      const { v2: cloudinary } = await import('cloudinary');

      // Check if Cloudinary is configured
      const config = (await import('../config/environment.js')).config;
      if (!config.cloudinary.configured) {
        console.warn(`[Staff Photo] Cloudinary not configured, using base64 fallback`);
        // Use base64 fallback
        staff.picture = photoData;
        await staff.save();
        console.log(`[Staff Photo] Photo saved as base64`);
      } else {
        // Upload to Cloudinary
        try {
          console.log(`[Staff Photo] Uploading to Cloudinary folder: staff-photos`);

          const uploadOptions = {
            folder: 'staff-photos',
            public_id: `staff-${staffId}`,
            overwrite: true,
            transformation: [
              { width: 300, height: 300, crop: 'fill' },
              { quality: 'auto' }
            ],
            resource_type: 'image'
          };

          // Upload to Cloudinary
          const result = await cloudinary.uploader.upload(photoData, uploadOptions);

          const photoUrl = result.secure_url;
          console.log(`[Staff Photo] Cloudinary upload successful: ${photoUrl}`);

          // Update staff picture
          const previousPicture = staff.picture;
          staff.picture = photoUrl;
          await staff.save();

          console.log(`[Staff Photo] Photo updated in database`);
          console.log(`[Staff Photo] Previous picture: ${previousPicture ? 'exists' : 'none'}`);
          console.log(`[Staff Photo] New picture: ${photoUrl}`);

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
            userAgent: req.get('user-agent')
          });

          await auditLog.save();
          console.log(`[Staff Photo] Audit log created`);

          // Emit socket event for real-time updates
          emitStaffUpdate(
            staffId,
            ['picture'],
            'mobile_app',
            {
              name: staff.name,
              role: staff.role,
              department: staff.department,
              status: staff.status,
              phone: staff.phone,
              email: staff.email,
              picture: photoUrl
            }
          );

          console.log(`[Staff Photo] Socket event emitted: staff_updated`);

          // Return success response
          return res.json({
            success: true,
            url: photoUrl,
            message: 'Photo uploaded successfully'
          });

        } catch (cloudinaryError) {
          console.error('[Staff Photo] Cloudinary upload failed:', cloudinaryError);
          console.warn('[Staff Photo] Falling back to base64 storage');

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
            userAgent: req.get('user-agent')
          });

          await auditLog.save();

          emitStaffUpdate(
            staffId,
            ['picture'],
            'mobile_app',
            {
              name: staff.name,
              role: staff.role,
              picture: photoData
            }
          );

          return res.json({
            success: true,
            url: photoData,
            warning: 'Photo stored locally. Cloud upload failed.',
            message: 'Photo uploaded successfully (local fallback)'
          });
        }
      }

    } catch (error) {
      console.error('[Staff Photo] Error uploading photo:', error);
      res.status(500).json({
        error: 'Failed to upload photo',
        message: error.message
      });
    }
  }
);

export default router;
