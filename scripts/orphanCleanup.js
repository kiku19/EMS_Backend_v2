/**
 * DATA-06: Orphan Document Cleanup Script
 *
 * Finds and fixes dangling references left behind by deleted Staff and Student
 * documents. Run once against any existing database to bring it into a consistent
 * state, then the cascade logic in staffDeletionService.js keeps it clean on
 * every future deletion.
 *
 * Usage:
 *   node scripts/orphanCleanup.js [--dry-run]
 *
 * --dry-run  Reports orphans without modifying any documents.
 */

import dotenv from 'dotenv';
dotenv.config();

import mongoose, { connectDB, Conversation, Message } from '../database.js';
import ActivityLog from '../models/ActivityLog.js';
import ChapterProgress from '../models/ChapterProgress.js';
import ClassAnnouncement from '../models/ClassAnnouncement.js';
import Homework from '../models/Homework.js';
import Notification from '../models/Notification.js';
import NotificationPreference from '../models/NotificationPreference.js';
import Remark from '../models/Remark.js';
import StaffAttendance from '../models/StaffAttendance.js';
import TeacherLeave from '../models/TeacherLeave.js';

const DRY_RUN = process.argv.includes('--dry-run');

async function getActiveIds(Model, field = '_id') {
  const docs = await Model.find({ isDeleted: { $ne: true } })
    .select(field)
    .lean();
  return new Set(docs.map((d) => String(d[field] ?? d._id)));
}

async function reportOrphans(label, count) {
  const prefix = DRY_RUN ? '[DRY-RUN]' : '[FIXED]';
  console.log(`${prefix} ${label}: ${count}`);
}

async function cleanStaffOrphans(activeStaffIds) {
  console.log('\n--- Staff Orphan Cleanup ---');

  // StaffAttendance with no live staff
  const orphanedAttendance = await StaffAttendance.aggregate([
    {
      $lookup: {
        from: 'staffs',
        let: { sid: '$staffId' },
        pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$sid'] }, isDeleted: { $ne: true } } }],
        as: 'staffDoc',
      },
    },
    { $match: { staffDoc: { $size: 0 } } },
  ]);
  const orphanedAttendanceIds = orphanedAttendance.map((d) => d._id);
  await reportOrphans('StaffAttendance with deleted staff', orphanedAttendanceIds.length);
  if (!DRY_RUN && orphanedAttendanceIds.length > 0) {
    await StaffAttendance.deleteMany({ _id: { $in: orphanedAttendanceIds } });
  }

  // TeacherLeave with no live staff
  const orphanedLeaves = await TeacherLeave.aggregate([
    {
      $lookup: {
        from: 'staffs',
        let: { tid: '$teacherId' },
        pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$tid'] }, isDeleted: { $ne: true } } }],
        as: 'staffDoc',
      },
    },
    { $match: { staffDoc: { $size: 0 } } },
  ]);
  const orphanedLeaveIds = orphanedLeaves.map((d) => d._id);
  await reportOrphans('TeacherLeave with deleted staff', orphanedLeaveIds.length);
  if (!DRY_RUN && orphanedLeaveIds.length > 0) {
    await TeacherLeave.deleteMany({ _id: { $in: orphanedLeaveIds } });
  }

  // Notifications for deleted staff
  const orphanedNotifs = await Notification.aggregate([
    { $match: { userModel: 'Staff' } },
    {
      $lookup: {
        from: 'staffs',
        let: { uid: '$userId' },
        pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$uid'] }, isDeleted: { $ne: true } } }],
        as: 'staffDoc',
      },
    },
    { $match: { staffDoc: { $size: 0 } } },
  ]);
  const orphanedNotifIds = orphanedNotifs.map((d) => d._id);
  await reportOrphans('Notifications for deleted staff', orphanedNotifIds.length);
  if (!DRY_RUN && orphanedNotifIds.length > 0) {
    await Notification.deleteMany({ _id: { $in: orphanedNotifIds } });
  }

  // NotificationPreferences for deleted staff
  const orphanedPrefs = await NotificationPreference.aggregate([
    { $match: { userModel: 'Staff' } },
    {
      $lookup: {
        from: 'staffs',
        let: { uid: '$userId' },
        pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$uid'] }, isDeleted: { $ne: true } } }],
        as: 'staffDoc',
      },
    },
    { $match: { staffDoc: { $size: 0 } } },
  ]);
  const orphanedPrefIds = orphanedPrefs.map((d) => d._id);
  await reportOrphans('NotificationPreferences for deleted staff', orphanedPrefIds.length);
  if (!DRY_RUN && orphanedPrefIds.length > 0) {
    await NotificationPreference.deleteMany({ _id: { $in: orphanedPrefIds } });
  }

  // Messages sent by deleted staff
  const orphanedMessages = await Message.aggregate([
    { $match: { senderModel: 'Staff' } },
    {
      $lookup: {
        from: 'staffs',
        let: { sid: '$senderId' },
        pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$sid'] }, isDeleted: { $ne: true } } }],
        as: 'staffDoc',
      },
    },
    { $match: { staffDoc: { $size: 0 } } },
  ]);
  const orphanedMessageIds = orphanedMessages.map((d) => d._id);
  await reportOrphans('Messages from deleted staff', orphanedMessageIds.length);
  if (!DRY_RUN && orphanedMessageIds.length > 0) {
    await Message.deleteMany({ _id: { $in: orphanedMessageIds } });
  }

  // Conversations containing only deleted staff participants
  const orphanedConversations = await Conversation.aggregate([
    {
      $match: {
        'participants.userModel': 'Staff',
      },
    },
    {
      $addFields: {
        staffParticipants: {
          $filter: {
            input: '$participants',
            as: 'p',
            cond: { $eq: ['$$p.userModel', 'Staff'] },
          },
        },
      },
    },
    {
      $lookup: {
        from: 'staffs',
        let: { participantIds: '$staffParticipants.userId' },
        pipeline: [
          {
            $match: {
              $expr: { $in: ['$_id', '$$participantIds'] },
              isDeleted: { $ne: true },
            },
          },
        ],
        as: 'liveStaff',
      },
    },
    { $match: { liveStaff: { $size: 0 } } },
  ]);
  const orphanedConvIds = orphanedConversations.map((d) => d._id);
  await reportOrphans('Conversations with only deleted staff', orphanedConvIds.length);
  if (!DRY_RUN && orphanedConvIds.length > 0) {
    await Conversation.deleteMany({ _id: { $in: orphanedConvIds } });
  }

  // ChapterProgress with dangling teacherId
  const danglingChapterProgress = await ChapterProgress.aggregate([
    { $match: { teacherId: { $exists: true, $ne: null } } },
    {
      $lookup: {
        from: 'staffs',
        let: { tid: '$teacherId' },
        pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$tid'] }, isDeleted: { $ne: true } } }],
        as: 'staffDoc',
      },
    },
    { $match: { staffDoc: { $size: 0 } } },
  ]);
  const danglingCPIds = danglingChapterProgress.map((d) => d._id);
  await reportOrphans('ChapterProgress with deleted teacherId', danglingCPIds.length);
  if (!DRY_RUN && danglingCPIds.length > 0) {
    await ChapterProgress.updateMany({ _id: { $in: danglingCPIds } }, { $unset: { teacherId: 1 } });
  }

  // Homework with dangling teacherId
  const danglingHomework = await Homework.aggregate([
    { $match: { teacherId: { $exists: true, $ne: null } } },
    {
      $lookup: {
        from: 'staffs',
        let: { tid: '$teacherId' },
        pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$tid'] }, isDeleted: { $ne: true } } }],
        as: 'staffDoc',
      },
    },
    { $match: { staffDoc: { $size: 0 } } },
  ]);
  const danglingHWIds = danglingHomework.map((d) => d._id);
  await reportOrphans('Homework with deleted teacherId', danglingHWIds.length);
  if (!DRY_RUN && danglingHWIds.length > 0) {
    await Homework.updateMany({ _id: { $in: danglingHWIds } }, { $unset: { teacherId: 1 } });
  }

  // Remarks with dangling authorId
  const danglingRemarks = await Remark.aggregate([
    { $match: { authorId: { $exists: true, $ne: null } } },
    {
      $lookup: {
        from: 'staffs',
        let: { aid: '$authorId' },
        pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$aid'] }, isDeleted: { $ne: true } } }],
        as: 'staffDoc',
      },
    },
    { $match: { staffDoc: { $size: 0 } } },
  ]);
  const danglingRemarkIds = danglingRemarks.map((d) => d._id);
  await reportOrphans('Remarks with deleted authorId', danglingRemarkIds.length);
  if (!DRY_RUN && danglingRemarkIds.length > 0) {
    await Remark.updateMany({ _id: { $in: danglingRemarkIds } }, { $unset: { authorId: 1 } });
  }

  // ClassAnnouncements with dangling sentBy
  const danglingAnnouncements = await ClassAnnouncement.aggregate([
    { $match: { sentBy: { $exists: true, $ne: null } } },
    {
      $lookup: {
        from: 'staffs',
        let: { sid: '$sentBy' },
        pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$sid'] }, isDeleted: { $ne: true } } }],
        as: 'staffDoc',
      },
    },
    { $match: { staffDoc: { $size: 0 } } },
  ]);
  const danglingAnnouncementIds = danglingAnnouncements.map((d) => d._id);
  await reportOrphans('ClassAnnouncements with deleted sentBy', danglingAnnouncementIds.length);
  if (!DRY_RUN && danglingAnnouncementIds.length > 0) {
    await ClassAnnouncement.updateMany(
      { _id: { $in: danglingAnnouncementIds } },
      { $unset: { sentBy: 1 } }
    );
  }

  // ActivityLog with dangling performedBy — report only, do NOT delete (audit trail)
  const danglingActivityLogs = await ActivityLog.aggregate([
    { $match: { performedBy: { $exists: true, $ne: null } } },
    {
      $lookup: {
        from: 'staffs',
        let: { pid: '$performedBy' },
        pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$pid'] }, isDeleted: { $ne: true } } }],
        as: 'staffDoc',
      },
    },
    { $match: { staffDoc: { $size: 0 } } },
  ]);
  console.log(
    `[INFO] ActivityLog entries with deleted performedBy (audit trail — not modified): ${danglingActivityLogs.length}`
  );
}

async function main() {
  await connectDB();
  console.log(`\nOrphan Cleanup Script — ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE RUN'}`);
  console.log('='.repeat(60));

  await cleanStaffOrphans();

  console.log('\nDone.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Orphan cleanup failed:', err);
  process.exit(1);
});
