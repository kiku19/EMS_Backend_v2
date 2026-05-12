import { config } from '../../config/environment.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('CSRF');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for cookie-authenticated requests.
 *
 * This app uses httpOnly cookies for auth (no Bearer token on the frontend).
 * Cookies are sent cross-origin because sameSite is 'none' in production.
 * CORS blocks the browser from *reading* cross-origin responses, but it does
 * NOT prevent the server from *processing* the mutating request.
 *
 * For non-safe methods (POST/PUT/PATCH/DELETE) this middleware validates that
 * the Origin or Referer header matches one of the CORS-allowed origins.
 * Forged requests from malicious pages either lack these headers or carry the
 * attacker's origin, which will be rejected here.
 *
 * Apply to any route that changes state and relies on cookie auth.
 */
export function csrfProtect(req, res, next) {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  // Extract the request origin from Origin header (preferred) or Referer
  let requestOrigin = req.headers.origin;

  if (!requestOrigin && req.headers.referer) {
    try {
      requestOrigin = new URL(req.headers.referer).origin;
    } catch {
      // Malformed Referer — treat as missing
    }
  }

  if (!requestOrigin) {
    // Server-to-server calls (no browser) have no Origin. Allow in development;
    // reject in production where all browser requests MUST carry an Origin.
    if (config.isDevelopment) {
      return next();
    }
    logger.warn({ method: req.method, path: req.path }, 'CSRF check failed: no Origin header');
    return res.status(403).json({ error: 'Forbidden: missing Origin header' });
  }

  const allowedOrigins = config.corsOrigins || [];

  const isAllowed = allowedOrigins.some((allowed) => {
    if (!allowed.includes('*')) return allowed === requestOrigin;
    const escaped = allowed
      .replace(/[-[\]{}()+?.,\\^$|#\s]/g, '\\$&')
      .replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(requestOrigin);
  });

  if (!isAllowed) {
    logger.warn(
      { method: req.method, path: req.path, origin: requestOrigin },
      'CSRF check failed: origin not in allowlist'
    );
    return res.status(403).json({ error: 'Forbidden: cross-site request blocked' });
  }

  next();
}
