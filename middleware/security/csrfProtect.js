import { config } from '../../config/environment.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('CSRF');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const AMBIENT_AUTH_COOKIE_NAMES = new Set([
  'ems_auth_token',
  'ems_refresh_token',
  'ems_ops_token',
  'ems_ops_refresh',
]);

// SAML identity providers POST the signed assertion from their own origin.
// That endpoint validates the SAML response + state itself and must remain
// reachable even when a user already has an EMS cookie in the browser.
const CROSS_SITE_CALLBACK_PATHS = new Set([
  '/api/auth/sso/saml/callback',
  '/api/v1/auth/sso/saml/callback',
]);

export function hasAmbientAuthCookie(cookieHeader = '') {
  return String(cookieHeader)
    .split(';')
    .map((part) => part.trim().split('=', 1)[0])
    .some((name) => AMBIENT_AUTH_COOKIE_NAMES.has(name));
}

export function isCsrfExemptPath(originalUrl = '') {
  const pathname = String(originalUrl).split('?', 1)[0];
  return CROSS_SITE_CALLBACK_PATHS.has(pathname);
}

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
 * This middleware is mounted once at the API-router boundary. It protects only
 * requests carrying ambient auth cookies; Bearer/API-key and unauthenticated
 * webhook/mobile traffic do not need a browser-origin check.
 */
export function csrfProtect(req, res, next) {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  if (isCsrfExemptPath(req.originalUrl || req.url)) {
    return next();
  }

  // Explicit credentials are not ambient browser authority. They also force a
  // CORS preflight, so a malicious page cannot attach them cross-origin.
  if (req.headers.authorization || req.headers['x-api-key']) {
    return next();
  }

  if (!hasAmbientAuthCookie(req.headers.cookie)) {
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
    // Local test/dev clients often omit Origin. In production, every browser
    // mutation that carries an auth cookie must identify its source.
    if (config.isDevelopment) {
      return next();
    }
    logger.warn({ method: req.method, path: req.path }, 'CSRF check failed: no Origin header');
    return res.status(403).json({ error: 'Forbidden: missing Origin header' });
  }

  const allowedOrigins = config.corsOrigins || [];

  const isAllowed = allowedOrigins.some((allowed) => {
    if (!allowed.includes('*')) return allowed === requestOrigin;
    const escaped = allowed.replace(/[-[\]{}()+?.,\\^$|#\s]/g, '\\$&').replace(/\*/g, '.*');
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
