/**
 * Unit tests for utils/parentAccountHelper.js
 *
 * generateParentPassword now produces a random CSPRNG password instead of a
 * deterministic one derived from the child's DOB + admissionId (which was a
 * security hole — anyone knowing the child's DOB/admissionId could compute the
 * parent's password). These tests verify the new behavior: the password is
 * random, sufficiently long, uses only the allowed alphabet, and never leaks
 * the input values. normalizeRelationship is unchanged.
 */

import { describe, it, expect } from 'vitest';
import { generateParentPassword } from '../utils/parentAccountHelper.js';

// ---------------------------------------------------------------------------
// generateParentPassword
// ---------------------------------------------------------------------------

describe('generateParentPassword', () => {
  it('returns a non-empty string', () => {
    const result = generateParentPassword('2010-05-15', 'ADM2024001');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('is at least 8 characters long (usable as a password)', () => {
    const result = generateParentPassword('15-05-2010', 'ADM001');
    expect(result.length).toBeGreaterThanOrEqual(8);
  });

  it('uses only the allowed alphabet (no ambiguous chars like 0/O/1/l)', () => {
    const result = generateParentPassword('2010-05-15', 'ADM001');
    // Unambiguous alphanumeric alphabet used by the generator (no 0/O/1/I/l/o).
    const allowed = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    for (const ch of result) {
      expect(allowed.includes(ch)).toBe(true);
    }
  });

  it('does NOT leak the dateOfBirth or admissionId (non-deterministic)', () => {
    const result = generateParentPassword('2010-05-15', 'ADM2024001');
    // The old behavior returned `${DDMMYYYY}${admissionId}` = '15052010ADM2024001'.
    // The new random password must never contain either input verbatim.
    expect(result).not.toContain('15052010');
    expect(result).not.toContain('ADM2024001');
  });

  it('produces different passwords across calls (random, not deterministic)', () => {
    const a = generateParentPassword('2010-05-15', 'ADM001');
    const b = generateParentPassword('2010-05-15', 'ADM001');
    // Same inputs → different outputs (CSPRNG). Extremely unlikely to collide
    // for a 10-char password from a 54-char alphabet.
    expect(a).not.toBe(b);
  });

  it('still returns a random password when inputs are null/empty', () => {
    // The old behavior returned null for missing inputs, which broke account
    // creation for students without a DOB. The new generator ignores the
    // inputs entirely and always returns a usable random password.
    expect(typeof generateParentPassword(null, 'ADM001')).toBe('string');
    expect(typeof generateParentPassword('2010-05-15', null)).toBe('string');
    expect(typeof generateParentPassword(null, null)).toBe('string');
    expect(typeof generateParentPassword('', '')).toBe('string');
    expect(generateParentPassword(null, null).length).toBeGreaterThan(0);
  });
});
