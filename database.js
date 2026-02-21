import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { CURRENT_ACADEMIC_YEAR } from './utils/constants.js';

dotenv.config();

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/school_db';

export async function connectDB() {
  try {
    mongoose.set('strictQuery', false);
    
    // Add connection event listeners
    mongoose.connection.on('connected', () => {
      console.log('✅ MongoDB connected successfully');
    });
    
    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err);
    });
    
    mongoose.connection.on('disconnected', () => {
      console.warn('⚠️ MongoDB disconnected');
    });
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      console.log('MongoDB connection closed through app termination');
      process.exit(0);
    });
    
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 10,
      minPoolSize: 2,
      socketTimeoutMS: 45000,
    });
    
    console.log('Connected to MongoDB:', MONGODB_URI.replace(/\/\/.*@/, '//***@')); // Hide credentials in log
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    console.error('MongoDB URI (sanitized):', MONGODB_URI.replace(/\/\/.*@/, '//***@'));
    
    // Don't exit immediately in development, allow retry
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    } else {
      console.warn('⚠️ Running in development mode without database connection');
    }
  }
}

// Staff Schema - with login credentials
const staffSchema = new mongoose.Schema({
  code: { type: String, unique: true, required: true },
  name: { type: String, required: true },
  role: { type: [String], required: true }, // Array of roles: Teacher, Admin, etc. (supports multiple roles)
  department: String,
  status: { type: String, default: 'active' },
  phone: String,
  email: String,
  joinDate: String,
  address: String,
  
  // Personal Details
  dob: String,
  gender: String,
  fatherName: String,
  bloodGroup: String,
  maritalStatus: String,
  employmentType: String,
  emergencyContact: String,
  emergencyPhone: String,
  emergencyContacts: [{
    name: String,
    relationship: String,
    phone: String
  }],
  whatsappNumber: String,
  isWhatsapp: { type: Boolean, default: false },
  
  // Documents
  picture: String, // URL to profile picture
  idDocuments: [{
    type: String, // Document type (Aadhar Card, PAN Card, etc.)
    url: String, // Document URL
    name: String // Original file name
  }], // Array of ID document objects with metadata
  
  // Qualifications
  professionalQualifications: [{
    name: String,
    year: String,
    documents: [String] // URLs to certificates
  }],
  totalExperience: String,
  previousOrganization: String,
  roleInOrganization: String,
  qualificationDocs: [String], // URLs to qualification documents
  customDocuments: [String], // URLs to custom documents
  
  // Staff Info
  staffNumber: String,
  staffType: [String], // Array of staff types to match role field
  assignedClasses: [String],
  isClassTeacher: Boolean,
  classTeacherOf: String,
  
  // Bank & Salary
  accountNumber: String,
  ifscCode: String,
  bankName: String,
  branchName: String,
  salary: { type: Number, default: 0 }, // Base salary for payroll
  salaryTemplate: String,
  salaryBreakdown: [{
    component: String,
    amount: Number
  }],
  
  // Login credentials
  username: { type: String, unique: true, sparse: true },
  password: { type: String, required: true }, // Hashed with bcrypt
  
  // Hierarchy
  reporterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  
  // Timetable Management - Teacher Assignments
  teacherAssignments: [{
    subject: { type: String, required: true },
    classes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Class' }],
    createdAt: { type: Date, default: Date.now }
  }]
}, { timestamps: true, strict: false }); // Allow extra fields to pass through without error

// Hash password before saving
import bcrypt from 'bcrypt';

staffSchema.pre('save', async function(next) {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified('password')) return next();
  
  try {
    // Generate salt and hash password
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare password for login
staffSchema.methods.comparePassword = async function(candidatePassword) {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    throw error;
  }
};

// Indexes for Staff model
staffSchema.index({ 'teacherAssignments.subject': 1 });
staffSchema.index({ 'teacherAssignments.classes': 1 });

// Class Schema - with class teacher reference
const classSchema = new mongoose.Schema({
  name: { type: String, required: true }, // e.g., "Class 10"
  section: { type: String, required: true }, // e.g., "A"
  classTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  subjects: [String],
  academicYear: { type: String, default: CURRENT_ACADEMIC_YEAR },

  // Strength management
  strengthLimit: {
    current: { type: Number, default: 40 },
    default: { type: Number, default: 40 },
    adjustments: [{
      newLimit: Number,
      reason: String,
      approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
      date: { type: Date, default: Date.now }
    }]
  },

  // Academic and attendance tracking
  averageAttendance: { type: Number, default: 0, min: 0, max: 100 },
  averageAcademicPerformance: { type: Number, default: 0, min: 0, max: 100 },
  rating: { type: Number, default: 3, min: 1, max: 5 },

  // Chapter progress references
  chapterProgress: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ChapterProgress' }],

  // Room assignment
  room: String,
  block: String,
  
  // Timetable Management - Class Settings
  classTag: { type: String }, // Free-text tag for class identification
  assignedSubjects: [{ type: String }] // Subjects assigned to this class
}, { timestamps: true });

// Add compound unique index to prevent duplicate class name+section combinations
classSchema.index({ name: 1, section: 1, academicYear: 1 }, { unique: true });

// Student Schema - linked to class with comprehensive fields
const studentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  admissionId: { type: String, unique: true },
  academicYear: { type: String, default: CURRENT_ACADEMIC_YEAR },
  rollNo: Number,
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },

  // Personal Information
  gender: String,
  dateOfBirth: {
    type: String,
    validate: {
      validator: function(v) {
        if (!v) return true; // Optional
        const dob = new Date(v);
        const now = new Date();
        const minDate = new Date(now.getFullYear() - 100, now.getMonth(), now.getDate());
        return dob <= now && dob >= minDate;
      },
      message: 'Date of birth must be within the last 100 years and not in the future'
    }
  },
  bloodGroup: String,
  nationality: String,
  religion: String,
  category: String,
  motherTongue: String,
  aadhaarNumber: {
    type: String,
    validate: {
      validator: function(v) {
        if (!v) return true; // Optional
        return /^\d{12}$/.test(v);
      },
      message: 'Aadhaar number must be exactly 12 digits'
    }
  },

  // Contact Information
  phone: String,
  email: {
    type: String,
    validate: {
      validator: function(v) {
        if (!v) return true; // Optional
        return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(v);
      },
      message: 'Please enter a valid email address'
    }
  },
  isWhatsapp: { type: Boolean, default: true },
  whatsappNumber: String,
  address: String,
  city: String,
  state: String,
  zipCode: {
    type: String,
    validate: {
      validator: function(v) {
        if (!v) return true; // Optional
        return /^\d{6}$/.test(v);
      },
      message: 'ZIP code must be exactly 6 digits'
    }
  },

  // Parent/Guardian Information
  parentName: String,
  parentPhone: String,
  parentEmail: String,
  parentRelationship: String,
  parentOccupation: String,
  alternatePhone: String,

  // Additional Parents (stored as array)
  parents: {
    type: [{
      name: { type: String, required: true },
      relationship: String,
      phone: String,
      email: String,
      occupation: String,
      isWhatsapp: { type: Boolean, default: true }
    }],
    validate: {
      validator: function(v) {
        return v && v.length > 0;
      },
      message: 'At least one parent/guardian is required'
    }
  },

  // Siblings (only siblings in the same school)
  siblings: [{
    name: { type: String, required: true },
    inSameSchool: { type: Boolean, default: true },
    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Class',
      validate: {
        validator: async function(v) {
          // If inSameSchool is true, classId is required
          const sibling = this;
          const siblingIdx = sibling.siblings.findIndex(s => s.classId && s.classId.toString() === v?.toString());
          if (siblingIdx === -1) return true; // Not this sibling

          const thisSibling = sibling.siblings[siblingIdx];
          if (thisSibling.inSameSchool && !v) {
            return false;
          }
          return true;
        },
        message: 'Class is required when sibling is in the same school'
      }
    }
  }],

  // Academic Information
  previousSchool: String,
  tcNumber: String,

  // Health & Safety
  medicalConditions: String,
  emergencyContactName: String,
  emergencyContactPhone: String,

  // Requirements
  transportRequired: { type: Boolean, default: false },
  hostelRequired: { type: Boolean, default: false },

  // Status
  feeStatus: { type: String, default: 'pending' },
  status: { type: String, default: 'active' },

  // Pinning
  isPinned: { type: Boolean, default: false },
  pinnedAt: { type: Date },

  // Fee Details
  feeDetails: {
    totalFee: { type: Number, default: 0 },
    paidAmount: { type: Number, default: 0 },
    balanceAmount: { type: Number, default: 0 },
    discountApplied: { type: Number, default: 0 },
    lastPaymentDate: String
  },

  // Documents (stored as references or URLs)
  documents: [{
    id: { type: String, required: true },
    name: String,
    type: String,
    category: String, // birthCertificate, tc, aadhaar, etc.
    front: { url: String, uploadDate: Date },
    back: { url: String, uploadDate: Date },
    // Legacy support for old single-file documents
    url: String,
    uploadDate: Date
  }],

  photo: String,

  // Soft delete fields
  isDeleted: {
    type: Boolean,
    default: false,
    index: true // Critical for query performance
  },
  deletedAt: {
    type: Date,
    default: null
  },
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Staff',
    default: null
  }
}, { timestamps: true });

// Indexes for performance
// Note: admissionId already has unique: true in schema definition which creates an index
studentSchema.index({ classId: 1, status: 1 });
studentSchema.index({ rollNo: 1, classId: 1, academicYear: 1 }, { unique: true });
studentSchema.index({ isPinned: 1, pinnedAt: -1 });
studentSchema.index({ status: 1 });
studentSchema.index({ feeStatus: 1 });
// Add compound index for efficient trash queries
studentSchema.index({ isDeleted: 1, deletedAt: -1 });

// Attendance Schema
const attendanceSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  date: { type: String, required: true },
  status: { type: String, required: true }, // present, absent, late
  markedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
}, { timestamps: true });

attendanceSchema.index({ studentId: 1, date: 1 }, { unique: true });

// Exam Schema
const examSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String }, // unit_test, quiz, midterm, final (frontend field)
  examType: { type: String }, // Legacy field - unit-test, midterm, final, annual
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
  subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject' }, // Single subject mode
  subjectName: { type: String }, // Single subject name
  academicYear: { type: String, default: CURRENT_ACADEMIC_YEAR },
  startDate: { type: Date },
  endDate: { type: Date },
  totalMarks: { type: Number, default: 100 },
  maxMarks: { type: Number, default: 100 }, // Alias for frontend
  passingMarks: { type: Number, default: 35 },
  weightage: { type: Number, default: 10 },
  gradingType: { type: String, default: 'numerical' }, // numerical, grades, cgpa
  instructions: { type: String },
  subjects: [{
    subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject' },
    subjectName: String,
    date: Date,
    startTime: String,
    endTime: String,
    maxMarks: { type: Number, default: 100 },
    passingMarks: { type: Number, default: 33 }
  }],
  status: { type: String, default: 'scheduled' }, // scheduled, ongoing, completed, results_published
  isPublished: { type: Boolean, default: false },
  publishedAt: { type: Date },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' }
}, { timestamps: true });

// Result Schema
const resultSchema = new mongoose.Schema({
  examId: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
  academicYear: { type: String },
  // Simple single-subject fields
  marksObtained: { type: Number, default: 0 },
  maxMarks: { type: Number, default: 100 },
  remarks: { type: String },
  enteredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  enteredAt: { type: Date },
  // Multi-subject support (legacy/advanced)
  marks: [{
    subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject' },
    subjectName: String,
    marksObtained: Number,
    maxMarks: Number,
    passingMarks: Number,
    grade: String,
    remarks: String
  }],
  totalMarksObtained: { type: Number, default: 0 },
  totalMaxMarks: { type: Number, default: 0 },
  percentage: { type: Number, default: 0 },
  grade: String,
  rank: Number,
  status: { type: String, default: 'passed' }, // passed, failed, promoted
  isPublished: { type: Boolean, default: false }
}, { timestamps: true });

// Compound indexes for efficient queries
resultSchema.index({ examId: 1, studentId: 1 }, { unique: true });
resultSchema.index({ studentId: 1, academicYear: 1 });
resultSchema.index({ examId: 1, classId: 1 });

// Timetable Schema
const timetableSchema = new mongoose.Schema({
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  academicYear: { type: String, default: CURRENT_ACADEMIC_YEAR },
  periods: [{
    name: String,
    startTime: String,
    endTime: String,
    isBreak: { type: Boolean, default: false }
  }],
  schedule: {
    Monday: [{
      subject: String,
      teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
      room: String,
      // Timetable Management - Metadata
      lastModified: { type: Date, default: Date.now },
      modifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' }
    }],
    Tuesday: [{
      subject: String,
      teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
      room: String,
      lastModified: { type: Date, default: Date.now },
      modifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' }
    }],
    Wednesday: [{
      subject: String,
      teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
      room: String,
      lastModified: { type: Date, default: Date.now },
      modifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' }
    }],
    Thursday: [{
      subject: String,
      teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
      room: String,
      lastModified: { type: Date, default: Date.now },
      modifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' }
    }],
    Friday: [{
      subject: String,
      teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
      room: String,
      lastModified: { type: Date, default: Date.now },
      modifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' }
    }],
    Saturday: [{
      subject: String,
      teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
      room: String,
      lastModified: { type: Date, default: Date.now },
      modifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' }
    }]
  },
  // Timetable Management - Version Control
  version: { type: Number, default: 1 },
  lastSyncedAt: { type: Date, default: Date.now }
}, { timestamps: true });

timetableSchema.index({ classId: 1, academicYear: 1 }, { unique: true });
// Indexes for teacher queries in schedule
timetableSchema.index({ 'schedule.Monday.teacherId': 1 });
timetableSchema.index({ 'schedule.Tuesday.teacherId': 1 });
timetableSchema.index({ 'schedule.Wednesday.teacherId': 1 });
timetableSchema.index({ 'schedule.Thursday.teacherId': 1 });
timetableSchema.index({ 'schedule.Friday.teacherId': 1 });
timetableSchema.index({ 'schedule.Saturday.teacherId': 1 });

// Teacher Timetable Schema - for managing teacher schedules
const teacherTimetableSchema = new mongoose.Schema({
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true },
  academicYear: { type: String, default: CURRENT_ACADEMIC_YEAR },
  schedule: {
    Monday: [{
      periodIndex: Number,
      classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
      subject: String,
      room: String,
      lastModified: { type: Date, default: Date.now }
    }],
    Tuesday: [{
      periodIndex: Number,
      classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
      subject: String,
      room: String,
      lastModified: { type: Date, default: Date.now }
    }],
    Wednesday: [{
      periodIndex: Number,
      classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
      subject: String,
      room: String,
      lastModified: { type: Date, default: Date.now }
    }],
    Thursday: [{
      periodIndex: Number,
      classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
      subject: String,
      room: String,
      lastModified: { type: Date, default: Date.now }
    }],
    Friday: [{
      periodIndex: Number,
      classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
      subject: String,
      room: String,
      lastModified: { type: Date, default: Date.now }
    }],
    Saturday: [{
      periodIndex: Number,
      classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
      subject: String,
      room: String,
      lastModified: { type: Date, default: Date.now }
    }]
  },
  totalPeriodsPerWeek: { type: Number, default: 0 },
  version: { type: Number, default: 1 },
  lastSyncedAt: { type: Date, default: Date.now }
}, { timestamps: true });

teacherTimetableSchema.index({ teacherId: 1, academicYear: 1 }, { unique: true });

// Conflict Log Schema - for tracking scheduling conflicts
const conflictLogSchema = new mongoose.Schema({
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true },
  conflictType: { 
    type: String, 
    enum: ['double_booking', 'unqualified', 'invalid_assignment'], 
    required: true 
  },
  day: { type: String, required: true },
  periodIndex: { type: Number, required: true },
  classes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Class' }],
  subject: String,
  detectedAt: { type: Date, default: Date.now },
  resolvedAt: Date,
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  resolution: String,
  status: { 
    type: String, 
    enum: ['active', 'resolved', 'ignored'], 
    default: 'active' 
  }
}, { timestamps: true });

// Indexes for conflict log
conflictLogSchema.index({ teacherId: 1, status: 1 });
conflictLogSchema.index({ detectedAt: -1 });

// Counter Schema for auto-increment
const counterSchema = new mongoose.Schema({
  _id: String,
  seq: { type: Number, default: 0 }
});

// Admission Form Configuration Schema
const admissionFormConfigSchema = new mongoose.Schema({
  fieldName: { type: String, required: true },
  fieldType: { type: String, enum: ['student', 'staff'], default: 'student' },
  isVisible: { type: Boolean, default: true },
  isMandatory: { type: Boolean, default: false },
  autoGenerate: { type: Boolean, default: false },
  defaultValue: String,
  fieldOrder: { type: Number, default: 0 },
}, { timestamps: true });

// Admission ID Configuration Schema
const admissionIdConfigSchema = new mongoose.Schema({
  prefix: { type: String, default: 'ADM' },
  yearFormat: { type: String, enum: ['YYYY', 'YY', 'none'], default: 'YYYY' },
  separator: { type: String, enum: ['-', '/', '_', ''], default: '-' },
  numberPadding: { type: Number, default: 4 },
  startingNumber: { type: Number, default: 1 },
  currentNumber: { type: Number, default: 0 },
  resetFrequency: { type: String, enum: ['yearly', 'monthly', 'never'], default: 'yearly' },
  lastResetDate: Date,
}, { timestamps: true });

// Roll Number Configuration Schema
const rollNumberConfigSchema = new mongoose.Schema({
  format: { type: String, enum: ['sequential', 'class-based'], default: 'sequential' },
  startingNumber: { type: Number, default: 1 },
  resetPerClass: { type: Boolean, default: true },
}, { timestamps: true });

// Document Configuration Schema
const documentConfigSchema = new mongoose.Schema({
  documentName: { type: String, required: true },
  isRequired: { type: Boolean, default: false },
  uploadType: { type: String, enum: ['single', 'multiple', 'front-back'], default: 'single' },
  allowedFormats: [{ type: String }],
  maxFileSize: { type: Number, default: 5242880 }, // 5MB in bytes
  displayOrder: { type: Number, default: 0 },
  description: String,
}, { timestamps: true });

// Intake Form Schema
const intakeFormSchema = new mongoose.Schema({
  formName: { type: String, required: true },
  formType: { type: String, default: 'staff' }, // 'staff', 'student', 'parent'
  fields: { type: mongoose.Schema.Types.Mixed, default: [] }, // Store as flexible array of objects
  status: { type: String, default: 'active' }, // 'active', 'inactive', 'archived'
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
}, { timestamps: true, strict: false });

// Form Assignment Schema
const formAssignmentSchema = new mongoose.Schema({
  formId: { type: mongoose.Schema.Types.ObjectId, ref: 'IntakeForm', required: true },
  assignedToEmail: String,
  assignedToPhone: String,
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  status: { type: String, default: 'pending' }, // 'pending', 'in_progress', 'submitted', 'approved', 'rejected'
  accessToken: { type: String, unique: true, required: true },
  expiresAt: Date,
  assignedAt: { type: Date, default: Date.now },
}, { timestamps: true });

// Form Submission Schema
const formSubmissionSchema = new mongoose.Schema({
  assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'FormAssignment', required: true },
  formId: { type: mongoose.Schema.Types.ObjectId, ref: 'IntakeForm', required: true },
  submissionData: mongoose.Schema.Types.Mixed, // All form field responses
  submittedByEmail: String,
  submittedByPhone: String,
  submittedAt: { type: Date, default: Date.now },

  // Review workflow fields
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  reviewedAt: Date,
  reviewStatus: {
    type: String,
    default: 'pending',
    enum: ['pending', 'approved', 'rejected', 'needs_revision'] // Added 'needs_revision' for edit requests
  },
  reviewNotes: String,

  // Entity linking (populated after approval)
  staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' }, // For staff form submissions
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' }, // For student form submissions

  // Edit request workflow fields
  editRequestNotes: String, // Admin notes when requesting edits
  editRequestedAt: Date, // When edit was requested
  editRequestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' }, // Who requested the edit
  resubmissionCount: { type: Number, default: 0 }, // Track how many times re-submitted
}, { timestamps: true });

// Indexes for performance
formSubmissionSchema.index({ assignmentId: 1 });
formSubmissionSchema.index({ formId: 1 });
formSubmissionSchema.index({ submittedByEmail: 1 });
formSubmissionSchema.index({ reviewStatus: 1 });
formSubmissionSchema.index({ studentId: 1 });
formSubmissionSchema.index({ staffId: 1 });
formSubmissionSchema.index({ submittedAt: -1 }); // For sorting by submission date

// Visitor Schema - REMOVED: Now using enhanced model from ./models/Visitor.js
// The duplicate schema definition has been removed to avoid confusion
// Use: import Visitor from './models/Visitor.js';

// Admission Schema
const admissionSchema = new mongoose.Schema({
  studentName: { type: String, required: true },
  dateOfBirth: String,
  parentName: String,
  phoneNumber: String,
  email: String,
  classApplyingFor: String,
  assessmentRequired: { type: Boolean, default: false },
  assignedTeacher: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  testDate: String,
  testTime: String,
  testResult: String, // 'cleared', 'failed', 'pending'
  dateOfInquiry: { type: String, default: () => new Date().toISOString().split('T')[0] },
  source: String, // 'walk-in', 'call', 'website', 'reference'
  status: { type: String, default: 'inquiry-logged' }, // inquiry-logged, form-sent, form-submitted, documents-verified, test-scheduled, test-cleared/failed/no-show, admission-approved/rejected, fee-paid, student-admitted
  admissionDecision: String, // 'approved', 'rejected', 'pending'
  decisionRemarks: String,
  decisionBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
}, { timestamps: true });

// Gate Pass Schema - REMOVED: Now using enhanced model from ./models/GatePass.js
// The duplicate schema definition has been removed to avoid confusion
// Use: import GatePass from './models/GatePass.js';

// Appointment Schema
const appointmentSchema = new mongoose.Schema({
  visitorName: { type: String, required: true },
  phoneNumber: String,
  purpose: String,
  // FIX: Change from String to Date type for proper datetime handling
  fromDateTime: { type: Date, required: true },
  toDateTime: { type: Date, required: true },
  meetingWith: String,
  notes: String,
  status: { type: String, default: 'scheduled' }, // 'scheduled', 'completed', 'cancelled'
}, { timestamps: true });

// Feedback Schema
const feedbackSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phoneNumber: String,
  date: { type: String, default: () => new Date().toISOString().split('T')[0] },
  // FIX: Add enum validation for category field
  category: {
    type: String,
    enum: ['STAFF', 'FACILITIES', 'MANAGEMENT', 'ACADEMIC', 'ADMINISTRATIVE', 'FACILITY', 'SUGGESTION', 'COMPLAINT', 'OTHER'],
    required: true
  },
  assignedStaff: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  notifyStaff: { type: Boolean, default: false },
  status: { type: String, default: 'open', enum: ['open', 'in_progress', 'resolved', 'closed'] }, // 'open', 'resolved'
  notes: String,
}, { timestamps: true });

// Call Log Schema
const callLogSchema = new mongoose.Schema({
  callerName: String,
  phoneNumber: String,
  dateTime: { type: String, required: true },
  purpose: String,
  intent: String,
  keyNotes: String,
  summary: String,
  title: String,
  transcription: String,
  recordingUrl: String,
  loggedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
}, { timestamps: true });

// School Settings Schema - school-wide configuration
const schoolSettingsSchema = new mongoose.Schema({
  academicYear: { type: String, default: CURRENT_ACADEMIC_YEAR },
  currentSession: { type: String, default: '2024-25' },

  // Fee Collection Configuration
  feeCollection: {
    collectionMode: { type: String, enum: ['term', 'monthly', 'quarterly', 'yearly', 'custom'], default: 'term' },
    numberOfTerms: { type: Number, default: 2 },
    terms: [{
      name: String,
      startDate: String,
      endDate: String,
      dueDate: String
    }],
    customDurations: [{
      name: String,
      months: [Number]
    }]
  },

  lateFee: {
    enabled: { type: Boolean, default: false },
    amount: { type: Number, default: 0 },
    gracePeriodDays: { type: Number, default: 7 },
    maxLateFee: { type: Number, default: 1000 }
  },

  discount: {
    enabled: { type: Boolean, default: true },
    requireApproval: { type: Boolean, default: true },
    maxDiscountPercentage: { type: Number, default: 10 },
    allowedDiscounts: [{
      name: String,
      percentage: Number,
      requiresApproval: Boolean
    }]
  },

  receipt: {
    prefix: { type: String, default: 'RCP' },
    startingNumber: { type: Number, default: 1001 },
    currentNumber: { type: Number, default: 1001 }
  },

  paymentModes: [{
    name: String,
    enabled: Boolean
  }],

  // Payroll Configuration
  payroll: {
    disburseDate: { type: Number, default: 1, min: 1, max: 31 }
  },

  // Subjects Configuration
  subjects: [{
    name: { type: String, required: true },
    code: { type: String },
    description: { type: String }
  }]
}, { timestamps: true });

// Fee Template Schema - reusable fee structures
const feeTemplateSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  section: { type: String, required: true },
  applicableFor: [{
    classGrade: String,
    applicable: Boolean
  }],
  
  feeHeads: [{
    name: { type: String, required: true },
    category: { type: String, enum: ['Academic', 'Transport', 'Extra-curricular', 'Hostel', 'Other'], default: 'Academic' },
    amount: { type: Number, required: true },
    frequency: { type: String, enum: ['monthly', 'quarterly', 'term', 'yearly', 'one-time'], default: 'yearly' },
    mandatory: { type: Boolean, default: true },
    applicableTerms: [Number],
    dueDay: { type: Number, default: 10 },
    refundable: { type: Boolean, default: false }
  }],
  
  totalAnnualFee: { type: Number, required: true },
  discounts: [{
    name: String,
    percentage: Number,
    conditions: String
  }],
  isActive: { type: Boolean, default: true },
  academicYear: { type: String, default: '2024-25' }
}, { timestamps: true });

// Fee Structure Schema - defines fee amounts for classes
const feeStructureSchema = new mongoose.Schema({
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  academicYear: { type: String, default: CURRENT_ACADEMIC_YEAR },
  templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'FeeTemplate' },
  
  feeHeads: [{
    name: String,
    category: String,
    amount: Number,
    frequency: String,
    mandatory: { type: Boolean, default: true },
    applicableTerms: [Number],
    dueDay: Number,
    refundable: Boolean
  }],
  
  collectionSchedule: {
    mode: { type: String, enum: ['term', 'monthly', 'quarterly', 'yearly', 'custom'], default: 'term' },
    installments: [{
      name: String,
      dueDate: String,
      amount: Number,
      status: { type: String, enum: ['pending', 'partial', 'paid', 'overdue'], default: 'pending' }
    }]
  },
  
  totalAnnualFee: Number,
  isCustomized: { type: Boolean, default: false },
  appliedDate: Date,
  appliedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student' }]
}, { timestamps: true });

feeStructureSchema.index({ classId: 1, academicYear: 1 }, { unique: true });

// Fee Payment Schema - records individual payments
const feePaymentSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  academicYear: { type: String, default: CURRENT_ACADEMIC_YEAR },
  receiptNumber: { type: String, unique: true, required: true },

  // Payment Details
  paymentDate: { type: String, required: true },
  amount: { type: Number, required: true },
  paymentMode: { type: String, required: true }, // 'cash', 'cheque', 'online', 'card'

  // Fee Heads Breakdown
  feeHeads: [{
    name: String,
    amount: Number,
    month: String, // For monthly fees
    period: String, // For quarterly/annual fees
  }],

  // Transaction Details
  transactionId: String, // For online/card payments
  chequeNumber: String, // For cheque payments
  bankName: String,

  // Late Fee
  lateFee: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },

  // Status
  status: { type: String, default: 'completed' }, // 'completed', 'pending', 'failed'

  // Collected By
  collectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },

  // Notes
  remarks: String,
}, { timestamps: true });

feePaymentSchema.index({ studentId: 1, paymentDate: 1 });

// Fee Refund Schema
const feeRefundSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  academicYear: { type: String, default: CURRENT_ACADEMIC_YEAR },
  refundNumber: { type: String, unique: true, required: true },

  // Refund Details
  refundDate: { type: String, required: true },
  amount: { type: Number, required: true },
  reason: { type: String, required: true },

  // Original Payment Reference
  originalPaymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'FeePayment' },

  // Refund Method
  refundMode: { type: String, required: true }, // 'cash', 'cheque', 'bank_transfer'
  transactionId: String,
  chequeNumber: String,
  bankName: String,
  accountNumber: String,

  // Approval Workflow
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  requestedAt: { type: Date, default: Date.now },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  approvedAt: Date,
  processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  processedAt: Date,

  // Status
  status: { type: String, default: 'pending' }, // 'pending', 'approved', 'processed', 'rejected'

  // Notes
  remarks: String,
  rejectionReason: String,
}, { timestamps: true });

feeRefundSchema.index({ studentId: 1, refundDate: 1 });

// Substitution Schema - for teacher substitutions
const substitutionSchema = new mongoose.Schema({
  date: { type: String, required: true }, // YYYY-MM-DD format
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  period: { type: String, required: true }, // Period number (1-8)
  absentTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' }, // Teacher who is absent
  substituteTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true }, // Substitute teacher
  reason: String, // Reason for substitution (leave, sick, etc.)
  type: { type: String, enum: ['auto', 'manual'], default: 'manual' }, // Auto-assigned or manual
  status: { type: String, enum: ['pending', 'confirmed', 'completed'], default: 'confirmed' },
  notes: String,
}, { timestamps: true });

substitutionSchema.index({ date: 1, classId: 1, period: 1 });

// Chat Models - Import from separate files
import Message from './models/Message.js';
import Conversation from './models/Conversation.js';
import UserPresence from './models/UserPresence.js';
import Notification from './models/Notification.js';

// Fee Management Models - Import from separate files
import FeeHead from './models/FeeHead.js';
import StudentFeeStructure from './models/StudentFeeStructure.js';
import FeeConsession from './models/FeeConsession.js';
import LateFeeRule from './models/LateFeeRule.js';

// Class Module Models - Import from separate files
import ActivityLog from './models/ActivityLog.js';
import ClassRating from './models/ClassRating.js';
import ChapterProgress from './models/ChapterProgress.js';
import ClassAnnouncement from './models/ClassAnnouncement.js';

// Student Remarks Model
import Remark from './models/Remark.js';
import FeeRule from './models/FeeRule.js';
import PaymentMethodConfig from './models/PaymentMethodConfig.js';
import FeeCollectionPeriod from './models/FeeCollectionPeriod.js';

// Staff ID Configuration Model
import StaffIdConfig from './models/StaffIdConfig.js';

// Staff Attendance Model
import StaffAttendance from './models/StaffAttendance.js';
import UserPermission from './models/UserPermission.js';
import PermissionRequest from './models/PermissionRequest.js';

// Front Office Models (Enhanced)
import Visitor from './models/Visitor.js';
import GatePass from './models/GatePass.js';

// Import announcements and reminders models
import Announcement from './models/Announcement.js';
import AnnouncementRecipient from './models/AnnouncementRecipient.js';
import Reminder from './models/Reminder.js';

// Import Parent model
import Parent from './models/Parent.js';

export const Staff = mongoose.model('Staff', staffSchema);
export const Class = mongoose.model('Class', classSchema);
export const Student = mongoose.model('Student', studentSchema);
export const Attendance = mongoose.model('Attendance', attendanceSchema);
export const Exam = mongoose.model('Exam', examSchema);
export const Result = mongoose.model('Result', resultSchema);
export const Timetable = mongoose.model('Timetable', timetableSchema);
export const TeacherTimetable = mongoose.model('TeacherTimetable', teacherTimetableSchema);
export const ConflictLog = mongoose.model('ConflictLog', conflictLogSchema);
export const Counter = mongoose.model('Counter', counterSchema);
export const IntakeForm = mongoose.model('IntakeForm', intakeFormSchema);
export const FormAssignment = mongoose.model('FormAssignment', formAssignmentSchema);
export const FormSubmission = mongoose.model('FormSubmission', formSubmissionSchema);
// Visitor and GatePass are imported from enhanced models
export const Admission = mongoose.model('Admission', admissionSchema);
export const Appointment = mongoose.model('Appointment', appointmentSchema);
export const Feedback = mongoose.model('Feedback', feedbackSchema);
export const CallLog = mongoose.model('CallLog', callLogSchema);
export const SchoolSettings = mongoose.model('SchoolSettings', schoolSettingsSchema);
export const FeeTemplate = mongoose.model('FeeTemplate', feeTemplateSchema);
export const FeeStructure = mongoose.model('FeeStructure', feeStructureSchema);
export const FeePayment = mongoose.model('FeePayment', feePaymentSchema);
export const FeeRefund = mongoose.model('FeeRefund', feeRefundSchema);
export const Substitution = mongoose.model('Substitution', substitutionSchema);
export const AdmissionFormConfig = mongoose.model('AdmissionFormConfig', admissionFormConfigSchema);
export const AdmissionIdConfig = mongoose.model('AdmissionIdConfig', admissionIdConfigSchema);
export const RollNumberConfig = mongoose.model('RollNumberConfig', rollNumberConfigSchema);
export const DocumentConfig = mongoose.model('DocumentConfig', documentConfigSchema);

// Export Parent model
export { Parent };

// Export chat models
export { Message, Conversation, UserPresence, Notification };

// Export front office models (Enhanced)
export { Visitor, GatePass };

// Export fee management models
export { FeeHead, StudentFeeStructure, FeeConsession, LateFeeRule, FeeRule, PaymentMethodConfig, FeeCollectionPeriod };

// Export remarks model
export { Remark };

// Export staff ID config model
export { StaffIdConfig };

// Export staff attendance model
export { StaffAttendance };

// Export permission models
export { UserPermission, PermissionRequest };

// Export announcements and reminders models
export { Announcement, AnnouncementRecipient, Reminder };

// Export class module models
export { ActivityLog, ClassRating, ChapterProgress, ClassAnnouncement };

// Helper to get next staff code
export async function getNextStaffCode() {
  console.log('📋 Fetching staff ID config from database...');
  let config = await StaffIdConfig.findOne();

  // Create default config if doesn't exist
  if (!config) {
    console.log('⚠️ No staff ID config found, creating default...');
    config = new StaffIdConfig({
      prefix: 'EMP',
      separator: '',
      includeYear: false,
      startingNumber: 1,
      digits: 3,
      currentNumber: 0
    });
    await config.save();
    console.log('✅ Default staff ID config created:', config.toObject());
  } else {
    console.log('✅ Staff ID config found:', config.toObject());
  }

  // Increment current number
  config.currentNumber += 1;
  await config.save();
  console.log('💾 Config saved with currentNumber:', config.currentNumber);

  // Build staff ID
  const { prefix, separator, includeYear, digits, currentNumber } = config;
  const paddedNumber = String(currentNumber).padStart(digits, '0');
  const year = new Date().getFullYear();
  
  let staffId = prefix;
  if (separator) staffId += separator;
  if (includeYear) staffId += year + (separator || '');
  staffId += paddedNumber;

  console.log('🎯 Final staff ID:', staffId);
  return staffId;
}

// Helper to get next receipt number
export async function getNextReceiptNumber() {
  const counter = await Counter.findByIdAndUpdate(
    'receiptNumber',
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  const year = new Date().getFullYear();
  return `RCP-${year}-${String(counter.seq).padStart(6, '0')}`;
}

// Helper to get next refund number
export async function getNextRefundNumber() {
  const counter = await Counter.findByIdAndUpdate(
    'refundNumber',
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  const year = new Date().getFullYear();
  return `RFD-${year}-${String(counter.seq).padStart(6, '0')}`;
}

// Helper to get next admission ID based on configuration
export async function getNextAdmissionId() {
  console.log('📋 Fetching admission ID config from database...');
  let config = await AdmissionIdConfig.findOne();

  // Create default config if doesn't exist
  if (!config) {
    console.log('⚠️ No config found, creating default...');
    config = new AdmissionIdConfig({
      prefix: 'ADM',
      yearFormat: 'YYYY',
      separator: '-',
      numberPadding: 4,
      startingNumber: 1,
      currentNumber: 0,
      resetFrequency: 'yearly'
    });
    await config.save();
    console.log('✅ Default config created:', config.toObject());
  } else {
    console.log('✅ Config found:', config.toObject());
  }

  // Check if reset is needed
  const now = new Date();
  const shouldReset = config.resetFrequency !== 'never' && (
    !config.lastResetDate ||
    (config.resetFrequency === 'yearly' && now.getFullYear() > new Date(config.lastResetDate).getFullYear()) ||
    (config.resetFrequency === 'monthly' && (now.getFullYear() > new Date(config.lastResetDate).getFullYear() || now.getMonth() > new Date(config.lastResetDate).getMonth()))
  );

  if (shouldReset) {
    console.log('🔄 Resetting counter...');
    config.currentNumber = config.startingNumber;
    config.lastResetDate = now;
  } else {
    config.currentNumber += 1;
  }

  await config.save();
  console.log('💾 Config saved with currentNumber:', config.currentNumber);

  // Build admission ID
  let admissionId = config.prefix;

  if (config.yearFormat !== 'none') {
    if (config.separator) admissionId += config.separator;
    admissionId += config.yearFormat === 'YYYY' ? now.getFullYear() : String(now.getFullYear()).slice(-2);
  }

  if (config.separator) admissionId += config.separator;
  admissionId += String(config.currentNumber).padStart(config.numberPadding, '0');

  console.log('🎯 Final admission ID:', admissionId);
  return admissionId;
}

// Helper to get next roll number for a class
export async function getNextRollNumber(classId) {
  console.log('📋 Fetching roll number config and class students...');
  let config = await RollNumberConfig.findOne();

  // Create default config if doesn't exist
  if (!config) {
    console.log('⚠️ No roll number config found, creating default...');
    config = new RollNumberConfig({
      format: 'sequential',
      startingNumber: 1,
      resetPerClass: true
    });
    await config.save();
    console.log('✅ Default roll number config created');
  }

  // Get count of students in the class
  const studentCount = await Student.countDocuments({ classId });
  const nextRollNo = config.startingNumber + studentCount;

  console.log('🎯 Next roll number:', nextRollNo);
  return nextRollNo;
}

export default mongoose;
