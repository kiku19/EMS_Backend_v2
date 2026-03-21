import * as Sentry from '@sentry/node';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  const { version } = require('../package.json');

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: `ems-backend@${version}`,
    // Only send events in production to avoid noise during development
    enabled: process.env.NODE_ENV === 'production',
    // Capture 10% of transactions for performance monitoring
    tracesSampleRate: 0.1,
    integrations: [Sentry.mongooseIntegration()],
  });
}

/**
 * Capture an error to Sentry with request context.
 * Safe to call even when Sentry is disabled — it no-ops gracefully.
 *
 * Use in route catch blocks:
 *   catch (err) { captureError(err, req); return sendError(res, 500, err.message); }
 */
export function captureError(err, req) {
  if (!process.env.SENTRY_DSN) return;

  Sentry.withScope((scope) => {
    if (req) {
      if (req.requestId) scope.setTag('requestId', req.requestId);
      if (req.path) scope.setTag('route', `${req.method} ${req.path}`);
      if (req.user?.schoolId) scope.setTag('schoolId', req.user.schoolId);
      if (req.user?.userId) scope.setUser({ id: req.user.userId });
    }
    Sentry.captureException(err);
  });
}

export { Sentry };
