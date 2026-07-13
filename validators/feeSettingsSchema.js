import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid MongoDB ID');
const academicYear = z.string().trim().min(4).max(20);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const shortText = z.string().trim().max(500);

const feeConcessionBase = z
  .object({
    name: z.string().trim().min(2).max(100),
    description: shortText.optional(),
    discountType: z.enum(['percentage', 'flat']),
    discountValue: z.number().nonnegative(),
    applicableOn: z.enum(['selected_heads', 'entire_fee']).optional(),
    applicableFeeHeads: z.array(objectId).max(100).optional(),
    approvalRequired: z.boolean().optional(),
    approverRole: z.enum(['principal', 'admin', 'accountant', 'director']).optional(),
    eligibilityCriteria: z
      .object({
        type: z.enum(['sibling', 'merit', 'financial', 'staff_ward', 'sports', 'custom']),
        conditions: z.array(z.string().trim().min(1).max(200)).max(25).optional(),
      })
      .strict()
      .optional(),
    academicYear,
    isActive: z.boolean().optional(),
  })
  .strict();

function validateConcession(value, context) {
  if (value.discountType === 'percentage' && value.discountValue > 100) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['discountValue'],
      message: 'Percentage discount cannot exceed 100',
    });
  }
  if (value.applicableOn === 'selected_heads' && !value.applicableFeeHeads?.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['applicableFeeHeads'],
      message: 'Select at least one fee head',
    });
  }
}

export const feeConcessionSchema = feeConcessionBase.superRefine(validateConcession);

export const updateFeeConcessionSchema = feeConcessionBase
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required')
  .superRefine(validateConcession);

const lateFeeSlab = z
  .object({
    fromDay: z.number().int().nonnegative(),
    toDay: z.number().int().nonnegative(),
    amount: z.number().nonnegative(),
  })
  .strict()
  .refine((value) => value.toDay >= value.fromDay, {
    path: ['toDay'],
    message: 'toDay must be on or after fromDay',
  });

export const lateFeeRuleSchema = z
  .object({
    academicYear,
    enabled: z.boolean().optional(),
    gracePeriod: z.number().int().min(0).max(365).optional(),
    fineType: z.enum(['per_day', 'slab', 'flat']),
    perDayAmount: z.number().nonnegative().optional(),
    slabs: z.array(lateFeeSlab).max(50).optional(),
    flatAmount: z.number().nonnegative().optional(),
    maximumCap: z.number().nonnegative().optional(),
    applicableFeeHeads: z.array(objectId).max(100).optional(),
    description: shortText.optional(),
  })
  .strict();

export const updateLateFeeRuleSchema = lateFeeRuleSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

const approvalControl = z
  .object({
    requiresApproval: z.boolean().optional(),
    approverRole: z.enum(['principal', 'admin', 'director']).optional(),
  })
  .strict();

export const feeRuleSchema = z
  .object({
    academicYear,
    newAdmission: z
      .object({
        feeCalculation: z.enum(['total', 'prorated']).optional(),
        prorateFrom: z.enum(['admission_date', 'month_start', 'quarter_start']).optional(),
        prorateMethod: z.enum(['monthly', 'daily']).optional(),
      })
      .strict()
      .optional(),
    validTill: z
      .object({
        type: z.enum(['academic_year', 'specific_date', 'indefinite']).optional(),
        date: isoDate.optional(),
      })
      .strict()
      .optional(),
    editApprovalControls: z
      .object({
        feeHeadEdit: approvalControl.optional(),
        concessionApproval: approvalControl.optional(),
        feeWaiver: z
          .object({
            requiresApproval: z.boolean().optional(),
            approverRole: z.enum(['principal', 'director']).optional(),
            maxAmountWithoutApproval: z.number().nonnegative().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    allowPartialPayment: z.boolean().optional(),
    minimumPartialPaymentPercent: z.number().min(0).max(100).optional(),
    refundPolicy: z
      .object({
        enabled: z.boolean().optional(),
        refundableHeads: z.array(objectId).max(100).optional(),
        processingDays: z.number().int().min(1).max(365).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const updateFeeRuleSchema = feeRuleSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const paymentMethodConfigSchema = z
  .object({
    academicYear,
    online: z
      .object({
        enabled: z.boolean().optional(),
        bankTransfer: z.boolean().optional(),
        upi: z.boolean().optional(),
        debitCard: z.boolean().optional(),
        creditCard: z.boolean().optional(),
        emi: z
          .object({
            enabled: z.boolean().optional(),
            providers: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    offline: z
      .object({
        enabled: z.boolean().optional(),
        cash: z.boolean().optional(),
        cheque: z.boolean().optional(),
        dd: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const updatePaymentMethodConfigSchema = paymentMethodConfigSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

const installmentPlan = z
  .object({
    name: z.string().trim().min(1).max(100),
    frequency: z.enum(['monthly', 'quarterly', 'half-yearly', 'custom']).optional(),
    numberOfInstallments: z.number().int().min(1).max(24),
    dueDates: z.array(isoDate).max(24).optional(),
    enabled: z.boolean().optional(),
    description: shortText.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.dueDates?.length && value.dueDates.length !== value.numberOfInstallments) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dueDates'],
        message: 'Due date count must match the number of installments',
      });
    }
  });

export const feeCollectionPeriodSchema = z
  .object({
    academicYear,
    collectionInterval: z.enum(['monthly', 'quarterly', 'term', 'yearly']).optional(),
    installmentPlans: z.array(installmentPlan).max(20).optional(),
    autoPay: z
      .object({
        enabled: z.boolean().optional(),
        reminderDays: z.number().int().min(0).max(365).optional(),
      })
      .strict()
      .optional(),
    interestOnDelay: z
      .object({
        enabled: z.boolean().optional(),
        type: z.enum(['rate', 'flat']).optional(),
        value: z.number().nonnegative().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const updateFeeCollectionPeriodSchema = feeCollectionPeriodSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');
