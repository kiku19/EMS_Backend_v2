import { z } from 'zod';
import { objectId, optionalObjectId, academicYear, optionalString } from './zodHelpers.js';

// Empty select values from the dashboard mean "unassigned". Normalize them
// before Mongoose sees the payload; casting an empty string as ObjectId would
// otherwise turn a valid teacher-clear action into a 500/CastError.
const nullableClassTeacherId = optionalObjectId.transform((value) => (value === '' ? null : value));

// ─── CREATE CLASS ────────────────────────────────────────────────
export const createClassSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Class name is required')
      .max(50, 'Class name must not exceed 50 characters'),
    section: z
      .string()
      .trim()
      .min(1, 'Section is required')
      .max(10, 'Section must not exceed 10 characters'),
    classTeacherId: nullableClassTeacherId,
    subjects: z
      .array(z.string().max(100, 'Subject name must not exceed 100 characters').trim())
      .default([]),
    assignedSubjects: z
      .array(z.string().max(100, 'Subject name must not exceed 100 characters').trim())
      .default([]),
    academicYear: academicYear,
    classTag: optionalString(100),
    room: optionalString(50),
    block: optionalString(50),
    strengthLimit: z
      .object({
        current: z
          .number()
          .int('Must be a whole number')
          .min(1, 'Strength must be at least 1')
          .max(200, 'Strength cannot exceed 200')
          .default(40),
        default: z
          .number()
          .int('Must be a whole number')
          .min(1, 'Strength must be at least 1')
          .max(200, 'Strength cannot exceed 200')
          .default(40),
      })
      .strip()
      .optional(),
  })
  .strip();

export const createClassesSchema = z
  .object({
    classes: z.array(createClassSchema).min(1).max(20),
  })
  .strip()
  .superRefine(({ classes }, ctx) => {
    const classKeys = new Set();
    const teacherIds = new Set();
    classes.forEach((classData, index) => {
      const key = `${classData.name.trim().toLowerCase()}|${classData.section.trim().toLowerCase()}|${classData.academicYear}`;
      if (classKeys.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['classes', index, 'section'],
          message: 'Duplicate class section in request',
        });
      }
      classKeys.add(key);
      if (classData.classTeacherId) {
        if (teacherIds.has(classData.classTeacherId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['classes', index, 'classTeacherId'],
            message: 'A teacher can only be assigned to one class',
          });
        }
        teacherIds.add(classData.classTeacherId);
      }
    });
  });

// ─── UPDATE CLASS (all fields optional) ──────────────────────────
export const updateClassSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Class name cannot be empty')
      .max(50, 'Class name must not exceed 50 characters')
      .optional(),
    section: z.string().trim().max(10, 'Section must not exceed 10 characters').optional(),
    classTeacherId: nullableClassTeacherId,
    subjects: z.array(z.string().max(100).trim()).optional(),
    assignedSubjects: z.array(z.string().max(100).trim()).optional(),
    academicYear: academicYear.optional(),
    classTag: optionalString(100),
    room: optionalString(50),
    block: optionalString(50),
    strengthLimit: z
      .object({
        current: z
          .number()
          .int('Must be a whole number')
          .min(1, 'Strength must be at least 1')
          .max(200, 'Strength cannot exceed 200')
          .optional(),
        default: z
          .number()
          .int('Must be a whole number')
          .min(1, 'Strength must be at least 1')
          .max(200, 'Strength cannot exceed 200')
          .optional(),
      })
      .strip()
      .optional(),
  })
  .strip();

// ─── UPDATE CLASS TEACHER ─────────────────────────────────────────
export const updateClassTeacherSchema = z
  .object({
    classTeacherId: nullableClassTeacherId,
    force: z.boolean().optional(),
  })
  .strip();

// ─── UPDATE CLASS SUBJECTS ────────────────────────────────────────
export const updateClassSubjectsSchema = z
  .object({
    assignedSubjects: z.array(
      z.string().max(100, 'Subject name must not exceed 100 characters').trim()
    ),
  })
  .strip();

// ─── UPDATE CLASS TAG ─────────────────────────────────────────────
export const updateClassTagSchema = z
  .object({
    classTag: optionalString(100),
  })
  .strip();

// ─── UPDATE STRENGTH LIMIT ────────────────────────────────────────
export const updateStrengthLimitSchema = z
  .object({
    newLimit: z
      .number()
      .int('Strength limit must be a whole number')
      .min(1, 'Strength limit must be at least 1')
      .max(200, 'Strength limit cannot exceed 200'),
    reason: z
      .string()
      .min(1, 'Reason for changing the limit is required')
      .max(500, 'Reason must not exceed 500 characters'),
    approvedBy: optionalObjectId,
  })
  .strip();

// ─── PROMOTE CLASS ────────────────────────────────────────────────
export const promoteClassSchema = z
  .object({
    targetClassId: objectId,
    targetSection: z.string().max(10).trim().optional(),
    academicYear: academicYear.optional(),
    skipFeeCheck: z.boolean().optional().default(false),
    skipAttendanceCheck: z.boolean().optional().default(false),
  })
  .strip();

// ─── PROMOTE INDIVIDUAL STUDENT ───────────────────────────────────
export const studentPromoteSchema = z
  .object({
    targetClassId: objectId.optional(),
    academicYear: academicYear.optional(),
    graduate: z.boolean().optional(),
    skipFeeCheck: z.boolean().optional().default(false),
    skipAttendanceCheck: z.boolean().optional().default(false),
  })
  .strip()
  .refine((data) => data.targetClassId || data.graduate, {
    message: 'Either targetClassId or graduate:true must be provided',
  });

// ─── BULK PROMOTE STUDENTS (list-level action) ────────────────────
export const bulkStudentPromoteSchema = z
  .object({
    promotions: z
      .array(
        z
          .object({
            studentId: objectId,
            targetClassId: objectId.optional(),
            graduate: z.boolean().optional().default(false),
          })
          .refine((d) => d.targetClassId || d.graduate, {
            message: 'Each entry needs targetClassId or graduate:true',
          })
      )
      .min(1, 'At least one student is required'),
  })
  .strip();

// ─── YEAR-END BULK PROMOTION ──────────────────────────────────────
export const yearEndPromotionSchema = z
  .object({
    academicYear: academicYear,
    classPromotions: z
      .array(
        z
          .object({
            fromClassId: objectId,
            toClassId: objectId.optional(),
            graduate: z.boolean().optional(),
          })
          .refine((d) => d.toClassId || d.graduate, {
            message: 'Each entry needs toClassId or graduate:true',
          })
      )
      .min(1),
    skipFeeCheck: z.boolean().optional().default(false),
    skipAttendanceCheck: z.boolean().optional().default(false),
  })
  .strip();

// ─── QUERY PARAMS: PER-DAY WEEK ATTENDANCE COVERAGE ────────────────
// Used by GET /api/v1/classes/attendance/week (SCH-191) to power the
// frontend's ClassesRail week-calendar stub. `weekStart` is the Monday
// of the week to summarise; `academicYear` is optional and validated
// only when provided.
export const weekAttendanceQuerySchema = z
  .object({
    weekStart: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'weekStart must be in YYYY-MM-DD format')
      .optional(),
    academicYear: academicYear.optional(),
  })
  .strip();

export const classRosterQuerySchema = z
  .object({
    skip: z.coerce.number().int().min(0).optional().default(0),
    limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  })
  .strip();

export const classListQuerySchema = z
  .object({
    academicYear: academicYear.optional(),
    teacherId: objectId.optional(),
  })
  .strip();
