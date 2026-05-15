import mongoose from 'mongoose';
import { Class, Conversation, Message, Staff, TeacherTimetable, Timetable } from '../database.js';
import ActivityLog from '../models/ActivityLog.js';
import Hostel from '../models/Hostel.js';
import ChapterProgress from '../models/ChapterProgress.js';
import ClassAnnouncement from '../models/ClassAnnouncement.js';
import ConsentRecord from '../models/ConsentRecord.js';
import Homework from '../models/Homework.js';
import Notification from '../models/Notification.js';
import NotificationPreference from '../models/NotificationPreference.js';
import PayrollRecord from '../models/PayrollRecord.js';
import Payslip from '../models/Payslip.js';
import PushToken from '../models/PushToken.js';
import Remark from '../models/Remark.js';
import SalaryAdjustment from '../models/SalaryAdjustment.js';
import StaffAttendance from '../models/StaffAttendance.js';
import StaffProfileAudit from '../models/StaffProfileAudit.js';
import TeacherLeave from '../models/TeacherLeave.js';
import TrashItem from '../models/TrashItem.js';
import UserPermission from '../models/UserPermission.js';

function toObjectId(value) {
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }
  return new mongoose.Types.ObjectId(String(value));
}

function getDeletedCount(result) {
  return result?.deletedCount ?? 0;
}

function getModifiedCount(result) {
  return result?.modifiedCount ?? 0;
}

/**
 * Cascade-cleans all orphan documents that reference the given staffId.
 * Called after the Staff document itself is soft-deleted.
 *
 * Returns a summary of all affected document counts.
 */
export async function cascadeDeleteStaffReferences(staffId) {
  const normalizedStaffId = toObjectId(staffId);
  const deleted = {};

  await Promise.all([
    // Hard-delete attendance records — no value once staff is gone
    StaffAttendance.deleteMany({ staffId: normalizedStaffId }).then(
      (r) => (deleted.staffAttendance = getDeletedCount(r))
    ),

    // Hard-delete leave requests — no value once staff is gone
    TeacherLeave.deleteMany({ teacherId: normalizedStaffId }).then(
      (r) => (deleted.teacherLeaves = getDeletedCount(r))
    ),

    // Hard-delete personal notifications for this staff member
    Notification.deleteMany({
      userId: normalizedStaffId,
      userModel: 'Staff',
    }).then((r) => (deleted.notifications = getDeletedCount(r))),

    // Hard-delete notification preferences for this staff member
    NotificationPreference.deleteMany({
      userId: normalizedStaffId,
      userModel: 'Staff',
    }).then((r) => (deleted.notificationPreferences = getDeletedCount(r))),

    // Hard-delete messages sent or received by this staff member
    Message.deleteMany({
      $or: [
        { senderId: normalizedStaffId, senderModel: 'Staff' },
        { receiverId: normalizedStaffId, receiverModel: 'Staff' },
      ],
    }).then((r) => (deleted.messages = getDeletedCount(r))),

    // Remove staff from conversation participant lists; delete conversation if now empty
    Conversation.deleteMany({
      participants: {
        $elemMatch: { userId: normalizedStaffId, userModel: 'Staff' },
      },
    }).then((r) => (deleted.conversations = getDeletedCount(r))),

    // Null out teacherId on ChapterProgress — keep progress records for the class
    ChapterProgress.updateMany({ teacherId: normalizedStaffId }, { $unset: { teacherId: 1 } }).then(
      (r) => (deleted.chapterProgressUnlinked = getModifiedCount(r))
    ),

    // Null out teacherId on Homework — keep assignments for students
    Homework.updateMany({ teacherId: normalizedStaffId }, { $unset: { teacherId: 1 } }).then(
      (r) => (deleted.homeworkUnlinked = getModifiedCount(r))
    ),

    // Null out authorId on Remark — keep remarks as student history (field is optional)
    Remark.updateMany({ authorId: normalizedStaffId }, { $unset: { authorId: 1 } }).then(
      (r) => (deleted.remarksUnlinked = getModifiedCount(r))
    ),

    // Null out sentBy on ClassAnnouncement — keep announcements as historical records
    ClassAnnouncement.updateMany({ sentBy: normalizedStaffId }, { $unset: { sentBy: 1 } }).then(
      (r) => (deleted.classAnnouncementsUnlinked = getModifiedCount(r))
    ),

    // Clear warden reference from hostels
    Hostel.updateMany(
      { wardenId: normalizedStaffId },
      { $unset: { wardenId: 1, wardenName: 1, wardenPhone: 1, wardenEmail: 1 } }
    ).then((r) => (deleted.hostelWardensCleared = getModifiedCount(r))),
  ]);

  // ActivityLog.performedBy is intentionally NOT cleaned — audit trail must be preserved.

  return deleted;
}

/**
 * Permanently purges a staff member and ALL related personal data.
 * Used for GDPR Right to Erasure — this is irreversible.
 *
 * Covers everything cascadeDeleteStaffReferences does, plus:
 *  - TeacherTimetable, Class teacher assignment, Timetable slot unlinking
 *  - UserPermission, PushToken
 *  - PayrollRecord, Payslip, SalaryAdjustment
 *  - StaffProfileAudit, TrashItem, ConsentRecord
 *  - The Staff document itself (hard delete)
 *
 * Returns { staff, deletedRecords }.
 */
export async function permanentlyDeleteStaffData(staffId) {
  const normalizedStaffId = toObjectId(staffId);
  const staff = await Staff.findById(normalizedStaffId).lean();

  if (!staff) {
    const error = new Error('Staff not found');
    error.status = 404;
    throw error;
  }

  // Run all reference cleanup first (messages, attendance, leaves, notifications, etc.)
  const deletedRecords = await cascadeDeleteStaffReferences(normalizedStaffId);

  // TeacherTimetable documents for this staff
  deletedRecords.teacherTimetables = getDeletedCount(
    await TeacherTimetable.deleteMany({ teacherId: normalizedStaffId })
  );

  // Unlink class teacher assignment
  deletedRecords.classTeacherUnlinked = getModifiedCount(
    await Class.updateMany({ classTeacherId: normalizedStaffId }, { $unset: { classTeacherId: 1 } })
  );

  // Null out this teacher from timetable schedule slots
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const timetableResults = await Promise.all(
    DAYS.map((day) =>
      Timetable.updateMany(
        { [`schedule.${day}.teacherId`]: normalizedStaffId },
        { $set: { [`schedule.${day}.$[slot].teacherId`]: null } },
        { arrayFilters: [{ 'slot.teacherId': normalizedStaffId }] }
      )
    )
  );
  deletedRecords.timetableSlotsUnlinked = timetableResults.reduce(
    (sum, r) => sum + getModifiedCount(r),
    0
  );

  // UserPermission and PushToken
  deletedRecords.userPermissions = getDeletedCount(
    await UserPermission.deleteOne({ userId: normalizedStaffId })
  );
  deletedRecords.pushTokens = getDeletedCount(
    await PushToken.deleteMany({ user: normalizedStaffId, userModel: 'Staff' })
  );

  // Payroll financial records
  deletedRecords.payrollRecords = getDeletedCount(
    await PayrollRecord.deleteMany({ employeeId: normalizedStaffId })
  );
  deletedRecords.payslips = getDeletedCount(
    await Payslip.deleteMany({ employeeId: normalizedStaffId })
  );
  deletedRecords.salaryAdjustments = getDeletedCount(
    await SalaryAdjustment.deleteMany({ employeeId: normalizedStaffId })
  );

  // Profile audit trail and trash entries
  deletedRecords.staffProfileAudits = getDeletedCount(
    await StaffProfileAudit.deleteMany({ staffId: normalizedStaffId })
  );
  deletedRecords.trashEntriesRemoved = getDeletedCount(
    await TrashItem.deleteMany({ itemType: 'Staff', itemId: normalizedStaffId })
  );

  // Consent records for this staff member
  deletedRecords.consentRecords = getDeletedCount(
    await ConsentRecord.deleteMany({ entityType: 'Staff', entityId: normalizedStaffId })
  );

  // Finally, hard-delete the Staff document itself
  deletedRecords.staff = getDeletedCount(await Staff.deleteOne({ _id: normalizedStaffId }));

  return { staff, deletedRecords };
}
