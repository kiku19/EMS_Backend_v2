/**
 * Unit tests for utils/constants.js
 *
 * Tests getDefaultAcademicYear and CURRENT_ACADEMIC_YEAR.
 */

import { describe, it, expect, vi } from 'vitest';
import { getDefaultAcademicYear, CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

describe('getDefaultAcademicYear', () => {
  it('returns "YYYY-YY" format', () => {
    const result = getDefaultAcademicYear(new Date('2025-06-15'));
    expect(result).toMatch(/^\d{4}-\d{2}$/);
  });

  it('returns current year when month >= April (index 3)', () => {
    // June 2025 → academic year starts 2025
    expect(getDefaultAcademicYear(new Date('2025-06-15'))).toBe('2025-26');
  });

  it('returns previous year when month < April', () => {
    // February 2026 → academic year started 2025
    expect(getDefaultAcademicYear(new Date('2026-02-15'))).toBe('2025-26');
  });

  it('returns current year on exactly April 1st', () => {
    // April 2025 (month index 3) → starts 2025
    expect(getDefaultAcademicYear(new Date('2025-04-01'))).toBe('2025-26');
  });

  it('returns previous year on March 31', () => {
    // March 2025 (month index 2) → started 2024
    expect(getDefaultAcademicYear(new Date('2025-03-31'))).toBe('2024-25');
  });

  it('handles century boundary (2099-2100)', () => {
    expect(getDefaultAcademicYear(new Date('2099-05-01'))).toBe('2099-00');
  });

  it('handles year 2000', () => {
    expect(getDefaultAcademicYear(new Date('2000-09-01'))).toBe('2000-01');
  });

  it('uses current date when no argument given', () => {
    const result = getDefaultAcademicYear();
    expect(result).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe('CURRENT_ACADEMIC_YEAR', () => {
  it('is a string in YYYY-YY format', () => {
    expect(typeof CURRENT_ACADEMIC_YEAR).toBe('string');
    expect(CURRENT_ACADEMIC_YEAR).toMatch(/^\d{4}-\d{2}$/);
  });

  it('honors the CURRENT_ACADEMIC_YEAR environment variable', async () => {
    const original = process.env.CURRENT_ACADEMIC_YEAR;
    process.env.CURRENT_ACADEMIC_YEAR = '2030-31';

    try {
      // The constant is evaluated at module load time, so clear the module
      // cache and re-import to pick up the env override.
      vi.resetModules();
      const { CURRENT_ACADEMIC_YEAR: fromEnv } = await import('../utils/constants.js');
      expect(fromEnv).toBe('2030-31');
    } finally {
      if (original === undefined) {
        delete process.env.CURRENT_ACADEMIC_YEAR;
      } else {
        process.env.CURRENT_ACADEMIC_YEAR = original;
      }
    }
  });

  it('falls back to the computed default when CURRENT_ACADEMIC_YEAR is invalid', async () => {
    const original = process.env.CURRENT_ACADEMIC_YEAR;
    process.env.CURRENT_ACADEMIC_YEAR = 'not-a-year';

    try {
      vi.resetModules();
      const { CURRENT_ACADEMIC_YEAR: fallback } = await import('../utils/constants.js');
      expect(fallback).toMatch(/^\d{4}-\d{2}$/);
      expect(fallback).not.toBe('not-a-year');
    } finally {
      if (original === undefined) {
        delete process.env.CURRENT_ACADEMIC_YEAR;
      } else {
        process.env.CURRENT_ACADEMIC_YEAR = original;
      }
    }
  });
});
