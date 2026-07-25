import express from 'express';
import { z } from 'zod';
import { authenticate, requireSuperAdmin } from '../middleware/auth.js';
import { validateZod } from '../validators/index.js';
import { getActivityFeed } from '../services/activityFeedService.js';

const router = express.Router();

// Every activity endpoint is super-admin only.
router.use(authenticate, requireSuperAdmin);

// Query schema for the unified activity feed. All filters optional.
const activityQuerySchema = z.object({
  page: z.coerce.number().int().positive().max(10000).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  source: z.enum(['audit', 'trash', 'flag']).optional(),
  actorType: z.enum(['all', 'school-user', 'super-admin']).optional(),
  schoolId: z
    .string()
    .regex(/^[a-f0-9]{24}$/i, 'schoolId must be a 24-char hex id')
    .optional(),
  action: z.string().max(64).optional(),
  entity: z.string().max(64).optional(),
  since: z
    .string()
    .datetime({ offset: true })
    .optional()
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  until: z
    .string()
    .datetime({ offset: true })
    .optional()
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  q: z.string().max(200).optional(),
});

// GET /api/v1/super-admin/activity
// Unified, cross-school activity feed (audit + trash + flag changes).
router.get('/', validateZod(activityQuerySchema, 'query'), async (req, res) => {
  try {
    const result = await getActivityFeed(req.query);
    res.json(result);
  } catch (err) {
    req.log?.error?.({ err }, 'Failed to fetch activity feed');
    res.status(500).json({ error: 'Failed to fetch activity feed' });
  }
});

export default router;
