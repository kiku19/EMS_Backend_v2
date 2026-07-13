import express from 'express';
import { resolveAcademicYear } from '../../utils/academicYear.js';
import { Student, FeePayment, getNextAvailableReceiptNumber } from '../../database.js';
import { getFeePaymentGateway } from '../../services/paymentGateway/index.js';
import { validateParentChildAccess } from '../../middleware/parentAuth.js';
import { validateZod, zodSchemas } from '../../middleware/validation.js';
import StudentFeeStructure from '../../models/StudentFeeStructure.js';
import { emitFeePaymentCreated } from '../../utils/socketEmitter.js';
import {
  computeFeeBalance,
  computeFeeHeadStatus,
  syncStudentFeeDetails,
} from '../../utils/feeCalculator.js';
import { applyOutputSchema, paymentOutputSchema } from '../../validators/parentOutputSchemas.js';
import { scopeBySchool, resolveRequestSchoolId } from './helpers.js';
import { createLogger } from '../../utils/logger.js';
import { updateFeeStructureWithRetry } from '../../utils/sfsConcurrency.js';

const router = express.Router();
const logger = createLogger('ParentFees');

// Normalize :id → req.params.studentId for validateParentChildAccess
router.param('id', (req, res, next, id) => {
  req.params.studentId = id;
  next();
});

// GET /api/parent/students/:id/fees
router.get('/students/:id/fees', validateParentChildAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const { academicYear } = req.query;

    const student = await Student.findOne({ _id: id, schoolId: req.schoolId })
      .select('name admissionId classId feeDetails feeStatus')
      .populate('classId', 'name section academicYear');

    if (!student) {
      return res.status(404).json({
        success: false,
        error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found' },
      });
    }

    const year = academicYear || student.classId?.academicYear || (await resolveAcademicYear());

    // Strict year-scoped lookup — no cross-year fallback to avoid showing stale data
    const feeStructure = await StudentFeeStructure.findOne({
      studentId: id,
      academicYear: year,
      schoolId: req.schoolId,
    }).lean();

    let feeDetails;
    let feeStatus;
    let feeHeads = [];

    if (feeStructure) {
      feeDetails = {
        totalFee: feeStructure.totalFee || 0,
        paidAmount: feeStructure.totalPaid || 0,
        balanceAmount: feeStructure.totalBalance || 0,
        discountApplied: feeStructure.discountApplied || 0,
        lastPaymentDate: feeStructure.lastPaymentDate || null,
      };
      feeStatus = feeStructure.overallStatus || student.feeStatus || 'pending';
      feeHeads = feeStructure.feeHeads || [];
    } else {
      feeDetails = student.feeDetails || {
        totalFee: 0,
        paidAmount: 0,
        balanceAmount: 0,
        discountApplied: 0,
        lastPaymentDate: null,
      };
      feeStatus = student.feeStatus || 'pending';
    }

    const { FeePayment: FeePaymentModel } = await import('../../database.js');

    const payments = await FeePaymentModel.find({ studentId: id, schoolId: req.schoolId })
      .sort({ paymentDate: -1 })
      .limit(10)
      .lean();

    res.json({
      success: true,
      data: {
        studentId: id,
        studentName: student.name,
        admissionId: student.admissionId,
        class: student.classId,
        academicYear: year,
        feeDetails,
        feeStatus,
        feeStructure: feeHeads.length > 0 ? { feeHeads } : null,
        _feeStructureFound: !!feeStructure,
        recentPayments: applyOutputSchema(paymentOutputSchema, payments),
      },
    });
  } catch (error) {
    logger.error('Get student fees error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to fetch fee details' },
    });
  }
});

// POST /api/parent/students/:id/payment/create-order
router.post(
  '/students/:id/payment/create-order',
  validateParentChildAccess,
  validateZod(zodSchemas.paymentCreateOrder),
  async (req, res) => {
    try {
      const { id: studentId } = req.params;
      const { amount, feeHeadPayments, academicYear } = req.body;

      // Verify amount doesn't exceed balance — strict year scope, no cross-year fallback
      const resolvedAcademicYear = await resolveAcademicYear(academicYear);
      const feeStructure = await StudentFeeStructure.findOne(
        scopeBySchool(req.parent?.schoolId, { studentId, academicYear: resolvedAcademicYear })
      );

      if (!feeStructure) {
        return res.status(404).json({
          success: false,
          error: { code: 'NO_FEE_STRUCTURE', message: 'No fee structure found for this student' },
        });
      }

      if (amount > feeStructure.totalBalance) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'AMOUNT_EXCEEDS_BALANCE',
            message: `Amount ₹${amount} exceeds pending balance ₹${feeStructure.totalBalance}`,
          },
        });
      }

      // Validate individual fee head payments if provided
      if (feeHeadPayments && feeHeadPayments.length > 0) {
        for (const fhp of feeHeadPayments) {
          const head = feeStructure.feeHeads.find(
            (h) => h.feeHeadId?.toString() === fhp.feeHeadId || h._id?.toString() === fhp.feeHeadId
          );
          if (head && fhp.amount > head.balanceAmount) {
            return res.status(400).json({
              success: false,
              error: {
                code: 'HEAD_AMOUNT_EXCEEDS',
                message: `Amount for "${head.name}" exceeds its pending balance`,
              },
            });
          }
        }
      }

      const student = await Student.findById(studentId)
        .select('name admissionId classId')
        .populate('classId', 'name');

      const gateway = getFeePaymentGateway();
      const notes = {
        studentId,
        studentName: student?.name || '',
        className: student?.classId?.name || '',
        admissionId: student?.admissionId || '',
        academicYear: feeStructure.academicYear,
        parentId: req.parent._id.toString(),
      };

      const order = await gateway.createOrder({
        amount,
        currency: 'INR',
        receipt: `fee_${studentId}_${Date.now()}`,
        notes,
      });

      res.json({
        success: true,
        data: {
          orderId: order.orderId,
          amount: order.amount,
          amountInPaise: order.amountInPaise,
          currency: order.currency,
          studentName: student?.name || '',
          keyId: order.keyId,
          notes: order.notes,
          mock: order.mock || false,
          gateway: gateway.name,
        },
      });
    } catch (error) {
      logger.error('Create payment order error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'ORDER_CREATION_FAILED', message: 'Failed to create payment order' },
      });
    }
  }
);

// POST /api/parent/students/:id/payment/verify
router.post(
  '/students/:id/payment/verify',
  validateParentChildAccess,
  validateZod(zodSchemas.paymentVerify),
  async (req, res) => {
    try {
      const { id: studentId } = req.params;
      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        amount,
        feeHeadPayments,
        academicYear,
        mock,
      } = req.body;

      // Verify payment signature via the configured gateway (skipped for mock payments)
      if (!mock) {
        const gateway = getFeePaymentGateway();
        const { valid } = await gateway.verifyPayment({
          orderId: razorpay_order_id,
          paymentId: razorpay_payment_id,
          signature: razorpay_signature,
        });

        if (!valid) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'INVALID_SIGNATURE',
              message: 'Payment verification failed. Invalid signature.',
            },
          });
        }
      }

      const student = await Student.findById(studentId)
        .select('name admissionId classId feeDetails')
        .populate('classId', 'name academicYear');

      if (!student) {
        return res.status(404).json({
          success: false,
          error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found' },
        });
      }

      const year = academicYear || student.classId?.academicYear || (await resolveAcademicYear());

      // Build fee heads breakdown for payment record.
      // F5: keep feeHeadId so the persisted record can be reversed by id
      // (routes/fees.js cancel path matches feeHeadId first, then name).
      // Previously the mapping kept only {name, amount}, so a cancellation
      // fell back to fragile name matching that almost never hit.
      let paymentFeeHeads = [];
      if (feeHeadPayments && feeHeadPayments.length > 0) {
        paymentFeeHeads = feeHeadPayments.map((fhp) => ({
          feeHeadId: fhp.feeHeadId,
          name: fhp.name || fhp.feeHeadName || '',
          amount: fhp.amount,
        }));
      }

      // Create FeePayment record (atomic counter — prevents duplicate receipt numbers)
      const schoolId = await resolveRequestSchoolId(req);
      const receiptNumber = await getNextAvailableReceiptNumber(schoolId);
      const payment = new FeePayment({
        schoolId,
        studentId,
        classId: student.classId?._id || student.classId,
        academicYear: year,
        receiptNumber,
        paymentDate: new Date().toISOString().split('T')[0],
        amount,
        paymentMode: 'online',
        feeHeads: paymentFeeHeads,
        transactionId: razorpay_payment_id || `mock_${Date.now()}`,
        status: 'completed',
        remarks: `Online payment via parent app. Order: ${razorpay_order_id || 'N/A'}`,
        // F4: persist the gateway reconciliation fields. The signature was
        // verified above (verifyPayment → valid), but the result was never
        // stored, so gatewayVerified stayed false despite a valid payment.
        // (gatewayPaymentId is intentionally omitted — the model has no such
        // field; the payment id is already stored as transactionId above.)
        gatewayOrderId: razorpay_order_id,
        gatewaySignature: razorpay_signature,
        gatewayVerified: !mock,
      });

      await payment.save();

      // Update StudentFeeStructure — strict year scope, no cross-year fallback.
      // Uses the retry helper so concurrent parent/admin payments don't lose
      // each other's feeHead updates.
      const feeStructure = await updateFeeStructureWithRetry(
        scopeBySchool(req.parent?.schoolId, { studentId, academicYear: year }),
        async (fs) => {
          if (feeHeadPayments && feeHeadPayments.length > 0) {
            for (const fhp of feeHeadPayments) {
              const head = fs.feeHeads.find(
                (h) =>
                  h.feeHeadId?.toString() === fhp.feeHeadId || h._id?.toString() === fhp.feeHeadId
              );
              if (head) {
                head.paidAmount = (head.paidAmount || 0) + fhp.amount;
                const headResult = computeFeeHeadStatus(head);
                head.balanceAmount = headResult.balanceAmount;
                head.status = headResult.status;
              }
            }
          }

          fs.totalPaid = (fs.totalPaid || 0) + amount;
          fs.lastPaymentDate = new Date();
          const { totalBalance, overallStatus } = computeFeeBalance(fs);
          fs.totalBalance = totalBalance;
          fs.overallStatus = overallStatus;
        }
      );

      // Sync Student.feeDetails and feeStatus from the updated fee structure
      if (feeStructure) {
        try {
          await syncStudentFeeDetails(studentId, feeStructure);
        } catch (e) {
          console.warn('Could not update student fee details:', e.message);
        }
      }

      // Emit socket event
      emitFeePaymentCreated(studentId, student.name, payment, feeStructure);

      res.json({
        success: true,
        data: {
          payment: {
            id: payment._id,
            amount: payment.amount,
            receiptNumber: payment.receiptNumber,
            transactionId: payment.transactionId,
            paymentDate: payment.paymentDate,
            paymentMode: payment.paymentMode,
            status: payment.status,
          },
          updatedFeeDetails: feeStructure
            ? {
                totalFee: feeStructure.totalFee,
                paidAmount: feeStructure.totalPaid,
                balanceAmount: feeStructure.totalBalance,
                overallStatus: feeStructure.overallStatus,
              }
            : null,
        },
      });
    } catch (error) {
      logger.error('Verify payment error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'VERIFICATION_FAILED', message: 'Payment verification failed' },
      });
    }
  }
);

export default router;
