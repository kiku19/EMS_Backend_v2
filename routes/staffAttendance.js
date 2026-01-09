import express from 'express';
import StaffAttendance from '../models/StaffAttendance.js';
import { Staff } from '../database.js';

const router = express.Router();

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
    
    res.json(attendance);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Bulk mark attendance
router.post('/bulk', async (req, res) => {
  try {
    const { date, staffIds, status, markedBy } = req.body;
    
    const operations = staffIds.map(staffId => ({
      updateOne: {
        filter: { staffId, date },
        update: {
          $set: {
            staffId,
            date,
            status,
            checkInTime: status === 'present' ? '09:00' : '-',
            checkOutTime: '-',
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
    const { status, checkInTime, checkOutTime, reason, regularizedBy } = req.body;
    
    const attendance = await StaffAttendance.findById(id);
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
    
    res.json(attendance);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ MOBILE APP ENDPOINTS ============

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
