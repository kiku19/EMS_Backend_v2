/**
 * Centralized Trash Service
 * Provides a single logToTrash() function that every delete route calls.
 * Uses an ENTITY_REGISTRY to map entity types to their Mongoose model names,
 * restore strategies, and display name fields.
 */

import mongoose from 'mongoose';
import TrashItem from '../models/TrashItem.js';
import { permanentlyDeleteStudentData } from './studentDataErasureService.js';

// How long deleted items stay restorable before the TTL index on expiresAt
// permanently purges them. Applies to both school self-restore and super-admin
// cross-school restore. Bumped from 30 → 60 days.
export const TRASH_RETENTION_DAYS = 60;

/**
 * Entity Registry — single source of truth for all trashable entity types.
 *
 * restoreStrategy:
 *   'soft-delete'  → restore by flipping the soft-delete field back
 *   'hard-delete'  → restore by re-inserting originalData via Model.create()
 *
 * softDeleteField:
 *   The field name used for soft deletion (default: 'isDeleted').
 *   For entities using 'isActive', set to 'isActive'.
 *
 * softDeleteRestore:
 *   The value to set on restore. For 'isDeleted' fields → false, for 'isActive' → true.
 */
export const ENTITY_REGISTRY = {
  // ── Core ──
  Student: {
    modelName: 'Student',
    restoreStrategy: 'soft-delete',
    softDeleteField: 'isDeleted',
    softDeleteRestore: false,
    displayNameField: 'name',
  },
  Staff: {
    modelName: 'Staff',
    restoreStrategy: 'soft-delete',
    softDeleteField: 'isDeleted',
    softDeleteRestore: false,
    displayNameField: 'name',
  },
  Class: {
    modelName: 'Class',
    restoreStrategy: 'soft-delete',
    softDeleteField: 'isDeleted',
    softDeleteRestore: false,
    displayNameField: 'name',
  },

  // ── Academic ──
  Exam: {
    modelName: 'Exam',
    restoreStrategy: 'soft-delete',
    softDeleteField: 'isDeleted',
    softDeleteRestore: false,
    displayNameField: 'name',
  },
  ExamSchedule: {
    modelName: 'ExamSchedule',
    restoreStrategy: 'soft-delete',
    softDeleteField: 'isDeleted',
    softDeleteRestore: false,
    displayNameField: 'name',
  },
  Homework: {
    modelName: 'Homework',
    restoreStrategy: 'soft-delete',
    softDeleteField: 'isDeleted',
    softDeleteRestore: false,
    displayNameField: 'title',
  },
  CBSEReportCard: {
    modelName: 'CBSEReportCard',
    restoreStrategy: 'soft-delete',
    softDeleteField: 'isDeleted',
    softDeleteRestore: false,
    displayNameField: 'name',
  },
  CCEConfig: {
    modelName: 'CCEConfig',
    restoreStrategy: 'soft-delete',
    softDeleteField: 'isDeleted',
    softDeleteRestore: false,
    displayNameField: 'academicYear',
  },

  // ── Fees ──
  FeeHead: {
    modelName: 'FeeHead',
    restoreStrategy: 'hard-delete',
    displayNameField: 'name',
  },
  FeeTemplate: {
    modelName: 'FeeTemplate',
    restoreStrategy: 'hard-delete',
    displayNameField: 'name',
  },
  FeeRefund: {
    modelName: 'FeeRefund',
    restoreStrategy: 'hard-delete',
    displayNameField: 'refundId',
  },
  FeeRule: {
    modelName: 'FeeRule',
    restoreStrategy: 'hard-delete',
    displayNameField: 'name',
  },
  // Student financial dependents. They are NOT independently trashable — they
  // ride along with the Student: archiveStudent() soft-deletes them (they now
  // carry isDeleted/deletedAt/deletedBy), and restoreTrashItem()'s Student
  // branch flips them back via the cascadeDeletedAt match. The 'hard-delete'
  // restoreStrategy below only governs the PERMANENT-purge path:
  // permanentlyDeleteTrashItem() snapshots each dependent to trash before the
  // GDPR erasure hard-deletes them, so an operator can still recover fee data
  // via re-insert even after the Student record itself is gone.
  StudentFeeStructure: {
    modelName: 'StudentFeeStructure',
    restoreStrategy: 'hard-delete',
    displayNameField: 'academicYear',
  },
  FeePayment: {
    modelName: 'FeePayment',
    restoreStrategy: 'hard-delete',
    displayNameField: 'receiptNumber',
  },
  Remark: {
    modelName: 'Remark',
    restoreStrategy: 'hard-delete',
    displayNameField: 'text',
  },

  // ── Operations ──
  Announcement: {
    modelName: 'Announcement',
    restoreStrategy: 'soft-delete',
    softDeleteField: 'isDeleted',
    softDeleteRestore: false,
    displayNameField: 'title',
  },
  // ── Front Desk ──
  Admission: {
    modelName: 'Admission',
    restoreStrategy: 'hard-delete',
    displayNameField: 'studentName',
  },
  CallLog: {
    modelName: 'CallLog',
    restoreStrategy: 'hard-delete',
    displayNameField: 'callerName',
  },
  Feedback: {
    modelName: 'Feedback',
    restoreStrategy: 'hard-delete',
    displayNameField: 'name',
  },
  Appointment: {
    modelName: 'Appointment',
    restoreStrategy: 'hard-delete',
    displayNameField: 'visitorName',
  },
  GatePass: {
    modelName: 'GatePass',
    restoreStrategy: 'hard-delete',
    displayNameField: 'studentName',
  },
  Visitor: {
    modelName: 'Visitor',
    restoreStrategy: 'hard-delete',
    displayNameField: 'name',
  },

  // ── Inventory ──
  Asset: {
    modelName: 'Asset',
    restoreStrategy: 'soft-delete',
    softDeleteField: 'isDeleted',
    softDeleteRestore: false,
    displayNameField: 'name',
  },
  AssetCategory: {
    modelName: 'AssetCategory',
    restoreStrategy: 'soft-delete',
    softDeleteField: 'isDeleted',
    softDeleteRestore: false,
    displayNameField: 'name',
  },
  Vendor: {
    modelName: 'Vendor',
    restoreStrategy: 'soft-delete',
    softDeleteField: 'isDeleted',
    softDeleteRestore: false,
    displayNameField: 'name',
  },
  MaintenanceLog: {
    modelName: 'MaintenanceLog',
    restoreStrategy: 'soft-delete',
    softDeleteField: 'isDeleted',
    softDeleteRestore: false,
    displayNameField: 'description',
  },
  ProcurementRequest: {
    modelName: 'ProcurementRequest',
    restoreStrategy: 'soft-delete',
    softDeleteField: 'isDeleted',
    softDeleteRestore: false,
    displayNameField: 'itemName',
  },
  AssetAudit: {
    modelName: 'AssetAudit',
    restoreStrategy: 'soft-delete',
    softDeleteField: 'isDeleted',
    softDeleteRestore: false,
    displayNameField: 'name',
  },

  // ── Hostel ──
  Hostel: {
    modelName: 'Hostel',
    restoreStrategy: 'soft-delete',
    softDeleteField: 'isActive',
    softDeleteRestore: true,
    displayNameField: 'name',
  },
  HostelRoom: {
    modelName: 'HostelRoom',
    restoreStrategy: 'soft-delete',
    softDeleteField: 'isActive',
    softDeleteRestore: true,
    displayNameField: 'roomNumber',
  },

  // ── Transport ──
  TransportRoute: {
    modelName: 'TransportRoute',
    restoreStrategy: 'soft-delete',
    softDeleteField: 'isDeleted',
    softDeleteRestore: false,
    displayNameField: 'routeName',
  },
  Vehicle: {
    modelName: 'Vehicle',
    restoreStrategy: 'soft-delete',
    softDeleteField: 'isDeleted',
    softDeleteRestore: false,
    displayNameField: 'registrationNumber',
  },

  // ── Library ──
  Book: {
    modelName: 'Book',
    restoreStrategy: 'soft-delete',
    softDeleteField: 'isActive',
    softDeleteRestore: true,
    displayNameField: 'title',
  },

  // ── Intake Forms ──
  IntakeForm: {
    modelName: 'IntakeForm',
    restoreStrategy: 'hard-delete',
    displayNameField: 'formName',
  },
  FormAssignment: {
    modelName: 'FormAssignment',
    restoreStrategy: 'hard-delete',
    displayNameField: 'formName',
  },
  FormSubmission: {
    modelName: 'FormSubmission',
    restoreStrategy: 'hard-delete',
    displayNameField: 'submitterName',
  },

  // ── Communication ──
  EmailCampaign: {
    modelName: 'EmailCampaign',
    restoreStrategy: 'hard-delete',
    displayNameField: 'subject',
  },

  // ── Other ──
  Coupon: {
    modelName: 'Coupon',
    restoreStrategy: 'hard-delete',
    displayNameField: 'code',
  },
  Changelog: {
    modelName: 'Changelog',
    restoreStrategy: 'hard-delete',
    displayNameField: 'title',
  },

  // ── Bulk Cleanup (existing) ──
  BulkCleanup: {
    modelName: null,
    restoreStrategy: 'hard-delete',
    displayNameField: 'itemName',
  },
};

/**
 * Get the full entity registry (used by trash routes and cleanup service).
 */
export function getEntityRegistry() {
  return ENTITY_REGISTRY;
}

/**
 * Check if an entity type is valid (exists in registry).
 */
export function isValidEntityType(itemType) {
  return itemType in ENTITY_REGISTRY;
}

/**
 * Log a deleted item to the trash.
 * This is fire-and-forget — callers should .catch(() => {}) so trash failures
 * never block the actual delete operation.
 *
 * @param {Object} opts
 * @param {string} opts.itemType - Entity type key from ENTITY_REGISTRY
 * @param {ObjectId|string} opts.itemId - The _id of the deleted document
 * @param {string} opts.itemName - Human-readable name for display in trash UI
 * @param {Object} opts.originalData - Full snapshot of the document before deletion
 * @param {ObjectId|string} opts.deletedBy - The user who performed the delete
 * @param {ObjectId|string} opts.schoolId - School ID for multi-tenancy scoping
 * @param {Object} [opts.deletionContext] - Optional context (relatedItems, classId, etc.)
 * @param {Object} [opts.bulkCleanup] - Optional bulk cleanup metadata
 */
export async function logToTrash({
  itemType,
  itemId,
  itemName,
  originalData,
  deletedBy,
  schoolId,
  deletionContext,
  bulkCleanup,
  session,
}) {
  const registry = ENTITY_REGISTRY[itemType];
  if (!registry) {
    console.warn(`[TrashService] Unknown item type: ${itemType}, skipping trash log`);
    return null;
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + TRASH_RETENTION_DAYS);

  const payload = {
    itemType,
    itemId,
    itemName: itemName || 'Unknown',
    originalData,
    deletedBy,
    deletedAt: new Date(),
    expiresAt,
    schoolId,
    restoreStrategy: registry.restoreStrategy,
    modelName: registry.modelName,
    softDeleteField: registry.softDeleteField || 'isDeleted',
    deletionContext,
    bulkCleanup,
  };

  if (session) {
    const [trashItem] = await TrashItem.create([payload], { session });
    return trashItem;
  }

  return TrashItem.create(payload);
}

/**
 * Generic restore for a single trash item.
 * Reads restoreStrategy / modelName / softDeleteField from the trash record itself.
 * Shared by the school-scoped trash routes and the super-admin cross-school routes.
 */
export async function restoreTrashItem(trashItem) {
  const { itemType, restoreStrategy, modelName, softDeleteField, itemId, originalData } = trashItem;

  // BulkCleanup has its own restore path
  if (itemType === 'BulkCleanup') {
    const bulkModelName = trashItem.bulkCleanup?.modelName;
    if (!bulkModelName) throw new Error('BulkCleanup missing modelName');
    const Model = mongoose.model(bulkModelName);
    const documents = originalData;
    if (documents && documents.length > 0) {
      await Model.insertMany(documents, { ordered: false });
    }
    return;
  }

  if (!modelName) throw new Error(`No modelName on trash item ${trashItem._id}`);
  const Model = mongoose.model(modelName);

  if (restoreStrategy === 'soft-delete') {
    const field = softDeleteField || 'isDeleted';
    // For isActive fields, restore means setting to true; for isDeleted, setting to false
    const registryEntry = ENTITY_REGISTRY[itemType];
    const restoreValue =
      registryEntry?.softDeleteRestore !== undefined ? registryEntry.softDeleteRestore : false;

    const updateFields = { [field]: restoreValue, deletedAt: null, deletedBy: null };

    // For isActive-based entities, don't clear deletedAt/deletedBy (they don't have those)
    if (field === 'isActive') {
      delete updateFields.deletedAt;
      delete updateFields.deletedBy;
    }

    // Restore the pre-delete `status`. Soft-delete routes flip `status` to
    // 'inactive' alongside `isDeleted` (see students/staff delete handlers), but
    // clearing only `isDeleted` on restore left the record `status: 'inactive'`
    // — invisible in the default "Active" list tab, so an "undo" appeared to do
    // nothing. `originalData` is snapshotted BEFORE the delete mutation, so it
    // carries the correct prior value.
    if (originalData && typeof originalData === 'object' && originalData.status !== undefined) {
      updateFields.status = originalData.status;
    }

    if (itemType === 'ExamSchedule') {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const restored = await Model.findOneAndUpdate(
            { _id: itemId, schoolId: trashItem.schoolId, isDeleted: true },
            { $set: updateFields },
            { new: true, session }
          );
          if (!restored) throw new Error('Exam schedule is no longer available to restore');

          const cascadeDeletedAt = trashItem.deletionContext?.cascadeDeletedAt;
          const generatedExamIds = originalData?.generatedExamIds || [];
          if (cascadeDeletedAt && generatedExamIds.length > 0) {
            const Exam = mongoose.model('Exam');
            const Result = mongoose.model('Result');
            const cascadeFilter = {
              schoolId: trashItem.schoolId,
              isDeleted: true,
              deletedAt: cascadeDeletedAt,
            };
            await Exam.updateMany(
              { ...cascadeFilter, _id: { $in: generatedExamIds }, examScheduleId: itemId },
              { $set: { isDeleted: false, deletedAt: null } },
              { session }
            );
            await Result.updateMany(
              { ...cascadeFilter, examId: { $in: generatedExamIds } },
              { $set: { isDeleted: false, deletedAt: null } },
              { session }
            );
          }
        });
      } finally {
        await session.endSession();
      }
      return;
    }

    if (itemType === 'Exam') {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const restored = await Model.findOneAndUpdate(
            { _id: itemId, schoolId: trashItem.schoolId, isDeleted: true },
            { $set: updateFields },
            { new: true, session }
          );
          if (!restored) throw new Error('Exam is no longer available to restore');

          const cascadeDeletedAt = trashItem.deletionContext?.cascadeDeletedAt;
          if (cascadeDeletedAt) {
            const Result = mongoose.model('Result');
            await Result.updateMany(
              {
                examId: itemId,
                schoolId: trashItem.schoolId,
                isDeleted: true,
                deletedAt: cascadeDeletedAt,
              },
              { $set: { isDeleted: false, deletedAt: null } },
              { session }
            );
          }

          // Deletion removes the generated-exam backlink from its originating
          // schedule. Recreate only that snapshotted relationship on restore.
          if (originalData?.examScheduleId && mongoose.models.ExamSchedule) {
            const ExamSchedule = mongoose.model('ExamSchedule');
            await ExamSchedule.updateOne(
              { _id: originalData.examScheduleId, schoolId: trashItem.schoolId },
              { $addToSet: { generatedExamIds: itemId } },
              { session }
            );
          }
        });
      } finally {
        await session.endSession();
      }
      return;
    }

    if (itemType === 'Class') {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const teacherId = originalData?.classTeacherId;
          if (teacherId) {
            const Class = mongoose.model('Class');
            const Staff = mongoose.model('Staff');
            const teacher = await Staff.findOne({
              _id: teacherId,
              schoolId: trashItem.schoolId,
            }).session(session);
            const conflictingClass = await Class.findOne({
              _id: { $ne: itemId },
              schoolId: trashItem.schoolId,
              classTeacherId: teacherId,
              isDeleted: { $ne: true },
            }).session(session);
            if (!teacher) throw new Error('Original class teacher is no longer available');
            if (conflictingClass) {
              throw new Error('Original class teacher is now assigned to another class');
            }
            await Staff.updateOne(
              { _id: teacherId, schoolId: trashItem.schoolId },
              {
                $set: {
                  classTeacherOf: `${originalData.name}-${originalData.section}`,
                  isClassTeacher: true,
                },
              },
              { session }
            );
          }

          const restored = await Model.findOneAndUpdate(
            { _id: itemId, schoolId: trashItem.schoolId, isDeleted: true },
            { $set: updateFields },
            { new: true, session }
          );
          if (!restored) throw new Error('Class is no longer available to restore');
        });
      } finally {
        await session.endSession();
      }
      return;
    }

    if (itemType === 'Staff') {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const Staff = mongoose.model('Staff');
          const Class = mongoose.model('Class');
          const PushToken = mongoose.model('PushToken');
          const assignments = trashItem.deletionContext?.assignedClasses || [];

          for (const assignment of assignments) {
            const classDoc = await Class.findOne({
              _id: assignment.classId,
              schoolId: trashItem.schoolId,
              isDeleted: { $ne: true },
            }).session(session);
            if (!classDoc) {
              throw new Error(
                `Original class ${assignment.name || ''}-${assignment.section || ''} is no longer available`
              );
            }
            if (classDoc.classTeacherId && String(classDoc.classTeacherId) !== String(itemId)) {
              throw new Error(
                `Original class ${classDoc.name}-${classDoc.section} now has another class teacher`
              );
            }
          }

          const restored = await Staff.findOneAndUpdate(
            { _id: itemId, schoolId: trashItem.schoolId, isDeleted: true },
            {
              $set: {
                ...updateFields,
                isClassTeacher: Boolean(originalData?.isClassTeacher && assignments.length > 0),
                classTeacherOf:
                  originalData?.isClassTeacher && assignments.length > 0
                    ? originalData.classTeacherOf
                    : null,
              },
            },
            { new: true, session }
          );
          if (!restored) throw new Error('Staff member is no longer available to restore');

          for (const assignment of assignments) {
            await Class.updateOne(
              {
                _id: assignment.classId,
                schoolId: trashItem.schoolId,
                isDeleted: { $ne: true },
              },
              { $set: { classTeacherId: itemId } },
              { session }
            );
          }

          // Push delivery was paused on archive. Restoring the account may
          // safely reactivate registered devices; revoked login sessions stay
          // revoked so the user must authenticate again.
          await PushToken.updateMany(
            { user: itemId, userModel: 'Staff', schoolId: trashItem.schoolId },
            { $set: { isActive: true } },
            { session }
          );
          await TrashItem.deleteOne(
            { _id: trashItem._id, schoolId: trashItem.schoolId },
            { session }
          );
        });
      } finally {
        await session.endSession();
      }
      return;
    }

    if (itemType === 'Student') {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const restored = await Model.findOneAndUpdate(
            { _id: itemId, schoolId: trashItem.schoolId, isDeleted: true },
            { $set: updateFields },
            { new: true, session }
          );
          if (!restored) throw new Error('Student is no longer available to restore');

          const cascadeDeletedAt = trashItem.deletionContext?.cascadeDeletedAt;
          if (cascadeDeletedAt) {
            const cascadeFilter = {
              studentId: itemId,
              schoolId: trashItem.schoolId,
              isDeleted: true,
              deletedAt: cascadeDeletedAt,
            };
            const Attendance = mongoose.model('Attendance');
            const Result = mongoose.model('Result');
            await Attendance.updateMany(
              cascadeFilter,
              { $set: { isDeleted: false, deletedAt: null, deletedBy: null } },
              { session }
            );
            await Result.updateMany(
              cascadeFilter,
              { $set: { isDeleted: false, deletedAt: null } },
              { session }
            );
            // Remark is cascade soft-deleted alongside Attendance/Result in
            // studentArchiveService (it carries isDeleted + deletedAt), so
            // un-delete it here too — otherwise restoring a Student left its
            // historical behaviour/notes remarks hidden.
            if (mongoose.models.Remark) {
              const Remark = mongoose.model('Remark');
              await Remark.updateMany(
                cascadeFilter,
                { $set: { isDeleted: false, deletedAt: null, deletedBy: null } },
                { session }
              );
            }
            // StudentFeeStructure / FeePayment / FeeRefund are cascade
            // soft-deleted in studentArchiveService using the same
            // cascadeDeletedAt timestamp, so restore them here too. Without
            // this, archive+undo would permanently hide the student's fee
            // history even though the Student itself came back.
            if (mongoose.models.StudentFeeStructure) {
              await mongoose
                .model('StudentFeeStructure')
                .updateMany(
                  cascadeFilter,
                  { $set: { isDeleted: false, deletedAt: null, deletedBy: null } },
                  { session }
                );
            }
            if (mongoose.models.FeePayment) {
              await mongoose
                .model('FeePayment')
                .updateMany(
                  cascadeFilter,
                  { $set: { isDeleted: false, deletedAt: null, deletedBy: null } },
                  { session }
                );
            }
            if (mongoose.models.FeeRefund) {
              await mongoose
                .model('FeeRefund')
                .updateMany(
                  cascadeFilter,
                  { $set: { isDeleted: false, deletedAt: null, deletedBy: null } },
                  { session }
                );
            }
          }
        });
      } finally {
        await session.endSession();
      }
      return;
    }

    await Model.findOneAndUpdate(
      { _id: itemId, schoolId: trashItem.schoolId },
      { $set: updateFields }
    );
  } else {
    // hard-delete restore: re-insert the original document
    if (!originalData || typeof originalData !== 'object') {
      throw new Error(`Cannot restore ${itemType}: original data is missing or invalid`);
    }

    // Try with _id first to preserve references, fall back to without _id on duplicate key
    try {
      await Model.create(originalData);
    } catch (err) {
      if (err.code === 11000) {
        const { _id, ...dataWithoutId } = originalData;
        await Model.create(dataWithoutId);
      } else {
        throw err;
      }
    }
  }
}

/**
 * Generic permanent delete for a single trash item (purges the source document).
 * Shared by school + super-admin routes.
 */
export async function permanentlyDeleteTrashItem(trashItem) {
  const { itemType, modelName, restoreStrategy, itemId, schoolId, originalData } = trashItem;

  // Student has special GDPR-compliant cascading erasure
  if (itemType === 'Student') {
    // Before the GDPR erasure hard-deletes the Student's financial and
    // behavioural dependents, snapshot each one to the trash as an itemized,
    // individually-restorable entry. permanentlyDeleteStudentData() wipes
    // StudentFeeStructure / FeePayment / Remark forever (no soft-delete, no
    // backup), so without this step a permanent-delete was a one-way door with
    // zero recovery. Logging them here gives operators the same 60-day restore
    // window the rest of the trash provides.
    //
    // Each dependent is logged under its own ENTITY_REGISTRY key so restore
    // uses the right strategy (these are hard-delete restores — re-insert from
    // the snapshot). Best-effort: a logging failure must NOT abort the
    // permanent delete the operator already confirmed, so swallow + log.
    try {
      const cascadeDeletedBy = trashItem.deletedBy;
      const cascadeSchoolId = schoolId || trashItem.schoolId;

      if (mongoose.models.StudentFeeStructure) {
        const StudentFeeStructure = mongoose.model('StudentFeeStructure');
        const feeStructures = await StudentFeeStructure.find({
          studentId: itemId,
          schoolId: cascadeSchoolId,
        }).lean();
        for (const fs of feeStructures) {
          await logToTrash({
            itemType: 'StudentFeeStructure',
            itemId: fs._id,
            itemName: `Fee structure (${fs.academicYear || 'n/a'})`,
            originalData: fs,
            deletedBy: cascadeDeletedBy,
            schoolId: cascadeSchoolId,
            deletionContext: { studentId: itemId, source: 'student-permanent-delete' },
          }).catch((err) =>
            console.error('[TrashService] log StudentFeeStructure before purge failed:', err)
          );
        }
      }

      if (mongoose.models.FeePayment) {
        const FeePayment = mongoose.model('FeePayment');
        const payments = await FeePayment.find({
          studentId: itemId,
          schoolId: cascadeSchoolId,
        }).lean();
        for (const pmt of payments) {
          await logToTrash({
            itemType: 'FeePayment',
            itemId: pmt._id,
            itemName: `Fee payment (${pmt.receiptNumber || pmt._id})`,
            originalData: pmt,
            deletedBy: cascadeDeletedBy,
            schoolId: cascadeSchoolId,
            deletionContext: { studentId: itemId, source: 'student-permanent-delete' },
          }).catch((err) =>
            console.error('[TrashService] log FeePayment before purge failed:', err)
          );
        }
      }

      if (mongoose.models.Remark) {
        const Remark = mongoose.model('Remark');
        const remarks = await Remark.find({
          studentId: itemId,
          schoolId: cascadeSchoolId,
        }).lean();
        for (const rmk of remarks) {
          await logToTrash({
            itemType: 'Remark',
            itemId: rmk._id,
            itemName: rmk.text ? String(rmk.text).slice(0, 60) : 'Remark',
            originalData: rmk,
            deletedBy: cascadeDeletedBy,
            schoolId: cascadeSchoolId,
            deletionContext: { studentId: itemId, source: 'student-permanent-delete' },
          }).catch((err) => console.error('[TrashService] log Remark before purge failed:', err));
        }
      }
    } catch (snapshotError) {
      console.error(
        '[TrashService] itemized dependent logging before Student purge failed:',
        snapshotError
      );
    }

    await permanentlyDeleteStudentData(itemId);
    return;
  }

  // BulkCleanup — data already deleted from source, nothing to do
  if (itemType === 'BulkCleanup') return;

  if (itemType === 'Exam' || itemType === 'ExamSchedule') {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const Exam = mongoose.model('Exam');
        const Result = mongoose.model('Result');
        const ExamSchedule = mongoose.model('ExamSchedule');

        if (itemType === 'Exam') {
          await Result.deleteMany({ examId: itemId, schoolId }, { session });
          await ExamSchedule.updateMany(
            { schoolId, generatedExamIds: itemId },
            { $pull: { generatedExamIds: itemId } },
            { session }
          );
          await Exam.deleteOne({ _id: itemId, schoolId }, { session });
          return;
        }

        const generatedExamIds = originalData?.generatedExamIds || [];
        if (generatedExamIds.length > 0) {
          await Result.deleteMany({ schoolId, examId: { $in: generatedExamIds } }, { session });
          await Exam.deleteMany(
            { schoolId, _id: { $in: generatedExamIds }, examScheduleId: itemId },
            { session }
          );
        }
        await ExamSchedule.deleteOne({ _id: itemId, schoolId }, { session });
      });
    } finally {
      await session.endSession();
    }
    return;
  }

  // For soft-deleted items, the document still exists — hard-delete it now
  if (restoreStrategy === 'soft-delete' && modelName) {
    const Model = mongoose.model(modelName);
    await Model.findOneAndDelete({ _id: itemId, schoolId });
  }
  // For hard-deleted items, the document is already gone — nothing to do
}
