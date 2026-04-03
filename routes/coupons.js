import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { validateZod } from '../validators/zodHelpers.js';
import {
  createCouponSchema,
  updateCouponSchema,
  validateCouponSchema,
  couponListQuerySchema,
} from '../validators/couponSchema.js';
import {
  createCoupon,
  updateCoupon,
  deleteCoupon,
  listCoupons,
  validateCoupon,
} from '../services/couponService.js';
import { Coupon } from '../models/Coupon.js';
import { logToTrash } from '../services/trashService.js';

const router = express.Router();
router.use(authenticate);

// POST /coupons/validate - validate a coupon code (any authenticated user)
router.post('/validate', validateZod(validateCouponSchema), async (req, res) => {
  try {
    const { code, planKey, billingCycle } = req.body;
    const result = await validateCoupon({
      code,
      planKey,
      billingCycle,
      schoolId: req.user.schoolId,
    });
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message || 'Failed to validate coupon',
    });
  }
});

// GET /coupons - list coupons (admin only)
router.get(
  '/',
  checkPermission('settings', 'edit'),
  validateZod(couponListQuerySchema, 'query'),
  async (req, res) => {
    try {
      const { page, limit, isActive } = req.query;
      const result = await listCoupons({ page, limit, isActive });
      res.json(result);
    } catch (error) {
      res.status(error.status || 500).json({
        error: error.message || 'Failed to list coupons',
      });
    }
  }
);

// POST /coupons - create coupon (admin only)
router.post(
  '/',
  checkPermission('settings', 'edit'),
  validateZod(createCouponSchema),
  async (req, res) => {
    try {
      const coupon = await createCoupon(req.body);
      res.status(201).json({ success: true, coupon });
    } catch (error) {
      res.status(error.status || 500).json({
        error: error.message || 'Failed to create coupon',
      });
    }
  }
);

// PUT /coupons/:id - update coupon (admin only)
router.put(
  '/:id',
  checkPermission('settings', 'edit'),
  validateZod(updateCouponSchema),
  async (req, res) => {
    try {
      const coupon = await updateCoupon(req.params.id, req.body);
      res.json({ success: true, coupon });
    } catch (error) {
      res.status(error.status || 500).json({
        error: error.message || 'Failed to update coupon',
      });
    }
  }
);

// DELETE /coupons/:id - delete coupon (admin only)
router.delete('/:id', checkPermission('settings', 'edit'), async (req, res) => {
  try {
    const couponSnapshot = await Coupon.findById(req.params.id).lean();
    await deleteCoupon(req.params.id);

    if (couponSnapshot) {
      logToTrash({
        itemType: 'Coupon',
        itemId: couponSnapshot._id,
        itemName: couponSnapshot.code || 'Coupon',
        originalData: couponSnapshot,
        deletedBy: req.user?.id || req.user?._id,
        schoolId: req.user?.schoolId,
      }).catch(() => {});
    }

    res.json({ success: true });
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message || 'Failed to delete coupon',
    });
  }
});

export default router;
