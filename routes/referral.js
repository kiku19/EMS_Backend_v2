import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { validateZod } from '../validators/zodHelpers.js';
import { applyReferralCodeSchema } from '../validators/referralSchema.js';
import {
  getOrCreateReferralCode,
  applyReferralCode,
  getReferralStats,
} from '../services/referralService.js';

const router = express.Router();

// GET /referral/code — get (or create) this school's referral code
router.get('/code', authenticate, checkPermission('settings', 'view'), async (req, res) => {
  try {
    const referral = await getOrCreateReferralCode(req.user.schoolId);
    res.json({ referralCode: referral.referralCode });
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message || 'Failed to get referral code',
    });
  }
});

// GET /referral/stats — referral statistics for this school
router.get('/stats', authenticate, checkPermission('settings', 'view'), async (req, res) => {
  try {
    const stats = await getReferralStats(req.user.schoolId);
    res.json(stats);
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message || 'Failed to get referral stats',
    });
  }
});

// POST /referral/apply — apply a referral code (called by the referred school)
router.post(
  '/apply',
  authenticate,
  checkPermission('settings', 'edit'),
  validateZod(applyReferralCodeSchema),
  async (req, res) => {
    try {
      await applyReferralCode(req.user.schoolId, req.body.code);
      res.json({
        success: true,
        message:
          'Referral code applied. Your referrer will receive 1 month free once you activate a paid plan.',
      });
    } catch (error) {
      res.status(error.status || 500).json({
        error: error.message || 'Failed to apply referral code',
      });
    }
  }
);

export default router;
