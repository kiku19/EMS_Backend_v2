/**
 * Unit tests for middleware/auth/featureGate.js
 *
 * Tests the featureGate middleware factory using mocked featureFlagsService.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { featureGate } from '../middleware/auth/featureGate.js';

// Mock the feature flags service
vi.mock('../services/featureFlagsService.js', () => ({
  isFeatureEnabled: vi.fn(),
}));

import { isFeatureEnabled } from '../services/featureFlagsService.js';

function makeReqRes(user = { schoolId: 'school-1' }) {
  const req = {
    user,
    t: (key, opts) => `${key}${opts ? JSON.stringify(opts) : ''}`,
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

describe('featureGate', () => {
  it('calls next() when feature is enabled', async () => {
    isFeatureEnabled.mockResolvedValue(true);
    const { req, res } = makeReqRes();
    const next = vi.fn();

    await featureGate('advancedReports')(req, res, next);

    expect(isFeatureEnabled).toHaveBeenCalledWith('advancedReports', 'school-1');
    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 403 when feature is not enabled', async () => {
    isFeatureEnabled.mockResolvedValue(false);
    const { req, res } = makeReqRes();
    const next = vi.fn();

    await featureGate('advancedReports')(req, res, next);

    expect(res._status).toBe(403);
    expect(res._json.code).toBe('FEATURE_NOT_ENABLED');
    expect(res._json.featureKey).toBe('advancedReports');
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when user has no schoolId', async () => {
    const { req, res } = makeReqRes({});
    const next = vi.fn();

    await featureGate('anything')(req, res, next);

    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 500 when isFeatureEnabled throws', async () => {
    isFeatureEnabled.mockRejectedValue(new Error('DB down'));
    const { req, res } = makeReqRes();
    const next = vi.fn();

    await featureGate('reports')(req, res, next);

    expect(res._status).toBe(500);
    expect(next).not.toHaveBeenCalled();
  });
});
