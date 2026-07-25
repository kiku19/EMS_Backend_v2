import { z } from 'zod';
import { objectId, optionalString } from './zodHelpers.js';

export const payrollRecordParamsSchema = z.object({ id: objectId }).strip();
export const salaryAdjustmentParamsSchema = z.object({ id: objectId }).strip();
export const employeeAdjustmentParamsSchema = z.object({ employeeId: objectId }).strip();
export const payslipParamsSchema = z
  .object({
    employeeId: objectId,
    month: z.coerce.number().int().min(1).max(12),
    year: z.coerce.number().int().min(2000).max(2100),
  })
  .strip();

const paymentMethodEnum = z.enum(
  ['bank_transfer', 'cash', 'cheque', 'online', 'upi', 'neft', 'rtgs'],
  {
    errorMap: () => ({
      message:
        'Payment method must be one of: bank_transfer, cash, cheque, online, upi, neft, rtgs',
    }),
  }
);

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
    // Optional user-chosen payment date. Previously stripped by .strip(),
    // so the dashboard's "Payment date" picker was always discarded and
    // every payment was stamped "now" (C6).
    paymentDate: z.coerce.date().optional(),
  })
  .strip();

// ─── MARK AS PAID (single) ────────────────────────────────────────
export const markAsPaidSchema = z
  .object({
    paymentMethod: paymentMethodEnum.default('bank_transfer'),
    paymentReference: optionalString(100),
    notes: optionalString(500),
    paymentDate: z.coerce.date().optional(),
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
    status: z.enum(['not_generated', 'generated', 'paid', 'on_hold', 'failed']).optional(),
    notes: optionalString(500),
  })
  .strip();

// ─── SALARY ADJUSTMENT ───────────────────────────────────────────
export const createSalaryAdjustmentSchema = z
  .object({
    employeeId: objectId,
    type: z.enum(['allowance', 'deduction']),
    category: z.string().trim().min(1, 'category is required').max(100),
    amount: z.number().finite().positive('amount must be greater than zero'),
    description: optionalString(500),
    effectiveMonth: z.number().int().min(1).max(12),
    effectiveYear: z.number().int().min(2000).max(2100),
    isRecurring: z.boolean().optional().default(false),
  })
  .strip();

export const updateSalaryAdjustmentSchema = createSalaryAdjustmentSchema
  .omit({ employeeId: true })
  .partial()
  .refine((data) => Object.keys(data).length > 0, 'At least one adjustment field is required');
