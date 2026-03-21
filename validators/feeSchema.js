import { z } from 'zod';
import { objectId, optionalObjectId, optionalString, academicYear } from './zodHelpers.js';

const paymentModeEnum = z.enum(['cash', 'cheque', 'online', 'card', 'upi', 'bank_transfer']);

// ─── FEE HEAD BREAKDOWN ──────────────────────────────────────────
const feeHeadBreakdownSchema = z
  .object({
    feeHeadId: objectId.optional(),
    name: z.string().min(1, 'Fee head name is required').optional(),
    amount: z.number().min(0, 'Fee head amount cannot be negative'),
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
    receiptNumber: z.string().max(50).nullish().or(z.literal('')),
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
