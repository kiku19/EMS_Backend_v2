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
}) {
  const registry = ENTITY_REGISTRY[itemType];
  if (!registry) {
    console.warn(`[TrashService] Unknown item type: ${itemType}, skipping trash log`);
    return null;
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + TRASH_RETENTION_DAYS);

  return TrashItem.create({
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
  });
}

/**
 * Generic restore for a single trash item.
 * Reads restoreStrategy / modelName / softDeleteField from the trash record itself.
 * Shared by the school-scoped trash routes and the super-admin cross-school routes.
 */
export async function restoreTrashItem(trashItem) {
  const { itemType, restoreStrategy, modelName, softDeleteField, itemId, originalData } =
    trashItem;

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

    await Model.findByIdAndUpdate(itemId, { $set: updateFields });
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
  const { itemType, modelName, restoreStrategy, itemId } = trashItem;

  // Student has special GDPR-compliant cascading erasure
  if (itemType === 'Student') {
    await permanentlyDeleteStudentData(itemId);
    return;
  }

  // BulkCleanup — data already deleted from source, nothing to do
  if (itemType === 'BulkCleanup') return;

  // For soft-deleted items, the document still exists — hard-delete it now
  if (restoreStrategy === 'soft-delete' && modelName) {
    const Model = mongoose.model(modelName);
    await Model.findByIdAndDelete(itemId);
  }
  // For hard-deleted items, the document is already gone — nothing to do
}
