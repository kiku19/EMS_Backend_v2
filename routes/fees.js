import { resolveAcademicYear } from '../utils/academicYear.js';
import express from 'express';
import { Student, FeePayment, FeeRefund } from '../database.js';
import { getNextRefundNumber } from '../database.js';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { emitFeePaymentCreated } from '../utils/socketEmitter.js';
import { extractSchoolId, ensureDefaultSchool } from '../utils/schoolContext.js';
import { createLogger } from '../utils/logger.js';

const router = express.Router();
const logger = createLogger('Fees');

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

// Get all payments with optional filters
router.get('/payments', authenticate, checkPermission('fees', 'view'), async (req, res) => {
  try {
    const { studentId, academicYear, status, startDate, endDate } = req.query;

    const filter = scopeBySchool(req.user?.schoolId, {});
    if (studentId) filter.studentId = studentId;
    if (academicYear) filter.academicYear = academicYear;
    if (status) filter.status = status;
    if (startDate || endDate) {
      filter.paymentDate = {};
      if (startDate) filter.paymentDate.$gte = new Date(startDate);
      if (endDate) filter.paymentDate.$lte = new Date(endDate);
    }

    const payments = await FeePayment.find(filter)
      .populate('studentId', 'name admissionId class')
      .sort({ paymentDate: -1 });

    res.json(payments);
  } catch (error) {
    logger.error({ err: error }, 'Error fetching payments');
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

// Create a new payment
router.post('/payments', authenticate, checkPermission('fees', 'create'), async (req, res) => {
  try {
    const { studentId, studentName, classId, academicYear, receiptNumber, paymentDate, amount, paymentMode, feeHeads, remarks } = req.body;

    // Validate and resolve academic year — fail fast if it cannot be resolved
    const resolvedAcademicYear = await resolveAcademicYear(academicYear);
    if (!resolvedAcademicYear) {
      return res.status(400).json({ error: 'Could not resolve academic year. Please provide a valid year.' });
    }

    const schoolId = await resolveRequestSchoolId(req);

    // Generate receipt number if not provided
    const receipt = receiptNumber || `RCP-${Date.now()}`;

    // Create payment with explicit fields
    const payment = new FeePayment({
      studentId,
      classId,
      academicYear: resolvedAcademicYear,
      receiptNumber: receipt,
      paymentDate: paymentDate || new Date().toISOString().split('T')[0],
      amount,
      paymentMode: paymentMode || 'cash',
      feeHeads: feeHeads || [],
      remarks: remarks || '',
      status: 'completed',
      schoolId
    });

    await payment.save();

    // Update student's fee summary using atomic $inc to prevent race conditions
    if (studentId) {
      try {
        const student = await Student.findOne(scopeBySchool(req.user?.schoolId, { _id: studentId }));
        if (student) {
          // Use atomic $inc to avoid read-modify-write race condition
          const updatedStudent = await Student.findByIdAndUpdate(
            student._id,
            {
              $inc: { 'feeDetails.paidAmount': amount },
              $set: { 'feeDetails.lastPaymentDate': payment.paymentDate },
            },
            { new: true }
          );

          if (updatedStudent) {
            const totalFee = updatedStudent.feeDetails?.totalFee || 0;
            const discountApplied = updatedStudent.feeDetails?.discountApplied || 0;
            const paidAmount = updatedStudent.feeDetails?.paidAmount || 0;
            const balanceAmount = Math.max(totalFee - paidAmount - discountApplied, 0);

            // Issue #40 fix: merge both $set objects into a single key to avoid duplicate key overwrite
            const setFields = { 'feeDetails.balanceAmount': balanceAmount };
            if (totalFee > 0) {
              setFields.feeStatus = balanceAmount <= 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'pending';
            }

            await Student.findByIdAndUpdate(student._id, { $set: setFields });
          }

          // Issue #36 fix: update StudentFeeStructure (source of truth for fee tracking)
          try {
            const sfs = await StudentFeeStructure.findOne(
              scopeBySchool(req.user?.schoolId, {
                studentId: student._id,
                academicYear: resolvedAcademicYear,
              })
            );

            if (sfs) {
              sfs.totalPaid = (sfs.totalPaid || 0) + amount;
              sfs.totalBalance = Math.max((sfs.totalFee || 0) - sfs.totalPaid - (sfs.discountApplied || 0), 0);
              sfs.overallStatus = sfs.totalBalance <= 0 ? 'paid' : sfs.totalPaid > 0 ? 'partial' : 'pending';
              sfs.lastPaymentDate = payment.paymentDate;

              // Distribute payment across fee heads if feeHeads info is provided
              if (Array.isArray(feeHeads) && feeHeads.length > 0 && Array.isArray(sfs.feeHeads)) {
                for (const paymentHead of feeHeads) {
                  const matchingHead = sfs.feeHeads.find(h => h.name === paymentHead.name);
                  if (matchingHead) {
                    matchingHead.paidAmount = (matchingHead.paidAmount || 0) + (paymentHead.amount || 0);
                    matchingHead.balanceAmount = Math.max((matchingHead.amount || 0) - matchingHead.paidAmount, 0);
                    matchingHead.status = matchingHead.balanceAmount <= 0 ? 'paid' : matchingHead.paidAmount > 0 ? 'partial' : 'pending';
                  }
                }
              }

              await sfs.save();
            }
          } catch (sfsError) {
            logger.warn({ err: sfsError, studentId }, 'Could not update StudentFeeStructure after payment');
          }
        }
      } catch (studentUpdateError) {
        // Non-critical — log but don't fail the payment
        logger.warn({ err: studentUpdateError, studentId }, 'Could not update student fee summary after payment');
      }
    }

    // Emit real-time socket event for payment creation
    emitFeePaymentCreated(studentId, studentName || '', payment);

    res.status(201).json(payment);
  } catch (error) {
    logger.error({ err: error }, 'Error creating payment');
    res.status(500).json({ error: 'Failed to create payment' });
  }
});

// Get payment by ID
router.get('/payments/:id', authenticate, checkPermission('fees', 'view'), async (req, res) => {
  try {
    const payment = await FeePayment.findOne(scopeBySchool(req.user?.schoolId, { _id: req.params.id }))
      .populate('studentId', 'name admissionId class');

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    res.json(payment);
  } catch (error) {
    logger.error({ err: error }, 'Error fetching payment');
    res.status(500).json({ error: 'Failed to fetch payment' });
  }
});

// ── Refunds ──────────────────────────────────────────────────────────────────

// Get all refunds
router.get('/refunds', authenticate, checkPermission('fees', 'view'), async (req, res) => {
  try {
    const { studentId, status, academicYear } = req.query;
    const filter = scopeBySchool(req.user?.schoolId, {});
    if (studentId) filter.studentId = studentId;
    if (status) filter.status = status;
    if (academicYear) filter.academicYear = academicYear;

    const refunds = await FeeRefund.find(filter)
      .populate('studentId', 'name admissionId')
      .populate('classId', 'name section')
      .sort({ createdAt: -1 });

    res.json(refunds);
  } catch (error) {
    logger.error({ err: error }, 'Error fetching refunds');
    res.status(500).json({ error: 'Failed to fetch refunds' });
  }
});

// Get refund by ID
router.get('/refunds/:id', authenticate, checkPermission('fees', 'view'), async (req, res) => {
  try {
    const refund = await FeeRefund.findOne(scopeBySchool(req.user?.schoolId, { _id: req.params.id }))
      .populate('studentId', 'name admissionId')
      .populate('classId', 'name section');

    if (!refund) return res.status(404).json({ error: 'Refund not found' });
    res.json(refund);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch refund' });
  }
});

// Create refund request
router.post('/refunds', authenticate, checkPermission('fees', 'create'), async (req, res) => {
  try {
    const { studentId, classId, amount, reason, refundMode, originalPaymentId, remarks } = req.body;
    const schoolId = await resolveRequestSchoolId(req);

    if (!studentId || !classId || !amount || !reason || !refundMode) {
      return res.status(400).json({ error: 'studentId, classId, amount, reason, and refundMode are required' });
    }

    const refundNumber = await getNextRefundNumber();
    const refund = new FeeRefund({
      studentId,
      classId,
      amount,
      reason,
      refundMode,
      originalPaymentId: originalPaymentId || undefined,
      remarks: remarks || '',
      refundDate: new Date().toISOString().split('T')[0],
      refundNumber,
      requestedBy: req.user?._id,
      status: 'pending',
      schoolId
    });

    await refund.save();
    const populated = await FeeRefund.findById(refund._id)
      .populate('studentId', 'name admissionId')
      .populate('classId', 'name section');

    res.status(201).json(populated);
  } catch (error) {
    logger.error({ err: error }, 'Error creating refund');
    res.status(500).json({ error: error.message || 'Failed to create refund' });
  }
});

// Approve refund
router.put('/refunds/:id/approve', authenticate, checkPermission('fees', 'edit'), async (req, res) => {
  try {
    const refund = await FeeRefund.findOne(scopeBySchool(req.user?.schoolId, { _id: req.params.id }));
    if (!refund) return res.status(404).json({ error: 'Refund not found' });
    if (refund.status !== 'pending') return res.status(400).json({ error: 'Only pending refunds can be approved' });

    refund.status = 'approved';
    refund.approvedBy = req.user?._id;
    refund.approvedAt = new Date();
    if (req.body.remarks) refund.remarks = req.body.remarks;
    await refund.save();

    res.json(refund);
  } catch (error) {
    res.status(500).json({ error: 'Failed to approve refund' });
  }
});

// Process refund
router.put('/refunds/:id/process', authenticate, checkPermission('fees', 'edit'), async (req, res) => {
  try {
    const refund = await FeeRefund.findOne(scopeBySchool(req.user?.schoolId, { _id: req.params.id }));
    if (!refund) return res.status(404).json({ error: 'Refund not found' });
    if (refund.status !== 'approved') return res.status(400).json({ error: 'Only approved refunds can be processed' });

    refund.status = 'processed';
    refund.processedBy = req.user?._id;
    refund.processedAt = new Date();
    if (req.body.transactionId) refund.transactionId = req.body.transactionId;
    if (req.body.remarks) refund.remarks = req.body.remarks;
    await refund.save();

    res.json(refund);
  } catch (error) {
    res.status(500).json({ error: 'Failed to process refund' });
  }
});

// Reject refund
router.put('/refunds/:id/reject', authenticate, checkPermission('fees', 'edit'), async (req, res) => {
  try {
    const refund = await FeeRefund.findOne(scopeBySchool(req.user?.schoolId, { _id: req.params.id }));
    if (!refund) return res.status(404).json({ error: 'Refund not found' });
    if (refund.status === 'processed') return res.status(400).json({ error: 'Processed refunds cannot be rejected' });

    refund.status = 'rejected';
    refund.rejectionReason = req.body.rejectionReason || '';
    await refund.save();

    res.json(refund);
  } catch (error) {
    res.status(500).json({ error: 'Failed to reject refund' });
  }
});

export default router;



