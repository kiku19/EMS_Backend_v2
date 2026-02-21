import express from 'express';
import TeacherLeave from '../models/TeacherLeave.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Get all leaves for a teacher
router.get('/teacher/:teacherId', authenticate, async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { status, year } = req.query;

    const query = { teacherId };
    if (status) query.status = status;
    if (year) {
      query.startDate = {
        $gte: new Date(`${year}-01-01`),
        $lte: new Date(`${year}-12-31`)
      };
    }

    const leaves = await TeacherLeave.find(query)
      .populate('approvedBy', 'name')
      .sort({ appliedAt: -1 });

    res.json(leaves);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all pending leaves (for admin)
router.get('/pending', authenticate, async (req, res) => {
  try {
    const leaves = await TeacherLeave.find({ status: 'pending' })
      .populate('teacherId', 'name code email phone')
      .sort({ appliedAt: -1 });

    res.json(leaves);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get leave by ID
router.get('/:id', authenticate, async (req, res) => {
  try {
    const leave = await TeacherLeave.findById(req.params.id)
      .populate('teacherId', 'name code email phone')
      .populate('approvedBy', 'name')
      .populate('substitutions.substituteTeacherId', 'name');

    if (!leave) {
      return res.status(404).json({ error: 'Leave not found' });
    }

    res.json(leave);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Apply for leave (teacher)
router.post('/', authenticate, async (req, res) => {
  try {
    const {
      teacherId,
      leaveType,
      reason,
      startDate,
      endDate,
      days,
      attachments
    } = req.body;

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
    io.emit('leave_applied', {
      leaveId: leave._id,
      teacherId,
      leaveType,
      startDate,
      endDate,
      days: calculatedDays,
      timestamp: new Date()
    });

    const populatedLeave = await TeacherLeave.findById(leave._id)
      .populate('teacherId', 'name code');

    res.status(201).json(populatedLeave);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Approve/Reject leave (admin)
router.put('/:id/status', authenticate, async (req, res) => {
  try {
    const { status, approvedBy, rejectionReason, substitutions } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const updateData = {
      status,
      approvedBy,
      approvedAt: new Date()
    };

    if (status === 'rejected' && rejectionReason) {
      updateData.rejectionReason = rejectionReason;
    }

    if (substitutions) {
      updateData.substitutions = substitutions;
    }

    const leave = await TeacherLeave.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).populate('teacherId', 'name code email').populate('approvedBy', 'name');

    if (!leave) {
      return res.status(404).json({ error: 'Leave not found' });
    }

    // Emit socket event
    const io = req.app.get('io');
    io.emit('leave_status_updated', {
      leaveId: leave._id,
      teacherId: leave.teacherId._id,
      status,
      timestamp: new Date()
    });

    // Send push notification to teacher
    try {
      const pushNotificationService = require('../services/pushNotificationService');

      await pushNotificationService.sendToUser(
        leave.teacherId.toString(),
        status === 'approved' ? 'Leave Approved' : 'Leave Update',
        status === 'approved'
          ? `Your leave request has been approved`
          : `Your leave request has been ${status}: ${rejectionReason || ''}`,
        {
          type: 'leave',
          leaveId: leave._id,
          status,
        }
      );
    } catch (error) {
      console.error('Error sending push notification:', error);
    }

    res.json(leave);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cancel leave (teacher)
router.put('/:id/cancel', authenticate, async (req, res) => {
  try {
    const leave = await TeacherLeave.findByIdAndUpdate(
      req.params.id,
      {
        status: 'cancelled',
        updatedAt: new Date()
      },
      { new: true }
    ).populate('teacherId', 'name');

    if (!leave) {
      return res.status(404).json({ error: 'Leave not found' });
    }

    // Emit socket event
    const io = req.app.get('io');
    io.emit('leave_cancelled', {
      leaveId: leave._id,
      teacherId: leave.teacherId._id,
      timestamp: new Date()
    });

    res.json(leave);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get leave statistics for a teacher
router.get('/teacher/:teacherId/stats', authenticate, async (req, res) => {
  try {
    const { teacherId } = req.params;
    const year = req.query.year || new Date().getFullYear();

    const startDate = new Date(`${year}-01-01`);
    const endDate = new Date(`${year}-12-31`);

    const leaves = await TeacherLeave.find({
      teacherId,
      startDate: { $gte: startDate, $lte: endDate }
    });

    const stats = {
      total: leaves.length,
      approved: leaves.filter(l => l.status === 'approved').length,
      pending: leaves.filter(l => l.status === 'pending').length,
      rejected: leaves.filter(l => l.status === 'rejected').length,
      cancelled: leaves.filter(l => l.status === 'cancelled').length,
      byType: {
        sick: leaves.filter(l => l.leaveType === 'sick' && l.status === 'approved').reduce((sum, l) => sum + l.days, 0),
        casual: leaves.filter(l => l.leaveType === 'casual' && l.status === 'approved').reduce((sum, l) => sum + l.days, 0),
        earned: leaves.filter(l => l.leaveType === 'earned' && l.status === 'approved').reduce((sum, l) => sum + l.days, 0),
        unpaid: leaves.filter(l => l.leaveType === 'unpaid' && l.status === 'approved').reduce((sum, l) => sum + l.days, 0),
      },
      totalDays: leaves.filter(l => l.status === 'approved').reduce((sum, l) => sum + l.days, 0)
    };

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
