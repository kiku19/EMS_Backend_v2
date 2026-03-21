import { z } from 'zod';

export const createCouponSchema = z
  .object({
    code: z.string().min(3).max(30).trim().toUpperCase(),
    description: z.string().max(200).trim().nullish(),
    discountType: z.enum(['percentage', 'fixed']),
    discountValue: z.number().positive(),
    applicablePlans: z
      .array(z.enum(['starter', 'growth', 'scale']))
      .optional()
      .default([]),
    applicableCycles: z
      .array(z.enum(['monthly', 'annual']))
      .optional()
      .default([]),
    maxUses: z.number().int().positive().nullish(),
    maxUsesPerSchool: z.number().int().positive().optional().default(1),
    startsAt: z.coerce.date().nullish(),
    expiresAt: z.coerce.date().nullish(),
    isActive: z.boolean().optional().default(true),
  })
  .refine(
    (data) => {
      if (data.discountType === 'percentage' && data.discountValue > 100) {
        return false;
      }
      return true;
    },
    { message: 'Percentage discount cannot exceed 100', path: ['discountValue'] }
  );

export const updateCouponSchema = z.object({
  description: z.string().max(200).trim().nullish(),
  discountType: z.enum(['percentage', 'fixed']).optional(),
  discountValue: z.number().positive().optional(),
  applicablePlans: z.array(z.enum(['starter', 'growth', 'scale'])).optional(),
  applicableCycles: z.array(z.enum(['monthly', 'annual'])).optional(),
  maxUses: z.number().int().positive().nullish(),
  maxUsesPerSchool: z.number().int().positive().optional(),
  startsAt: z.coerce.date().nullish(),
  expiresAt: z.coerce.date().nullish(),
  isActive: z.boolean().optional(),
});

export const validateCouponSchema = z.object({
  code: z.string().min(1).trim().toUpperCase(),
  planKey: z.enum(['starter', 'growth', 'scale']),
  billingCycle: z.enum(['monthly', 'annual']).optional().default('monthly'),
});

export const couponListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  isActive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined)),
});
