/**
 * Unit tests for utils/coppaUtils.js
 *
 * Tests age calculation and COPPA applicability checks.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { getAgeFromDob, isCoppaApplicable, COPPA_AGE_THRESHOLD } from '../utils/coppaUtils.js';

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// getAgeFromDob
// ---------------------------------------------------------------------------

describe('getAgeFromDob', () => {
  it('returns correct age for a past date', () => {
    vi.useFakeTimers({ now: new Date('2026-06-15') });
    expect(getAgeFromDob('2016-06-15')).toBe(10); // exactly 10
  });

  it('returns age - 1 when birthday has not yet occurred this year', () => {
    vi.useFakeTimers({ now: new Date('2026-03-01') });
    expect(getAgeFromDob('2016-06-15')).toBe(9); // birthday in June, now is March
  });

  it('returns correct age on the birthday', () => {
    vi.useFakeTimers({ now: new Date('2026-06-15') });
    expect(getAgeFromDob('2014-06-15')).toBe(12);
  });

  it('returns null for null/undefined', () => {
    expect(getAgeFromDob(null)).toBeNull();
    expect(getAgeFromDob(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(getAgeFromDob('')).toBeNull();
  });

  it('returns null for invalid date string', () => {
    expect(getAgeFromDob('not-a-date')).toBeNull();
  });

  it('handles Date object-like ISO strings', () => {
    vi.useFakeTimers({ now: new Date('2026-01-01') });
    const age = getAgeFromDob('2006-01-01');
    expect(age).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// isCoppaApplicable
// ---------------------------------------------------------------------------

describe('isCoppaApplicable', () => {
  it('returns true for a child under 13', () => {
    vi.useFakeTimers({ now: new Date('2026-03-21') });
    expect(isCoppaApplicable('2018-01-01')).toBe(true); // age 8
  });

  it('returns false for someone aged 13 or over', () => {
    vi.useFakeTimers({ now: new Date('2026-03-21') });
    expect(isCoppaApplicable('2013-01-01')).toBe(false); // age 13
  });

  it('returns false for an adult', () => {
    vi.useFakeTimers({ now: new Date('2026-03-21') });
    expect(isCoppaApplicable('1990-05-01')).toBe(false);
  });

  it('returns false for null/undefined/empty dob', () => {
    expect(isCoppaApplicable(null)).toBe(false);
    expect(isCoppaApplicable(undefined)).toBe(false);
    expect(isCoppaApplicable('')).toBe(false);
  });

  it('returns false for invalid date', () => {
    expect(isCoppaApplicable('invalid')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// COPPA_AGE_THRESHOLD
// ---------------------------------------------------------------------------

describe('COPPA_AGE_THRESHOLD', () => {
  it('equals 13', () => {
    expect(COPPA_AGE_THRESHOLD).toBe(13);
  });
});
