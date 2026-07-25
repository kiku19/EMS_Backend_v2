/**
 * Unit tests for scripts/reencryptPii.js
 *
 * Exercises the pure re-keying logic (buildReencryptPatch) without a database:
 * documents encrypted under an OLD key are re-encrypted under a NEW key, with
 * hashes recomputed, arrays handled positionally, already-migrated values
 * skipped, and true mismatches left untouched.
 */

import { describe, it, expect } from 'vitest';
import { createCipher } from '../utils/encryption.js';
import { buildReencryptPatch, fingerprint, PII_FIELD_MAP } from '../scripts/reencryptPii.js';

const OLD_KEY = 'o'.repeat(48);
const NEW_KEY = 'n'.repeat(48);
const THIRD_KEY = 't'.repeat(48);

const oldC = createCipher(OLD_KEY);
const newC = createCipher(NEW_KEY);
const thirdC = createCipher(THIRD_KEY);

describe('PII_FIELD_MAP', () => {
  it('covers the three PII collections', () => {
    expect(Object.keys(PII_FIELD_MAP).sort()).toEqual(['parents', 'staffs', 'students']);
  });

  it('every searchable field is also a declared field', () => {
    for (const cfg of Object.values(PII_FIELD_MAP)) {
      for (const sf of cfg.searchableFields) {
        expect(cfg.fields).toContain(sf);
      }
    }
  });
});

describe('fingerprint', () => {
  it('is deterministic, 8 hex chars, and never echoes the key', () => {
    const fp = fingerprint(OLD_KEY);
    expect(fp).toMatch(/^[0-9a-f]{8}$/);
    expect(fp).toBe(fingerprint(OLD_KEY));
    expect(fingerprint(NEW_KEY)).not.toBe(fp);
    expect(OLD_KEY).not.toContain(fp);
  });
});

describe('buildReencryptPatch — top-level fields', () => {
  it('re-encrypts and re-hashes searchable fields onto the NEW key', () => {
    const doc = {
      phone: oldC.encrypt('9998887777'),
      email: oldC.encrypt('parent@example.com'),
    };
    const patch = buildReencryptPatch(doc, PII_FIELD_MAP.parents, oldC, newC);

    expect(patch.reencrypted).toBe(2);
    expect(patch.mismatches).toBe(0);
    expect(patch.alreadyNew).toBe(0);

    // Values now open under the NEW key, not the OLD one.
    expect(newC.decryptStrict(patch.set.phone)).toBe('9998887777');
    expect(() => oldC.decryptStrict(patch.set.phone)).toThrow();

    // Searchable hashes are recomputed under the NEW key.
    expect(patch.set.phoneHash).toBe(newC.hmac('9998887777'));
    expect(patch.set.emailHash).toBe(newC.hmac('parent@example.com'));
  });

  it('skips plaintext and empty values (nothing to re-key)', () => {
    const doc = { phone: '9998887777', email: '' };
    const patch = buildReencryptPatch(doc, PII_FIELD_MAP.parents, oldC, newC);
    expect(patch.set).toEqual({});
    expect(patch.reencrypted).toBe(0);
    expect(patch.mismatches).toBe(0);
  });

  it('leaves a wrong-key value untouched and counts it as a mismatch', () => {
    const doc = { phone: thirdC.encrypt('9998887777') };
    const patch = buildReencryptPatch(doc, PII_FIELD_MAP.parents, oldC, newC);
    expect(patch.mismatches).toBe(1);
    expect(patch.reencrypted).toBe(0);
    expect(patch.set).toEqual({});
  });

  it('is idempotent — values already under the NEW key are skipped, not clobbered', () => {
    const doc = { phone: newC.encrypt('9998887777') };
    const patch = buildReencryptPatch(doc, PII_FIELD_MAP.parents, oldC, newC);
    expect(patch.alreadyNew).toBe(1);
    expect(patch.reencrypted).toBe(0);
    expect(patch.mismatches).toBe(0);
    expect(patch.set).toEqual({});
  });
});

describe('buildReencryptPatch — nested array fields', () => {
  it('re-keys array items using positional paths', () => {
    const doc = {
      parents: [
        { name: 'A', phone: oldC.encrypt('111'), email: oldC.encrypt('a@x.com') },
        { name: 'B', phone: oldC.encrypt('222'), email: '' },
      ],
      healthInfo: {
        emergencyContacts: [{ phone: oldC.encrypt('333'), alternatePhone: oldC.encrypt('444') }],
      },
    };
    const patch = buildReencryptPatch(doc, PII_FIELD_MAP.students, oldC, newC);

    expect(newC.decryptStrict(patch.set['parents.0.phone'])).toBe('111');
    expect(newC.decryptStrict(patch.set['parents.0.email'])).toBe('a@x.com');
    expect(newC.decryptStrict(patch.set['parents.1.phone'])).toBe('222');
    expect(patch.set['parents.1.email']).toBeUndefined(); // was empty
    expect(newC.decryptStrict(patch.set['healthInfo.emergencyContacts.0.phone'])).toBe('333');
    expect(newC.decryptStrict(patch.set['healthInfo.emergencyContacts.0.alternatePhone'])).toBe(
      '444'
    );
    expect(patch.reencrypted).toBe(5);
    expect(patch.mismatches).toBe(0);
  });

  it('does not touch nested-array hashes (only top-level searchable fields are hashed)', () => {
    const doc = { parents: [{ phone: oldC.encrypt('111') }] };
    const patch = buildReencryptPatch(doc, PII_FIELD_MAP.students, oldC, newC);
    expect(patch.set['parents.0.phoneHash']).toBeUndefined();
  });
});
