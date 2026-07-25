import express from 'express';
import { z } from 'zod';
import {
  Staff,
  Class,
  Student,
  Attendance,
  ExamSchedule,
  Exam,
  Result,
  Timetable,
  TeacherTimetable,
  ConflictLog,
  Counter,
  IntakeForm,
  FormAssignment,
  FormSubmission,
  Admission,
  Appointment,
  Feedback,
  CallLog,
  SchoolSettings,
  FeeTemplate,
  FeeStructure,
  FeePayment,
  FeeRefund,
  Substitution,
  AdmissionFormConfig,
  AdmissionIdConfig,
  RollNumberConfig,
  DocumentConfig,
} from '../database.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { validateZod } from '../middleware/validation.js';
import { extractSchoolId } from '../utils/schoolContext.js';

// External models
import ActivityLog from '../models/ActivityLog.js';
import Announcement from '../models/Announcement.js';
import AnnouncementRecipient from '../models/AnnouncementRecipient.js';
import CallHistory from '../models/CallHistory.js';
import ChapterProgress from '../models/ChapterProgress.js';
import ClassAnnouncement from '../models/ClassAnnouncement.js';
import ClassRating from '../models/ClassRating.js';
import Conversation from '../models/Conversation.js';
import FeeCollectionPeriod from '../models/FeeCollectionPeriod.js';
import FeeConsession from '../models/FeeConcession.js';
import FeeHead from '../models/FeeHead.js';
import FeeRule from '../models/FeeRule.js';
import GatePass from '../models/GatePass.js';
import Homework from '../models/Homework.js';
import LateFeeRule from '../models/LateFeeRule.js';
import Message from '../models/Message.js';
import Notification from '../models/Notification.js';
import NotificationPreference from '../models/NotificationPreference.js';
import Parent from '../models/Parent.js';
import PaymentMethodConfig from '../models/PaymentMethodConfig.js';
import PayrollAuditLog from '../models/PayrollAuditLog.js';
import PayrollRecord from '../models/PayrollRecord.js';
import PayrollRun from '../models/PayrollRun.js';
import Payslip from '../models/Payslip.js';
import PermissionRequest from '../models/PermissionRequest.js';
import PushToken from '../models/PushToken.js';
import Remark from '../models/Remark.js';
import Reminder from '../models/Reminder.js';
import ReminderLog from '../models/ReminderLog.js';
import ReminderTemplate from '../models/ReminderTemplate.js';
import SalaryAdjustment from '../models/SalaryAdjustment.js';
import StaffAttendance from '../models/StaffAttendance.js';
import StaffIdConfig from '../models/StaffIdConfig.js';
import StaffProfileAudit from '../models/StaffProfileAudit.js';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import TeacherLeave from '../models/TeacherLeave.js';
import TrashItem from '../models/TrashItem.js';
import UserPermission from '../models/UserPermission.js';
import UserPresence from '../models/UserPresence.js';
import Visitor from '../models/Visitor.js';

const router = express.Router();
router.use(authenticate);

const VALID_CATEGORIES = [
  'students',
  'staff',
  'classes',
  'attendance',
  'academics',
  'timetable',
  'fees',
  'payroll',
  'messaging',
  'frontDesk',
  'forms',
  'settings',
  'system',
  'all',
];

const executeCleanupSchema = z.object({
  categories: z.array(z.enum(VALID_CATEGORIES)).min(1, 'At least one category must be selected'),
});

function scopeBySchool(schoolId, model, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) throw new Error('schoolId is required for scoped queries');
  // Only add schoolId filter if the model's schema actually has a schoolId field
  const hasSchoolIdField = model.schema && model.schema.path('schoolId');
  if (!hasSchoolIdField) return { ...query };
  return { ...query, schoolId: normalizedSchoolId };
}

/**
 * Data categories with their models for deletion.
 * Organized into logical groups for the UI.
 */
const DATA_CATEGORIES = {
  students: {
    label: 'Students',
    description: 'All student records, admissions, and related data',
    models: [
      { model: Student, name: 'Students' },
      { model: Admission, name: 'Admissions' },
      { model: Parent, name: 'Parent Accounts' },
    ],
  },
  staff: {
    label: 'Staff',
    description: 'All staff records, leaves, and attendance',
    models: [
      { model: Staff, name: 'Staff' },
      { model: StaffAttendance, name: 'Staff Attendance' },
      { model: TeacherLeave, name: 'Teacher Leaves' },
      { model: StaffProfileAudit, name: 'Staff Profile Audits' },
    ],
  },
  classes: {
    label: 'Classes',
    description: 'All class records and class-related data',
    models: [
      { model: Class, name: 'Classes' },
      { model: ClassAnnouncement, name: 'Class Announcements' },
      { model: ClassRating, name: 'Class Ratings' },
    ],
  },
  attendance: {
    label: 'Attendance',
    description: 'All student attendance records',
    models: [{ model: Attendance, name: 'Attendance Records' }],
  },
  academics: {
    label: 'Academics',
    description: 'Exams, results, homework, and chapter progress',
    models: [
      { model: ExamSchedule, name: 'Exam Schedules' },
      { model: Exam, name: 'Exams' },
      { model: Result, name: 'Results' },
      { model: Homework, name: 'Homework' },
      { model: ChapterProgress, name: 'Chapter Progress' },
      { model: Remark, name: 'Remarks' },
    ],
  },
  timetable: {
    label: 'Timetable',
    description: 'Timetables, teacher schedules, conflicts, and substitutions',
    models: [
      { model: Timetable, name: 'Class Timetables' },
      { model: TeacherTimetable, name: 'Teacher Timetables' },
      { model: ConflictLog, name: 'Conflict Logs' },
      { model: Substitution, name: 'Substitutions' },
    ],
  },
  fees: {
    label: 'Fees & Payments',
    description: 'Fee structures, payments, refunds, and related configurations',
    models: [
      { model: FeeTemplate, name: 'Fee Templates' },
      { model: FeeStructure, name: 'Fee Structures' },
      { model: FeePayment, name: 'Fee Payments' },
      { model: FeeRefund, name: 'Fee Refunds' },
      { model: StudentFeeStructure, name: 'Student Fee Structures' },
      { model: FeeHead, name: 'Fee Heads' },
      { model: FeeRule, name: 'Fee Rules' },
      { model: FeeCollectionPeriod, name: 'Fee Collection Periods' },
      { model: FeeConsession, name: 'Fee Concessions' },
      { model: LateFeeRule, name: 'Late Fee Rules' },
      { model: PaymentMethodConfig, name: 'Payment Method Configs' },
    ],
  },
  payroll: {
    label: 'Payroll',
    description: 'Payroll records, payslips, salary adjustments, and audit logs',
    models: [
      { model: PayrollRecord, name: 'Payroll Records' },
      { model: PayrollRun, name: 'Payroll Runs' },
      { model: Payslip, name: 'Payslips' },
      { model: SalaryAdjustment, name: 'Salary Adjustments' },
      { model: PayrollAuditLog, name: 'Payroll Audit Logs' },
    ],
  },
  messaging: {
    label: 'Messages & Notifications',
    description: 'Messages, conversations, announcements, and notifications',
    models: [
      { model: Message, name: 'Messages' },
      { model: Conversation, name: 'Conversations' },
      { model: Announcement, name: 'Announcements' },
      { model: AnnouncementRecipient, name: 'Announcement Recipients' },
      { model: Notification, name: 'Notifications' },
      { model: NotificationPreference, name: 'Notification Preferences' },
      { model: PushToken, name: 'Push Tokens' },
    ],
  },
  frontDesk: {
    label: 'Front Desk',
    description: 'Visitors, gate passes, appointments, calls, and feedback',
    models: [
      { model: Visitor, name: 'Visitors' },
      { model: GatePass, name: 'Gate Passes' },
      { model: Appointment, name: 'Appointments' },
      { model: Feedback, name: 'Feedback' },
      { model: CallLog, name: 'Call Logs' },
      { model: CallHistory, name: 'Call History' },
    ],
  },
  forms: {
    label: 'Forms & Submissions',
    description: 'Intake forms, form assignments, and submissions',
    models: [
      { model: IntakeForm, name: 'Intake Forms' },
      { model: FormAssignment, name: 'Form Assignments' },
      { model: FormSubmission, name: 'Form Submissions' },
    ],
  },
  settings: {
    label: 'Settings & Configurations',
    description: 'School settings, ID configs, permissions, and all configurations',
    models: [
      { model: SchoolSettings, name: 'School Settings' },
      { model: AdmissionFormConfig, name: 'Admission Form Config' },
      { model: AdmissionIdConfig, name: 'Admission ID Config' },
      { model: RollNumberConfig, name: 'Roll Number Config' },
      { model: DocumentConfig, name: 'Document Config' },
      { model: StaffIdConfig, name: 'Staff ID Config' },
      { model: UserPermission, name: 'User Permissions' },
      { model: PermissionRequest, name: 'Permission Requests' },
    ],
  },
  system: {
    label: 'System Data',
    description: 'Activity logs, reminders, counters, trash, and user presence',
    models: [
      { model: ActivityLog, name: 'Activity Logs' },
      { model: Counter, name: 'Counters' },
      { model: Reminder, name: 'Reminders' },
      { model: ReminderLog, name: 'Reminder Logs' },
      { model: ReminderTemplate, name: 'Reminder Templates' },
      { model: TrashItem, name: 'Trash Items' },
      { model: UserPresence, name: 'User Presence' },
    ],
  },
};

/**
 * GET /api/data-cleanup/preview
 * Preview counts for all data categories
 */
// [D7] Data tools (bulk delete + restore) are destructive school-wide operations;
// gate them with requireAdmin instead of the unrelated `classes:delete` permission.
router.get('/preview', requireAdmin, async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const counts = {};

    for (const [categoryKey, category] of Object.entries(DATA_CATEGORIES)) {
      const categoryCounts = {};
      let categoryTotal = 0;

      for (const { model, name } of category.models) {
        const count = await model.countDocuments(scopeBySchool(schoolId, model));
        categoryCounts[name] = count;
        categoryTotal += count;
      }

      counts[categoryKey] = {
        label: category.label,
        description: category.description,
        models: categoryCounts,
        total: categoryTotal,
      };
    }

    // Calculate grand total
    const grandTotal = Object.values(counts).reduce((sum, cat) => sum + cat.total, 0);

    res.json({
      success: true,
      counts,
      grandTotal,
    });
  } catch (error) {
    console.error('Error previewing data cleanup:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to preview data',
      error: error.message,
    });
  }
});

/**
 * POST /api/data-cleanup/execute
 * Move data to trash for selected categories, then delete from source collections.
 * Body: { categories: ['students', 'staff', ...] } or { categories: ['all'] }
 */
// [D7] Gate the destructive bulk-cleanup with requireAdmin (was the unrelated
// `classes:delete` permission). Process in cursor batches instead of loading
// each whole collection into memory, and cap the snapshot kept in TrashItem so
// a multi-thousand-row collection can't OOM the process or balloon the trash doc.
router.post('/execute', requireAdmin, validateZod(executeCleanupSchema), async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const { categories } = req.body;
    const deletedBy = req.user?.id || req.user?._id;

    const isAll = categories.includes('all');
    const selectedCategories = isAll
      ? Object.keys(DATA_CATEGORIES)
      : categories.filter((c) => DATA_CATEGORIES[c]);

    // 30-day expiry for trash items
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const results = {};
    let totalMoved = 0;

    for (const categoryKey of selectedCategories) {
      const category = DATA_CATEGORIES[categoryKey];
      const categoryResults = {};

      for (const { model, name } of category.models) {
        // [D7] Stream the collection through the cursor in batches. Previously
        // the whole collection was loaded into a single array via
        // `model.find().lean()` and then embedded wholesale into one
        // TrashItem.originalData — for a large collection that is both an OOM
        // risk and a multi-MB MongoDB document. We now count first, page
        // through in BATCH_SIZE chunks, and store only a capped snapshot.
        const scope = scopeBySchool(schoolId, model);
        const totalCount = await model.countDocuments(scope);

        if (totalCount === 0) {
          categoryResults[name] = 0;
          continue;
        }

        const BATCH_SIZE = 500;
        // Cap the snapshot embedded in TrashItem.originalData. The full set is
        // hard-deleted from the source either way (deleteMany below); the
        // snapshot is only a best-effort restore preview, so a hard cap keeps
        // the trash doc bounded. `truncated` records when rows were dropped.
        const SNAPSHOT_CAP = 5000;
        const snapshotDocs = [];

        // Read only enough batches to fill the capped snapshot — we don't need
        // to walk the whole collection since deleteMany(scope) removes the full
        // set without reading it. totalCount drives the displayed record count
        // and the truncated flag.
        for (let skip = 0; skip < Math.min(totalCount, SNAPSHOT_CAP); skip += BATCH_SIZE) {
          // Order by _id for a stable, resumable walk.
          const remaining = SNAPSHOT_CAP - snapshotDocs.length;
          const batch = await model
            .find(scope)
            .sort({ _id: 1 })
            .skip(skip)
            .limit(Math.min(BATCH_SIZE, remaining))
            .lean();

          if (batch.length === 0) break;
          snapshotDocs.push(...batch);
        }

        const snapshotTruncated = totalCount > snapshotDocs.length;

        await TrashItem.create({
          itemType: 'BulkCleanup',
          itemName: `${category.label} — ${name} (${totalCount} records)`,
          deletedBy,
          expiresAt,
          // Capped snapshot — see SNAPSHOT_CAP above.
          originalData: snapshotDocs,
          schoolId,
          restoreStrategy: 'hard-delete',
          modelName: model.modelName,
          bulkCleanup: {
            category: categoryKey,
            modelName: model.modelName,
            recordCount: totalCount,
            snapshotCount: snapshotDocs.length,
            truncated: snapshotTruncated,
            schoolId,
          },
        });

        // Now hard-delete the full set from the source collection.
        await model.deleteMany(scope);
        categoryResults[name] = totalCount;
        totalMoved += totalCount;
      }

      results[categoryKey] = {
        label: category.label,
        deleted: categoryResults,
        total: Object.values(categoryResults).reduce((sum, c) => sum + c, 0),
      };
    }

    res.json({
      success: true,
      message: `Successfully moved ${totalMoved} records to trash across ${selectedCategories.length} categories`,
      results,
      totalDeleted: totalMoved,
    });
  } catch (error) {
    console.error('Error executing data cleanup:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to execute data cleanup',
      error: error.message,
    });
  }
});

export default router;
