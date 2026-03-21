/**
 * Unit tests for middleware/observability/errorHandler.js
 *
 * Tests ApiError, createError, errorHandler middleware, notFoundHandler,
 * asyncHandler, and sendError using mock req/res objects.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  ApiError,
  createError,
  errorHandler,
  notFoundHandler,
  asyncHandler,
  sendError,
} from '../middleware/observability/errorHandler.js';

// Suppress Sentry calls in tests
vi.mock('../utils/sentry.js', () => ({
  captureError: vi.fn(),
  Sentry: { getCurrentScope: () => ({ setTag: vi.fn() }) },
}));

function makeReqRes(overrides = {}) {
  const req = {
    method: 'GET',
    path: '/test',
    originalUrl: '/api/test',
    requestId: 'req-123',
    user: { schoolId: 's1', _id: 'u1' },
    t: (key, opts) => key,
    ...overrides,
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

// ---------------------------------------------------------------------------
// ApiError
// ---------------------------------------------------------------------------

describe('ApiError', () => {
  it('creates an error with statusCode and message', () => {
    const err = new ApiError(400, 'Bad request');
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Bad request');
    expect(err.isOperational).toBe(true);
    expect(err.details).toBeNull();
    expect(err instanceof Error).toBe(true);
  });

  it('supports optional details', () => {
    const err = new ApiError(422, 'Validation', { field: 'name' });
    expect(err.details).toEqual({ field: 'name' });
  });
});

// ---------------------------------------------------------------------------
// createError
// ---------------------------------------------------------------------------

describe('createError', () => {
  it('returns an ApiError instance', () => {
    const err = createError(404, 'Not found');
    expect(err).toBeInstanceOf(ApiError);
    expect(err.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// errorHandler middleware
// ---------------------------------------------------------------------------

describe('errorHandler', () => {
  it('handles a generic error defaulting to 500', () => {
    const { req, res } = makeReqRes();
    const err = new Error('Something broke');
    const next = vi.fn();

    errorHandler(err, req, res, next);

    expect(res._status).toBe(500);
    expect(res._json.success).toBe(false);
    expect(res._json.error).toBe('Something broke');
  });

  it('handles ApiError with custom statusCode', () => {
    const { req, res } = makeReqRes();
    const err = new ApiError(403, 'Forbidden', { reason: 'no access' });

    errorHandler(err, req, res, vi.fn());

    expect(res._status).toBe(403);
    expect(res._json.error).toBe('Forbidden');
    expect(res._json.details).toEqual({ reason: 'no access' });
  });

  it('handles Mongoose ValidationError → 400', () => {
    const { req, res } = makeReqRes();
    const err = new Error('Validation failed');
    err.name = 'ValidationError';
    err.errors = {
      name: { path: 'name', message: 'Name is required' },
    };

    errorHandler(err, req, res, vi.fn());

    expect(res._status).toBe(400);
    expect(res._json.details).toEqual([{ field: 'name', message: 'Name is required' }]);
  });

  it('handles CastError → 400', () => {
    const { req, res } = makeReqRes();
    const err = new Error('Cast error');
    err.name = 'CastError';
    err.path = '_id';
    err.value = 'bad-id';

    errorHandler(err, req, res, vi.fn());

    expect(res._status).toBe(400);
    expect(res._json.details).toEqual({ field: '_id', value: 'bad-id' });
  });

  it('handles duplicate key error (code 11000) → 409', () => {
    const { req, res } = makeReqRes();
    const err = new Error('Duplicate');
    err.code = 11000;
    err.keyPattern = { email: 1 };

    errorHandler(err, req, res, vi.fn());

    expect(res._status).toBe(409);
    expect(res._json.details.field).toBe('email');
  });

  it('handles JsonWebTokenError → 401', () => {
    const { req, res } = makeReqRes();
    const err = new Error('invalid token');
    err.name = 'JsonWebTokenError';

    errorHandler(err, req, res, vi.fn());

    expect(res._status).toBe(401);
  });

  it('handles TokenExpiredError → 401', () => {
    const { req, res } = makeReqRes();
    const err = new Error('jwt expired');
    err.name = 'TokenExpiredError';

    errorHandler(err, req, res, vi.fn());

    expect(res._status).toBe(401);
  });

  it('does not include stack in non-development mode', () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const { req, res } = makeReqRes();

    errorHandler(new Error('oops'), req, res, vi.fn());

    expect(res._json.stack).toBeUndefined();
    process.env.NODE_ENV = origEnv;
  });
});

// ---------------------------------------------------------------------------
// notFoundHandler
// ---------------------------------------------------------------------------

describe('notFoundHandler', () => {
  it('calls next() with a 404 ApiError', () => {
    const { req } = makeReqRes();
    const next = vi.fn();

    notFoundHandler(req, {}, next);

    expect(next).toHaveBeenCalledOnce();
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(ApiError);
    expect(err.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// asyncHandler
// ---------------------------------------------------------------------------

describe('asyncHandler', () => {
  it('passes resolved result through', async () => {
    const handler = asyncHandler(async (req, res) => {
      res.json({ ok: true });
    });
    const { req, res } = makeReqRes();
    const next = vi.fn();

    await handler(req, res, next);

    expect(res._json).toEqual({ ok: true });
    expect(next).not.toHaveBeenCalled();
  });

  it('catches async errors and passes to next()', async () => {
    const handler = asyncHandler(async () => {
      throw new Error('async boom');
    });
    const { req, res } = makeReqRes();
    const next = vi.fn();

    await handler(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0][0].message).toBe('async boom');
  });
});

// ---------------------------------------------------------------------------
// sendError
// ---------------------------------------------------------------------------

describe('sendError', () => {
  it('sends a structured error response', () => {
    const { req, res } = makeReqRes();

    sendError(res, 400, 'Invalid input', [{ field: 'name' }]);

    expect(res._status).toBe(400);
    expect(res._json.success).toBe(false);
    expect(res._json.error).toBe('Invalid input');
    expect(res._json.details).toEqual([{ field: 'name' }]);
  });

  it('sends response without details when not provided', () => {
    const { res } = makeReqRes();

    sendError(res, 500, 'Server error');

    expect(res._status).toBe(500);
    expect(res._json.details).toBeUndefined();
  });
});
