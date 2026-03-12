import Joi from 'joi';

// Validation schemas
export const schemas = {
  // Authentication
  signup: Joi.object({
    name: Joi.string().required().min(2).max(100).trim(),
    email: Joi.string().email().required(),
    schoolName: Joi.string().required().min(2).max(200).trim(),
    password: Joi.string().required().min(8).max(128),
    inviteToken: Joi.string().required(),
  }),

  login: Joi.object({
    phone: Joi.string().pattern(/^[0-9]{10}$/).messages({
      'string.pattern.base': 'Phone number must be 10 digits'
    }),
    email: Joi.string().email(),
    password: Joi.string().required().min(8).max(128),
    schoolId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).allow('', null),
    schoolCode: Joi.string().max(40).allow('', null),
  }).xor('phone', 'email'), // Must have either phone or email, not both

  superAdminCreateSchool: Joi.object({
    schoolName: Joi.string().required().min(2).max(200).trim(),
    schoolCode: Joi.string().max(40).allow('', null),
    contactEmail: Joi.string().email().allow('', null),
    contactPhone: Joi.string().max(20).allow('', null),
    plan: Joi.string().valid('starter', 'growth', 'enterprise').default('starter'),
    planStatus: Joi.string().valid('trialing', 'active', 'past_due', 'cancelled').default('trialing'),
    trialEndsAt: Joi.date().iso().allow(null),
    frontendUrl: Joi.string().uri().allow('', null),
    backendUrl: Joi.string().uri().allow('', null),
    adminName: Joi.string().required().min(2).max(100).trim(),
    adminEmail: Joi.string().email().required(),
    adminPassword: Joi.string().min(8).max(50).allow('', null),
    schoolSettings: Joi.object().default({})
  }),

  superAdminUpdateSchool: Joi.object({
    schoolName: Joi.string().min(2).max(200).trim(),
    schoolCode: Joi.string().max(40).allow('', null),
    status: Joi.string().valid('active', 'inactive'),
    contactEmail: Joi.string().email().allow('', null),
    contactPhone: Joi.string().max(20).allow('', null),
    plan: Joi.string().valid('starter', 'growth', 'enterprise'),
    planStatus: Joi.string().valid('trialing', 'active', 'past_due', 'cancelled'),
    trialEndsAt: Joi.date().iso().allow(null),
    frontendUrl: Joi.string().uri().allow('', null),
    backendUrl: Joi.string().uri().allow('', null)
  }).min(1),

  superAdminProvisionSchool: Joi.object({
    adminName: Joi.string().min(2).max(100).trim().allow('', null),
    adminEmail: Joi.string().email().allow('', null),
    adminPassword: Joi.string().min(8).max(50).allow('', null),
    contactPhone: Joi.string().max(20).allow('', null),
    schoolSettings: Joi.object().default({})
  }),

  // Staff creation
  createStaff: Joi.object({
    name: Joi.string().required().min(2).max(100).trim(),
    role: Joi.alternatives().try(
      Joi.string().required().max(50),
      Joi.array().items(Joi.string().max(50)).min(1).required()
    ).required(),
    department: Joi.string().max(50),
    status: Joi.string().valid('active', 'inactive', 'on-leave').default('active'),
    phone: Joi.string().pattern(/^[0-9]{10}$/).allow('', null),
    email: Joi.string().email().allow('', null),
    joinDate: Joi.string().allow('', null),
    address: Joi.string().max(500).allow('', null),
    assignedClassId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).allow(null),
    reporterId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).allow(null),

    // Personal Details
    dob: Joi.string().allow('', null),
    gender: Joi.string().valid('Male', 'Female', 'Other').allow('', null),
    fatherName: Joi.string().max(100).allow('', null),
    bloodGroup: Joi.string().valid('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-').allow('', null),
    maritalStatus: Joi.string().valid('Single', 'Married', 'Divorced', 'Widowed').allow('', null),
    employmentType: Joi.string().allow('', null),
    emergencyContact: Joi.string().max(100).allow('', null),
    emergencyPhone: Joi.string().pattern(/^[0-9]{10}$/).allow('', null),
    whatsappNumber: Joi.string().pattern(/^[0-9]{10}$/).allow('', null),

    isWhatsapp: Joi.boolean().allow(null),

    // Documents
    picture: Joi.string().uri().allow('', null),
    idDocuments: Joi.array().items(
      Joi.alternatives().try(
        Joi.string().uri(),
        Joi.object({
          type: Joi.string().allow('', null),
          url: Joi.string().uri().allow('', null),
          name: Joi.string().allow('', null)
        })
      )
    ).allow(null),
    customDocuments: Joi.array().items(Joi.string().uri()).allow(null),

    // Qualifications
    professionalQualifications: Joi.array().items(Joi.object({
      name: Joi.string().required(),
      year: Joi.string().allow('', null),
      documents: Joi.array().items(Joi.string().uri())
    })).allow(null),
    totalExperience: Joi.string().allow('', null),
    previousOrganization: Joi.string().max(100).allow('', null),
    roleInOrganization: Joi.string().allow('', null),
    qualificationDocs: Joi.array().items(Joi.string().uri()).allow(null),

    // Staff Info
    staffNumber: Joi.string().allow('', null),
    staffId: Joi.string().allow('', null), // Allow but ignore - sometimes sent by frontend
    staffType: Joi.alternatives().try(
      Joi.string().allow('', null),
      Joi.array().items(Joi.string()).allow(null)
    ), // Accept both string and array for backward compatibility
    assignedClasses: Joi.array().items(Joi.string()).allow(null),
    isClassTeacher: Joi.boolean().allow(null),
    classTeacherOf: Joi.string().allow('', null),

    // Bank & Salary
    accountNumber: Joi.string().max(50).allow('', null),
    ifscCode: Joi.string().pattern(/^[A-Z]{4}0[A-Z0-9]{6}$/).allow('', null),
    bankName: Joi.string().max(100).allow('', null),
    branchName: Joi.string().max(100).allow('', null),
    salaryTemplate: Joi.string().allow('', null),
    salary: Joi.number().min(0).allow(null),
    salaryBreakdown: Joi.array().items(Joi.object({
      component: Joi.string().required(),
      amount: Joi.number().min(0).required()
    })).allow(null),

    // Emergency contacts (array format from frontend)
    emergencyContacts: Joi.array().items(Joi.object({
      name: Joi.string().allow('', null),
      relationship: Joi.string().allow('', null),
      phone: Joi.string().pattern(/^[0-9]{10}$/).allow('', null)
    })).allow(null)
  }),

  // Student creation
  createStudent: Joi.object({
    name: Joi.string().required().min(2).max(100).trim(),
    admissionId: Joi.string().required().max(50),
    academicYear: Joi.string().required().pattern(/^\d{4}-\d{2}$/),
    rollNo: Joi.number().integer().min(1).allow(null),
    classId: Joi.string().required().pattern(/^[0-9a-fA-F]{24}$/),

    // Personal Information
    gender: Joi.string().valid('Male', 'Female', 'Other').allow('', null),
    dateOfBirth: Joi.string().allow('', null),
    bloodGroup: Joi.string().valid('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-').allow('', null),
    nationality: Joi.string().max(50).allow('', null),
    religion: Joi.string().max(50).allow('', null),
    category: Joi.string().max(50).allow('', null),
    motherTongue: Joi.string().max(50).allow('', null),
    aadhaarNumber: Joi.string().pattern(/^[0-9]{12}$/).allow('', null),

    // Contact Information
    phone: Joi.string().pattern(/^[0-9]{10}$/).allow('', null),
    email: Joi.string().email().allow('', null),
    address: Joi.string().max(500).allow('', null),
    city: Joi.string().max(100).allow('', null),
    state: Joi.string().max(100).allow('', null),
    zipCode: Joi.string().max(10).allow('', null),
    isWhatsapp: Joi.boolean().allow(null),
    whatsappNumber: Joi.string().pattern(/^[0-9]{10}$/).allow('', null),

    // Parent Information
    parentName: Joi.string().max(100).allow('', null),
    parentPhone: Joi.string().pattern(/^[0-9]{10}$/).allow('', null),
    parentEmail: Joi.string().email().allow('', null),
    parentRelationship: Joi.string().max(50).allow('', null),
    parentOccupation: Joi.string().max(100).allow('', null),
    alternatePhone: Joi.string().pattern(/^[0-9]{10}$/).allow('', null),
    parents: Joi.array().items(Joi.object({
      name: Joi.string().required(),
      relationship: Joi.string(),
      phone: Joi.string().pattern(/^[0-9]{10}$/),
      email: Joi.string().email().allow('', null),
      occupation: Joi.string().allow('', null),
      isWhatsapp: Joi.boolean().allow(null),
      isParent: Joi.boolean().allow(null)
    })).allow(null),
    siblings: Joi.array().items(Joi.object({
      name: Joi.string().allow('', null),
      age: Joi.number().integer().allow(null),
      class: Joi.string().allow('', null),
      school: Joi.string().allow('', null)
    }).unknown(true)).allow(null),

    // Academic Information
    previousSchool: Joi.string().max(200).allow('', null),
    tcNumber: Joi.string().max(50).allow('', null),
    mediumOfInstruction: Joi.string().max(50).allow('', null),
    house: Joi.string().max(50).allow('', null),

    // Health & Safety
    medicalConditions: Joi.string().max(500).allow('', null),
    emergencyContactName: Joi.string().max(100).allow('', null),
    emergencyContactPhone: Joi.string().pattern(/^[0-9]{10}$/).allow('', null),

    // Requirements
    transportRequired: Joi.boolean().allow(null),
    hostelRequired: Joi.boolean().allow(null),

    // Status
    feeStatus: Joi.string().valid('paid', 'pending', 'partial').default('pending'),
    status: Joi.string().valid('active', 'inactive', 'graduated', 'transferred').default('active'),

    // Documents & Photo
    documents: Joi.array().items(Joi.alternatives().try(
      Joi.object({
        id: Joi.string(),
        name: Joi.string().required(),
        type: Joi.string().required(),
        url: Joi.string().uri().required(),
        uploadDate: Joi.string(),
        size: Joi.string(),
        date: Joi.string(),
        category: Joi.string().allow('', null)
      }),
      Joi.object({
        id: Joi.string(),
        name: Joi.string().required(),
        type: Joi.string().required(),
        category: Joi.string().allow('', null),
        front: Joi.object({
          url: Joi.string().uri().required(),
          uploadDate: Joi.string()
        }),
        back: Joi.object({
          url: Joi.string().uri().required(),
          uploadDate: Joi.string()
        }),
        uploadDate: Joi.string(),
        size: Joi.string(),
        date: Joi.string()
      })
    )).allow(null),
    photo: Joi.string().uri().allow('', null)
  }),

  // Fee payment
  createFeePayment: Joi.object({
    studentId: Joi.string().required().pattern(/^[0-9a-fA-F]{24}$/),
    classId: Joi.string().required().pattern(/^[0-9a-fA-F]{24}$/),
    academicYear: Joi.string().required().pattern(/^\d{4}-\d{2}$/),
    amount: Joi.number().required().min(1).max(1000000),
    paymentDate: Joi.string().required(),
    paymentMode: Joi.string().required().valid('cash', 'cheque', 'online', 'card', 'upi'),
    transactionId: Joi.string().max(100).allow('', null),
    chequeNumber: Joi.string().max(50).allow('', null),
    bankName: Joi.string().max(100).allow('', null),
    remarks: Joi.string().max(500).allow('', null),
    collectedBy: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).allow(null)
  }),

  // Refund request
  createRefund: Joi.object({
    studentId: Joi.string().required().pattern(/^[0-9a-fA-F]{24}$/),
    classId: Joi.string().required().pattern(/^[0-9a-fA-F]{24}$/),
    academicYear: Joi.string().pattern(/^\d{4}-\d{2}$/).allow('', null),
    amount: Joi.number().required().min(1).max(1000000),
    reason: Joi.string().required().min(10).max(500),
    refundDate: Joi.string().required(),
    refundMode: Joi.string().required().valid('cash', 'cheque', 'online', 'card', 'upi'),
    originalPaymentId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).allow(null),
    transactionId: Joi.string().max(100).allow('', null),
    chequeNumber: Joi.string().max(50).allow('', null),
    bankName: Joi.string().max(100).allow('', null),
    accountNumber: Joi.string().max(50).allow('', null),
    requestedBy: Joi.string().required().pattern(/^[0-9a-fA-F]{24}$/),
    remarks: Joi.string().max(500).allow('', null)
  }),

  // MongoDB ObjectId validation
  mongoId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).messages({
    'string.pattern.base': 'Invalid ID format'
  }),

  mongoIdParam: Joi.object({
    id: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required().messages({
      'string.pattern.base': 'Invalid ID format'
    })
  })
};

// Validation middleware factory
export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const data = source === 'body' ? req.body :
      source === 'params' ? req.params :
        source === 'query' ? req.query : req[source];

    const { error, value } = schema.validate(data, {
      abortEarly: false, // Get all errors, not just the first one
      stripUnknown: true // Remove unknown fields
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

    // Replace request data with validated and sanitized data
    if (source === 'body') req.body = value;
    else if (source === 'params') req.params = value;
    else if (source === 'query') req.query = value;
    else req[source] = value;

    next();
  };
}

// Sanitize string inputs (XSS protection)
export function sanitizeString(str) {
  if (typeof str !== 'string') return str;

  return str
    .trim()
    .replace(/[<>]/g, '') // Remove angle brackets
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, ''); // Remove inline event handlers
}

// Validate MongoDB ObjectId
export function isValidObjectId(id) {
  return /^[0-9a-fA-F]{24}$/.test(id);
}
