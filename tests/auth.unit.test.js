/**
 * Unit tests for middleware/auth.js
 *
 * Tests pure functions (generateToken, verifyToken, extractTokenFromRequest)
 * and middleware factories (authenticate, optionalAuth, requireAdmin,
 * requireSuperAdmin, requireGroupAdmin) using mock req/res/next objects.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import {
  generateToken,
  verifyToken,
  extractTokenFromRequest,
  authenticate,
  optionalAuth,
  requireAdmin,
  requireSuperAdmin,
  requireGroupAdmin,
  AUTH_COOKIE_NAME,
} from '../middleware/auth.js';
import { UserPermission } from '../database.js';
import { createStaffUser } from './helpers/factories.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockRes() {
  const res = {
    _status: null,
    _json: null,
    _cookies: {},
    status(code) {
      this._status = code;
      return this;
    },
    json(data) {
      this._json = data;
      return this;
    },
    cookie(name, value, opts) {
      this._cookies[name] = { value, opts };
    },
    clearCookie(name) {
      delete this._cookies[name];
    },
  };
  return res;
}

function mockReq(overrides = {}) {
  return { headers: {}, t: (key) => key, ...overrides };
}

// ---------------------------------------------------------------------------
// generateToken / verifyToken
// ---------------------------------------------------------------------------

describe('generateToken', () => {
  it('returns a non-empty string', () => {
    const token = generateToken('user-id-123', 'admin');
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  it('encodes userId and role in the payload', () => {
    const token = generateToken('abc123', 'teacher');
    const decoded = verifyToken(token);
    expect(decoded.userId).toBe('abc123');
    expect(decoded.role).toBe('teacher');
  });

  it('encodes extra claims', () => {
    const token = generateToken('u1', 'admin', { schoolId: 'school-1', email: 'a@b.com' });
    const decoded = verifyToken(token);
    expect(decoded.schoolId).toBe('school-1');
    expect(decoded.email).toBe('a@b.com');
  });
});

describe('verifyToken', () => {
  it('returns decoded payload for a valid token', () => {
    const token = generateToken('user42', ['Admin']);
    const decoded = verifyToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded.userId).toBe('user42');
  });

  it('returns null for a tampered token', () => {
    const token = generateToken('u1', 'admin');
    const tampered = token.slice(0, -4) + 'xxxx';
    expect(verifyToken(tampered)).toBeNull();
  });

  it('returns null for a random string', () => {
    expect(verifyToken('not.a.jwt')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(verifyToken('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractTokenFromRequest
// ---------------------------------------------------------------------------

describe('extractTokenFromRequest', () => {
  it('extracts token from Authorization: Bearer header', () => {
    const req = mockReq({ headers: { authorization: 'Bearer my-token-123' } });
    expect(extractTokenFromRequest(req)).toBe('my-token-123');
  });

  it('returns null when Authorization header is missing', () => {
    const req = mockReq({ headers: {} });
    expect(extractTokenFromRequest(req)).toBeNull();
  });

  it('returns null when Authorization header is not Bearer scheme', () => {
    const req = mockReq({ headers: { authorization: 'Basic dXNlcjpwYXNz' } });
    expect(extractTokenFromRequest(req)).toBeNull();
  });

  it('extracts token from cookie when no Authorization header', () => {
    const req = mockReq({ headers: { cookie: `${AUTH_COOKIE_NAME}=cookie-token-xyz` } });
    expect(extractTokenFromRequest(req)).toBe('cookie-token-xyz');
  });

  it('prefers Authorization header over cookie', () => {
    const req = mockReq({
      headers: {
        authorization: 'Bearer header-token',
        cookie: `${AUTH_COOKIE_NAME}=cookie-token`,
      },
    });
    expect(extractTokenFromRequest(req)).toBe('header-token');
  });

  it('returns null when cookie does not contain auth token', () => {
    const req = mockReq({ headers: { cookie: 'other_cookie=value' } });
    expect(extractTokenFromRequest(req)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// authenticate middleware
// ---------------------------------------------------------------------------

describe('authenticate middleware', () => {
  it('returns 401 when no token is provided', async () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(res._status).toBe(401);
    expect(res._json.error).toBe('auth:errors.authRequired');
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when token is invalid', async () => {
    const req = mockReq({ headers: { authorization: 'Bearer bad-token' } });
    const res = mockRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(res._status).toBe(401);
    expect(res._json.error).toBe('auth:errors.authFailed');
    expect(next).not.toHaveBeenCalled();
  });

  it('attaches user and calls next() for a valid super-admin token', async () => {
    const token = generateToken('super-admin', ['Super Admin'], { userType: 'super-admin' });
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res = mockRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user.userType).toBe('super-admin');
    expect(req.user.schoolId).toBeNull();
  });

  it('attaches user and calls next() for a valid staff token with schoolId', async () => {
    const staff = await createStaffUser();
    const token = generateToken(staff._id.toString(), 'admin', {
      schoolId: staff.schoolId.toString(),
      userType: 'staff',
    });
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res = mockRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user.userId).toBe(staff._id.toString());
  });
});

// ---------------------------------------------------------------------------
// optionalAuth middleware
// ---------------------------------------------------------------------------

describe('optionalAuth middleware', () => {
  it('calls next() without setting req.user when no token is provided', async () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    await optionalAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  it('attaches user and calls next() for a valid token', async () => {
    const token = generateToken('super-admin', ['Super Admin'], { userType: 'super-admin' });
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res = mockRes();
    const next = vi.fn();

    await optionalAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user.userType).toBe('super-admin');
  });

  it('calls next() without throwing for an invalid token', async () => {
    const req = mockReq({ headers: { authorization: 'Bearer totally-invalid' } });
    const res = mockRes();
    const next = vi.fn();

    await optionalAuth(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// requireAdmin middleware
// ---------------------------------------------------------------------------

describe('requireAdmin middleware', () => {
  it('returns 401 when req.user is not set', async () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    await requireAdmin(req, res, next);

    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when user has no UserPermission record', async () => {
    const req = mockReq();
    req.user = { userId: new mongoose.Types.ObjectId().toString() };
    const res = mockRes();
    const next = vi.fn();

    await requireAdmin(req, res, next);

    expect(res._status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when user permission role is not admin', async () => {
    const staff = await createStaffUser({ permissionRole: 'teacher' });
    const req = mockReq();
    req.user = { userId: staff._id.toString() };
    const res = mockRes();
    const next = vi.fn();

    await requireAdmin(req, res, next);

    expect(res._status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when user has admin role in UserPermission', async () => {
    const staff = await createStaffUser({ permissionRole: 'admin' });
    const req = mockReq();
    req.user = { userId: staff._id.toString() };
    const res = mockRes();
    const next = vi.fn();

    await requireAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// requireSuperAdmin middleware
// ---------------------------------------------------------------------------

describe('requireSuperAdmin middleware', () => {
  it('returns 401 when req.user is not set', async () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    await requireSuperAdmin(req, res, next);

    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 for a regular staff user', async () => {
    const req = mockReq();
    req.user = { userId: 'staff-id', userType: 'staff', role: ['Teacher'] };
    const res = mockRes();
    const next = vi.fn();

    await requireSuperAdmin(req, res, next);

    expect(res._status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() for a super-admin user (userType)', async () => {
    const req = mockReq();
    req.user = { userId: 'super-admin', userType: 'super-admin', role: ['Super Admin'] };
    const res = mockRes();
    const next = vi.fn();

    await requireSuperAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('calls next() for a user with Super Admin role', async () => {
    const req = mockReq();
    req.user = { userId: 'super-admin', userType: 'staff', role: ['Super Admin'] };
    const res = mockRes();
    const next = vi.fn();

    await requireSuperAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// requireGroupAdmin middleware
// ---------------------------------------------------------------------------

describe('requireGroupAdmin middleware', () => {
  it('returns 401 when req.user is not set', async () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    await requireGroupAdmin(req, res, next);

    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 for a regular staff user', async () => {
    const req = mockReq();
    req.user = { userId: 'staff-id', userType: 'staff', role: ['Teacher'] };
    const res = mockRes();
    const next = vi.fn();

    await requireGroupAdmin(req, res, next);

    expect(res._status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() for a group-admin user', async () => {
    const req = mockReq();
    req.user = { userId: 'ga-id', userType: 'group-admin', role: ['Group Admin'] };
    const res = mockRes();
    const next = vi.fn();

    await requireGroupAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('calls next() for a super-admin user (bypass)', async () => {
    const req = mockReq();
    req.user = { userId: 'super-admin', userType: 'super-admin', role: ['Super Admin'] };
    const res = mockRes();
    const next = vi.fn();

    await requireGroupAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
