/**
 * OBS-03: HTTP Request/Response Logger
 *
 * Emits one structured log line per HTTP request containing all the fields
 * needed to drive a log-search dashboard in Grafana Loki / Datadog / Kibana:
 *
 *   requestId   – correlates all log lines from the same request
 *   schoolId    – multi-tenant scoping (from req.user, set by auth middleware)
 *   userId      – who made the request
 *   method      – HTTP verb
 *   url         – request path (no query string to avoid PII leakage in URLs)
 *   statusCode  – response status
 *   duration    – response time in milliseconds
 *   userAgent   – client identification
 *
 * Log levels follow HTTP status ranges:
 *   2xx / 3xx → info
 *   4xx       → warn  (client errors, watch for auth-failure spikes)
 *   5xx       → error (server errors, watch for 5xx spike alerts)
 *
 * Requests to /health are silenced to keep log volume low.
 */

import { createLogger } from '../../utils/logger.js';

const logger = createLogger('HTTP');

const SKIP_PATHS = new Set(['/health', '/api/health']);

export function httpLogger(req, res, next) {
  if (SKIP_PATHS.has(req.path)) {
    return next();
  }

  const startAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startAt) / 1e6;
    const { statusCode } = res;

    const logData = {
      requestId: req.requestId,
      schoolId: req.user?.schoolId,
      userId: req.user?._id,
      method: req.method,
      url: req.path,
      statusCode,
      duration: Math.round(durationMs),
      userAgent: req.headers['user-agent'],
    };

    if (statusCode >= 500) {
      logger.error(logData, 'HTTP request');
    } else if (statusCode >= 400) {
      logger.warn(logData, 'HTTP request');
    } else {
      logger.info(logData, 'HTTP request');
    }
  });

  next();
}
