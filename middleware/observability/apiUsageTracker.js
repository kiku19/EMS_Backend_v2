import { trackApiCall } from '../../services/billingService.js';

// Paths that are excluded from API call metering (health, auth, public, billing summary itself)
const SKIP_PREFIXES = [
  '/health',
  '/api/health',
  '/api/v1/auth',
  '/api/auth',
  '/api/v1/public',
  '/api/public',
  '/api/v1/billing/summary', // avoid recursive metering on the billing summary fetch
  '/api/billing/summary',
];

function shouldSkip(req) {
  if (!req.user?.schoolId) return true;
  return SKIP_PREFIXES.some(
    (prefix) => req.path.startsWith(prefix) || req.originalUrl.startsWith(prefix)
  );
}

/**
 * Middleware that tracks API call counts per school per calendar month.
 * Runs fire-and-forget — never blocks the response.
 */
export function apiUsageTracker(req, res, next) {
  next();

  if (shouldSkip(req)) return;

  // Fire-and-forget after response is handed off
  setImmediate(() => {
    trackApiCall(req.user.schoolId).catch(() => {});
  });
}
