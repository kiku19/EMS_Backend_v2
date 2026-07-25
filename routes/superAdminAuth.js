/**
 * Super-admin / ops authentication routes.
 *
 * Mounted at `/api/v1/super-admin/auth`. This is a dedicated auth surface for
 * the ops console (the new `@ems/ops-dashboard` frontend app) so it no longer
 * depends on the school-user `POST /auth/login` validator.
 *
 * Design notes:
 *  - Reuses the exact same JWT claims, cookie names, and Session model as the
 *    legacy super-admin branch in `routes/auth.js`. A token minted here is
 *    indistinguishable from one minted by the old path, so `authenticate`,
 *    `requireSuperAdmin`, and every `/super-admin/*` data route work unchanged.
 *  - No 2FA flow — parity with the legacy super-admin login (it never went
 *    through 2FA either; see `routes/auth.js` `/login` handler).
 *  - Logout revokes the Session row by `sessionId`. It does NOT call
 *    `Staff.findByIdAndUpdate('super-admin', …)` — that was a silent no-op in
 *    the legacy `/auth/logout` (the literal id `'super-admin'` matches no doc).
 *  - `/login`, `/refresh`, `/logout` are public and rate-limited (same limiter
 *    posture as `routes/auth.js`). `/session` requires `authenticate` +
 *    `requireSuperAdmin`.
 */
import express from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { rateLimit } from 'express-rate-limit';

import Session from '../models/Session.js';
import { createLogger } from '../utils/logger.js';
import { getRequiredSecret } from '../config/environment.js';
import { validateZod, zodSchemas } from '../middleware/validation.js';
import { isAuthRateLimitingDisabled } from '../middleware/tenantRateLimit.js';
import {
  SUPER_ADMIN_AUTH_COOKIE_NAME,
  SUPER_ADMIN_REFRESH_COOKIE_NAME,
  generateToken,
} from '../middleware/auth/auth.js';
// Note: authenticate/requireSuperAdmin are NOT imported — /session uses a
// dedicated authenticateOps middleware below that reads the ops cookie name
// (ems_ops_token) instead of the staff cookie (ems_auth_token).
import {
  isSuperAdminLogin,
  buildSuperAdminAuthPayload,
  isSuperAdminUser,
} from '../utils/superAdmin.js';
// Reused from the legacy auth route so the token/cookie/session shapes match
// exactly and there is no drift between the two super-admin login paths.
import { withAuthTokens, createSuperAdminSessionRecord, getJwtRefreshSecret } from './auth.js';

const logger = createLogger('superAdminAuth');
const router = express.Router();

const getJwtSecret = () => getRequiredSecret('JWT_SECRET');

// ─── Dedicated ops cookie helpers ───────────────────────────────────────────
// The ops app uses its own cookie names (ems_ops_token / ems_ops_refresh) so a
// staff cookie from the school dashboard is never sent on ops requests (and
// vice versa). Same httpOnly / sameSite / secure attributes as the staff
// cookies — only the names differ.
function getOpsCookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax',
    secure: isProduction,
    path: '/',
  };
}

function setOpsAuthCookie(res, token, maxAgeMs = 8 * 60 * 60 * 1000) {
  res.cookie(SUPER_ADMIN_AUTH_COOKIE_NAME, token, {
    ...getOpsCookieOptions(),
    maxAge: maxAgeMs,
  });
}

function setOpsRefreshCookie(res, token, maxAgeMs = 30 * 24 * 60 * 60 * 1000) {
  res.cookie(SUPER_ADMIN_REFRESH_COOKIE_NAME, token, {
    ...getOpsCookieOptions(),
    maxAge: maxAgeMs,
  });
}

function clearOpsCookies(res) {
  res.clearCookie(SUPER_ADMIN_AUTH_COOKIE_NAME, { ...getOpsCookieOptions(), maxAge: undefined });
  res.clearCookie(SUPER_ADMIN_REFRESH_COOKIE_NAME, { ...getOpsCookieOptions(), maxAge: undefined });
}

function parseCookies(cookieHeader = '') {
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const sep = part.indexOf('=');
      if (sep === -1) return cookies;
      const key = part.slice(0, sep).trim();
      try {
        cookies[key] = decodeURIComponent(part.slice(sep + 1).trim());
      } catch {
        cookies[key] = part.slice(sep + 1).trim();
      }
      return cookies;
    }, {});
}

function extractOpsAuthToken(req) {
  // Prefer the dedicated ops cookie; fall back to Authorization header for
  // non-browser clients (mobile/CLI), then the legacy shared cookie for
  // backward compat with ops sessions minted before the cookie split.
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const bearer = authHeader.substring(7).trim();
    if (bearer) return bearer;
  }
  const cookies = parseCookies(req.headers.cookie);
  return (
    cookies[SUPER_ADMIN_AUTH_COOKIE_NAME] ||
    cookies['ems_auth_token'] || // legacy shared cookie fallback
    null
  );
}

function extractOpsRefreshToken(req) {
  const cookies = parseCookies(req.headers.cookie);
  return (
    cookies[SUPER_ADMIN_REFRESH_COOKIE_NAME] ||
    cookies['ems_refresh_token'] || // legacy shared cookie fallback
    req.body?.refreshToken ||
    null
  );
}

// Same relaxation policy as `routes/auth.js`: relaxed outside production so
// local iteration + the test runner aren't locked out after a few attempts.
const skipRateLimitOutsideProd = () =>
  isAuthRateLimitingDisabled() || process.env.NODE_ENV !== 'production';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => `super-admin:auth:${req.body?.email || 'nocred'}:${req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipRateLimitOutsideProd,
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipRateLimitOutsideProd,
});

/**
 * POST /api/v1/super-admin/auth/login
 *
 * Validates `{ email, password }` against the env-configured super-admin
 * credentials (`SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD`). On success mints
 * an access token (8h) + refresh token (30d) in httpOnly cookies and creates a
 * Session row so the session is revocable.
 *
 * Sends `X-Auth-Mode: cookie` from the web client to keep tokens out of the
 * response body (mirrors the school login contract).
 */
router.post('/login', loginLimiter, validateZod(zodSchemas.superAdminLogin), async (req, res) => {
  try {
    const isValid = await isSuperAdminLogin(req.body);
    if (!isValid) {
      return res.status(401).json({ error: req.t('auth:errors.invalidCredentials') });
    }

    const payload = buildSuperAdminAuthPayload();
    const sessionId = randomUUID();
    const token = generateToken(payload.id, payload.role, {
      userType: payload.userType,
      email: payload.email,
      name: payload.name,
      sessionId,
    });
    const refreshToken = jwt.sign(
      { userId: payload.id, userType: 'super-admin', sessionId },
      getJwtRefreshSecret(),
      { expiresIn: '30d' }
    );

    await createSuperAdminSessionRecord(req, sessionId);

    setOpsAuthCookie(res, token);
    setOpsRefreshCookie(res, refreshToken);

    logger.info({ email: payload.email, sessionId }, 'Super-admin login successful');
    return res.json(withAuthTokens(req, payload, token, refreshToken));
  } catch (error) {
    logger.error({ err: error }, 'Super-admin login error');
    return res.status(500).json({ error: req.t('auth:errors.loginFailed') });
  }
});

/**
 * POST /api/v1/super-admin/auth/refresh
 *
 * Rotates the access token from a valid refresh token. Mirrors the super-admin
 * branch of `routes/auth.js` `/refresh` exactly: the Session must be unrevoked
 * and unexpired; legacy pre-sessionId refresh tokens get a fresh session minted.
 * Rejects any refresh token whose `userType !== 'super-admin'` (403) so this
 * endpoint cannot be used to mint staff tokens.
 */
router.post('/refresh', refreshLimiter, async (req, res) => {
  try {
    const refreshToken = extractOpsRefreshToken(req);

    if (!refreshToken) {
      return res.status(400).json({ error: req.t('auth:errors.refreshTokenRequired') });
    }

    const decoded = jwt.verify(refreshToken, getJwtRefreshSecret());

    if (decoded.userType !== 'super-admin') {
      // This endpoint is ops-only. Staff refresh must go through /auth/refresh.
      return res.status(403).json({ error: req.t('auth:errors.invalidRefreshToken') });
    }

    let sessionId = decoded.sessionId;

    if (sessionId) {
      const existing = await Session.findOne(
        { sessionId, userType: 'super-admin' },
        { isRevoked: 1, expiresAt: 1 }
      ).lean();
      if (!existing || existing.isRevoked || existing.expiresAt < new Date()) {
        return res.status(401).json({ error: req.t('auth:errors.refreshTokenRevoked') });
      }
    } else {
      // Legacy refresh token (pre-sessionId) — mint a fresh session so future
      // refreshes are revocable. Matches the legacy `/auth/refresh` behaviour.
      sessionId = randomUUID();
      await createSuperAdminSessionRecord(req, sessionId);
    }

    const payload = buildSuperAdminAuthPayload();
    const newToken = generateToken(payload.id, payload.role, {
      userType: payload.userType,
      email: payload.email,
      name: payload.name,
      sessionId,
    });
    const newRefreshToken = jwt.sign(
      { userId: payload.id, userType: 'super-admin', sessionId },
      getJwtRefreshSecret(),
      { expiresIn: '30d' }
    );

    setOpsAuthCookie(res, newToken);
    setOpsRefreshCookie(res, newRefreshToken);

    return res.json(withAuthTokens(req, { success: true }, newToken, newRefreshToken));
  } catch (error) {
    logger.error({ err: error }, 'Super-admin refresh error');
    return res.status(401).json({ error: req.t('auth:errors.invalidRefreshToken') });
  }
});

/**
 * POST /api/v1/super-admin/auth/logout
 *
 * Revokes the current Session row by `sessionId` (decoded from the access
 * token — no verify, so an already-expired access token still triggers
 * invalidation, mirroring `routes/auth.js` `/logout`). Clears both cookies.
 *
 * Unlike the legacy `/auth/logout`, this does NOT call
 * `Staff.findByIdAndUpdate('super-admin', …)` — that was a silent no-op (the
 * literal id `'super-admin'` matches no Staff document); session revocation is
 * the actual invalidation mechanism for super-admin tokens.
 */
router.post('/logout', async (req, res) => {
  try {
    const token = extractOpsAuthToken(req);
    if (token) {
      // decode (not verify) so expired access tokens still trigger invalidation
      const decoded = jwt.decode(token);
      if (decoded?.sessionId) {
        await Session.findOneAndUpdate(
          { sessionId: decoded.sessionId, userType: 'super-admin' },
          { $set: { isRevoked: true, revokedAt: new Date() } }
        ).catch(() => {});
      }
    }
  } catch {
    // Ignore — still clear cookie and return success (parity with /auth/logout).
  }
  clearOpsCookies(res);
  return res.json({ success: true, message: req.t('auth:success.logout') });
});

/**
 * Ops auth middleware — reads the dedicated ops cookie (ems_ops_token) instead
 * of the shared staff cookie (ems_auth_token). Falls back to the legacy shared
 * cookie for sessions minted before the cookie split. Rejects non-super-admin
 * tokens (a staff token in the ops cookie is a misconfiguration).
 */
async function authenticateOps(req, res, next) {
  try {
    const token = extractOpsAuthToken(req);
    if (!token) {
      return res.status(401).json({ error: req.t('auth:errors.authRequired') });
    }
    const decoded = jwt.verify(token, getJwtSecret());
    if (!isSuperAdminUser(decoded)) {
      return res.status(403).json({ error: req.t('auth:errors.superAdminRequired') });
    }
    req.user = {
      id: decoded.userId || 'super-admin',
      userId: decoded.userId || 'super-admin',
      role: decoded.role || ['Super Admin'],
      userType: 'super-admin',
      schoolId: null,
      groupId: null,
      email: decoded.email || null,
      name: decoded.name || null,
      sessionId: decoded.sessionId || null,
    };
    return next();
  } catch (error) {
    return res.status(401).json({ error: req.t('auth:errors.authRequired') });
  }
}

/**
 * GET /api/v1/super-admin/auth/session
 *
 * Restores an existing super-admin session. Uses `authenticateOps` (reads the
 * dedicated ops cookie). Mirrors the super-admin branch of `GET /auth/session`:
 * re-mints fresh access + refresh tokens (rotating the refresh cookie) and
 * ensures a Session row exists.
 */
router.get('/session', authenticateOps, async (req, res) => {
  try {
    const payload = buildSuperAdminAuthPayload();
    let sessionId = req.user.sessionId;
    if (!sessionId) {
      sessionId = randomUUID();
      await createSuperAdminSessionRecord(req, sessionId);
    }
    const token = generateToken(payload.id, payload.role, {
      userType: payload.userType,
      email: payload.email,
      name: payload.name,
      sessionId,
    });
    const refreshToken = jwt.sign(
      { userId: payload.id, userType: 'super-admin', sessionId },
      getJwtRefreshSecret(),
      { expiresIn: '30d' }
    );
    setOpsAuthCookie(res, token);
    setOpsRefreshCookie(res, refreshToken);

    return res.json(withAuthTokens(req, payload, token, refreshToken));
  } catch (error) {
    logger.error({ err: error }, 'Super-admin session lookup error');
    return res.status(500).json({ error: 'Failed to restore session' });
  }
});

// Re-exports for tests / consumers that want the cookie names alongside the routes.
export {
  SUPER_ADMIN_AUTH_COOKIE_NAME as AUTH_COOKIE_NAME,
  SUPER_ADMIN_REFRESH_COOKIE_NAME as REFRESH_COOKIE_NAME,
};
export { isSuperAdminUser };
export const getJwtSecretForTests = getJwtSecret;
export default router;
