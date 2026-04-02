import express from 'express';
import TeacherLeave from '../models/TeacherLeave.js';
import { authenticate } from '../middleware/auth.js';
import { extractSchoolId } from '../utils/schoolContext.js';
import { EVENTS, emitEvent } from '../utils/socketEvents.js';
import { checkPermission } from '../middleware/permissions.js';
import { applyLeaveSchema, updateLeaveStatusSchema } from '../validators/leaveSchema.js';

const router = express.Router();
router.use(authenticate);

// Fix 5.6: Helper to scope all queries by schoolId for multi-tenancy isolation
function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) {
    throw new Error('schoolId is required for scoped queries');
  }
  return { ...query, schoolId: normalizedSchoolId };
}

// Get all leaves for a teacher
router.get('/teacher/:teacherId', async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { status, year, skip: skipStr, limit: limitStr } = req.query;

    // Non-admins can only view their own leaves
    const isAdmin =
      req.user.role === 'admin' ||
      (Array.isArray(req.user.role) &&
        req.user.role.some((r) => ['admin', 'Admin', 'Principal', 'principal'].includes(r)));
    if (!isAdmin && req.user.id.toString() !== teacherId) {
      return res.status(403).json({ error: "Not authorized to view another teacher's leaves" });
    }

    const query = scopeBySchool(req.user.schoolId, { teacherId });
    if (status) query.status = status;
    if (year) {
      query.startDate = {
        $gte: new Date(`${year}-01-01`),
        $lte: new Date(`${year}-12-31`),
      };
    }

    const skip = parseInt(skipStr) || 0;
    const limit = Math.min(parseInt(limitStr) || 20, 100);

    const leaves = await TeacherLeave.find(query)
      .populate('approvedBy', 'name')
      .sort({ appliedAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json(leaves);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all pending leaves (for admin)
router.get('/pending', checkPermission('staff', 'view'), async (req, res) => {
  try {
    const leaves = await TeacherLeave.find(scopeBySchool(req.user.schoolId, { status: 'pending' }))
      .populate('teacherId', 'name code email phone')
      .sort({ appliedAt: -1 });

    res.json(leaves);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get leave by ID
router.get('/:id', async (req, res) => {
  try {
    const leave = await TeacherLeave.findOne(
      scopeBySchool(req.user.schoolId, { _id: req.params.id })
    )
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
router.post('/', async (req, res) => {
  try {
    const parsed = applyLeaveSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const { leaveType, reason, startDate, endDate, days, attachments } = parsed.data;
    // Always use authenticated user's ID — never trust client-supplied teacherId
    const teacherId = req.user.id;

    // Calculate days if not provided
    let calculatedDays = days;
    if (!calculatedDays) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      calculatedDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
    }

    const schoolId = extractSchoolId(req.user.schoolId);
    const leave = new TeacherLeave({
      schoolId,
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
      schoolId,
      leaveId: leave._id.toString(),
      teacherId: teacherId?.toString(),
      leaveType,
      startDate,
      endDate,
      days: calculatedDays,
    });

    const populatedLeave = await TeacherLeave.findById(leave._id).populate(
      'teacherId',
      'name code'
    );

    res.status(201).json(populatedLeave);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Approve/Reject leave (admin)
router.put('/:id/status', async (req, res) => {
  try {
    // Only admins and principals can approve/reject
    const userRole = req.user.role;
    const isAdmin =
      userRole === 'admin' ||
      (Array.isArray(userRole) &&
        userRole.some((r) => ['admin', 'Admin', 'Principal', 'principal'].includes(r)));
    if (!isAdmin) {
      return res
        .status(403)
        .json({ error: 'Only admins or principals can approve or reject leave requests' });
    }

    const parsed = updateLeaveStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const { status, rejectionReason, substitutions } = parsed.data;

    const updateData = {
      status,
      approvedBy: req.user.id,
      approvedAt: new Date(),
    };

    if (status === 'rejected' && rejectionReason) {
      updateData.rejectionReason = rejectionReason;
    }

    if (substitutions) {
      updateData.substitutions = substitutions;
    }

    const leave = await TeacherLeave.findOneAndUpdate(
      scopeBySchool(req.user.schoolId, { _id: req.params.id }),
      updateData,
      { new: true }
    )
      .populate('teacherId', 'name code email')
      .populate('approvedBy', 'name');

    if (!leave) {
      return res.status(404).json({ error: 'Leave not found' });
    }

    // Emit socket event
    const io = req.app.get('io');
    emitEvent(io, EVENTS.LEAVE_STATUS_UPDATED, {
      schoolId: req.user.schoolId?.toString(),
      leaveId: leave._id.toString(),
      teacherId: leave.teacherId._id.toString(),
      status,
    });

    // Send push notification to teacher
    try {
      const { default: pushNotificationService } =
        await import('../services/pushNotificationService.js');

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

// Cancel leave (teacher - can only cancel own leave, or admin can cancel any)
router.put('/:id/cancel', async (req, res) => {
  try {
    const leave = await TeacherLeave.findOne(
      scopeBySchool(req.user.schoolId, { _id: req.params.id })
    ).populate('teacherId', 'name');

    if (!leave) {
      return res.status(404).json({ error: 'Leave not found' });
    }

    // Authorization: only the leave owner or an admin can cancel
    const isOwner = leave.teacherId._id.toString() === req.user.id.toString();
    const isAdmin =
      req.user.role === 'admin' ||
      (Array.isArray(req.user.role) &&
        req.user.role.some((r) => ['Admin', 'Principal'].includes(r)));
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Not authorized to cancel this leave' });
    }

    // Only allow cancellation if leave is pending or approved
    if (!['pending', 'approved'].includes(leave.status)) {
      return res.status(400).json({
        error: `Cannot cancel a leave that is already '${leave.status}'`,
      });
    }

    leave.status = 'cancelled';
    leave.updatedAt = new Date();
    await leave.save();

    // Emit socket event
    const io = req.app.get('io');
    emitEvent(io, EVENTS.LEAVE_CANCELLED, {
      schoolId: req.user.schoolId?.toString(),
      leaveId: leave._id.toString(),
      teacherId: leave.teacherId._id.toString(),
    });

    res.json(leave);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get leave statistics for a teacher
router.get('/teacher/:teacherId/stats', async (req, res) => {
  try {
    const { teacherId } = req.params;
    const year = parseInt(req.query.year) || new Date().getFullYear();

    // Non-admins can only view their own stats
    const isAdmin =
      req.user.role === 'admin' ||
      (Array.isArray(req.user.role) &&
        req.user.role.some((r) => ['admin', 'Admin', 'Principal', 'principal'].includes(r)));
    if (!isAdmin && req.user.id.toString() !== teacherId) {
      return res
        .status(403)
        .json({ error: "Not authorized to view another teacher's leave statistics" });
    }

    const startDate = new Date(`${year}-01-01`);
    const endDate = new Date(`${year}-12-31`);

    const leaves = await TeacherLeave.find(
      scopeBySchool(req.user.schoolId, {
        teacherId,
        startDate: { $gte: startDate, $lte: endDate },
      })
    );

    // Dynamically aggregate approved days by leave type name (matches HR settings enum values)
    const byType = {};
    leaves
      .filter((l) => l.status === 'approved')
      .forEach((l) => {
        if (l.leaveType) {
          byType[l.leaveType] = (byType[l.leaveType] || 0) + l.days;
        }
      });

    const stats = {
      total: leaves.length,
      approved: leaves.filter((l) => l.status === 'approved').length,
      pending: leaves.filter((l) => l.status === 'pending').length,
      rejected: leaves.filter((l) => l.status === 'rejected').length,
      cancelled: leaves.filter((l) => l.status === 'cancelled').length,
      byType,
      totalDays: leaves.filter((l) => l.status === 'approved').reduce((sum, l) => sum + l.days, 0),
    };

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
