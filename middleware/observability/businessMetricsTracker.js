/**
 * OBS-04: Business Metrics Tracker Middleware
 *
 * Fire-and-forget middleware (like apiUsageTracker) that:
 *  1. Upserts a UserDayActivity doc (one per user per day) for DAU/WAU/MAU tracking.
 *  2. Records feature usage and client type in the in-memory buffer (flushed every 5 min).
 *
 * Never blocks the response — all work happens in setImmediate.
 */

import UserDayActivity from '../../models/UserDayActivity.js';
import { recordRequest, detectClient } from '../../services/businessMetricsService.js';

// Skip internal / non-user-facing paths that would skew metrics
const SKIP_PREFIXES = [
  '/auth',
  '/public',
  '/billing/summary',
  '/super-admin',
  '/audit-logs',
  '/webhooks',
  '/api-keys',
];

function shouldSkip(req) {
  if (!req.user?.schoolId || !req.user?._id) return true;
  return SKIP_PREFIXES.some((p) => req.path.startsWith(p));
}

function getDateString() {
  return new Date().toISOString().slice(0, 10);
}

export function businessMetricsTracker(req, res, next) {
  next();

  if (shouldSkip(req)) return;

  setImmediate(() => {
    const schoolId = req.user.schoolId;
    const userId = req.user._id;
    const path = req.path;
    const userAgent = req.headers['user-agent'] || '';
    const date = getDateString();
    const client = detectClient(path, userAgent);

    // 1. Upsert user-day activity for DAU/WAU/MAU
    UserDayActivity.updateOne(
      { schoolId, userId, date },
      { $setOnInsert: { schoolId, userId, date, client, recordedAt: new Date() } },
      { upsert: true }
    ).catch(() => {}); // silent — metrics are best-effort

    // 2. Increment in-memory feature + client counters (no I/O here)
    recordRequest(schoolId, path, userAgent);
  });
}
