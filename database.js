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

export const Staff = mongoose.model('Staff', staffSchema);
export const Class = mongoose.model('Class', classSchema);
export const Student = mongoose.model('Student', studentSchema);
export const Attendance = mongoose.model('Attendance', attendanceSchema);
export const Timetable = mongoose.model('Timetable', timetableSchema);
export const Counter = mongoose.model('Counter', counterSchema);

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
