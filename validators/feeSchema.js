import { z } from 'zod';
import { objectId, optionalObjectId, optionalString, academicYear } from './zodHelpers.js';

const paymentModeEnum = z.enum(['cash', 'cheque', 'dd', 'online', 'card', 'upi', 'bank_transfer']);
const invoiceChannelEnum = z.enum(['email', 'sms', 'whatsapp', 'push']);

export const sendInvoiceSchema = z
  .object({
    channels: z.array(invoiceChannelEnum).min(1).max(4).default(['email']),
  })
  .strict();

export const emptyFeeActionSchema = z.object({}).strict();

export const feeTemplateListQuerySchema = z
  .object({
    academicYear: academicYear.optional(),
    status: z.enum(['active', 'inactive', 'all']).default('active'),
  })
  .strict();

// ─── FEE HEAD BREAKDOWN ──────────────────────────────────────────
const feeHeadBreakdownSchema = z
  .object({
    feeHeadId: objectId.optional(),
    name: z.string().min(1, 'Fee head name is required').optional(),
    amount: z.number().min(1, 'Fee head amount must be at least 1'),
  })
  .strict();

const ONLINE_PAYMENT_MODES = ['online', 'card', 'upi', 'bank_transfer'];
const dateQuery = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const feePaymentsListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    studentId: objectId.optional(),
    classId: objectId.optional(),
    academicYear: academicYear.optional(),
    status: z.enum(['completed', 'pending', 'failed', 'cancelled']).optional(),
    paymentMode: paymentModeEnum.optional(),
    startDate: dateQuery.optional(),
    endDate: dateQuery.optional(),
    search: z.string().trim().max(100).optional(),
  })
  .strict()
  .refine((value) => !value.startDate || !value.endDate || value.startDate <= value.endDate, {
    path: ['endDate'],
    message: 'endDate must be on or after startDate',
  });

export const feeRefundsListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    studentId: objectId.optional(),
    status: z.enum(['pending', 'approved', 'processed', 'rejected']).optional(),
    academicYear: academicYear.optional(),
    search: z.string().trim().max(100).optional(),
  })
  .strict();

export const feeAuditListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    studentId: objectId.optional(),
    action: z.string().trim().min(1).max(100).optional(),
    entityType: z.string().trim().min(1).max(100).optional(),
    startDate: dateQuery.optional(),
    endDate: dateQuery.optional(),
  })
  .strict()
  .refine((value) => !value.startDate || !value.endDate || value.startDate <= value.endDate, {
    path: ['endDate'],
    message: 'endDate must be on or after startDate',
  });

// ─── CREATE FEE PAYMENT ─────────────────────────────────────────
export const createFeePaymentSchema = z
  .object({
    studentId: objectId,
    studentName: z.string().max(100).nullish().or(z.literal('')),
    classId: objectId,
    academicYear: academicYear.optional(),
    paymentDate: dateQuery.optional(),
    amount: z
      .number()
      .min(1, 'Payment amount must be at least 1')
      .max(10000000, 'Payment amount seems too large'),
    paymentMode: paymentModeEnum.default('cash'),
    feeHeads: z.array(feeHeadBreakdownSchema).optional().default([]),
    installmentIndex: z.number().int().min(0).max(24).optional(),
    transactionId: optionalString(100),
    chequeNumber: optionalString(50),
    bankName: optionalString(100),
    // Payment gateway verification fields (required for online/card/upi when gateway is configured)
    gatewayOrderId: optionalString(200),
    gatewaySignature: optionalString(500),
    remarks: optionalString(500),
    idempotencyKey: z.string().trim().min(8).max(100).optional(),
  })
  .strict()
  .refine(
    (data) => !ONLINE_PAYMENT_MODES.includes(data.paymentMode) || Boolean(data.transactionId),
    {
      message: 'transactionId is required for online, card, and upi payments',
      path: ['transactionId'],
    }
  )
  .refine((data) => !['cheque', 'dd'].includes(data.paymentMode) || Boolean(data.chequeNumber), {
    message: 'chequeNumber is required for cheque and demand draft payments',
    path: ['chequeNumber'],
  })
  .refine((data) => !['cheque', 'dd'].includes(data.paymentMode) || Boolean(data.bankName), {
    message: 'bankName is required for cheque and demand draft payments',
    path: ['bankName'],
  })
  .refine(
    (data) => {
      if (!Array.isArray(data.feeHeads) || data.feeHeads.length === 0) return true;
      const headSum = data.feeHeads.reduce((s, h) => s + (h.amount || 0), 0);
      return Math.abs(headSum - data.amount) < 0.01;
    },
    {
      message: 'Sum of fee head amounts must equal the total payment amount',
      path: ['amount'],
    }
  );

// ─── RECORD STUDENT FEE PAYMENT ─────────────────────────────────
const feeHeadPaymentSchema = z
  .object({
    feeHeadId: objectId,
    name: z.string().trim().min(1).max(200).optional(),
    amount: z
      .number()
      .min(1, 'Fee head payment amount must be at least 1')
      .max(10000000, 'Fee head payment amount seems too large'),
  })
  .strict();

export const studentFeePaymentSchema = z
  .object({
    amount: z
      .number()
      .min(1, 'Payment amount must be at least 1')
      .max(10000000, 'Payment amount seems too large'),
    feeHeadPayments: z.array(feeHeadPaymentSchema).optional(),
    paymentMode: paymentModeEnum.default('cash'),
    transactionId: optionalString(100),
    chequeNumber: optionalString(50),
    bankName: optionalString(100),
    remarks: optionalString(500),
    academicYear: academicYear.optional(),
    idempotencyKey: z.string().max(100).optional(),
  })
  .strict()
  .refine(
    (data) =>
      !data.feeHeadPayments?.length ||
      Math.abs(data.feeHeadPayments.reduce((sum, item) => sum + item.amount, 0) - data.amount) <
        0.01,
    { path: ['feeHeadPayments'], message: 'Fee-head allocations must equal the payment amount' }
  )
  .refine((data) => !['cheque', 'dd'].includes(data.paymentMode) || Boolean(data.chequeNumber), {
    path: ['chequeNumber'],
    message: 'chequeNumber is required for cheque and demand draft payments',
  })
  .refine((data) => !['cheque', 'dd'].includes(data.paymentMode) || Boolean(data.bankName), {
    path: ['bankName'],
    message: 'bankName is required for cheque and demand draft payments',
  })
  .refine(
    (data) => !ONLINE_PAYMENT_MODES.includes(data.paymentMode) || Boolean(data.transactionId),
    {
      path: ['transactionId'],
      message: 'transactionId is required for online, card, upi, and bank transfer payments',
    }
  );

// ─── UPDATE DISCOUNT ─────────────────────────────────────────────
export const updateDiscountSchema = z
  .object({
    discountAmount: z
      .number()
      .min(0, 'Discount amount cannot be negative')
      .max(10000000, 'Discount amount seems too large'),
    discountReason: optionalString(500),
    academicYear: academicYear.optional(),
  })
  .strict();

// ─── DEFAULTERS LIST QUERY ──────────────────────────────────────
export const defaultersQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().max(100).optional(),
    minDaysOverdue: z.coerce.number().int().min(0).optional(),
    academicYear: academicYear.optional(),
  })
  .strict();

export const studentFeeBatchSchema = z
  .object({
    studentIds: z.array(objectId).min(1).max(100),
    academicYear: academicYear.optional(),
  })
  .strict();

export const initializeStudentFeeSchema = z
  .object({
    academicYear: academicYear.optional(),
  })
  .strict();

export const studentFeesAllQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    academicYear: academicYear.optional(),
    classId: objectId.optional(),
    status: z.enum(['pending', 'partial', 'paid', 'overdue']).optional(),
    search: z.string().trim().max(100).optional(),
  })
  .strict();

export const reconcileStudentFeesSchema = z
  .object({
    academicYear: academicYear.optional(),
  })
  .strict();

// ─── PAYMENTS KPI SUMMARY QUERY (PAG-01) ────────────────────────
// Backs GET /fees/payments/summary, which computes the Fees-page KPIs
// (collected today / outstanding total / students owing) over the FULL
// dataset server-side instead of from the first page of payment rows.
// `date` is the client's local calendar day (YYYY-MM-DD) so "collected
// today" matches the cashier's timezone, not the server's.
export const paymentsSummaryQuerySchema = z
  .object({
    academicYear: academicYear.optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format')
      .optional(),
  })
  .strict();

export const studentTotalPaidQuerySchema = z
  .object({
    studentId: objectId,
    academicYear: academicYear.optional(),
  })
  .strict();

// ─── REFUNDS SUMMARY QUERY (PAG-17) ─────────────────────────────
// Backs GET /fees/refunds/summary, which computes the Refunds-page KPI cards
// (total amount + per-status counts) over the FULL filtered dataset
// server-side instead of from the loaded page of rows. Mirrors the list
// route's filter surface (studentId / status / academicYear / search) so the
// summary always matches what the list is paginating over.
export const refundsSummaryQuerySchema = z
  .object({
    studentId: objectId.optional(),
    status: z.string().max(50).optional(),
    academicYear: academicYear.optional(),
    search: z.string().max(100).optional(),
  })
  .strict();

export const feeClassSummaryQuerySchema = z
  .object({
    academicYear: academicYear.optional(),
    classId: objectId.optional(),
  })
  .strict();

// ─── FEE TEMPLATE ──────────────────────────────────────────────
const feeTemplateFeeHeadSchema = z
  .object({
    name: z.string().min(1, 'Fee head name is required').max(200),
    category: z
      .enum(['Academic', 'Transport', 'Extra-curricular', 'Hostel', 'Other'])
      .default('Academic'),
    amount: z.number().min(0, 'Amount cannot be negative'),
    frequency: z.enum(['monthly', 'quarterly', 'term', 'yearly', 'one-time']).default('yearly'),
    mandatory: z.boolean().default(true),
    applicableTerms: z.array(z.number()).optional(),
    dueDay: z.number().int().min(1).max(31).default(10),
    refundable: z.boolean().default(false),
  })
  .strict();

const feeTemplateDiscountSchema = z
  .object({
    name: z.string().max(200).optional(),
    percentage: z.number().min(0).max(100).optional(),
    conditions: z.string().max(500).optional(),
  })
  .strict();

const feeTemplateApplicableForSchema = z
  .object({
    classGrade: z.string().max(20).optional(),
    applicable: z.boolean().optional(),
  })
  .strict();

export const createFeeTemplateSchema = z
  .object({
    name: z.string().min(1, 'Template name is required').max(200).trim(),
    description: optionalString(500),
    section: z.string().min(1, 'Section is required').max(50).trim(),
    applicableFor: z.array(feeTemplateApplicableForSchema).optional(),
    feeHeads: z.array(feeTemplateFeeHeadSchema).optional().default([]),
    totalAnnualFee: z.number().min(0, 'Total annual fee cannot be negative'),
    discounts: z.array(feeTemplateDiscountSchema).optional().default([]),
    isActive: z.boolean().default(true),
    academicYear: academicYear.optional(),
  })
  .strict();

export const updateFeeTemplateSchema = z
  .object({
    name: z.string().min(1, 'Template name is required').max(200).trim().optional(),
    description: optionalString(500),
    section: z.string().min(1).max(50).trim().optional(),
    applicableFor: z.array(feeTemplateApplicableForSchema).optional(),
    feeHeads: z.array(feeTemplateFeeHeadSchema).optional(),
    totalAnnualFee: z.number().min(0, 'Total annual fee cannot be negative').optional(),
    discounts: z.array(feeTemplateDiscountSchema).optional(),
    isActive: z.boolean().optional(),
    academicYear: academicYear.optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one template field must be provided',
  });

// ─── CREATE REFUND ───────────────────────────────────────────────
export const createRefundSchema = z
  .object({
    studentId: objectId,
    classId: objectId,
    academicYear: academicYear.optional(),
    amount: z
      .number()
      .min(1, 'Refund amount must be at least 1')
      .max(10000000, 'Refund amount seems too large'),
    reason: z
      .string()
      .min(10, 'Refund reason must be at least 10 characters')
      .max(500, 'Refund reason must not exceed 500 characters'),
    refundDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'refundDate must be in YYYY-MM-DD format')
      .optional(),
    refundMode: paymentModeEnum,
    originalPaymentId: optionalObjectId,
    transactionId: optionalString(100),
    chequeNumber: optionalString(50),
    bankName: optionalString(100),
    accountNumber: optionalString(50),
    remarks: optionalString(500),
  })
  .strict()
  .refine((data) => !['cheque', 'dd'].includes(data.refundMode) || Boolean(data.chequeNumber), {
    path: ['chequeNumber'],
    message: 'Cheque or demand draft number is required',
  })
  .refine(
    (data) =>
      !['cheque', 'dd', 'bank_transfer'].includes(data.refundMode) || Boolean(data.bankName),
    { path: ['bankName'], message: 'Bank name is required for this refund mode' }
  )
  .refine((data) => data.refundMode !== 'bank_transfer' || Boolean(data.accountNumber), {
    path: ['accountNumber'],
    message: 'Account number is required for bank transfers',
  })
  .refine(
    (data) =>
      !['online', 'card', 'upi', 'bank_transfer'].includes(data.refundMode) ||
      Boolean(data.transactionId),
    { path: ['transactionId'], message: 'Transaction ID is required for electronic refunds' }
  );

// ─── PAYMENT / REFUND WORKFLOW MUTATIONS ──────────────────────
// Financial records are deliberately narrow: amount/student/class changes
// require cancel + re-record so the original ledger remains auditable.
export const updateFeePaymentSchema = z
  .object({
    paymentMode: paymentModeEnum.optional(),
    transactionId: optionalString(100),
    chequeNumber: optionalString(50),
    bankName: optionalString(100),
    remarks: optionalString(500),
    paymentDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'paymentDate must be in YYYY-MM-DD format')
      .optional(),
  })
  .strict();

export const approveRefundSchema = z.object({ remarks: optionalString(500) }).strict();

export const processRefundSchema = z
  .object({
    transactionId: optionalString(100),
    chequeNumber: optionalString(50),
    bankName: optionalString(100),
    accountNumber: optionalString(50),
    remarks: optionalString(500),
  })
  .strict();

export const rejectRefundSchema = z
  .object({
    rejectionReason: z.string().trim().min(10).max(500),
  })
  .strict();

export const updateRefundSchema = z
  .object({
    amount: z.number().min(1).max(10000000).optional(),
    reason: z.string().trim().min(10).max(500).optional(),
    refundMode: paymentModeEnum.optional(),
    remarks: optionalString(500),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one refund field must be provided',
  });
