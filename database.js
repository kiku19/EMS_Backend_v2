import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { createLogger } from './utils/logger.js';

dotenv.config();

const MONGODB_URI =
  process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/school_db';
const logger = createLogger('Database');

// DR-02: Replica set failover connection options.
// These settings ensure MongoDB Atlas (or self-hosted RS) failover is handled
// automatically. In Atlas the typical election completes in 10-30 s, giving:
//   RTO ≤ 30 s  (automatic — driver retries after primary re-election)
//   RPO  = 0    (w:"majority" + j:true means committed writes survive failover)
const FAILOVER_CONNECTION_OPTIONS = {
  // Replica set resilience
  retryWrites: true, // Automatically retry writes on transient network errors
  retryReads: true, // Automatically retry reads on transient network errors
  w: 'majority', // Wait for majority of RS members to acknowledge write (RPO = 0)
  j: true, // Journal writes before acknowledging (survive crashes)
  readPreference: 'primaryPreferred', // Fall back to secondary reads if primary unreachable

  // Failure detection — detect primary outage within ~10 s
  heartbeatFrequencyMS: 10000, // Check RS member health every 10 s
  serverSelectionTimeoutMS: 30000, // Wait up to 30 s for a primary to be elected
  connectTimeoutMS: 10000, // Hard connection timeout per socket

  // Connection pool
  maxPoolSize: 10,
  minPoolSize: 2,
  socketTimeoutMS: 45000,

  // OBS-05: Enable MongoDB APM command events for slow query monitoring
  monitorCommands: true,
};

export async function connectDB() {
  try {
    mongoose.set('strictQuery', false);

    mongoose.connection.on('connected', () => {
      logger.info('MongoDB connected successfully');
    });

    mongoose.connection.on('error', (err) => {
      logger.error({ err }, 'MongoDB connection error');
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected — driver will retry automatically');
    });

    // DR-02: Log replica set topology changes so failovers are visible in logs
    mongoose.connection.on('fullsetup', () => {
      logger.info('MongoDB replica set: primary + all secondaries connected');
    });

    mongoose.connection.on('all', () => {
      logger.info('MongoDB replica set: all members connected');
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      logger.info('MongoDB connection closed through app termination');
      process.exit(0);
    });

    await mongoose.connect(MONGODB_URI, FAILOVER_CONNECTION_OPTIONS);

    logger.info({ mongoUri: MONGODB_URI.replace(/\/\/.*@/, '//***@') }, 'Connected to MongoDB');
  } catch (error) {
    logger.error(
      {
        err: error,
        mongoUri: MONGODB_URI.replace(/\/\/.*@/, '//***@'),
      },
      'MongoDB connection failed'
    );

    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    } else {
      logger.warn('Running in development mode without database connection');
    }
  }
}

// DR-02: Returns replica set member status for health/ops endpoints.
// Returns null when connected to a standalone (non-RS) MongoDB instance.
export async function getReplicaSetStatus() {
  if (mongoose.connection.readyState !== 1) {
    return null;
  }

  try {
    const result = await mongoose.connection.db.admin().command({ replSetGetStatus: 1 });
    const members = (result.members || []).map((m) => ({
      name: m.name,
      state: m.stateStr, // PRIMARY, SECONDARY, ARBITER, etc.
      health: m.health === 1 ? 'healthy' : 'unhealthy',
      uptime: m.uptime,
      lagSeconds: m.optimeDate
        ? Math.round((Date.now() - new Date(m.optimeDate).getTime()) / 1000)
        : null,
    }));

    return {
      setName: result.set,
      myState: result.myState,
      members,
      primary: members.find((m) => m.state === 'PRIMARY')?.name ?? null,
      secondaryCount: members.filter((m) => m.state === 'SECONDARY').length,
    };
  } catch (err) {
    // Not a replica set (standalone) or insufficient permissions — not an error
    if (
      err.codeName === 'NotYetInitialized' ||
      err.message?.includes('not running with --replSet')
    ) {
      return { setName: null, standalone: true };
    }
    logger.warn({ err }, 'Could not fetch replica set status');
    return null;
  }
}

// ─── Domain Models ───────────────────────────────────────────────────────────
// Each schema lives in its own file under models/. Imported and re-exported
// here so all existing imports from './database.js' keep working unchanged.

import StaffModel from './models/Staff.js';
import ClassModel from './models/Class.js';
import StudentModel from './models/Student.js';
import AttendanceModel from './models/Attendance.js';
import ExamScheduleModel from './models/ExamSchedule.js';
import ExamModel from './models/Exam.js';
import ResultModel from './models/Result.js';
import TimetableModel from './models/Timetable.js';
import TeacherTimetableModel from './models/TeacherTimetable.js';
import ConflictLogModel from './models/ConflictLog.js';
import CounterModel from './models/Counter.js';
import AdmissionFormConfigModel from './models/AdmissionFormConfig.js';
import AdmissionIdConfigModel from './models/AdmissionIdConfig.js';
import RollNumberConfigModel from './models/RollNumberConfig.js';
import DocumentConfigModel from './models/DocumentConfig.js';
import IntakeFormModel from './models/IntakeForm.js';
import FormAssignmentModel from './models/FormAssignment.js';
import FormSubmissionModel from './models/FormSubmission.js';
import AdmissionModel from './models/Admission.js';
import AppointmentModel from './models/Appointment.js';
import FeedbackModel from './models/Feedback.js';
import CallLogModel from './models/CallLog.js';
import SchoolSettingsModel from './models/SchoolSettings.js';
import FeeTemplateModel from './models/FeeTemplate.js';
import FeeStructureModel from './models/FeeStructure.js';
import FeePaymentModel from './models/FeePayment.js';
import FeeRefundModel from './models/FeeRefund.js';
import SubstitutionModel from './models/Substitution.js';

// Chat / messaging models
import Message from './models/Message.js';
import Conversation from './models/Conversation.js';
import UserPresence from './models/UserPresence.js';
import Notification from './models/Notification.js';

// Fee management models
import FeeHead from './models/FeeHead.js';
import StudentFeeStructure from './models/StudentFeeStructure.js';
import FeeConsession from './models/FeeConsession.js';
import LateFeeRule from './models/LateFeeRule.js';
import FeeRule from './models/FeeRule.js';
import PaymentMethodConfig from './models/PaymentMethodConfig.js';
import FeeCollectionPeriod from './models/FeeCollectionPeriod.js';

// Class module models
import ActivityLog from './models/ActivityLog.js';
import ClassRating from './models/ClassRating.js';
import ChapterProgress from './models/ChapterProgress.js';
import ClassAnnouncement from './models/ClassAnnouncement.js';

// Other models
import Remark from './models/Remark.js';
import StaffIdConfig from './models/StaffIdConfig.js';
import StaffAttendance from './models/StaffAttendance.js';
import UserPermission from './models/UserPermission.js';
import PermissionRequest from './models/PermissionRequest.js';
import Visitor from './models/Visitor.js';
import GatePass from './models/GatePass.js';
import AssetModel from './models/Asset.js';
import VendorModel from './models/Vendor.js';
import MaintenanceLogModel from './models/MaintenanceLog.js';
import ProcurementRequestModel from './models/ProcurementRequest.js';
import Announcement from './models/Announcement.js';
import AnnouncementRecipient from './models/AnnouncementRecipient.js';
import Reminder from './models/Reminder.js';
import Parent from './models/Parent.js';
import School from './models/School.js';
import SchoolSubscription from './models/SchoolSubscription.js';
import SchoolInvoice from './models/SchoolInvoice.js';
import UserDayActivity from './models/UserDayActivity.js';
import SchoolMetricSnapshot from './models/SchoolMetricSnapshot.js';

// Transport models
import VehicleModel from './models/Vehicle.js';
import TransportRouteModel from './models/TransportRoute.js';

// ─── Named exports (preserve backward compatibility) ────────────────────────
export const Staff = StaffModel;
export const Class = ClassModel;
export const Student = StudentModel;
export const Attendance = AttendanceModel;
export const ExamSchedule = ExamScheduleModel;
export const Exam = ExamModel;
export const Result = ResultModel;
export const Timetable = TimetableModel;
export const TeacherTimetable = TeacherTimetableModel;
export const ConflictLog = ConflictLogModel;
export const Counter = CounterModel;
export const AdmissionFormConfig = AdmissionFormConfigModel;
export const AdmissionIdConfig = AdmissionIdConfigModel;
export const RollNumberConfig = RollNumberConfigModel;
export const DocumentConfig = DocumentConfigModel;
export const IntakeForm = IntakeFormModel;
export const FormAssignment = FormAssignmentModel;
export const FormSubmission = FormSubmissionModel;
export const Admission = AdmissionModel;
export const Appointment = AppointmentModel;
export const Feedback = FeedbackModel;
export const CallLog = CallLogModel;
export const SchoolSettings = SchoolSettingsModel;
export const FeeTemplate = FeeTemplateModel;
export const FeeStructure = FeeStructureModel;
export const FeePayment = FeePaymentModel;
export const FeeRefund = FeeRefundModel;
export const Substitution = SubstitutionModel;
export const Vehicle = VehicleModel;
export const TransportRoute = TransportRouteModel;

export {
  Parent,
  School,
  SchoolSubscription,
  SchoolInvoice,
  UserDayActivity,
  SchoolMetricSnapshot,
  Message,
  Conversation,
  UserPresence,
  Notification,
  Visitor,
  GatePass,
  FeeHead,
  StudentFeeStructure,
  FeeConsession,
  LateFeeRule,
  FeeRule,
  PaymentMethodConfig,
  FeeCollectionPeriod,
  Remark,
  StaffIdConfig,
  StaffAttendance,
  UserPermission,
  PermissionRequest,
  Announcement,
  AnnouncementRecipient,
  Reminder,
  ActivityLog,
  ClassRating,
  ChapterProgress,
  ClassAnnouncement,
};

export const Asset = AssetModel;
export const Vendor = VendorModel;
export const MaintenanceLog = MaintenanceLogModel;
export const ProcurementRequest = ProcurementRequestModel;

// ─── Helper functions ────────────────────────────────────────────────────────

export async function getNextStaffCode(schoolId) {
  if (!schoolId) {
    throw new Error('schoolId is required to generate staff code');
  }

  const config = await StaffIdConfig.findOneAndUpdate(
    { schoolId },
    {
      $inc: { currentNumber: 1 },
      $setOnInsert: {
        schoolId,
        prefix: 'EMP',
        separator: '',
        includeYear: false,
        startingNumber: 1,
        digits: 3,
      },
    },
    { new: true, upsert: true }
  );

  const { prefix, separator, includeYear, digits, currentNumber } = config;
  const paddedNumber = String(currentNumber).padStart(digits, '0');
  const year = new Date().getFullYear();

  let staffId = prefix;
  if (separator) staffId += separator;
  if (includeYear) staffId += year + (separator || '');
  staffId += paddedNumber;

  return staffId;
}

export async function getNextRollNumber(classId, schoolId) {
  const query = {
    classId,
    isDeleted: { $ne: true },
    rollNo: { $exists: true, $ne: null },
  };
  if (schoolId) {
    query.schoolId = schoolId;
  }
  const lastStudent = await StudentModel.findOne(query)
    .sort({ rollNo: -1 })
    .select('rollNo')
    .lean();
  return (lastStudent?.rollNo || 0) + 1;
}

export async function getNextReceiptNumber(schoolId) {
  if (!schoolId) {
    throw new Error('schoolId is required to generate receipt number');
  }
  const counter = await CounterModel.findByIdAndUpdate(
    `receiptNumber_${schoolId}`,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  const year = new Date().getFullYear();
  return `RCP-${year}-${String(counter.seq).padStart(6, '0')}`;
}

export async function getNextRefundNumber(schoolId) {
  if (!schoolId) {
    throw new Error('schoolId is required to generate refund number');
  }
  const counter = await CounterModel.findByIdAndUpdate(
    `refundNumber_${schoolId}`,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  const year = new Date().getFullYear();
  return `RFD-${year}-${String(counter.seq).padStart(6, '0')}`;
}

export async function getNextAdmissionId(schoolId) {
  if (!schoolId) {
    throw new Error('schoolId is required to generate admission ID');
  }

  const now = new Date();

  await AdmissionIdConfigModel.updateOne(
    { schoolId },
    {
      $setOnInsert: {
        schoolId,
        prefix: 'ADM',
        yearFormat: 'YYYY',
        separator: '-',
        numberPadding: 4,
        startingNumber: 1,
        currentNumber: 0,
        resetFrequency: 'yearly',
        lastResetDate: now,
      },
    },
    { upsert: true }
  );

  const current = await AdmissionIdConfigModel.findOne({ schoolId });

  const shouldReset =
    current.resetFrequency !== 'never' &&
    (!current.lastResetDate ||
      (current.resetFrequency === 'yearly' &&
        now.getFullYear() > new Date(current.lastResetDate).getFullYear()) ||
      (current.resetFrequency === 'monthly' &&
        (now.getFullYear() > new Date(current.lastResetDate).getFullYear() ||
          now.getMonth() > new Date(current.lastResetDate).getMonth())));

  let config;
  if (shouldReset) {
    const resetResult = await AdmissionIdConfigModel.findOneAndUpdate(
      { schoolId, lastResetDate: current.lastResetDate },
      { $set: { currentNumber: current.startingNumber + 1, lastResetDate: now } },
      { new: true }
    );
    if (resetResult) {
      config = resetResult;
    } else {
      config = await AdmissionIdConfigModel.findOneAndUpdate(
        { schoolId },
        { $inc: { currentNumber: 1 } },
        { new: true }
      );
    }
  } else {
    config = await AdmissionIdConfigModel.findOneAndUpdate(
      { schoolId },
      { $inc: { currentNumber: 1 } },
      { new: true }
    );
  }

  let admissionId = config.prefix;
  if (config.yearFormat !== 'none') {
    if (config.separator) admissionId += config.separator;
    admissionId +=
      config.yearFormat === 'YYYY' ? now.getFullYear() : String(now.getFullYear()).slice(-2);
  }
  if (config.separator) admissionId += config.separator;
  admissionId += String(config.currentNumber).padStart(config.numberPadding, '0');

  return admissionId;
}

export default mongoose;
