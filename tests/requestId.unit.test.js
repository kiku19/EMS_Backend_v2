/**
 * Unit tests for middleware/observability/requestId.js
 *
 * Tests the requestIdMiddleware generates/passes through request IDs.
 */

import { describe, it, expect, vi } from 'vitest';

// Mock Sentry before importing the module
vi.mock('../utils/sentry.js', () => ({
  Sentry: {
    getCurrentScope: () => ({ setTag: vi.fn() }),
  },
  captureError: vi.fn(),
}));

import { requestIdMiddleware } from '../middleware/observability/requestId.js';

function makeReqRes(headers = {}) {
  const resHeaders = {};
  const req = { headers };
  const res = {
    setHeader(key, val) {
      resHeaders[key] = val;
    },
    _headers: resHeaders,
  };
  return { req, res, resHeaders };
}

describe('requestIdMiddleware', () => {
  it('generates a UUID when no X-Request-ID header is present', () => {
    const { req, res, resHeaders } = makeReqRes();
    const next = vi.fn();

    requestIdMiddleware(req, res, next);

    expect(req.requestId).toBeDefined();
    expect(req.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(resHeaders['X-Request-ID']).toBe(req.requestId);
    expect(next).toHaveBeenCalledOnce();
  });

  it('uses existing X-Request-ID header if present', () => {
    const { req, res, resHeaders } = makeReqRes({ 'x-request-id': 'upstream-123' });
    const next = vi.fn();

    requestIdMiddleware(req, res, next);

    expect(req.requestId).toBe('upstream-123');
    expect(resHeaders['X-Request-ID']).toBe('upstream-123');
    expect(next).toHaveBeenCalledOnce();
  });
});
