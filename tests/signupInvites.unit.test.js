/**
 * Unit tests for utils/signupInvites.js
 *
 * Tests JWT invite generation, verification, and normalization.
 */

import { describe, it, expect } from 'vitest';
import {
  generateSignupInvite,
  verifySignupInvite,
  normalizeInvitedSchoolName,
} from '../utils/signupInvites.js';

// ---------------------------------------------------------------------------
// generateSignupInvite + verifySignupInvite round-trip
// ---------------------------------------------------------------------------

describe('generateSignupInvite + verifySignupInvite', () => {
  it('round-trips a valid invite token', () => {
    const token = generateSignupInvite({
      email: 'Test@Example.COM',
      schoolName: 'Sunrise  Academy',
      invitedBy: 'admin@test.com',
    });

    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);

    const decoded = verifySignupInvite(token);
    expect(decoded).not.toBeNull();
    expect(decoded.email).toBe('test@example.com'); // normalised
    expect(decoded.schoolName).toBe('Sunrise Academy'); // collapsed whitespace
    expect(decoded.invitedBy).toBe('admin@test.com');
    expect(decoded.expiresAt).toBeTruthy();
  });

  it('defaults invitedBy to "system"', () => {
    const token = generateSignupInvite({
      email: 'a@b.com',
      schoolName: 'Test School',
    });
    const decoded = verifySignupInvite(token);
    expect(decoded.invitedBy).toBe('system');
  });
});

// ---------------------------------------------------------------------------
// verifySignupInvite — invalid tokens
// ---------------------------------------------------------------------------

describe('verifySignupInvite — invalid tokens', () => {
  it('returns null for garbage string', () => {
    expect(verifySignupInvite('not.a.valid.jwt')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(verifySignupInvite('')).toBeNull();
  });

  it('returns null for null', () => {
    expect(verifySignupInvite(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizeInvitedSchoolName
// ---------------------------------------------------------------------------

describe('normalizeInvitedSchoolName', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeInvitedSchoolName('  Sunrise   Academy  ')).toBe('Sunrise Academy');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeInvitedSchoolName('')).toBe('');
  });

  it('handles null/undefined gracefully', () => {
    expect(normalizeInvitedSchoolName(null)).toBe('');
    expect(normalizeInvitedSchoolName(undefined)).toBe('');
  });
});
