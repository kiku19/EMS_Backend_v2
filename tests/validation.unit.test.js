/**
 * Unit tests for middleware/validation.js
 *
 * Tests pure utility functions (sanitizeString, isValidObjectId,
 * sanitizeQueryStr, sanitizeQueryId) and the middleware factories
 * (validate, validateZod) using mock req/res/next objects.
 *
 * No database or HTTP server required.
 */

import { describe, it, expect, vi } from 'vitest';
import Joi from 'joi';
import { z } from 'zod';
import {
  sanitizeString,
  isValidObjectId,
  sanitizeQueryStr,
  sanitizeQueryId,
  validate,
  validateZod,
} from '../middleware/validation.js';

// ---------------------------------------------------------------------------
// sanitizeString
// ---------------------------------------------------------------------------

describe('sanitizeString', () => {
  it('trims leading and trailing whitespace', () => {
    expect(sanitizeString('  hello  ')).toBe('hello');
  });

  it('removes angle brackets (XSS protection)', () => {
    expect(sanitizeString('<script>alert(1)</script>')).toBe('scriptalert(1)/script');
  });

  it('removes javascript: protocol', () => {
    expect(sanitizeString('javascript:alert(1)')).toBe('alert(1)');
  });

  it('removes inline event handlers', () => {
    expect(sanitizeString('onclick=doEvil()')).toBe('doEvil()');
  });

  it('returns non-string values unchanged', () => {
    expect(sanitizeString(42)).toBe(42);
    expect(sanitizeString(null)).toBeNull();
    expect(sanitizeString(undefined)).toBeUndefined();
  });

  it('returns a clean string unchanged', () => {
    expect(sanitizeString('Hello World')).toBe('Hello World');
  });
});

// ---------------------------------------------------------------------------
// isValidObjectId
// ---------------------------------------------------------------------------

describe('isValidObjectId', () => {
  it('returns true for a valid 24-char hex string', () => {
    expect(isValidObjectId('507f1f77bcf86cd799439011')).toBe(true);
  });

  it('returns true for uppercase hex', () => {
    expect(isValidObjectId('507F1F77BCF86CD799439011')).toBe(true);
  });

  it('returns false for a 23-char string (too short)', () => {
    expect(isValidObjectId('507f1f77bcf86cd79943901')).toBe(false);
  });

  it('returns false for a 25-char string (too long)', () => {
    expect(isValidObjectId('507f1f77bcf86cd7994390111')).toBe(false);
  });

  it('returns false for a string containing non-hex characters', () => {
    expect(isValidObjectId('507f1f77bcf86cd79943901g')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isValidObjectId('')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isValidObjectId(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sanitizeQueryStr
// ---------------------------------------------------------------------------

describe('sanitizeQueryStr', () => {
  it('returns the trimmed string for a non-empty string', () => {
    expect(sanitizeQueryStr('  hello  ')).toBe('hello');
  });

  it('returns the string unchanged when no extra whitespace', () => {
    expect(sanitizeQueryStr('active')).toBe('active');
  });

  it('returns undefined for an empty string', () => {
    expect(sanitizeQueryStr('')).toBeUndefined();
  });

  it('returns undefined for an object (NoSQL injection protection)', () => {
    expect(sanitizeQueryStr({ $ne: 'x' })).toBeUndefined();
  });

  it('returns undefined for null', () => {
    expect(sanitizeQueryStr(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(sanitizeQueryStr(undefined)).toBeUndefined();
  });

  it('returns undefined for a number', () => {
    expect(sanitizeQueryStr(42)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// sanitizeQueryId
// ---------------------------------------------------------------------------

describe('sanitizeQueryId', () => {
  it('returns the ObjectId string for a valid 24-char hex', () => {
    const id = '507f1f77bcf86cd799439011';
    expect(sanitizeQueryId(id)).toBe(id);
  });

  it('returns undefined for an invalid ObjectId string', () => {
    expect(sanitizeQueryId('not-an-id')).toBeUndefined();
  });

  it('returns undefined for an object (NoSQL injection protection)', () => {
    expect(sanitizeQueryId({ $gt: '' })).toBeUndefined();
  });

  it('returns undefined for null', () => {
    expect(sanitizeQueryId(null)).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(sanitizeQueryId('')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// validate middleware (Joi)
// ---------------------------------------------------------------------------

describe('validate middleware (Joi)', () => {
  const schema = Joi.object({
    name: Joi.string().required().min(2),
    age: Joi.number().min(0),
  });

  function makeReqRes(body) {
    const req = { body, params: {}, query: {} };
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

  it('calls next() and updates req.body for valid input', () => {
    const { req, res } = makeReqRes({ name: 'Alice', age: 30 });
    const next = vi.fn();

    validate(schema)(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.body.name).toBe('Alice');
  });

  it('returns 400 for missing required field', () => {
    const { req, res } = makeReqRes({ age: 30 });
    const next = vi.fn();

    validate(schema)(req, res, next);

    expect(res._status).toBe(400);
    expect(res._json.error).toBe('Validation failed');
    expect(res._json.details.length).toBeGreaterThan(0);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 400 for wrong type', () => {
    const { req, res } = makeReqRes({ name: 'Alice', age: 'not-a-number' });
    const next = vi.fn();

    validate(schema)(req, res, next);

    expect(res._status).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('strips unknown fields (stripUnknown: true)', () => {
    const { req, res } = makeReqRes({ name: 'Alice', age: 20, unknown: 'field' });
    const next = vi.fn();

    validate(schema)(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.body.unknown).toBeUndefined();
  });

  it('validates from req.params when source is "params"', () => {
    const paramsSchema = Joi.object({
      id: Joi.string()
        .pattern(/^[0-9a-fA-F]{24}$/)
        .required(),
    });
    const req = { params: { id: '507f1f77bcf86cd799439011' }, body: {}, query: {} };
    const res = {
      _status: null,
      _json: null,
      status(c) {
        this._status = c;
        return this;
      },
      json(d) {
        this._json = d;
        return this;
      },
    };
    const next = vi.fn();

    validate(paramsSchema, 'params')(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.params.id).toBe('507f1f77bcf86cd799439011');
  });

  it('validates from req.query when source is "query"', () => {
    const querySchema = Joi.object({ page: Joi.number().min(1).default(1) });
    const req = { query: { page: '2' }, body: {}, params: {} };
    const res = {
      _status: null,
      _json: null,
      status(c) {
        this._status = c;
        return this;
      },
      json(d) {
        this._json = d;
        return this;
      },
    };
    const next = vi.fn();

    validate(querySchema, 'query')(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// validateZod middleware
// ---------------------------------------------------------------------------

describe('validateZod middleware', () => {
  const schema = z.object({
    name: z.string().min(2),
    age: z.number().min(0).optional(),
  });

  function makeReqRes(body) {
    const req = { body, params: {}, query: {} };
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

  it('calls next() and updates req.body for valid input', () => {
    const { req, res } = makeReqRes({ name: 'Bob', age: 25 });
    const next = vi.fn();

    validateZod(schema)(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.body.name).toBe('Bob');
  });

  it('returns 400 for missing required field', () => {
    const { req, res } = makeReqRes({ age: 25 });
    const next = vi.fn();

    validateZod(schema)(req, res, next);

    expect(res._status).toBe(400);
    expect(res._json.error).toBe('Validation failed');
    expect(res._json.details.length).toBeGreaterThan(0);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 400 with field path in errors', () => {
    const { req, res } = makeReqRes({});
    const next = vi.fn();

    validateZod(schema)(req, res, next);

    expect(res._status).toBe(400);
    const fields = res._json.details.map((d) => d.field);
    expect(fields).toContain('name');
  });

  it('validates from req.params when source is "params"', () => {
    const paramsSchema = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/) });
    const req = { params: { id: '507f1f77bcf86cd799439011' }, body: {}, query: {} };
    const res = {
      _status: null,
      _json: null,
      status(c) {
        this._status = c;
        return this;
      },
      json(d) {
        this._json = d;
        return this;
      },
    };
    const next = vi.fn();

    validateZod(paramsSchema, 'params')(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('returns 400 for invalid params', () => {
    const paramsSchema = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/) });
    const req = { params: { id: 'not-valid' }, body: {}, query: {} };
    const res = {
      _status: null,
      _json: null,
      status(c) {
        this._status = c;
        return this;
      },
      json(d) {
        this._json = d;
        return this;
      },
    };
    const next = vi.fn();

    validateZod(paramsSchema, 'params')(req, res, next);

    expect(res._status).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });
});
