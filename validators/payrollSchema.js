import { z } from 'zod';
import { objectId, optionalString } from './zodHelpers.js';

const paymentMethodEnum = z.enum(['bank_transfer', 'cash', 'cheque', 'upi', 'neft', 'rtgs'], {
  errorMap: () => ({
    message: 'Payment method must be one of: bank_transfer, cash, cheque, upi, neft, rtgs',
  }),
});

// ─── BULK PAY ─────────────────────────────────────────────────────
export const bulkPaySchema = z
  .object({
    recordIds: z
      .array(objectId, { required_error: 'recordIds is required' })
      .min(1, 'At least one record ID is required')
      .max(500, 'Cannot process more than 500 records at once'),
    paymentMethod: paymentMethodEnum.default('bank_transfer'),
    paymentReference: optionalString(100),
    notes: optionalString(500),
  })
  .strip();

// ─── MARK AS PAID (single) ────────────────────────────────────────
export const markAsPaidSchema = z
  .object({
    paymentMethod: paymentMethodEnum.default('bank_transfer'),
    paymentReference: optionalString(100),
    notes: optionalString(500),
  })
  .strip();

// ─── REVERSE PAYMENT ─────────────────────────────────────────────
export const reversePaymentSchema = z
  .object({
    reason: z
      .string()
      .min(1, 'Reason is required')
      .max(500, 'Reason must not exceed 500 characters'),
  })
  .strip();

// ─── RUN PAYROLL ─────────────────────────────────────────────────
export const runPayrollSchema = z
  .object({
    month: z.number({ required_error: 'month is required' }).int().min(1).max(12),
    year: z.number({ required_error: 'year is required' }).int().min(2000).max(2100),
    employeeIds: z
      .array(objectId, { required_error: 'employeeIds is required' })
      .min(1, 'At least one employee ID is required'),
    forceRerun: z.boolean().optional().default(false),
  })
  .strip();

// ─── VALIDATE PAYROLL (pre-run check) ────────────────────────────
export const validatePayrollSchema = z
  .object({
    month: z.number({ required_error: 'month is required' }).int().min(1).max(12),
    year: z.number({ required_error: 'year is required' }).int().min(2000).max(2100),
    employeeIds: z
      .array(objectId, { required_error: 'employeeIds is required' })
      .min(1, 'At least one employee ID is required'),
  })
  .strip();

// ─── UPDATE PAYROLL RECORD (admin edit of an existing row) ────────
// Every amount must be a finite non-negative number; the pre-save hook
// does `reduce((sum, a) => sum + a.amount, 0)` so nulls/undefineds
// silently produce NaN grossPay/netPay. Enforce here.
const amountField = z
  .number({
    required_error: 'amount is required',
    invalid_type_error: 'amount must be a number',
  })
  .finite('amount must be a finite number')
  .nonnegative('amount cannot be negative');

const allowanceOrDeductionSchema = z
  .object({
    type: z.string().min(1, 'type is required').max(100),
    amount: amountField,
    description: z.string().max(300).optional(),
  })
  .strip();

export const updatePayrollRecordSchema = z
  .object({
    baseSalary: z.number().finite().nonnegative().optional(),
    allowances: z.array(allowanceOrDeductionSchema).max(50).optional(),
    deductions: z.array(allowanceOrDeductionSchema).max(50).optional(),
    status: z
      .enum(['not_generated', 'generated', 'paid', 'on_hold', 'failed'])
      .optional(),
    notes: optionalString(500),
  })
  .strip();
