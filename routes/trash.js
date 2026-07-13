import express from 'express';
import mongoose from 'mongoose';
import { authenticate } from '../middleware/auth.js';
import { checkPermission, userHasPermission } from '../middleware/permissions.js';
import TrashItem from '../models/TrashItem.js';
import { escapeRegex } from './students/helpers.js';
import {
  ENTITY_REGISTRY,
  restoreTrashItem,
  permanentlyDeleteTrashItem,
} from '../services/trashService.js';

const router = express.Router();
router.use(authenticate);

// Map a trash item's originating entity type → the RBAC module that governs it.
// Used so "Undo" (restore) is allowed for whoever could delete the item, not
// only settings managers. Unmapped types fall back to the settings:edit gate.
const TRASH_TYPE_TO_MODULE = Object.freeze({
  Student: 'students',
  Staff: 'staff',
  Class: 'classes',
  Exam: 'academics',
  ExamSchedule: 'academics',
  Result: 'academics',
  Homework: 'homework',
});

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
router.post('/:trashItemId/restore', async (req, res) => {
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

    // Restore is permitted for trash managers (settings:edit) OR for anyone
    // holding the originating module's delete permission — so the "Undo"
    // shown right after a delete works for the same role that deleted it.
    const originModule = TRASH_TYPE_TO_MODULE[trashItem.itemType];
    const allowed =
      (await userHasPermission(req, 'settings', 'edit')) ||
      (originModule && (await userHasPermission(req, originModule, 'delete')));
    if (!allowed) {
      return res.status(403).json({
        success: false,
        error: req.t('common:errors.forbidden'),
        message: req.t('auth:errors.actionPermissionDenied', {
          action: 'restore',
          module: originModule || 'settings',
        }),
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
});

/**
 * DELETE /api/trash/:trashItemId
 * Permanently delete item
 */
router.delete('/:trashItemId', checkPermission('settings', 'delete'), async (req, res) => {
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
});

/**
 * POST /api/trash/bulk-restore
 * Bulk restore multiple items
 */
router.post('/bulk-restore', checkPermission('settings', 'edit'), async (req, res) => {
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
});

/**
 * POST /api/trash/bulk-delete
 * Bulk permanent delete
 */
router.post('/bulk-delete', checkPermission('settings', 'delete'), async (req, res) => {
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
});

export default router;
