import { z } from 'zod';
import { objectId, academicYear, dateString } from './zodHelpers.js';

const optionalObjectId = objectId.optional();
const optionalAcademicYear = academicYear.optional();
const optionalDateString = dateString.optional();

const format = z.enum(['csv', 'xlsx', 'pdf']).default('csv');

export const studentsExportSchema = z
  .object({
    format,
    classId: optionalObjectId,
    status: z.enum(['active', 'inactive', 'alumni', 'transferred']).optional(),
    academicYear: optionalAcademicYear,
    columns: z.string().optional(),
  })
  .strip();

export const staffExportSchema = z
  .object({
    format,
    status: z.enum(['active', 'inactive', 'on-leave', 'suspended', 'terminated']).optional(),
    department: z.string().optional(),
    columns: z.string().optional(),
  })
  .strip();

export const feeCollectionExportSchema = z
  .object({
    format,
    academicYear: optionalAcademicYear,
    startDate: optionalDateString,
    endDate: optionalDateString,
    classId: optionalObjectId,
  })
  .strip();

export const feeDefaultersExportSchema = z
  .object({
    format,
    academicYear: optionalAcademicYear,
    classId: optionalObjectId,
  })
  .strip();

export const attendanceExportSchema = z
  .object({
    format,
    classId: optionalObjectId,
    academicYear: optionalAcademicYear,
    startDate: dateString,
    endDate: dateString,
  })
  .strip();

export const examResultsExportSchema = z
  .object({
    format,
    examId: objectId,
    classId: optionalObjectId,
    academicYear: optionalAcademicYear,
  })
  .strip();

export const payrollExportSchema = z
  .object({
    format,
    month: z.string().regex(/^(1[0-2]|[1-9])$/, 'Month must be 1-12'),
    year: z.string().regex(/^\d{4}$/, 'Year must be 4 digits'),
  })
  .strip();

export const staffAttendanceExportSchema = z
  .object({
    format,
    startDate: dateString,
    endDate: dateString,
    department: z.string().optional(),
  })
  .strip();

export const classResultsExportSchema = z
  .object({
    format,
    examId: objectId,
    classId: optionalObjectId,
    academicYear: optionalAcademicYear,
  })
  .strip();

export const studentStrengthExportSchema = z
  .object({
    format,
    academicYear: optionalAcademicYear,
  })
  .strip();

export const admissionsExportSchema = z
  .object({
    format,
    academicYear: optionalAcademicYear,
    startDate: optionalDateString,
    endDate: optionalDateString,
  })
  .strip();

export const concessionsExportSchema = z
  .object({
    format,
    academicYear: optionalAcademicYear,
  })
  .strip();

export const feeHeadsExportSchema = z
  .object({
    format,
    academicYear: optionalAcademicYear,
    startDate: optionalDateString,
    endDate: optionalDateString,
  })
  .strip();

// ─── GOVERNMENT PORTAL EXPORTS ───────────────────────────────────────────────

export const udiseExportSchema = z
  .object({
    format,
    academicYear: optionalAcademicYear,
  })
  .strip();

export const cbseExportSchema = z
  .object({
    format,
    academicYear: optionalAcademicYear,
    classId: objectId.optional(),
  })
  .strip();

export const icseExportSchema = z
  .object({
    format,
    academicYear: optionalAcademicYear,
    classId: objectId.optional(),
  })
  .strip();

export const stateBoardExportSchema = z
  .object({
    format,
    academicYear: optionalAcademicYear,
    classId: objectId.optional(),
  })
  .strip();

export const annualReportExportSchema = z
  .object({
    format,
    academicYear: optionalAcademicYear,
  })
  .strip();

export const complianceChecklistExportSchema = z
  .object({
    format,
    academicYear: optionalAcademicYear,
  })
  .strip();
