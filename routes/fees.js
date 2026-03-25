/**
 * @swagger
 * tags:
 *   name: Fees
 *   description: Fee collection & receipts
 */

/**
 * @swagger
 * /fees:
 *   get:
 *     summary: List fee payments
 *     tags: [Fees]
 *     parameters:
 *       - $ref: '#/components/parameters/AcademicYearQuery'
 *       - $ref: '#/components/parameters/PageQuery'
 *       - $ref: '#/components/parameters/LimitQuery'
 *       - in: query
 *         name: studentId
 *         schema:
 *           $ref: '#/components/schemas/ObjectId'
 *       - in: query
 *         name: classId
 *         schema:
 *           $ref: '#/components/schemas/ObjectId'
 *       - in: query
 *         name: paymentMode
 *         schema:
 *           type: string
 *           enum: [cash, online, cheque, dd, upi]
 *     responses:
 *       200:
 *         description: Paginated fee payments list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 payments: { type: array, items: { type: object } }
 *                 total: { type: integer }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *   post:
 *     summary: Record a fee payment
 *     tags: [Fees]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/FeePaymentRequest'
 *     responses:
 *       201:
 *         description: Payment recorded and receipt generated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/FeeReceiptResponse'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Student not found
 */

/**
 * @swagger
 * /fees/{id}:
 *   get:
 *     summary: Get a fee payment by ID
 *     tags: [Fees]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: Fee payment record
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   delete:
 *     summary: Delete / cancel a fee payment
 *     tags: [Fees]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         $ref: '#/components/responses/NotFound'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @swagger
 * /fees/refunds:
 *   post:
 *     summary: Issue a fee refund
 *     tags: [Fees]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [paymentId, amount, reason]
 *             properties:
 *               paymentId: { $ref: '#/components/schemas/ObjectId' }
 *               amount:    { type: number, minimum: 0 }
 *               reason:    { type: string }
 *     responses:
 *       201:
 *         description: Refund issued
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

import mongoose from 'mongoose';
import { resolveAcademicYear } from '../utils/academicYear.js';
import express from 'express';
import {
  Student,
  Class,
  FeePayment,
  FeeRefund,
  getNextRefundNumber,
  getNextReceiptNumber,
} from '../database.js';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { emitFeePaymentCreated } from '../utils/socketEmitter.js';
import { extractSchoolId, ensureDefaultSchool } from '../utils/schoolContext.js';
import { createLogger } from '../utils/logger.js';
import {
  computeFeeBalance,
  computeFeeHeadStatus,
  syncStudentFeeDetails,
} from '../utils/feeCalculator.js';
import { validateZod, createFeePaymentSchema, createRefundSchema } from '../validators/index.js';
import { dispatchWebhookEvent } from '../services/webhookService.js';
import { getFeePaymentGateway } from '../services/paymentGateway/index.js';

const router = express.Router();
router.use(authenticate);
const logger = createLogger('Fees');

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

const ONLINE_PAYMENT_MODES = ['online', 'card', 'upi', 'bank_transfer'];

// Create a new payment
router.post(
  '/payments',
  authenticate,
  checkPermission('fees', 'create'),
  validateZod(createFeePaymentSchema),
  async (req, res) => {
    try {
      const {
        studentId,
        studentName,
        classId,
        academicYear,
        receiptNumber,
        paymentDate,
        amount,
        paymentMode,
        feeHeads,
        transactionId,
        chequeNumber,
        bankName,
        gatewayOrderId,
        gatewaySignature,
        remarks,
      } = req.body;

      // Validate and resolve academic year — fail fast if it cannot be resolved
      const resolvedAcademicYear = await resolveAcademicYear(academicYear, req.user?.schoolId);
      if (!resolvedAcademicYear) {
        return res
          .status(400)
          .json({ error: 'Could not resolve academic year. Please provide a valid year.' });
      }

      const schoolId = await resolveRequestSchoolId(req);

      // ── Payment gateway verification for online payments ──────────────────────
      let gatewayVerified = false;
      if (ONLINE_PAYMENT_MODES.includes(paymentMode)) {
        const gateway = getFeePaymentGateway();
        if (gateway.name !== 'manual' && gatewayOrderId && transactionId && gatewaySignature) {
          // Configured gateway (e.g. Razorpay): verify the signature
          const { valid } = await gateway.verifyPayment({
            orderId: gatewayOrderId,
            paymentId: transactionId,
            signature: gatewaySignature,
          });
          if (!valid) {
            return res.status(400).json({
              error: 'Payment gateway verification failed. Invalid signature.',
              code: 'INVALID_GATEWAY_SIGNATURE',
            });
          }
          gatewayVerified = true;
        } else if (gateway.name === 'manual') {
          // Manual/dev mode: accept without real gateway check
          gatewayVerified = true;
        }
        // If signature fields missing but gateway is configured — still allow recording
        // but leave gatewayVerified=false (admin recorded manually without signature)
      }
      // ─────────────────────────────────────────────────────────────────────────

      // Generate receipt number if not provided (atomic counter — prevents duplicates)
      const receipt = receiptNumber || (await getNextReceiptNumber(schoolId));

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
        transactionId: transactionId || undefined,
        chequeNumber: chequeNumber || undefined,
        bankName: bankName || undefined,
        gatewayOrderId: gatewayOrderId || undefined,
        gatewaySignature: gatewaySignature || undefined,
        gatewayVerified,
        remarks: remarks || '',
        status: 'completed',
        schoolId,
      });

      await payment.save();

      dispatchWebhookEvent(req.user?.schoolId, 'fee.paid', {
        id: payment._id,
        studentId,
        amount,
        paymentMode: payment.paymentMode,
        receiptNumber: payment.receiptNumber,
        academicYear: payment.academicYear,
      }).catch(() => {});

      // Update student's fee summary using atomic $inc to prevent race conditions
      if (studentId) {
        try {
          const student = await Student.findOne(
            scopeBySchool(req.user?.schoolId, { _id: studentId })
          );
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

              const setFields = { 'feeDetails.balanceAmount': balanceAmount };
              if (totalFee > 0) {
                const { overallStatus } = computeFeeBalance({
                  totalFee,
                  totalPaid: paidAmount,
                  discountApplied,
                });
                setFields.feeStatus = overallStatus;
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
                sfs.lastPaymentDate = payment.paymentDate;

                // Distribute payment across fee heads if breakdown provided
                if (Array.isArray(feeHeads) && feeHeads.length > 0 && Array.isArray(sfs.feeHeads)) {
                  for (const paymentHead of feeHeads) {
                    const matchingHead = sfs.feeHeads.find(
                      (h) =>
                        (paymentHead.feeHeadId &&
                          h.feeHeadId?.toString() === paymentHead.feeHeadId.toString()) ||
                        (!paymentHead.feeHeadId && paymentHead.name && h.name === paymentHead.name)
                    );
                    if (matchingHead) {
                      matchingHead.paidAmount =
                        (matchingHead.paidAmount || 0) + (paymentHead.amount || 0);
                      const headResult = computeFeeHeadStatus(matchingHead);
                      matchingHead.balanceAmount = headResult.balanceAmount;
                      matchingHead.status = headResult.status;
                    }
                  }
                }

                const { totalBalance, overallStatus } = computeFeeBalance(sfs);
                sfs.totalBalance = totalBalance;
                sfs.overallStatus = overallStatus;

                await sfs.save();
              }
            } catch (sfsError) {
              logger.warn(
                { err: sfsError, studentId },
                'Could not update StudentFeeStructure after payment'
              );
            }
          }
        } catch (studentUpdateError) {
          // Non-critical — log but don't fail the payment
          logger.warn(
            { err: studentUpdateError, studentId },
            'Could not update student fee summary after payment'
          );
        }
      }

      // Emit real-time socket event for payment creation
      emitFeePaymentCreated(studentId, studentName || '', payment);

      // Notify parent(s) of payment confirmation
      if (studentId) {
        try {
          const { sendNotification } = await import('./notifications.js');
          const { Parent } = await import('../database.js');
          const parents = await Parent.find({ 'children.studentId': studentId }).select('_id');
          for (const parent of parents) {
            await sendNotification(
              parent._id,
              'Parent',
              'payment',
              'Fee Payment Confirmed',
              `A payment of ₹${amount} has been recorded for ${studentName || 'your child'}. Receipt: ${payment.receiptNumber}.`,
              {
                relatedId: payment._id,
                relatedType: 'FeePayment',
                priority: 'normal',
              }
            );
          }
        } catch (notifError) {
          logger.warn(
            { err: notifError, studentId },
            'Could not send fee payment notification to parent'
          );
        }
      }

      res.status(201).json(payment);
    } catch (error) {
      logger.error({ err: error }, 'Error creating payment');
      res.status(500).json({ error: 'Failed to create payment' });
    }
  }
);

// Get payment by ID
router.get('/payments/:id', authenticate, checkPermission('fees', 'view'), async (req, res) => {
  try {
    const payment = await FeePayment.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    ).populate('studentId', 'name admissionId class');

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
    const refund = await FeeRefund.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    )
      .populate('studentId', 'name admissionId')
      .populate('classId', 'name section');

    if (!refund) return res.status(404).json({ error: 'Refund not found' });
    res.json(refund);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch refund' });
  }
});

// Create refund request
router.post(
  '/refunds',
  authenticate,
  checkPermission('fees', 'create'),
  validateZod(createRefundSchema),
  async (req, res) => {
    try {
      const { studentId, classId, amount, reason, refundMode, originalPaymentId, remarks } =
        req.body;
      const schoolId = await resolveRequestSchoolId(req);

      // Validate referenced documents exist within the same school
      const [student, classDoc] = await Promise.all([
        Student.findOne(scopeBySchool(schoolId, { _id: studentId })),
        Class.findOne(scopeBySchool(schoolId, { _id: classId })),
      ]);
      if (!student) return res.status(400).json({ error: req.t('students:errors.notFound') });
      if (!classDoc) return res.status(400).json({ error: req.t('common:errors.classNotFound') });

      if (originalPaymentId) {
        const payment = await FeePayment.findOne(
          scopeBySchool(schoolId, { _id: originalPaymentId })
        );
        if (!payment) return res.status(400).json({ error: 'Original payment not found' });
      }

      // Validate refund amount does not exceed total paid minus already-refunded
      const [totalPaidResult, totalRefundedResult] = await Promise.all([
        FeePayment.aggregate([
          {
            $match: {
              schoolId: new mongoose.Types.ObjectId(schoolId),
              studentId: new mongoose.Types.ObjectId(studentId),
              status: 'completed',
            },
          },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
        FeeRefund.aggregate([
          {
            $match: {
              schoolId: new mongoose.Types.ObjectId(schoolId),
              studentId: new mongoose.Types.ObjectId(studentId),
              status: { $nin: ['rejected'] },
            },
          },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
      ]);
      const totalPaid = totalPaidResult[0]?.total || 0;
      const totalRefunded = totalRefundedResult[0]?.total || 0;
      const refundableBalance = totalPaid - totalRefunded;

      if (amount > refundableBalance) {
        return res.status(400).json({
          error: `Refund amount (₹${amount}) exceeds refundable balance (₹${refundableBalance}). Total paid: ₹${totalPaid}, already refunded: ₹${totalRefunded}.`,
        });
      }

      const refundNumber = await getNextRefundNumber(schoolId);
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
        schoolId,
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
  }
);

// Approve refund
router.put(
  '/refunds/:id/approve',
  authenticate,
  checkPermission('fees', 'edit'),
  async (req, res) => {
    try {
      const refund = await FeeRefund.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id })
      );
      if (!refund) return res.status(404).json({ error: 'Refund not found' });
      if (refund.status !== 'pending')
        return res.status(400).json({ error: 'Only pending refunds can be approved' });

      refund.status = 'approved';
      refund.approvedBy = req.user?._id;
      refund.approvedAt = new Date();
      if (req.body.remarks) refund.remarks = req.body.remarks;
      await refund.save();

      res.json(refund);
    } catch (error) {
      res.status(500).json({ error: 'Failed to approve refund' });
    }
  }
);

// Process refund
router.put(
  '/refunds/:id/process',
  authenticate,
  checkPermission('fees', 'edit'),
  async (req, res) => {
    try {
      const refund = await FeeRefund.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id })
      );
      if (!refund) return res.status(404).json({ error: 'Refund not found' });
      if (refund.status !== 'approved')
        return res.status(400).json({ error: 'Only approved refunds can be processed' });

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
  }
);

// Reject refund
router.put(
  '/refunds/:id/reject',
  authenticate,
  checkPermission('fees', 'edit'),
  async (req, res) => {
    try {
      const refund = await FeeRefund.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id })
      );
      if (!refund) return res.status(404).json({ error: 'Refund not found' });
      if (refund.status === 'processed')
        return res.status(400).json({ error: 'Processed refunds cannot be rejected' });

      refund.status = 'rejected';
      refund.rejectionReason = req.body.rejectionReason || '';
      await refund.save();

      res.json(refund);
    } catch (error) {
      res.status(500).json({ error: 'Failed to reject refund' });
    }
  }
);

export default router;
