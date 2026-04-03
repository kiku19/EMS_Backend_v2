import { z } from 'zod';
import {
  objectId,
  optionalObjectId,
  optionalPhone,
  optionalEmail,
  optionalUri,
  dateString,
  optionalString,
  bloodGroupEnum,
  genderEnum,
} from './zodHelpers.js';

// Role normalization: accept string or array, always output array
const roleField = z
  .union([
    z.string().max(50, 'Role must not exceed 50 characters'),
    z
      .array(z.string().max(50, 'Each role must not exceed 50 characters'))
      .min(1, 'At least one role is required'),
  ])
  .transform((val) => (Array.isArray(val) ? val : [val]));

// StaffType normalization: accept string or array, always output array (or null)
const staffTypeField = z
  .union([z.string(), z.array(z.string())])
  .nullish()
  .or(z.literal(''))
  .transform((val) => {
    if (val === null || val === '' || val === undefined) return val;
    return Array.isArray(val) ? val : [val];
  });

// ID document subdocument
const idDocumentSchema = z.object({
  type: optionalString(100),
  url: optionalUri,
  name: optionalString(200),
});

// Professional qualification subdocument
const qualificationSchema = z.object({
  name: z.string().min(1, 'Qualification name is required'),
  year: z
    .string()
    .regex(/^\d{4}$/, 'Year must be a 4-digit number')
    .nullish()
    .or(z.literal('')),
  documents: z.array(z.string().url('Document must be a valid URL')).optional(),
});

// Salary breakdown component
const salaryComponentSchema = z.object({
  component: z.string().min(1, 'Salary component name is required'),
  amount: z.number().min(0, 'Salary component amount cannot be negative').max(10000000, 'Salary component amount cannot exceed 10,000,000'),
});

// Emergency contact subdocument
const emergencyContactSchema = z.object({
  name: optionalString(100),
  relationship: optionalString(50),
  phone: optionalPhone,
});

// ─── CREATE STAFF ───────────────────────────────────────────────
export const createStaffSchema = z
  .object({
    // Required fields
    name: z
      .string()
      .min(2, 'Staff name must be at least 2 characters')
      .max(100, 'Staff name must not exceed 100 characters')
      .trim(),
    role: roleField,

    // Optional core
    department: optionalString(50),
    status: z.enum(['active', 'inactive', 'on-leave', 'suspended', 'terminated']).default('active'),
    phone: optionalPhone,
    email: optionalEmail,
    joinDate: dateString.nullish().or(z.literal('')),
    address: optionalString(500),
    assignedClassId: optionalObjectId,
    reporterId: optionalObjectId,

    // Personal Details
    dob: dateString.nullish().or(z.literal('')),
    gender: genderEnum
      .nullish()
      .or(z.literal(''))
      .transform((v) => v || undefined),
    fatherName: optionalString(100),
    bloodGroup: bloodGroupEnum
      .nullish()
      .or(z.literal(''))
      .transform((v) => v || undefined),
    maritalStatus: z
      .enum(['Single', 'Married', 'Divorced', 'Widowed'])
      .nullish()
      .or(z.literal(''))
      .transform((v) => v || undefined),
    employmentType: optionalString(50),
    nationality: optionalString(50),

    // Emergency contacts (deprecated single fields)
    emergencyContact: optionalString(100),
    emergencyPhone: optionalPhone,

    // Emergency contacts (new array format)
    emergencyContacts: z.array(emergencyContactSchema).nullish().refine(
      (contacts) => {
        if (!contacts || contacts.length <= 1) return true;
        const seen = new Set();
        for (const c of contacts) {
          if (!c.name && !c.phone) continue;
          const key = `${(c.name || '').toLowerCase().trim()}-${(c.phone || '').trim()}`;
          if (seen.has(key)) return false;
          seen.add(key);
        }
        return true;
      },
      { message: 'Duplicate emergency contacts (same name and phone) are not allowed' }
    ),

    // WhatsApp
    whatsappNumber: optionalPhone,
    isWhatsapp: z.boolean().nullish(),

    // Documents
    picture: optionalUri,
    idDocuments: z.array(idDocumentSchema).nullish(),
    customDocuments: z.array(z.string().url()).nullish(),

    // Qualifications
    professionalQualifications: z.array(qualificationSchema).nullish(),
    totalExperience: optionalString(50),
    previousOrganization: optionalString(100),
    roleInOrganization: optionalString(100),
    qualificationDocs: z.array(z.string().url()).nullish(),
    qualification: optionalString(200),
    experience: z.number().min(0, 'Years of experience cannot be negative').nullish(),

    // Staff Info
    staffNumber: optionalString(50),
    staffId: optionalString(50), // Allowed but ignored — frontend sometimes sends it
    staffType: staffTypeField,
    assignedClasses: z.array(z.string()).nullish(),
    isClassTeacher: z.boolean().nullish(),
    classTeacherOf: optionalString(50),
    shift: z.enum(['Morning', 'Afternoon', 'Evening', 'Full Day']).nullish().or(z.literal('')),
    designation: optionalString(100),

    // Bank & Salary
    accountNumber: optionalString(50),
    ifscCode: z
      .string()
      .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC code')
      .nullish()
      .or(z.literal('')),
    bankName: optionalString(100),
    branchName: optionalString(100),
    panNumber: z
      .string()
      .regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Invalid PAN number')
      .nullish()
      .or(z.literal('')),
    salaryTemplate: optionalString(100),
    salary: z.number().min(0, 'Salary cannot be negative').nullish(),
    salaryBreakdown: z.array(salaryComponentSchema).nullish(),
  })
  .strip(); // Strip unknown fields

// ─── UPDATE STAFF (all fields optional + extra fields) ──────────
export const updateStaffSchema = createStaffSchema
  .partial()
  .extend({
    // Update-only fields
    username: optionalString(50),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(50, 'Password must not exceed 50 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
      .regex(/[0-9]/, 'Password must contain at least one number')
      .nullish()
      .or(z.literal('')),
    status: z.enum(['active', 'inactive', 'on-leave', 'suspended', 'terminated']).optional(),
  })
  .strip();

// ─── TEACHER ASSIGNMENT: CREATE / UPDATE ────────────────────────
export const teacherAssignmentSchema = z
  .object({
    teacherId: objectId,
    subject: z.string().min(1, 'Subject is required').max(100).trim(),
    classIds: z.array(objectId).min(1, 'At least one class is required'),
  })
  .strip();
