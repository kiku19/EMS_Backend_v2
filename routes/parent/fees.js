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
import { applyLateFeeToFeeStructure } from '../../utils/lateFeeCalculator.js';

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
      isDeleted: { $ne: true },
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

    // F8: scope the recent-payments list to the resolved academic year and to
    // completed payments only. Previously the query omitted both, so a parent
    // could see cancelled/failed rows and payments from prior years mixed into
    // the "recent payments" card.
    const payments = await FeePaymentModel.find({
      studentId: id,
      schoolId: req.schoolId,
      academicYear: year,
      status: 'completed',
      isDeleted: { $ne: true },
    })
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
        scopeBySchool(req.parent?.schoolId, {
          studentId,
          academicYear: resolvedAcademicYear,
          isDeleted: { $ne: true },
        })
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

      // Create FeePayment record (atomic counter — prevents duplicate receipt numbers).
      // (F11) The receipt number is generated INSIDE the withTransaction below so the
      // Counter $inc participates in the session — if the transaction aborts (balance
      // exceeded, idempotency collision, retry exhaustion) the sequence number is no
      // longer consumed, avoiding gaps like REC-101, REC-103 in finance audits.
      const schoolId = await resolveRequestSchoolId(req);

      // Idempotency: the confirmed gateway payment_id uniquely identifies this
      // settlement. Persisting it as `idempotencyKey` (covered by a partial
      // unique index on FeePayment) makes verify safe to retry — a duplicate
      // verify for the same payment collides on insert and returns the
      // original payment instead of crediting the balance a second time.
      // (F2) Prefer the payment id as the canonical key; fall back to the
      // order id for mock/dev flows where a payment id may not be issued.
      const idempotencyKey = razorpay_payment_id || razorpay_order_id || undefined;

      const payment = new FeePayment({
        schoolId,
        studentId,
        classId: student.classId?._id || student.classId,
        academicYear: year,
        // receiptNumber assigned inside the transaction below (F11).
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
        idempotencyKey,
      });

      // Atomicity: the payment record and the balance credit MUST commit
      // together. Previously payment.save() committed first and the
      // updateFeeStructureWithRetry ran separately — if the balance update
      // failed (retry exhausted, thrown) the payment was already persisted
      // with no compensating rollback, so two concurrent verifications of the
      // same order could both credit the balance and over-charge the student.
      // Wrapping both in a transaction means either both apply or neither does.
      let feeStructure = null;
      const mongoose = (await import('mongoose')).default;
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          // (F11) Generate the receipt number inside the transaction so the
          // Counter $inc is rolled back if the transaction aborts.
          payment.receiptNumber = await getNextAvailableReceiptNumber(schoolId, session);
          await payment.save({ session });

          // Update StudentFeeStructure — strict year scope, no cross-year fallback.
          feeStructure = await updateFeeStructureWithRetry(
            scopeBySchool(req.parent?.schoolId, { studentId, academicYear: year }),
            async (fs) => {
              // F2: re-check the balance on the freshly-read snapshot inside
              // the retry loop. The pre-flight check ran outside the
              // transaction; a concurrent verify of the same order could have
              // already credited the balance, so without this guard the second
              // verify would over-charge the student. Throwing aborts the
              // transaction so the FeePayment saved above never commits.
              if (Number(amount) > Number(fs.totalBalance || 0)) {
                const err = new Error(
                  `Payment amount (₹${amount}) exceeds outstanding balance (₹${fs.totalBalance || 0})`
                );
                err.code = 'EXCEEDS_BALANCE';
                throw err;
              }

              if (feeHeadPayments && feeHeadPayments.length > 0) {
                for (const fhp of feeHeadPayments) {
                  const head = fs.feeHeads.find(
                    (h) =>
                      h.feeHeadId?.toString() === fhp.feeHeadId ||
                      h._id?.toString() === fhp.feeHeadId
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
              // Recompute late-fee liability before deriving the balance so a
              // payment against an overdue account still reflects it.
              await applyLateFeeToFeeStructure(fs);
              const { totalBalance, overallStatus } = computeFeeBalance(fs);
              fs.totalBalance = totalBalance;
              fs.overallStatus = overallStatus;
            },
            { session }
          );
        });
      } catch (error) {
        // Duplicate (idempotent) verify for the same gateway order: return the
        // original payment rather than erroring. The partial unique index on
        // idempotencyKey rejects the second insert.
        if (idempotencyKey && error?.code === 11000 && error?.keyPattern?.idempotencyKey) {
          const existing = await FeePayment.findOne({ schoolId, idempotencyKey })
            .sort({ createdAt: -1 })
            .lean();
          if (existing) {
            const existingFs = await StudentFeeStructure.findOne(
              scopeBySchool(req.parent?.schoolId, {
                studentId,
                academicYear: year,
                isDeleted: { $ne: true },
              })
            ).lean();
            return res.json({
              success: true,
              data: {
                payment: {
                  id: existing._id,
                  amount: existing.amount,
                  receiptNumber: existing.receiptNumber,
                  transactionId: existing.transactionId,
                  paymentDate: existing.paymentDate,
                  paymentMode: existing.paymentMode,
                  status: existing.status,
                },
                updatedFeeDetails: existingFs
                  ? {
                      totalFee: existingFs.totalFee,
                      paidAmount: existingFs.totalPaid,
                      balanceAmount: existingFs.totalBalance,
                      overallStatus: existingFs.overallStatus,
                    }
                  : null,
              },
            });
          }
        }
        throw error;
      } finally {
        await session.endSession();
      }

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
