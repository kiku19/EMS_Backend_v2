import { z } from 'zod';
import { objectId, dateString, optionalString } from './zodHelpers.js';

// ─── SHARED ──────────────────────────────────────────────────────

const MAX_BATCH_SIZE = 200;
const MAX_DELETE_SIZE = 500;

// ─── STUDENTS ────────────────────────────────────────────────────

// Minimal student payload for JSON batch create (uses classId directly)
export const batchCreateStudentItemSchema = z
  .object({
    name: z.string().min(2).max(100).trim(),
    admissionId: z.string().min(1).max(50).trim(),
    academicYear: z.string().regex(/^\d{4}-\d{2}$/, 'Must be YYYY-YY format'),
    classId: objectId,
    rollNo: z.number().int().min(1).nullish(),
    gender: z.enum(['Male', 'Female', 'Other']).nullish(),
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullish()
      .or(z.literal('')),
    parentName: z.string().min(1).max(100).trim(),
    parentPhone: z
      .string()
      .regex(/^[0-9]{10}$/)
      .nullish()
      .or(z.literal('')),
    parentEmail: z.string().email().nullish().or(z.literal('')),
    phone: z
      .string()
      .regex(/^[0-9]{10}$/)
      .nullish()
      .or(z.literal('')),
    email: z.string().email().nullish().or(z.literal('')),
    address: optionalString(500),
    status: z.enum(['active', 'inactive', 'graduated', 'transferred', 'alumni']).default('active'),
  })
  .strip();

export const batchCreateStudentsSchema = z.object({
  items: z.array(batchCreateStudentItemSchema).min(1).max(MAX_BATCH_SIZE),
});

// Batch update students — two modes:
//   Mode A: same patch applied to multiple IDs  →  { ids, data }
//   Mode B: individual patches per record       →  { items: [{ id, ...fields }] }
const studentPatchSchema = z
  .object({
    classId: objectId.optional(),
    status: z.enum(['active', 'inactive', 'graduated', 'transferred', 'alumni']).optional(),
    rollNo: z.number().int().min(1).nullish(),
    gender: z.enum(['Male', 'Female', 'Other']).nullish(),
    address: optionalString(500),
    phone: z
      .string()
      .regex(/^[0-9]{10}$/)
      .nullish()
      .or(z.literal('')),
    email: z.string().email().nullish().or(z.literal('')),
    parentName: optionalString(100),
    parentPhone: z
      .string()
      .regex(/^[0-9]{10}$/)
      .nullish()
      .or(z.literal('')),
    parentEmail: z.string().email().nullish().or(z.literal('')),
  })
  .strip()
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'At least one field must be provided for update',
  });

export const batchUpdateStudentsByIdsSchema = z.object({
  ids: z.array(objectId).min(1).max(MAX_BATCH_SIZE),
  data: studentPatchSchema,
});

export const batchUpdateStudentsItemsSchema = z.object({
  items: z
    .array(studentPatchSchema.extend({ id: objectId }))
    .min(1)
    .max(MAX_BATCH_SIZE),
});

export const batchUpdateStudentsSchema = z.union([
  batchUpdateStudentsByIdsSchema,
  batchUpdateStudentsItemsSchema,
]);

// Batch delete
export const batchDeleteSchema = z.object({
  ids: z.array(objectId).min(1).max(MAX_DELETE_SIZE),
});

// ─── STAFF ───────────────────────────────────────────────────────

const staffPatchSchema = z
  .object({
    status: z.enum(['active', 'inactive', 'on-leave']).optional(),
    department: optionalString(50),
    designation: optionalString(100),
    phone: z
      .string()
      .regex(/^[0-9]{10}$/)
      .nullish()
      .or(z.literal('')),
    email: z.string().email().nullish().or(z.literal('')),
    assignedClassId: objectId.nullish(),
  })
  .strip()
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'At least one field must be provided for update',
  });

export const batchUpdateStaffByIdsSchema = z.object({
  ids: z.array(objectId).min(1).max(MAX_BATCH_SIZE),
  data: staffPatchSchema,
});

export const batchUpdateStaffItemsSchema = z.object({
  items: z
    .array(staffPatchSchema.extend({ id: objectId }))
    .min(1)
    .max(MAX_BATCH_SIZE),
});

export const batchUpdateStaffSchema = z.union([
  batchUpdateStaffByIdsSchema,
  batchUpdateStaffItemsSchema,
]);

// ─── ATTENDANCE ──────────────────────────────────────────────────

const attendanceRecordSchema = z.object({
  studentId: objectId,
  status: z.enum(['present', 'absent', 'late', 'leave', 'halfday']),
  note: optionalString(200),
});

export const batchAttendanceSchema = z.object({
  date: dateString,
  classId: objectId,
  records: z.array(attendanceRecordSchema).min(1).max(500),
});

// ─── RESULTS ─────────────────────────────────────────────────────

const resultRecordSchema = z.object({
  studentId: objectId,
  marksObtained: z.number().min(0),
  maxMarks: z.number().min(1).optional(),
  remarks: optionalString(500),
});

export const batchResultsSchema = z.object({
  examId: objectId,
  records: z.array(resultRecordSchema).min(1).max(500),
});
