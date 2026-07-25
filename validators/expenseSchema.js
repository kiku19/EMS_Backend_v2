import { z } from 'zod';

// P11: 24-char hex ObjectId validator, used for the Vendor ref. Reused by the
// vendors CRUD params and the expense vendorId field.
const objectIdString = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

export const createExpenseSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  amount: z
    .number({ invalid_type_error: 'Amount must be a number' })
    .min(0, 'Amount must be non-negative'),
  category: z.enum([
    'salaries',
    'utilities',
    'maintenance',
    'supplies',
    'equipment',
    'events',
    'transport',
    'marketing',
    'other',
  ]),
  paymentMode: z.enum(['cash', 'cheque', 'bank_transfer', 'upi', 'other']).default('cash'),
  expenseDate: z.string().min(1, 'Expense date is required'),
  description: z.string().max(1000).optional(),
  receiptUrl: z.string().url().optional().or(z.literal('')),
  vendor: z.string().max(200).optional(),
  // P11: link to a Vendor record. Optional to keep ad-hoc/legacy entries working.
  vendorId: objectIdString.optional(),
  academicYear: z.string().optional(),
});

// P10: Generic updates must NOT allow callers to flip status / set approvedBy
// directly — that bypasses the approve/reject approval workflow (which stamps
// approvedBy = req.user._id server-side). Approval transitions go through the
// dedicated /expenses/:id/approve and /expenses/:id/reject routes instead.
export const updateExpenseSchema = createExpenseSchema.partial();

// Optional rejection reason, used by the reject endpoint.
export const rejectExpenseSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
