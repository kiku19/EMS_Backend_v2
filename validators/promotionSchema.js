import { z } from 'zod';
import { objectId, academicYear } from './zodHelpers.js';

// Per-student decision in bulk promotion wizard
const studentDecisionSchema = z
  .object({
    studentId: objectId,
    decision: z.enum(['promoted', 'detained', 'transferred', 'graduated'], {
      errorMap: () => ({
        message: 'Decision must be one of: promoted, detained, transferred, graduated',
      }),
    }),
    toClassId: objectId.optional(), // required when decision === 'promoted'
    newRollNo: z
      .number()
      .int('Roll number must be a whole number')
      .positive('Roll number must be a positive integer')
      .optional(),
  })
  .refine((d) => d.decision !== 'promoted' || d.toClassId, {
    message: 'Target class (toClassId) is required when promoting a student',
    path: ['toClassId'],
  });

// Execute bulk promotion (wizard step 4 confirm)
export const bulkPromotionSchema = z
  .object({
    fromAcademicYear: academicYear,
    toAcademicYear: academicYear,
    studentDecisions: z
      .array(studentDecisionSchema)
      .min(1, 'At least one student decision is required for bulk promotion'),
    generateRollNumbers: z.boolean().optional().default(false),
  })
  .strip();

// Save/update school promotion rules
export const promotionRulesSchema = z
  .object({
    minAttendancePercent: z
      .number()
      .int('Must be a whole number')
      .min(0)
      .max(100)
      .optional()
      .default(75),
    feeRequirement: z
      .enum(['none', 'partial', 'full'], {
        errorMap: () => ({ message: 'feeRequirement must be one of: none, partial, full' }),
      })
      .optional()
      .default('none'),
  })
  .strip();

// Rollback a promotion record
export const rollbackPromotionSchema = z
  .object({
    reason: z.string().max(500).optional(),
  })
  .strip();

// Create new academic year (copy class structure)
export const newAcademicYearSchema = z
  .object({
    fromAcademicYear: academicYear,
    toAcademicYear: academicYear,
    copyClasses: z.boolean().optional().default(true),
    copyFeeTemplates: z.boolean().optional().default(false),
  })
  .strip();
