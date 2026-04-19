import { z } from 'zod';
import { objectId, academicYear, dateString } from './zodHelpers.js';

const optionalAcademicYear = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'Must be YYYY-YY format')
  .optional();
const optionalObjectId = objectId.optional();
const optionalDateString = dateString.optional();

// ─── ACADEMIC ────────────────────────────────────────────────────────────────

export const classResultsQuerySchema = z
  .object({
    classId: optionalObjectId,
    examId: objectId,
    academicYear: optionalAcademicYear,
  })
  .strip();

export const subjectAnalysisQuerySchema = z
  .object({
    classId: optionalObjectId,
    examId: objectId,
    academicYear: optionalAcademicYear,
  })
  .strip();

export const rankListQuerySchema = z
  .object({
    classId: optionalObjectId,
    examId: objectId,
    academicYear: optionalAcademicYear,
  })
  .strip();

export const gradeDistributionQuerySchema = z
  .object({
    classId: optionalObjectId,
    examId: objectId,
    academicYear: optionalAcademicYear,
  })
  .strip();

// ─── FINANCIAL ───────────────────────────────────────────────────────────────

export const feeCollectionQuerySchema = z
  .object({
    academicYear: optionalAcademicYear,
    startDate: optionalDateString,
    endDate: optionalDateString,
    groupBy: z.enum(['daily', 'monthly', 'yearly']).default('monthly'),
  })
  .strip();

export const outstandingDuesQuerySchema = z
  .object({
    academicYear: optionalAcademicYear,
    classId: optionalObjectId,
  })
  .strip();

export const feeHeadCollectionQuerySchema = z
  .object({
    academicYear: optionalAcademicYear,
    startDate: optionalDateString,
    endDate: optionalDateString,
  })
  .strip();

export const paymentModeSummaryQuerySchema = z
  .object({
    academicYear: optionalAcademicYear,
    startDate: optionalDateString,
    endDate: optionalDateString,
  })
  .strip();

export const concessionQuerySchema = z
  .object({
    academicYear: optionalAcademicYear,
  })
  .strip();

// ─── ATTENDANCE ──────────────────────────────────────────────────────────────

export const studentAttendanceQuerySchema = z
  .object({
    startDate: dateString,
    endDate: dateString,
    classId: optionalObjectId,
    studentId: optionalObjectId,
  })
  .strip();

export const classwiseAttendanceQuerySchema = z
  .object({
    startDate: dateString,
    endDate: dateString,
  })
  .strip();

export const monthlyAttendanceRegisterQuerySchema = z
  .object({
    classId: objectId,
    month: z.string().regex(/^\d{4}-\d{2}$/, 'Must be YYYY-MM format'),
  })
  .strip();

export const absenteesQuerySchema = z
  .object({
    startDate: dateString,
    endDate: dateString,
    classId: optionalObjectId,
  })
  .strip();

export const attendanceTrendQuerySchema = z
  .object({
    startDate: dateString,
    endDate: dateString,
    classId: optionalObjectId,
    groupBy: z.enum(['day', 'week', 'month']).default('day'),
  })
  .strip();

export const lateArrivalsQuerySchema = z
  .object({
    startDate: dateString,
    endDate: dateString,
    classId: optionalObjectId,
  })
  .strip();

// ─── STAFF ───────────────────────────────────────────────────────────────────

export const staffAttendanceSummaryQuerySchema = z
  .object({
    startDate: dateString,
    endDate: dateString,
    department: z.string().max(100).optional(),
  })
  .strip();

export const payrollSummaryQuerySchema = z
  .object({
    month: z.coerce.number().int().min(1).max(12).optional(),
    year: z.coerce.number().int().min(2020).max(2100).optional(),
  })
  .strip();

// ─── OPERATIONAL ─────────────────────────────────────────────────────────────

export const admissionsQuerySchema = z
  .object({
    academicYear: optionalAcademicYear,
    startDate: optionalDateString,
    endDate: optionalDateString,
  })
  .strip();

export const studentStrengthQuerySchema = z
  .object({
    academicYear: optionalAcademicYear,
  })
  .strip();

export const tcIssuedQuerySchema = z
  .object({
    academicYear: optionalAcademicYear,
    startDate: optionalDateString,
    endDate: optionalDateString,
  })
  .strip();

export const visitorLogQuerySchema = z
  .object({
    startDate: optionalDateString,
    endDate: optionalDateString,
  })
  .strip();

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

export const dashboardMetricsQuerySchema = z
  .object({
    academicYear: optionalAcademicYear,
  })
  .strip();
