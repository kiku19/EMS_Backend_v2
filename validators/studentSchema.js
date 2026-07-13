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
  dateString,
  optionalString,
  bloodGroupEnum,
  genderEnum,
} from './zodHelpers.js';

// Parent subdocument schema
const parentSchema = z
  .object({
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
  })
  .refine(
    (data) => {
      // When isParent is true, at least phone or email must be provided for parent app login
      if (data.isParent) {
        return !!(data.phone || data.email);
      }
      return true;
    },
    {
      message: 'Parent app access requires at least a phone number or email address',
      path: ['phone'],
    }
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
  .passthrough() // Allow extra fields (matches Joi .unknown(true))
  .refine((sibling) => sibling.inSameSchool !== true || Boolean(sibling.classId), {
    message: 'Class is required when sibling is in the same school',
    path: ['classId'],
  });

const documentSize = z.union([z.number().nonnegative(), z.string().max(50)]).optional();

// Single-file document
const singleDocSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Document name is required'),
  type: z.string().min(1, 'Document type is required'),
  url: z.string().url('Document URL must be a valid URL'),
  uploadDate: z.string().optional(),
  size: documentSize,
  date: z.string().optional(),
  category: optionalString(100),
});

// Dual-side document (e.g., Aadhaar front/back)
const documentSideSchema = z.object({
  url: z.string().url('Document side URL must be a valid URL'),
  uploadDate: z.string().optional(),
});

const dualDocSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().min(1, 'Document name is required'),
    type: z.string().min(1, 'Document type is required'),
    category: optionalString(100),
    front: documentSideSchema.optional(),
    back: documentSideSchema.optional(),
    uploadDate: z.string().optional(),
    size: documentSize,
    date: z.string().optional(),
  })
  .refine((document) => Boolean(document.front || document.back), {
    message: 'At least one document side is required',
    path: ['front'],
  });

const documentSchema = z.union([singleDocSchema, dualDocSchema]);

const commaSeparatedEnum = (values, label) =>
  z
    .string()
    .max(300)
    .refine(
      (value) =>
        value === 'all' ||
        value
          .split(',')
          .filter(Boolean)
          .every((entry) => values.includes(entry)),
      `${label} contains an unsupported value`
    );

export const studentListQuerySchema = z
  .object({
    classId: objectId.optional(),
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(0).max(100).optional().default(50),
    search: z.string().max(100).optional().default(''),
    status: commaSeparatedEnum(
      ['active', 'inactive', 'graduated', 'transferred', 'alumni'],
      'status'
    )
      .optional()
      .default('all'),
    feeStatus: commaSeparatedEnum(['paid', 'pending', 'partial', 'overdue'], 'feeStatus')
      .optional()
      .default('all'),
    academicYear: z
      .string()
      .max(100)
      .refine(
        (value) =>
          value === 'all' || value.split(',').every((entry) => /^\d{4}-\d{2}$/.test(entry)),
        'academicYear must contain YYYY-YY values'
      )
      .optional()
      .default('all'),
    sortBy: z.enum(['name', 'rollNo', 'class']).optional().default('name'),
    sortOrder: z.enum(['asc', 'desc', 'ascending', 'descending']).optional().default('asc'),
  })
  .strip();

// Transfer certificates are legal records. Validate every persisted field at
// the route boundary so malformed dates/counts cannot be written and so the
// schema stays aligned with Student.transferCertificate.
export const transferCertificateSchema = z
  .object({
    tcNumber: z
      .string()
      .trim()
      .min(1, 'TC number is required')
      .max(100, 'TC number must not exceed 100 characters'),
    issueDate: dateString.refine((value) => {
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    }, 'Issue date must be a valid calendar date'),
    reasonForLeaving: optionalString(500).default(''),
    lastClassAttended: optionalString(100).default(''),
    daysPresent: z.number().int().nonnegative().optional(),
    workingDays: z.number().int().nonnegative().optional(),
    generalConduct: optionalString(100).default('Good'),
    remarks: optionalString(1000).default(''),
  })
  .strict()
  .superRefine(({ daysPresent, workingDays }, ctx) => {
    if (daysPresent != null && workingDays != null && daysPresent > workingDays) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['daysPresent'],
        message: 'Days present cannot exceed working days',
      });
    }
  });

export const studentIdParamSchema = z.object({ id: objectId }).strict();

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
    admissionDate: z.coerce.date().nullish().or(z.literal('')),
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
      .refine((v) => !v || !isNaN(Date.parse(v)), 'dateOfBirth must be a valid date (YYYY-MM-DD)')
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
    alternatePhone: optionalPhoneIntl, // captured by ContactSection; mirrors Student.alternatePhone
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
    // Legacy flat allergies list (free-text strings). CreateStudentComposer
    // sends a top-level `allergies: [string]`; the structured home is
    // healthInfo.allergies. Kept here so the legacy capture persists.
    allergies: z.array(z.string()).nullish(),
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
  // NOTE: academicYear is intentionally retained on update. The PUT handler
  // (routes/students/createUpdate.js) has academicYear-change logic — roll-no
  // re-uniqueness check, fee-structure migration — that was previously dead
  // because this field was omitted here and stripped before the handler ran.
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
