import express from 'express';
import { authenticate, requireSuperAdmin } from '../middleware/auth.js';
import { validateZod } from '../validators/zodHelpers.js';
import {
  createFeatureFlagSchema,
  updateFeatureFlagSchema,
  schoolOverrideSchema,
} from '../validators/featureFlagsSchema.js';
import {
  getSchoolFeatures,
  listFlags,
  createFlag,
  updateFlag,
  deleteFlag,
  setSchoolOverride,
  listAuditLogs,
} from '../services/featureFlagsService.js';

const router = express.Router();

// Helper to extract actor info from req.user
function getActor(req) {
  return { id: String(req.user?.id || req.user?._id || 'unknown'), email: req.user?.email || null };
}

// ─── School-Scoped ────────────────────────────────────────────────────────────
// GET /feature-flags
// Returns the merged feature map for the authenticated school.
// Used by the frontend to conditionally render premium features.
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await getSchoolFeatures(req.user.schoolId);
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message || 'Failed to fetch features',
    });
  }
});

// ─── Super Admin: Flag Management ────────────────────────────────────────────
// All routes below require superAdmin role.

// GET /feature-flags/admin/all
router.get('/admin/all', authenticate, requireSuperAdmin, async (req, res) => {
  try {
    const flags = await listFlags();
    res.json({ flags });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to list flags' });
  }
});

// GET /feature-flags/admin/audit-logs?flagKey=&actorId=&limit=
router.get('/admin/audit-logs', authenticate, requireSuperAdmin, async (req, res) => {
  try {
    const { flagKey, actorId, limit } = req.query;
    const logs = await listAuditLogs(
      { flagKey: flagKey || undefined, actorId: actorId || undefined },
      limit ? Math.min(parseInt(limit, 10) || 100, 500) : 100
    );
    res.json({ logs });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to list audit logs' });
  }
});

// POST /feature-flags/admin
router.post(
  '/admin',
  authenticate,
  requireSuperAdmin,
  validateZod(createFeatureFlagSchema),
  async (req, res) => {
    try {
      const flag = await createFlag(req.body, getActor(req));
      res.status(201).json(flag);
    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({ error: 'A flag with this key already exists' });
      }
      res.status(error.status || 500).json({ error: error.message || 'Failed to create flag' });
    }
  }
);

// PUT /feature-flags/admin/:key
router.put(
  '/admin/:key',
  authenticate,
  requireSuperAdmin,
  validateZod(updateFeatureFlagSchema),
  async (req, res) => {
    try {
      const flag = await updateFlag(req.params.key, req.body, getActor(req));
      res.json(flag);
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message || 'Failed to update flag' });
    }
  }
);

// DELETE /feature-flags/admin/:key
router.delete('/admin/:key', authenticate, requireSuperAdmin, async (req, res) => {
  try {
    await deleteFlag(req.params.key, getActor(req));
    res.json({ success: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to delete flag' });
  }
});

// POST /feature-flags/admin/:key/override — add or update a per-school override
router.post(
  '/admin/:key/override',
  authenticate,
  requireSuperAdmin,
  validateZod(schoolOverrideSchema),
  async (req, res) => {
    try {
      const { schoolId, enabled } = req.body;
      const flag = await setSchoolOverride(req.params.key, schoolId, enabled, getActor(req));
      res.json(flag);
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message || 'Failed to set override' });
    }
  }
);

// DELETE /feature-flags/admin/:key/override/:schoolId — remove a per-school override
router.delete(
  '/admin/:key/override/:schoolId',
  authenticate,
  requireSuperAdmin,
  async (req, res) => {
    try {
      const flag = await setSchoolOverride(
        req.params.key,
        req.params.schoolId,
        null,
        getActor(req)
      );
      res.json(flag);
    } catch (error) {
      res.status(error.status || 500).json({
        error: error.message || 'Failed to remove override',
      });
    }
  }
);

export default router;
