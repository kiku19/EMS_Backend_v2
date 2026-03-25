/**
 * OBS-05: Query Performance Dashboard Routes
 *
 * Internal/ops endpoints for slow query monitoring.
 * Protected by the same OPS_DEPLOYMENT_SECRET used by the error-rate endpoint.
 *
 * GET  /api/ops/query-performance          — dashboard: top-10 slowest today, patterns
 * GET  /api/ops/query-performance/indexes  — index usage stats + automated suggestions
 */

import express from 'express';
import { getSlowQueryStats, getIndexStats } from '../services/slowQueryMonitor.js';
import { createLogger } from '../utils/logger.js';

const router = express.Router();
const logger = createLogger('QueryPerformance');

function checkOpsSecret(req, res) {
  const secret = process.env.OPS_DEPLOYMENT_SECRET;
  if (secret && req.headers['x-ops-secret'] !== secret) {
    res.status(401).json({ error: req.t('common:errors.unauthorized') });
    return false;
  }
  return true;
}

/**
 * GET /api/ops/query-performance
 *
 * Returns:
 *  - threshold config (record/alert ms)
 *  - count of slow queries in last 5 min and last hour
 *  - top-10 slowest queries today
 *  - top-20 query patterns (grouped by collection+operation) from last hour
 */
router.get('/', (req, res) => {
  if (!checkOpsSecret(req, res)) return;

  try {
    res.json(getSlowQueryStats());
  } catch (err) {
    logger.error({ err }, 'Failed to get slow query stats');
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * GET /api/ops/query-performance/indexes
 *
 * Fetches live $indexStats from MongoDB for every user collection.
 * Returns:
 *  - allIndexStats: sorted by fewest accesses (candidates for removal)
 *  - unusedCount: total indexes with 0 accesses (excluding _id_)
 *  - suggestions: automated "consider removing" recommendations
 *
 * Note: this runs a DB command per collection — avoid polling it frequently.
 */
router.get('/indexes', async (req, res) => {
  if (!checkOpsSecret(req, res)) return;

  try {
    const stats = await getIndexStats();
    res.json(stats);
  } catch (err) {
    logger.error({ err }, 'Failed to get index stats');
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;
