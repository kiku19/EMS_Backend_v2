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
  Notification,
  getNextRefundNumber,
  getNextAvailableReceiptNumber,
} from '../database.js';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { validateObjectIdParam } from '../middleware/validation.js';
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
  sendInvoiceSchema,
  createRefundSchema,
  updateFeePaymentSchema,
  approveRefundSchema,
  processRefundSchema,
  rejectRefundSchema,
  updateRefundSchema,
  paymentsSummaryQuerySchema,
  studentTotalPaidQuerySchema,
  refundsSummaryQuerySchema,
  feeClassSummaryQuerySchema,
  feePaymentsListQuerySchema,
  feeRefundsListQuerySchema,
  feeAuditListQuerySchema,
} from '../validators/index.js';
import { dispatchWebhookEvent } from '../services/webhookService.js';
import { getFeePaymentGateway } from '../services/paymentGateway/index.js';
import { logToTrash } from '../services/trashService.js';
import { createFeePaymentAuditEntry } from '../utils/feePaymentAudit.js';
import { generateFeeInvoicePdf, buildFeeInvoiceData } from '../services/feeInvoiceService.js';
import { sendEmail } from '../config/email.js';
import { sendSMS } from '../config/sms.js';
import { sendWhatsAppMessage } from '../config/whatsapp.js';

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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pdfStreamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
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
router.get(
  '/payments',
  checkPermission('fees', 'view'),
  validateZod(feePaymentsListQuerySchema, 'query'),
  async (req, res) => {
    try {
      const {
        studentId,
        classId,
        academicYear,
        status,
        paymentMode,
        startDate,
        endDate,
        search,
        page,
        limit,
      } = req.query;
      const skip = (page - 1) * limit;

      const filter = scopeBySchool(req.user?.schoolId, {});
      if (studentId) filter.studentId = studentId;
      if (classId) filter.classId = classId;
      if (academicYear) filter.academicYear = academicYear;
      if (paymentMode) filter.paymentMode = paymentMode;
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
  }
);

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
router.get(
  '/audit',
  checkPermission('fees', 'view'),
  validateZod(feeAuditListQuerySchema, 'query'),
  async (req, res) => {
    try {
      const { studentId, action, entityType, startDate, endDate, page, limit } = req.query;
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
  }
);

// Import shared constant instead of duplicating (also defined in validators/feeSchema.js)
const ONLINE_PAYMENT_MODES = ['online', 'card', 'upi', 'bank_transfer'];

// Create a new payment
router.post(
  '/payments',
  checkPermission('fees', 'create'),
  validateZod(createFeePaymentSchema),
  async (req, res) => {
    let mongoSession;
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
        installmentIndex,
        transactionId,
        chequeNumber,
        bankName,
        gatewayOrderId,
        gatewaySignature,
        remarks,
        idempotencyKey,
      } = req.body;

      const resolvedAcademicYear = await resolveAcademicYear(academicYear, req.user?.schoolId);
      if (!resolvedAcademicYear) {
        return res
          .status(400)
          .json({ error: 'Could not resolve academic year. Please provide a valid year.' });
      }

      const schoolId = await resolveRequestSchoolId(req);
      const [student, classDoc] = await Promise.all([
        Student.findOne(scopeBySchool(schoolId, { _id: studentId })),
        Class.findOne(scopeBySchool(schoolId, { _id: classId })),
      ]);

      if (!student) {
        return res.status(404).json({ error: 'Student not found in this school' });
      }
      if (!classDoc) {
        return res.status(404).json({ error: 'Class not found in this school' });
      }
      if (String(student.classId) !== String(classDoc._id)) {
        return res.status(400).json({
          error: 'The selected class does not match the student’s current class',
          code: 'STUDENT_CLASS_MISMATCH',
        });
      }

      if (idempotencyKey) {
        const existingPayment = await FeePayment.findOne(
          scopeBySchool(schoolId, { idempotencyKey })
        );
        if (existingPayment) {
          return res.status(409).json({
            error: 'This payment request has already been recorded.',
            code: 'IDEMPOTENCY_KEY_USED',
            paymentId: existingPayment._id,
            receiptNumber: existingPayment.receiptNumber,
          });
        }
      }

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
      }
      const receiptNumber = await getNextAvailableReceiptNumber(schoolId);
      const recordedPaymentDate = paymentDate || new Date().toISOString().split('T')[0];
      let payment;
      let updatedFeeStructure;
      mongoSession = await mongoose.startSession();

      await mongoSession.withTransaction(async () => {
        let feeStructure = await StudentFeeStructure.findOne(
          scopeBySchool(schoolId, {
            studentId: student._id,
            academicYear: resolvedAcademicYear,
          })
        ).session(mongoSession);

        // Older tenants may have a Student summary but no StudentFeeStructure.
        // Create the missing source-of-truth row inside the transaction rather
        // than recording an orphan ledger entry.
        if (!feeStructure) {
          const totalFee = Number(student.feeDetails?.totalFee || 0);
          const totalPaid = Number(student.feeDetails?.paidAmount || 0);
          const discountApplied = Number(student.feeDetails?.discountApplied || 0);
          if (totalFee <= 0) {
            const setupError = new Error(
              'Configure this student’s fee structure before recording a payment.'
            );
            setupError.code = 'FEE_STRUCTURE_NOT_CONFIGURED';
            throw setupError;
          }
          [feeStructure] = await StudentFeeStructure.create(
            [
              {
                schoolId,
                studentId: student._id,
                classId: classDoc._id,
                academicYear: resolvedAcademicYear,
                feeHeads: [],
                totalFee,
                totalPaid,
                discountApplied,
                totalBalance: Math.max(totalFee - totalPaid - discountApplied, 0),
                overallStatus: totalPaid > 0 ? 'partial' : 'pending',
              },
            ],
            { session: mongoSession }
          );
        }

        if (String(feeStructure.classId) !== String(classDoc._id)) {
          const mismatchError = new Error('Fee structure belongs to a different class.');
          mismatchError.code = 'FEE_STRUCTURE_CLASS_MISMATCH';
          throw mismatchError;
        }
        if (amount > Number(feeStructure.totalBalance || 0)) {
          const balanceError = new Error(
            `Payment amount (${amount}) exceeds outstanding balance (${feeStructure.totalBalance || 0}).`
          );
          balanceError.code = 'EXCEEDS_BALANCE';
          balanceError.maxAmount = feeStructure.totalBalance || 0;
          throw balanceError;
        }

        let selectedInstallment = null;
        if (installmentIndex !== undefined) {
          selectedInstallment = feeStructure.installments?.[installmentIndex];
          if (!selectedInstallment) {
            const installmentError = new Error(
              'The selected installment is not configured for this student.'
            );
            installmentError.code = 'INSTALLMENT_NOT_FOUND';
            throw installmentError;
          }
          if (amount > Number(selectedInstallment.balanceAmount || 0)) {
            const installmentBalanceError = new Error(
              `Payment amount (${amount}) exceeds the installment balance (${selectedInstallment.balanceAmount || 0}).`
            );
            installmentBalanceError.code = 'INSTALLMENT_BALANCE_EXCEEDED';
            throw installmentBalanceError;
          }
          selectedInstallment.paidAmount = Number(selectedInstallment.paidAmount || 0) + amount;
          selectedInstallment.balanceAmount = Math.max(
            Number(selectedInstallment.amount || 0) - Number(selectedInstallment.paidAmount || 0),
            0
          );
          selectedInstallment.status = selectedInstallment.balanceAmount <= 0 ? 'paid' : 'partial';
        }

        const distributedHeads = [];
        let remainingAmount = amount;
        const requestedHeads = Array.isArray(feeHeads) ? feeHeads : [];
        const structureHeads = Array.isArray(feeStructure.feeHeads) ? feeStructure.feeHeads : [];

        const creditHead = (structureHead, requestedAmount) => {
          const outstanding = Math.max(
            Number(structureHead.amount || 0) - Number(structureHead.paidAmount || 0),
            0
          );
          const credited = Math.min(Number(requestedAmount || 0), outstanding, remainingAmount);
          if (credited <= 0) return;
          structureHead.paidAmount = Number(structureHead.paidAmount || 0) + credited;
          const headStatus = computeFeeHeadStatus(structureHead);
          structureHead.balanceAmount = headStatus.balanceAmount;
          structureHead.status = headStatus.status;
          distributedHeads.push({
            feeHeadId: structureHead.feeHeadId,
            name: structureHead.name,
            amount: credited,
          });
          remainingAmount -= credited;
        };

        if (requestedHeads.length > 0) {
          for (const requestedHead of requestedHeads) {
            const structureHead = structureHeads.find(
              (head) =>
                (requestedHead.feeHeadId &&
                  String(head.feeHeadId) === String(requestedHead.feeHeadId)) ||
                (!requestedHead.feeHeadId && requestedHead.name && head.name === requestedHead.name)
            );
            if (!structureHead) {
              const headError = new Error('A selected fee head is not assigned to this student.');
              headError.code = 'INVALID_FEE_HEAD';
              throw headError;
            }
            creditHead(structureHead, requestedHead.amount);
          }
        } else {
          // Full/term/aggregate payments arrive without a breakdown. Allocate
          // deterministically across outstanding heads so per-head balances
          // and the ledger never diverge from the top-level total.
          for (const structureHead of structureHeads) {
            if (remainingAmount <= 0) break;
            creditHead(structureHead, remainingAmount);
          }
        }

        // Legacy structures may carry only a top-level total and no heads.
        // Otherwise every rupee must have been allocated to a real head.
        if (structureHeads.length > 0 && remainingAmount > 0.009) {
          const headBalanceError = new Error(
            'Payment exceeds the outstanding balance of the selected fee heads.'
          );
          headBalanceError.code = 'FEE_HEAD_BALANCE_EXCEEDED';
          throw headBalanceError;
        }

        feeStructure.totalPaid = Number(feeStructure.totalPaid || 0) + amount;
        feeStructure.lastPaymentDate = new Date(recordedPaymentDate);
        const totals = computeFeeBalance(feeStructure);
        feeStructure.totalBalance = totals.totalBalance;
        feeStructure.overallStatus = totals.overallStatus;
        updatedFeeStructure = await feeStructure.save({ session: mongoSession });

        [payment] = await FeePayment.create(
          [
            {
              schoolId,
              studentId: student._id,
              classId: classDoc._id,
              academicYear: resolvedAcademicYear,
              receiptNumber,
              paymentDate: recordedPaymentDate,
              amount,
              paymentMode: paymentMode || 'cash',
              feeHeads: distributedHeads,
              ...(installmentIndex !== undefined
                ? {
                    installmentIndex,
                    installmentName: selectedInstallment?.name,
                  }
                : {}),
              transactionId: transactionId || undefined,
              chequeNumber: chequeNumber || undefined,
              bankName: bankName || undefined,
              gatewayOrderId: gatewayOrderId || undefined,
              gatewaySignature: gatewaySignature || undefined,
              gatewayVerified,
              remarks: remarks || '',
              collectedBy: req.user?._id || req.user?.id || undefined,
              idempotencyKey: idempotencyKey || undefined,
              status: 'completed',
            },
          ],
          { session: mongoSession }
        );

        await syncStudentFeeDetails(student._id, updatedFeeStructure, mongoSession);
      });

      dispatchWebhookEvent(req.user?.schoolId, 'fee.paid', {
        id: payment._id,
        studentId,
        amount,
        paymentMode: payment.paymentMode,
        receiptNumber: payment.receiptNumber,
        academicYear: payment.academicYear,
      }).catch(() => {});

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
      if (
        [
          'EXCEEDS_BALANCE',
          'FEE_STRUCTURE_CLASS_MISMATCH',
          'INVALID_FEE_HEAD',
          'FEE_HEAD_BALANCE_EXCEEDED',
          'INSTALLMENT_NOT_FOUND',
          'INSTALLMENT_BALANCE_EXCEEDED',
        ].includes(error.code)
      ) {
        return res.status(400).json({
          error: error.message,
          code: error.code,
          ...(error.maxAmount !== undefined ? { maxAmount: error.maxAmount } : {}),
        });
      }
      if (error.code === 'FEE_STRUCTURE_NOT_CONFIGURED') {
        return res.status(409).json({ error: error.message, code: error.code });
      }
      if (error.code === 11000) {
        const isIdempotencyConflict = error.keyPattern && 'idempotencyKey' in error.keyPattern;
        return res.status(409).json({
          error: isIdempotencyConflict
            ? 'This payment request has already been recorded.'
            : 'Could not assign a unique receipt number. Please retry.',
          code: isIdempotencyConflict ? 'IDEMPOTENCY_KEY_USED' : 'DUPLICATE_RECEIPT',
          keyPattern: error.keyPattern,
        });
      }
      logger.error({ err: error }, 'Error creating payment');
      res.status(500).json({ error: 'Failed to create payment' });
    } finally {
      if (mongoSession) await mongoSession.endSession();
    }
  }
);

// Full-dataset student payment aggregate used by refund validation. This must
// stay before `/payments/:id` so `total-paid` is never interpreted as an id.
router.get('/payments/total-paid', checkPermission('fees', 'view'), async (req, res) => {
  try {
    const parsed = studentTotalPaidQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const schoolId = extractSchoolId(req.user?.schoolId);
    const resolvedAcademicYear = await resolveAcademicYear(parsed.data.academicYear, schoolId);
    const student = await Student.findOne(scopeBySchool(schoolId, { _id: parsed.data.studentId }))
      .select('_id')
      .lean();
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const [summary] = await FeePayment.aggregate([
      {
        $match: {
          schoolId: new mongoose.Types.ObjectId(schoolId),
          studentId: new mongoose.Types.ObjectId(parsed.data.studentId),
          academicYear: resolvedAcademicYear,
          status: 'completed',
        },
      },
      {
        $group: {
          _id: null,
          totalPaid: { $sum: '$amount' },
          paymentCount: { $sum: 1 },
        },
      },
    ]);
    res.json({
      totalPaid: summary?.totalPaid || 0,
      paymentCount: summary?.paymentCount || 0,
      academicYear: resolvedAcademicYear,
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to compute student total paid');
    res.status(500).json({ error: 'Failed to compute student total paid' });
  }
});

// Get payment by ID
router.get(
  '/payments/:id',
  checkPermission('fees', 'view'),
  validateObjectIdParam('id'),
  async (req, res) => {
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
  }
);

// Delete (cancel) a payment and reverse the student's fee balances
router.delete(
  '/payments/:id',
  checkPermission('fees', 'delete'),
  validateObjectIdParam('id'),
  async (req, res) => {
    const session = await mongoose.startSession();
    let payment;
    let previousStatus;
    try {
      const schoolId = await resolveRequestSchoolId(req);
      await session.withTransaction(async () => {
        payment = await FeePayment.findOne(scopeBySchool(schoolId, { _id: req.params.id })).session(
          session
        );
        if (!payment) {
          const notFound = new Error('Payment not found');
          notFound.code = 'PAYMENT_NOT_FOUND';
          throw notFound;
        }
        if (payment.status === 'cancelled') {
          const cancelled = new Error('Payment is already cancelled');
          cancelled.code = 'PAYMENT_ALREADY_CANCELLED';
          throw cancelled;
        }

        const blockingRefund = await FeeRefund.findOne(
          scopeBySchool(schoolId, {
            originalPaymentId: payment._id,
            status: { $in: ['pending', 'approved', 'processed'] },
          })
        ).session(session);
        if (blockingRefund) {
          const refundError = new Error(
            'Payment has an active refund attached — cancel the refund first.'
          );
          refundError.code = 'REFUND_PENDING';
          refundError.refundId = blockingRefund._id;
          throw refundError;
        }

        previousStatus = payment.status;
        const cancelledAmount = Number(payment.amount || 0);
        if (previousStatus === 'completed' && payment.studentId && cancelledAmount > 0) {
          const feeStructure = await StudentFeeStructure.findOne(
            scopeBySchool(schoolId, {
              studentId: payment.studentId,
              academicYear: payment.academicYear,
            })
          ).session(session);
          if (!feeStructure) {
            const structureError = new Error(
              'Payment cannot be cancelled because its fee structure is missing.'
            );
            structureError.code = 'FEE_STRUCTURE_NOT_FOUND';
            throw structureError;
          }

          for (const paymentHead of payment.feeHeads || []) {
            const matchingHead = feeStructure.feeHeads.find(
              (head) =>
                (paymentHead.feeHeadId &&
                  String(head.feeHeadId) === String(paymentHead.feeHeadId)) ||
                (!paymentHead.feeHeadId && paymentHead.name && head.name === paymentHead.name)
            );
            if (matchingHead) {
              matchingHead.paidAmount = Math.max(
                Number(matchingHead.paidAmount || 0) - Number(paymentHead.amount || 0),
                0
              );
              const headResult = computeFeeHeadStatus(matchingHead);
              matchingHead.balanceAmount = headResult.balanceAmount;
              matchingHead.status = headResult.status;
            }
          }
          if (payment.installmentIndex !== undefined && payment.installmentIndex !== null) {
            const installment = feeStructure.installments?.[payment.installmentIndex];
            if (!installment) {
              const installmentError = new Error(
                'Payment cannot be cancelled because its installment record is missing.'
              );
              installmentError.code = 'INSTALLMENT_NOT_FOUND';
              throw installmentError;
            }
            installment.paidAmount = Math.max(
              Number(installment.paidAmount || 0) - cancelledAmount,
              0
            );
            installment.balanceAmount = Math.max(
              Number(installment.amount || 0) - Number(installment.paidAmount || 0),
              0
            );
            installment.status =
              installment.balanceAmount <= 0
                ? 'paid'
                : installment.paidAmount > 0
                  ? 'partial'
                  : installment.dueDate && installment.dueDate < new Date()
                    ? 'overdue'
                    : 'pending';
          }
          feeStructure.totalPaid = Math.max(
            Number(feeStructure.totalPaid || 0) - cancelledAmount,
            0
          );
          const totals = computeFeeBalance(feeStructure);
          feeStructure.totalBalance = totals.totalBalance;
          feeStructure.overallStatus = totals.overallStatus;
          await feeStructure.save({ session });
          await syncStudentFeeDetails(payment.studentId, feeStructure, session);
        }

        payment.status = 'cancelled';
        payment.cancelledAt = new Date();
        payment.cancelledBy = req.user?._id || req.user?.id;
        await payment.save({ session });
      });

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
            amount: payment.amount,
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
      if (error.code === 'PAYMENT_NOT_FOUND') {
        return res.status(404).json({ error: error.message });
      }
      if (error.code === 'PAYMENT_ALREADY_CANCELLED') {
        return res.status(400).json({ error: error.message });
      }
      if (error.code === 'REFUND_PENDING') {
        return res.status(409).json({
          error: error.message,
          code: error.code,
          refundId: error.refundId,
        });
      }
      if (['FEE_STRUCTURE_NOT_FOUND', 'INSTALLMENT_NOT_FOUND'].includes(error.code)) {
        return res.status(409).json({ error: error.message, code: error.code });
      }
      logger.error({ err: error }, 'Error cancelling payment');
      res.status(500).json({ error: 'Failed to cancel payment' });
    } finally {
      await session.endSession();
    }
  }
);

// Update payment metadata (remarks, mode, transaction details — amount changes
// require cancel + re-record to preserve the audit trail)
router.put(
  '/payments/:id',
  checkPermission('fees', 'edit'),
  validateObjectIdParam('id'),
  validateZod(updateFeePaymentSchema),
  async (req, res) => {
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

      if (ONLINE_PAYMENT_MODES.includes(payment.paymentMode) && !payment.transactionId) {
        return res.status(400).json({
          error: 'transactionId is required for online payment modes',
          code: 'TRANSACTION_ID_REQUIRED',
        });
      }
      if (['cheque', 'dd'].includes(payment.paymentMode) && !payment.chequeNumber) {
        return res.status(400).json({
          error: 'chequeNumber is required for cheque and demand draft payments',
          code: 'CHEQUE_NUMBER_REQUIRED',
        });
      }
      if (['cheque', 'dd'].includes(payment.paymentMode) && !payment.bankName) {
        return res.status(400).json({
          error: 'bankName is required for cheque and demand draft payments',
          code: 'BANK_NAME_REQUIRED',
        });
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
              before: Object.fromEntries(
                Object.entries(changedFields).map(([k, v]) => [k, v.from])
              ),
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

      const populated = await FeePayment.findOne(
        scopeBySchool(req.user?.schoolId, { _id: payment._id })
      ).populate('studentId', 'name admissionId class');

      res.json(populated);
    } catch (error) {
      logger.error({ err: error }, 'Error updating payment');
      res.status(500).json({ error: 'Failed to update payment' });
    }
  }
);

// ── Refunds ──────────────────────────────────────────────────────────────────

// Get all refunds (paginated, server-side search + status filter — PAG-17)
router.get(
  '/refunds',
  checkPermission('fees', 'view'),
  validateZod(feeRefundsListQuerySchema, 'query'),
  async (req, res) => {
    try {
      const { page, limit } = req.query;
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
  }
);

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
      activeAmount: 0,
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
      if (status !== 'rejected') summary.activeAmount += row.total || 0;
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
router.get(
  '/refunds/:id',
  checkPermission('fees', 'view'),
  validateObjectIdParam('id'),
  async (req, res) => {
    try {
      const refund = await FeeRefund.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id })
      )
        .populate('studentId', 'name admissionId')
        .populate('classId', 'name section');

      if (!refund) return res.status(404).json({ error: 'Refund not found' });
      res.json(refund);
    } catch {
      res.status(500).json({ error: 'Failed to fetch refund' });
    }
  }
);

// Create refund request
router.post(
  '/refunds',
  checkPermission('fees', 'create'),
  validateZod(createRefundSchema),
  async (req, res) => {
    try {
      // F6: destructure the additional settlement-detail fields the Zod schema
      // already validates (transactionId, chequeNumber, bankName, accountNumber,
      // refundDate). Previously only 7 of the 13 schema fields were picked, so
      // settlement specifics were silently dropped and refundDate was forced to
      // today regardless of the backdated value the client sent.
      const {
        studentId,
        classId,
        academicYear,
        amount,
        reason,
        refundMode,
        originalPaymentId,
        remarks,
        transactionId,
        chequeNumber,
        bankName,
        accountNumber,
        refundDate,
      } = req.body;
      const schoolId = await resolveRequestSchoolId(req);
      const resolvedAcademicYear = await resolveAcademicYear(academicYear, schoolId);
      if (!resolvedAcademicYear) {
        return res.status(400).json({ error: 'A valid academic year is required.' });
      }

      // Validate referenced documents exist within the same school
      const [student, classDoc] = await Promise.all([
        Student.findOne(scopeBySchool(schoolId, { _id: studentId })),
        Class.findOne(scopeBySchool(schoolId, { _id: classId })),
      ]);
      if (!student) return res.status(400).json({ error: req.t('students:errors.notFound') });
      if (!classDoc) return res.status(400).json({ error: req.t('common:errors.classNotFound') });
      if (!originalPaymentId && String(student.classId) !== String(classDoc._id)) {
        return res.status(400).json({
          error: 'The selected class does not match the student’s current class',
          code: 'STUDENT_CLASS_MISMATCH',
        });
      }

      let originalPayment = null;
      if (originalPaymentId) {
        originalPayment = await FeePayment.findOne(
          scopeBySchool(schoolId, {
            _id: originalPaymentId,
            studentId,
            classId,
            academicYear: resolvedAcademicYear,
            status: 'completed',
          })
        );
        if (!originalPayment) {
          return res.status(400).json({
            error: 'Original payment is not eligible for this student, class, or academic year',
          });
        }
        const originalRefunds = await FeeRefund.aggregate([
          {
            $match: {
              schoolId: new mongoose.Types.ObjectId(schoolId),
              originalPaymentId: originalPayment._id,
              status: { $ne: 'rejected' },
            },
          },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]);
        const originalAvailable = Math.max(
          Number(originalPayment.amount || 0) - Number(originalRefunds[0]?.total || 0),
          0
        );
        if (amount > originalAvailable) {
          return res.status(400).json({
            error: `Refund amount (${amount}) exceeds the remaining amount on the original payment (${originalAvailable}).`,
            code: 'REFUND_EXCEEDS_ORIGINAL_PAYMENT',
          });
        }
      }

      // Validate refund amount does not exceed total paid minus already-refunded
      const [totalPaidResult, totalRefundedResult] = await Promise.all([
        FeePayment.aggregate([
          {
            $match: {
              schoolId: new mongoose.Types.ObjectId(schoolId),
              studentId: new mongoose.Types.ObjectId(studentId),
              academicYear: resolvedAcademicYear,
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
              academicYear: resolvedAcademicYear,
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
        academicYear: resolvedAcademicYear,
        amount,
        reason,
        refundMode,
        originalPaymentId: originalPaymentId || undefined,
        remarks: remarks || '',
        // F6: honor the client-supplied refund date (backdated refunds) and
        // persist settlement details the schema already validates.
        transactionId,
        chequeNumber,
        bankName,
        accountNumber,
        refundDate: refundDate || new Date().toISOString().split('T')[0],
        refundNumber,
        requestedBy: req.user?._id,
        status: 'pending',
        schoolId,
      });

      await refund.save();
      const populated = await FeeRefund.findOne(scopeBySchool(schoolId, { _id: refund._id }))
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
router.put(
  '/refunds/:id/approve',
  checkPermission('fees', 'edit'),
  validateObjectIdParam('id'),
  validateZod(approveRefundSchema),
  async (req, res) => {
    const schoolId = extractSchoolId(req.user?.schoolId);
    const session = await mongoose.startSession();
    let refund;
    try {
      await session.withTransaction(async () => {
        refund = await FeeRefund.findOne(scopeBySchool(schoolId, { _id: req.params.id })).session(
          session
        );
        if (!refund) {
          const error = new Error('Refund not found');
          error.code = 'REFUND_NOT_FOUND';
          throw error;
        }
        if (refund.status !== 'pending') {
          const error = new Error('Only pending refunds can be approved');
          error.code = 'REFUND_NOT_PENDING';
          throw error;
        }

        // A write to the student's ledger serializes concurrent approvals. If
        // two requests race, MongoDB retries one transaction after the other
        // commits, so the second request sees the newly reserved refund.
        const lockedLedger = await StudentFeeStructure.findOneAndUpdate(
          scopeBySchool(schoolId, {
            studentId: refund.studentId,
            academicYear: refund.academicYear,
          }),
          { $inc: { refundReservationVersion: 1 } },
          { new: true, session }
        );
        if (!lockedLedger) {
          const error = new Error('Student fee structure not found');
          error.code = 'FEE_STRUCTURE_NOT_FOUND';
          throw error;
        }

        const [totalPaidAgg, reservedRefundAgg] = await Promise.all([
          FeePayment.aggregate([
            {
              $match: {
                schoolId: new mongoose.Types.ObjectId(schoolId),
                studentId: refund.studentId,
                academicYear: refund.academicYear,
                status: 'completed',
              },
            },
            { $group: { _id: null, total: { $sum: '$amount' } } },
          ]).session(session),
          FeeRefund.aggregate([
            {
              $match: {
                schoolId: new mongoose.Types.ObjectId(schoolId),
                studentId: refund.studentId,
                academicYear: refund.academicYear,
                _id: { $ne: refund._id },
                status: { $in: ['approved', 'processed'] },
              },
            },
            { $group: { _id: null, total: { $sum: '$amount' } } },
          ]).session(session),
        ]);
        const currentTotalPaid = totalPaidAgg[0]?.total || 0;
        const reservedRefunds = reservedRefundAgg[0]?.total || 0;
        const availableToRefund = Math.max(currentTotalPaid - reservedRefunds, 0);
        if (refund.amount > availableToRefund) {
          const error = new Error(
            `Refund amount (${refund.amount}) exceeds the remaining refundable balance (${availableToRefund}).`
          );
          error.code = 'REFUND_EXCEEDS_PAID';
          throw error;
        }

        if (refund.originalPaymentId) {
          const originalPayment = await FeePayment.findOne(
            scopeBySchool(schoolId, {
              _id: refund.originalPaymentId,
              studentId: refund.studentId,
              academicYear: refund.academicYear,
              status: 'completed',
            })
          ).session(session);
          if (!originalPayment) {
            const error = new Error('Original payment is no longer refundable');
            error.code = 'ORIGINAL_PAYMENT_NOT_FOUND';
            throw error;
          }
          const originalReservedAgg = await FeeRefund.aggregate([
            {
              $match: {
                schoolId: new mongoose.Types.ObjectId(schoolId),
                originalPaymentId: originalPayment._id,
                _id: { $ne: refund._id },
                status: { $in: ['approved', 'processed'] },
              },
            },
            { $group: { _id: null, total: { $sum: '$amount' } } },
          ]).session(session);
          const originalAvailable = Math.max(
            Number(originalPayment.amount || 0) - Number(originalReservedAgg[0]?.total || 0),
            0
          );
          if (refund.amount > originalAvailable) {
            const error = new Error(
              `Refund amount (${refund.amount}) exceeds the remaining amount on the original payment (${originalAvailable}).`
            );
            error.code = 'REFUND_EXCEEDS_ORIGINAL_PAYMENT';
            throw error;
          }
        }

        refund.status = 'approved';
        refund.approvedBy = req.user?._id;
        refund.approvedAt = new Date();
        if (req.body.remarks) refund.remarks = req.body.remarks;
        await refund.save({ session });
      });

      try {
        await createFeePaymentAuditEntry({
          schoolId,
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
        // Audit failures must never block the main request.
      }

      res.json(refund);
    } catch (error) {
      logger.error({ err: error }, 'Failed to approve refund');
      const statusByCode = {
        REFUND_NOT_FOUND: 404,
        REFUND_NOT_PENDING: 400,
        FEE_STRUCTURE_NOT_FOUND: 409,
        ORIGINAL_PAYMENT_NOT_FOUND: 409,
        REFUND_EXCEEDS_PAID: 409,
        REFUND_EXCEEDS_ORIGINAL_PAYMENT: 409,
      };
      res.status(statusByCode[error.code] || 500).json({
        error: error.message || 'Failed to approve refund',
        ...(error.code && statusByCode[error.code] ? { code: error.code } : {}),
      });
    } finally {
      await session.endSession();
    }
  }
);

// Process refund
router.put(
  '/refunds/:id/process',
  checkPermission('fees', 'edit'),
  validateObjectIdParam('id'),
  validateZod(processRefundSchema),
  async (req, res) => {
    const schoolId = extractSchoolId(req.user?.schoolId);
    const session = await mongoose.startSession();
    let refund;
    try {
      await session.withTransaction(async () => {
        refund = await FeeRefund.findOne(scopeBySchool(schoolId, { _id: req.params.id })).session(
          session
        );
        if (!refund) {
          const notFound = new Error('Refund not found');
          notFound.code = 'REFUND_NOT_FOUND';
          throw notFound;
        }
        if (refund.status !== 'approved') {
          const invalidStatus = new Error('Only approved refunds can be processed');
          invalidStatus.code = 'REFUND_NOT_APPROVED';
          throw invalidStatus;
        }

        const settlement = {
          transactionId: req.body.transactionId || refund.transactionId,
          chequeNumber: req.body.chequeNumber || refund.chequeNumber,
          bankName: req.body.bankName || refund.bankName,
          accountNumber: req.body.accountNumber || refund.accountNumber,
        };
        const missingSettlement = [];
        if (
          ['online', 'card', 'upi', 'bank_transfer'].includes(refund.refundMode) &&
          !settlement.transactionId
        ) {
          missingSettlement.push('transactionId');
        }
        if (['cheque', 'dd'].includes(refund.refundMode) && !settlement.chequeNumber) {
          missingSettlement.push('chequeNumber');
        }
        if (['cheque', 'dd', 'bank_transfer'].includes(refund.refundMode) && !settlement.bankName) {
          missingSettlement.push('bankName');
        }
        if (refund.refundMode === 'bank_transfer' && !settlement.accountNumber) {
          missingSettlement.push('accountNumber');
        }
        if (missingSettlement.length) {
          const settlementError = new Error(
            `Settlement details are incomplete: ${missingSettlement.join(', ')}`
          );
          settlementError.code = 'REFUND_SETTLEMENT_DETAILS_REQUIRED';
          throw settlementError;
        }

        const feeStructure = await StudentFeeStructure.findOne(
          scopeBySchool(schoolId, {
            studentId: refund.studentId,
            academicYear: refund.academicYear,
          })
        ).session(session);
        if (!feeStructure) {
          const missingStructure = new Error('Student fee structure not found');
          missingStructure.code = 'FEE_STRUCTURE_NOT_FOUND';
          throw missingStructure;
        }

        const processedRefunds = await FeeRefund.aggregate([
          {
            $match: {
              schoolId: new mongoose.Types.ObjectId(schoolId),
              studentId: refund.studentId,
              academicYear: refund.academicYear,
              status: 'processed',
            },
          },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]).session(session);
        const completedPayments = await FeePayment.aggregate([
          {
            $match: {
              schoolId: new mongoose.Types.ObjectId(schoolId),
              studentId: refund.studentId,
              academicYear: refund.academicYear,
              status: 'completed',
            },
          },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]).session(session);
        const refundableBalance =
          Number(completedPayments[0]?.total || 0) - Number(processedRefunds[0]?.total || 0);
        if (refund.amount > refundableBalance || refund.amount > feeStructure.totalPaid) {
          const capError = new Error(
            `Refund amount (${refund.amount}) exceeds the remaining refundable balance (${Math.max(refundableBalance, 0)}).`
          );
          capError.code = 'REFUND_EXCEEDS_PAID';
          throw capError;
        }

        let remaining = Number(refund.amount);
        let originalPayment = null;
        if (refund.originalPaymentId) {
          originalPayment = await FeePayment.findOne(
            scopeBySchool(schoolId, {
              _id: refund.originalPaymentId,
              studentId: refund.studentId,
              classId: refund.classId,
              academicYear: refund.academicYear,
              status: 'completed',
            })
          ).session(session);
          if (!originalPayment) {
            const originalError = new Error('Original payment is no longer eligible for refund');
            originalError.code = 'ORIGINAL_PAYMENT_INVALID';
            throw originalError;
          }
          const previousOriginalRefunds = await FeeRefund.aggregate([
            {
              $match: {
                schoolId: new mongoose.Types.ObjectId(schoolId),
                originalPaymentId: originalPayment._id,
                _id: { $ne: refund._id },
                status: 'processed',
              },
            },
            { $group: { _id: null, total: { $sum: '$amount' } } },
          ]).session(session);
          const originalAvailable = Math.max(
            Number(originalPayment.amount || 0) - Number(previousOriginalRefunds[0]?.total || 0),
            0
          );
          if (refund.amount > originalAvailable) {
            const originalCapError = new Error(
              `Refund amount (${refund.amount}) exceeds the remaining amount on the original payment (${originalAvailable}).`
            );
            originalCapError.code = 'REFUND_EXCEEDS_ORIGINAL_PAYMENT';
            throw originalCapError;
          }
        }

        const reverseHead = (structureHead, requestedAmount) => {
          const reversible = Math.min(
            Number(structureHead.paidAmount || 0),
            Number(requestedAmount || 0),
            remaining
          );
          if (reversible <= 0) return;
          structureHead.paidAmount = Number(structureHead.paidAmount || 0) - reversible;
          const headStatus = computeFeeHeadStatus(structureHead);
          structureHead.balanceAmount = headStatus.balanceAmount;
          structureHead.status = headStatus.status;
          remaining -= reversible;
        };

        if (originalPayment?.feeHeads?.length) {
          for (const paymentHead of originalPayment.feeHeads) {
            if (remaining <= 0) break;
            const structureHead = feeStructure.feeHeads.find(
              (head) =>
                String(head.feeHeadId) === String(paymentHead.feeHeadId) ||
                (!paymentHead.feeHeadId && head.name === paymentHead.name)
            );
            if (structureHead) reverseHead(structureHead, paymentHead.amount);
          }
        } else {
          for (const structureHead of feeStructure.feeHeads) {
            if (remaining <= 0) break;
            reverseHead(structureHead, remaining);
          }
        }
        if (feeStructure.feeHeads.length > 0 && remaining > 0.009) {
          const distributionError = new Error(
            'Refund cannot be reconciled with the student’s paid fee heads.'
          );
          distributionError.code = 'REFUND_HEAD_RECONCILIATION_FAILED';
          throw distributionError;
        }

        if (
          originalPayment?.installmentIndex !== undefined &&
          originalPayment?.installmentIndex !== null
        ) {
          const installment = feeStructure.installments?.[originalPayment.installmentIndex];
          if (!installment) {
            const installmentError = new Error(
              'Refund cannot be reconciled because the original installment is missing.'
            );
            installmentError.code = 'REFUND_INSTALLMENT_RECONCILIATION_FAILED';
            throw installmentError;
          }
          installment.paidAmount = Math.max(
            Number(installment.paidAmount || 0) - Number(refund.amount),
            0
          );
          installment.balanceAmount = Math.max(
            Number(installment.amount || 0) - Number(installment.paidAmount || 0),
            0
          );
          installment.status =
            installment.balanceAmount <= 0
              ? 'paid'
              : installment.paidAmount > 0
                ? 'partial'
                : installment.dueDate && installment.dueDate < new Date()
                  ? 'overdue'
                  : 'pending';
        }

        feeStructure.totalPaid = Number(feeStructure.totalPaid || 0) - Number(refund.amount);
        const totals = computeFeeBalance(feeStructure);
        feeStructure.totalBalance = totals.totalBalance;
        feeStructure.overallStatus = totals.overallStatus;
        await feeStructure.save({ session });
        await syncStudentFeeDetails(refund.studentId, feeStructure, session);

        refund.status = 'processed';
        refund.processedBy = req.user?._id || req.user?.id;
        refund.processedAt = new Date();
        for (const field of [
          'transactionId',
          'chequeNumber',
          'bankName',
          'accountNumber',
          'remarks',
        ]) {
          if (req.body[field] !== undefined) refund[field] = req.body[field];
        }
        await refund.save({ session });
      });

      try {
        await createFeePaymentAuditEntry({
          schoolId,
          entityType: 'FeePayment',
          entityId: refund._id,
          action: 'refund_processed',
          performedBy: req.user?._id || req.user?.id,
          performedByName: req.user?.name || req.user?.email || null,
          studentId: refund.studentId,
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
        // Audit transport failures are outside the financial transaction.
      }

      res.json(refund);
    } catch (error) {
      if (error.code === 'REFUND_NOT_FOUND') {
        return res.status(404).json({ error: error.message });
      }
      if (
        [
          'REFUND_NOT_APPROVED',
          'REFUND_EXCEEDS_PAID',
          'ORIGINAL_PAYMENT_INVALID',
          'REFUND_EXCEEDS_ORIGINAL_PAYMENT',
          'REFUND_HEAD_RECONCILIATION_FAILED',
          'REFUND_INSTALLMENT_RECONCILIATION_FAILED',
          'REFUND_SETTLEMENT_DETAILS_REQUIRED',
        ].includes(error.code)
      ) {
        return res.status(400).json({ error: error.message, code: error.code });
      }
      if (error.code === 'FEE_STRUCTURE_NOT_FOUND') {
        return res.status(409).json({ error: error.message, code: error.code });
      }
      logger.error({ err: error }, 'Failed to process refund');
      res.status(500).json({ error: 'Failed to process refund' });
    } finally {
      await session.endSession();
    }
  }
);

// Reject refund
router.put(
  '/refunds/:id/reject',
  checkPermission('fees', 'edit'),
  validateObjectIdParam('id'),
  validateZod(rejectRefundSchema),
  async (req, res) => {
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
    } catch {
      res.status(500).json({ error: 'Failed to reject refund' });
    }
  }
);

// Update refund (only pending refunds can be edited)
router.put(
  '/refunds/:id',
  checkPermission('fees', 'edit'),
  validateObjectIdParam('id'),
  validateZod(updateRefundSchema),
  async (req, res) => {
    try {
      const refund = await FeeRefund.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id })
      );
      if (!refund) return res.status(404).json({ error: 'Refund not found' });
      if (refund.status !== 'pending') {
        return res.status(400).json({ error: 'Only pending refunds can be updated' });
      }

      const { amount, reason, refundMode, remarks } = req.body;
      if (amount !== undefined) {
        const schoolId = extractSchoolId(req.user?.schoolId);
        const [payments, otherRefunds] = await Promise.all([
          FeePayment.aggregate([
            {
              $match: {
                schoolId: new mongoose.Types.ObjectId(schoolId),
                studentId: refund.studentId,
                academicYear: refund.academicYear,
                status: 'completed',
              },
            },
            { $group: { _id: null, total: { $sum: '$amount' } } },
          ]),
          FeeRefund.aggregate([
            {
              $match: {
                schoolId: new mongoose.Types.ObjectId(schoolId),
                studentId: refund.studentId,
                academicYear: refund.academicYear,
                _id: { $ne: refund._id },
                status: { $ne: 'rejected' },
              },
            },
            { $group: { _id: null, total: { $sum: '$amount' } } },
          ]),
        ]);
        const available = Math.max(
          Number(payments[0]?.total || 0) - Number(otherRefunds[0]?.total || 0),
          0
        );
        if (amount > available) {
          return res.status(400).json({
            error: `Refund amount (${amount}) exceeds the remaining refundable balance (${available}).`,
            code: 'REFUND_EXCEEDS_PAID',
          });
        }
        if (refund.originalPaymentId) {
          const [originalPayment, originalRefunds] = await Promise.all([
            FeePayment.findOne(
              scopeBySchool(schoolId, {
                _id: refund.originalPaymentId,
                studentId: refund.studentId,
                academicYear: refund.academicYear,
                status: 'completed',
              })
            ).lean(),
            FeeRefund.aggregate([
              {
                $match: {
                  schoolId: new mongoose.Types.ObjectId(schoolId),
                  originalPaymentId: refund.originalPaymentId,
                  _id: { $ne: refund._id },
                  status: { $ne: 'rejected' },
                },
              },
              { $group: { _id: null, total: { $sum: '$amount' } } },
            ]),
          ]);
          if (!originalPayment) {
            return res.status(409).json({
              error: 'Original payment is no longer eligible for refund',
              code: 'ORIGINAL_PAYMENT_INVALID',
            });
          }
          const originalAvailable = Math.max(
            Number(originalPayment.amount || 0) - Number(originalRefunds[0]?.total || 0),
            0
          );
          if (amount > originalAvailable) {
            return res.status(400).json({
              error: `Refund amount (${amount}) exceeds the remaining amount on the original payment (${originalAvailable}).`,
              code: 'REFUND_EXCEEDS_ORIGINAL_PAYMENT',
            });
          }
        }
      }
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

      const populated = await FeeRefund.findOne(
        scopeBySchool(req.user?.schoolId, { _id: refund._id })
      )
        .populate('studentId', 'name admissionId')
        .populate('classId', 'name section');

      res.json(populated);
    } catch (error) {
      logger.error({ err: error }, 'Error updating refund');
      res.status(500).json({ error: 'Failed to update refund' });
    }
  }
);

// Delete refund (only pending refunds can be deleted)
router.delete(
  '/refunds/:id',
  checkPermission('fees', 'delete'),
  validateObjectIdParam('id'),
  async (req, res) => {
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

      await FeeRefund.deleteOne(scopeBySchool(req.user?.schoolId, { _id: refund._id }));

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
  }
);

// ─── Class-wise fee summary ────────────────────────────────────────────────
// Aggregates StudentFeeStructure + Class into section-level rows, each tagged
// with its parent class. The FE renders either a flat grid (one row per
// class+section) or a grouped list (one row per class that expands to its
// sections) from this single shape.
router.get('/class-summary', checkPermission('fees', 'view'), async (req, res) => {
  try {
    const parsed = feeClassSummaryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const academicYear = await resolveAcademicYear(parsed.data.academicYear, req.user?.schoolId);
    const schoolObjectId = new mongoose.Types.ObjectId(req.user.schoolId);
    const classFilter = parsed.data.classId
      ? new mongoose.Types.ObjectId(parsed.data.classId)
      : null;

    // Active classes for the school+year (one doc per section).
    const classQuery = {
      schoolId: req.user.schoolId,
      academicYear,
      isDeleted: { $ne: true },
    };
    if (classFilter) classQuery._id = classFilter;
    const classes = await Class.find(classQuery).lean();

    // Aggregate SFS by classId. Aggregation pipelines don't auto-cast strings
    // to ObjectId, so we cast schoolId/classId explicitly.
    const sfsByClass = await StudentFeeStructure.aggregate([
      {
        $match: {
          schoolId: schoolObjectId,
          academicYear,
          ...(classFilter ? { classId: classFilter } : {}),
        },
      },
      {
        $lookup: {
          from: 'students',
          localField: 'studentId',
          foreignField: '_id',
          as: 'student',
        },
      },
      {
        $unwind: '$student',
      },
      {
        $match: {
          'student.isDeleted': { $ne: true },
          'student.status': 'active',
        },
      },
      {
        $group: {
          _id: '$classId',
          feeConfiguredCount: { $sum: 1 },
          totalExpected: { $sum: '$totalFee' },
          totalCollected: { $sum: '$totalPaid' },
          totalBalance: { $sum: '$totalBalance' },
          overdueCount: {
            $sum: { $cond: [{ $eq: ['$overallStatus', 'overdue'] }, 1, 0] },
          },
          partialCount: {
            $sum: { $cond: [{ $eq: ['$overallStatus', 'partial'] }, 1, 0] },
          },
          pendingCount: {
            $sum: { $cond: [{ $eq: ['$overallStatus', 'pending'] }, 1, 0] },
          },
          paidCount: {
            $sum: { $cond: [{ $eq: ['$overallStatus', 'paid'] }, 1, 0] },
          },
        },
      },
    ]);
    const sfsMap = new Map(sfsByClass.map((r) => [String(r._id), r]));

    // Enrollment is independent from fee setup. Counting only SFS rows made
    // classes with real students appear as “No students” before fee structures
    // were assigned, hiding the actual setup gap from administrators.
    const enrollmentByClass = await Student.aggregate([
      {
        $match: {
          schoolId: schoolObjectId,
          academicYear,
          status: 'active',
          isDeleted: { $ne: true },
          ...(classFilter ? { classId: classFilter } : {}),
        },
      },
      { $group: { _id: '$classId', studentCount: { $sum: 1 } } },
    ]);
    const enrollmentMap = new Map(
      enrollmentByClass.map((row) => [String(row._id), row.studentCount || 0])
    );

    const rows = classes.map((cls) => {
      const agg = sfsMap.get(String(cls._id)) || {};
      return {
        classId: cls._id,
        className: cls.name,
        classOrder: Number.parseInt(String(cls.name || '').replace(/[^0-9]/g, ''), 10) || 999,
        section: cls.section || '',
        studentCount: enrollmentMap.get(String(cls._id)) || 0,
        feeConfiguredCount: agg.feeConfiguredCount || 0,
        unconfiguredStudentCount: Math.max(
          (enrollmentMap.get(String(cls._id)) || 0) - (agg.feeConfiguredCount || 0),
          0
        ),
        totalExpected: agg.totalExpected || 0,
        totalCollected: agg.totalCollected || 0,
        totalBalance: agg.totalBalance || 0,
        overdueCount: agg.overdueCount || 0,
        partialCount: agg.partialCount || 0,
        pendingCount: agg.pendingCount || 0,
        fullyPaidCount: agg.paidCount || 0,
      };
    });

    // Numeric class then section — stable order for both list modes.
    rows.sort((a, b) => {
      if (a.classOrder !== b.classOrder) return a.classOrder - b.classOrder;
      return String(a.section).localeCompare(String(b.section));
    });

    res.json(rows);
  } catch (error) {
    logger.error({ err: error }, 'Error building fee class-summary');
    res.status(500).json({ error: 'Failed to build class summary' });
  }
});

// ─── Invoice PDF (single payment receipt) ──────────────────────────────────
router.get(
  '/payments/:id/invoice.pdf',
  checkPermission('fees', 'view'),
  validateObjectIdParam('id'),
  async (req, res) => {
    try {
      const payment = await FeePayment.findOne({
        _id: req.params.id,
        schoolId: req.user.schoolId,
      }).lean();
      if (!payment) {
        return res.status(404).json({ error: 'Payment not found' });
      }
      const doc = await generateFeeInvoicePdf({
        studentId: payment.studentId,
        schoolId: req.user.schoolId,
        academicYear: payment.academicYear,
        paymentId: payment._id,
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="receipt-${payment.receiptNumber || payment._id}.pdf"`
      );
      doc.pipe(res);
    } catch (error) {
      logger.error({ err: error }, 'Error generating fee invoice PDF');
      res.status(error.status || 500).json({ error: 'Failed to generate invoice' });
    }
  }
);

// ─── Invoice JSON (single payment) ─────────────────────────────────────────
router.get(
  '/payments/:id/invoice',
  checkPermission('fees', 'view'),
  validateObjectIdParam('id'),
  async (req, res) => {
    try {
      const payment = await FeePayment.findOne({
        _id: req.params.id,
        schoolId: req.user.schoolId,
      }).lean();
      if (!payment) {
        return res.status(404).json({ error: 'Payment not found' });
      }
      const data = await buildFeeInvoiceData({
        studentId: payment.studentId,
        schoolId: req.user.schoolId,
        academicYear: payment.academicYear,
        paymentId: payment._id,
      });
      res.json(data);
    } catch (error) {
      logger.error({ err: error }, 'Error building fee invoice JSON');
      res.status(error.status || 500).json({ error: 'Failed to build invoice' });
    }
  }
);

// ─── Send invoice to parent ────────────────────────────────────────────────
router.post(
  '/payments/:id/send-invoice',
  checkPermission('fees', 'edit'),
  validateObjectIdParam('id'),
  validateZod(sendInvoiceSchema),
  async (req, res) => {
    try {
      const channels = [...new Set(req.body.channels)];

      const payment = await FeePayment.findOne({
        _id: req.params.id,
        schoolId: req.user.schoolId,
      }).lean();
      if (!payment) {
        return res.status(404).json({ error: 'Payment not found' });
      }

      const student = await Student.findOne({
        _id: payment.studentId,
        schoolId: req.user.schoolId,
        isDeleted: { $ne: true },
      })
        .select('name parents')
        .lean();
      if (!student) {
        return res.status(404).json({ error: 'Student not found' });
      }

      const parents = Array.isArray(student.parents) ? student.parents : [];
      const emails = [
        ...new Set(parents.map((parent) => parent.email?.trim().toLowerCase()).filter(Boolean)),
      ];
      const phones = [...new Set(parents.map((parent) => parent.phone?.trim()).filter(Boolean))];
      const whatsappPhones = [
        ...new Set(
          parents
            .filter((parent) => parent.isWhatsapp !== false)
            .map((parent) => parent.phone?.trim())
            .filter(Boolean)
        ),
      ];
      const parentIds = [
        ...new Set(
          parents
            .map((parent) => parent.parentId)
            .filter(Boolean)
            .map(String)
        ),
      ];

      const amount = new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
      }).format(Number(payment.amount) || 0);
      const receipt = payment.receiptNumber || String(payment._id);
      const subject = `Fee receipt ${receipt} for ${student.name}`;
      const message = `Payment of ${amount} received for ${student.name}. Receipt: ${receipt}.`;
      const results = {};

      if (channels.includes('email')) {
        if (emails.length === 0) {
          results.email = { success: false, error: 'No parent email address is stored' };
        } else {
          const pdf = await pdfStreamToBuffer(
            await generateFeeInvoicePdf({
              studentId: payment.studentId,
              schoolId: req.user.schoolId,
              academicYear: payment.academicYear,
              paymentId: payment._id,
            })
          );
          const emailResults = await Promise.all(
            emails.map((to) =>
              sendEmail({
                to,
                subject,
                schoolId: req.user.schoolId,
                html: `<p>Dear Parent,</p><p>${escapeHtml(message)}</p><p>Your PDF receipt is attached.</p>`,
                text: `Dear Parent,\n\n${message}\n\nYour PDF receipt is attached.`,
                attachments: [
                  {
                    filename: `receipt-${receipt}.pdf`,
                    content: pdf,
                    contentType: 'application/pdf',
                  },
                ],
              })
            )
          );
          results.email = {
            success: emailResults.some((result) => result?.success),
            attempted: emails.length,
            delivered: emailResults.filter((result) => result?.success).length,
            errors: emailResults
              .filter((result) => !result?.success)
              .map((result) => result?.error || result?.reason || 'Email delivery failed'),
          };
        }
      }

      if (channels.includes('sms')) {
        if (phones.length === 0) {
          results.sms = { success: false, error: 'No parent phone number is stored' };
        } else {
          const smsResults = await Promise.all(phones.map((to) => sendSMS(to, message)));
          results.sms = {
            success: smsResults.some((result) => result?.success),
            attempted: phones.length,
            delivered: smsResults.filter((result) => result?.success).length,
            errors: smsResults
              .filter((result) => !result?.success)
              .map((result) => result?.error || 'SMS delivery failed'),
          };
        }
      }

      if (channels.includes('whatsapp')) {
        if (whatsappPhones.length === 0) {
          results.whatsapp = {
            success: false,
            error: 'No WhatsApp-enabled parent phone is stored',
          };
        } else {
          const whatsappResults = await Promise.all(
            whatsappPhones.map((to) =>
              sendWhatsAppMessage(to, 'fee_payment_receipt', {
                student_name: student.name,
                amount,
                receipt_number: receipt,
              })
            )
          );
          results.whatsapp = {
            success: whatsappResults.some((result) => result?.success),
            attempted: whatsappPhones.length,
            delivered: whatsappResults.filter((result) => result?.success).length,
            errors: whatsappResults
              .filter((result) => !result?.success)
              .map((result) => result?.error || 'WhatsApp delivery failed'),
          };
        }
      }

      if (channels.includes('push')) {
        if (parentIds.length === 0) {
          results.push = { success: false, error: 'No linked parent account is stored' };
        } else {
          const notifications = parentIds.map((userId) => ({
            schoolId: req.user.schoolId,
            userId,
            userModel: 'Parent',
            type: 'payment',
            title: subject,
            message,
            actionUrl: '/fees',
            actionType: 'navigate',
            relatedId: payment._id,
            relatedType: 'FeePayment',
            channels: [{ type: 'inapp', status: 'sent', sentAt: new Date() }],
          }));
          await Notification.insertMany(notifications);
          results.push = { success: true, delivered: notifications.length };
        }
      }

      const delivered = Object.entries(results)
        .filter(([, result]) => result.success)
        .map(([channel]) => channel);
      const failed = channels.filter((channel) => !results[channel]?.success);
      const ok = delivered.length > 0;

      await createFeePaymentAuditEntry({
        schoolId: req.user.schoolId,
        entityType: 'FeePayment',
        entityId: payment._id,
        studentId: payment.studentId,
        action: 'invoice_sent',
        performedBy: req.user.userId || req.user.id,
        context: {
          receiptNumber: payment.receiptNumber,
          amount: payment.amount,
          deliveryChannels: channels,
          deliveryResults: results,
        },
        status: ok ? 'success' : 'failure',
        errorMessage: ok ? undefined : 'All requested delivery channels failed',
        req,
      });

      logger.info({ paymentId: payment._id, delivered, failed }, 'Fee invoice delivery completed');
      return res.status(ok ? (failed.length ? 207 : 200) : 502).json({
        ok,
        delivered,
        failed,
        results,
        message: ok
          ? `Invoice delivered through ${delivered.join(', ')}`
          : 'Invoice could not be delivered through any requested channel',
      });
    } catch (error) {
      logger.error({ err: error }, 'Error sending fee invoice');
      res.status(500).json({ error: 'Failed to send invoice' });
    }
  }
);

export default router;
