/**
 * OBS-07: Error Rate Tracker Middleware
 *
 * Hooks into Express response to record every completed request and
 * flag 5xx responses as errors for the errorRateMonitor service.
 */

import { recordRequest } from '../../services/errorRateMonitor.js';

/**
 * Express middleware that intercepts the response finish event
 * and records request/error counts in the rolling-window monitor.
 */
export function errorRateTracker(req, res, next) {
  res.on('finish', () => {
    // Only track API routes — skip health checks and static assets
    const url = req.originalUrl || req.url;
    if (url === '/health' || url === '/api/health') return;

    const isError = res.statusCode >= 500;
    recordRequest(isError);
  });

  next();
}
