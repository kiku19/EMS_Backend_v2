/**
 * Unit tests for utils/encryption.js
 *
 * Tests AES-256-GCM encrypt/decrypt, HMAC hashing, isEncrypted detection,
 * and piiMatch query builder.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  encrypt,
  decrypt,
  hmac,
  isEncrypted,
  piiMatch,
  createCipher,
  _resetKeys,
} from '../utils/encryption.js';

beforeEach(() => {
  _resetKeys();
});

// ---------------------------------------------------------------------------
// isEncrypted
// ---------------------------------------------------------------------------

describe('isEncrypted', () => {
  it('returns true for a correctly formatted encrypted string', () => {
    const fake = 'a'.repeat(24) + '.' + 'b'.repeat(32) + '.' + 'c'.repeat(10);
    expect(isEncrypted(fake)).toBe(true);
  });

  it('returns false for plain text', () => {
    expect(isEncrypted('hello world')).toBe(false);
  });

  it('returns false for null/undefined/number', () => {
    expect(isEncrypted(null)).toBe(false);
    expect(isEncrypted(undefined)).toBe(false);
    expect(isEncrypted(42)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isEncrypted('')).toBe(false);
  });

  it('returns false for string with wrong segment lengths', () => {
    expect(isEncrypted('aaa.bbb.ccc')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// encrypt / decrypt round-trip
// ---------------------------------------------------------------------------

describe('encrypt + decrypt', () => {
  it('round-trips a simple string', () => {
    const plain = 'test@example.com';
    const encrypted = encrypt(plain);
    expect(encrypted).not.toBe(plain);
    expect(isEncrypted(encrypted)).toBe(true);
    expect(decrypt(encrypted)).toBe(plain);
  });

  it('round-trips unicode text', () => {
    const plain = 'नमस्ते दुनिया 🌍';
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  it('round-trips an empty-ish string (single char)', () => {
    expect(decrypt(encrypt('x'))).toBe('x');
  });

  it('encrypt is idempotent — already encrypted input passes through', () => {
    const first = encrypt('hello');
    const second = encrypt(first);
    expect(second).toBe(first);
  });

  it('decrypt is idempotent — plaintext input passes through', () => {
    expect(decrypt('not-encrypted')).toBe('not-encrypted');
  });

  it('encrypt returns falsy values unchanged', () => {
    expect(encrypt(null)).toBeNull();
    expect(encrypt(undefined)).toBeUndefined();
    expect(encrypt('')).toBe('');
  });

  it('decrypt returns falsy values unchanged', () => {
    expect(decrypt(null)).toBeNull();
    expect(decrypt(undefined)).toBeUndefined();
    expect(decrypt('')).toBe('');
  });

  it('encrypt returns non-string values unchanged', () => {
    expect(encrypt(123)).toBe(123);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const a = encrypt('same');
    const b = encrypt('same');
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe('same');
    expect(decrypt(b)).toBe('same');
  });
});

// ---------------------------------------------------------------------------
// createCipher (explicit-key instances — used by the re-encryption pass)
// ---------------------------------------------------------------------------

describe('createCipher', () => {
  const KEY_A = 'a'.repeat(48);
  const KEY_B = 'b'.repeat(48);

  it('throws on an empty or non-string secret', () => {
    expect(() => createCipher('')).toThrow();
    expect(() => createCipher(null)).toThrow();
    expect(() => createCipher(42)).toThrow();
  });

  it('round-trips with its own key', () => {
    const c = createCipher(KEY_A);
    const enc = c.encrypt('9998887777');
    expect(isEncrypted(enc)).toBe(true);
    expect(c.decryptStrict(enc)).toBe('9998887777');
    expect(c.decrypt(enc)).toBe('9998887777');
  });

  it('decryptStrict THROWS when decrypting a value from a different key', () => {
    const a = createCipher(KEY_A);
    const b = createCipher(KEY_B);
    const enc = a.encrypt('secret@example.com');
    expect(() => b.decryptStrict(enc)).toThrow();
  });

  it('migration-safe decrypt returns the raw value on a wrong-key auth failure', () => {
    const a = createCipher(KEY_A);
    const b = createCipher(KEY_B);
    const enc = a.encrypt('secret@example.com');
    expect(b.decrypt(enc)).toBe(enc); // unchanged, not throwing
  });

  it('produces different HMAC hashes under different keys', () => {
    const a = createCipher(KEY_A);
    const b = createCipher(KEY_B);
    expect(a.hmac('foo@bar.com')).not.toBe(b.hmac('foo@bar.com'));
  });

  it('re-encryption round-trips old-key data to new-key data', () => {
    const oldC = createCipher(KEY_A);
    const newC = createCipher(KEY_B);
    const plain = '+911234567890';
    const stored = oldC.encrypt(plain);

    // Decrypt with old, re-encrypt with new — the re-keying primitive.
    const rekeyed = newC.encrypt(oldC.decryptStrict(stored));

    expect(rekeyed).not.toBe(stored);
    expect(newC.decryptStrict(rekeyed)).toBe(plain);
    expect(() => oldC.decryptStrict(rekeyed)).toThrow(); // old key no longer opens it
  });

  it('is independent of the env-derived default instance', () => {
    _resetKeys();
    const c = createCipher(KEY_A);
    const enc = c.encrypt('isolated');
    // The default decrypt (JWT_SECRET-derived) must NOT be able to read it.
    expect(decrypt(enc)).toBe(enc);
  });
});

// ---------------------------------------------------------------------------
// hmac
// ---------------------------------------------------------------------------

describe('hmac', () => {
  it('returns a 64-char hex string for valid input', () => {
    const hash = hmac('test@example.com');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same input', () => {
    expect(hmac('hello')).toBe(hmac('hello'));
  });

  it('normalises case and whitespace', () => {
    expect(hmac('Foo@BAR.com')).toBe(hmac('foo@bar.com'));
    expect(hmac('  hello  ')).toBe(hmac('hello'));
  });

  it('returns null for falsy values', () => {
    expect(hmac(null)).toBeNull();
    expect(hmac(undefined)).toBeNull();
    expect(hmac('')).toBeNull();
  });

  it('returns null for non-string values', () => {
    expect(hmac(42)).toBeNull();
  });

  it('produces different hashes for different inputs', () => {
    expect(hmac('alice')).not.toBe(hmac('bob'));
  });
});

// ---------------------------------------------------------------------------
// piiMatch
// ---------------------------------------------------------------------------

describe('piiMatch', () => {
  it('builds an $or query with Hash field and plaintext fallback', () => {
    const query = piiMatch('email', 'test@example.com');
    expect(query.$or).toHaveLength(2);
    expect(query.$or[0]).toHaveProperty('emailHash');
    expect(query.$or[0].emailHash).toMatch(/^[0-9a-f]{64}$/);
    expect(query.$or[1]).toEqual({ email: 'test@example.com' });
  });

  it('returns a simple field match for null value', () => {
    const query = piiMatch('phone', null);
    expect(query).toEqual({ phone: null });
  });

  it('returns a simple field match for non-string value', () => {
    const query = piiMatch('phone', 123);
    expect(query).toEqual({ phone: 123 });
  });

  it('returns a simple field match for empty string', () => {
    const query = piiMatch('phone', '');
    expect(query).toEqual({ phone: '' });
  });
});
