import { z } from 'zod';
import { optionalObjectId, optionalString } from './zodHelpers.js';

// ─── Flexible form field definition ─────────────────────────────
// IntakeForm fields are stored as Mixed/flexible, but we validate
// that each item has at least a fieldName and fieldType.
const formFieldSchema = z
  .object({
    fieldName: z.string().min(1, 'Field name is required').max(200).trim(),
    fieldType: z.string().min(1, 'Field type is required').max(50).trim(),
    label: z.string().max(300).trim().optional(),
    required: z.boolean().optional().default(false),
    options: z.array(z.string().max(200)).optional(),
    placeholder: z.string().max(300).optional(),
    defaultValue: z.unknown().optional(),
    section: z.string().max(100).optional(),
    order: z.number().int().optional(),
  })
  .passthrough(); // Allow additional field config properties

// ─── INTAKE FORM: CREATE ────────────────────────────────────────
export const createIntakeFormSchema = z
  .object({
    formName: z.string().min(1, 'Form name is required').max(200).trim(),
    formType: z.enum(['staff', 'student', 'parent', 'custom'], {
      errorMap: () => ({ message: 'formType must be staff, student, parent, or custom' }),
    }),
    fields: z.array(formFieldSchema).min(1, 'At least one field is required'),
    status: z.enum(['active', 'inactive', 'archived']).optional().default('active'),
  })
  .strip();

// ─── INTAKE FORM: UPDATE ────────────────────────────────────────
export const updateIntakeFormSchema = z
  .object({
    formName: z.string().min(1).max(200).trim().optional(),
    formType: z.enum(['staff', 'student', 'parent', 'custom']).optional(),
    fields: z.array(formFieldSchema).min(1, 'Fields array must not be empty').optional(),
    status: z.enum(['active', 'inactive', 'archived']).optional(),
  })
  .strip();

// ─── FORM ASSIGNMENT: ASSIGN ────────────────────────────────────
export const assignFormSchema = z
  .object({
    emails: z.array(z.string().email('Invalid email address')).optional().default([]),
    phones: z.array(z.string().min(7).max(20)).optional().default([]),
    assignedToEmail: z.string().email().optional(),
    assignedToPhone: z.string().min(7).max(20).optional(),
    expiresInDays: z.number().int().min(1).max(365).optional().default(7),
  })
  .strip();

// ─── FORM SUBMISSION: REVIEW ────────────────────────────────────
export const reviewSubmissionSchema = z
  .object({
    reviewStatus: z.enum(['pending', 'approved', 'rejected', 'needs_revision'], {
      errorMap: () => ({
        message: 'reviewStatus must be one of: pending, approved, rejected, needs_revision',
      }),
    }),
    reviewNotes: optionalString(5000),
    staffId: optionalObjectId,
    studentId: optionalObjectId,
  })
  .strip();

// ─── FORM SUBMISSION: ENHANCED REVIEW ───────────────────────────
export const reviewEnhancedSchema = z
  .object({
    decision: z.enum(['approved', 'rejected'], {
      errorMap: () => ({ message: 'decision must be approved or rejected' }),
    }),
    reviewNotes: optionalString(5000),
  })
  .strip();

// ─── FORM SUBMISSION: REQUEST EDIT ──────────────────────────────
export const requestEditSchema = z
  .object({
    notes: z.string().min(1, 'Notes are required').max(5000).trim(),
  })
  .strip();
