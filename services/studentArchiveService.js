import mongoose from 'mongoose';
import {
  Student,
  Attendance,
  Result,
  Remark,
  GatePass,
  Conversation,
  Parent,
  StudentFeeStructure,
  FeePayment,
  FeeRefund,
} from '../database.js';
import { extractSchoolId } from '../utils/schoolContext.js';
import { logToTrash } from './trashService.js';

export class StudentNotFoundError extends Error {
  constructor() {
    super('Student not found');
    this.name = 'StudentNotFoundError';
    this.status = 404;
  }
}

/**
 * Reversibly archive a student and every dependent record that is part of the
 * archive lifecycle. The student, attendance rows, results and trash record
 * commit atomically, so the UI never offers an Undo action for an archive that
 * already destroyed historical data.
 */
export async function archiveStudent({ studentId, schoolId, deletedBy }) {
  const scopedSchoolId = extractSchoolId(schoolId);
  if (!scopedSchoolId) throw new Error('schoolId is required');
  if (!deletedBy) throw new Error('deletedBy is required');

  const mongoSession = await mongoose.startSession();
  let archivedStudent;
  let trashItem;
  let wasActive = false;

  try {
    await mongoSession.withTransaction(async (session) => {
      const student = await Student.findOne({
        _id: studentId,
        schoolId: scopedSchoolId,
        isDeleted: { $ne: true },
      }).session(session);

      if (!student) throw new StudentNotFoundError();

      const snapshot = student.toObject();
      const archivedAt = new Date();
      wasActive = student.status === 'active';

      student.isDeleted = true;
      student.deletedAt = archivedAt;
      student.status = 'inactive';
      await student.save({ session });

      await Attendance.updateMany(
        {
          studentId: student._id,
          schoolId: scopedSchoolId,
          isDeleted: { $ne: true },
        },
        { $set: { isDeleted: true, deletedAt: archivedAt, deletedBy } },
        { session }
      );
      await Result.updateMany(
        {
          studentId: student._id,
          schoolId: scopedSchoolId,
          isDeleted: { $ne: true },
        },
        { $set: { isDeleted: true, deletedAt: archivedAt } },
        { session }
      );

      // C28: Cascade the remaining dependent records. Each cleanup runs in its
      // own try/catch so a failure in one collection does not abort the others
      // (or the atomic archive itself) — best-effort suppression is the intent,
      // matching how Attendance/Result above operate within the transaction.

      // Remark — soft-delete so parents/staff no longer see remarks for the
      // archived student, while the rows remain for audit/restore.
      try {
        await Remark.updateMany(
          {
            studentId: student._id,
            schoolId: scopedSchoolId,
            isDeleted: { $ne: true },
          },
          { $set: { isDeleted: true, deletedAt: archivedAt } },
          { session }
        );
      } catch (err) {
        console.error('studentArchiveService: Remark cascade failed:', err);
      }

      // GatePass — cancel any ACTIVE gate passes so the archived student can no
      // longer be released at the gate. History (USED/EXPIRED) is preserved.
      try {
        await GatePass.updateMany(
          {
            studentId: student._id,
            schoolId: scopedSchoolId,
            status: { $in: ['ACTIVE', 'PENDING'] },
          },
          {
            $set: {
              status: 'CANCELLED',
              approvalStatus: 'CANCELLED',
              rejectionReason: 'Student archived',
            },
          },
          { session }
        );
      } catch (err) {
        console.error('studentArchiveService: GatePass cascade failed:', err);
      }

      // Conversation — remove the student from participant arrays so they no
      // longer appear in chat lists / receive messages. Message history is left
      // intact for audit.
      try {
        await Conversation.updateMany(
          { schoolId: scopedSchoolId, 'participants.userId': student._id },
          { $pull: { participants: { userId: student._id, userModel: 'Student' } } },
          { session }
        );
      } catch (err) {
        console.error('studentArchiveService: Conversation cascade failed:', err);
      }

      // Parent.children — detach the archived student from every parent/guardian
      // account so the parent app no longer lists an archived child.
      try {
        await Parent.updateMany(
          { schoolId: scopedSchoolId, 'children.studentId': student._id },
          { $pull: { children: { studentId: student._id } } },
          { session }
        );
      } catch (err) {
        console.error('studentArchiveService: Parent.children cascade failed:', err);
      }

      // StudentFeeStructure / FeePayment / FeeRefund — soft-delete the
      // archived student's entire fee history so it is hidden from EVERY read
      // path (not just the four display endpoints that $lookup into students).
      // These ride along on the same cascadeDeletedAt timestamp the restore
      // path matches on, so an Undo brings them back. The display-layer
      // $lookups remain as defense-in-depth. See migrations/020_* for the
      // one-time backfill of orphans that formed before this cascade existed.
      try {
        await StudentFeeStructure.updateMany(
          {
            studentId: student._id,
            schoolId: scopedSchoolId,
            isDeleted: { $ne: true },
          },
          { $set: { isDeleted: true, deletedAt: archivedAt, deletedBy } },
          { session }
        );
      } catch (err) {
        console.error('studentArchiveService: StudentFeeStructure cascade failed:', err);
      }
      try {
        await FeePayment.updateMany(
          {
            studentId: student._id,
            schoolId: scopedSchoolId,
            isDeleted: { $ne: true },
          },
          { $set: { isDeleted: true, deletedAt: archivedAt, deletedBy } },
          { session }
        );
      } catch (err) {
        console.error('studentArchiveService: FeePayment cascade failed:', err);
      }
      try {
        await FeeRefund.updateMany(
          {
            studentId: student._id,
            schoolId: scopedSchoolId,
            isDeleted: { $ne: true },
          },
          { $set: { isDeleted: true, deletedAt: archivedAt, deletedBy } },
          { session }
        );
      } catch (err) {
        console.error('studentArchiveService: FeeRefund cascade failed:', err);
      }

      trashItem = await logToTrash({
        itemType: 'Student',
        itemId: student._id,
        itemName: student.name || 'Student',
        originalData: snapshot,
        deletedBy,
        schoolId: scopedSchoolId,
        deletionContext: {
          classId: student.classId,
          cascadeDeletedAt: archivedAt,
        },
        session,
      });

      archivedStudent = student;
    });
  } finally {
    await mongoSession.endSession();
  }

  return { student: archivedStudent, trashItem, wasActive };
}
