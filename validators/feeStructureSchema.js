import { z } from 'zod';
import { academicYear, objectId, optionalObjectId } from './zodHelpers.js';

const feeHeadSchema = z
  .object({
    feeHeadId: optionalObjectId,
    name: z.string().trim().min(1).max(200),
    category: z
      .enum(['Academic', 'Transport', 'Extra-curricular', 'Hostel', 'Other'])
      .default('Academic'),
    amount: z.number().min(0).max(10000000),
    frequency: z.enum(['monthly', 'quarterly', 'term', 'yearly', 'one-time']).default('yearly'),
    mandatory: z.boolean().default(true),
    applicableTerms: z.array(z.number().int().min(1).max(12)).optional(),
    dueDay: z.number().int().min(1).max(31).optional(),
    refundable: z.boolean().default(false),
  })
  .strict();

const installmentSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate must use YYYY-MM-DD'),
    amount: z.number().min(0).max(10000000),
    status: z.literal('pending').default('pending'),
  })
  .strict();

export const saveFeeStructureSchema = z
  .object({
    classId: objectId,
    academicYear: academicYear.optional(),
    templateId: optionalObjectId,
    feeHeads: z.array(feeHeadSchema).min(1),
    collectionSchedule: z
      .object({
        mode: z.enum(['term', 'monthly', 'quarterly', 'yearly', 'custom']),
        installments: z.array(installmentSchema),
      })
      .strict(),
    totalAnnualFee: z.number().min(0).max(100000000),
  })
  .strict()
  .superRefine((data, ctx) => {
    const headTotal = data.feeHeads.reduce((sum, head) => {
      if (head.frequency === 'monthly') return sum + head.amount * 12;
      if (head.frequency === 'quarterly') return sum + head.amount * 4;
      if (head.frequency === 'term') {
        const terms =
          Array.isArray(head.applicableTerms) && head.applicableTerms.length
            ? head.applicableTerms.length
            : 2;
        return sum + head.amount * Math.max(terms, 1);
      }
      return sum + head.amount;
    }, 0);
    if (Math.abs(headTotal - data.totalAnnualFee) > 0.01) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['totalAnnualFee'],
        message: 'totalAnnualFee must equal the sum of fee head amounts',
      });
    }
    const installmentTotal = data.collectionSchedule.installments.reduce(
      (sum, installment) => sum + installment.amount,
      0
    );
    if (Math.abs(installmentTotal - data.totalAnnualFee) > 0.01) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['collectionSchedule', 'installments'],
        message: 'Installment amounts must add up to totalAnnualFee',
      });
    }
  });

export const applyFeeStructureSchema = z
  .object({
    classId: objectId,
    academicYear: academicYear.optional(),
  })
  .strict();

export const feeStructureSummaryQuerySchema = z
  .object({ academicYear: academicYear.optional() })
  .strict();
