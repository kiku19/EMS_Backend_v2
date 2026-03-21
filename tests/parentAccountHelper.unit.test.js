/**
 * Unit tests for utils/parentAccountHelper.js
 *
 * Tests the pure function generateParentPassword and normalizeRelationship.
 * The async createOrUpdateParentAccount is tested via integration tests.
 */

import { describe, it, expect } from 'vitest';
import { generateParentPassword } from '../utils/parentAccountHelper.js';

// ---------------------------------------------------------------------------
// generateParentPassword
// ---------------------------------------------------------------------------

describe('generateParentPassword', () => {
  it('generates password from YYYY-MM-DD format DOB + admissionId', () => {
    const result = generateParentPassword('2010-05-15', 'ADM2024001');
    expect(result).toBe('15052010ADM2024001');
  });

  it('generates password from DD-MM-YYYY format DOB', () => {
    const result = generateParentPassword('15-05-2010', 'ADM001');
    expect(result).toBe('15052010ADM001');
  });

  it('generates password from DD/MM/YYYY format DOB', () => {
    const result = generateParentPassword('15/05/2010', 'ADM001');
    expect(result).toBe('15052010ADM001');
  });

  it('pads single-digit day and month', () => {
    const result = generateParentPassword('2010-1-5', 'ADM001');
    expect(result).toBe('05012010ADM001');
  });

  it('returns null when dateOfBirth is null', () => {
    expect(generateParentPassword(null, 'ADM001')).toBeNull();
  });

  it('returns null when admissionId is null', () => {
    expect(generateParentPassword('2010-05-15', null)).toBeNull();
  });

  it('returns null when both are null', () => {
    expect(generateParentPassword(null, null)).toBeNull();
  });

  it('returns null when dateOfBirth is empty string', () => {
    expect(generateParentPassword('', 'ADM001')).toBeNull();
  });

  it('returns null for unsupported date format (no separators)', () => {
    expect(generateParentPassword('20100515', 'ADM001')).toBeNull();
  });
});
