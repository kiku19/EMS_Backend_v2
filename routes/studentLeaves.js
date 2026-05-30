import express from 'express';
import StudentLeave from '../models/StudentLeave.js';
import { authenticate } from '../middleware/auth.js';
import { authenticateParent } from '../middleware/auth/parentAuth.js';
import { extractSchoolId } from '../utils/schoolContext.js';
import { EVENTS, emitEvent } from '../utils/socketEvents.js';
import { checkPermission, requireAdmin } from '../middleware/permissions.js';
import {
  createStudentLeaveSchema,
  updateStudentLeaveSchema,
  updateStudentLeaveStatusSchema,
  studentLeaveQuerySchema,
} from '../validators/leaveSchema.js';
import { validateZod } from '../validators/zodHelpers.js';

const router = express.Router();

// Helper to scope all queries by schoolId for multi-tenancy isolation
function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) {
    throw new Error('schoolId is required for scoped queries');
  }
  return { ...query, schoolId: normalizedSchoolId };
}

// Dual-auth middleware: allows both staff (via authenticate) and parents
// (via authenticateParent) to access the endpoint.
function authenticateStaffOrParent(req, res, next) {
  // Try staff auth first
  authenticate(req, res, (staffErr) => {
    if (!staffErr && req.user?.id) {
      return next();
    }
    // Fall back to parent auth
    authenticateParent(req, res, (parentErr) => {
      if (parentErr) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }
      next();
    });
  });
}

// ─── LIST ───────────────────────────────────────────────────────────────────
// GET / — list with filters (status, studentId, leaveType, date range, pagination)
router.get(
  '/',
  authenticate,
  validateZod(studentLeaveQuerySchema, 'query'),
  async (req, res) => {
    try {
      const {
        status,
        studentId,
        leaveType,
        startDateFrom,
        startDateTo,
        skip: skipStr,
        limit: limitStr,
      } = req.query;

      const query = scopeBySchool(req.user.schoolId);

      if (status) query.status = status;
      if (studentId) query.studentId = studentId;
      if (leaveType) query.leaveType = leaveType;

      if (startDateFrom || startDateTo) {
        query.startDate = {};
        if (startDateFrom) query.startDate.$gte = new Date(startDateFrom);
        if (startDateTo) query.startDate.$lte = new Date(startDateTo);
      }

      const skip = parseInt(skipStr) || 0;
      const limit = Math.min(parseInt(limitStr) || 20, 100);

      const [leaves, total] = await Promise.all([
        StudentLeave.find(query)
          .populate('studentId', 'name admissionId rollNo classId photo')
          .populate('reviewedBy', 'name code')
          .populate('appliedByParentId', 'name phone')
          .sort({ appliedAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        StudentLeave.countDocuments(query),
      ]);

      res.json({
        success: true,
        data: leaves,
        pagination: { total, skip, limit, hasMore: skip + leaves.length < total },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ─── DETAIL ─────────────────────────────────────────────────────────────────
// GET /:id — single leave detail
router.get('/:id', authenticate, async (req, res) => {
  try {
    const leave = await StudentLeave.findOne(
      scopeBySchool(req.user.schoolId, { _id: req.params.id })
    )
      .populate('studentId', 'name admissionId rollNo classId photo gender dateOfBirth')
      .populate('reviewedBy', 'name code email phone')
      .populate('appliedByParentId', 'name phone email');

    if (!leave) {
      return res.status(404).json({ success: false, error: 'Leave not found' });
    }

    res.json({ success: true, data: leave });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── CREATE ─────────────────────────────────────────────────────────────────
// POST / — create leave application (by parent or admin)
router.post('/', authenticateStaffOrParent, async (req, res) => {
  try {
    const parsed = createStudentLeaveSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        error: 'Validation failed',
        details: parsed.error.errors,
      });
    }

    const { studentId, appliedByParentId, leaveType, reason, startDate, endDate, days } =
      parsed.data;

    // Calculate days if not provided
    let calculatedDays = days;
    if (!calculatedDays) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      calculatedDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
    }

    const schoolId = extractSchoolId(req.user.schoolId);

    const leave = new StudentLeave({
      schoolId,
      studentId,
      appliedByParentId,
      leaveType,
      reason,
      startDate,
      endDate,
      days: calculatedDays,
      status: 'pending',
      appliedAt: new Date(),
    });

    await leave.save();

    // Emit socket event for real-time notification
    const io = req.app.get('io');
    emitEvent(io, EVENTS.LEAVE_APPLIED, {
      schoolId,
      leaveId: leave._id.toString(),
      studentId: studentId?.toString(),
      leaveType,
      startDate,
      endDate,
      days: calculatedDays,
    });

    const populatedLeave = await StudentLeave.findById(leave._id)
      .populate('studentId', 'name admissionId rollNo')
      .populate('appliedByParentId', 'name phone');

    res.status(201).json({ success: true, data: populatedLeave });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── UPDATE ─────────────────────────────────────────────────────────────────
// PUT /:id — update leave (dates, reason, type)
router.put('/:id', authenticate, checkPermission('students', 'edit'), async (req, res) => {
  try {
    const parsed = updateStudentLeaveSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        error: 'Validation failed',
        details: parsed.error.errors,
      });
    }

    const { leaveType, reason, startDate, endDate, days } = parsed.data;

    const leave = await StudentLeave.findOne(
      scopeBySchool(req.user.schoolId, { _id: req.params.id })
    );

    if (!leave) {
      return res.status(404).json({ success: false, error: 'Leave not found' });
    }

    // Only allow updates if leave is still pending
    if (leave.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: `Cannot update a leave that is already '${leave.status}'`,
      });
    }

    let calculatedDays = days;
    if (startDate && endDate && !calculatedDays) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      calculatedDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
    }

    if (leaveType !== undefined) leave.leaveType = leaveType;
    if (reason !== undefined) leave.reason = reason;
    if (startDate !== undefined) leave.startDate = startDate;
    if (endDate !== undefined) leave.endDate = endDate;
    if (calculatedDays !== undefined) leave.days = calculatedDays;
    leave.updatedAt = new Date();

    await leave.save();

    const populatedLeave = await StudentLeave.findById(leave._id)
      .populate('studentId', 'name admissionId rollNo')
      .populate('reviewedBy', 'name code')
      .populate('appliedByParentId', 'name phone');

    res.json({ success: true, data: populatedLeave });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── APPROVE / REJECT ───────────────────────────────────────────────────────
// PUT /:id/review — approve/reject with remarks (admin only)
router.put('/:id/review', authenticate, requireAdmin, async (req, res) => {
  try {
    const parsed = updateStudentLeaveStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        error: 'Validation failed',
        details: parsed.error.errors,
      });
    }

    const { status, rejectionReason, adminRemarks } = parsed.data;

    const leave = await StudentLeave.findOne(
      scopeBySchool(req.user.schoolId, { _id: req.params.id })
    );

    if (!leave) {
      return res.status(404).json({ success: false, error: 'Leave not found' });
    }

    // Only pending leaves can be approved or rejected
    if (leave.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: `Cannot change status of a leave that is already '${leave.status}'`,
      });
    }

    leave.status = status;
    leave.reviewedBy = req.user.id;
    leave.reviewedAt = new Date();

    if (status === 'rejected' && rejectionReason) {
      leave.rejectionReason = rejectionReason;
    }
    if (adminRemarks) {
      leave.adminRemarks = adminRemarks;
    }
    leave.updatedAt = new Date();

    await leave.save();

    // Emit socket event
    const io = req.app.get('io');
    emitEvent(io, EVENTS.LEAVE_STATUS_UPDATED, {
      schoolId: req.user.schoolId?.toString(),
      leaveId: leave._id.toString(),
      studentId: leave.studentId.toString(),
      status,
    });

    // Send push notification to parent
    try {
      const { default: pushNotificationService } = await import(
        '../services/pushNotificationService.js'
      );
      await pushNotificationService.sendToUser(
        leave.appliedByParentId.toString(),
        status === 'approved' ? 'Leave Approved' : 'Leave Update',
        status === 'approved'
          ? `Your child's leave request has been approved`
          : `Your child's leave request has been ${status}: ${rejectionReason || ''}`,
        {
          type: 'student_leave',
          leaveId: leave._id,
          status,
        }
      );
    } catch (error) {
      console.error('Error sending push notification:', error);
    }

    const populatedLeave = await StudentLeave.findById(leave._id)
      .populate('studentId', 'name admissionId rollNo')
      .populate('reviewedBy', 'name code')
      .populate('appliedByParentId', 'name phone');

    res.json({ success: true, data: populatedLeave });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── CANCEL / SOFT DELETE ───────────────────────────────────────────────────
// DELETE /:id — soft delete / cancel (admin only)
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const leave = await StudentLeave.findOne(
      scopeBySchool(req.user.schoolId, { _id: req.params.id })
    ).populate('studentId', 'name');

    if (!leave) {
      return res.status(404).json({ success: false, error: 'Leave not found' });
    }

    // Only allow cancellation if leave is pending or approved
    if (!['pending', 'approved'].includes(leave.status)) {
      return res.status(400).json({
        success: false,
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
      studentId: leave.studentId._id?.toString() || leave.studentId.toString(),
    });

    res.json({ success: true, data: leave });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── PENDING LIST (ADMIN) ───────────────────────────────────────────────────
// GET /pending/list — all pending leaves for admin review
router.get(
  '/pending/list',
  authenticate,
  checkPermission('students', 'view'),
  async (req, res) => {
    try {
      const leaves = await StudentLeave.find(
        scopeBySchool(req.user.schoolId, { status: 'pending' })
      )
        .populate('studentId', 'name admissionId rollNo classId photo')
        .populate('appliedByParentId', 'name phone')
        .sort({ appliedAt: -1 });

      res.json({ success: true, data: leaves });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ─── STUDENT-SPECIFIC LIST ──────────────────────────────────────────────────
// GET /student/:studentId — all leaves for a specific student
router.get('/student/:studentId', authenticate, async (req, res) => {
  try {
    const { studentId } = req.params;
    const { status, year, skip: skipStr, limit: limitStr } = req.query;

    const query = scopeBySchool(req.user.schoolId, { studentId });
    if (status) query.status = status;
    if (year) {
      query.startDate = {
        $gte: new Date(`${year}-01-01`),
        $lte: new Date(`${year}-12-31`),
      };
    }

    const skip = parseInt(skipStr) || 0;
    const limit = Math.min(parseInt(limitStr) || 20, 100);

    const leaves = await StudentLeave.find(query)
      .populate('studentId', 'name admissionId rollNo classId photo')
      .populate('reviewedBy', 'name code')
      .sort({ appliedAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({ success: true, data: leaves });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── STATS ──────────────────────────────────────────────────────────────────
// GET /student/:studentId/stats — leave statistics for a student
router.get('/student/:studentId/stats', authenticate, async (req, res) => {
  try {
    const { studentId } = req.params;
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const startDate = new Date(`${year}-01-01`);
    const endDate = new Date(`${year}-12-31`);

    const leaves = await StudentLeave.find(
      scopeBySchool(req.user.schoolId, {
        studentId,
        startDate: { $gte: startDate, $lte: endDate },
      })
    );

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

    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
