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
  FeePaymentAudit,
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
import {
  validateZod,
  createFeePaymentSchema,
  createRefundSchema,
  paymentsSummaryQuerySchema,
  refundsSummaryQuerySchema,
} from '../validators/index.js';
import { dispatchWebhookEvent } from '../services/webhookService.js';
import { getFeePaymentGateway } from '../services/paymentGateway/index.js';
import { logToTrash } from '../services/trashService.js';
import { updateFeeStructureWithRetry } from '../utils/sfsConcurrency.js';
import { createFeePaymentAuditEntry } from '../utils/feePaymentAudit.js';

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

// Escape user input before using it inside a RegExp so a search term like
// "a.b(" can't act as a regex (ReDoS / unintended matches). Used by the
// payments and refunds search filters below.
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Build the MongoDB filter used by both GET /fees/refunds and
// GET /fees/refunds/summary so the list page and its KPI cards always reflect
// the same dataset (PAG-17). `search` matches student name OR refundNumber;
// the student name branch needs a separate Student lookup because FeeRefund
// only stores the studentId ref.
//
// schoolId/studentId are cast to ObjectId here so the SAME filter works for
// both `find()`/`countDocuments()` (which would cast anyway) and `aggregate()`
// (which does NOT cast from schema — passing a string schoolId to $match in an
// aggregate silently matches nothing).
function toObjectIdOrLeave(value) {
  try {
    return new mongoose.Types.ObjectId(String(value));
  } catch {
    return value;
  }
}

async function buildRefundsFilter(req, { includeSearch = true } = {}) {
  const { studentId, status, academicYear, search } = req.query;
  const filter = scopeBySchool(req.user?.schoolId, {});
  // Always cast schoolId (added by scopeBySchool) to ObjectId so the filter is
  // safe for aggregate().
  if (filter.schoolId) filter.schoolId = toObjectIdOrLeave(filter.schoolId);
  if (studentId) filter.studentId = toObjectIdOrLeave(studentId);
  if (status) filter.status = status;
  if (academicYear) filter.academicYear = academicYear;

  if (includeSearch && search && String(search).trim()) {
    const rx = new RegExp(escapeRegex(String(search).trim().slice(0, 100)), 'i');
    const matchingStudents = await Student.find(
      scopeBySchool(req.user?.schoolId, { name: rx }),
      '_id'
    ).lean();
    filter.$or = [{ studentId: { $in: matchingStudents.map((s) => s._id) } }, { refundNumber: rx }];
  }
  return filter;
}

// Get all payments with optional filters (paginated)
router.get('/payments', checkPermission('fees', 'view'), async (req, res) => {
  try {
    const { studentId, academicYear, status, startDate, endDate, search } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const skip = (page - 1) * limit;

    const filter = scopeBySchool(req.user?.schoolId, {});
    if (studentId) filter.studentId = studentId;
    if (academicYear) filter.academicYear = academicYear;
    if (status) {
      filter.status = status;
    } else {
      // Exclude cancelled payments by default unless explicitly requested
      filter.status = { $ne: 'cancelled' };
    }
    if (startDate || endDate) {
      filter.paymentDate = {};
      // paymentDate is stored as a String (YYYY-MM-DD) in FeePayment schema,
      // so use string comparison instead of Date objects
      if (startDate) filter.paymentDate.$gte = startDate;
      if (endDate) filter.paymentDate.$lte = endDate;
    }

    // Server-side search (PAG-01): match by student name or receipt number so
    // payments older than the first page are still findable. Client-side
    // search only ever saw the rows already on screen. studentId ref is
    // resolved via a name lookup first (same pattern as /defaulters).
    if (search && String(search).trim()) {
      const rx = new RegExp(escapeRegex(String(search).trim().slice(0, 100)), 'i');
      const matchingStudents = await Student.find(
        scopeBySchool(req.user?.schoolId, { name: rx }),
        '_id'
      ).lean();
      filter.$or = [
        { studentId: { $in: matchingStudents.map((s) => s._id) } },
        { receiptNumber: rx },
      ];
    }

    const [payments, total] = await Promise.all([
      FeePayment.find(filter)
        .populate('studentId', 'name admissionId class')
        .sort({ paymentDate: -1 })
        .skip(skip)
        .limit(limit),
      FeePayment.countDocuments(filter),
    ]);

    res.json({
      payments,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'Error fetching payments');
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

// Fees-page KPI summary (PAG-01) — computed over the FULL dataset, never the
// first page of rows. Three figures the Fees page shows:
//   • collectedToday  — sum of non-cancelled FeePayment.amount for `date`
//   • outstandingTotal — sum of StudentFeeStructure.totalBalance still owed
//   • overdueCount     — number of students with an outstanding balance
// Outstanding/overdue come from StudentFeeStructure (the source of truth for
// dues) because FeePayment rows are completed transactions with no
// balance/due fields. Registered before `/payments/:id` so it isn't captured
// as an :id.
router.get('/payments/summary', checkPermission('fees', 'view'), async (req, res) => {
  try {
    const parsed = paymentsSummaryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'Invalid query parameters', details: parsed.error.flatten().fieldErrors });
    }

    const schoolId = await resolveRequestSchoolId(req);
    const resolvedYear = await resolveAcademicYear(parsed.data.academicYear, schoolId);
    // Default to the server's calendar day; the client passes its own local
    // date so "collected today" matches the cashier's timezone.
    const date = parsed.data.date || new Date().toISOString().slice(0, 10);
    const schoolObjectId = new mongoose.Types.ObjectId(schoolId);

    const [collectedAgg, outstandingAgg] = await Promise.all([
      FeePayment.aggregate([
        {
          $match: {
            schoolId: schoolObjectId,
            academicYear: resolvedYear,
            paymentDate: date,
            status: { $ne: 'cancelled' },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      StudentFeeStructure.aggregate([
        {
          $match: {
            schoolId: schoolObjectId,
            academicYear: resolvedYear,
            totalBalance: { $gt: 0 },
          },
        },
        { $group: { _id: null, total: { $sum: '$totalBalance' }, students: { $sum: 1 } } },
      ]),
    ]);

    res.json({
      collectedToday: collectedAgg[0]?.total || 0,
      outstandingTotal: outstandingAgg[0]?.total || 0,
      overdueCount: outstandingAgg[0]?.students || 0,
      date,
      academicYear: resolvedYear,
    });
  } catch (error) {
    logger.error({ err: error }, 'Error computing fee payments summary');
    res.status(500).json({ error: 'Failed to compute fee payments summary' });
  }
});

// Get fee payment audit trail (paginated)
router.get('/audit', checkPermission('fees', 'view'), async (req, res) => {
  try {
    const { studentId, action, entityType, startDate, endDate } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const skip = (page - 1) * limit;

    const filter = scopeBySchool(req.user?.schoolId, {});
    if (studentId) filter.studentId = studentId;
    if (action) filter.action = action;
    if (entityType) filter.entityType = entityType;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    const [logs, total] = await Promise.all([
      FeePaymentAudit.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('performedBy', 'name email role')
        .populate('studentId', 'name admissionId')
        .lean(),
      FeePaymentAudit.countDocuments(filter),
    ]);

    res.json({
      logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'Error fetching fee payment audit logs');
    res.status(500).json({ error: 'Failed to fetch fee payment audit logs' });
  }
});

// Import shared constant instead of duplicating (also defined in validators/feeSchema.js)
const ONLINE_PAYMENT_MODES = ['online', 'card', 'upi', 'bank_transfer'];

// Create a new payment
router.post(
  '/payments',
  checkPermission('fees', 'create'),
  validateZod(createFeePaymentSchema),
  async (req, res) => {
    try {
      const {
        studentId,
        studentName,
        classId,
        academicYear,
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

      // ── Validate payment amount against outstanding balance ─────────────────
      // Auto-initialise an SFS if one doesn't exist so the payment always
      // has a structure record tracking it (previously payments against a
      // student with no SFS silently bypassed the balance check with no
      // audit row). If the student doc is missing we skip init and fall
      // through — the route's studentId-update branch already tolerates
      // unknown-student writes.
      if (studentId) {
        let sfs = await StudentFeeStructure.findOne({
          studentId,
          academicYear: resolvedAcademicYear,
          schoolId,
        });
        if (!sfs) {
          try {
            const studentDoc = await Student.findOne(
              scopeBySchool(req.user?.schoolId, { _id: studentId })
            );
            if (studentDoc) {
              const { initializeFeeStructure } = await import('./students/helpers.js');
              await initializeFeeStructure(studentDoc);
              sfs = await StudentFeeStructure.findOne({
                studentId,
                academicYear: resolvedAcademicYear,
                schoolId,
              });
            }
          } catch {
            // Auto-init failures fall through — don't block the payment
          }
        }
        if (sfs && sfs.totalBalance != null && amount > sfs.totalBalance && sfs.totalBalance >= 0) {
          return res.status(400).json({
            error: `Payment amount (${amount}) exceeds outstanding balance (${sfs.totalBalance}). Please enter a smaller amount.`,
            code: 'EXCEEDS_BALANCE',
            maxAmount: sfs.totalBalance,
          });
        }
      }

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

      // Always generate receipt number server-side via atomic counter (prevents duplicates)
      const receipt = await getNextReceiptNumber(schoolId);

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
        collectedBy: req.body.collectedBy || req.user?.id || undefined,
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
            // Atomic $inc for paidAmount + compute balance in single update pipeline
            // Using aggregation pipeline update to avoid read-modify-write race condition
            const updatedStudent = await Student.findByIdAndUpdate(
              student._id,
              [
                {
                  $set: {
                    'feeDetails.paidAmount': {
                      $add: [{ $ifNull: ['$feeDetails.paidAmount', 0] }, amount],
                    },
                    'feeDetails.lastPaymentDate': payment.paymentDate,
                  },
                },
                {
                  $set: {
                    'feeDetails.balanceAmount': {
                      $max: [
                        {
                          $subtract: [
                            { $ifNull: ['$feeDetails.totalFee', 0] },
                            {
                              $add: [
                                { $ifNull: ['$feeDetails.paidAmount', 0] },
                                { $ifNull: ['$feeDetails.discountApplied', 0] },
                              ],
                            },
                          ],
                        },
                        0,
                      ],
                    },
                  },
                },
              ],
              { new: true }
            );

            if (updatedStudent) {
              const totalFee = updatedStudent.feeDetails?.totalFee || 0;
              const paidAmount = updatedStudent.feeDetails?.paidAmount || 0;
              const discountApplied = updatedStudent.feeDetails?.discountApplied || 0;
              if (totalFee > 0) {
                const { overallStatus } = computeFeeBalance({
                  totalFee,
                  totalPaid: paidAmount,
                  discountApplied,
                });
                await Student.findByIdAndUpdate(student._id, {
                  $set: { feeStatus: overallStatus },
                });
              }
            }

            // Issue #36 fix: update StudentFeeStructure (source of truth for fee tracking)
            //
            // Optimistic-concurrency retry loop: findOne → mutate sfs.feeHeads
            // in memory → save(). Before adding optimisticConcurrency on the
            // schema, two concurrent payments both read the same snapshot and
            // the second save() silently clobbered the first's feeHead
            // updates. The helper retries on VersionError so both payments
            // land safely.
            let distributedHeads = [];
            try {
              const updatedSfs = await updateFeeStructureWithRetry(
                scopeBySchool(req.user?.schoolId, {
                  studentId: student._id,
                  academicYear: resolvedAcademicYear,
                }),
                async (sfs) => {
                  sfs.totalPaid = (sfs.totalPaid || 0) + amount;
                  sfs.lastPaymentDate = payment.paymentDate;

                  // Distribute payment across fee heads if breakdown provided.
                  // Track the ACTUAL (safe) amount credited to each head, since
                  // cancel will reverse against this breakdown — storing the
                  // raw requested amount caused over-reversal when the request
                  // asked for more than the head's outstanding balance.
                  distributedHeads = [];
                  if (
                    Array.isArray(feeHeads) &&
                    feeHeads.length > 0 &&
                    Array.isArray(sfs.feeHeads)
                  ) {
                    for (const paymentHead of feeHeads) {
                      const matchingHead = sfs.feeHeads.find(
                        (h) =>
                          (paymentHead.feeHeadId &&
                            h.feeHeadId?.toString() === paymentHead.feeHeadId.toString()) ||
                          (!paymentHead.feeHeadId &&
                            paymentHead.name &&
                            h.name === paymentHead.name)
                      );
                      if (matchingHead) {
                        const headBalance =
                          (matchingHead.amount || 0) - (matchingHead.paidAmount || 0);
                        const safePayment = Math.min(
                          paymentHead.amount || 0,
                          Math.max(0, headBalance)
                        );
                        matchingHead.paidAmount = (matchingHead.paidAmount || 0) + safePayment;
                        const headResult = computeFeeHeadStatus(matchingHead);
                        matchingHead.balanceAmount = headResult.balanceAmount;
                        matchingHead.status = headResult.status;
                        distributedHeads.push({
                          feeHeadId: paymentHead.feeHeadId || matchingHead.feeHeadId,
                          name: paymentHead.name || matchingHead.name,
                          amount: safePayment,
                        });
                      }
                    }
                  }

                  const { totalBalance, overallStatus } = computeFeeBalance(sfs);
                  sfs.totalBalance = totalBalance;
                  sfs.overallStatus = overallStatus;
                }
              );

              // Persist the capped/distributed feeHeads on the payment so
              // DELETE /payments/:id reverses the amount that was actually
              // credited, not the original request body.
              if (updatedSfs && distributedHeads.length > 0) {
                payment.feeHeads = distributedHeads;
                await payment.save();
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

      // Audit trail — record payment creation
      try {
        await createFeePaymentAuditEntry({
          schoolId,
          entityType: 'FeePayment',
          entityId: payment._id,
          action: 'payment_recorded',
          performedBy: req.user?._id || req.user?.id,
          performedByName: req.user?.name || req.user?.email || null,
          studentId: studentId || null,
          changes: {
            after: {
              amount: payment.amount,
              paymentMode: payment.paymentMode,
              paymentDate: payment.paymentDate,
              receiptNumber: payment.receiptNumber,
              status: payment.status,
            },
          },
          context: {
            receiptNumber: payment.receiptNumber,
            amount: payment.amount,
            academicYear: payment.academicYear,
            paymentMode: payment.paymentMode,
          },
          req,
        });
      } catch {
        // Audit failures must never block the main request
      }

      res.status(201).json(payment);
    } catch (error) {
      if (error.code === 11000) {
        logger.warn(
          { err: error },
          'Duplicate receipt number on concurrent payment — retried automatically'
        );
        return res.status(409).json({
          error: 'A payment was already recorded concurrently. Please refresh and try again.',
          code: 'DUPLICATE_RECEIPT',
        });
      }
      logger.error({ err: error }, 'Error creating payment');
      res.status(500).json({ error: 'Failed to create payment' });
    }
  }
);

// Get payment by ID
router.get('/payments/:id', checkPermission('fees', 'view'), async (req, res) => {
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

// Delete (cancel) a payment and reverse the student's fee balances
router.delete('/payments/:id', checkPermission('fees', 'delete'), async (req, res) => {
  try {
    const schoolId = await resolveRequestSchoolId(req);

    const payment = await FeePayment.findOne(scopeBySchool(schoolId, { _id: req.params.id }));

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    if (payment.status === 'cancelled') {
      return res.status(400).json({ error: 'Payment is already cancelled' });
    }

    // Refund referential integrity: if there's a pending/approved refund
    // pointing at this payment, cancelling the source payment would leave
    // the refund dangling — processable against a voided source. Block it.
    const blockingRefund = await FeeRefund.findOne(
      scopeBySchool(schoolId, {
        paymentId: payment._id,
        status: { $in: ['pending', 'approved'] },
      })
    );
    if (blockingRefund) {
      return res.status(409).json({
        error: 'Payment has an active refund attached — cancel or process the refund first.',
        code: 'REFUND_PENDING',
        refundId: blockingRefund._id,
      });
    }

    const cancelledAmount = payment.amount || 0;
    const previousStatus = payment.status;

    // Mark payment as cancelled (soft-delete)
    payment.status = 'cancelled';
    payment.cancelledAt = new Date();
    payment.cancelledBy = req.user?._id;
    await payment.save();

    // Only reverse balances if the payment was previously completed
    if (previousStatus === 'completed' && payment.studentId && cancelledAmount > 0) {
      // Reverse StudentFeeStructure balances
      try {
        const resolvedYear = payment.academicYear || (await resolveAcademicYear(null, schoolId));
        await updateFeeStructureWithRetry(
          scopeBySchool(schoolId, {
            studentId: payment.studentId,
            academicYear: resolvedYear,
          }),
          async (sfs) => {
            // Reverse per-fee-head amounts if breakdown was recorded
            if (
              Array.isArray(payment.feeHeads) &&
              payment.feeHeads.length > 0 &&
              Array.isArray(sfs.feeHeads)
            ) {
              for (const paymentHead of payment.feeHeads) {
                const matchingHead = sfs.feeHeads.find(
                  (h) =>
                    (paymentHead.feeHeadId &&
                      h.feeHeadId?.toString() === paymentHead.feeHeadId.toString()) ||
                    (!paymentHead.feeHeadId && paymentHead.name && h.name === paymentHead.name)
                );
                if (matchingHead) {
                  matchingHead.paidAmount = Math.max(
                    (matchingHead.paidAmount || 0) - (paymentHead.amount || 0),
                    0
                  );
                  const headResult = computeFeeHeadStatus(matchingHead);
                  matchingHead.balanceAmount = headResult.balanceAmount;
                  matchingHead.status = headResult.status;
                }
              }
            }

            sfs.totalPaid = Math.max((sfs.totalPaid || 0) - cancelledAmount, 0);
            const { totalBalance, overallStatus } = computeFeeBalance(sfs);
            sfs.totalBalance = totalBalance;
            sfs.overallStatus = overallStatus;
          }
        );
      } catch (sfsError) {
        logger.warn(
          { err: sfsError, paymentId: payment._id },
          'Could not reverse StudentFeeStructure after payment cancellation'
        );
      }

      // Reverse Student.feeDetails balances
      try {
        const student = await Student.findOne(scopeBySchool(schoolId, { _id: payment.studentId }));
        if (student) {
          // Clamp paidAmount floor at 0 — $inc alone would let it go
          // negative if the payment was somehow reversed twice, which
          // would then overstate balanceAmount computation.
          const currentPaid = student.feeDetails?.paidAmount || 0;
          const newPaid = Math.max(0, currentPaid - cancelledAmount);
          await Student.findByIdAndUpdate(student._id, {
            $set: { 'feeDetails.paidAmount': newPaid },
          });
          const updated = await Student.findById(student._id);
          if (updated) {
            const totalFee = updated.feeDetails?.totalFee || 0;
            const discountApplied = updated.feeDetails?.discountApplied || 0;
            const paidAmount = updated.feeDetails?.paidAmount || 0;
            const balanceAmount = Math.max(totalFee - paidAmount - discountApplied, 0);
            const { overallStatus } = computeFeeBalance({
              totalFee,
              totalPaid: paidAmount,
              discountApplied,
            });
            await Student.findByIdAndUpdate(student._id, {
              $set: {
                'feeDetails.balanceAmount': balanceAmount,
                feeStatus: overallStatus,
              },
            });
          }
        }
      } catch (studentError) {
        logger.warn(
          { err: studentError, paymentId: payment._id },
          'Could not reverse Student feeDetails after payment cancellation'
        );
      }
    }

    // Audit trail — record payment cancellation
    try {
      await createFeePaymentAuditEntry({
        schoolId: extractSchoolId(schoolId),
        entityType: 'FeePayment',
        entityId: payment._id,
        action: 'payment_cancelled',
        performedBy: req.user?._id || req.user?.id,
        performedByName: req.user?.name || req.user?.email || null,
        studentId: payment.studentId || null,
        changes: {
          before: { status: previousStatus },
          after: { status: 'cancelled', cancelledAt: payment.cancelledAt },
        },
        context: {
          receiptNumber: payment.receiptNumber,
          amount: cancelledAmount,
          academicYear: payment.academicYear,
          paymentMode: payment.paymentMode,
        },
        req,
      });
    } catch {
      // Audit failures must never block the main request
    }

    res.json({
      success: true,
      message: 'Payment cancelled successfully',
      payment,
    });
  } catch (error) {
    logger.error({ err: error }, 'Error cancelling payment');
    res.status(500).json({ error: 'Failed to cancel payment' });
  }
});

// Update payment metadata (remarks, mode, transaction details — amount changes
// require cancel + re-record to preserve the audit trail)
router.put('/payments/:id', checkPermission('fees', 'edit'), async (req, res) => {
  try {
    const payment = await FeePayment.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    );

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    if (payment.status === 'cancelled') {
      return res.status(400).json({ error: 'Cannot update a cancelled payment' });
    }

    // Only allow updating metadata fields — not amount or studentId.
    // Completed payments have a stricter allow-list so historical receipts
    // can't silently change retroactively. paymentDate changes on a
    // completed payment require cancel + re-record.
    const ALLOWED_FIELDS_DRAFT = [
      'paymentMode',
      'transactionId',
      'chequeNumber',
      'bankName',
      'remarks',
      'paymentDate',
    ];
    const ALLOWED_FIELDS_COMPLETED = [
      'paymentMode',
      'transactionId',
      'chequeNumber',
      'bankName',
      'remarks',
    ];
    const allowed =
      payment.status === 'completed' ? ALLOWED_FIELDS_COMPLETED : ALLOWED_FIELDS_DRAFT;

    if (
      payment.status === 'completed' &&
      req.body.paymentDate !== undefined &&
      String(req.body.paymentDate) !== String(payment.paymentDate)
    ) {
      return res.status(400).json({
        error:
          'paymentDate cannot be edited on a completed payment. Cancel and re-record the payment with the correct date instead.',
        code: 'PAYMENT_DATE_IMMUTABLE',
      });
    }

    const changedFields = {};
    for (const field of allowed) {
      if (req.body[field] !== undefined && req.body[field] !== payment[field]) {
        changedFields[field] = { from: payment[field], to: req.body[field] };
        payment[field] = req.body[field];
      }
    }

    await payment.save();

    // Audit trail — record WHO changed WHAT on an existing payment so the
    // historical receipt is defensible.
    if (Object.keys(changedFields).length > 0) {
      try {
        const { default: AuditTrail } = await import('../models/AuditTrail.js');
        await AuditTrail.create({
          schoolId: req.user?.schoolId,
          userId: req.user?.id,
          userName: req.user?.name || null,
          action: 'payment_updated',
          entity: 'FeePayment',
          entityId: payment._id.toString(),
          method: 'PUT',
          path: req.path,
          newValue: changedFields,
        });
      } catch {
        // Audit-trail failures must not block the mutation
      }

      // Dedicated fee-payment audit trail
      try {
        await createFeePaymentAuditEntry({
          schoolId: extractSchoolId(req.user?.schoolId),
          entityType: 'FeePayment',
          entityId: payment._id,
          action: 'payment_updated',
          performedBy: req.user?._id || req.user?.id,
          performedByName: req.user?.name || req.user?.email || null,
          studentId: payment.studentId || null,
          changes: {
            before: Object.fromEntries(Object.entries(changedFields).map(([k, v]) => [k, v.from])),
            after: Object.fromEntries(Object.entries(changedFields).map(([k, v]) => [k, v.to])),
          },
          context: {
            receiptNumber: payment.receiptNumber,
            amount: payment.amount,
            academicYear: payment.academicYear,
            paymentMode: payment.paymentMode,
          },
          req,
        });
      } catch {
        // Audit failures must never block the main request
      }
    }

    const populated = await FeePayment.findById(payment._id).populate(
      'studentId',
      'name admissionId class'
    );

    res.json(populated);
  } catch (error) {
    logger.error({ err: error }, 'Error updating payment');
    res.status(500).json({ error: 'Failed to update payment' });
  }
});

// ── Refunds ──────────────────────────────────────────────────────────────────

// Get all refunds (paginated, server-side search + status filter — PAG-17)
router.get('/refunds', checkPermission('fees', 'view'), async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const skip = (page - 1) * limit;

    const filter = await buildRefundsFilter(req);

    const [refunds, total] = await Promise.all([
      FeeRefund.find(filter)
        .populate('studentId', 'name admissionId')
        .populate('classId', 'name section')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      FeeRefund.countDocuments(filter),
    ]);

    res.json({
      refunds,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'Error fetching refunds');
    res.status(500).json({ error: 'Failed to fetch refunds' });
  }
});

// Refunds-page KPI summary (PAG-17) — computed over the FULL filtered dataset,
// never the loaded page. Returns the total refund amount and per-status counts
// the Refunds page KPI cards show. Registered before `/refunds/:id` so it
// isn't captured as an :id.
router.get('/refunds/summary', checkPermission('fees', 'view'), async (req, res) => {
  try {
    const parsed = refundsSummaryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'Invalid query parameters', details: parsed.error.flatten().fieldErrors });
    }
    // Re-run the same filter builder with the validated query so the summary
    // matches exactly what the list endpoint would paginate over.
    const filter = await buildRefundsFilter({ user: req.user, query: parsed.data });

    const agg = await FeeRefund.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          total: { $sum: '$amount' },
        },
      },
    ]);

    const summary = {
      totalAmount: 0,
      totalCount: 0,
      pendingCount: 0,
      approvedCount: 0,
      processedCount: 0,
      rejectedCount: 0,
    };
    for (const row of agg) {
      const status = row._id || 'pending';
      summary.totalAmount += row.total || 0;
      summary.totalCount += row.count || 0;
      switch (status) {
        case 'pending':
          summary.pendingCount = row.count || 0;
          break;
        case 'approved':
          summary.approvedCount = row.count || 0;
          break;
        case 'processed':
          summary.processedCount = row.count || 0;
          break;
        case 'rejected':
          summary.rejectedCount = row.count || 0;
          break;
        default:
          break;
      }
    }

    res.json(summary);
  } catch (error) {
    logger.error({ err: error }, 'Error computing refunds summary');
    res.status(500).json({ error: 'Failed to compute refunds summary' });
  }
});

// Get refund by ID
router.get('/refunds/:id', checkPermission('fees', 'view'), async (req, res) => {
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

      // Audit trail — record refund creation
      try {
        await createFeePaymentAuditEntry({
          schoolId: extractSchoolId(schoolId),
          entityType: 'FeePayment',
          entityId: refund._id,
          action: 'refund_created',
          performedBy: req.user?._id || req.user?.id,
          performedByName: req.user?.name || req.user?.email || null,
          studentId: studentId || null,
          changes: {
            after: {
              amount: refund.amount,
              reason: refund.reason,
              refundMode: refund.refundMode,
              status: refund.status,
              refundNumber: refund.refundNumber,
            },
          },
          context: {
            refundNumber: refund.refundNumber,
            amount: refund.amount,
            academicYear: refund.academicYear,
            reason: refund.reason,
          },
          req,
        });
      } catch {
        // Audit failures must never block the main request
      }

      res.status(201).json(populated);
    } catch (error) {
      logger.error({ err: error }, 'Error creating refund');
      res.status(500).json({ error: error.message || 'Failed to create refund' });
    }
  }
);

// Approve refund
router.put('/refunds/:id/approve', checkPermission('fees', 'edit'), async (req, res) => {
  try {
    const refund = await FeeRefund.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    );
    if (!refund) return res.status(404).json({ error: 'Refund not found' });
    if (refund.status !== 'pending')
      return res.status(400).json({ error: 'Only pending refunds can be approved' });

    // Re-validate refund amount against current total paid at approval time
    const totalPaidAgg = await FeePayment.aggregate([
      {
        $match: scopeBySchool(req.user?.schoolId, {
          studentId: refund.studentId,
          status: 'completed',
        }),
      },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const currentTotalPaid = totalPaidAgg[0]?.total || 0;
    if (refund.amount > currentTotalPaid) {
      return res.status(400).json({
        error: `Refund amount (${refund.amount}) exceeds current total paid (${currentTotalPaid}). Cannot approve.`,
        code: 'REFUND_EXCEEDS_PAID',
      });
    }

    refund.status = 'approved';
    refund.approvedBy = req.user?._id;
    refund.approvedAt = new Date();
    if (req.body.remarks) refund.remarks = req.body.remarks;
    await refund.save();

    // Audit trail — record refund approval
    try {
      await createFeePaymentAuditEntry({
        schoolId: extractSchoolId(req.user?.schoolId),
        entityType: 'FeePayment',
        entityId: refund._id,
        action: 'refund_approved',
        performedBy: req.user?._id || req.user?.id,
        performedByName: req.user?.name || req.user?.email || null,
        studentId: refund.studentId || null,
        changes: {
          before: { status: 'pending' },
          after: { status: 'approved', approvedAt: refund.approvedAt },
        },
        context: {
          refundNumber: refund.refundNumber,
          amount: refund.amount,
          academicYear: refund.academicYear,
        },
        req,
      });
    } catch {
      // Audit failures must never block the main request
    }

    res.json(refund);
  } catch (error) {
    logger.error({ err: error }, 'Failed to approve refund');
    res.status(500).json({ error: 'Failed to approve refund' });
  }
});

// Process refund
router.put('/refunds/:id/process', checkPermission('fees', 'edit'), async (req, res) => {
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

    // Audit trail — record refund processing
    try {
      await createFeePaymentAuditEntry({
        schoolId: extractSchoolId(req.user?.schoolId),
        entityType: 'FeePayment',
        entityId: refund._id,
        action: 'refund_processed',
        performedBy: req.user?._id || req.user?.id,
        performedByName: req.user?.name || req.user?.email || null,
        studentId: refund.studentId || null,
        changes: {
          before: { status: 'approved' },
          after: { status: 'processed', processedAt: refund.processedAt },
        },
        context: {
          refundNumber: refund.refundNumber,
          amount: refund.amount,
          academicYear: refund.academicYear,
        },
        req,
      });
    } catch {
      // Audit failures must never block the main request
    }

    // Reverse student fee balances when refund is processed
    const refundAmount = refund.amount || 0;
    if (refund.studentId && refundAmount > 0) {
      try {
        // Update StudentFeeStructure — decrease totalPaid, increase totalBalance
        await updateFeeStructureWithRetry(
          scopeBySchool(req.user?.schoolId, {
            studentId: refund.studentId,
            academicYear: refund.academicYear,
          }),
          async (sfs) => {
            sfs.totalPaid = Math.max((sfs.totalPaid || 0) - refundAmount, 0);
            const { totalBalance, overallStatus } = computeFeeBalance(sfs);
            sfs.totalBalance = totalBalance;
            sfs.overallStatus = overallStatus;
          }
        );

        // Update Student.feeDetails — decrease paidAmount, increase balanceAmount.
        // Clamp floor at 0 so duplicate refund processing can't drive
        // paidAmount negative.
        const student = await Student.findOne(
          scopeBySchool(req.user?.schoolId, { _id: refund.studentId })
        );
        if (student) {
          const currentPaid = student.feeDetails?.paidAmount || 0;
          const newPaid = Math.max(0, currentPaid - refundAmount);
          await Student.findByIdAndUpdate(student._id, {
            $set: { 'feeDetails.paidAmount': newPaid },
          });
          const updated = await Student.findById(student._id);
          if (updated) {
            const totalFee = updated.feeDetails?.totalFee || 0;
            const discountApplied = updated.feeDetails?.discountApplied || 0;
            const paidAmount = updated.feeDetails?.paidAmount || 0;
            const balanceAmount = Math.max(totalFee - paidAmount - discountApplied, 0);
            await Student.findByIdAndUpdate(student._id, {
              $set: { 'feeDetails.balanceAmount': balanceAmount },
            });
          }
        }
      } catch (reverseErr) {
        logger.warn(
          { err: reverseErr, studentId: refund.studentId, refundId: refund._id },
          'Could not reverse student fee balances after refund processing'
        );
      }
    }

    res.json(refund);
  } catch (error) {
    res.status(500).json({ error: 'Failed to process refund' });
  }
});

// Reject refund
router.put('/refunds/:id/reject', checkPermission('fees', 'edit'), async (req, res) => {
  try {
    const refund = await FeeRefund.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    );
    if (!refund) return res.status(404).json({ error: 'Refund not found' });
    if (refund.status === 'processed')
      return res.status(400).json({ error: 'Processed refunds cannot be rejected' });

    const previousRefundStatus = refund.status;
    refund.status = 'rejected';
    refund.rejectionReason = req.body.rejectionReason || '';
    await refund.save();

    // Audit trail — record refund rejection
    try {
      await createFeePaymentAuditEntry({
        schoolId: extractSchoolId(req.user?.schoolId),
        entityType: 'FeePayment',
        entityId: refund._id,
        action: 'refund_rejected',
        performedBy: req.user?._id || req.user?.id,
        performedByName: req.user?.name || req.user?.email || null,
        studentId: refund.studentId || null,
        changes: {
          before: { status: previousRefundStatus },
          after: { status: 'rejected', rejectionReason: refund.rejectionReason },
        },
        context: {
          refundNumber: refund.refundNumber,
          amount: refund.amount,
          academicYear: refund.academicYear,
          reason: refund.rejectionReason,
        },
        req,
      });
    } catch {
      // Audit failures must never block the main request
    }

    res.json(refund);
  } catch (error) {
    res.status(500).json({ error: 'Failed to reject refund' });
  }
});

// Update refund (only pending refunds can be edited)
router.put('/refunds/:id', checkPermission('fees', 'edit'), async (req, res) => {
  try {
    const refund = await FeeRefund.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    );
    if (!refund) return res.status(404).json({ error: 'Refund not found' });
    if (refund.status !== 'pending') {
      return res.status(400).json({ error: 'Only pending refunds can be updated' });
    }

    const { amount, reason, refundMode, remarks } = req.body;
    if (amount !== undefined) refund.amount = amount;
    if (reason !== undefined) refund.reason = reason;
    if (refundMode !== undefined) refund.refundMode = refundMode;
    if (remarks !== undefined) refund.remarks = remarks;

    await refund.save();

    // Audit trail — record refund update
    try {
      await createFeePaymentAuditEntry({
        schoolId: extractSchoolId(req.user?.schoolId),
        entityType: 'FeePayment',
        entityId: refund._id,
        action: 'refund_updated',
        performedBy: req.user?._id || req.user?.id,
        performedByName: req.user?.name || req.user?.email || null,
        studentId: refund.studentId || null,
        context: {
          refundNumber: refund.refundNumber,
          amount: refund.amount,
          academicYear: refund.academicYear,
        },
        req,
      });
    } catch {
      // Audit failures must never block the main request
    }

    const populated = await FeeRefund.findById(refund._id)
      .populate('studentId', 'name admissionId')
      .populate('classId', 'name section');

    res.json(populated);
  } catch (error) {
    logger.error({ err: error }, 'Error updating refund');
    res.status(500).json({ error: 'Failed to update refund' });
  }
});

// Delete refund (only pending refunds can be deleted)
router.delete('/refunds/:id', checkPermission('fees', 'delete'), async (req, res) => {
  try {
    const refund = await FeeRefund.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    );
    if (!refund) return res.status(404).json({ error: 'Refund not found' });
    if (refund.status !== 'pending') {
      return res.status(400).json({ error: 'Only pending refunds can be deleted' });
    }

    // Snapshot for trash logging
    const refundSnapshot = refund.toObject();

    await FeeRefund.findByIdAndDelete(refund._id);

    // Log to trash
    logToTrash({
      itemType: 'FeeRefund',
      itemId: refundSnapshot._id,
      itemName: `Refund #${refundSnapshot.refundId || refundSnapshot._id}`,
      originalData: refundSnapshot,
      deletedBy: req.user?.id || req.user?._id,
      schoolId: req.user?.schoolId,
    }).catch(() => {});

    // Audit trail — record refund deletion
    try {
      await createFeePaymentAuditEntry({
        schoolId: extractSchoolId(req.user?.schoolId),
        entityType: 'FeePayment',
        entityId: refundSnapshot._id,
        action: 'refund_deleted',
        performedBy: req.user?._id || req.user?.id,
        performedByName: req.user?.name || req.user?.email || null,
        studentId: refundSnapshot.studentId || null,
        changes: {
          before: {
            amount: refundSnapshot.amount,
            reason: refundSnapshot.reason,
            status: refundSnapshot.status,
            refundNumber: refundSnapshot.refundNumber,
          },
        },
        context: {
          refundNumber: refundSnapshot.refundNumber,
          amount: refundSnapshot.amount,
          academicYear: refundSnapshot.academicYear,
        },
        req,
      });
    } catch {
      // Audit failures must never block the main request
    }

    res.json({ message: 'Refund deleted successfully' });
  } catch (error) {
    logger.error({ err: error }, 'Error deleting refund');
    res.status(500).json({ error: 'Failed to delete refund' });
  }
});

export default router;
