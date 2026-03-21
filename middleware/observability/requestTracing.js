/**
 * OBS-02: Request Tracing Middleware
 *
 * Mounts after requestIdMiddleware (OBS-03). For every incoming API request:
 *   1. Aliases req.requestId as req.traceId for APM convention.
 *   2. Sets X-Trace-Id response header so clients can correlate traces.
 *   3. On response finish, records duration to apmService for p50/p95/p99 tracking.
 *
 * Mount order in server.js: requestIdMiddleware → requestTracingMiddleware
 */

import { recordLatency } from '../../services/apmService.js';

const SKIP_PATHS = new Set(['/health', '/api/health', '/healthz', '/readyz']);

/**
 * Express middleware — mount after requestIdMiddleware, before routes.
 */
export function requestTracingMiddleware(req, res, next) {
  // Re-use the request ID assigned by OBS-03 as the trace ID for APM
  // (falls back to X-Trace-Id header if requestIdMiddleware isn't mounted)
  const traceId = req.requestId || req.headers['x-trace-id'] || req.headers['x-request-id'];
  req.traceId = traceId;

  if (traceId) {
    // Propagate as X-Trace-Id so clients can correlate APM traces
    res.setHeader('X-Trace-Id', traceId);
  }

  const startTime = process.hrtime.bigint();

  res.on('finish', () => {
    const url = req.originalUrl || req.url || '';
    if (SKIP_PATHS.has(req.path) || SKIP_PATHS.has(url)) return;

    const durationMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
    recordLatency(req.method, req.path || url, Math.round(durationMs), res.statusCode, traceId);
  });

  next();
}
