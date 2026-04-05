import express from 'express';
import mongoose from 'mongoose';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import TrashItem from '../models/TrashItem.js';
import { escapeRegex } from './students/helpers.js';
import { permanentlyDeleteStudentData } from '../services/studentDataErasureService.js';
import { ENTITY_REGISTRY } from '../services/trashService.js';

const router = express.Router();
router.use(authenticate);

// ─── Helpers ───

/**
 * Generic restore for a single trash item.
 * Reads restoreStrategy / modelName / softDeleteField from the trash record itself.
 */
async function restoreTrashItem(trashItem) {
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
 * Generic permanent delete for a single trash item.
 */
async function permanentlyDeleteTrashItem(trashItem) {
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

// ─── Routes ───

/**
 * GET /api/trash
 * List all trash items with optional filters, scoped to school
 */
router.get('/', checkPermission('settings', 'view'), async (req, res) => {
  try {
    const { type, search } = req.query;
    const schoolId = req.user?.schoolId;

    const query = { schoolId };

    if (type) {
      query.itemType = type;
    }

    if (search) {
      const searchRegex = new RegExp(escapeRegex(search), 'i');
      query.itemName = searchRegex;
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const [trashItems, total] = await Promise.all([
      TrashItem.find(query)
        .select('-originalData')
        .populate('deletedBy', 'name email')
        .sort({ deletedAt: -1 })
        .limit(limit)
        .skip(skip)
        .lean(),
      TrashItem.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: trashItems,
      total,
      pagination: {
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasMore: page < Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('❌ Get trash items error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: req.t('common:routes.failedToFetchTrashItems'),
    });
  }
});

/**
 * GET /api/trash/stats
 * Get trash statistics by type and expiring items, scoped to school
 */
router.get('/stats', checkPermission('settings', 'view'), async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;

    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    const statsByType = await TrashItem.aggregate([
      { $match: { schoolId: new mongoose.Types.ObjectId(schoolId) } },
      {
        $group: {
          _id: '$itemType',
          count: { $sum: 1 },
          expiringSoon: {
            $sum: {
              $cond: [{ $lte: ['$expiresAt', sevenDaysFromNow] }, 1, 0],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const byType = {};
    let totalExpiring = 0;

    statsByType.forEach((stat) => {
      byType[stat._id] = {
        count: stat.count,
        expiringSoon: stat.expiringSoon,
      };
      totalExpiring += stat.expiringSoon;
    });

    res.json({
      success: true,
      byType,
      totalExpiring,
    });
  } catch (error) {
    console.error('❌ Get trash stats error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: req.t('common:routes.failedToFetchTrashStatistics'),
    });
  }
});

/**
 * POST /api/trash/:trashItemId/restore
 * Restore item from trash
 */
router.post(
  '/:trashItemId/restore',
  checkPermission('settings', 'edit'),
  async (req, res) => {
    try {
      const { trashItemId } = req.params;
      const schoolId = req.user?.schoolId;

      const trashItem = await TrashItem.findOne({ _id: trashItemId, schoolId });

      if (!trashItem) {
        return res.status(404).json({
          success: false,
          error: req.t('common:routes.trashItemNotFound'),
          message: req.t('common:routes.theItemToRestoreDoesNotExist'),
        });
      }

      await restoreTrashItem(trashItem);
      await TrashItem.findByIdAndDelete(trashItemId);

      res.json({
        success: true,
        message: `${trashItem.itemType === 'BulkCleanup' ? trashItem.itemName : trashItem.itemType} restored successfully`,
      });
    } catch (error) {
      console.error('❌ Restore item error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: req.t('common:routes.failedToRestoreItem'),
      });
    }
  }
);

/**
 * DELETE /api/trash/:trashItemId
 * Permanently delete item
 */
router.delete(
  '/:trashItemId',
  checkPermission('settings', 'delete'),
  async (req, res) => {
    try {
      const { trashItemId } = req.params;
      const schoolId = req.user?.schoolId;

      const trashItem = await TrashItem.findOne({ _id: trashItemId, schoolId });

      if (!trashItem) {
        return res.status(404).json({
          success: false,
          error: req.t('common:routes.trashItemNotFound'),
          message: req.t('common:routes.theItemToDeleteDoesNotExist'),
        });
      }

      await permanentlyDeleteTrashItem(trashItem);
      await TrashItem.findByIdAndDelete(trashItemId);

      res.json({
        success: true,
        message: `${trashItem.itemType === 'BulkCleanup' ? trashItem.itemName : trashItem.itemType} permanently deleted`,
      });
    } catch (error) {
      console.error('❌ Permanent delete error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: req.t('common:routes.failedToPermanentlyDeleteItem'),
      });
    }
  }
);

/**
 * POST /api/trash/bulk-restore
 * Bulk restore multiple items
 */
router.post(
  '/bulk-restore',
  checkPermission('settings', 'edit'),
  async (req, res) => {
    try {
      const { trashItemIds } = req.body;
      const schoolId = req.user?.schoolId;

      if (!trashItemIds || !Array.isArray(trashItemIds) || trashItemIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: req.t('common:routes.invalidInput'),
          message: req.t('common:routes.trashItemIdsMustBeANonEmptyArray'),
        });
      }

      const results = await Promise.allSettled(
        trashItemIds.map(async (trashItemId) => {
          const trashItem = await TrashItem.findOne({ _id: trashItemId, schoolId });
          if (!trashItem) throw new Error(`Trash item not found: ${trashItemId}`);

          await restoreTrashItem(trashItem);
          await TrashItem.findByIdAndDelete(trashItemId);

          return {
            trashItemId,
            itemType: trashItem.itemType,
            itemName: trashItem.itemName,
            success: true,
          };
        })
      );

      const restored = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
      const failed = results
        .filter((r) => r.status === 'rejected')
        .map((r, index) => ({
          trashItemId: trashItemIds[index],
          error: r.reason.message,
        }));

      res.json({
        success: true,
        restored,
        failed,
        message: `Restored ${restored.length} items successfully${failed.length > 0 ? `, ${failed.length} failed` : ''}`,
      });
    } catch (error) {
      console.error('❌ Bulk restore error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: req.t('common:routes.failedToBulkRestoreItems'),
      });
    }
  }
);

/**
 * POST /api/trash/bulk-delete
 * Bulk permanent delete
 */
router.post(
  '/bulk-delete',
  checkPermission('settings', 'delete'),
  async (req, res) => {
    try {
      const { trashItemIds } = req.body;
      const schoolId = req.user?.schoolId;

      if (!trashItemIds || !Array.isArray(trashItemIds) || trashItemIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: req.t('common:routes.invalidInput'),
          message: req.t('common:routes.trashItemIdsMustBeANonEmptyArray'),
        });
      }

      const results = await Promise.allSettled(
        trashItemIds.map(async (trashItemId) => {
          const trashItem = await TrashItem.findOne({ _id: trashItemId, schoolId });
          if (!trashItem) throw new Error(`Trash item not found: ${trashItemId}`);

          await permanentlyDeleteTrashItem(trashItem);
          await TrashItem.findByIdAndDelete(trashItemId);

          return {
            trashItemId,
            itemType: trashItem.itemType,
            itemName: trashItem.itemName,
            success: true,
          };
        })
      );

      const deleted = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
      const failed = results
        .filter((r) => r.status === 'rejected')
        .map((r, index) => ({
          trashItemId: trashItemIds[index],
          error: r.reason.message,
        }));

      res.json({
        success: true,
        deleted,
        failed,
        message: `Permanently deleted ${deleted.length} items successfully${failed.length > 0 ? `, ${failed.length} failed` : ''}`,
      });
    } catch (error) {
      console.error('❌ Bulk delete error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: req.t('common:routes.failedToBulkDeleteItems'),
      });
    }
  }
);

export default router;
