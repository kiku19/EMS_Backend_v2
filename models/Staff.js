import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import piiPlugin from '../utils/piiPlugin.js';

const staffSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    code: { type: String, required: true },
    name: { type: String, required: true },
    role: {
      type: [
        {
          type: String,
          enum: [
            'Admin',
            'Super Admin',
            'Teacher',
            'Accountant',
            'Librarian',
            'Principal',
            'Vice Principal',
            'Lab Assistant',
            'Receptionist',
            'Counselor',
            'Driver',
            'Security',
            'Administrative',
            'Teaching',
          ],
        },
      ],
      required: true,
    },
    department: String,
    status: {
      type: String,
      default: 'active',
      enum: ['active', 'inactive', 'on-leave', 'suspended', 'terminated'],
    },
    phone: String,
    email: String,
    joinDate: { type: mongoose.Schema.Types.Mixed }, // Accepts String (legacy) or Date (migrated)
    joinDateParsed: Date, // Migration target: parsed Date from legacy String joinDate
    address: String,
    nationality: { type: String, default: 'Indian' },
    shift: { type: String, default: 'Morning' },
    designation: String,

    // Personal Details
    dob: { type: mongoose.Schema.Types.Mixed }, // Accepts String (legacy) or Date (migrated)
    dobParsed: Date, // Migration target: parsed Date from legacy String dob
    gender: { type: String, enum: ['Male', 'Female', 'Other'] },
    fatherName: String,
    bloodGroup: { type: String, enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] },
    maritalStatus: { type: String, enum: ['Single', 'Married', 'Divorced', 'Widowed'] },
    employmentType: String,
    emergencyContact: String, // @deprecated - use emergencyContacts[] array instead
    emergencyPhone: String, // @deprecated - use emergencyContacts[] array instead
    emergencyContacts: [
      {
        name: String,
        relationship: String,
        phone: String,
      },
    ],
    whatsappNumber: String,
    isWhatsapp: { type: Boolean, default: false },

    // Documents
    picture: String, // URL to profile picture
    photo: String, // Legacy alias used by chat and older views
    idDocuments: [
      {
        type: String, // Document type (Aadhar Card, PAN Card, etc.)
        url: String, // Document URL
        name: String, // Original file name
      },
    ], // Array of ID document objects with metadata

    // Qualifications
    professionalQualifications: [
      {
        name: String,
        year: String,
        documents: [String], // URLs to certificates
      },
    ],
    totalExperience: String, // @deprecated - use experience (Number) instead
    previousOrganization: String,
    roleInOrganization: String,
    qualificationDocs: [String], // URLs to qualification documents
    customDocuments: [String], // URLs to custom documents
    qualification: String,
    experience: { type: Number, default: 0 },

    // Staff Info
    staffNumber: String,
    staffType: [String], // @deprecated - use role[] instead; values migrated via 001_staff_schema_consolidation
    assignedClasses: [{ type: mongoose.Schema.Types.Mixed }], // Accepts String (legacy) or ObjectId (migrated)
    isClassTeacher: Boolean,
    classTeacherOf: { type: mongoose.Schema.Types.Mixed, ref: 'Class' }, // String (legacy) or ObjectId (migrated)

    // Bank & Salary
    accountNumber: String,
    ifscCode: String,
    bankName: String,
    branchName: String,
    panNumber: String,
    salary: { type: Number, default: 0 }, // Base salary for payroll
    salaryTemplate: String,
    salaryBreakdown: [
      {
        component: String,
        amount: Number,
      },
    ],

    // Login credentials
    username: { type: String, sparse: true },
    password: { type: String, required: true }, // Hashed with bcrypt

    // Two-Factor Authentication
    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorSecret: { type: String, select: false }, // Encrypted TOTP secret
    twoFactorEnrolledAt: { type: Date },
    twoFactorBackupCodes: { type: [String], select: false }, // Hashed backup codes
    trustedDevices: {
      type: [
        {
          token: { type: String, required: true }, // bcrypt hash of device token
          expiresAt: { type: Date, required: true },
          userAgent: { type: String },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
      select: false,
    },

    // Soft Delete
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },

    // Hierarchy
    reporterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },

    // Timetable Management - Teacher Assignments
    teacherAssignments: [
      {
        subject: { type: String, required: true },
        classes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Class' }],
        createdAt: { type: Date, default: Date.now },
      },
    ],

    // Multi-branch: additional schools this staff member is shared with
    additionalSchoolIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'School' }],

    // Token revocation: incremented on logout to invalidate outstanding refresh tokens
    tokenVersion: { type: Number, default: 1 },

    // SSO identities linked to this staff account
    ssoIdentities: [
      {
        provider: { type: String, enum: ['google', 'microsoft', 'saml'] },
        providerUserId: { type: String },
        email: { type: String },
        linkedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

// Hash password before saving
staffSchema.pre('save', async function (next) {
  const canonicalPhoto = this.picture || this.photo;
  if (canonicalPhoto) {
    this.picture = canonicalPhoto;
    this.photo = canonicalPhoto;
  }

  // Only hash the password if it has been modified (or is new)
  if (!this.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Hash password on findOneAndUpdate
staffSchema.pre('findOneAndUpdate', async function (next) {
  try {
    const update = this.getUpdate();
    if (update.$set && update.$set.password) {
      const salt = await bcrypt.genSalt(10);
      update.$set.password = await bcrypt.hash(update.$set.password, salt);
    }
    next();
  } catch (error) {
    next(error);
  }
});

// Sync picture/photo on findOneAndUpdate
staffSchema.pre('findOneAndUpdate', function (next) {
  const update = this.getUpdate();
  if (update.$set) {
    if (update.$set.picture && !update.$set.photo) {
      update.$set.photo = update.$set.picture;
    } else if (update.$set.photo && !update.$set.picture) {
      update.$set.picture = update.$set.photo;
    }
  }
  next();
});

// Method to compare password for login
staffSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// ── PII encryption: encrypt sensitive fields at rest ─────────────────────────
staffSchema.plugin(piiPlugin, {
  fields: [
    'phone',
    'email',
    'address',
    'whatsappNumber',
    'accountNumber',
    'ifscCode',
    'panNumber',
    'emergencyContact',
    'emergencyPhone',
  ],
  searchableFields: ['phone', 'email'],
  arrayFields: {
    emergencyContacts: ['phone'],
  },
});

staffSchema.index(
  { schoolId: 1, code: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
staffSchema.index(
  { schoolId: 1, username: 1 },
  {
    unique: true,
    partialFilterExpression: { username: { $exists: true }, isDeleted: false },
  }
);
staffSchema.index(
  { schoolId: 1, phone: 1 },
  {
    unique: true,
    partialFilterExpression: { phone: { $type: 'string' }, isDeleted: false },
  }
);
staffSchema.index({ schoolId: 1, status: 1, isDeleted: 1 });
staffSchema.index({ 'teacherAssignments.subject': 1 });
staffSchema.index({ 'teacherAssignments.classes': 1 });

export default mongoose.model('Staff', staffSchema);
