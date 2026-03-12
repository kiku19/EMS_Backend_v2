import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import {
  createPlanCheckout,
  getBillingSummary,
  updateAutoRenew,
  updateBillingAccount,
} from '../services/billingService.js';

const router = express.Router();

router.get(
  '/summary',
  authenticate,
  checkPermission('settings', 'view'),
  async (req, res) => {
    try {
      const summary = await getBillingSummary(req.user.schoolId);
      res.json(summary);
    } catch (error) {
      res.status(error.status || 500).json({
        error: error.message || 'Failed to fetch billing summary',
        details: error.details,
      });
    }
  }
);

router.put(
  '/account',
  authenticate,
  checkPermission('settings', 'edit'),
  async (req, res) => {
    try {
      const summary = await updateBillingAccount(req.user.schoolId, req.body || {});
      res.json(summary);
    } catch (error) {
      res.status(error.status || 500).json({
        error: error.message || 'Failed to update billing account',
        details: error.details,
      });
    }
  }
);

router.post(
  '/auto-renew',
  authenticate,
  checkPermission('settings', 'edit'),
  async (req, res) => {
    try {
      const subscription = await updateAutoRenew(req.user.schoolId, req.body?.autoRenew);
      res.json({
        success: true,
        autoRenew: subscription.autoRenew,
      });
    } catch (error) {
      res.status(error.status || 500).json({
        error: error.message || 'Failed to update auto-renew settings',
        details: error.details,
      });
    }
  }
);

router.post(
  '/checkout',
  authenticate,
  checkPermission('settings', 'edit'),
  async (req, res) => {
    try {
      const { planKey, billingCycle = 'monthly' } = req.body || {};
      const checkout = await createPlanCheckout({
        schoolId: req.user.schoolId,
        planKey,
        billingCycle,
      });

      res.status(201).json({
        success: true,
        ...checkout,
      });
    } catch (error) {
      res.status(error.status || 500).json({
        error: error.message || 'Failed to create checkout',
        details: error.details,
      });
    }
  }
);

export default router;
