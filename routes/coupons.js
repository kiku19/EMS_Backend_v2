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

const router = express.Router();

// POST /coupons/validate - validate a coupon code (any authenticated user)
router.post('/validate', authenticate, validateZod(validateCouponSchema), async (req, res) => {
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
  authenticate,
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
  authenticate,
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
  authenticate,
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
router.delete('/:id', authenticate, checkPermission('settings', 'edit'), async (req, res) => {
  try {
    await deleteCoupon(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message || 'Failed to delete coupon',
    });
  }
});

export default router;
