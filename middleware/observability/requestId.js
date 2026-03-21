/**
 * OBS-03: Request ID Middleware
 *
 * Assigns a unique ID to every incoming request so all log lines from
 * the same request can be correlated in a log aggregation platform
 * (Grafana Loki, Datadog, ELK, etc.).
 *
 * - Reads X-Request-ID from the incoming request if the upstream gateway
 *   already set one (keeps the chain intact through load balancers / proxies).
 * - Falls back to a locally-generated UUID v4.
 * - Echoes the final ID back in the X-Request-ID response header so
 *   clients can include it in bug reports.
 *
 * Usage:
 *   app.use(requestIdMiddleware);     // mount early, before all routes
 *   req.requestId                     // available on every request object
 */

import { randomUUID } from 'crypto';
import { Sentry } from '../../utils/sentry.js';

export function requestIdMiddleware(req, res, next) {
  const requestId = req.headers['x-request-id'] || randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);

  // Tag Sentry scope so all events from this request carry the correlation ID
  Sentry.getCurrentScope().setTag('requestId', requestId);

  next();
}
