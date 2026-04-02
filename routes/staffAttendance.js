import express from 'express';
import { rateLimit } from 'express-rate-limit';
import StaffAttendance from '../models/StaffAttendance.js';
import { Staff } from '../database.js';
import substitutionService from '../services/substitutionService.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { extractSchoolId, ensureDefaultSchool } from '../utils/schoolContext.js';
import { sanitizeString, sanitizeQueryStr } from '../middleware/validation.js';
import { validateZod } from '../validators/zodHelpers.js';
import {
  singleStaffAttendanceSchema,
  bulkStaffAttendanceSchema,
} from '../validators/staffAttendanceSchema.js';

const router = express.Router();
router.use(authenticate);

// Rate limit for mobile attendance actions: max 20 requests per 15 min per IP
const mobileAttendanceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many attendance requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

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

// Get all attendance records (with pagination and date filter)
router.get('/', checkPermission('staff', 'view'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const skip = (page - 1) * limit;

    const query = scopeBySchool(req.user?.schoolId);

    // Date filter support
    const filterDate = sanitizeQueryStr(req.query.date);
    const filterStart = sanitizeQueryStr(req.query.startDate);
    const filterEnd = sanitizeQueryStr(req.query.endDate);
    if (filterDate) {
      query.date = filterDate;
    } else if (filterStart && filterEnd) {
      query.date = { $gte: filterStart, $lte: filterEnd };
    }

    const [attendance, total] = await Promise.all([
      StaffAttendance.find(query).sort({ date: -1 }).skip(skip).limit(limit),
      StaffAttendance.countDocuments(query),
    ]);

    // Return as array of objects to match what webapp expects
    const attendanceArray = attendance.map((att) => ({
      staffId: att.staffId.toString(),
      date: att.date,
      status: att.status,
      checkInTime: att.checkInTime || '-',
      checkOutTime: att.checkOutTime || '-',
      reason: att.reason || '',
    }));

    res.json({
      data: attendanceArray,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('[StaffAttendance] Error fetching attendance:', error);
    res.status(500).json({ error: 'Failed to fetch staff attendance records' });
  }
});

// Get attendance for a specific date
router.get('/date/:date', checkPermission('staff', 'view'), async (req, res) => {
  try {
    const { date } = req.params;
    const attendance = await StaffAttendance.find(scopeBySchool(req.user?.schoolId, { date }))
      .populate('staffId', 'name code department role')
      .populate('markedBy', 'name')
      .sort({ 'staffId.name': 1 });

    res.json(attendance);
  } catch (error) {
    console.error('[StaffAttendance] Error fetching attendance by date:', error);
    res.status(500).json({ error: 'Failed to fetch attendance for the specified date' });
  }
});

// Get attendance for a staff member (with date range)
router.get('/staff/:staffId', checkPermission('staff', 'view'), async (req, res) => {
  try {
    const { staffId } = req.params;
    const startDate = sanitizeQueryStr(req.query.startDate);
    const endDate = sanitizeQueryStr(req.query.endDate);

    const query = { staffId };
    if (startDate && endDate) {
      query.date = { $gte: startDate, $lte: endDate };
    }

    const attendance = await StaffAttendance.find(scopeBySchool(req.user?.schoolId, query))
      .sort({ date: -1 })
      .limit(100);

    res.json(attendance);
  } catch (error) {
    console.error('[StaffAttendance] Error fetching staff attendance:', error);
    res.status(500).json({ error: 'Failed to fetch attendance for the specified staff member' });
  }
});

// Get today's attendance for a staff member (for mobile app)
router.get('/staff/:staffId/today', async (req, res) => {
  try {
    const { staffId } = req.params;

    // Non-admins can only view their own today's attendance
    const isAdmin =
      req.user.role === 'admin' ||
      (Array.isArray(req.user.role) &&
        req.user.role.some((r) => ['admin', 'Admin', 'Principal', 'principal'].includes(r)));
    if (!isAdmin && req.user.id.toString() !== staffId) {
      return res
        .status(403)
        .json({ error: "Not authorized to view another staff member's attendance" });
    }

    const today = new Date().toISOString().split('T')[0];

    const todayAttendance = await StaffAttendance.findOne(
      scopeBySchool(req.user?.schoolId, {
        staffId,
        date: today,
      })
    );

    if (todayAttendance) {
      res.json({
        id: todayAttendance._id,
        staffId: todayAttendance.staffId,
        date: todayAttendance.date,
        status: todayAttendance.status,
        checkInTime: todayAttendance.checkInTime || null,
        checkOutTime: todayAttendance.checkOutTime || null,
        reason: todayAttendance.reason || '',
      });
    } else {
      // Return unmarked status
      res.json({
        staffId: staffId,
        date: today,
        status: 'unmarked',
        checkInTime: null,
        checkOutTime: null,
        reason: '',
      });
    }
  } catch (error) {
    console.error('[StaffAttendance] Error getting today attendance:', error);
    res.status(500).json({ error: "Failed to fetch today's attendance" });
  }
});

// Mark attendance (admin/manual)
router.post(
  '/',
  checkPermission('staff', 'edit'),
  validateZod(singleStaffAttendanceSchema),
  async (req, res) => {
    try {
      const { staffId, date, status, checkInTime, checkOutTime, reason } = req.body;
      const markedBy = req.user.id;

      // Prevent marking attendance for future dates
      const today = new Date().toISOString().split('T')[0];
      if (date > today) {
        return res.status(400).json({ error: 'Cannot mark attendance for future dates' });
      }

      const schoolId = await resolveRequestSchoolId(req);

      const attendance = await StaffAttendance.findOneAndUpdate(
        scopeBySchool(schoolId, { staffId, date }),
        {
          staffId,
          date,
          status,
          checkInTime,
          checkOutTime,
          reason,
          markedBy,
          lastModifiedBy: markedBy,
          checkInMethod: 'admin',
          checkOutMethod: 'admin',
          schoolId,
        },
        { upsert: true, new: true }
      ).populate('staffId', 'name code department role');

      // Emit socket event for real-time update
      if (req.app?.get('io')) {
        const staff = attendance.staffId;
        req.app.get('io').emit('attendance_updated', {
          type: 'staff',
          staffId: staffId.toString(),
          staffName: staff?.name || 'Unknown',
          date: date,
          status: status,
          inTime: attendance.checkInTime,
          outTime: attendance.checkOutTime,
          reason: reason || '',
        });
      }

      // TRIGGER: Create substitution alerts if teacher is absent
      if (status === 'absent' || status === 'leave') {
        try {
          const staff = attendance.staffId;
          const isTeacher =
            staff?.role?.includes('Teacher') || staff?.staffType?.includes('Teacher');

          if (isTeacher) {
            const substitutions = await substitutionService.createSubstitutionFromAbsence(
              staffId,
              date,
              reason || `${status.charAt(0).toUpperCase() + status.slice(1)}`
            );

            // Emit substitution alert
            if (req.app?.get('io') && substitutions.length > 0) {
              req.app.get('io').emit('substitution_alert', {
                type: 'new_alerts',
                teacherName: staff.name,
                teacherId: staffId,
                date: date,
                count: substitutions.length,
                markedBy: req.user.name || req.user.id,
              });
            }
          }
        } catch (subError) {
          console.error('[StaffAttendance] Error creating substitution alerts:', subError);
        }
      }

      res.json(attendance);
    } catch (error) {
      console.error('[StaffAttendance] Error marking attendance:', error);
      res.status(500).json({ error: 'Failed to mark attendance' });
    }
  }
);

// Bulk mark attendance
router.post(
  '/bulk',
  checkPermission('staff', 'edit'),
  validateZod(bulkStaffAttendanceSchema),
  async (req, res) => {
    try {
      const { date, staffIds, status, reason, checkInTime, checkOutTime } = req.body;
      const markedBy = req.user.id;

      // Prevent marking attendance for future dates
      const today = new Date().toISOString().split('T')[0];
      if (date > today) {
        return res.status(400).json({ error: 'Cannot mark attendance for future dates' });
      }

      // Default times if not provided
      const defaultInTime = checkInTime || (status === 'present' ? '09:00' : '-');
      const defaultOutTime = checkOutTime || '-';
      const finalReason = reason || '';

      const schoolId = await resolveRequestSchoolId(req);

      const operations = staffIds.map((staffId) => ({
        updateOne: {
          filter: scopeBySchool(schoolId, { staffId, date }),
          update: {
            $set: {
              status,
              checkInTime: defaultInTime,
              checkOutTime: defaultOutTime,
              reason: finalReason,
              markedBy,
              lastModifiedBy: markedBy,
              checkInMethod: 'admin',
              schoolId,
            },
          },
          upsert: true,
        },
      }));

      const result = await StaffAttendance.bulkWrite(operations);
      res.json({ success: true, modified: result.modifiedCount, upserted: result.upsertedCount });
    } catch (error) {
      console.error('[StaffAttendance] Error bulk marking attendance:', error);
      res.status(500).json({ error: 'Failed to bulk mark attendance' });
    }
  }
);

// Regularize attendance
router.put('/:id/regularize', checkPermission('staff', 'edit'), async (req, res) => {
  try {
    const { id } = req.params;
    const { date, status, checkInTime, checkOutTime, reason } = req.body;
    const regularizedBy = req.user.id;

    // Prevent regularizing attendance for future dates
    if (date) {
      const today = new Date().toISOString().split('T')[0];
      if (date > today) {
        return res.status(400).json({ error: 'Cannot regularize attendance for future dates' });
      }
    }

    const schoolId = await resolveRequestSchoolId(req);

    let attendance = null;

    // Try to find by ID (if it's a valid attendance ID)
    try {
      attendance = await StaffAttendance.findOne(scopeBySchool(schoolId, { _id: id }));
    } catch (e) {
      // Ignore cast error, might be staffId
    }

    // If not found by ID, try finding by staffId and date
    if (!attendance && date) {
      attendance = await StaffAttendance.findOne(scopeBySchool(schoolId, { staffId: id, date }));
    }

    // If still not found, and we have date, create new record (upsert logic)
    if (!attendance && date) {
      attendance = new StaffAttendance({
        staffId: id,
        date,
        status,
        checkInTime: checkInTime || '-',
        checkOutTime: checkOutTime || '-',
        reason: reason || '',
        markedBy: regularizedBy,
        checkInMethod: 'admin',
        schoolId,
        regularization: {
          regularizedBy,
          regularizedAt: new Date(),
          previousStatus: 'unmarked',
          regularizationReason: reason,
        },
      });
      await attendance.save();

      // Emit socket event for real-time update
      if (req.app?.get('io')) {
        const staff = await Staff.findById(attendance.staffId);
        req.app.get('io').emit('attendance_updated', {
          type: 'staff',
          staffId: attendance.staffId.toString(),
          staffName: staff?.name || 'Unknown',
          date: attendance.date,
          status: attendance.status,
          inTime: attendance.checkInTime,
          outTime: attendance.checkOutTime,
          reason: attendance.reason || '',
        });
      }

      return res.json(attendance);
    }

    if (!attendance) {
      return res.status(404).json({ error: 'Attendance record not found' });
    }

    attendance.regularization = {
      regularizedBy,
      regularizedAt: new Date(),
      previousStatus: attendance.status,
      regularizationReason: reason,
    };

    attendance.status = status;
    attendance.checkInTime = checkInTime;
    attendance.checkOutTime = checkOutTime;
    attendance.reason = reason;
    attendance.lastModifiedBy = regularizedBy;

    await attendance.save();

    // Emit socket event for real-time update
    if (req.app?.get('io')) {
      const staff = await Staff.findById(attendance.staffId);
      req.app.get('io').emit('attendance_updated', {
        type: 'staff',
        staffId: attendance.staffId.toString(),
        staffName: staff?.name || 'Unknown',
        date: attendance.date,
        status: attendance.status,
        inTime: attendance.checkInTime,
        outTime: attendance.checkOutTime,
        reason: attendance.reason || '',
      });
    }

    res.json(attendance);
  } catch (error) {
    console.error('[StaffAttendance] Error regularizing attendance:', error);
    res.status(500).json({ error: 'Failed to regularize attendance' });
  }
});

// ============ MOBILE APP ENDPOINTS ============

// Mark attendance from mobile app (with status and reason)
router.post('/mobile/mark', mobileAttendanceLimiter, authenticate, async (req, res) => {
  try {
    const { status, location } = req.body;
    const reason = sanitizeString(req.body.reason);
    const staffId = req.user.id;
    const date = new Date().toISOString().split('T')[0];
    const currentTime = new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    });

    // Validate staff exists
    const staff = await Staff.findById(staffId);
    if (!staff) {
      return res.status(404).json({
        success: false,
        error: req.t('common:errors.staffNotFound'),
      });
    }

    // Validate status
    const validStatuses = ['present', 'absent', 'leave', 'halfday'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status. Must be one of: present, absent, leave, halfday',
      });
    }

    // Check if attendance was already marked by admin — don't allow mobile override
    const existingAttendance = await StaffAttendance.findOne(
      scopeBySchool(req.user?.schoolId, { staffId, date })
    );
    if (existingAttendance && existingAttendance.checkInMethod === 'admin') {
      return res.status(409).json({
        success: false,
        error: `Attendance already marked as '${existingAttendance.status}' by admin. Contact your administrator to modify.`,
      });
    }

    // Validate reason for non-present statuses
    if (status !== 'present' && !reason?.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Reason is required for absent/leave/halfday',
      });
    }

    // Upsert attendance record (allows both create and update from mobile)
    const mobileSchoolId = await resolveRequestSchoolId(req);
    const newAttendance = await StaffAttendance.findOneAndUpdate(
      scopeBySchool(mobileSchoolId, { staffId, date }),
      {
        staffId,
        date,
        status,
        checkInTime: status === 'present' ? currentTime : '-',
        checkOutTime: existingAttendance?.checkOutTime || '-',
        reason: reason || '',
        checkInMethod: 'mobile',
        checkInLocation: location || null,
        markedBy: staffId,
        lastModifiedBy: staffId,
        schoolId: mobileSchoolId,
      },
      { upsert: true, new: true }
    );

    // TRIGGER: Create substitution alerts if teacher is absent
    if (status === 'absent' || status === 'leave') {
      try {
        // Check if staff is a teacher
        const isTeacher =
          staff.role?.includes('Teacher') ||
          staff.staffType?.includes('Teacher') ||
          staff.teacherAssignments?.length > 0;

        if (isTeacher) {
          // Create substitution alerts for this teacher's classes today
          const substitutions = await substitutionService.createSubstitutionFromAbsence(
            staffId,
            date,
            reason || `${status.charAt(0).toUpperCase() + status.slice(1)}`
          );

          // Emit substitution alert to dashboard
          if (req.app?.get('io') && substitutions.length > 0) {
            req.app.get('io').emit('substitution_alert', {
              type: 'new_alerts',
              teacherName: staff.name,
              teacherId: staffId,
              date: date,
              count: substitutions.length,
              substitutions: substitutions.map((s) => ({
                id: s._id,
                classId: s.classId,
                period: s.period,
              })),
            });
          }
        }
      } catch (subError) {
        // Log error but don't fail the attendance marking
        console.error('[StaffAttendance] Error creating substitution alerts:', subError);
      }
    }

    // Emit socket event for real-time update (if socket.io is available)
    if (req.app?.get('io')) {
      req.app.get('io').emit('attendance_updated', {
        type: 'staff',
        staffId: staffId.toString(),
        staffName: staff.name,
        date: date,
        status: status,
        inTime: newAttendance.checkInTime,
        outTime: '-',
        reason: reason || '',
      });
    }

    res.json({
      success: true,
      message: existingAttendance
        ? 'Attendance updated successfully'
        : 'Attendance marked successfully',
      updated: !!existingAttendance,
      attendance: {
        id: newAttendance._id,
        staffId: newAttendance.staffId,
        date: newAttendance.date,
        status: newAttendance.status,
        checkInTime: newAttendance.checkInTime,
        reason: newAttendance.reason,
      },
    });
  } catch (error) {
    console.error('[StaffAttendance] Error marking mobile attendance:', error);
    res.status(500).json({ error: 'Failed to mark attendance' });
  }
});

// Check-in (from mobile app)
router.post('/mobile/checkin', mobileAttendanceLimiter, authenticate, async (req, res) => {
  try {
    const { location } = req.body;
    const staffId = req.user.id;
    const date = new Date().toISOString().split('T')[0];
    const checkInTime = new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    });

    const checkinSchoolId = await resolveRequestSchoolId(req);

    // Check if an admin-marked non-present record exists — don't overwrite it
    const existing = await StaffAttendance.findOne(
      scopeBySchool(checkinSchoolId, { staffId, date })
    );
    if (existing && existing.checkInMethod === 'admin' && existing.status !== 'present') {
      return res.status(409).json({
        success: false,
        error: `Attendance already marked as '${existing.status}' by admin. Contact your administrator to modify.`,
      });
    }

    const attendance = await StaffAttendance.findOneAndUpdate(
      scopeBySchool(checkinSchoolId, { staffId, date }),
      {
        staffId,
        date,
        status: 'present',
        checkInTime,
        checkInLocation: location,
        checkInMethod: 'mobile',
        lastModifiedBy: staffId,
        schoolId: checkinSchoolId,
      },
      { upsert: true, new: true }
    ).populate('staffId', 'name code department role');

    res.json({ success: true, attendance });
  } catch (error) {
    console.error('[StaffAttendance] Error during mobile check-in:', error);
    res.status(500).json({ error: 'Failed to check in' });
  }
});

// Check-out (from mobile app)
router.post('/mobile/checkout', mobileAttendanceLimiter, authenticate, async (req, res) => {
  try {
    const { location } = req.body;
    const staffId = req.user.id;
    const date = new Date().toISOString().split('T')[0];
    const checkOutTime = new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    });

    const attendance = await StaffAttendance.findOneAndUpdate(
      scopeBySchool(req.user?.schoolId, { staffId, date }),
      {
        checkOutTime,
        checkOutLocation: location,
        checkOutMethod: 'mobile',
        lastModifiedBy: staffId,
      },
      { new: true }
    ).populate('staffId', 'name code department role');

    if (!attendance) {
      return res.status(404).json({ error: 'Please check-in first' });
    }

    res.json({ success: true, attendance });
  } catch (error) {
    console.error('[StaffAttendance] Error during mobile check-out:', error);
    res.status(500).json({ error: 'Failed to check out' });
  }
});

// Apply for leave (from mobile app)
router.post('/mobile/leave/apply', mobileAttendanceLimiter, authenticate, async (req, res) => {
  try {
    const { leaveType, startDate, endDate } = req.body;
    const reason = sanitizeString(req.body.reason);
    const staffId = req.user.id;

    // Calculate number of days
    const start = new Date(startDate);
    const end = new Date(endDate);
    const numberOfDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

    const leaveSchoolId = await resolveRequestSchoolId(req);

    // Create attendance records for each day
    const operations = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      operations.push({
        updateOne: {
          filter: scopeBySchool(leaveSchoolId, { staffId, date: dateStr }),
          update: {
            $set: {
              staffId,
              date: dateStr,
              status: 'leave',
              reason,
              checkInTime: '-',
              checkOutTime: '-',
              checkInMethod: 'mobile',
              leaveApplication: {
                appliedAt: new Date(),
                leaveType,
                startDate,
                endDate,
                numberOfDays,
                approvalStatus: 'pending',
              },
              lastModifiedBy: staffId,
              schoolId: leaveSchoolId,
            },
          },
          upsert: true,
        },
      });
    }

    const result = await StaffAttendance.bulkWrite(operations);

    res.json({
      success: true,
      message: 'Leave application submitted successfully',
      numberOfDays,
      modified: result.modifiedCount,
      upserted: result.upsertedCount,
    });
  } catch (error) {
    console.error('[StaffAttendance] Error applying for leave:', error);
    res.status(500).json({ error: 'Failed to submit leave application' });
  }
});

// Get pending leave applications
router.get('/leave/pending', checkPermission('staff', 'view'), async (req, res) => {
  try {
    const pendingLeaves = await StaffAttendance.find(
      scopeBySchool(req.user?.schoolId, {
        'leaveApplication.approvalStatus': 'pending',
      })
    )
      .populate('staffId', 'name code department role')
      .sort({ 'leaveApplication.appliedAt': -1 });

    res.json(pendingLeaves);
  } catch (error) {
    console.error('[StaffAttendance] Error fetching pending leaves:', error);
    res.status(500).json({ error: 'Failed to fetch pending leave applications' });
  }
});

// Approve/Reject leave
router.put(
  '/leave/:id/approve',
  checkPermission('staff', 'edit'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { approvalStatus, rejectionReason } = req.body;
      const approvedBy = req.user.id;

      const attendance = await StaffAttendance.findOne(
        scopeBySchool(req.user?.schoolId, { _id: id })
      );
      if (!attendance) {
        return res.status(404).json({ error: 'Leave application not found' });
      }

      attendance.leaveApplication.approvalStatus = approvalStatus;
      attendance.leaveApplication.approvedBy = approvedBy;
      attendance.leaveApplication.approvedAt = new Date();

      if (approvalStatus === 'rejected') {
        attendance.leaveApplication.rejectionReason = rejectionReason;
        attendance.status = 'unmarked'; // Reset status if rejected
      }

      await attendance.save();

      // Update all other attendance records for the same multi-day leave application
      if (
        attendance.leaveApplication &&
        attendance.leaveApplication.startDate &&
        attendance.leaveApplication.endDate
      ) {
        const updateFields = {
          'leaveApplication.approvalStatus': approvalStatus,
          'leaveApplication.approvedBy': approvedBy,
          'leaveApplication.approvedAt': new Date(),
        };
        if (approvalStatus === 'rejected') {
          updateFields['leaveApplication.rejectionReason'] = rejectionReason;
          updateFields.status = 'unmarked';
        }
        await StaffAttendance.updateMany(
          scopeBySchool(req.user?.schoolId, {
            _id: { $ne: attendance._id },
            staffId: attendance.staffId,
            date: {
              $gte: attendance.leaveApplication.startDate,
              $lte: attendance.leaveApplication.endDate,
            },
            'leaveApplication.approvalStatus': 'pending',
          }),
          { $set: updateFields }
        );
      }

      res.json({ success: true, attendance });
    } catch (error) {
      console.error('[StaffAttendance] Error approving/rejecting leave:', error);
      res.status(500).json({ error: 'Failed to process leave application' });
    }
  }
);

// Get staff attendance summary
router.get(
  '/summary/:staffId',
  checkPermission('staff', 'view'),
  async (req, res) => {
    try {
      const { staffId } = req.params;
      const month = parseInt(req.query.month);
      const year = parseInt(req.query.year);

      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const endDate = `${year}-${String(month).padStart(2, '0')}-31`;

      const attendance = await StaffAttendance.find(
        scopeBySchool(req.user?.schoolId, {
          staffId,
          date: { $gte: startDate, $lte: endDate },
        })
      );

      const summary = {
        present: attendance.filter((a) => a.status === 'present').length,
        absent: attendance.filter((a) => a.status === 'absent').length,
        leave: attendance.filter((a) => a.status === 'leave').length,
        halfday: attendance.filter((a) => a.status === 'halfday').length,
        unmarked: attendance.filter((a) => a.status === 'unmarked').length,
        total: attendance.length,
      };

      res.json(summary);
    } catch (error) {
      console.error('[StaffAttendance] Error fetching attendance summary:', error);
      res.status(500).json({ error: 'Failed to fetch attendance summary' });
    }
  }
);

export default router;
