import { z } from 'zod';

export const invoiceListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  status: z.enum(['draft', 'issued', 'paid', 'failed', 'void']).optional(),
});

export const markPaidSchema = z.object({
  notes: z.string().max(500).trim().nullish(),
});

export const cancelSubscriptionSchema = z.object({
  immediate: z.boolean().optional().default(false),
  reason: z.string().max(500).trim().nullish(),
});

export const scheduleDowngradeSchema = z.object({
  planKey: z.enum(['starter', 'growth', 'scale']),
});

export const checkoutSchema = z.object({
  planKey: z.enum(['starter', 'growth', 'scale']),
  billingCycle: z.enum(['monthly', 'annual']).optional().default('monthly'),
  couponCode: z.string().min(1).max(30).trim().toUpperCase().nullish(),
});

export const autoRenewSchema = z.object({
  autoRenew: z.boolean(),
});
