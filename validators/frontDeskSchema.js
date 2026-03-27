import { z } from 'zod';
import { objectId, optionalObjectId, optionalEmail, optionalString } from './zodHelpers.js';

// ─── Shared enums ────────────────────────────────────────────────
const visitPurposeEnum = z.enum(
  [
    'PARENT_MEETING',
    'STUDENT_PICKUP_DROP_OFF',
    'SCHOOL_VISIT_INQUIRY',
    'DELIVERY_VENDOR',
    'OFFICIAL_BUSINESS',
    'VOLUNTEER_EVENT',
    'OTHER',
  ],
  { errorMap: () => ({ message: 'Invalid visit purpose' }) }
);

const gatePassReasonEnum = z.enum(
  [
    'MEDICAL_EMERGENCY',
    'FAMILY_EMERGENCY',
    'SPECIAL_EVENT',
    'EARLY_DISMISSAL',
    'SUSPENSION_EXPULSION',
    'OTHER',
  ],
  { errorMap: () => ({ message: 'Invalid gate pass reason' }) }
);

const leavingWithEnum = z.enum(['PARENTS', 'OTHERS'], {
  errorMap: () => ({ message: 'leavingWith must be PARENTS or OTHERS' }),
});

const approvedByEnum = z.enum(['CLASS_TEACHER', 'FRONT_OFFICE', 'PRINCIPAL', 'OTHER'], {
  errorMap: () => ({ message: 'Invalid approvedBy value' }),
});

const parentTypeEnum = z.enum(['FATHER', 'MOTHER', 'GUARDIAN'], {
  errorMap: () => ({ message: 'parentType must be FATHER, MOTHER, or GUARDIAN' }),
});

// ─── VISITOR: CREATE (check-in) ─────────────────────────────────
export const createVisitorSchema = z
  .object({
    name: z.string().min(1, 'Visitor name is required').max(100).trim(),
    phone: z
      .string()
      .regex(/^[0-9+\-\s()]{7,20}$/, 'Phone must be 7–20 characters with valid characters')
      .refine(
        (val) => {
          const digits = val.replace(/\D/g, '');
          return digits.length >= 7 && digits.length <= 15;
        },
        { message: 'Phone must contain 7–15 digits' }
      )
      .refine((val) => !/^(\d)\1{9,}$/.test(val.replace(/\D/g, '')), {
        message: 'Phone number cannot be all repeated digits',
      }),
    email: optionalEmail,
    photoUrl: optionalString(500),
    purpose: visitPurposeEnum,
    whomToMeet: optionalString(200),
    department: optionalString(100),
    studentId: optionalObjectId,
    gatePassRequired: z.boolean().optional().default(false),
    appointmentRequired: z.boolean().optional().default(false),
    admissionInquiry: z.boolean().optional().default(false),
    companyName: optionalString(200),
    deliveryPerson: optionalString(100),
    otherPurpose: optionalString(500),
    itemsDeclared: optionalString(1000),
    notes: optionalString(2000),
  })
  .strip();

// ─── VISITOR: UPDATE ────────────────────────────────────────────
export const updateVisitorSchema = z
  .object({
    name: z.string().min(1).max(100).trim().optional(),
    phone: z
      .string()
      .regex(/^[0-9+\-\s()]{7,20}$/, 'Phone must be 7–20 characters with valid characters')
      .optional(),
    email: optionalEmail,
    photoUrl: optionalString(500),
    whomToMeet: optionalString(200),
    department: optionalString(100),
    notes: optionalString(2000),
  })
  .strip();

// ─── VISITOR: CHECK-OUT ─────────────────────────────────────────
export const checkOutVisitorSchema = z
  .object({
    notes: optionalString(2000),
  })
  .strip();

// ─── GATE PASS: CREATE ──────────────────────────────────────────
export const createGatePassSchema = z
  .object({
    studentId: objectId,
    reason: gatePassReasonEnum,
    otherReason: optionalString(500),
    leavingDate: z.string().min(1, 'Leaving date is required'),
    leavingTime: z.string().min(1, 'Leaving time is required').max(10),
    expectedReturnDate: z.string().optional().nullable(),
    expectedReturnTime: z.string().max(10).optional().nullable(),
    leavingWith: leavingWithEnum,
    parentType: parentTypeEnum.optional(),
    escortName: optionalString(100),
    escortRelation: optionalString(100),
    escortPhone: optionalString(20),
    escortIdProof: optionalString(200),
    approvedBy: approvedByEnum,
    notes: optionalString(2000),
  })
  .strip();

// ─── GATE PASS: UPDATE ──────────────────────────────────────────
export const updateGatePassSchema = z
  .object({
    reason: gatePassReasonEnum.optional(),
    otherReason: optionalString(500),
    leavingDate: z.string().optional(),
    leavingTime: z.string().max(10).optional(),
    expectedReturnDate: z.string().optional().nullable(),
    expectedReturnTime: z.string().max(10).optional().nullable(),
    leavingWith: leavingWithEnum.optional(),
    parentType: parentTypeEnum.optional().nullable(),
    escortName: optionalString(100),
    escortRelation: optionalString(100),
    escortPhone: optionalString(20),
    escortIdProof: optionalString(200),
    approvedBy: approvedByEnum.optional(),
    notes: optionalString(2000),
    // Allow status only for ACTIVE -> CANCELLED transition (route enforces this)
    status: z.enum(['ACTIVE', 'USED', 'EXPIRED', 'CANCELLED']).optional(),
    approvalStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  })
  .strip();
