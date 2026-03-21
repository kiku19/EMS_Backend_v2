/**
 * Unit tests for utils/academicYear.js
 *
 * Pure function tests — no database, no HTTP.
 */
import { describe, expect, it } from 'vitest';
import {
  normalizeAcademicYear,
  isValidAcademicYear,
  parseAcademicYear,
  resolveAcademicYearSync,
} from '../utils/academicYear.js';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

// ---------------------------------------------------------------------------
// normalizeAcademicYear
// ---------------------------------------------------------------------------

describe('normalizeAcademicYear', () => {
  it('trims leading and trailing whitespace from a string', () => {
    expect(normalizeAcademicYear('  2025-26  ')).toBe('2025-26');
  });

  it('returns the string unchanged when no whitespace', () => {
    expect(normalizeAcademicYear('2025-26')).toBe('2025-26');
  });

  it('returns empty string for non-string input (number)', () => {
    expect(normalizeAcademicYear(202526)).toBe('');
  });

  it('returns empty string for null', () => {
    expect(normalizeAcademicYear(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(normalizeAcademicYear(undefined)).toBe('');
  });

  it('returns empty string for an empty string', () => {
    expect(normalizeAcademicYear('')).toBe('');
  });

  it('returns empty string for an object', () => {
    expect(normalizeAcademicYear({})).toBe('');
  });
});

// ---------------------------------------------------------------------------
// isValidAcademicYear
// ---------------------------------------------------------------------------

describe('isValidAcademicYear', () => {
  it('returns true for a valid academic year like 2025-26', () => {
    expect(isValidAcademicYear('2025-26')).toBe(true);
  });

  it('returns true for 2024-25', () => {
    expect(isValidAcademicYear('2024-25')).toBe(true);
  });

  it('returns true for 2099-00 (century boundary)', () => {
    expect(isValidAcademicYear('2099-00')).toBe(true);
  });

  it('returns false for wrong suffix (2025-27 instead of 2025-26)', () => {
    expect(isValidAcademicYear('2025-27')).toBe(false);
  });

  it('returns false for wrong suffix (2025-25 instead of 2025-26)', () => {
    expect(isValidAcademicYear('2025-25')).toBe(false);
  });

  it('returns false for single-digit suffix (2025-6 instead of 2025-26)', () => {
    expect(isValidAcademicYear('2025-6')).toBe(false);
  });

  it('returns false for a year before 2000 (1999-00)', () => {
    expect(isValidAcademicYear('1999-00')).toBe(false);
  });

  it('returns false for a completely wrong format', () => {
    expect(isValidAcademicYear('2025/26')).toBe(false);
  });

  it('returns false for a number input', () => {
    expect(isValidAcademicYear(202526)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isValidAcademicYear(null)).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isValidAcademicYear('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseAcademicYear
// ---------------------------------------------------------------------------

describe('parseAcademicYear', () => {
  it('parses a standard academic year correctly', () => {
    const result = parseAcademicYear('2025-26');
    expect(result.startYear).toBe(2025);
    expect(result.endYear).toBe(2026);
  });

  it('parses a century-spanning academic year (2099-00)', () => {
    const result = parseAcademicYear('2099-00');
    expect(result.startYear).toBe(2099);
    expect(result.endYear).toBe(2100);
  });

  it('parses 2020-21', () => {
    const result = parseAcademicYear('2020-21');
    expect(result.startYear).toBe(2020);
    expect(result.endYear).toBe(2021);
  });

  it('falls back to CURRENT_ACADEMIC_YEAR when passed an invalid string', () => {
    const result = parseAcademicYear('not-a-year');
    const [fallbackStart] = CURRENT_ACADEMIC_YEAR.split('-');
    expect(result.startYear).toBe(parseInt(fallbackStart, 10));
  });

  it('uses CURRENT_ACADEMIC_YEAR when no argument is passed', () => {
    const result = parseAcademicYear();
    const [fallbackStart] = CURRENT_ACADEMIC_YEAR.split('-');
    expect(result.startYear).toBe(parseInt(fallbackStart, 10));
  });

  it('falls back gracefully for a null argument', () => {
    const result = parseAcademicYear(null);
    expect(typeof result.startYear).toBe('number');
    expect(typeof result.endYear).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// resolveAcademicYearSync
// ---------------------------------------------------------------------------

describe('resolveAcademicYearSync', () => {
  it('returns the provided academic year when it is a valid non-empty string', () => {
    expect(resolveAcademicYearSync('2025-26')).toBe('2025-26');
  });

  it('returns CURRENT_ACADEMIC_YEAR when input is an empty string', () => {
    expect(resolveAcademicYearSync('')).toBe(CURRENT_ACADEMIC_YEAR);
  });

  it('returns CURRENT_ACADEMIC_YEAR when input is undefined', () => {
    expect(resolveAcademicYearSync(undefined)).toBe(CURRENT_ACADEMIC_YEAR);
  });

  it('returns CURRENT_ACADEMIC_YEAR when input is null', () => {
    expect(resolveAcademicYearSync(null)).toBe(CURRENT_ACADEMIC_YEAR);
  });

  it('trims whitespace before returning the value', () => {
    expect(resolveAcademicYearSync('  2025-26  ')).toBe('2025-26');
  });
});
