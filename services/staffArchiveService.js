import mongoose from 'mongoose';
import { Class, Staff } from '../database.js';
import Session from '../models/Session.js';
import PushToken from '../models/PushToken.js';
import { extractSchoolId } from '../utils/schoolContext.js';
import { logToTrash } from './trashService.js';

export class StaffNotFoundError extends Error {
  constructor() {
    super('Staff not found');
    this.name = 'StaffNotFoundError';
    this.status = 404;
  }
}

/**
 * Reversibly archive a staff account.
 *
 * Durable school records (attendance, leave, payroll, messages, conversations,
 * timetables and permissions) are deliberately preserved. The only related
 * business state changed here is the active class-teacher pointer, which is
 * snapshotted into the trash item and restored atomically by trashService.
 * Login sessions are revoked and push delivery is paused as security controls;
 * old sessions stay revoked after restore and the user must sign in again.
 */
export async function archiveStaff({ staffId, schoolId, deletedBy }) {
  const scopedSchoolId = extractSchoolId(schoolId);
  if (!scopedSchoolId) throw new Error('schoolId is required');
  if (!deletedBy) throw new Error('deletedBy is required');

  const mongoSession = await mongoose.startSession();
  let archivedStaff;
  let trashItem;

  try {
    await mongoSession.withTransaction(async (session) => {
      const staff = await Staff.findOne({
        _id: staffId,
        schoolId: scopedSchoolId,
        isDeleted: { $ne: true },
      }).session(session);

      if (!staff) throw new StaffNotFoundError();

      const snapshot = staff.toObject();
      const assignedClasses = await Class.find({
        schoolId: scopedSchoolId,
        classTeacherId: staff._id,
        isDeleted: { $ne: true },
      })
        .select('_id name section')
        .session(session)
        .lean();
      const archivedAt = new Date();

      staff.isDeleted = true;
      staff.deletedAt = archivedAt;
      staff.deletedBy = deletedBy;
      staff.status = 'inactive';
      staff.isClassTeacher = false;
      staff.classTeacherOf = null;
      staff.tokenVersion = (staff.tokenVersion || 0) + 1;
      await staff.save({ session });

      await Class.updateMany(
        {
          schoolId: scopedSchoolId,
          classTeacherId: staff._id,
          isDeleted: { $ne: true },
        },
        { $unset: { classTeacherId: 1 } },
        { session }
      );

      // Security state is changed without deleting any user-owned records.
      await Promise.all([
        Session.updateMany(
          {
            userId: staff._id,
            schoolId: scopedSchoolId,
            isRevoked: { $ne: true },
          },
          { $set: { isRevoked: true, revokedAt: archivedAt } },
          { session }
        ),
        PushToken.updateMany(
          {
            user: staff._id,
            userModel: 'Staff',
            schoolId: scopedSchoolId,
            isActive: { $ne: false },
          },
          { $set: { isActive: false } },
          { session }
        ),
      ]);

      trashItem = await logToTrash({
        itemType: 'Staff',
        itemId: staff._id,
        itemName: snapshot.name || 'Staff',
        originalData: snapshot,
        deletedBy,
        schoolId: scopedSchoolId,
        deletionContext: {
          assignedClasses: assignedClasses.map((classDoc) => ({
            classId: classDoc._id,
            name: classDoc.name,
            section: classDoc.section,
          })),
        },
        session,
      });

      archivedStaff = staff;
    });
  } finally {
    await mongoSession.endSession();
  }

  return { staff: archivedStaff, trashItem };
}
