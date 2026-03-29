import { z } from 'zod';
import {
  optionalPhone,
  optionalEmail,
  optionalUri,
  optionalString,
  bloodGroupEnum,
} from '../../validators/zodHelpers.js';

/**
 * Staff Profile Validation Middleware
 *
 * Validates staff profile updates from mobile app.
 * Ensures only allowed fields are edited (self-service updates).
 *
 * SECURITY: Blocks admin-only fields like salary, roles, department, etc.
 */

// Fields allowed for self-service profile updates
export const ALLOWED_SELF_UPDATE_FIELDS = [
  'phone',
  'email',
  'whatsappNumber',
  'isWhatsapp',
  'bloodGroup',
  'maritalStatus',
  'address',
  'emergencyContacts',
  'qualification',
  'experience',
  'picture',
];

// Fields that require admin privileges (BLOCKED for self-service)
export const ADMIN_ONLY_FIELDS = [
  'salary',
  'roles',
  'role',
  'department',
  'employmentStatus',
  'employmentType',
  'status',
  'staffNumber',
  'staffId',
  'qualifications',
  'professionalQualifications',
  'salaryBreakdown',
  'salaryTemplate',
  'accountNumber',
  'ifscCode',
  'bankName',
  'branchName',
  'assignedClasses',
  'isClassTeacher',
  'classTeacherOf',
  'staffType',
  'expertise',
  'assignedClassId',
  'reporterId',
  'joinDate',
  'name',
  'fullName',
];

// Emergency contact Zod schema
const emergencyContactSchema = z.object({
  name: optionalString(100),
  relationship: optionalString(50),
  phone: optionalPhone,
});

/**
 * Staff Profile Update Zod Schema
 * Validates fields that staff can update themselves
 */
export const staffProfileUpdateSchema = z
  .object({
    phone: optionalPhone,
    email: optionalEmail,
    whatsappNumber: optionalPhone,
    isWhatsapp: z.boolean().optional(),
    bloodGroup: bloodGroupEnum
      .nullish()
      .or(z.literal(''))
      .transform((v) => v || undefined),
    maritalStatus: z
      .enum(['Single', 'Married', 'Divorced', 'Widowed'])
      .nullish()
      .or(z.literal(''))
      .transform((v) => v || undefined),
    address: optionalString(200),
    emergencyContacts: z.array(emergencyContactSchema).max(5).nullable().optional(),
    qualification: optionalString(200),
    experience: z.number().int().min(0).max(60).nullable().optional(),
    picture: optionalUri,
  })
  .strip();

/**
 * Middleware: Validate staff profile update data
 */
export function validateStaffProfileUpdate(req, res, next) {
  const updateData = req.body;

  if (!updateData || Object.keys(updateData).length === 0) {
    return res.status(400).json({
      error: 'No update data provided',
      message: 'At least one field must be provided for update',
    });
  }

  // Check for admin-only fields (SECURITY CHECK)
  const restrictedFields = Object.keys(updateData).filter((field) =>
    ADMIN_ONLY_FIELDS.includes(field)
  );

  if (restrictedFields.length > 0) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Cannot modify admin-only fields',
      restrictedFields,
      allowedFields: ALLOWED_SELF_UPDATE_FIELDS,
    });
  }

  // Filter to only allowed fields
  const sanitizedData = {};
  ALLOWED_SELF_UPDATE_FIELDS.forEach((field) => {
    if (updateData[field] !== undefined) {
      sanitizedData[field] = updateData[field];
    }
  });

  const result = staffProfileUpdateSchema.safeParse(sanitizedData);

  if (!result.success) {
    const errors = result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));

    return res.status(400).json({
      error: 'Validation failed',
      details: errors,
    });
  }

  req.body = result.data;
  next();
}

/**
 * Middleware: Check if request contains admin-only fields
 */
export function blockAdminOnlyFields(req, res, next) {
  const data = req.body;

  if (!data || Object.keys(data).length === 0) {
    return next();
  }

  const restrictedFields = Object.keys(data).filter((field) => ADMIN_ONLY_FIELDS.includes(field));

  if (restrictedFields.length > 0) {
    return res.status(403).json({
      error: 'Access denied',
      message: 'You do not have permission to modify these fields',
      restrictedFields,
      allowedFields: ALLOWED_SELF_UPDATE_FIELDS,
    });
  }

  next();
}

/**
 * Function: Validate and sanitize profile update data (non-middleware)
 */
export function validateProfileUpdateData(updateData) {
  if (!updateData || Object.keys(updateData).length === 0) {
    throw new Error('No update data provided');
  }

  const restrictedFields = Object.keys(updateData).filter((field) =>
    ADMIN_ONLY_FIELDS.includes(field)
  );

  if (restrictedFields.length > 0) {
    throw new Error(`Cannot modify admin-only fields: ${restrictedFields.join(', ')}`);
  }

  const sanitizedData = {};
  ALLOWED_SELF_UPDATE_FIELDS.forEach((field) => {
    if (updateData[field] !== undefined) {
      sanitizedData[field] = updateData[field];
    }
  });

  const result = staffProfileUpdateSchema.safeParse(sanitizedData);

  if (!result.success) {
    const errors = result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    const errorMessages = errors.map((e) => `${e.field}: ${e.message}`).join('\n');
    throw new Error(`Validation failed:\n${errorMessages}`);
  }

  return result.data;
}

/**
 * Function: Check if request contains admin-only fields
 */
export function hasRestrictedFields(data) {
  if (!data || !Object.keys(data).length) {
    return false;
  }
  return Object.keys(data).filter((field) => ADMIN_ONLY_FIELDS.includes(field)).length > 0;
}

/**
 * Function: Get list of restricted fields from data
 */
export function getRestrictedFields(data) {
  if (!data || !Object.keys(data).length) {
    return [];
  }
  return Object.keys(data).filter((field) => ADMIN_ONLY_FIELDS.includes(field));
}

export default {
  validateStaffProfileUpdate,
  blockAdminOnlyFields,
  validateProfileUpdateData,
  hasRestrictedFields,
  getRestrictedFields,
  ALLOWED_SELF_UPDATE_FIELDS,
  ADMIN_ONLY_FIELDS,
  staffProfileUpdateSchema,
};
