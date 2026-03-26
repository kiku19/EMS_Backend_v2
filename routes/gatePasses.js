import express from 'express';
import GatePass from '../models/GatePass.js';
import { Student, Staff } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { extractSchoolId } from '../utils/schoolContext.js';

function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) throw new Error('schoolId is required for scoped queries');
  return { ...query, schoolId: normalizedSchoolId };
}

async function resolveRequestSchoolId(req) {
  const schoolId = req.user?.schoolId ? extractSchoolId(req.user.schoolId) : null;
  if (!schoolId) throw new Error(req.t('common:errors.unauthorized'));
  return schoolId;
}

const router = express.Router();
router.use(authenticate);

// Middleware to attach models to req.app.locals if not already there
router.use((req, res, next) => {
  if (!req.app.locals.Student) {
    req.app.locals.Student = require('../database.js').Student;
  }
  if (!req.app.locals.Staff) {
    req.app.locals.Staff = require('../database.js').Staff;
  }
  next();
});

/**
 * GET /api/gate-passes
 * Get all gate passes with optional filters
 * Query params: status (active/all/today/pending), studentId, class, section, startDate, endDate
 */
router.get('/', authenticate, checkPermission('front-office', 'view'), async (req, res) => {
  try {
    const { status, studentId, class: className, section, startDate, endDate } = req.query;

    // Build query
    const query = {};

    // Status filter
    if (status === 'active') {
      query.status = 'ACTIVE';
      query.approvalStatus = 'APPROVED';
    } else if (status === 'pending') {
      query.approvalStatus = 'PENDING';
    } else if (status === 'approved') {
      query.approvalStatus = 'APPROVED';
    } else if (status === 'rejected') {
      query.approvalStatus = 'REJECTED';
    } else if (status === 'used') {
      query.status = 'USED';
    } else if (status === 'cancelled') {
      query.approvalStatus = 'CANCELLED';
    }

    // Student filter
    if (studentId) {
      query.studentId = studentId;
    }

    // Class filter
    if (className) {
      query.class = className;
    }

    // Section filter
    if (section) {
      query.section = section;
    }

    // Date range filter
    if (startDate || endDate) {
      query.leavingDate = {};
      if (startDate) {
        query.leavingDate.$gte = new Date(startDate);
      }
      if (endDate) {
        const endDateTime = new Date(endDate);
        endDateTime.setHours(23, 59, 59, 999);
        query.leavingDate.$lte = endDateTime;
      }
    }

    // Today's gate passes
    if (status === 'today') {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);
      query.leavingDate = { $gte: startOfDay, $lte: endOfDay };
    }

    // Execute query
    const schoolId = await resolveRequestSchoolId(req);
    const gatePasses = await GatePass.find(scopeBySchool(schoolId, query))
      .sort({ leavingDate: 1, leavingTime: 1 })
      .populate('studentId', 'name admissionId photo rollNo')
      .populate('approvedByStaffId', 'name code')
      .populate('requestedById', 'name code');

    res.json({
      success: true,
      data: gatePasses,
      count: gatePasses.length,
    });
  } catch (error) {
    console.error('❌ Get gate passes error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to fetch gate passes',
    });
  }
});

/**
 * GET /api/gate-passes/active
 * Get all active gate passes
 */
router.get('/active', authenticate, checkPermission('front-office', 'view'), async (req, res) => {
  try {
    const schoolId = await resolveRequestSchoolId(req);
    const gatePasses = await GatePass.find(
      scopeBySchool(schoolId, { status: 'ACTIVE', approvalStatus: 'APPROVED' })
    )
      .sort({ leavingDate: 1, leavingTime: 1 })
      .populate('studentId', 'name admissionId photo rollNo')
      .populate('approvedByStaffId', 'name code')
      .populate('requestedById', 'name code');
    res.json({
      success: true,
      data: gatePasses,
      count: gatePasses.length,
    });
  } catch (error) {
    console.error('❌ Get active gate passes error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to fetch active gate passes',
    });
  }
});

/**
 * GET /api/gate-passes/today
 * Get today's gate passes
 */
router.get('/today', authenticate, checkPermission('front-office', 'view'), async (req, res) => {
  try {
    const schoolId = await resolveRequestSchoolId(req);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    const gatePasses = await GatePass.find(
      scopeBySchool(schoolId, {
        leavingDate: { $gte: startOfDay, $lte: endOfDay },
      })
    )
      .sort({ leavingDate: 1, leavingTime: 1 })
      .populate('studentId', 'name admissionId photo rollNo')
      .populate('approvedByStaffId', 'name code')
      .populate('requestedById', 'name code');
    res.json({
      success: true,
      data: gatePasses,
      count: gatePasses.length,
    });
  } catch (error) {
    console.error("❌ Get today's gate passes error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: "Failed to fetch today's gate passes",
    });
  }
});

/**
 * GET /api/gate-passes/student/:id
 * Get gate passes by student ID
 */
router.get(
  '/student/:id',
  authenticate,
  checkPermission('front-office', 'view'),
  async (req, res) => {
    try {
      const schoolId = await resolveRequestSchoolId(req);
      const gatePasses = await GatePass.find(scopeBySchool(schoolId, { studentId: req.params.id }))
        .sort({ createdAt: -1 })
        .populate('approvedByStaffId', 'name code')
        .populate('requestedById', 'name code');
      res.json({
        success: true,
        data: gatePasses,
        count: gatePasses.length,
      });
    } catch (error) {
      console.error('❌ Get student gate passes error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: 'Failed to fetch student gate passes',
      });
    }
  }
);

/**
 * GET /api/gate-passes/pending
 * Get gate passes pending approval
 */
router.get('/pending', authenticate, checkPermission('front-office', 'view'), async (req, res) => {
  try {
    const schoolId = await resolveRequestSchoolId(req);
    const gatePasses = await GatePass.find(scopeBySchool(schoolId, { approvalStatus: 'PENDING' }))
      .sort({ leavingDate: 1, leavingTime: 1 })
      .populate('studentId', 'name admissionId photo classId')
      .populate('requestedById', 'name code');
    res.json({
      success: true,
      data: gatePasses,
      count: gatePasses.length,
    });
  } catch (error) {
    console.error('❌ Get pending approvals error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to fetch pending approvals',
    });
  }
});

/**
 * GET /api/gate-passes/:id
 * Get single gate pass by ID
 */
router.get('/:id', authenticate, checkPermission('front-office', 'view'), async (req, res) => {
  try {
    const schoolId = await resolveRequestSchoolId(req);
    const gatePass = await GatePass.findOne(scopeBySchool(schoolId, { _id: req.params.id }))
      .populate('studentId', 'name admissionId photo rollNo classId')
      .populate('approvedByStaffId', 'name code phone')
      .populate('requestedById', 'name code phone');

    if (!gatePass) {
      return res.status(404).json({
        success: false,
        error: 'Gate pass not found',
      });
    }

    res.json({
      success: true,
      data: gatePass,
    });
  } catch (error) {
    console.error('❌ Get gate pass error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to fetch gate pass',
    });
  }
});

/**
 * POST /api/gate-passes
 * Create new gate pass
 */
router.post('/', authenticate, checkPermission('front-office', 'create'), async (req, res) => {
  try {
    const {
      studentId,
      reason,
      otherReason,
      leavingDate,
      leavingTime,
      expectedReturnDate,
      expectedReturnTime,
      leavingWith,
      // For Parents
      parentType,
      // For Others
      escortName,
      escortRelation,
      escortPhone,
      escortIdProof,
      // Approval
      approvedBy,
      notes,
    } = req.body;

    // Validation
    if (!studentId || !reason || !leavingDate || !leavingTime || !leavingWith || !approvedBy) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'Student, reason, leaving date/time, leaving with, and approver are required',
      });
    }

    // Get student details
    const student = await Student.findById(studentId).populate('classId');
    if (!student) {
      return res.status(404).json({
        success: false,
        error: req.t('students:errors.notFound'),
      });
    }

    // Get requesting staff details
    const requestingStaff = await Staff.findById(req.user.id);
    if (!requestingStaff) {
      return res.status(404).json({
        success: false,
        error: 'Requesting staff not found',
      });
    }

    // Prepare gate pass data
    const gatePassData = {
      studentId,
      studentName: student.name,
      class: student.classId?.name || '',
      section: student.classId?.section || '',
      reason,
      leavingDate: new Date(leavingDate),
      leavingTime,
      leavingWith,
      requestedById: req.user.id,
      requestedByName: requestingStaff.name,
      notes,
    };

    // Add optional fields
    if (reason === 'OTHER' && otherReason) {
      gatePassData.otherReason = otherReason;
    }

    if (expectedReturnDate) {
      gatePassData.expectedReturnDate = new Date(expectedReturnDate);
    }
    if (expectedReturnTime) {
      gatePassData.expectedReturnTime = expectedReturnTime;
    }

    // Add escort information
    if (leavingWith === 'PARENTS') {
      if (!parentType) {
        return res.status(400).json({
          success: false,
          error: 'Parent type is required when leaving with parents',
        });
      }
      gatePassData.parentType = parentType;
    } else if (leavingWith === 'OTHERS') {
      if (!escortName || !escortRelation || !escortPhone) {
        return res.status(400).json({
          success: false,
          error: 'Escort name, relation, and phone are required when leaving with others',
        });
      }
      gatePassData.escortName = escortName;
      gatePassData.escortRelation = escortRelation;
      gatePassData.escortPhone = escortPhone;
      gatePassData.escortIdProof = escortIdProof || '';
    }

    // Set approval
    gatePassData.approvedBy = approvedBy;

    // Determine approver staff ID based on approval type
    let approverStaffId = req.user.id; // Default to requester

    if (approvedBy === 'CLASS_TEACHER') {
      // Get class teacher
      const classData = await require('../database.js')
        .Class.findById(student.classId?._id)
        .populate('classTeacherId');
      if (classData?.classTeacherId) {
        approverStaffId = classData.classTeacherId._id;
      }
    } else if (approvedBy === 'PRINCIPAL') {
      // Find principal/admin
      const principal = await Staff.findOne({
        $or: [{ role: /admin/i }, { role: /principal/i }],
      });
      if (principal) {
        approverStaffId = principal._id;
      }
    }

    gatePassData.approvedByStaffId = approverStaffId;
    gatePassData.approvedByName = requestingStaff.name;
    gatePassData.schoolId = await resolveRequestSchoolId(req);

    // Create gate pass
    const gatePass = await GatePass.create(gatePassData);

    // If approver is the requester, auto-approve
    if (approverStaffId.toString() === req.user.id.toString()) {
      await gatePass.approve(requestingStaff);
    }

    // Populate for response
    await gatePass.populate('studentId', 'name admissionId photo rollNo');
    await gatePass.populate('approvedByStaffId', 'name code');
    await gatePass.populate('requestedById', 'name code');

    // TODO: Send notifications to approver, front office, security

    res.status(201).json({
      success: true,
      data: gatePass,
      message:
        approverStaffId.toString() === req.user.id.toString()
          ? 'Gate pass created and auto-approved'
          : 'Gate pass created successfully. Pending approval.',
    });
  } catch (error) {
    console.error('❌ Create gate pass error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to create gate pass',
    });
  }
});

/**
 * PUT /api/gate-passes/:id
 * Update gate pass (only if not used)
 */
router.put('/:id', authenticate, checkPermission('front-office', 'edit'), async (req, res) => {
  try {
    const schoolId = await resolveRequestSchoolId(req);
    const gatePass = await GatePass.findOne(scopeBySchool(schoolId, { _id: req.params.id }));

    if (!gatePass) {
      return res.status(404).json({
        success: false,
        error: 'Gate pass not found',
      });
    }

    // Don't allow updating used gate passes
    if (gatePass.status === 'USED') {
      return res.status(400).json({
        success: false,
        error: 'Cannot update used gate pass',
      });
    }

    // Don't allow updating rejected/cancelled passes
    if (gatePass.approvalStatus === 'REJECTED' || gatePass.approvalStatus === 'CANCELLED') {
      return res.status(400).json({
        success: false,
        error: 'Cannot update rejected or cancelled gate pass',
      });
    }

    // Block arbitrary status/approvalStatus changes through the update route.
    // Status transitions must use dedicated endpoints (approve, reject, use, cancel).
    if (req.body.status && req.body.status !== gatePass.status) {
      const ALLOWED_STATUS_TRANSITIONS = {
        ACTIVE: ['CANCELLED'], // Can only cancel an active pass via update
      };
      const allowed = ALLOWED_STATUS_TRANSITIONS[gatePass.status] || [];
      if (!allowed.includes(req.body.status)) {
        return res.status(400).json({
          success: false,
          error: `Cannot transition status from ${gatePass.status} to ${req.body.status}. Use dedicated endpoints for approve/reject/use.`,
        });
      }
    }

    // Prevent setting approvalStatus directly — must use /approve or /reject endpoints
    if (req.body.approvalStatus && req.body.approvalStatus !== gatePass.approvalStatus) {
      return res.status(400).json({
        success: false,
        error: 'Cannot change approvalStatus directly. Use the approve or reject endpoints.',
      });
    }

    const {
      reason,
      otherReason,
      leavingDate,
      leavingTime,
      expectedReturnDate,
      expectedReturnTime,
      leavingWith,
      parentType,
      escortName,
      escortRelation,
      escortPhone,
      escortIdProof,
      approvedBy,
      notes,
    } = req.body;

    // Update allowed fields
    if (reason) gatePass.reason = reason;
    if (otherReason !== undefined) gatePass.otherReason = otherReason;
    if (leavingDate) gatePass.leavingDate = new Date(leavingDate);
    if (leavingTime) gatePass.leavingTime = leavingTime;
    if (expectedReturnDate !== undefined) {
      gatePass.expectedReturnDate = expectedReturnDate ? new Date(expectedReturnDate) : null;
    }
    if (expectedReturnTime !== undefined) gatePass.expectedReturnTime = expectedReturnTime;
    if (leavingWith) gatePass.leavingWith = leavingWith;
    if (parentType !== undefined) gatePass.parentType = parentType;
    if (escortName !== undefined) gatePass.escortName = escortName;
    if (escortRelation !== undefined) gatePass.escortRelation = escortRelation;
    if (escortPhone !== undefined) gatePass.escortPhone = escortPhone;
    if (escortIdProof !== undefined) gatePass.escortIdProof = escortIdProof;
    if (approvedBy) gatePass.approvedBy = approvedBy;
    if (notes !== undefined) gatePass.notes = notes;

    // Reset to pending if updating approved pass
    if (gatePass.approvalStatus === 'APPROVED') {
      gatePass.approvalStatus = 'PENDING';
    }

    await gatePass.save();

    // Populate for response
    await gatePass.populate('studentId', 'name admissionId photo rollNo');
    await gatePass.populate('approvedByStaffId', 'name code');
    await gatePass.populate('requestedById', 'name code');

    res.json({
      success: true,
      data: gatePass,
      message: 'Gate pass updated successfully',
    });
  } catch (error) {
    console.error('❌ Update gate pass error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to update gate pass',
    });
  }
});

/**
 * POST /api/gate-passes/:id/approve
 * Approve gate pass
 */
router.post(
  '/:id/approve',
  authenticate,
  checkPermission('front-office', 'approve'),
  async (req, res) => {
    try {
      const schoolId = await resolveRequestSchoolId(req);
      const gatePass = await GatePass.findOne(scopeBySchool(schoolId, { _id: req.params.id }));

      if (!gatePass) {
        return res.status(404).json({
          success: false,
          error: 'Gate pass not found',
        });
      }

      // Check if already processed
      if (gatePass.approvalStatus !== 'PENDING') {
        return res.status(400).json({
          success: false,
          error: `Gate pass already ${gatePass.approvalStatus.toLowerCase()}`,
        });
      }

      const staff = await Staff.findById(req.user.id);
      if (!staff) {
        return res.status(404).json({
          success: false,
          error: req.t('common:errors.staffNotFound'),
        });
      }

      await gatePass.approve(staff);

      // TODO: Send notifications to front office, security, parents

      // Populate for response
      await gatePass.populate('studentId', 'name admissionId photo rollNo');
      await gatePass.populate('approvedByStaffId', 'name code');
      await gatePass.populate('requestedById', 'name code');

      res.json({
        success: true,
        data: gatePass,
        message: 'Gate pass approved successfully',
      });
    } catch (error) {
      console.error('❌ Approve gate pass error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: 'Failed to approve gate pass',
      });
    }
  }
);

/**
 * POST /api/gate-passes/:id/reject
 * Reject gate pass
 */
router.post(
  '/:id/reject',
  authenticate,
  checkPermission('front-office', 'approve'),
  async (req, res) => {
    try {
      const schoolId = await resolveRequestSchoolId(req);
      const gatePass = await GatePass.findOne(scopeBySchool(schoolId, { _id: req.params.id }));

      if (!gatePass) {
        return res.status(404).json({
          success: false,
          error: 'Gate pass not found',
        });
      }

      // Check if already processed
      if (gatePass.approvalStatus !== 'PENDING') {
        return res.status(400).json({
          success: false,
          error: `Gate pass already ${gatePass.approvalStatus.toLowerCase()}`,
        });
      }

      const { reason } = req.body;

      if (!reason) {
        return res.status(400).json({
          success: false,
          error: 'Rejection reason is required',
        });
      }

      await gatePass.reject(reason);

      // TODO: Notify requester

      // Populate for response
      await gatePass.populate('studentId', 'name admissionId photo rollNo');
      await gatePass.populate('requestedById', 'name code');

      res.json({
        success: true,
        data: gatePass,
        message: 'Gate pass rejected successfully',
      });
    } catch (error) {
      console.error('❌ Reject gate pass error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: 'Failed to reject gate pass',
      });
    }
  }
);

/**
 * POST /api/gate-passes/:id/mark-used
 * Mark gate pass as used (by security guard)
 */
router.post(
  '/:id/mark-used',
  authenticate,
  checkPermission('front-office', 'edit'),
  async (req, res) => {
    try {
      const schoolId = await resolveRequestSchoolId(req);
      const gatePass = await GatePass.findOne(scopeBySchool(schoolId, { _id: req.params.id }));

      if (!gatePass) {
        return res.status(404).json({
          success: false,
          error: 'Gate pass not found',
        });
      }

      // Check if approved
      if (gatePass.approvalStatus !== 'APPROVED') {
        return res.status(400).json({
          success: false,
          error: 'Gate pass is not approved',
        });
      }

      // Check if already used
      if (gatePass.status === 'USED') {
        return res.status(400).json({
          success: false,
          error: 'Gate pass already used',
        });
      }

      const { whoCollected, signatureUrl } = req.body;

      if (!whoCollected) {
        return res.status(400).json({
          success: false,
          error: 'Who collected is required',
        });
      }

      await gatePass.markAsUsed(whoCollected, signatureUrl);

      // TODO: Notify parents and class teacher

      // Populate for response
      await gatePass.populate('studentId', 'name admissionId photo rollNo');
      await gatePass.populate('requestedById', 'name code');

      res.json({
        success: true,
        data: gatePass,
        message: 'Gate pass marked as used successfully',
      });
    } catch (error) {
      console.error('❌ Mark gate pass as used error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: 'Failed to mark gate pass as used',
      });
    }
  }
);

/**
 * POST /api/gate-passes/:id/cancel
 * Cancel gate pass
 */
router.post(
  '/:id/cancel',
  authenticate,
  checkPermission('front-office', 'edit'),
  async (req, res) => {
    try {
      const schoolId = await resolveRequestSchoolId(req);
      const gatePass = await GatePass.findOne(scopeBySchool(schoolId, { _id: req.params.id }));

      if (!gatePass) {
        return res.status(404).json({
          success: false,
          error: 'Gate pass not found',
        });
      }

      // Check if already used
      if (gatePass.status === 'USED') {
        return res.status(400).json({
          success: false,
          error: 'Cannot cancel used gate pass',
        });
      }

      const { reason } = req.body;

      if (!reason) {
        return res.status(400).json({
          success: false,
          error: 'Cancellation reason is required',
        });
      }

      await gatePass.cancel(reason);

      // TODO: Notify relevant parties

      // Populate for response
      await gatePass.populate('studentId', 'name admissionId photo rollNo');
      await gatePass.populate('requestedById', 'name code');

      res.json({
        success: true,
        data: gatePass,
        message: 'Gate pass cancelled successfully',
      });
    } catch (error) {
      console.error('❌ Cancel gate pass error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: 'Failed to cancel gate pass',
      });
    }
  }
);

/**
 * DELETE /api/gate-passes/:id
 * Delete gate pass (only if not used)
 */
router.delete('/:id', authenticate, checkPermission('front-office', 'delete'), async (req, res) => {
  try {
    const schoolId = await resolveRequestSchoolId(req);
    const gatePass = await GatePass.findOne(scopeBySchool(schoolId, { _id: req.params.id }));

    if (!gatePass) {
      return res.status(404).json({
        success: false,
        error: 'Gate pass not found',
      });
    }

    // Don't allow deleting used gate passes
    if (gatePass.status === 'USED') {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete used gate pass',
      });
    }

    await GatePass.deleteOne(scopeBySchool(schoolId, { _id: req.params.id }));

    res.json({
      success: true,
      message: 'Gate pass deleted successfully',
    });
  } catch (error) {
    console.error('❌ Delete gate pass error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to delete gate pass',
    });
  }
});

/**
 * GET /api/gate-passes/:id/download
 * Download gate pass PDF
 * TODO: Implement PDF generation
 */
router.get(
  '/:id/download',
  authenticate,
  checkPermission('front-office', 'view'),
  async (req, res) => {
    try {
      const schoolId = await resolveRequestSchoolId(req);
      const gatePass = await GatePass.findOne(
        scopeBySchool(schoolId, { _id: req.params.id })
      ).populate('studentId', 'name admissionId photo rollNo');

      if (!gatePass) {
        return res.status(404).json({
          success: false,
          error: 'Gate pass not found',
        });
      }

      // TODO: Generate PDF
      res.json({
        success: true,
        data: {
          gatePass: gatePass,
          message: 'PDF generation to be implemented',
        },
      });
    } catch (error) {
      console.error('❌ Download gate pass error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: 'Failed to download gate pass',
      });
    }
  }
);

export default router;
