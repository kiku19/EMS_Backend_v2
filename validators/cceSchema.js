import { z } from 'zod';
import { academicYear, optionalObjectId, optionalString } from './zodHelpers.js';

// ─── CCE CONFIG ───────────────────────────────────────────────────────────────
// Per-school CCE configuration: grading scale, assessment types, co-scholastic areas

const cceGradeScaleEntry = z.object({
  minPercentage: z.number().min(0).max(100),
  maxPercentage: z.number().min(0).max(100),
  grade: z.string().min(1).max(10).trim(),
  gradePoint: z.number().min(0).max(10),
  description: optionalString(100),
});

const assessmentTypeEntry = z.object({
  name: z.string().min(1).max(20).trim(),
  type: z.enum(['formative', 'summative']),
  term: z.enum(['term_1', 'term_2']),
  weightage: z.number().min(0).max(100),
  maxMarks: z.number().min(1).max(1000),
  isActive: z.boolean().default(true),
});

const coScholasticAreaEntry = z.object({
  category: z.enum(['life_skills', 'attitudes_values', 'co_curricular']),
  name: z.string().min(1).max(100).trim(),
  isActive: z.boolean().default(true),
});

export const createCCEConfigSchema = z
  .object({
    academicYear: academicYear.nullish().or(z.literal('')),
    enabled: z.boolean().default(true),
    gradingScale: z.array(cceGradeScaleEntry).min(1, 'At least one grade entry is required'),
    assessmentTypes: z
      .array(assessmentTypeEntry)
      .min(1, 'At least one assessment type is required'),
    coScholasticAreas: z.array(coScholasticAreaEntry).optional(),
  })
  .strip()
  .refine(
    (data) => {
      const activeTypes = data.assessmentTypes.filter((t) => t.isActive !== false);
      if (activeTypes.length === 0) return true;
      const totalWeightage = activeTypes.reduce((sum, t) => sum + t.weightage, 0);
      return totalWeightage === 100;
    },
    {
      message: 'Active assessment type weightages must sum to 100%',
      path: ['assessmentTypes'],
    }
  );

export const updateCCEConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    gradingScale: z.array(cceGradeScaleEntry).min(1).optional(),
    assessmentTypes: z.array(assessmentTypeEntry).min(1).optional(),
    coScholasticAreas: z.array(coScholasticAreaEntry).optional(),
  })
  .strip()
  .refine(
    (data) => {
      if (!data.assessmentTypes) return true;
      const activeTypes = data.assessmentTypes.filter((t) => t.isActive !== false);
      if (activeTypes.length === 0) return true;
      const totalWeightage = activeTypes.reduce((sum, t) => sum + t.weightage, 0);
      return totalWeightage === 100;
    },
    {
      message: 'Active assessment type weightages must sum to 100%',
      path: ['assessmentTypes'],
    }
  );

// ─── CCE REPORT CARD QUERY ────────────────────────────────────────────────────
// GET /cce/report-card/:studentId?academicYear=2025-26
// `academicYear` is optional — when omitted the school's configured year is used
// (resolved inside the route via resolveAcademicYear).
export const cceReportCardQuerySchema = z.object({
  academicYear: academicYear.nullish().or(z.literal('')),
  subjectId: optionalObjectId,
});
