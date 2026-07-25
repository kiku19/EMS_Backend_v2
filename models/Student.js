import mongoose from 'mongoose';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';
import piiPlugin from '../utils/piiPlugin.js';

const studentSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    name: { type: String, required: true },
    admissionId: { type: String },
    academicYear: { type: String, default: CURRENT_ACADEMIC_YEAR },
    admissionDate: { type: Date },
    rollNo: Number,
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    // Front-desk conversion back-references (routes/frontDesk.js writes these
    // when converting an admission inquiry into a Student). Previously dropped
    // by Mongoose strict mode, so the inquiry link was permanently lost.
    section: String,
    hscGroup: String,
    admissionInquiryId: { type: mongoose.Schema.Types.ObjectId, ref: 'AdmissionInquiry' },

    // Personal Information
    gender: String,
    dateOfBirth: {
      type: String,
      validate: {
        validator: function (v) {
          if (!v) return true; // Optional
          const dob = new Date(v);
          const now = new Date();
          const minDate = new Date(now.getFullYear() - 100, now.getMonth(), now.getDate());
          return dob <= now && dob >= minDate;
        },
        message: 'Date of birth must be within the last 100 years and not in the future',
      },
    },
    bloodGroup: String,
    nationality: String,
    religion: String,
    category: String,
    motherTongue: String,
    aadhaarNumber: {
      type: String,
      validate: {
        validator: function (v) {
          if (!v) return true; // Optional
          return /^\d{12}$/.test(v);
        },
        message: 'Aadhaar number must be exactly 12 digits',
      },
    },

    // Contact Information
    phone: String,
    alternatePhone: String, // captured by ContactSection; was stripped by Mongoose strict
    email: {
      type: String,
      validate: {
        validator: function (v) {
          if (!v) return true; // Optional
          return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(v);
        },
        message: 'Please enter a valid email address',
      },
    },
    isWhatsapp: { type: Boolean, default: true },
    whatsappNumber: String,
    address: String,
    city: String,
    state: String,
    zipCode: {
      type: String,
      validate: {
        validator: function (v) {
          if (!v) return true; // Optional
          return /^\d{6}$/.test(v);
        },
        message: 'ZIP code must be exactly 6 digits',
      },
    },

    // Parents/Guardians (stored as array)
    // Each entry is linked to the canonical Parent collection via parentId.
    // The embedded name/phone/email fields remain as a denormalized cache for
    // student-scoped reads; parentId makes the link to the authoritative
    // Parent account explicit.
    parents: {
      type: [
        {
          parentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Parent',
            default: null,
            index: true,
          },
          name: { type: String, required: true },
          relationship: String,
          phone: String,
          email: String,
          occupation: String,
          isWhatsapp: { type: Boolean, default: true },
          isParent: { type: Boolean },
        },
      ],
      validate: {
        validator: function (v) {
          return v && v.length > 0;
        },
        message: 'At least one parent/guardian is required',
      },
    },

    // Siblings (only siblings in the same school)
    siblings: [
      {
        name: { type: String, required: true },
        age: { type: Number },
        class: { type: String },
        school: { type: String },
        inSameSchool: { type: Boolean, default: true },
        classId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Class',
          required: function () {
            return this.inSameSchool === true;
          },
        },
      },
    ],

    // Academic Information
    previousSchool: String,
    tcNumber: String,
    mediumOfInstruction: String,
    house: String,

    // Health & Safety (legacy flat fields)
    medicalConditions: String,
    // Legacy flat allergies list (free-text strings). Captured by
    // CreateStudentComposer's top-level `allergies` input; the structured
    // home is healthInfo.allergies (allergySchema objects). Kept as a top-
    // level [String] so the legacy capture isn't silently dropped.
    allergies: { type: [String] },
    emergencyContactName: String,
    emergencyContactPhone: String,

    // Detailed Health Records
    healthInfo: {
      allergies: [
        {
          name: { type: String, required: true },
          // `type` is a reserved Mongoose schema key; use the explicit nested
          // declaration so allergies remain subdocuments instead of [String].
          type: { type: String }, // food, medication, environmental, insect, latex, other
          severity: String, // mild, moderate, severe, life-threatening
          reaction: String,
          notes: String,
        },
      ],
      medications: [
        {
          name: { type: String, required: true },
          dosage: String,
          frequency: String,
          startDate: String,
          endDate: String,
          prescribedBy: String,
          notes: String,
        },
      ],
      emergencyContacts: [
        {
          name: { type: String, required: true },
          relationship: String,
          phone: { type: String, required: true },
          alternatePhone: String,
          email: String,
          priority: { type: Number, default: 1 },
        },
      ],
    },

    // Requirements
    transportRequired: { type: Boolean, default: false },
    hostelRequired: { type: Boolean, default: false },

    // Status
    feeStatus: {
      type: String,
      enum: ['paid', 'pending', 'partial', 'overdue'],
      default: 'pending',
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'graduated', 'transferred', 'alumni'],
      default: 'active',
    },

    // Alumni Information (populated when status is set to 'alumni')
    alumniInfo: {
      graduationYear: String, // Academic year of graduation e.g. "2023-24"
      since: Date, // Date when marked as alumni
      currentCity: String,
      currentOccupation: String, // Higher education, job title, etc.
      alumniEmail: String,
      alumniPhone: String,
      notes: String,
    },

    // Pinning
    isPinned: { type: Boolean, default: false },
    pinnedAt: { type: Date },

    // Fee Details
    feeDetails: {
      totalFee: { type: Number, default: 0 },
      paidAmount: { type: Number, default: 0 },
      balanceAmount: { type: Number, default: 0 },
      discountApplied: { type: Number, default: 0 },
      lastPaymentDate: String,
    },

    // Documents (stored as references or URLs)
    documents: [
      {
        id: { type: String, required: true },
        name: String,
        // NOTE: `type` is a reserved Mongoose keyword. Inside a subdocument,
        // a bare `type: String` declaration makes Mongoose interpret `type`
        // as THIS subdoc's type discriminator rather than as a path named
        // "type" — which silently broke the whole array (it compiled as
        // [String] instead of [subdoc], so every document field was lost).
        // The explicit `{ type: { type: String } }` form disambiguates.
        type: { type: String },
        category: String, // birthCertificate, tc, aadhaar, etc.
        front: { url: String, uploadDate: Date },
        back: { url: String, uploadDate: Date },
        // Legacy support for old single-file documents
        url: String,
        uploadDate: Date,
        // File metadata captured by useStudentSubmit / useStudentDocuments.
        // Zod (singleDocSchema/addDocumentSchema) already declared these, but
        // they were dropped by Mongoose strict mode.
        size: { type: mongoose.Schema.Types.Mixed },
        date: String,
      },
    ],

    photo: String,

    // Student ratings (teacher-assessed dimensions)
    ratings: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // COPPA compliance flag
    coppaApplicable: {
      type: Boolean,
      default: false,
    },

    // Transfer Certificate record
    transferCertificate: {
      tcNumber: { type: String },
      issuedAt: { type: Date },
      issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
      reasonForLeaving: { type: String, default: '' },
      lastClassAttended: { type: String, default: '' },
      daysPresent: { type: Number },
      workingDays: { type: Number },
      generalConduct: { type: String, default: 'Good' },
      remarks: { type: String, default: '' },
    },

    // Soft delete fields
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      default: null,
    },
  },
  { timestamps: true }
);

// ── PII encryption: encrypt sensitive fields at rest ─────────────────────────
studentSchema.plugin(piiPlugin, {
  fields: [
    'phone',
    'email',
    'whatsappNumber',
    'address',
    'aadhaarNumber',
    'emergencyContactName',
    'emergencyContactPhone',
    'alumniEmail',
    'alumniPhone',
  ],
  searchableFields: ['phone', 'email'],
  arrayFields: {
    parents: ['phone', 'email'],
    'healthInfo.emergencyContacts': ['phone', 'alternatePhone', 'email'],
  },
});

studentSchema.index(
  { schoolId: 1, admissionId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
studentSchema.index({ classId: 1, status: 1 });
studentSchema.index(
  { schoolId: 1, rollNo: 1, classId: 1, academicYear: 1 },
  {
    unique: true,
    partialFilterExpression: { rollNo: { $type: 'number' }, isDeleted: false },
  }
);
studentSchema.index({ isPinned: 1, pinnedAt: -1 });
studentSchema.index({ status: 1 });
studentSchema.index({ feeStatus: 1 });
studentSchema.index({ isDeleted: 1, deletedAt: -1 });
studentSchema.index({ schoolId: 1, isDeleted: 1, createdAt: -1 });
studentSchema.index({ schoolId: 1, isDeleted: 1, name: 1 });
studentSchema.index({ schoolId: 1, classId: 1, isDeleted: 1 });
studentSchema.index({ schoolId: 1, academicYear: 1, isDeleted: 1 });
// Transfer-certificate numbers are legal identifiers and must never be reused,
// even if a student is later archived. Tenant-first uniqueness lets different
// schools retain their own numbering series while making concurrent issuance
// collision-safe at the database boundary.
studentSchema.index(
  { schoolId: 1, 'transferCertificate.tcNumber': 1 },
  {
    unique: true,
    partialFilterExpression: { 'transferCertificate.tcNumber': { $type: 'string' } },
  }
);
// PERF-571: Compact index for school-scoped count queries (countDocuments,
// dashboard totals, etc.). Smaller than the 3-field compounds above so it
// stays hotter in cache and gives covered counts for the common
// { schoolId, isDeleted } filter.
studentSchema.index({ schoolId: 1, isDeleted: 1 });

export default mongoose.model('Student', studentSchema);
