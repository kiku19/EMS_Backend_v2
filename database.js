import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/school_db';

export async function connectDB() {
  try {
    mongoose.set('strictQuery', false);
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    process.exit(1);
  }
}

// Staff Schema - with login credentials
const staffSchema = new mongoose.Schema({
  code: { type: String, unique: true, required: true },
  name: { type: String, required: true },
  role: { type: String, required: true }, // Teacher, Admin, etc.
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
  whatsappNumber: String,
  
  // Documents
  picture: String, // URL to profile picture
  idDocuments: [String], // URLs to ID documents
  
  // Qualifications
  professionalQualifications: [{
    name: String,
    year: String,
    documents: [String] // URLs to certificates
  }],
  totalExperience: String,
  previousOrganization: String,
  qualificationDocs: [String], // URLs to qualification documents
  
  // Staff Info
  staffNumber: String,
  staffType: String,
  expertise: String,
  assignedClasses: [String],
  isClassTeacher: Boolean,
  classTeacherOf: String,
  
  // Bank & Salary
  accountNumber: String,
  ifscCode: String,
  bankName: String,
  branchName: String,
  salaryTemplate: String,
  salaryBreakdown: [{
    component: String,
    amount: Number
  }],
  
  // Login credentials
  username: { type: String, unique: true, sparse: true },
  password: { type: String }, // In production, hash this!
  
  // Hierarchy
  reporterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
}, { timestamps: true });

// Class Schema - with class teacher reference
const classSchema = new mongoose.Schema({
  name: { type: String, required: true }, // e.g., "Class 10"
  section: { type: String, required: true }, // e.g., "A"
  classTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  subjects: [String],
  academicYear: { type: String, default: '2024-25' },
}, { timestamps: true });

// Student Schema - linked to class with comprehensive fields
const studentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  admissionId: { type: String, unique: true },
  academicYear: { type: String, default: '2024-25' },
  rollNo: Number,
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },

  // Personal Information
  gender: String,
  dateOfBirth: String,
  bloodGroup: String,
  nationality: String,
  religion: String,
  category: String,
  motherTongue: String,

  // Contact Information
  phone: String,
  email: String,
  address: String,

  // Parent/Guardian Information
  parentName: String,
  parentPhone: String,
  parentEmail: String,
  parentRelationship: String,
  parentOccupation: String,
  alternatePhone: String,

  // Additional Parents (stored as array)
  parents: [{
    name: String,
    relationship: String,
    phone: String,
    email: String,
    occupation: String
  }],

  // Academic Information
  previousSchool: String,
  tcNumber: String,
  mediumOfInstruction: String,
  house: String,

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
    name: String,
    type: String,
    url: String,
    uploadDate: Date
  }],

  photo: String,
}, { timestamps: true });

// Attendance Schema
const attendanceSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  date: { type: String, required: true },
  status: { type: String, required: true }, // present, absent, late
  markedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
}, { timestamps: true });

attendanceSchema.index({ studentId: 1, date: 1 }, { unique: true });

// Timetable Schema
const timetableSchema = new mongoose.Schema({
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  academicYear: { type: String, default: '2024-25' },
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
      room: String
    }],
    Tuesday: [{
      subject: String,
      teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
      room: String
    }],
    Wednesday: [{
      subject: String,
      teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
      room: String
    }],
    Thursday: [{
      subject: String,
      teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
      room: String
    }],
    Friday: [{
      subject: String,
      teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
      room: String
    }],
    Saturday: [{
      subject: String,
      teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
      room: String
    }]
  }
}, { timestamps: true });

timetableSchema.index({ classId: 1, academicYear: 1 }, { unique: true });

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
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  reviewedAt: Date,
  reviewStatus: { type: String, default: 'pending' }, // 'pending', 'approved', 'rejected'
  reviewNotes: String,
  staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' }, // Populated after approval
}, { timestamps: true });

// Notification Schema
const notificationSchema = new mongoose.Schema({
  userEmail: String,
  userPhone: String,
  notificationType: String, // 'form_assignment', 'form_reminder', 'form_approved', 'form_rejected'
  title: { type: String, required: true },
  message: { type: String, required: true },
  data: mongoose.Schema.Types.Mixed, // Additional data (form_id, assignment_id, etc.)
  isRead: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
}, { timestamps: true });

// Visitor Schema
const visitorSchema = new mongoose.Schema({
  visitorName: { type: String, required: true },
  phoneNumber: String,
  date: { type: String, required: true },
  checkInTime: { type: String, required: true },
  checkOutTime: String,
  reasonForVisit: String,
  concernedPerson: String,
  status: { type: String, default: 'checked-in' }, // 'checked-in', 'checked-out'
}, { timestamps: true });

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

// Gate Pass Schema
const gatePassSchema = new mongoose.Schema({
  personType: { type: String, required: true }, // 'staff', 'student'
  personId: { type: mongoose.Schema.Types.ObjectId, refPath: 'personType' },
  personName: { type: String, required: true },
  leavingWith: String,
  permittedBy: String,
  outTime: { type: String, required: true },
  date: { type: String, required: true },
  notifyParent: { type: Boolean, default: false },
  status: { type: String, default: 'active' },
}, { timestamps: true });

// Appointment Schema
const appointmentSchema = new mongoose.Schema({
  visitorName: { type: String, required: true },
  phoneNumber: String,
  purpose: String,
  fromDateTime: { type: String, required: true },
  toDateTime: { type: String, required: true },
  meetingWith: String,
  notes: String,
  status: { type: String, default: 'scheduled' }, // 'scheduled', 'completed', 'cancelled'
}, { timestamps: true });

// Feedback Schema
const feedbackSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phoneNumber: String,
  date: { type: String, default: () => new Date().toISOString().split('T')[0] },
  category: String,
  assignedStaff: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  notifyStaff: { type: Boolean, default: false },
  status: { type: String, default: 'open' }, // 'open', 'resolved'
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
  academicYear: { type: String, default: '2024-25' },
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
  academicYear: { type: String, default: '2024-25' },
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
  academicYear: { type: String, default: '2024-25' },
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
  academicYear: { type: String, default: '2024-25' },
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

// Fee Management Models - Import from separate files
import FeeHead from './models/FeeHead.js';
import StudentFeeStructure from './models/StudentFeeStructure.js';
import FeeConsession from './models/FeeConsession.js';
import LateFeeRule from './models/LateFeeRule.js';
import FeeRule from './models/FeeRule.js';
import PaymentMethodConfig from './models/PaymentMethodConfig.js';
import FeeCollectionPeriod from './models/FeeCollectionPeriod.js';

// Staff ID Configuration Model
import StaffIdConfig from './models/StaffIdConfig.js';

// Staff Attendance Model
import StaffAttendance from './models/StaffAttendance.js';

export const Staff = mongoose.model('Staff', staffSchema);
export const Class = mongoose.model('Class', classSchema);
export const Student = mongoose.model('Student', studentSchema);
export const Attendance = mongoose.model('Attendance', attendanceSchema);
export const Timetable = mongoose.model('Timetable', timetableSchema);
export const Counter = mongoose.model('Counter', counterSchema);
export const IntakeForm = mongoose.model('IntakeForm', intakeFormSchema);
export const FormAssignment = mongoose.model('FormAssignment', formAssignmentSchema);
export const FormSubmission = mongoose.model('FormSubmission', formSubmissionSchema);
export const Notification = mongoose.model('Notification', notificationSchema);
export const Visitor = mongoose.model('Visitor', visitorSchema);
export const Admission = mongoose.model('Admission', admissionSchema);
export const GatePass = mongoose.model('GatePass', gatePassSchema);
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

// Export chat models
export { Message, Conversation, UserPresence };

// Export fee management models
export { FeeHead, StudentFeeStructure, FeeConsession, LateFeeRule, FeeRule, PaymentMethodConfig, FeeCollectionPeriod };

// Export staff ID config model
export { StaffIdConfig };

// Export staff attendance model
export { StaffAttendance };

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
