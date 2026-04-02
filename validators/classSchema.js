import { z } from 'zod';
import { objectId, optionalObjectId, academicYear, optionalString } from './zodHelpers.js';

// ─── CREATE CLASS ────────────────────────────────────────────────
export const createClassSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Class name is required')
      .max(50, 'Class name must not exceed 50 characters')
      .trim(),
    section: z
      .string()
      .min(1, 'Section is required')
      .max(10, 'Section must not exceed 10 characters')
      .trim(),
    classTeacherId: optionalObjectId,
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

// ─── UPDATE CLASS (all fields optional) ──────────────────────────
export const updateClassSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Class name cannot be empty')
      .max(50, 'Class name must not exceed 50 characters')
      .trim()
      .optional(),
    section: z.string().max(10, 'Section must not exceed 10 characters').trim().optional(),
    classTeacherId: optionalObjectId,
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
    classTeacherId: optionalObjectId,
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
