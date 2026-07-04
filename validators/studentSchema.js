import { z } from 'zod';
import {
  objectId,
  optionalObjectId,
  phone10,
  optionalPhone,
  optionalPhoneIntl,
  optionalEmail,
  optionalUri,
  academicYear,
  optionalString,
  bloodGroupEnum,
  genderEnum,
} from './zodHelpers.js';

// Parent subdocument schema
const parentSchema = z.object({
  _id: z.string().optional(), // Preserve MongoDB subdocument ID on update
  name: z
    .string()
    .min(1, 'Parent/guardian name is required')
    .max(100, 'Parent name must not exceed 100 characters'),
  relationship: z.string().nullish().or(z.literal('')),
  phone: optionalPhoneIntl,
  email: optionalEmail,
  occupation: optionalString(100),
  isWhatsapp: z.boolean().nullish(),
  isParent: z.boolean().nullish(),
}).refine(
  (data) => {
    // When isParent is true, at least phone or email must be provided for parent app login
    if (data.isParent) {
      return !!(data.phone || data.email);
    }
    return true;
  },
  { message: 'Parent app access requires at least a phone number or email address', path: ['phone'] }
);

// Sibling subdocument schema
const siblingSchema = z
  .object({
    name: optionalString(100),
    age: z.number().int().nullish(),
    class: optionalString(50),
    school: optionalString(200),
    inSameSchool: z.boolean().nullish(),
    classId: optionalObjectId,
  })
  .passthrough(); // Allow extra fields (matches Joi .unknown(true))

// Single-file document
const singleDocSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Document name is required'),
  type: z.string().min(1, 'Document type is required'),
  url: z.string().url('Document URL must be a valid URL'),
  uploadDate: z.string().optional(),
  size: z.string().optional(),
  date: z.string().optional(),
  category: optionalString(100),
});

// Dual-side document (e.g., Aadhaar front/back)
const dualDocSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Document name is required'),
  type: z.string().min(1, 'Document type is required'),
  category: optionalString(100),
  front: z.object({
    url: z.string().url('Front side URL must be a valid URL'),
    uploadDate: z.string().optional(),
  }),
  back: z.object({
    url: z.string().url('Back side URL must be a valid URL'),
    uploadDate: z.string().optional(),
  }),
  uploadDate: z.string().optional(),
  size: z.string().optional(),
  date: z.string().optional(),
});

const documentSchema = z.union([singleDocSchema, dualDocSchema]);

// Health info subdocument schemas
const allergySchema = z.object({
  _id: z.string().optional(),
  name: z.string().min(1, 'Allergy name is required').max(100),
  type: z.enum(['food', 'medication', 'environmental', 'insect', 'latex', 'other']).nullish(),
  severity: z.enum(['mild', 'moderate', 'severe', 'life-threatening']).nullish(),
  reaction: optionalString(500),
  notes: optionalString(500),
});

const medicationSchema = z.object({
  _id: z.string().optional(),
  name: z.string().min(1, 'Medication name is required').max(100),
  dosage: optionalString(100),
  frequency: optionalString(100),
  startDate: optionalString(20),
  endDate: optionalString(20),
  prescribedBy: optionalString(100),
  notes: optionalString(500),
});

const healthEmergencyContactSchema = z.object({
  _id: z.string().optional(),
  name: z.string().min(1, 'Contact name is required').max(100),
  relationship: optionalString(50),
  phone: z.string().min(1, 'Phone is required'),
  alternatePhone: optionalString(20),
  email: optionalEmail,
  priority: z.number().int().min(1).nullish(),
});

const healthInfoSchema = z
  .object({
    allergies: z.array(allergySchema).nullish(),
    medications: z.array(medicationSchema).nullish(),
    emergencyContacts: z.array(healthEmergencyContactSchema).nullish(),
  })
  .nullish();

// Alumni info subdocument schema
const alumniInfoSchema = z
  .object({
    graduationYear: optionalString(20),
    since: z.string().nullish(), // ISO date string
    currentCity: optionalString(100),
    currentOccupation: optionalString(200),
    alumniEmail: optionalEmail,
    alumniPhone: optionalPhone,
    notes: optionalString(500),
  })
  .nullish();

// ─── CREATE STUDENT ─────────────────────────────────────────────
export const createStudentSchema = z
  .object({
    // Required fields
    name: z
      .string()
      .min(2, 'Student name must be at least 2 characters')
      .max(100, 'Student name must not exceed 100 characters')
      .trim(),
    // admissionId is optional on create — the route handler auto-generates one
    // per school (routes/students/createUpdate.js) when it's omitted. Requiring
    // it here blocked that auto-generation path.
    admissionId: z
      .string({ required_error: 'Admission ID is required' })
      .min(1, 'Admission ID is required')
      .max(50, 'Admission ID must not exceed 50 characters')
      .nullish(),
    academicYear: academicYear,
    classId: objectId,

    // Optional core
    rollNo: z
      .number()
      .int('Roll number must be a whole number')
      .min(1, 'Roll number must be at least 1')
      .nullish(),

    // Personal Information
    gender: genderEnum.nullish().or(z.literal('')),
    // dateOfBirth: YYYY-MM-DD or ISO-8601 — reject junk strings up to 20
    // chars that previously passed Zod and produced unhelpful 500s from
    // Mongoose validator.
    dateOfBirth: z
      .string()
      .max(20)
      .refine(
        (v) => !v || !isNaN(Date.parse(v)),
        'dateOfBirth must be a valid date (YYYY-MM-DD)'
      )
      .nullish()
      .or(z.literal('')),
    bloodGroup: bloodGroupEnum.nullish().or(z.literal('')),
    nationality: optionalString(50),
    religion: optionalString(50),
    category: optionalString(50),
    motherTongue: optionalString(50),
    aadhaarNumber: z
      .string()
      .regex(/^[0-9]{12}$/, 'Aadhaar number must be exactly 12 digits')
      .nullish()
      .or(z.literal('')),

    // Contact Information
    phone: optionalPhoneIntl,
    email: optionalEmail,
    address: optionalString(500),
    city: optionalString(100),
    state: optionalString(100),
    zipCode: z
      .string()
      .regex(/^\d{6}$/, 'PIN/ZIP code must be exactly 6 digits')
      .nullish()
      .or(z.literal('')),
    isWhatsapp: z.boolean().nullish(),
    whatsappNumber: optionalPhoneIntl,

    // Parents/Guardians array
    parents: z.array(parentSchema).min(1, 'At least one parent or guardian is required'),

    // Siblings
    siblings: z.array(siblingSchema).nullish(),

    // Academic Information
    previousSchool: optionalString(200),
    tcNumber: optionalString(50),
    mediumOfInstruction: optionalString(50),
    house: optionalString(50),

    // Health & Safety (legacy flat fields)
    medicalConditions: optionalString(500),
    emergencyContactName: optionalString(100),
    emergencyContactPhone: optionalPhoneIntl,

    // Detailed Health Records
    healthInfo: healthInfoSchema,

    // Requirements
    transportRequired: z.boolean().nullish(),
    hostelRequired: z.boolean().nullish(),

    // Status — feeStatus is deliberately NOT client-settable. It's derived
    // from StudentFeeStructure.overallStatus and only mutated via payment /
    // refund / structure-resync code paths. Any incoming feeStatus is
    // stripped by .strip() below.
    status: z.enum(['active', 'inactive', 'graduated', 'transferred', 'alumni']).default('active'),

    // Documents & Photo
    documents: z.array(documentSchema).nullish(),
    photo: optionalUri,

    // Alumni Information
    alumniInfo: alumniInfoSchema,
  })
  .strip(); // Strip unknown fields (equivalent to Joi stripUnknown)

// ─── UPDATE STUDENT (all fields optional) ───────────────────────
// Schema for POST /:id/documents
export const addDocumentSchema = z
  .object({
    name: z.string().min(1, 'Document name is required').max(200),
    type: z.string().min(1, 'Document type is required').max(100),
    url: z.string().url('Document URL must be a valid URL').optional(),
    uploadDate: z.string().optional(),
    size: z.string().optional(),
    category: optionalString(100),
    front: z
      .object({
        url: z.string().url('Front side URL must be a valid URL'),
        uploadDate: z.string().optional(),
      })
      .optional(),
    back: z
      .object({
        url: z.string().url('Back side URL must be a valid URL'),
        uploadDate: z.string().optional(),
      })
      .optional(),
  })
  .strip();

export const updateStudentSchema = createStudentSchema
  .partial() // All fields become optional
  .omit({ academicYear: true }) // academicYear shouldn't change on update
  .extend({
    // On update, parents can be omitted (undefined) or null — both mean "don't change parents".
    // When explicitly provided as an array, at least 1 parent is still required.
    // .partial() only adds undefined (not null), so .nullish() is needed here explicitly.
    parents: z.array(parentSchema).min(1, 'At least one parent or guardian is required').nullish(),
    // Teacher-assessed student ratings (Mixed/freeform object)
    ratings: z.record(z.any()).optional(),
    // Optimistic locking: client sends the updatedAt it loaded; server rejects if stale
    clientUpdatedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strip();
