import express from 'express';
import StaffAttendance from '../models/StaffAttendance.js';
import { Staff } from '../database.js';
import substitutionService from '../services/substitutionService.js';

const router = express.Router();

// Get all attendance records (for initial data load)
router.get('/', async (req, res) => {
  try {
    console.log('[StaffAttendance Routes] Fetching all staff attendance');
    const attendance = await StaffAttendance.find().sort({ date: -1 });
    console.log('[StaffAttendance Routes] Found', attendance.length, 'records');

    // Return as array of objects to match what webapp expects
    const attendanceArray = attendance.map(att => ({
      staffId: att.staffId.toString(),
      date: att.date,
      status: att.status,
      checkInTime: att.checkInTime || '-',
      checkOutTime: att.checkOutTime || '-',
      reason: att.reason || ''
    }));

    console.log('[StaffAttendance Routes] Returning', attendanceArray.length, 'records');
    if (attendanceArray.length > 0) {
      console.log('[StaffAttendance Routes] Sample record:', attendanceArray[0]);
    }
    res.json(attendanceArray);
  } catch (error) {
    console.error('[StaffAttendance Routes] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get attendance for a specific date
router.get('/date/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const attendance = await StaffAttendance.find({ date })
      .populate('staffId', 'name code department role')
      .populate('markedBy', 'name')
      .sort({ 'staffId.name': 1 });

    res.json(attendance);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get attendance for a staff member (with date range)
router.get('/staff/:staffId', async (req, res) => {
  try {
    const { staffId } = req.params;
    const { startDate, endDate } = req.query;

    const query = { staffId };
    if (startDate && endDate) {
      query.date = { $gte: startDate, $lte: endDate };
    }

    const attendance = await StaffAttendance.find(query)
      .sort({ date: -1 })
      .limit(100);

    res.json(attendance);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get today's attendance for a staff member (for mobile app)
router.get('/staff/:staffId/today', async (req, res) => {
  try {
    const { staffId } = req.params;
    const today = new Date().toISOString().split('T')[0];

    console.log('[StaffAttendance] Getting today attendance for staff:', staffId, 'date:', today);

    const todayAttendance = await StaffAttendance.findOne({
      staffId,
      date: today
    });

    if (todayAttendance) {
      res.json({
        id: todayAttendance._id,
        staffId: todayAttendance.staffId,
        date: todayAttendance.date,
        status: todayAttendance.status,
        checkInTime: todayAttendance.checkInTime || null,
        checkOutTime: todayAttendance.checkOutTime || null,
        reason: todayAttendance.reason || ''
      });
    } else {
      // Return unmarked status
      res.json({
        staffId: staffId,
        date: today,
        status: 'unmarked',
        checkInTime: null,
        checkOutTime: null,
        reason: ''
      });
    }
  } catch (error) {
    console.error('[StaffAttendance] Error getting today attendance:', error);
    res.status(500).json({ error: error.message });
  }
});

// Mark attendance (admin/manual)
router.post('/', async (req, res) => {
  try {
    const { staffId, date, status, checkInTime, checkOutTime, reason, markedBy } = req.body;

    const attendance = await StaffAttendance.findOneAndUpdate(
      { staffId, date },
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
        checkOutMethod: 'admin'
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
        reason: reason || ''
      });
    }

    // TRIGGER: Create substitution alerts if teacher is absent
    if (status === 'absent' || status === 'leave') {
      try {
        const staff = attendance.staffId;
        const isTeacher = staff?.role?.includes('Teacher') ||
          staff?.staffType?.includes('Teacher');

        if (isTeacher) {
          console.log(`[StaffAttendance] Admin marked teacher ${staff.name} as ${status}, triggering substitution alerts...`);

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
              markedBy: 'admin'
            });
          }
        }
      } catch (subError) {
        console.error('[StaffAttendance] Error creating substitution alerts:', subError);
      }
    }

    res.json(attendance);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Bulk mark attendance
router.post('/bulk', async (req, res) => {
  try {
    const { date, staffIds, status, markedBy, reason, checkInTime, checkOutTime } = req.body;

    // Default times if not provided
    const defaultInTime = checkInTime || (status === 'present' ? '09:00' : '-');
    const defaultOutTime = checkOutTime || '-';
    const finalReason = reason || '';

    const operations = staffIds.map(staffId => ({
      updateOne: {
        filter: { staffId, date },
        update: {
          $set: {
            status,
            checkInTime: defaultInTime,
            checkOutTime: defaultOutTime,
            reason: finalReason,
            markedBy,
            lastModifiedBy: markedBy,
            checkInMethod: 'admin'
          }
        },
        upsert: true
      }
    }));

    const result = await StaffAttendance.bulkWrite(operations);
    res.json({ success: true, modified: result.modifiedCount, upserted: result.upsertedCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Regularize attendance
router.put('/:id/regularize', async (req, res) => {
  try {
    const { id } = req.params;
    const { date, status, checkInTime, checkOutTime, reason, regularizedBy } = req.body;

    let attendance = null;

    // Try to find by ID (if it's a valid attendance ID)
    try {
      attendance = await StaffAttendance.findById(id);
    } catch (e) {
      // Ignore cast error, might be staffId
    }

    // If not found by ID, try finding by staffId and date
    if (!attendance && date) {
      attendance = await StaffAttendance.findOne({ staffId: id, date });
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
        regularization: {
          regularizedBy,
          regularizedAt: new Date(),
          previousStatus: 'unmarked',
          regularizationReason: reason
        }
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
          reason: attendance.reason || ''
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
      regularizationReason: reason
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
        reason: attendance.reason || ''
      });
    }

    res.json(attendance);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ MOBILE APP ENDPOINTS ============

// Mark attendance from mobile app (with status and reason)
router.post('/mobile/mark', async (req, res) => {
  try {
    const { staffId, status, reason, location } = req.body;
    const date = new Date().toISOString().split('T')[0];
    const currentTime = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });

    console.log('[StaffAttendance] Mobile mark request:', { staffId, status, reason, date });

    // Validate staff exists
    const staff = await Staff.findById(staffId);
    if (!staff) {
      return res.status(404).json({
        success: false,
        error: 'Staff not found'
      });
    }

    // Validate status
    const validStatuses = ['present', 'absent', 'leave', 'halfday'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status. Must be one of: present, absent, leave, halfday'
      });
    }

    // Check for duplicate submission
    const existingAttendance = await StaffAttendance.findOne({ staffId, date });
    if (existingAttendance) {
      return res.status(400).json({
        success: false,
        error: 'Attendance already marked for today'
      });
    }

    // Validate reason for non-present statuses
    if (status !== 'present' && !reason?.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Reason is required for absent/leave/halfday'
      });
    }

    // Create new attendance record
    const newAttendance = new StaffAttendance({
      staffId,
      date,
      status,
      checkInTime: status === 'present' ? currentTime : '-',
      checkOutTime: '-',
      reason: reason || '',
      checkInMethod: 'mobile',
      checkInLocation: location || null,
      markedBy: staffId,
      lastModifiedBy: staffId
    });

    await newAttendance.save();

    console.log('[StaffAttendance] Attendance marked successfully:', newAttendance._id);

    // TRIGGER: Create substitution alerts if teacher is absent
    if (status === 'absent' || status === 'leave') {
      try {
        // Check if staff is a teacher
        const isTeacher = staff.role?.includes('Teacher') ||
          staff.staffType?.includes('Teacher') ||
          staff.teacherAssignments?.length > 0;

        if (isTeacher) {
          console.log(`[StaffAttendance] Teacher ${staff.name} is ${status}, triggering substitution alerts...`);

          // Create substitution alerts for this teacher's classes today
          const substitutions = await substitutionService.createSubstitutionFromAbsence(
            staffId,
            date,
            reason || `${status.charAt(0).toUpperCase() + status.slice(1)}`
          );

          console.log(`[StaffAttendance] Created ${substitutions.length} substitution alert(s)`);

          // Emit substitution alert to dashboard
          if (req.app?.get('io') && substitutions.length > 0) {
            req.app.get('io').emit('substitution_alert', {
              type: 'new_alerts',
              teacherName: staff.name,
              teacherId: staffId,
              date: date,
              count: substitutions.length,
              substitutions: substitutions.map(s => ({
                id: s._id,
                classId: s.classId,
                period: s.period
              }))
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
        reason: reason || ''
      });
    }

    res.json({
      success: true,
      message: 'Attendance marked successfully',
      attendance: {
        id: newAttendance._id,
        staffId: newAttendance.staffId,
        date: newAttendance.date,
        status: newAttendance.status,
        checkInTime: newAttendance.checkInTime,
        reason: newAttendance.reason
      }
    });
  } catch (error) {
    console.error('[StaffAttendance] Error marking attendance:', error);
    res.status(500).json({ error: error.message });
  }
});

// Check-in (from mobile app)
router.post('/mobile/checkin', async (req, res) => {
  try {
    const { staffId, location } = req.body;
    const date = new Date().toISOString().split('T')[0];
    const checkInTime = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });

    const attendance = await StaffAttendance.findOneAndUpdate(
      { staffId, date },
      {
        staffId,
        date,
        status: 'present',
        checkInTime,
        checkInLocation: location,
        checkInMethod: 'mobile',
        lastModifiedBy: staffId
      },
      { upsert: true, new: true }
    ).populate('staffId', 'name code department role');

    res.json({ success: true, attendance });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Check-out (from mobile app)
router.post('/mobile/checkout', async (req, res) => {
  try {
    const { staffId, location } = req.body;
    const date = new Date().toISOString().split('T')[0];
    const checkOutTime = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });

    const attendance = await StaffAttendance.findOneAndUpdate(
      { staffId, date },
      {
        checkOutTime,
        checkOutLocation: location,
        checkOutMethod: 'mobile',
        lastModifiedBy: staffId
      },
      { new: true }
    ).populate('staffId', 'name code department role');

    if (!attendance) {
      return res.status(404).json({ error: 'Please check-in first' });
    }

    res.json({ success: true, attendance });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Apply for leave (from mobile app)
router.post('/mobile/leave/apply', async (req, res) => {
  try {
    const { staffId, leaveType, startDate, endDate, reason } = req.body;

    // Calculate number of days
    const start = new Date(startDate);
    const end = new Date(endDate);
    const numberOfDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

    // Create attendance records for each day
    const operations = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      operations.push({
        updateOne: {
          filter: { staffId, date: dateStr },
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
                approvalStatus: 'pending'
              },
              lastModifiedBy: staffId
            }
          },
          upsert: true
        }
      });
    }

    const result = await StaffAttendance.bulkWrite(operations);

    res.json({
      success: true,
      message: 'Leave application submitted successfully',
      numberOfDays,
      modified: result.modifiedCount,
      upserted: result.upsertedCount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get pending leave applications
router.get('/leave/pending', async (req, res) => {
  try {
    const pendingLeaves = await StaffAttendance.find({
      'leaveApplication.approvalStatus': 'pending'
    })
      .populate('staffId', 'name code department role')
      .sort({ 'leaveApplication.appliedAt': -1 });

    res.json(pendingLeaves);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Approve/Reject leave
router.put('/leave/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const { approvalStatus, approvedBy, rejectionReason } = req.body;

    const attendance = await StaffAttendance.findById(id);
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

    res.json({ success: true, attendance });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get staff attendance summary
router.get('/summary/:staffId', async (req, res) => {
  try {
    const { staffId } = req.params;
    const { month, year } = req.query;

    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month).padStart(2, '0')}-31`;

    const attendance = await StaffAttendance.find({
      staffId,
      date: { $gte: startDate, $lte: endDate }
    });

    const summary = {
      present: attendance.filter(a => a.status === 'present').length,
      absent: attendance.filter(a => a.status === 'absent').length,
      leave: attendance.filter(a => a.status === 'leave').length,
      halfday: attendance.filter(a => a.status === 'halfday').length,
      unmarked: attendance.filter(a => a.status === 'unmarked').length,
      total: attendance.length
    };

    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
