import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { authenticate, requireSuperAdmin } from '../middleware/auth.js';
import { validateZod } from '../validators/index.js';
import TrashItem from '../models/TrashItem.js';
import School from '../models/School.js';
import { restoreTrashItem, permanentlyDeleteTrashItem } from '../services/trashService.js';

const router = express.Router();

// Every cross-school trash endpoint is super-admin only. Unlike the
// school-scoped /api/trash routes, these intentionally do NOT filter by
// req.user.schoolId (which is null for super-admin) — the operator sees and
// can restore/permanently-delete across all tenants.
router.use(authenticate, requireSuperAdmin);

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const listQuerySchema = z.object({
  schoolId: z
    .string()
    .regex(/^[a-f0-9]{24}$/i, 'schoolId must be a 24-char hex id')
    .optional(),
  type: z.string().max(64).optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().positive().max(10000).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const trashIdParamSchema = z.object({
  trashItemId: z
    .string()
    .regex(/^[a-f0-9]{24}$/i, 'trashItemId must be a 24-char hex id'),
});

// GET /api/v1/super-admin/trash
// Cross-school recycle bin listing.
router.get('/', validateZod(listQuerySchema, 'query'), async (req, res) => {
  try {
    const { schoolId, type, search } = req.query;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
    const skip = (page - 1) * limit;

    const query = {};
    if (schoolId) query.schoolId = new mongoose.Types.ObjectId(schoolId);
    if (type) query.itemType = type;
    if (search) query.itemName = new RegExp(escapeRegex(search), 'i');

    const [items, total] = await Promise.all([
      TrashItem.find(query)
        .sort({ deletedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('schoolId', 'name code status')
        .populate('deletedBy', 'name email')
        .lean(),
      TrashItem.countDocuments(query),
    ]);

    const data = items.map((item) => ({
      _id: item._id,
      itemType: item.itemType,
      itemId: item.itemId,
      itemName: item.itemName,
      restoreStrategy: item.restoreStrategy,
      school: item.schoolId
        ? { _id: item.schoolId._id, name: item.schoolId.name, code: item.schoolId.code, status: item.schoolId.status }
        : null,
      deletedBy: item.deletedBy
        ? { _id: item.deletedBy._id, name: item.deletedBy.name, email: item.deletedBy.email }
        : null,
      deletedAt: item.deletedAt,
      expiresAt: item.expiresAt,
    }));

    res.json({
      data,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    req.log?.error?.({ err }, 'Failed to list cross-school trash');
    res.status(500).json({ error: 'Failed to list trash' });
  }
});

// GET /api/v1/super-admin/trash/stats
// Rollup: counts by type, by school (top 10), and items expiring within 7 days.
router.get('/stats', async (req, res) => {
  try {
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    const [byType, bySchoolRaw, expiringSoon, total] = await Promise.all([
      TrashItem.aggregate([
        { $group: { _id: '$itemType', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      TrashItem.aggregate([
        { $group: { _id: '$schoolId', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: School.collection.name,
            localField: '_id',
            foreignField: '_id',
            as: 'school',
          },
        },
        {
          $project: {
            _id: 0,
            schoolId: '$_id',
            count: 1,
            name: { $arrayElemAt: ['$school.name', 0] },
          },
        },
      ]),
      TrashItem.countDocuments({ expiresAt: { $lte: sevenDaysFromNow } }),
      TrashItem.countDocuments({}),
    ]);

    res.json({
      total,
      byType: byType.map((b) => ({ type: b._id, count: b.count })),
      bySchool: bySchoolRaw,
      expiringSoon,
      retentionDays: 60,
    });
  } catch (err) {
    req.log?.error?.({ err }, 'Failed to compute trash stats');
    res.status(500).json({ error: 'Failed to compute trash stats' });
  }
});

// POST /api/v1/super-admin/trash/:trashItemId/restore
// Restore an item on a school's behalf.
router.post(
  '/:trashItemId/restore',
  validateZod(trashIdParamSchema, 'params'),
  async (req, res) => {
    try {
      const { trashItemId } = req.params;
      const trashItem = await TrashItem.findById(trashItemId);

      if (!trashItem) {
        return res.status(404).json({ error: 'Trash item not found' });
      }

      await restoreTrashItem(trashItem);
      await TrashItem.findByIdAndDelete(trashItemId);

      res.json({
        success: true,
        message: `${trashItem.itemType === 'BulkCleanup' ? trashItem.itemName : trashItem.itemType} restored successfully`,
      });
    } catch (err) {
      req.log?.error?.({ err }, 'Failed to restore trash item (super-admin)');
      res.status(500).json({ error: err?.message || 'Failed to restore item' });
    }
  }
);

// DELETE /api/v1/super-admin/trash/:trashItemId
// Permanently delete an item across tenants.
router.delete('/:trashItemId', validateZod(trashIdParamSchema, 'params'), async (req, res) => {
  try {
    const { trashItemId } = req.params;
    const trashItem = await TrashItem.findById(trashItemId);

    if (!trashItem) {
      return res.status(404).json({ error: 'Trash item not found' });
    }

    await permanentlyDeleteTrashItem(trashItem);
    await TrashItem.findByIdAndDelete(trashItemId);

    res.json({
      success: true,
      message: `${trashItem.itemType === 'BulkCleanup' ? trashItem.itemName : trashItem.itemType} permanently deleted`,
    });
  } catch (err) {
    req.log?.error?.({ err }, 'Failed to permanently delete trash item (super-admin)');
    res.status(500).json({ error: err?.message || 'Failed to permanently delete item' });
  }
});

export default router;
