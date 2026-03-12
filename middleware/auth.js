import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { Staff, UserPermission } from '../database.js';
import { getRequiredSecret } from '../config/environment.js';
import { ensureDocumentSchool } from '../utils/schoolContext.js';
import { isSuperAdminUser } from '../utils/superAdmin.js';

const JWT_EXPIRES_IN = '8h';
export const AUTH_COOKIE_NAME = 'ems_auth_token';
const AUTH_COOKIE_MAX_AGE_MS = 8 * 60 * 60 * 1000;

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
      cookies[key] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function extractTokenFromRequest(req) {
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

export function clearAuthCookie(res) {
  res.clearCookie(AUTH_COOKIE_NAME, {
    ...getAuthCookieOptions(),
    maxAge: undefined,
  });
}

/**
 * Generate JWT token for authenticated user
 */
export function generateToken(userId, role, extraClaims = {}) {
  return jwt.sign(
    { userId, role, ...extraClaims },
    getJwtSecret(),
    { expiresIn: JWT_EXPIRES_IN }
  );
}

async function buildAuthenticatedUser(decoded) {
  if (decoded.userType === 'super-admin' || isSuperAdminUser(decoded)) {
    return {
      id: decoded.userId || 'super-admin',
      userId: decoded.userId || 'super-admin',
      role: decoded.role || ['Super Admin'],
      userType: 'super-admin',
      schoolId: null,
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
    userId: decoded.userId,
    role: decoded.role,
    userType: decoded.userType || 'staff',
    schoolId,
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
 * Authentication middleware - Verify user is logged in
 */
export async function authenticate(req, res, next) {
  try {
    const token = extractTokenFromRequest(req);

    if (!token) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'No token provided'
      });
    }

    const decoded = verifyToken(token);

    if (!decoded) {
      return res.status(401).json({
        error: 'Invalid or expired token',
        message: 'Please login again'
      });
    }

    req.user = await buildAuthenticatedUser(decoded);

    next();
  } catch (error) {
    return res.status(401).json({
      error: 'Authentication failed',
      message: error.message
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
        error: 'Authentication required'
      });
    }

    const permissions = await UserPermission.findOne({ userId: req.user.userId });

    if (!permissions || permissions.role !== 'admin') {
      return res.status(403).json({
        error: 'Admin access required',
        message: 'You do not have permission to perform this action'
      });
    }

    next();
  } catch (error) {
    return res.status(500).json({
      error: 'Permission check failed',
      message: error.message
    });
  }
}

export async function requireSuperAdmin(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required'
      });
    }

    if (!isSuperAdminUser(req.user)) {
      return res.status(403).json({
        error: 'Super admin access required',
        message: 'You do not have permission to perform this action'
      });
    }

    next();
  } catch (error) {
    return res.status(500).json({
      error: 'Permission check failed',
      message: error.message
    });
  }
}

export default {
  generateToken,
  verifyToken,
  setAuthCookie,
  clearAuthCookie,
  authenticate,
  optionalAuth,
  requireAdmin,
  requireSuperAdmin
};
