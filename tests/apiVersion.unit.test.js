/**
 * Unit tests for middleware/observability/apiVersion.js
 *
 * Tests API version header injection and deprecation warning middleware.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  CURRENT_API_VERSION,
  addApiVersionHeader,
  deprecationWarning,
} from '../middleware/observability/apiVersion.js';

function makeReqRes(path = '/test') {
  const req = { path };
  const headers = {};
  const res = {
    setHeader(key, val) {
      headers[key] = val;
    },
    _headers: headers,
  };
  return { req, res, headers };
}

// ---------------------------------------------------------------------------
// CURRENT_API_VERSION
// ---------------------------------------------------------------------------

describe('CURRENT_API_VERSION', () => {
  it('is "v1"', () => {
    expect(CURRENT_API_VERSION).toBe('v1');
  });
});

// ---------------------------------------------------------------------------
// addApiVersionHeader
// ---------------------------------------------------------------------------

describe('addApiVersionHeader', () => {
  it('sets the X-API-Version response header', () => {
    const { req, res, headers } = makeReqRes();
    const next = vi.fn();

    addApiVersionHeader(req, res, next);

    expect(headers['X-API-Version']).toBe('v1');
    expect(next).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// deprecationWarning
// ---------------------------------------------------------------------------

describe('deprecationWarning', () => {
  it('sets Deprecation, Sunset, and Link headers', () => {
    const { req, res, headers } = makeReqRes('/students');
    const next = vi.fn();

    deprecationWarning(req, res, next);

    expect(headers['Deprecation']).toBe('true');
    expect(headers['Sunset']).toBe('Mon, 01 Jan 2029 00:00:00 GMT');
    expect(headers['Link']).toBe('</api/v1/students>; rel="successor-version"');
    expect(next).toHaveBeenCalledOnce();
  });

  it('uses the request path in the Link header', () => {
    const { req, res, headers } = makeReqRes('/classes/123');
    const next = vi.fn();

    deprecationWarning(req, res, next);

    expect(headers['Link']).toContain('/api/v1/classes/123');
  });
});
