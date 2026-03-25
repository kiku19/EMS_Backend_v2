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
    phone: Joi.string()
      .pattern(/^[0-9]{10}$/)
      .messages({
        'string.pattern.base': 'Phone number must be 10 digits',
      }),
    email: Joi.string().email(),
    password: Joi.string().required().min(8).max(128),
    schoolId: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .allow('', null),
    schoolCode: Joi.string().max(40).allow('', null),
  }).xor('phone', 'email'), // Must have either phone or email, not both

  superAdminCreateSchool: Joi.object({
    schoolName: Joi.string().required().min(2).max(200).trim(),
    schoolCode: Joi.string().max(40).allow('', null),
    contactEmail: Joi.string().email().allow('', null),
    contactPhone: Joi.string().max(20).allow('', null),
    plan: Joi.string().valid('starter', 'growth', 'scale').default('starter'),
    planStatus: Joi.string()
      .valid('trialing', 'active', 'past_due', 'cancelled')
      .default('trialing'),
    trialEndsAt: Joi.date().iso().allow(null),
    frontendUrl: Joi.string().uri().allow('', null),
    backendUrl: Joi.string().uri().allow('', null),
    adminName: Joi.string().required().min(2).max(100).trim(),
    adminEmail: Joi.string().email().required(),
    adminPassword: Joi.string().min(8).max(50).allow('', null),
    schoolSettings: Joi.object().default({}),
  }),

  superAdminUpdateSchool: Joi.object({
    schoolName: Joi.string().min(2).max(200).trim(),
    schoolCode: Joi.string().max(40).allow('', null),
    status: Joi.string().valid('active', 'inactive'),
    contactEmail: Joi.string().email().allow('', null),
    contactPhone: Joi.string().max(20).allow('', null),
    plan: Joi.string().valid('starter', 'growth', 'scale'),
    planStatus: Joi.string().valid('trialing', 'active', 'past_due', 'cancelled'),
    trialEndsAt: Joi.date().iso().allow(null),
    frontendUrl: Joi.string().uri().allow('', null),
    backendUrl: Joi.string().uri().allow('', null),
  }).min(1),

  superAdminProvisionSchool: Joi.object({
    adminName: Joi.string().min(2).max(100).trim().allow('', null),
    adminEmail: Joi.string().email().allow('', null),
    adminPassword: Joi.string().min(8).max(50).allow('', null),
    contactPhone: Joi.string().max(20).allow('', null),
    schoolSettings: Joi.object().default({}),
  }),

  // Staff creation
  createStaff: Joi.object({
    name: Joi.string().required().min(2).max(100).trim(),
    // Fix 2.5: Normalize role to always be an array
    role: Joi.alternatives()
      .try(
        Joi.string().required().max(50),
        Joi.array().items(Joi.string().max(50)).min(1).required()
      )
      .required()
      .custom((value) => (Array.isArray(value) ? value : [value])),
    department: Joi.string().max(50),
    status: Joi.string().valid('active', 'inactive', 'on-leave').default('active'),
    phone: Joi.string()
      .pattern(/^[0-9]{10}$/)
      .allow('', null),
    email: Joi.string().email().allow('', null),
    joinDate: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .allow('', null),
    address: Joi.string().max(500).allow('', null),
    assignedClassId: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .allow(null),
    reporterId: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .allow(null),

    // Personal Details
    dob: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .allow('', null),
    gender: Joi.string().valid('Male', 'Female', 'Other').allow('', null),
    fatherName: Joi.string().max(100).allow('', null),
    bloodGroup: Joi.string()
      .valid('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')
      .allow('', null),
    maritalStatus: Joi.string().valid('Single', 'Married', 'Divorced', 'Widowed').allow('', null),
    employmentType: Joi.string().allow('', null),
    emergencyContact: Joi.string().max(100).allow('', null),
    emergencyPhone: Joi.string()
      .pattern(/^[0-9]{10}$/)
      .allow('', null),
    whatsappNumber: Joi.string()
      .pattern(/^[0-9]{10}$/)
      .allow('', null),

    isWhatsapp: Joi.boolean().allow(null),

    // Documents
    picture: Joi.string().uri().allow('', null),
    // Fix 2.7: Only allow object format for idDocuments (Mongoose requires objects, not plain strings)
    idDocuments: Joi.array()
      .items(
        Joi.object({
          type: Joi.string().allow('', null),
          url: Joi.string().uri().allow('', null),
          name: Joi.string().allow('', null),
        })
      )
      .allow(null),
    customDocuments: Joi.array().items(Joi.string().uri()).allow(null),

    // Qualifications
    professionalQualifications: Joi.array()
      .items(
        Joi.object({
          name: Joi.string().required(),
          year: Joi.string().allow('', null),
          documents: Joi.array().items(Joi.string().uri()),
        })
      )
      .allow(null),
    totalExperience: Joi.string().allow('', null),
    previousOrganization: Joi.string().max(100).allow('', null),
    roleInOrganization: Joi.string().allow('', null),
    qualificationDocs: Joi.array().items(Joi.string().uri()).allow(null),

    // Staff Info
    staffNumber: Joi.string().allow('', null),
    staffId: Joi.string().allow('', null), // Allow but ignore - sometimes sent by frontend
    // Fix 2.6: Normalize staffType to always be an array
    staffType: Joi.alternatives()
      .try(Joi.string().allow('', null), Joi.array().items(Joi.string()).allow(null))
      .custom((value) => {
        if (value === null || value === '' || value === undefined) return value;
        return Array.isArray(value) ? value : [value];
      }),
    assignedClasses: Joi.array().items(Joi.string()).allow(null),
    isClassTeacher: Joi.boolean().allow(null),
    classTeacherOf: Joi.string().allow('', null),

    // Bank & Salary
    accountNumber: Joi.string().max(50).allow('', null),
    ifscCode: Joi.string()
      .pattern(/^[A-Z]{4}0[A-Z0-9]{6}$/)
      .allow('', null),
    bankName: Joi.string().max(100).allow('', null),
    branchName: Joi.string().max(100).allow('', null),
    panNumber: Joi.string()
      .pattern(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/)
      .allow('', null),
    salaryTemplate: Joi.string().allow('', null),
    salary: Joi.number().min(0).allow(null),
    salaryBreakdown: Joi.array()
      .items(
        Joi.object({
          component: Joi.string().required(),
          amount: Joi.number().min(0).required(),
        })
      )
      .allow(null),

    // Additional fields
    nationality: Joi.string().max(50).allow('', null),
    shift: Joi.string().valid('Morning', 'Afternoon', 'Evening').allow('', null),
    designation: Joi.string().max(100).allow('', null),
    qualification: Joi.string().max(200).allow('', null),
    experience: Joi.number().min(0).allow(null),

    // Emergency contacts (array format from frontend)
    emergencyContacts: Joi.array()
      .items(
        Joi.object({
          name: Joi.string().allow('', null),
          relationship: Joi.string().allow('', null),
          phone: Joi.string()
            .pattern(/^[0-9]{10}$/)
            .allow('', null),
        })
      )
      .allow(null),
  }),

  // Staff update (all fields optional)
  updateStaff: Joi.object({
    name: Joi.string().min(2).max(100).trim(),
    // Fix 2.5: Normalize role to always be an array
    role: Joi.alternatives()
      .try(Joi.string().max(50), Joi.array().items(Joi.string().max(50)).min(1))
      .custom((value) => {
        if (value === null || value === undefined) return value;
        return Array.isArray(value) ? value : [value];
      }),
    department: Joi.string().max(50),
    status: Joi.string().valid('active', 'inactive', 'on-leave', 'suspended', 'terminated'),
    phone: Joi.string()
      .pattern(/^[0-9]{10}$/)
      .allow('', null),
    email: Joi.string().email().allow('', null),
    joinDate: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .allow('', null),
    address: Joi.string().max(500).allow('', null),
    assignedClassId: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .allow(null, ''),
    reporterId: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .allow(null, ''),
    dob: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .allow('', null),
    gender: Joi.string().valid('Male', 'Female', 'Other').allow('', null),
    fatherName: Joi.string().max(100).allow('', null),
    bloodGroup: Joi.string()
      .valid('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')
      .allow('', null),
    maritalStatus: Joi.string().valid('Single', 'Married', 'Divorced', 'Widowed').allow('', null),
    employmentType: Joi.string().allow('', null),
    emergencyContact: Joi.string().max(100).allow('', null),
    emergencyPhone: Joi.string()
      .pattern(/^[0-9]{10}$/)
      .allow('', null),
    whatsappNumber: Joi.string()
      .pattern(/^[0-9]{10}$/)
      .allow('', null),
    isWhatsapp: Joi.boolean().allow(null),
    picture: Joi.string().uri().allow('', null),
    idDocuments: Joi.array()
      .items(
        Joi.object({
          type: Joi.string().allow('', null),
          url: Joi.string().uri().allow('', null),
          name: Joi.string().allow('', null),
        })
      )
      .allow(null),
    customDocuments: Joi.array().items(Joi.string().uri()).allow(null),
    professionalQualifications: Joi.array()
      .items(
        Joi.object({
          name: Joi.string().required(),
          year: Joi.string().allow('', null),
          documents: Joi.array().items(Joi.string().uri()),
        })
      )
      .allow(null),
    totalExperience: Joi.string().allow('', null),
    previousOrganization: Joi.string().max(100).allow('', null),
    roleInOrganization: Joi.string().allow('', null),
    qualificationDocs: Joi.array().items(Joi.string().uri()).allow(null),
    staffNumber: Joi.string().allow('', null),
    // Fix 2.6: Normalize staffType to always be an array
    staffType: Joi.alternatives()
      .try(Joi.string().allow('', null), Joi.array().items(Joi.string()).allow(null))
      .custom((value) => {
        if (value === null || value === '' || value === undefined) return value;
        return Array.isArray(value) ? value : [value];
      }),
    assignedClasses: Joi.array().items(Joi.string()).allow(null),
    isClassTeacher: Joi.boolean().allow(null),
    classTeacherOf: Joi.string().allow('', null),
    accountNumber: Joi.string().max(50).allow('', null),
    ifscCode: Joi.string()
      .pattern(/^[A-Z]{4}0[A-Z0-9]{6}$/)
      .allow('', null),
    bankName: Joi.string().max(100).allow('', null),
    branchName: Joi.string().max(100).allow('', null),
    panNumber: Joi.string()
      .pattern(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/)
      .allow('', null),
    salaryTemplate: Joi.string().allow('', null),
    salary: Joi.number().min(0).allow(null),
    salaryBreakdown: Joi.array()
      .items(
        Joi.object({
          component: Joi.string().required(),
          amount: Joi.number().min(0).required(),
        })
      )
      .allow(null),
    nationality: Joi.string().max(50).allow('', null),
    shift: Joi.string().valid('Morning', 'Afternoon', 'Evening').allow('', null),
    designation: Joi.string().max(100).allow('', null),
    qualification: Joi.string().max(200).allow('', null),
    experience: Joi.number().min(0).allow(null),
    username: Joi.string().max(50).allow('', null),
    password: Joi.string().min(8).max(50).allow('', null),
    emergencyContacts: Joi.array()
      .items(
        Joi.object({
          name: Joi.string().allow('', null),
          relationship: Joi.string().allow('', null),
          phone: Joi.string()
            .pattern(/^[0-9]{10}$/)
            .allow('', null),
        })
      )
      .allow(null),
  }),

  // Student creation
  createStudent: Joi.object({
    name: Joi.string().required().min(2).max(100).trim(),
    admissionId: Joi.string().required().max(50),
    academicYear: Joi.string()
      .required()
      .pattern(/^\d{4}-\d{2}$/),
    rollNo: Joi.number().integer().min(1).allow(null),
    classId: Joi.string()
      .required()
      .pattern(/^[0-9a-fA-F]{24}$/),

    // Personal Information
    gender: Joi.string().valid('Male', 'Female', 'Other').allow('', null),
    dateOfBirth: Joi.string().allow('', null),
    bloodGroup: Joi.string()
      .valid('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')
      .allow('', null),
    nationality: Joi.string().max(50).allow('', null),
    religion: Joi.string().max(50).allow('', null),
    category: Joi.string().max(50).allow('', null),
    motherTongue: Joi.string().max(50).allow('', null),
    aadhaarNumber: Joi.string()
      .pattern(/^[0-9]{12}$/)
      .allow('', null),

    // Contact Information
    phone: Joi.string()
      .pattern(/^[0-9]{10}$/)
      .allow('', null),
    email: Joi.string().email().allow('', null),
    address: Joi.string().max(500).allow('', null),
    city: Joi.string().max(100).allow('', null),
    state: Joi.string().max(100).allow('', null),
    zipCode: Joi.string().max(10).allow('', null),
    isWhatsapp: Joi.boolean().allow(null),
    whatsappNumber: Joi.string()
      .pattern(/^[0-9]{10}$/)
      .allow('', null),

    // Parent Information
    parentName: Joi.string().max(100).allow('', null),
    parentPhone: Joi.string()
      .pattern(/^[0-9]{10}$/)
      .allow('', null),
    parentEmail: Joi.string().email().allow('', null),
    parentRelationship: Joi.string().max(50).allow('', null),
    parentOccupation: Joi.string().max(100).allow('', null),
    alternatePhone: Joi.string()
      .pattern(/^[0-9]{10}$/)
      .allow('', null),
    parents: Joi.array()
      .items(
        Joi.object({
          name: Joi.string().required(),
          relationship: Joi.string(),
          phone: Joi.string().pattern(/^[0-9]{10}$/),
          email: Joi.string().email().allow('', null),
          occupation: Joi.string().allow('', null),
          isWhatsapp: Joi.boolean().allow(null),
          isParent: Joi.boolean().allow(null),
        })
      )
      .allow(null),
    siblings: Joi.array()
      .items(
        Joi.object({
          name: Joi.string().allow('', null),
          age: Joi.number().integer().allow(null),
          class: Joi.string().allow('', null),
          school: Joi.string().allow('', null),
        }).unknown(true)
      )
      .allow(null),

    // Academic Information
    previousSchool: Joi.string().max(200).allow('', null),
    tcNumber: Joi.string().max(50).allow('', null),
    mediumOfInstruction: Joi.string().max(50).allow('', null),
    house: Joi.string().max(50).allow('', null),

    // Health & Safety
    medicalConditions: Joi.string().max(500).allow('', null),
    emergencyContactName: Joi.string().max(100).allow('', null),
    emergencyContactPhone: Joi.string()
      .pattern(/^[0-9]{10}$/)
      .allow('', null),

    // Requirements
    transportRequired: Joi.boolean().allow(null),
    hostelRequired: Joi.boolean().allow(null),

    // Status
    feeStatus: Joi.string().valid('paid', 'pending', 'partial').default('pending'),
    status: Joi.string().valid('active', 'inactive', 'graduated', 'transferred').default('active'),

    // Documents & Photo
    documents: Joi.array()
      .items(
        Joi.alternatives().try(
          Joi.object({
            id: Joi.string(),
            name: Joi.string().required(),
            type: Joi.string().required(),
            url: Joi.string().uri().required(),
            uploadDate: Joi.string(),
            size: Joi.string(),
            date: Joi.string(),
            category: Joi.string().allow('', null),
          }),
          Joi.object({
            id: Joi.string(),
            name: Joi.string().required(),
            type: Joi.string().required(),
            category: Joi.string().allow('', null),
            front: Joi.object({
              url: Joi.string().uri().required(),
              uploadDate: Joi.string(),
            }),
            back: Joi.object({
              url: Joi.string().uri().required(),
              uploadDate: Joi.string(),
            }),
            uploadDate: Joi.string(),
            size: Joi.string(),
            date: Joi.string(),
          })
        )
      )
      .allow(null),
    photo: Joi.string().uri().allow('', null),
  }),

  // Fee payment
  createFeePayment: Joi.object({
    studentId: Joi.string()
      .required()
      .pattern(/^[0-9a-fA-F]{24}$/),
    classId: Joi.string()
      .required()
      .pattern(/^[0-9a-fA-F]{24}$/),
    academicYear: Joi.string()
      .required()
      .pattern(/^\d{4}-\d{2}$/),
    amount: Joi.number().required().min(1).max(1000000),
    paymentDate: Joi.string().required(),
    paymentMode: Joi.string().required().valid('cash', 'cheque', 'online', 'card', 'upi'),
    transactionId: Joi.string().max(100).allow('', null),
    chequeNumber: Joi.string().max(50).allow('', null),
    bankName: Joi.string().max(100).allow('', null),
    remarks: Joi.string().max(500).allow('', null),
    collectedBy: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .allow(null),
  }),

  // Refund request
  createRefund: Joi.object({
    studentId: Joi.string()
      .required()
      .pattern(/^[0-9a-fA-F]{24}$/),
    classId: Joi.string()
      .required()
      .pattern(/^[0-9a-fA-F]{24}$/),
    academicYear: Joi.string()
      .pattern(/^\d{4}-\d{2}$/)
      .allow('', null),
    amount: Joi.number().required().min(1).max(1000000),
    reason: Joi.string().required().min(10).max(500),
    refundDate: Joi.string().required(),
    refundMode: Joi.string().required().valid('cash', 'cheque', 'online', 'card', 'upi'),
    originalPaymentId: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .allow(null),
    transactionId: Joi.string().max(100).allow('', null),
    chequeNumber: Joi.string().max(50).allow('', null),
    bankName: Joi.string().max(100).allow('', null),
    accountNumber: Joi.string().max(50).allow('', null),
    requestedBy: Joi.string()
      .required()
      .pattern(/^[0-9a-fA-F]{24}$/),
    remarks: Joi.string().max(500).allow('', null),
  }),

  // Class creation
  createClass: Joi.object({
    name: Joi.string().required().min(1).max(50).trim(),
    section: Joi.string().required().max(10).trim(),
    classTeacherId: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .allow(null, ''),
    subjects: Joi.array().items(Joi.string().max(100).trim()).default([]),
    assignedSubjects: Joi.array().items(Joi.string().max(100).trim()).default([]),
    academicYear: Joi.string()
      .pattern(/^\d{4}-\d{2}$/)
      .optional(),
    classTag: Joi.string().max(100).allow('', null),
    room: Joi.string().max(50).allow('', null),
    block: Joi.string().max(50).allow('', null),
    strengthLimit: Joi.object({
      current: Joi.number().integer().min(1).max(200),
      default: Joi.number().integer().min(1).max(200),
    }).optional(),
  }),

  // Class update (all fields optional)
  updateClass: Joi.object({
    name: Joi.string().min(1).max(50).trim(),
    section: Joi.string().max(10).trim(),
    classTeacherId: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .allow(null, ''),
    subjects: Joi.array().items(Joi.string().max(100).trim()),
    assignedSubjects: Joi.array().items(Joi.string().max(100).trim()),
    academicYear: Joi.string().pattern(/^\d{4}-\d{2}$/),
    classTag: Joi.string().max(100).allow('', null),
    room: Joi.string().max(50).allow('', null),
    block: Joi.string().max(50).allow('', null),
  }),

  // Class teacher update
  updateClassTeacher: Joi.object({
    classTeacherId: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .allow(null, '')
      .required(),
  }),

  // Class subjects update
  updateClassSubjects: Joi.object({
    assignedSubjects: Joi.array().items(Joi.string().max(100).trim()).required(),
  }),

  // Class tag update
  updateClassTag: Joi.object({
    classTag: Joi.string().max(100).allow('', null).required(),
  }),

  // Strength limit update
  updateStrengthLimit: Joi.object({
    newLimit: Joi.number().integer().min(1).max(200).required(),
    reason: Joi.string().max(500).required(),
    approvedBy: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .allow(null, ''),
  }),

  // Class promotion
  promoteClass: Joi.object({
    targetClassId: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .required(),
    targetSection: Joi.string().max(10).trim(),
    academicYear: Joi.string().pattern(/^\d{4}-\d{2}$/),
  }),

  // MongoDB ObjectId validation
  mongoId: Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .messages({
      'string.pattern.base': 'Invalid ID format',
    }),

  mongoIdParam: Joi.object({
    id: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .required()
      .messages({
        'string.pattern.base': 'Invalid ID format',
      }),
  }),

  // Exam creation
  createExam: Joi.object({
    name: Joi.string().required().min(2).max(200).trim(),
    type: Joi.string().valid('unit_test', 'quiz', 'midterm', 'final').allow('', null),
    examType: Joi.string().allow('', null), // Issue #15: Accept legacy examType from staff app
    classId: Joi.string()
      .required()
      .pattern(/^[0-9a-fA-F]{24}$/),
    subjectId: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .allow('', null),
    subjectName: Joi.string().max(100).allow('', null),
    academicYear: Joi.string()
      .pattern(/^\d{4}-\d{2}$/)
      .allow('', null),
    startDate: Joi.date().iso().required(),
    endDate: Joi.date().iso().min(Joi.ref('startDate')).allow(null),
    maxMarks: Joi.number().min(1).max(1000).default(100),
    passingMarks: Joi.number().min(0).max(Joi.ref('maxMarks')).default(35),
    weightage: Joi.number().min(0).max(100).default(10),
    gradingType: Joi.string().valid('numerical', 'grades', 'cgpa').default('numerical'),
    instructions: Joi.string().max(2000).allow('', null),
    createdBy: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .allow(null),
    status: Joi.string()
      .valid('scheduled', 'ongoing', 'completed', 'results_published')
      .allow(null),
    term: Joi.string().valid('term_1', 'term_2', 'term_3', 'final').allow('', null), // Issue #11
    duration: Joi.number().min(1).max(600).allow(null), // Issue #11: Duration in minutes
  }),

  // Exam update (all fields optional)
  updateExam: Joi.object({
    name: Joi.string().min(2).max(200).trim(),
    type: Joi.string().valid('unit_test', 'quiz', 'midterm', 'final').allow('', null),
    examType: Joi.string().allow('', null), // Issue #15: Accept legacy examType
    classId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/),
    subjectId: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .allow('', null),
    subjectName: Joi.string().max(100).allow('', null),
    academicYear: Joi.string()
      .pattern(/^\d{4}-\d{2}$/)
      .allow('', null),
    startDate: Joi.date().iso(),
    endDate: Joi.date().iso().allow(null),
    maxMarks: Joi.number().min(1).max(1000),
    passingMarks: Joi.number().min(0),
    weightage: Joi.number().min(0).max(100),
    gradingType: Joi.string().valid('numerical', 'grades', 'cgpa'),
    instructions: Joi.string().max(2000).allow('', null),
    status: Joi.string().valid('scheduled', 'ongoing', 'completed', 'results_published'),
    term: Joi.string().valid('term_1', 'term_2', 'term_3', 'final').allow('', null),
    duration: Joi.number().min(1).max(600).allow(null),
  }).min(1),

  // Exam Schedule creation
  createExamSchedule: Joi.object({
    name: Joi.string().required().min(2).max(200).trim(),
    type: Joi.string().valid('unit_test', 'quiz', 'midterm', 'final').allow('', null),
    academicYear: Joi.string()
      .pattern(/^\d{4}-\d{2}$/)
      .allow('', null),
    classIds: Joi.array()
      .items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/))
      .min(1)
      .required(),
    startDate: Joi.date().iso().required(),
    endDate: Joi.date().iso().min(Joi.ref('startDate')).required(),
    sessionType: Joi.string().valid('morning', 'afternoon', 'both').default('morning'),
    morningSlot: Joi.object({
      startTime: Joi.string().pattern(/^\d{2}:\d{2}$/),
      endTime: Joi.string().pattern(/^\d{2}:\d{2}$/),
    }).allow(null),
    afternoonSlot: Joi.object({
      startTime: Joi.string().pattern(/^\d{2}:\d{2}$/),
      endTime: Joi.string().pattern(/^\d{2}:\d{2}$/),
    }).allow(null),
    defaultMaxMarks: Joi.number().min(1).max(1000).default(100),
    defaultPassingMarks: Joi.number().min(0).default(35),
    entries: Joi.array()
      .items(
        Joi.object({
          date: Joi.date().iso().required(),
          session: Joi.string().valid('morning', 'afternoon').required(),
          subjectName: Joi.string().required().max(100),
          classIds: Joi.array().items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/)),
          maxMarks: Joi.number().min(1).max(1000),
          passingMarks: Joi.number().min(0),
        })
      )
      .allow(null),
    createdBy: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .allow(null),
  }),

  // Exam Schedule update (all fields optional)
  updateExamSchedule: Joi.object({
    name: Joi.string().min(2).max(200).trim(),
    type: Joi.string().valid('unit_test', 'quiz', 'midterm', 'final').allow('', null),
    classIds: Joi.array()
      .items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/))
      .min(1),
    startDate: Joi.date().iso(),
    endDate: Joi.date().iso(),
    sessionType: Joi.string().valid('morning', 'afternoon', 'both'),
    morningSlot: Joi.object({
      startTime: Joi.string().pattern(/^\d{2}:\d{2}$/),
      endTime: Joi.string().pattern(/^\d{2}:\d{2}$/),
    }).allow(null),
    afternoonSlot: Joi.object({
      startTime: Joi.string().pattern(/^\d{2}:\d{2}$/),
      endTime: Joi.string().pattern(/^\d{2}:\d{2}$/),
    }).allow(null),
    defaultMaxMarks: Joi.number().min(1).max(1000),
    defaultPassingMarks: Joi.number().min(0),
    entries: Joi.array()
      .items(
        Joi.object({
          date: Joi.date().iso().required(),
          session: Joi.string().valid('morning', 'afternoon').required(),
          subjectName: Joi.string().required().max(100),
          classIds: Joi.array().items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/)),
          maxMarks: Joi.number().min(1).max(1000),
          passingMarks: Joi.number().min(0),
        })
      )
      .allow(null),
  }).min(1),

  // Bulk results
  bulkResults: Joi.object({
    examId: Joi.string()
      .required()
      .pattern(/^[0-9a-fA-F]{24}$/),
    classId: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .allow('', null),
    loadedAt: Joi.date().iso().allow(null), // Issue #19: Timestamp for concurrency check
    results: Joi.array()
      .items(
        Joi.object({
          studentId: Joi.string()
            .required()
            .pattern(/^[0-9a-fA-F]{24}$/),
          marksObtained: Joi.number().required().min(0),
          remarks: Joi.string().max(500).allow('', null),
        })
      )
      .required()
      .min(1),
  }).options({ stripUnknown: true }),
};

// Validation middleware factory
export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const data =
      source === 'body'
        ? req.body
        : source === 'params'
          ? req.params
          : source === 'query'
            ? req.query
            : req[source];

    const { error, value } = schema.validate(data, {
      abortEarly: false, // Get all errors, not just the first one
      stripUnknown: true, // Remove unknown fields
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));

      return res.status(400).json({
        success: false,
        error: req.t ? req.t('common:errors.validationError') : 'Validation failed',
        statusCode: 400,
        details: errors,
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

/**
 * Sanitizes a query param to a plain non-empty string.
 * Prevents type-confusion when qs parses ?foo[$ne]=x into an object.
 */
export function sanitizeQueryStr(val) {
  return typeof val === 'string' && val.length > 0 ? val.trim() : undefined;
}

/**
 * Sanitizes a query param that must be a MongoDB ObjectId string.
 */
export function sanitizeQueryId(val) {
  return typeof val === 'string' && /^[0-9a-fA-F]{24}$/.test(val) ? val : undefined;
}

// ============================================================
// Zod Validation Schemas (new code uses Zod per project rules)
// ============================================================
import { z } from 'zod';

const VALID_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');
const optionalObjectId = objectId.optional().nullable();
const timeString = z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format');

const periodSchema = z.object({
  name: z.string().min(1).max(50),
  startTime: timeString,
  endTime: timeString,
  isBreak: z.boolean().default(false),
});

const slotSchema = z.object({
  subject: z.string().max(100).default(''),
  teacherId: optionalObjectId,
  room: z.string().max(100).default(''),
});

const dayScheduleSchema = z.array(slotSchema).default([]);

const scheduleSchema = z
  .object({
    Monday: dayScheduleSchema,
    Tuesday: dayScheduleSchema,
    Wednesday: dayScheduleSchema,
    Thursday: dayScheduleSchema,
    Friday: dayScheduleSchema,
    Saturday: dayScheduleSchema,
  })
  .default({
    Monday: [],
    Tuesday: [],
    Wednesday: [],
    Thursday: [],
    Friday: [],
    Saturday: [],
  });

// Auth schemas (migrated from Joi)
const signupSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100).trim(),
  email: z
    .string()
    .email('Invalid email address')
    .transform((v) => v.toLowerCase().trim()),
  schoolName: z.string().min(2, 'School name must be at least 2 characters').max(200).trim(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128)
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  phone: z
    .string()
    .regex(/^[0-9]{7,15}$/, 'Phone number must be 7-15 digits')
    .transform((v) => {
      // Strip Indian country code prefix: 91XXXXXXXXXX or 0091XXXXXXXXXX
      const d = v.replace(/\D/g, '');
      if (d.length === 12 && d.startsWith('91')) return d.slice(2);
      if (d.length === 14 && d.startsWith('0091')) return d.slice(4);
      return d;
    })
    .optional()
    .nullable(),
  inviteToken: z.string().min(1, 'Invite token is required'),
});

const loginSchema = z
  .object({
    email: z.string().email().optional().nullable(),
    phone: z
      .string()
      .regex(/^[0-9]{7,15}$/, 'Phone number must be 7-15 digits')
      .optional()
      .nullable(),
    password: z.string().min(8).max(128),
    schoolId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/)
      .optional()
      .nullable(),
    schoolCode: z.string().max(40).optional().nullable(),
  })
  .refine((data) => Boolean(data.email) || Boolean(data.phone), {
    message: 'Email or phone is required',
    path: ['email'],
  });

// 2FA Zod schemas
const totpCodeSchema = z.string().regex(/^\d{6}$/, 'Must be a 6-digit code');
const backupCodeSchema = z.string().regex(/^[A-Z0-9]{8}$/, 'Invalid backup code format');

const twoFactorVerifyLoginSchema = z
  .object({
    twoFactorToken: z.string().min(1, 'Two-factor token is required'),
    code: z.union([totpCodeSchema, backupCodeSchema]).optional(),
    backupCode: z.string().optional(),
    rememberDevice: z.boolean().optional().default(false),
  })
  .refine((data) => Boolean(data.code) || Boolean(data.backupCode), {
    message: 'A verification code or backup code is required',
    path: ['code'],
  });

const twoFactorConfirmSetupSchema = z.object({
  code: totpCodeSchema,
});

const twoFactorDisableSchema = z.object({
  password: z.string().min(1, 'Password is required'),
});

// Forgot/Reset Password schemas
const forgotPasswordSchema = z.object({
  email: z
    .string()
    .email('Invalid email address')
    .transform((v) => v.toLowerCase().trim()),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128)
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
});

// Calendar Event schemas
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format');
const timeOrEmpty = z
  .union([z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM format'), z.literal('')])
  .default('');

const calendarRecurrenceSchema = z
  .object({
    freq: z.enum(['weekly', 'monthly', 'yearly']),
    interval: z.number().int().min(1).max(52).default(1),
    endDate: dateString.optional().nullable(),
    endCount: z.number().int().min(1).max(365).optional().nullable(),
  })
  .optional()
  .nullable();

const createCalendarEventSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200).trim(),
  date: dateString,
  type: z.enum(['event', 'meeting', 'exam', 'holiday']).default('event'),
  startTime: timeOrEmpty,
  endTime: timeOrEmpty,
  allDay: z.boolean().default(false),
  description: z.string().max(1000).optional().nullable(),
  holidayType: z.enum(['National', 'Regional', 'School']).optional().nullable(),
  recurrence: calendarRecurrenceSchema,
});

const updateCalendarEventSchema = z
  .object({
    title: z.string().min(1).max(200).trim().optional(),
    date: dateString.optional(),
    type: z.enum(['event', 'meeting', 'exam', 'holiday']).optional(),
    startTime: timeOrEmpty.optional(),
    endTime: timeOrEmpty.optional(),
    allDay: z.boolean().optional(),
    description: z.string().max(1000).optional().nullable(),
    holidayType: z.enum(['National', 'Regional', 'School']).optional().nullable(),
    recurrence: calendarRecurrenceSchema,
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'At least one field must be provided',
  });

export const zodSchemas = {
  // Auth
  signup: signupSchema,
  login: loginSchema,

  // Password reset
  forgotPassword: forgotPasswordSchema,
  resetPassword: resetPasswordSchema,

  // 2FA
  twoFactorVerifyLogin: twoFactorVerifyLoginSchema,
  twoFactorConfirmSetup: twoFactorConfirmSetupSchema,
  twoFactorDisable: twoFactorDisableSchema,

  // Calendar Events
  createCalendarEvent: createCalendarEventSchema,
  updateCalendarEvent: updateCalendarEventSchema,

  // POST /api/timetable — Create timetable
  createTimetable: z.object({
    classId: objectId,
    academicYear: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional(),
    periods: z.array(periodSchema).min(1).optional(),
    schedule: scheduleSchema.optional(),
  }),

  // PUT /api/timetable/:classId — Update entire timetable
  updateTimetable: z.object({
    academicYear: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional(),
    periods: z.array(periodSchema).min(1).optional(),
    schedule: scheduleSchema.optional(),
  }),

  // PUT /api/timetable/:classId/slot — Update single slot
  updateSlot: z.object({
    day: z.enum(VALID_DAYS),
    periodIndex: z.number().int().min(0).max(11),
    subject: z.string().max(100).default(''),
    teacherId: optionalObjectId,
    room: z.string().max(100).default(''),
    academicYear: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional(),
  }),

  // POST /api/timetable/:classId/batch — Batch update slots
  batchUpdateSlots: z.object({
    academicYear: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional(),
    slots: z
      .array(
        z.object({
          day: z.enum(VALID_DAYS),
          periodIndex: z.number().int().min(0).max(11),
          subject: z.string().max(100).default(''),
          teacherId: optionalObjectId,
          room: z.string().max(100).default(''),
        })
      )
      .min(1),
  }),

  // PUT /api/timetable/:classId/periods — Update period config
  updatePeriods: z.object({
    periods: z.array(periodSchema).min(1).max(12),
  }),

  // POST /api/timetable/generate-all — Generate all timetables
  generateAll: z.object({
    academicYear: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional(),
    periodRules: z
      .object({
        maxPeriodsPerSubjectPerDay: z.number().int().min(1).max(6).default(1),
        maxPeriodsPerSubjectPerWeek: z.number().int().min(1).max(36).default(5),
        noConsecutiveSame: z.boolean().default(true),
        preferMorningForCore: z.boolean().default(false),
      })
      .optional(),
  }),

  // PUT /api/teacher-timetable/:teacherId/slot — Update teacher slot
  teacherUpdateSlot: z.object({
    day: z.enum(VALID_DAYS),
    periodIndex: z.number().int().min(0).max(11),
    classId: optionalObjectId,
    subject: z.string().max(100).default(''),
    room: z.string().max(100).default(''),
  }),

  // POST /api/teacher-timetable/:teacherId/switch-class
  switchClass: z.object({
    day: z.enum(VALID_DAYS),
    periodIndex: z.number().int().min(0).max(11),
    newClassId: objectId,
    subject: z.string().max(100).optional(),
  }),

  // PUT /google-classroom/config — Update Google Classroom sync settings
  updateGoogleClassroomConfig: z
    .object({
      syncFrequency: z.enum(['manual', 'hourly', 'daily', 'weekly']).optional(),
      syncStudents: z.boolean().optional(),
      syncAssignments: z.boolean().optional(),
      syncGrades: z.boolean().optional(),
      conflictResolution: z
        .enum(['ems_wins', 'google_wins', 'newer_wins', 'flag_conflict'])
        .optional(),
      academicYear: z
        .string()
        .regex(/^\d{4}-\d{2}$/)
        .optional()
        .nullable(),
    })
    .refine((data) => Object.values(data).some((v) => v !== undefined), {
      message: 'At least one setting must be provided',
    }),

  // POST /google-classroom/mappings — Create class mapping
  createGoogleClassroomMapping: z.object({
    emsClassId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid class ID'),
    googleCourseId: z.string().min(1).max(200),
    googleCourseName: z.string().max(300).optional(),
    syncStudents: z.boolean().default(true),
    syncAssignments: z.boolean().default(true),
    syncGrades: z.boolean().default(true),
  }),

  // POST /google-classroom/teacher-mappings — Map EMS staff to Google user
  createGoogleTeacherMapping: z.object({
    emsStaffId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid staff ID'),
    googleUserId: z.string().min(1).max(200),
    googleEmail: z.string().email().optional(),
  }),

  // PUT /auth/sso/config — Update school SSO configuration
  updateSsoConfig: z.object({
    google: z
      .object({
        enabled: z.boolean(),
        clientId: z.string().max(500).optional().nullable(),
        clientSecret: z.string().max(500).optional().nullable(),
      })
      .optional(),
    microsoft: z
      .object({
        enabled: z.boolean(),
        clientId: z.string().max(500).optional().nullable(),
        clientSecret: z.string().max(500).optional().nullable(),
        tenantId: z.string().max(200).optional().nullable(),
      })
      .optional(),
    saml: z
      .object({
        enabled: z.boolean(),
        entryPoint: z.string().url('Must be a valid URL').max(2000).optional().nullable(),
        issuer: z.string().max(500).optional().nullable(),
        cert: z.string().max(10000).optional().nullable(),
        emailAttribute: z.string().max(100).optional().nullable(),
        nameAttribute: z.string().max(100).optional().nullable(),
        groupAttribute: z.string().max(100).optional().nullable(),
      })
      .optional(),
    groupRoleMappings: z
      .array(
        z.object({
          groupName: z.string().min(1).max(200),
          role: z.enum([
            'Admin',
            'Teacher',
            'Accountant',
            'Librarian',
            'Principal',
            'Vice Principal',
            'Lab Assistant',
            'Receptionist',
            'Administrative',
            'Teaching',
          ]),
        })
      )
      .max(50)
      .optional(),
    allowedDomains: z
      .array(
        z
          .string()
          .min(1)
          .max(253)
          .regex(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'Invalid domain format')
      )
      .max(20)
      .optional(),
    autoProvision: z.boolean().optional(),
    defaultRole: z
      .enum([
        'Admin',
        'Teacher',
        'Accountant',
        'Librarian',
        'Principal',
        'Vice Principal',
        'Lab Assistant',
        'Receptionist',
        'Administrative',
        'Teaching',
      ])
      .optional(),
    ssoOnly: z.boolean().optional(),
    scim: z
      .object({
        enabled: z.boolean(),
        // Token is write-only; omit to keep existing
        token: z.string().min(20).max(200).optional().nullable(),
      })
      .optional(),
  }),

  // POST /api/parent/teachers/:teacherId/rate
  teacherRatingCreate: z.object({
    studentId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid studentId'),
    rating: z
      .number({
        required_error: 'Rating is required',
        invalid_type_error: 'Rating must be a number',
      })
      .int()
      .min(1, 'Rating must be at least 1')
      .max(5, 'Rating cannot exceed 5'),
    comment: z.string().max(500).optional().nullable(),
  }),

  // POST /api/parent/feedback
  parentFeedbackCreate: z.object({
    studentId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, 'Invalid studentId')
      .optional()
      .nullable(),
    category: z.enum(['general', 'academic', 'facilities', 'staff', 'transport', 'fees', 'other']),
    subject: z.string().min(1, 'Subject is required').max(200),
    message: z.string().min(10, 'Message must be at least 10 characters').max(2000),
  }),

  // PUT /api/parent/profile
  parentProfileUpdate: z.object({
    email: z.string().email('Invalid email address').optional().nullable(),
    avatar: z.string().url('Avatar must be a valid URL').optional().nullable(),
    preferences: z
      .object({
        language: z.string().max(10).optional(),
        notifications: z.boolean().optional(),
      })
      .optional(),
  }),

  // POST /api/parent/fcm-token
  fcmToken: z.object({
    token: z.string().min(1, 'FCM token is required'),
    deviceInfo: z.string().max(500).optional().nullable(),
  }),

  // POST /api/homework — Create homework assignment
  createHomework: z.object({
    title: z.string().min(1, 'Title is required').max(200),
    description: z.string().min(1, 'Description is required').max(2000),
    subject: z.string().min(1, 'Subject is required').max(100),
    classId: objectId,
    // Optional section identifier (e.g. 'A') for section-level targeting within a class
    sectionId: z.string().max(10).optional(),
    teacherId: objectId,
    dueDate: z
      .string()
      .refine((val) => !isNaN(new Date(val).getTime()), {
        message: 'Invalid due date format. Use YYYY-MM-DD or ISO format.',
      })
      .optional(),
    attachments: z
      .array(
        z.object({
          name: z.string().max(200).optional(),
          url: z.string().url('Invalid attachment URL'),
          type: z.string().max(50).optional(),
        })
      )
      .optional(),
    sentToParents: z.boolean().optional(),
  }),

  // PUT /api/homework/:id — Update homework assignment
  updateHomework: z
    .object({
      title: z.string().min(1).max(200).optional(),
      description: z.string().min(1).max(2000).optional(),
      subject: z.string().min(1).max(100).optional(),
      dueDate: z
        .string()
        .refine((val) => !isNaN(new Date(val).getTime()), {
          message: 'Invalid due date format. Use YYYY-MM-DD or ISO format.',
        })
        .optional(),
      status: z.enum(['active', 'cancelled', 'completed']).optional(),
      attachments: z
        .array(
          z.object({
            name: z.string().max(200).optional(),
            url: z.string().url('Invalid attachment URL'),
            type: z.string().max(50).optional(),
          })
        )
        .optional(),
    })
    .refine((data) => Object.values(data).some((v) => v !== undefined), {
      message: 'At least one field must be provided',
    }),

  // POST /api/homework/:id/submit — Submit homework (studentId in body, used by staff/admin on behalf of student)
  teacherSubmitHomework: z.object({
    studentId: objectId,
    remarks: z.string().max(1000).optional(),
    attachments: z
      .array(
        z.object({
          name: z.string().max(200).optional(),
          url: z.string().url('Invalid attachment URL'),
        })
      )
      .optional(),
  }),

  // POST /api/homework/:id/grade — Grade a submission (teacher)
  gradeHomework: z.object({
    studentId: objectId,
    marks: z
      .number({
        required_error: 'Marks are required',
        invalid_type_error: 'Marks must be a number',
      })
      .min(0, 'Marks cannot be negative')
      .max(100, 'Marks cannot exceed 100'),
    feedback: z.string().max(1000).optional(),
  }),

  // POST /api/parent/students/:id/homework/:homeworkId/submit
  submitHomework: z.object({
    remarks: z.string().max(1000).optional(),
    attachments: z
      .array(
        z.object({
          name: z.string().max(200).optional(),
          url: z.string().url('Invalid attachment URL'),
        })
      )
      .optional(),
  }),

  // POST /api/fee-heads — Create fee head
  createFeeHead: z.object({
    name: z.string().min(1, 'Fee head name is required').max(200).trim(),
    category: z
      .enum(['Academic', 'Transport', 'Extra-curricular', 'Hostel', 'Other'])
      .default('Academic'),
    headType: z
      .enum([
        'tuition',
        'learning',
        'miscellaneous',
        'study_materials',
        'exam_development',
        'admission',
        'transport',
        'lab',
        'library',
        'computer',
        'sports',
        'extra_curricular',
        'uniforms_id',
        'hostel',
        'custom',
      ])
      .optional(),
    customType: z.string().max(100).optional(),
    amount: z
      .number({
        required_error: 'Amount is required',
        invalid_type_error: 'Amount must be a number',
      })
      .min(0, 'Amount cannot be negative')
      .max(10000000, 'Amount exceeds maximum'),
    mandatory: z.boolean().default(true),
    description: z.string().max(500).optional().default(''),
    applicableClasses: z
      .array(z.string().regex(/^(1[0-2]|[1-9])$/, 'Class must be 1-12'))
      .min(1, 'At least one applicable class is required'),
    applicableStreams: z.array(z.enum(['Science', 'Commerce', 'Arts', 'All'])).optional(),
    frequency: z.enum(['monthly', 'quarterly', 'term', 'yearly', 'one-time']).default('yearly'),
    autoApply: z.boolean().default(true),
  }),

  // PUT /api/fee-heads/:id — Update fee head
  updateFeeHead: z
    .object({
      name: z.string().min(1, 'Fee head name is required').max(200).trim().optional(),
      category: z.enum(['Academic', 'Transport', 'Extra-curricular', 'Hostel', 'Other']).optional(),
      headType: z
        .enum([
          'tuition',
          'learning',
          'miscellaneous',
          'study_materials',
          'exam_development',
          'admission',
          'transport',
          'lab',
          'library',
          'computer',
          'sports',
          'extra_curricular',
          'uniforms_id',
          'hostel',
          'custom',
        ])
        .optional(),
      customType: z.string().max(100).optional(),
      amount: z
        .number({
          invalid_type_error: 'Amount must be a number',
        })
        .min(0, 'Amount cannot be negative')
        .max(10000000, 'Amount exceeds maximum')
        .optional(),
      mandatory: z.boolean().optional(),
      description: z.string().max(500).optional(),
      applicableClasses: z
        .array(z.string().regex(/^(1[0-2]|[1-9])$/, 'Class must be 1-12'))
        .min(1, 'At least one applicable class is required')
        .optional(),
      applicableStreams: z.array(z.enum(['Science', 'Commerce', 'Arts', 'All'])).optional(),
      frequency: z.enum(['monthly', 'quarterly', 'term', 'yearly', 'one-time']).optional(),
      autoApply: z.boolean().optional(),
      isActive: z.boolean().optional(),
    })
    .refine((data) => Object.values(data).some((v) => v !== undefined), {
      message: 'At least one field must be provided',
    }),

  // POST /api/parent/students/:id/payment/create-order
  paymentCreateOrder: z.object({
    amount: z
      .number({
        required_error: 'Amount is required',
        invalid_type_error: 'Amount must be a number',
      })
      .positive('Amount must be greater than 0')
      .max(10000000),
    feeHeadPayments: z
      .array(
        z.object({
          feeHeadId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid feeHeadId'),
          amount: z.number().positive('Fee head amount must be positive'),
          name: z.string().max(200).optional(),
        })
      )
      .optional(),
    academicYear: z
      .string()
      .regex(/^\d{4}-\d{2}$/, 'Academic year must be YYYY-YY format')
      .optional()
      .nullable(),
  }),

  // POST /api/parent/students/:id/payment/verify
  paymentVerify: z
    .object({
      razorpay_order_id: z.string().optional().nullable(),
      razorpay_payment_id: z.string().optional().nullable(),
      razorpay_signature: z.string().optional().nullable(),
      amount: z
        .number({
          required_error: 'Amount is required',
          invalid_type_error: 'Amount must be a number',
        })
        .positive('Amount must be greater than 0'),
      feeHeadPayments: z
        .array(
          z.object({
            feeHeadId: z.string().optional(),
            amount: z.number().positive('Fee head amount must be positive'),
            name: z.string().max(200).optional(),
            feeHeadName: z.string().max(200).optional(),
          })
        )
        .optional(),
      academicYear: z
        .string()
        .regex(/^\d{4}-\d{2}$/, 'Academic year must be YYYY-YY format')
        .optional()
        .nullable(),
      mock: z.boolean().optional(),
    })
    .superRefine((data, ctx) => {
      if (!data.mock) {
        if (!data.razorpay_order_id)
          ctx.addIssue({
            code: 'custom',
            path: ['razorpay_order_id'],
            message: 'Order ID is required for non-mock payments',
          });
        if (!data.razorpay_payment_id)
          ctx.addIssue({
            code: 'custom',
            path: ['razorpay_payment_id'],
            message: 'Payment ID is required for non-mock payments',
          });
        if (!data.razorpay_signature)
          ctx.addIssue({
            code: 'custom',
            path: ['razorpay_signature'],
            message: 'Signature is required for non-mock payments',
          });
      }
    }),
};

/**
 * Zod validation middleware factory
 * Works like validate() but uses Zod schemas
 */
export function validateZod(schema, source = 'body') {
  return (req, res, next) => {
    const data =
      source === 'body'
        ? req.body
        : source === 'params'
          ? req.params
          : source === 'query'
            ? req.query
            : req[source];

    const result = schema.safeParse(data);

    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));

      return res.status(400).json({
        success: false,
        error: req.t ? req.t('common:errors.validationError') : 'Validation failed',
        statusCode: 400,
        details: errors,
      });
    }

    // Replace request data with validated and sanitized data
    if (source === 'body') req.body = result.data;
    else if (source === 'params') req.params = result.data;
    else if (source === 'query') req.query = result.data;
    else req[source] = result.data;

    next();
  };
}
