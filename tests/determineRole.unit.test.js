import { describe, expect, it } from 'vitest';
import { determineRole } from '../middleware/auth/permissions.js';

describe('determineRole', () => {
  it('maps canonical Staff roles to permission roles exactly', () => {
    expect(determineRole(['Admin'])).toBe('admin');
    expect(determineRole(['Principal'])).toBe('admin');
    expect(determineRole(['Teacher'])).toBe('teacher');
    expect(determineRole(['Accountant'])).toBe('accountant');
    expect(determineRole(['Receptionist'])).toBe('receptionist');
  });

  it('does NOT treat Vice Principal as admin (substring match regression)', () => {
    // Before the fix, `.toLowerCase().includes('principal')` granted admin.
    // Vice Principal is a teacher-equivalent, not a full admin.
    expect(determineRole(['Vice Principal'])).toBe('teacher');
  });

  it('does NOT grant admin to legacy/freeform role strings containing "admin"', () => {
    // These aren't in the Staff enum but can exist on legacy records. Before
    // the fix, substring matching silently seeded full admin permissions.
    expect(determineRole(['Administrative Assistant'])).toBe('teacher');
    expect(determineRole(['Frontdesk admin'])).toBe('teacher');
    expect(determineRole(['Junior Admin'])).toBe('teacher');
  });

  it('does NOT grant receptionist for freeform roles containing "front"', () => {
    // Previously: 'Front Office Clerk' → includes('front') → 'receptionist'
    expect(determineRole(['Front Office Clerk'])).toBe('teacher');
  });

  it('picks the highest canonical role when a staff member has multiple', () => {
    expect(determineRole(['Teacher', 'Admin'])).toBe('admin');
    expect(determineRole(['Teacher', 'Accountant'])).toBe('accountant');
    // Receptionist outranks Teacher in the permission hierarchy
    expect(determineRole(['Receptionist', 'Teacher'])).toBe('receptionist');
  });

  it('defaults to teacher for empty, null, or unknown input', () => {
    expect(determineRole([])).toBe('teacher');
    expect(determineRole(null)).toBe('teacher');
    expect(determineRole(undefined)).toBe('teacher');
    expect(determineRole(['WhateverMadeUpRole'])).toBe('teacher');
  });

  it('accepts a single string (not just an array) for back-compat', () => {
    expect(determineRole('Admin')).toBe('admin');
    expect(determineRole('Teacher')).toBe('teacher');
    expect(determineRole('Vice Principal')).toBe('teacher');
  });
});
