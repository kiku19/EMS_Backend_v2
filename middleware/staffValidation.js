import Joi from 'joi';

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
  'bloodGroup',
  'maritalStatus',
  'address',
  'emergencyContacts',
  'picture'
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
  'fullName'
];

/**
 * Emergency Contact Schema
 * Validates individual emergency contact entries
 */
const emergencyContactSchema = Joi.object({
  name: Joi.string().required().min(2).max(100).trim().messages({
    'string.empty': 'Emergency contact name is required',
    'string.min': 'Name must be at least 2 characters',
    'string.max': 'Name cannot exceed 100 characters'
  }),
  relationship: Joi.string().required().max(50).trim().messages({
    'string.empty': 'Relationship is required',
    'string.max': 'Relationship cannot exceed 50 characters'
  }),
  phone: Joi.string().required().pattern(/^[0-9]{10}$/).messages({
    'string.empty': 'Emergency contact phone is required',
    'string.pattern.base': 'Phone number must be 10 digits'
  })
});

/**
 * Staff Profile Update Schema
 * Validates fields that staff can update themselves
 */
export const staffProfileUpdateSchema = Joi.object({
  // Contact Information
  phone: Joi.string().pattern(/^[0-9]{10}$/).allow('', null).messages({
    'string.pattern.base': 'Phone number must be 10 digits'
  }),
  email: Joi.string().email().allow('', null).messages({
    'string.email': 'Invalid email format'
  }),
  whatsappNumber: Joi.string().pattern(/^[0-9]{10}$/).allow('', null).messages({
    'string.pattern.base': 'WhatsApp number must be 10 digits'
  }),

  // Personal Information
  bloodGroup: Joi.string().valid('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-').allow('', null).messages({
    'any.only': 'Invalid blood group. Must be one of: A+, A-, B+, B-, AB+, AB-, O+, O-'
  }),
  maritalStatus: Joi.string().valid('Single', 'Married', 'Divorced', 'Widowed').allow('', null).messages({
    'any.only': 'Invalid marital status. Must be one of: Single, Married, Divorced, Widowed'
  }),
  address: Joi.string().max(200).allow('', null).trim().messages({
    'string.max': 'Address cannot exceed 200 characters'
  }),

  // Emergency Contacts
  emergencyContacts: Joi.array().items(emergencyContactSchema).min(1).max(5).allow(null).messages({
    'array.min': 'At least one emergency contact is required',
    'array.max': 'Cannot have more than 5 emergency contacts'
  }),

  // Profile Picture
  picture: Joi.string().uri().allow('', null).messages({
    'string.uri': 'Picture must be a valid URL'
  })
}).min(1).messages({
  'object.min': 'At least one field must be provided for update'
});

/**
 * Middleware: Validate staff profile update data
 *
 * Checks:
 * 1. Only allowed fields are present
 * 2. Field values match validation rules
 * 3. No admin-only fields are included
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
export function validateStaffProfileUpdate(req, res, next) {
  const updateData = req.body;

  // Check if update data exists
  if (!updateData || Object.keys(updateData).length === 0) {
    return res.status(400).json({
      error: 'No update data provided',
      message: 'At least one field must be provided for update'
    });
  }

  // Check for admin-only fields (SECURITY CHECK)
  const restrictedFields = Object.keys(updateData).filter(
    field => ADMIN_ONLY_FIELDS.includes(field)
  );

  if (restrictedFields.length > 0) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Cannot modify admin-only fields',
      restrictedFields,
      allowedFields: ALLOWED_SELF_UPDATE_FIELDS
    });
  }

  // Filter to only allowed fields
  const sanitizedData = {};
  ALLOWED_SELF_UPDATE_FIELDS.forEach(field => {
    if (updateData[field] !== undefined) {
      sanitizedData[field] = updateData[field];
    }
  });

  // Validate the sanitized data against schema
  const { error, value } = staffProfileUpdateSchema.validate(sanitizedData, {
    abortEarly: false, // Get all errors, not just the first one
    stripUnknown: true, // Remove any unknown fields
    allowUnknown: false // Reject unknown fields
  });

  if (error) {
    const errors = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message
    }));

    return res.status(400).json({
      error: 'Validation failed',
      details: errors
    });
  }

  // Replace request body with validated and sanitized data
  req.body = value;

  next();
}

/**
 * Middleware: Check if request contains admin-only fields
 *
 * Use this to explicitly check for restricted fields before processing.
 * Returns 403 if any restricted fields are found.
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
export function blockAdminOnlyFields(req, res, next) {
  const data = req.body;

  if (!data || Object.keys(data).length === 0) {
    return next();
  }

  const restrictedFields = Object.keys(data).filter(
    field => ADMIN_ONLY_FIELDS.includes(field)
  );

  if (restrictedFields.length > 0) {
    return res.status(403).json({
      error: 'Access denied',
      message: 'You do not have permission to modify these fields',
      restrictedFields,
      allowedFields: ALLOWED_SELF_UPDATE_FIELDS
    });
  }

  next();
}

/**
 * Function: Validate and sanitize profile update data
 *
 * Use this for manual validation (not as middleware).
 * Returns validated data or throws error.
 *
 * @param {Object} updateData - Raw update data
 * @returns {Object} Validated and sanitized data
 * @throws {Error} If validation fails
 */
export function validateProfileUpdateData(updateData) {
  if (!updateData || Object.keys(updateData).length === 0) {
    throw new Error('No update data provided');
  }

  // Check for admin-only fields
  const restrictedFields = Object.keys(updateData).filter(
    field => ADMIN_ONLY_FIELDS.includes(field)
  );

  if (restrictedFields.length > 0) {
    throw new Error(`Cannot modify admin-only fields: ${restrictedFields.join(', ')}`);
  }

  // Filter to only allowed fields
  const sanitizedData = {};
  ALLOWED_SELF_UPDATE_FIELDS.forEach(field => {
    if (updateData[field] !== undefined) {
      sanitizedData[field] = updateData[field];
    }
  });

  // Validate against schema
  const { error, value } = staffProfileUpdateSchema.validate(sanitizedData, {
    abortEarly: false,
    stripUnknown: true
  });

  if (error) {
    const errors = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message
    }));

    const errorMessages = errors.map(e => `${e.field}: ${e.message}`).join('\n');
    throw new Error(`Validation failed:\n${errorMessages}`);
  }

  return value;
}

/**
 * Function: Check if request contains admin-only fields
 *
 * Use this to check if data contains restricted fields.
 * Returns true if restricted fields are found.
 *
 * @param {Object} data - Data to check
 * @returns {boolean} True if contains restricted fields
 */
export function hasRestrictedFields(data) {
  if (!data || !Object.keys(data).length) {
    return false;
  }

  const restrictedFields = Object.keys(data).filter(
    field => ADMIN_ONLY_FIELDS.includes(field)
  );

  return restrictedFields.length > 0;
}

/**
 * Function: Get list of restricted fields from data
 *
 * Returns array of field names that are restricted.
 *
 * @param {Object} data - Data to check
 * @returns {Array<string>} Array of restricted field names
 */
export function getRestrictedFields(data) {
  if (!data || !Object.keys(data).length) {
    return [];
  }

  return Object.keys(data).filter(field => ADMIN_ONLY_FIELDS.includes(field));
}

export default {
  validateStaffProfileUpdate,
  blockAdminOnlyFields,
  validateProfileUpdateData,
  hasRestrictedFields,
  getRestrictedFields,
  ALLOWED_SELF_UPDATE_FIELDS,
  ADMIN_ONLY_FIELDS,
  staffProfileUpdateSchema
};
