import mongoose from 'mongoose';
import {
  Attendance,
  Conversation,
  FeePayment,
  FeeRefund,
  FeeStructure,
  FormSubmission,
  Message,
  Result,
  Student,
} from '../database.js';
import BookIssue from '../models/BookIssue.js';
import ConsentRecord from '../models/ConsentRecord.js';
import ChapterProgress from '../models/ChapterProgress.js';
import ClassAnnouncement from '../models/ClassAnnouncement.js';
import GatePass from '../models/GatePass.js';
import HostelAllocation from '../models/HostelAllocation.js';
import HostelRoom from '../models/HostelRoom.js';
import Homework from '../models/Homework.js';
import Notification from '../models/Notification.js';
import NotificationPreference from '../models/NotificationPreference.js';
import Parent from '../models/Parent.js';
import PTMSession from '../models/PTMSession.js';
import Remark from '../models/Remark.js';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import TrashItem from '../models/TrashItem.js';
import TransportRoute from '../models/TransportRoute.js';
import Visitor from '../models/Visitor.js';

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

export async function permanentlyDeleteStudentData(studentId, options = {}) {
  const { session } = options;
  const normalizedStudentId = toObjectId(studentId);
  const student = await Student.findById(normalizedStudentId).session(session).lean();

  if (!student) {
    const error = new Error('Student not found');
    error.status = 404;
    throw error;
  }

  const linkedParents = await Parent.find({
    'children.studentId': normalizedStudentId,
  })
    .select('_id')
    .session(session)
    .lean();

  const linkedParentIds = linkedParents.map((parent) => parent._id);
  const deletedRecords = {};

  deletedRecords.messages = getDeletedCount(
    await Message.deleteMany(
      {
        $or: [
          { senderId: normalizedStudentId, senderModel: 'Student' },
          { receiverId: normalizedStudentId, receiverModel: 'Student' },
        ],
      },
      { session }
    )
  );

  deletedRecords.conversations = getDeletedCount(
    await Conversation.deleteMany(
      {
        participants: {
          $elemMatch: {
            userId: normalizedStudentId,
            userModel: 'Student',
          },
        },
      },
      { session }
    )
  );

  deletedRecords.attendance = getDeletedCount(
    await Attendance.deleteMany({ studentId: normalizedStudentId }, { session })
  );
  deletedRecords.results = getDeletedCount(
    await Result.deleteMany({ studentId: normalizedStudentId }, { session })
  );
  deletedRecords.remarks = getDeletedCount(
    await Remark.deleteMany({ studentId: normalizedStudentId }, { session })
  );
  deletedRecords.studentFeeStructures = getDeletedCount(
    await StudentFeeStructure.deleteMany({ studentId: normalizedStudentId }, { session })
  );
  deletedRecords.feePayments = getDeletedCount(
    await FeePayment.deleteMany({ studentId: normalizedStudentId }, { session })
  );
  deletedRecords.feeRefunds = getDeletedCount(
    await FeeRefund.deleteMany({ studentId: normalizedStudentId }, { session })
  );
  deletedRecords.formSubmissions = getDeletedCount(
    await FormSubmission.deleteMany({ studentId: normalizedStudentId }, { session })
  );
  deletedRecords.gatePasses = getDeletedCount(
    await GatePass.deleteMany({ studentId: normalizedStudentId }, { session })
  );
  deletedRecords.visitorLogs = getDeletedCount(
    await Visitor.deleteMany({ studentId: normalizedStudentId }, { session })
  );

  deletedRecords.homeworkSubmissionsRemoved = getModifiedCount(
    await Homework.updateMany(
      { 'submissions.studentId': normalizedStudentId },
      { $pull: { submissions: { studentId: normalizedStudentId } } },
      { session }
    )
  );

  deletedRecords.announcementRecipientsRemoved = getModifiedCount(
    await ClassAnnouncement.updateMany(
      { 'recipients.studentId': normalizedStudentId },
      { $pull: { recipients: { studentId: normalizedStudentId } } },
      { session }
    )
  );

  deletedRecords.chapterAssignmentsRemoved = getModifiedCount(
    await ChapterProgress.updateMany(
      { assignedStudents: normalizedStudentId },
      { $pull: { assignedStudents: normalizedStudentId } },
      { session }
    )
  );

  deletedRecords.feeStructuresUnlinked = getModifiedCount(
    await FeeStructure.updateMany(
      { appliedTo: normalizedStudentId },
      { $pull: { appliedTo: normalizedStudentId } },
      { session }
    )
  );

  if (linkedParentIds.length > 0) {
    deletedRecords.parentAccountsUnlinked = getModifiedCount(
      await Parent.updateMany(
        { _id: { $in: linkedParentIds } },
        { $pull: { children: { studentId: normalizedStudentId } } },
        { session }
      )
    );

    const orphanedParents = await Parent.find({
      _id: { $in: linkedParentIds },
      children: { $size: 0 },
    })
      .select('_id')
      .session(session)
      .lean();

    if (orphanedParents.length > 0) {
      deletedRecords.parentAccountsDeleted = getDeletedCount(
        await Parent.deleteMany(
          {
            _id: { $in: orphanedParents.map((parent) => parent._id) },
          },
          { session }
        )
      );
    } else {
      deletedRecords.parentAccountsDeleted = 0;
    }
  } else {
    deletedRecords.parentAccountsUnlinked = 0;
    deletedRecords.parentAccountsDeleted = 0;
  }

  deletedRecords.notifications = getDeletedCount(
    await Notification.deleteMany(
      {
        userId: normalizedStudentId,
        userModel: 'Student',
      },
      { session }
    )
  );

  deletedRecords.notificationPreferences = getDeletedCount(
    await NotificationPreference.deleteMany(
      {
        userId: normalizedStudentId,
        userModel: 'Student',
      },
      { session }
    )
  );

  deletedRecords.trashEntriesRemoved = getDeletedCount(
    await TrashItem.deleteMany(
      {
        itemType: 'Student',
        itemId: normalizedStudentId,
      },
      { session }
    )
  );

  deletedRecords.bookIssuesRemoved = getDeletedCount(
    await BookIssue.deleteMany({ studentId: normalizedStudentId }, { session })
  );

  deletedRecords.transportAssignmentsRemoved = getModifiedCount(
    await TransportRoute.updateMany(
      { 'students.studentId': normalizedStudentId },
      { $pull: { students: { studentId: normalizedStudentId } } },
      { session }
    )
  );

  deletedRecords.ptmSlotsRemoved = getModifiedCount(
    await PTMSession.updateMany(
      { 'slots.studentId': normalizedStudentId },
      { $pull: { slots: { studentId: normalizedStudentId } } },
      { session }
    )
  );

  // Delete consent records (including COPPA parental consent) for this student
  deletedRecords.consentRecords = getDeletedCount(
    await ConsentRecord.deleteMany(
      {
        entityType: 'Student',
        entityId: normalizedStudentId,
      },
      { session }
    )
  );

  // Hostel cleanup: vacate active allocations and decrement room occupancy
  const activeAllocations = await HostelAllocation.find({
    studentId: normalizedStudentId,
    status: 'active',
  })
    .session(session)
    .lean();

  if (activeAllocations.length > 0) {
    // Decrement occupiedBeds for each room
    for (const alloc of activeAllocations) {
      await HostelRoom.updateOne(
        { _id: alloc.roomId, occupiedBeds: { $gt: 0 } },
        { $inc: { occupiedBeds: -1 } },
        { session }
      );
    }
  }

  // Mark all allocations as vacated (active or otherwise) and delete
  deletedRecords.hostelAllocationsVacated = getModifiedCount(
    await HostelAllocation.updateMany(
      { studentId: normalizedStudentId, status: 'active' },
      { $set: { status: 'vacated', endDate: new Date() } },
      { session }
    )
  );

  deletedRecords.students = getDeletedCount(
    await Student.deleteOne({ _id: normalizedStudentId }, { session })
  );

  return {
    student,
    deletedRecords,
  };
}
