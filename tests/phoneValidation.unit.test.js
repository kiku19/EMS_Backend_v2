/**
 * Unit tests for services/phoneValidation.js
 *
 * Tests Indian phone validation, international phone validation,
 * and the comprehensive validatePhone function.
 */

import { describe, it, expect } from 'vitest';
import {
  validateIndianPhone,
  validateInternationalPhone,
  validatePhone,
} from '../services/phoneValidation.js';

// ---------------------------------------------------------------------------
// validateIndianPhone
// ---------------------------------------------------------------------------

describe('validateIndianPhone', () => {
  it('accepts a valid 10-digit number starting with 9', () => {
    const result = validateIndianPhone('9876543210');
    expect(result.isValid).toBe(true);
    expect(result.error).toBeNull();
  });

  it('accepts numbers starting with 6, 7, 8', () => {
    expect(validateIndianPhone('6000000000').isValid).toBe(true);
    expect(validateIndianPhone('7000000000').isValid).toBe(true);
    expect(validateIndianPhone('8000000000').isValid).toBe(true);
  });

  it('strips non-numeric characters before validation', () => {
    expect(validateIndianPhone('98-7654-3210').isValid).toBe(true);
    expect(validateIndianPhone('+91 98765 43210').isValid).toBe(false); // 12 digits with +91
  });

  it('rejects numbers not starting with 6-9', () => {
    const result = validateIndianPhone('5000000000');
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('start with 6, 7, 8, or 9');
  });

  it('rejects numbers shorter than 10 digits', () => {
    const result = validateIndianPhone('987654321');
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('10 digits');
  });

  it('rejects numbers longer than 10 digits', () => {
    const result = validateIndianPhone('98765432101');
    expect(result.isValid).toBe(false);
  });

  it('rejects null/undefined/empty', () => {
    expect(validateIndianPhone(null).isValid).toBe(false);
    expect(validateIndianPhone(undefined).isValid).toBe(false);
    expect(validateIndianPhone('').isValid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateInternationalPhone
// ---------------------------------------------------------------------------

describe('validateInternationalPhone', () => {
  it('validates US numbers', () => {
    expect(validateInternationalPhone('2125551234', 'US').isValid).toBe(true);
    expect(validateInternationalPhone('+12125551234', 'US').isValid).toBe(true);
  });

  it('validates UK numbers', () => {
    expect(validateInternationalPhone('+447911123456', 'UK').isValid).toBe(true);
  });

  it('validates Singapore numbers', () => {
    expect(validateInternationalPhone('81234567', 'SG').isValid).toBe(true);
    expect(validateInternationalPhone('91234567', 'SG').isValid).toBe(true);
  });

  it('falls back to DEFAULT pattern for unknown country codes', () => {
    const result = validateInternationalPhone('+811234567890', 'JP');
    expect(result.isValid).toBe(true);
  });

  it('is case insensitive for country code', () => {
    expect(validateInternationalPhone('2125551234', 'us').isValid).toBe(true);
  });

  it('rejects null phone', () => {
    expect(validateInternationalPhone(null, 'US').isValid).toBe(false);
    expect(validateInternationalPhone(null, 'US').error).toContain('required');
  });

  it('rejects null country code', () => {
    expect(validateInternationalPhone('12345', null).isValid).toBe(false);
    expect(validateInternationalPhone('12345', null).error).toContain('Country code');
  });

  it('rejects numbers exceeding 15 digits', () => {
    const result = validateInternationalPhone('+1234567890123456', 'US');
    expect(result.isValid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validatePhone (comprehensive)
// ---------------------------------------------------------------------------

describe('validatePhone', () => {
  it('validates an Indian phone number by default', async () => {
    const result = await validatePhone('9876543210');
    expect(result.isValid).toBe(true);
    expect(result.details.countryCode).toBe('IN');
  });

  it('rejects invalid Indian phone', async () => {
    const result = await validatePhone('123');
    expect(result.isValid).toBe(false);
    expect(result.details.stage).toBe('format_validation');
  });

  it('validates international phone with country code', async () => {
    const result = await validatePhone('2125551234', 'US');
    expect(result.isValid).toBe(true);
    expect(result.details.stage).toBe('format_validation_only');
  });

  it('returns format_validation_only stage when useThirdParty is false', async () => {
    const result = await validatePhone('9876543210', 'IN', false);
    expect(result.isValid).toBe(true);
    expect(result.details.stage).toBe('format_validation_only');
  });
});
