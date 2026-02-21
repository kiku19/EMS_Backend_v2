import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { Student, Staff, Class } from '../database.js';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import TrashItem from '../models/TrashItem.js';

const router = express.Router();

/**
 * GET /api/trash
 * List all trash items with optional filters
 * Query params: type (filter by itemType), search (search itemName)
 */
router.get('/', authenticate, checkPermission('settings', 'view'), async (req, res) => {
  try {
    console.log('🗑️ Fetching trash items...');
    const { type, search } = req.query;

    // Build query
    const query = {};

    // Type filter
    if (type) {
      query.itemType = type;
      console.log(`🔍 Filtering by type: ${type}`);
    }

    // Search filter
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query.itemName = searchRegex;
      console.log(`🔍 Searching for: ${search}`);
    }

    // Execute query with pagination - EXCLUDE originalData for performance
    // originalData is only needed for restore, not for listing
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;
    
    const [trashItems, total] = await Promise.all([
      TrashItem.find(query)
        .select('-originalData') // Exclude large originalData field
        .populate('deletedBy', 'name email')
        .sort({ deletedAt: -1 })
        .limit(limit)
        .skip(skip)
        .lean(), // Use lean() for better performance
      TrashItem.countDocuments(query)
    ]);
    
    console.log(`✅ Found ${trashItems.length} trash items (page ${page}, total: ${total})`);

    res.json({
      success: true,
      data: trashItems,
      total,
      pagination: {
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasMore: page < Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('❌ Get trash items error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to fetch trash items'
    });
  }
});

/**
 * GET /api/trash/stats
 * Get trash statistics by type and expiring items
 */
router.get('/stats', authenticate, checkPermission('settings', 'view'), async (req, res) => {
  try {
    console.log('📊 Calculating trash statistics...');

    // Calculate date 7 days from now
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    // Aggregate by itemType
    const statsByType = await TrashItem.aggregate([
      {
        $group: {
          _id: '$itemType',
          count: { $sum: 1 },
          expiringSoon: {
            $sum: {
              $cond: [
                { $lte: ['$expiresAt', sevenDaysFromNow] },
                1,
                0
              ]
            }
          }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    // Format result
    const byType = {};
    let totalExpiring = 0;

    statsByType.forEach(stat => {
      byType[stat._id] = {
        count: stat.count,
        expiringSoon: stat.expiringSoon
      };
      totalExpiring += stat.expiringSoon;
    });

    console.log(`✅ Total items expiring within 7 days: ${totalExpiring}`);

    res.json({
      success: true,
      byType,
      totalExpiring
    });
  } catch (error) {
    console.error('❌ Get trash stats error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to fetch trash statistics'
    });
  }
});

/**
 * POST /api/trash/:trashItemId/restore
 * Restore item from trash
 */
router.post('/:trashItemId/restore', authenticate, checkPermission('settings', 'edit'), async (req, res) => {
  try {
    const { trashItemId } = req.params;
    console.log(`♻️ Restoring trash item: ${trashItemId}`);

    // Find trash item
    const trashItem = await TrashItem.findById(trashItemId);

    if (!trashItem) {
      console.warn(`⚠️ Trash item not found: ${trashItemId}`);
      return res.status(404).json({
        success: false,
        error: 'Trash item not found',
        message: 'The item to restore does not exist'
      });
    }

    console.log(`📦 Restoring ${trashItem.itemType}: ${trashItem.itemName}`);

    // Restore based on item type
    switch (trashItem.itemType) {
      case 'Student':
        await Student.findByIdAndUpdate(trashItem.itemId, {
          isDeleted: false,
          deletedAt: null,
          deletedBy: null
        });
        console.log(`✅ Student restored: ${trashItem.itemId}`);
        break;

      case 'Staff':
        await Staff.findByIdAndUpdate(trashItem.itemId, {
          isDeleted: false,
          deletedAt: null,
          deletedBy: null
        });
        console.log(`✅ Staff restored: ${trashItem.itemId}`);
        break;

      case 'Class':
        await Class.findByIdAndUpdate(trashItem.itemId, {
          isDeleted: false,
          deletedAt: null,
          deletedBy: null
        });
        console.log(`✅ Class restored: ${trashItem.itemId}`);
        break;

      default:
        console.warn(`⚠️ Unknown item type: ${trashItem.itemType}`);
        return res.status(400).json({
          success: false,
          error: 'Unknown item type',
          message: `Cannot restore item of type: ${trashItem.itemType}`
        });
    }

    // Delete the trash item record
    await TrashItem.findByIdAndDelete(trashItemId);
    console.log(`🗑️ Trash item record deleted: ${trashItemId}`);

    res.json({
      success: true,
      message: `${trashItem.itemType} restored successfully`
    });
  } catch (error) {
    console.error('❌ Restore item error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to restore item'
    });
  }
});

/**
 * DELETE /api/trash/:trashItemId
 * Permanently delete item
 */
router.delete('/:trashItemId', authenticate, checkPermission('settings', 'delete'), async (req, res) => {
  try {
    const { trashItemId } = req.params;
    console.log(`🔥 Permanently deleting trash item: ${trashItemId}`);

    // Find trash item
    const trashItem = await TrashItem.findById(trashItemId);

    if (!trashItem) {
      console.warn(`⚠️ Trash item not found: ${trashItemId}`);
      return res.status(404).json({
        success: false,
        error: 'Trash item not found',
        message: 'The item to delete does not exist'
      });
    }

    console.log(`🔥 Permanently deleting ${trashItem.itemType}: ${trashItem.itemName}`);

    // Delete based on item type
    switch (trashItem.itemType) {
      case 'Student':
        // First delete related StudentFeeStructure records
        await StudentFeeStructure.deleteMany({ studentId: trashItem.itemId });
        console.log(`✅ StudentFeeStructure records deleted for student: ${trashItem.itemId}`);

        // Then delete the student
        await Student.findByIdAndDelete(trashItem.itemId);
        console.log(`✅ Student permanently deleted: ${trashItem.itemId}`);
        break;

      case 'Staff':
        // Delete the staff
        await Staff.findByIdAndDelete(trashItem.itemId);
        console.log(`✅ Staff permanently deleted: ${trashItem.itemId}`);
        break;

      case 'Class':
        // Delete the class
        await Class.findByIdAndDelete(trashItem.itemId);
        console.log(`✅ Class permanently deleted: ${trashItem.itemId}`);
        break;

      default:
        console.warn(`⚠️ Unknown item type: ${trashItem.itemType}`);
        return res.status(400).json({
          success: false,
          error: 'Unknown item type',
          message: `Cannot permanently delete item of type: ${trashItem.itemType}`
        });
    }

    // Delete the trash item record
    await TrashItem.findByIdAndDelete(trashItemId);
    console.log(`🗑️ Trash item record deleted: ${trashItemId}`);

    res.json({
      success: true,
      message: `${trashItem.itemType} permanently deleted`
    });
  } catch (error) {
    console.error('❌ Permanent delete error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to permanently delete item'
    });
  }
});

/**
 * POST /api/trash/bulk-restore
 * Bulk restore multiple items
 * Body: { trashItemIds: [] }
 */
router.post('/bulk-restore', authenticate, checkPermission('settings', 'edit'), async (req, res) => {
  try {
    const { trashItemIds } = req.body;

    if (!trashItemIds || !Array.isArray(trashItemIds) || trashItemIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid input',
        message: 'trashItemIds must be a non-empty array'
      });
    }

    console.log(`♻️ Bulk restoring ${trashItemIds.length} items...`);

    // Process all items in parallel
    const results = await Promise.allSettled(
      trashItemIds.map(async (trashItemId) => {
        console.log(`♻️ Processing: ${trashItemId}`);

        // Find trash item
        const trashItem = await TrashItem.findById(trashItemId);

        if (!trashItem) {
          throw new Error(`Trash item not found: ${trashItemId}`);
        }

        // Restore based on item type
        switch (trashItem.itemType) {
          case 'Student':
            await Student.findByIdAndUpdate(trashItem.itemId, {
              isDeleted: false,
              deletedAt: null,
              deletedBy: null
            });
            break;

          case 'Staff':
            await Staff.findByIdAndUpdate(trashItem.itemId, {
              isDeleted: false,
              deletedAt: null,
              deletedBy: null
            });
            break;

          case 'Class':
            await Class.findByIdAndUpdate(trashItem.itemId, {
              isDeleted: false,
              deletedAt: null,
              deletedBy: null
            });
            break;

          default:
            throw new Error(`Unknown item type: ${trashItem.itemType}`);
        }

        // Delete the trash item record
        await TrashItem.findByIdAndDelete(trashItemId);

        return {
          trashItemId,
          itemType: trashItem.itemType,
          itemName: trashItem.itemName,
          success: true
        };
      })
    );

    // Separate successful and failed restores
    const restored = results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);

    const failed = results
      .filter(r => r.status === 'rejected')
      .map((r, index) => ({
        trashItemId: trashItemIds[index],
        error: r.reason.message
      }));

    console.log(`✅ Bulk restore complete: ${restored.length} restored, ${failed.length} failed`);

    res.json({
      success: true,
      restored,
      failed,
      message: `Restored ${restored.length} items successfully${failed.length > 0 ? `, ${failed.length} failed` : ''}`
    });
  } catch (error) {
    console.error('❌ Bulk restore error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to bulk restore items'
    });
  }
});

/**
 * DELETE /api/trash/bulk-delete
 * Bulk permanent delete
 * Body: { trashItemIds: [] }
 */
router.delete('/bulk-delete', authenticate, checkPermission('settings', 'delete'), async (req, res) => {
  try {
    const { trashItemIds } = req.body;

    if (!trashItemIds || !Array.isArray(trashItemIds) || trashItemIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid input',
        message: 'trashItemIds must be a non-empty array'
      });
    }

    console.log(`🔥 Bulk permanently deleting ${trashItemIds.length} items...`);

    // Process all items in parallel
    const results = await Promise.allSettled(
      trashItemIds.map(async (trashItemId) => {
        console.log(`🔥 Processing: ${trashItemId}`);

        // Find trash item
        const trashItem = await TrashItem.findById(trashItemId);

        if (!trashItem) {
          throw new Error(`Trash item not found: ${trashItemId}`);
        }

        // Delete based on item type
        switch (trashItem.itemType) {
          case 'Student':
            // First delete related StudentFeeStructure records
            await StudentFeeStructure.deleteMany({ studentId: trashItem.itemId });

            // Then delete the student
            await Student.findByIdAndDelete(trashItem.itemId);
            break;

          case 'Staff':
            // Delete the staff
            await Staff.findByIdAndDelete(trashItem.itemId);
            break;

          case 'Class':
            // Delete the class
            await Class.findByIdAndDelete(trashItem.itemId);
            break;

          default:
            throw new Error(`Unknown item type: ${trashItem.itemType}`);
        }

        // Delete the trash item record
        await TrashItem.findByIdAndDelete(trashItemId);

        return {
          trashItemId,
          itemType: trashItem.itemType,
          itemName: trashItem.itemName,
          success: true
        };
      })
    );

    // Separate successful and failed deletes
    const deleted = results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);

    const failed = results
      .filter(r => r.status === 'rejected')
      .map((r, index) => ({
        trashItemId: trashItemIds[index],
        error: r.reason.message
      }));

    console.log(`✅ Bulk delete complete: ${deleted.length} deleted, ${failed.length} failed`);

    res.json({
      success: true,
      deleted,
      failed,
      message: `Permanently deleted ${deleted.length} items successfully${failed.length > 0 ? `, ${failed.length} failed` : ''}`
    });
  } catch (error) {
    console.error('❌ Bulk delete error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to bulk delete items'
    });
  }
});

export default router;
