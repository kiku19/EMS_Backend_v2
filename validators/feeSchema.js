import { z } from 'zod';
import { objectId, optionalObjectId, optionalString, academicYear } from './zodHelpers.js';

const paymentModeEnum = z.enum(['cash', 'cheque', 'online', 'card', 'upi', 'bank_transfer']);

// ─── FEE HEAD BREAKDOWN ──────────────────────────────────────────
const feeHeadBreakdownSchema = z
  .object({
    feeHeadId: objectId.optional(),
    name: z.string().min(1, 'Fee head name is required').optional(),
    amount: z.number().min(1, 'Fee head amount must be at least 1'),
  })
  .passthrough();

const ONLINE_PAYMENT_MODES = ['online', 'card', 'upi', 'bank_transfer'];

// ─── CREATE FEE PAYMENT ─────────────────────────────────────────
export const createFeePaymentSchema = z
  .object({
    studentId: objectId,
    studentName: z.string().max(100).nullish().or(z.literal('')),
    classId: objectId,
    academicYear: academicYear.optional(),
    paymentDate: z.string().optional(),
    amount: z
      .number()
      .min(1, 'Payment amount must be at least 1')
      .max(10000000, 'Payment amount seems too large'),
    paymentMode: paymentModeEnum.default('cash'),
    feeHeads: z.array(feeHeadBreakdownSchema).optional().default([]),
    transactionId: optionalString(100),
    chequeNumber: optionalString(50),
    bankName: optionalString(100),
    // Payment gateway verification fields (required for online/card/upi when gateway is configured)
    gatewayOrderId: optionalString(200),
    gatewaySignature: optionalString(500),
    remarks: optionalString(500),
    collectedBy: optionalObjectId,
  })
  .strip()
  .refine(
    (data) => !ONLINE_PAYMENT_MODES.includes(data.paymentMode) || Boolean(data.transactionId),
    {
      message: 'transactionId is required for online, card, and upi payments',
      path: ['transactionId'],
    }
  )
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
const feeHeadPaymentSchema = z.object({
  feeHeadId: objectId,
  amount: z
    .number()
    .min(1, 'Fee head payment amount must be at least 1')
    .max(10000000, 'Fee head payment amount seems too large'),
});

export const studentFeePaymentSchema = z
  .object({
    amount: z
      .number()
      .min(1, 'Payment amount must be at least 1')
      .max(10000000, 'Payment amount seems too large'),
    feeHeadPayments: z.array(feeHeadPaymentSchema).optional(),
    paymentMode: paymentModeEnum.default('cash'),
    remarks: optionalString(500),
    academicYear: academicYear.optional(),
  })
  .strip();

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
  .strip();

// ─── DEFAULTERS LIST QUERY ──────────────────────────────────────
export const defaultersQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().max(100).optional(),
    minDaysOverdue: z.coerce.number().int().min(0).optional(),
    academicYear: academicYear.optional(),
  })
  .strip();

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
  .strip();

const feeTemplateDiscountSchema = z
  .object({
    name: z.string().max(200).optional(),
    percentage: z.number().min(0).max(100).optional(),
    conditions: z.string().max(500).optional(),
  })
  .strip();

const feeTemplateApplicableForSchema = z
  .object({
    classGrade: z.string().max(20).optional(),
    applicable: z.boolean().optional(),
  })
  .strip();

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
  .strip();

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
  .strip();

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
    refundDate: z.string().optional(),
    refundMode: paymentModeEnum,
    originalPaymentId: optionalObjectId,
    transactionId: optionalString(100),
    chequeNumber: optionalString(50),
    bankName: optionalString(100),
    accountNumber: optionalString(50),
    remarks: optionalString(500),
  })
  .strip();
