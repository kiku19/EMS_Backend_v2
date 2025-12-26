import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/school_db';

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

// Helper to get next staff code
export async function getNextStaffCode() {
  const counter = await Counter.findByIdAndUpdate(
    'staffCode',
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `EMP${String(counter.seq).padStart(3, '0')}`;
}

export default mongoose;
