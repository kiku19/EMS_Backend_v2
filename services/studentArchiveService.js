import mongoose from 'mongoose';
import { Student, Attendance, Result } from '../database.js';
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
