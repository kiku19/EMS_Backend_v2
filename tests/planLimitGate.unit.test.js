/**
 * Unit tests for middleware/auth/planLimitGate.js
 *
 * Tests the planLimitGate middleware factory using mocked billingService.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { planLimitGate } from '../middleware/auth/planLimitGate.js';

// Mock billingService
vi.mock('../services/billingService.js', () => ({
  assertSchoolWithinLimit: vi.fn(),
}));

import { assertSchoolWithinLimit } from '../services/billingService.js';

function makeReqRes(user = { schoolId: 'school-1' }) {
  const req = {
    user,
    t: (key) => key,
  };
  const res = {
    _status: null,
    _json: null,
    status(code) {
      this._status = code;
      return this;
    },
    json(data) {
      this._json = data;
      return this;
    },
  };
  return { req, res };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('planLimitGate', () => {
  it('calls next() when within limit', async () => {
    assertSchoolWithinLimit.mockResolvedValue(undefined);
    const { req, res } = makeReqRes();
    const next = vi.fn();

    await planLimitGate('students')(req, res, next);

    expect(assertSchoolWithinLimit).toHaveBeenCalledWith({
      schoolId: 'school-1',
      metric: 'students',
      delta: 1,
    });
    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 403 with PLAN_LIMIT_REACHED when limit exceeded', async () => {
    const limitError = new Error('Student limit reached');
    limitError.code = 'PLAN_LIMIT_REACHED';
    limitError.details = { metric: 'students', current: 50, limit: 50 };
    assertSchoolWithinLimit.mockRejectedValue(limitError);

    const { req, res } = makeReqRes();
    const next = vi.fn();

    await planLimitGate('students')(req, res, next);

    expect(res._status).toBe(403);
    expect(res._json.code).toBe('PLAN_LIMIT_REACHED');
    expect(res._json.details.metric).toBe('students');
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when user has no schoolId', async () => {
    const { req, res } = makeReqRes({});
    const next = vi.fn();

    await planLimitGate('students')(req, res, next);

    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('supports custom getDelta function', async () => {
    assertSchoolWithinLimit.mockResolvedValue(undefined);
    const { req, res } = makeReqRes();
    req.file = { size: 5 * 1024 * 1024 }; // 5MB
    const next = vi.fn();

    const getDelta = (r) => r.file.size / (1024 * 1024);

    await planLimitGate('storageMb', getDelta)(req, res, next);

    expect(assertSchoolWithinLimit).toHaveBeenCalledWith({
      schoolId: 'school-1',
      metric: 'storageMb',
      delta: 5,
    });
    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 500 on unexpected errors', async () => {
    assertSchoolWithinLimit.mockRejectedValue(new Error('DB down'));
    const { req, res } = makeReqRes();
    const next = vi.fn();

    await planLimitGate('students')(req, res, next);

    expect(res._status).toBe(500);
    expect(next).not.toHaveBeenCalled();
  });
});
