import { z } from 'zod';

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
  academicYear: z.string().optional(),
});

export const updateExpenseSchema = createExpenseSchema.partial().extend({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  approvedBy: z.string().optional(),
});
