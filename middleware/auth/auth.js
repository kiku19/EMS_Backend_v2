import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { Staff, UserPermission } from '../../database.js';
import Session from '../../models/Session.js';
import School from '../../models/School.js';
import { getRequiredSecret } from '../../config/environment.js';
import { ensureDocumentSchool } from '../../utils/schoolContext.js';
import { isSuperAdminUser } from '../../utils/superAdmin.js';
import { Sentry } from '../../utils/sentry.js';
import { authenticateApiKey } from './apiKeyAuth.js';

const JWT_EXPIRES_IN = '8h';
export const AUTH_COOKIE_NAME = 'ems_auth_token';
const AUTH_COOKIE_MAX_AGE_MS = 8 * 60 * 60 * 1000;
export const REFRESH_COOKIE_NAME = 'ems_refresh_token';
const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function getJwtSecret() {
  return getRequiredSecret('JWT_SECRET');
}

function getAuthCookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax',
    secure: isProduction,
    maxAge: AUTH_COOKIE_MAX_AGE_MS,
    path: '/',
  };
}

function parseCookies(cookieHeader = '') {
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf('=');

      if (separatorIndex === -1) {
        return cookies;
      }

      const key = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      try {
        cookies[key] = decodeURIComponent(value);
      } catch {
        // Malformed percent-encoding (e.g. %ZZ) — use raw value
        cookies[key] = value;
      }
      return cookies;
    }, {});
}

export function extractTokenFromRequest(req) {
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith('Bearer ')) {
    const bearerToken = authHeader.substring(7).trim();
    if (bearerToken) {
      return bearerToken;
    }
  }

  const cookies = parseCookies(req.headers.cookie);
  return cookies[AUTH_COOKIE_NAME] || null;
}

export function setAuthCookie(res, token) {
  res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions());
}

function getRefreshCookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax',
    secure: isProduction,
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    path: '/',
  };
}

export function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE_NAME, token, getRefreshCookieOptions());
}

export function clearAuthCookie(res) {
  res.clearCookie(AUTH_COOKIE_NAME, {
    ...getAuthCookieOptions(),
    maxAge: undefined,
  });
  res.clearCookie(REFRESH_COOKIE_NAME, {
    ...getRefreshCookieOptions(),
    maxAge: undefined,
  });
}

export function extractRefreshTokenFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[REFRESH_COOKIE_NAME] || null;
}

/**
 * Generate JWT token for authenticated user
 */
export function generateToken(userId, role, extraClaims = {}) {
  return jwt.sign({ userId, role, ...extraClaims }, getJwtSecret(), { expiresIn: JWT_EXPIRES_IN });
}

async function buildAuthenticatedUser(decoded) {
  if (decoded.userType === 'super-admin' || isSuperAdminUser(decoded)) {
    return {
      id: decoded.userId || 'super-admin',
      _id: decoded.userId || 'super-admin',
      userId: decoded.userId || 'super-admin',
      role: decoded.role || ['Super Admin'],
      userType: 'super-admin',
      schoolId: null,
      groupId: null,
      email: decoded.email || null,
      name: decoded.name || null,
    };
  }

  if (decoded.userType === 'group-admin') {
    return {
      id: decoded.userId,
      _id: decoded.userId,
      userId: decoded.userId,
      role: decoded.role || ['Group Admin'],
      userType: 'group-admin',
      schoolId: decoded.schoolId || null,
      groupId: decoded.groupId || null,
      email: decoded.email || null,
      name: decoded.name || null,
    };
  }

  let schoolId = decoded.schoolId || null;

  if (!schoolId && decoded.userId && mongoose.Types.ObjectId.isValid(String(decoded.userId))) {
    const staff = await Staff.findById(decoded.userId).select('schoolId');
    if (staff) {
      const resolvedSchoolId = await ensureDocumentSchool(staff);
      schoolId = resolvedSchoolId?.toString?.() || resolvedSchoolId || null;
    }
  }

  return {
    id: decoded.userId,
    _id: decoded.userId,
    userId: decoded.userId,
    role: decoded.role,
    userType: decoded.userType || 'staff',
    schoolId,
    groupId: null,
    email: decoded.email || null,
    name: decoded.name || null,
  };
}

/**
 * Verify JWT token
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, getJwtSecret());
  } catch (error) {
    return null;
  }
}

/**
 * Authentication middleware - Verify user is logged in.
 * Supports both JWT tokens (Authorization: Bearer / cookie) and API keys (X-API-Key header).
 */
export async function authenticate(req, res, next) {
  // API key takes precedence when explicitly provided
  if (req.headers['x-api-key']) {
    return authenticateApiKey(req, res, next);
  }

  try {
    const token = extractTokenFromRequest(req);

    if (!token) {
      return res.status(401).json({
        error: req.t('auth:errors.authRequired'),
        message: req.t('auth:errors.noToken'),
      });
    }

    const decoded = verifyToken(token);

    if (!decoded) {
      return res.status(401).json({
        error: req.t('auth:errors.tokenInvalid'),
        message: req.t('auth:errors.sessionExpired'),
      });
    }

    req.user = await buildAuthenticatedUser(decoded);

    // For group-admins: honour the X-Branch-School-Id header so all school-scoped
    // queries target the branch the UI has selected.
    if (req.user.userType === 'group-admin' && req.user.groupId) {
      const branchHeader = req.headers['x-branch-school-id'];
      if (branchHeader && mongoose.Types.ObjectId.isValid(String(branchHeader))) {
        const branch = await School.findOne(
          { _id: branchHeader, groupId: req.user.groupId },
          { _id: 1 }
        ).lean();
        if (branch) {
          req.user.schoolId = String(branch._id);
        }
      }
    }

    // If the token carries a sessionId, check that the session hasn't been revoked
    if (decoded.sessionId) {
      req.user.sessionId = decoded.sessionId;
      const session = await Session.findOne(
        { sessionId: decoded.sessionId },
        { isRevoked: 1, expiresAt: 1 }
      ).lean();
      if (!session || session.isRevoked || session.expiresAt < new Date()) {
        return res.status(401).json({
          error: req.t('auth:errors.tokenInvalid'),
          message: 'Session has been revoked. Please login again.',
        });
      }
      // Lightweight activity update (fire-and-forget, no await)
      Session.findOneAndUpdate(
        { sessionId: decoded.sessionId },
        { $set: { lastActivityAt: new Date() } }
      ).catch(() => {});
    }

    // Tag each request with schoolId for tenant-scoped debugging in Sentry
    Sentry.getCurrentScope().setTag(
      'schoolId',
      req.user.schoolId || req.user.groupId || 'super-admin'
    );
    Sentry.getCurrentScope().setUser({
      id: req.user.userId,
      email: req.user.email || undefined,
    });

    next();
  } catch (error) {
    return res.status(401).json({
      error: req.t('auth:errors.authFailed'),
      message: error.message,
    });
  }
}

/**
 * Optional authentication - Don't fail if no token, just attach user if present
 */
export async function optionalAuth(req, res, next) {
  try {
    const token = extractTokenFromRequest(req);
    const decoded = token ? verifyToken(token) : null;

    if (decoded) {
      req.user = await buildAuthenticatedUser(decoded);
    }

    next();
  } catch (error) {
    next();
  }
}

/**
 * Require admin role
 */
export async function requireAdmin(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: req.t('auth:errors.authRequired'),
      });
    }

    const permissions = await UserPermission.findOne({ userId: req.user.userId });

    if (!permissions || permissions.role !== 'admin') {
      return res.status(403).json({
        error: req.t('auth:errors.adminRequired'),
        message: req.t('common:errors.noPermission'),
      });
    }

    next();
  } catch (error) {
    return res.status(500).json({
      error: req.t('auth:errors.permissionCheckFailed'),
      message: error.message,
    });
  }
}

/**
 * Require group-admin role (or super-admin, which can do everything)
 */
export async function requireGroupAdmin(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: req.t('auth:errors.authRequired') });
    }

    if (isSuperAdminUser(req.user)) {
      return next();
    }

    if (req.user.userType === 'group-admin') {
      return next();
    }

    return res.status(403).json({
      error: req.t('auth:errors.groupAdminRequired'),
      message: req.t('common:errors.noPermission'),
    });
  } catch (error) {
    return res.status(500).json({
      error: req.t('auth:errors.permissionCheckFailed'),
      message: error.message,
    });
  }
}

export async function requireSuperAdmin(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: req.t('auth:errors.authRequired'),
      });
    }

    if (!isSuperAdminUser(req.user)) {
      return res.status(403).json({
        error: req.t('auth:errors.superAdminRequired'),
        message: req.t('common:errors.noPermission'),
      });
    }

    next();
  } catch (error) {
    return res.status(500).json({
      error: req.t('auth:errors.permissionCheckFailed'),
      message: error.message,
    });
  }
}

export default {
  generateToken,
  verifyToken,
  setAuthCookie,
  setRefreshCookie,
  clearAuthCookie,
  extractRefreshTokenFromRequest,
  authenticate,
  optionalAuth,
  requireAdmin,
  requireGroupAdmin,
  requireSuperAdmin,
};
