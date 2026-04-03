/**
 * Centralized Trash Service
 * Provides a single logToTrash() function that every delete route calls.
 * Uses an ENTITY_REGISTRY to map entity types to their Mongoose model names,
 * restore strategies, and display name fields.
 */

import TrashItem from '../models/TrashItem.js';

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
  expiresAt.setDate(expiresAt.getDate() + 30);

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
