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
import ChapterProgress from '../models/ChapterProgress.js';
import ClassAnnouncement from '../models/ClassAnnouncement.js';
import GatePass from '../models/GatePass.js';
import Homework from '../models/Homework.js';
import Parent from '../models/Parent.js';
import Remark from '../models/Remark.js';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import TrashItem from '../models/TrashItem.js';
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

export async function permanentlyDeleteStudentData(studentId) {
  const normalizedStudentId = toObjectId(studentId);
  const student = await Student.findById(normalizedStudentId).lean();

  if (!student) {
    const error = new Error('Student not found');
    error.status = 404;
    throw error;
  }

  const linkedParents = await Parent.find({
    'children.studentId': normalizedStudentId,
  })
    .select('_id')
    .lean();

  const linkedParentIds = linkedParents.map((parent) => parent._id);
  const deletedRecords = {};

  deletedRecords.messages = getDeletedCount(await Message.deleteMany({
    $or: [
      { senderId: normalizedStudentId, senderModel: 'Student' },
      { receiverId: normalizedStudentId, receiverModel: 'Student' },
    ],
  }));

  deletedRecords.conversations = getDeletedCount(await Conversation.deleteMany({
    participants: {
      $elemMatch: {
        userId: normalizedStudentId,
        userModel: 'Student',
      },
    },
  }));

  deletedRecords.attendance = getDeletedCount(await Attendance.deleteMany({ studentId: normalizedStudentId }));
  deletedRecords.results = getDeletedCount(await Result.deleteMany({ studentId: normalizedStudentId }));
  deletedRecords.remarks = getDeletedCount(await Remark.deleteMany({ studentId: normalizedStudentId }));
  deletedRecords.studentFeeStructures = getDeletedCount(await StudentFeeStructure.deleteMany({ studentId: normalizedStudentId }));
  deletedRecords.feePayments = getDeletedCount(await FeePayment.deleteMany({ studentId: normalizedStudentId }));
  deletedRecords.feeRefunds = getDeletedCount(await FeeRefund.deleteMany({ studentId: normalizedStudentId }));
  deletedRecords.formSubmissions = getDeletedCount(await FormSubmission.deleteMany({ studentId: normalizedStudentId }));
  deletedRecords.gatePasses = getDeletedCount(await GatePass.deleteMany({ studentId: normalizedStudentId }));
  deletedRecords.visitorLogs = getDeletedCount(await Visitor.deleteMany({ studentId: normalizedStudentId }));

  deletedRecords.homeworkSubmissionsRemoved = getModifiedCount(await Homework.updateMany(
    { 'submissions.studentId': normalizedStudentId },
    { $pull: { submissions: { studentId: normalizedStudentId } } }
  ));

  deletedRecords.announcementRecipientsRemoved = getModifiedCount(await ClassAnnouncement.updateMany(
    { 'recipients.studentId': normalizedStudentId },
    { $pull: { recipients: { studentId: normalizedStudentId } } }
  ));

  deletedRecords.chapterAssignmentsRemoved = getModifiedCount(await ChapterProgress.updateMany(
    { assignedStudents: normalizedStudentId },
    { $pull: { assignedStudents: normalizedStudentId } }
  ));

  deletedRecords.feeStructuresUnlinked = getModifiedCount(await FeeStructure.updateMany(
    { appliedTo: normalizedStudentId },
    { $pull: { appliedTo: normalizedStudentId } }
  ));

  if (linkedParentIds.length > 0) {
    deletedRecords.parentAccountsUnlinked = getModifiedCount(await Parent.updateMany(
      { _id: { $in: linkedParentIds } },
      { $pull: { children: { studentId: normalizedStudentId } } }
    ));

    const orphanedParents = await Parent.find({
      _id: { $in: linkedParentIds },
      children: { $size: 0 },
    })
      .select('_id')
      .lean();

    if (orphanedParents.length > 0) {
      deletedRecords.parentAccountsDeleted = getDeletedCount(await Parent.deleteMany({
        _id: { $in: orphanedParents.map((parent) => parent._id) },
      }));
    } else {
      deletedRecords.parentAccountsDeleted = 0;
    }
  } else {
    deletedRecords.parentAccountsUnlinked = 0;
    deletedRecords.parentAccountsDeleted = 0;
  }

  deletedRecords.trashEntriesRemoved = getDeletedCount(await TrashItem.deleteMany({
    itemType: 'Student',
    itemId: normalizedStudentId,
  }));

  deletedRecords.students = getDeletedCount(await Student.deleteOne({ _id: normalizedStudentId }));

  return {
    student,
    deletedRecords,
  };
}
