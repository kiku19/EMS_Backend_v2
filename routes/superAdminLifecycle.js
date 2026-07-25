import express from 'express';
import { z } from 'zod';
import { authenticate, requireSuperAdmin } from '../middleware/auth.js';
import { validateZod, objectId } from '../validators/index.js';
import { School } from '../database.js';
import SchoolSubscription from '../models/SchoolSubscription.js';
import Session from '../models/Session.js';
import { invalidateSchoolStatusCache } from '../middleware/auth/schoolStatusGuard.js';

const router = express.Router();
router.use(authenticate, requireSuperAdmin);

const schoolIdParamSchema = z.object({ schoolId: objectId });
const offboardBodySchema = z.object({
  reason: z.string().max(500).optional(),
});

// Revoke every active session for a school → all currently-logged-in users are
// forced out on their next request (authenticate checks isRevoked per request).
async function revokeSchoolSessions(schoolId) {
  const result = await Session.updateMany(
    { schoolId, isRevoked: false },
    { $set: { isRevoked: true, revokedAt: new Date() } }
  );
  return result.modifiedCount || 0;
}

async function loadSchoolOr404(res, id) {
  const school = await School.findById(id);
  if (!school) {
    res.status(404).json({ error: 'School not found' });
    return null;
  }
  return school;
}

// POST /api/v1/super-admin/lifecycle/:schoolId/suspend
// Block access (keep data). Revokes sessions so active users are logged out
// immediately; the status guard keeps them out even if they log back in.
router.post('/:schoolId/suspend', validateZod(schoolIdParamSchema, 'params'), async (req, res) => {
  try {
    const school = await loadSchoolOr404(res, req.params.schoolId);
    if (!school) return;

    school.status = 'suspended';
    await school.save();
    invalidateSchoolStatusCache(school._id);
    const sessionsRevoked = await revokeSchoolSessions(school._id);

    res.json({
      success: true,
      status: school.status,
      sessionsRevoked,
      message: `${school.name} suspended — access blocked, ${sessionsRevoked} session(s) revoked.`,
    });
  } catch (err) {
    req.log?.error?.({ err }, 'Failed to suspend school');
    res.status(500).json({ error: 'Failed to suspend school' });
  }
});

// POST /api/v1/super-admin/lifecycle/:schoolId/reactivate
// Restore access from suspended/locked. (Churned → re-onboard via active.)
router.post(
  '/:schoolId/reactivate',
  validateZod(schoolIdParamSchema, 'params'),
  async (req, res) => {
    try {
      const school = await loadSchoolOr404(res, req.params.schoolId);
      if (!school) return;

      school.status = 'active';
      await school.save();
      invalidateSchoolStatusCache(school._id);

      res.json({
        success: true,
        status: school.status,
        message: `${school.name} reactivated — access restored.`,
      });
    } catch (err) {
      req.log?.error?.({ err }, 'Failed to reactivate school');
      res.status(500).json({ error: 'Failed to reactivate school' });
    }
  }
);

// POST /api/v1/super-admin/lifecycle/:schoolId/lock
// Admin/security lock. Same effect as suspend (blocks access) but signals a
// harder, manual-intervention recovery path.
router.post('/:schoolId/lock', validateZod(schoolIdParamSchema, 'params'), async (req, res) => {
  try {
    const school = await loadSchoolOr404(res, req.params.schoolId);
    if (!school) return;

    school.status = 'locked';
    await school.save();
    invalidateSchoolStatusCache(school._id);
    const sessionsRevoked = await revokeSchoolSessions(school._id);

    res.json({
      success: true,
      status: school.status,
      sessionsRevoked,
      message: `${school.name} locked — ${sessionsRevoked} session(s) revoked.`,
    });
  } catch (err) {
    req.log?.error?.({ err }, 'Failed to lock school');
    res.status(500).json({ error: 'Failed to lock school' });
  }
});

// POST /api/v1/super-admin/lifecycle/:schoolId/offboard
// Permanent offboarding: cancel subscription, revoke all sessions, mark
// churned, and record a manifest of what was done in School.metadata. Data
// export (full collection dump) is a separate follow-up job; this records the
// access teardown + billing cancellation deterministically.
router.post(
  '/:schoolId/offboard',
  validateZod(schoolIdParamSchema, 'params'),
  validateZod(offboardBodySchema),
  async (req, res) => {
    try {
      const school = await loadSchoolOr404(res, req.params.schoolId);
      if (!school) return;

      const sessionsRevoked = await revokeSchoolSessions(school._id);

      // Cancel subscription if one exists.
      let subscriptionCancelled = false;
      const subscription = await SchoolSubscription.findOne({ schoolId: school._id });
      if (subscription && subscription.status !== 'cancelled') {
        subscription.status = 'cancelled';
        subscription.cancelledAt = new Date();
        subscription.cancelAtPeriodEnd = false;
        subscription.cancellationReason = req.body.reason || 'Super-admin offboard';
        await subscription.save(); // Phase 1b hook syncs School.planStatus
        subscriptionCancelled = true;
      }

      school.status = 'churned';
      school.metadata = {
        ...(school.metadata || {}),
        offboard: {
          at: new Date().toISOString(),
          by: req.user?.email || 'super-admin',
          reason: req.body.reason || null,
          sessionsRevoked,
          subscriptionCancelled,
        },
      };
      await school.save();
      invalidateSchoolStatusCache(school._id);

      res.json({
        success: true,
        status: school.status,
        sessionsRevoked,
        subscriptionCancelled,
        message: `${school.name} offboarded — churned, sessions revoked, subscription cancelled.`,
      });
    } catch (err) {
      req.log?.error?.({ err }, 'Failed to offboard school');
      res.status(500).json({ error: 'Failed to offboard school' });
    }
  }
);

export default router;
