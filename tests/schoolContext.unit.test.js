/**
 * Unit tests for utils/schoolContext.js
 *
 * Covers both pure helpers (no DB) and async DB functions using the
 * in-memory MongoDB server spun up by tests/setup.js.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import {
  normalizeSchoolCode,
  extractSchoolId,
  buildSchoolScopedQuery,
  serializeSchool,
  ensureDefaultSchool,
  resolveSchool,
  ensureDocumentSchool,
} from '../utils/schoolContext.js';
import School from '../models/School.js';

// ---------------------------------------------------------------------------
// normalizeSchoolCode
// ---------------------------------------------------------------------------

describe('normalizeSchoolCode', () => {
  it('converts lowercase to uppercase', () => {
    expect(normalizeSchoolCode('abc')).toBe('ABC');
  });

  it('replaces spaces with hyphens', () => {
    expect(normalizeSchoolCode('My School')).toBe('MY-SCHOOL');
  });

  it('strips non-alphanumeric characters (special chars)', () => {
    expect(normalizeSchoolCode('School@2025!')).toBe('SCHOOL-2025');
  });

  it('trims leading and trailing hyphens', () => {
    expect(normalizeSchoolCode('--abc--')).toBe('ABC');
  });

  it('truncates to 40 characters', () => {
    const long = 'A'.repeat(50);
    expect(normalizeSchoolCode(long).length).toBeLessThanOrEqual(40);
  });

  it('returns empty string for null', () => {
    expect(normalizeSchoolCode(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(normalizeSchoolCode(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(normalizeSchoolCode('')).toBe('');
  });

  it('handles numeric input by converting to string', () => {
    expect(normalizeSchoolCode(123)).toBe('123');
  });
});

// ---------------------------------------------------------------------------
// extractSchoolId
// ---------------------------------------------------------------------------

describe('extractSchoolId', () => {
  it('returns null for null input', () => {
    expect(extractSchoolId(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(extractSchoolId(undefined)).toBeNull();
  });

  it('returns string for a plain string id', () => {
    expect(extractSchoolId('507f1f77bcf86cd799439011')).toBe('507f1f77bcf86cd799439011');
  });

  it('extracts _id from an object with _id property', () => {
    const obj = { _id: '507f1f77bcf86cd799439011' };
    expect(extractSchoolId(obj)).toBe('507f1f77bcf86cd799439011');
  });

  it('extracts _id from a Mongoose ObjectId-like object', () => {
    const id = new mongoose.Types.ObjectId();
    const obj = { _id: id };
    expect(extractSchoolId(obj)).toBe(id.toString());
  });

  it('converts a Mongoose ObjectId to string', () => {
    const id = new mongoose.Types.ObjectId();
    expect(extractSchoolId(id)).toBe(id.toString());
  });
});

// ---------------------------------------------------------------------------
// buildSchoolScopedQuery
// ---------------------------------------------------------------------------

describe('buildSchoolScopedQuery', () => {
  it('returns query with schoolId when schoolId is a string', () => {
    const result = buildSchoolScopedQuery('school-123', { name: 'Alice' });
    expect(result).toEqual({ name: 'Alice', schoolId: 'school-123' });
  });

  it('returns query with schoolId extracted from an object', () => {
    const id = new mongoose.Types.ObjectId();
    const result = buildSchoolScopedQuery({ _id: id }, { status: 'active' });
    expect(result.schoolId).toBe(id.toString());
  });

  it('returns query without schoolId when schoolId is null', () => {
    const result = buildSchoolScopedQuery(null, { name: 'test' });
    expect(result).toEqual({ name: 'test' });
    expect(result.schoolId).toBeUndefined();
  });

  it('returns query without schoolId when schoolId is undefined', () => {
    const result = buildSchoolScopedQuery(undefined, { status: 'active' });
    expect(result.schoolId).toBeUndefined();
  });

  it('returns an empty query with no extra keys when both args are empty', () => {
    const result = buildSchoolScopedQuery(null);
    expect(result).toEqual({});
  });

  it('does not mutate the original query object', () => {
    const original = { name: 'test' };
    buildSchoolScopedQuery('school-1', original);
    expect(original.schoolId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// serializeSchool
// ---------------------------------------------------------------------------

describe('serializeSchool', () => {
  it('returns null for null input', () => {
    expect(serializeSchool(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(serializeSchool(undefined)).toBeNull();
  });

  it('serializes a full school object', () => {
    const id = new mongoose.Types.ObjectId();
    const school = {
      _id: id,
      name: 'Test School',
      code: 'TEST',
      status: 'active',
      plan: 'growth',
      planStatus: 'active',
      trialEndsAt: null,
      isDefault: true,
      contactEmail: 'school@example.com',
      contactPhone: '1234567890',
      frontendUrl: 'https://example.com',
      backendUrl: 'https://api.example.com',
    };

    const result = serializeSchool(school);

    expect(result.id).toBe(id.toString());
    expect(result.name).toBe('Test School');
    expect(result.code).toBe('TEST');
    expect(result.plan).toBe('growth');
    expect(result.isDefault).toBe(true);
  });

  it('uses default plan "starter" when plan is missing', () => {
    const result = serializeSchool({ _id: new mongoose.Types.ObjectId(), name: 'X' });
    expect(result.plan).toBe('starter');
  });

  it('uses default planStatus "trialing" when missing', () => {
    const result = serializeSchool({ _id: new mongoose.Types.ObjectId(), name: 'X' });
    expect(result.planStatus).toBe('trialing');
  });

  it('sets isDefault to false when not present', () => {
    const result = serializeSchool({ _id: new mongoose.Types.ObjectId(), name: 'X' });
    expect(result.isDefault).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ensureDefaultSchool (async, uses in-memory DB)
// ---------------------------------------------------------------------------

describe('ensureDefaultSchool', () => {
  it('creates a new default school when none exists', async () => {
    const school = await ensureDefaultSchool();
    expect(school).not.toBeNull();
    expect(school.name).toBeTruthy();
    expect(school.status).toBe('active');
  });

  it('returns the existing default school on second call', async () => {
    const first = await ensureDefaultSchool();
    const second = await ensureDefaultSchool();
    expect(first._id.toString()).toBe(second._id.toString());
  });

  it('marks the school as isDefault', async () => {
    const school = await ensureDefaultSchool();
    expect(school.isDefault).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveSchool (async, uses in-memory DB)
// ---------------------------------------------------------------------------

describe('resolveSchool', () => {
  it('returns null when schoolId is invalid', async () => {
    const result = await resolveSchool({ schoolId: 'not-a-valid-id' });
    expect(result).toBeNull();
  });

  it('returns null when schoolId does not exist in DB', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const result = await resolveSchool({ schoolId: fakeId.toString() });
    expect(result).toBeNull();
  });

  it('returns a school when found by ID', async () => {
    const school = await School.create({
      name: 'Resolve Test',
      code: 'RTEST',
      status: 'active',
      isDefault: false,
    });
    const result = await resolveSchool({ schoolId: school._id.toString() });
    expect(result).not.toBeNull();
    expect(result.name).toBe('Resolve Test');
  });

  it('returns a school when found by code', async () => {
    await School.create({
      name: 'Code School',
      code: 'CODE-SCHOOL',
      status: 'active',
      isDefault: false,
    });
    const result = await resolveSchool({ schoolCode: 'code school' }); // normalizeSchoolCode should match
    expect(result).not.toBeNull();
    expect(result.code).toBe('CODE-SCHOOL');
  });

  it('returns null when no match and fallbackToDefault is false', async () => {
    const result = await resolveSchool({ schoolCode: 'NONEXISTENT-CODE' });
    expect(result).toBeNull();
  });

  it('returns default school when fallbackToDefault is true and nothing else matches', async () => {
    const result = await resolveSchool({ fallbackToDefault: true });
    expect(result).not.toBeNull();
    expect(result.isDefault).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ensureDocumentSchool (async, uses in-memory DB)
// ---------------------------------------------------------------------------

describe('ensureDocumentSchool', () => {
  it('returns null for null input', async () => {
    const result = await ensureDocumentSchool(null);
    expect(result).toBeNull();
  });

  it('returns existing schoolId without hitting DB when already set', async () => {
    const id = new mongoose.Types.ObjectId();
    const doc = { schoolId: id };
    const result = await ensureDocumentSchool(doc);
    expect(result).toBe(id.toString());
  });

  it('assigns a default school when document has no schoolId', async () => {
    // doc.save is a no-op for plain objects — wrap it
    const doc = { schoolId: null, save: async () => {} };
    const result = await ensureDocumentSchool(doc);
    expect(result).not.toBeNull();
    expect(doc.schoolId).toBeDefined();
  });
});
