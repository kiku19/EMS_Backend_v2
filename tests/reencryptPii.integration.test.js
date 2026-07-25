/**
 * Integration test for the PII re-encryption pass against a real MongoDB.
 *
 * Proves the raw-driver read + positional nested `$set` write path the script
 * uses actually persists correctly: a document written under an OLD key is
 * re-encrypted under a NEW key in place, top-level and nested-array PII alike,
 * and reads back cleanly under the NEW key (and no longer under the OLD one).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { createCipher } from '../utils/encryption.js';
import { buildReencryptPatch, PII_FIELD_MAP } from '../scripts/reencryptPii.js';

const OLD_KEY = 'old-key-for-integration-test-0000000000';
const NEW_KEY = 'new-canonical-key-for-integration-000000';

const oldC = createCipher(OLD_KEY);
const newC = createCipher(NEW_KEY);

const COLLECTION = 'students';

/** Mirror the script's per-collection apply loop against the raw driver. */
async function runReencrypt(coll) {
  const config = PII_FIELD_MAP[COLLECTION];
  let modified = 0;
  for await (const doc of coll.find({})) {
    const patch = buildReencryptPatch(doc, config, oldC, newC);
    if (Object.keys(patch.set).length === 0) continue;
    modified++;
    await coll.updateOne({ _id: doc._id }, { $set: patch.set });
  }
  return modified;
}

describe('reencryptPii — persisted end-to-end', () => {
  let coll;

  beforeEach(async () => {
    coll = mongoose.connection.db.collection(COLLECTION);
    await coll.deleteMany({});
  });

  it('re-keys top-level and nested-array PII in place', async () => {
    // Seed a raw document encrypted under the OLD key (bypassing Mongoose so the
    // stored ciphertext is genuinely OLD-key material, like the orphaned data).
    await coll.insertOne({
      name: 'Test Student',
      phone: oldC.encrypt('9998887777'),
      phoneHash: oldC.hmac('9998887777'),
      email: oldC.encrypt('stud@example.com'),
      emailHash: oldC.hmac('stud@example.com'),
      aadhaarNumber: oldC.encrypt('123412341234'),
      parents: [
        { name: 'Mom', phone: oldC.encrypt('1112223333'), email: oldC.encrypt('mom@example.com') },
        { name: 'Dad', phone: oldC.encrypt('4445556666'), email: '' },
      ],
      healthInfo: {
        emergencyContacts: [{ phone: oldC.encrypt('7778889999') }],
      },
    });

    const modified = await runReencrypt(coll);
    expect(modified).toBe(1);

    const stored = await coll.findOne({ name: 'Test Student' });

    // Top-level: opens under NEW, not OLD; hash recomputed under NEW.
    expect(newC.decryptStrict(stored.phone)).toBe('9998887777');
    expect(() => oldC.decryptStrict(stored.phone)).toThrow();
    expect(stored.phoneHash).toBe(newC.hmac('9998887777'));
    expect(newC.decryptStrict(stored.aadhaarNumber)).toBe('123412341234');

    // Nested arrays: positional $set persisted correctly.
    expect(newC.decryptStrict(stored.parents[0].phone)).toBe('1112223333');
    expect(newC.decryptStrict(stored.parents[0].email)).toBe('mom@example.com');
    expect(newC.decryptStrict(stored.parents[1].phone)).toBe('4445556666');
    expect(stored.parents[1].email).toBe(''); // untouched empty
    expect(stored.parents[1].name).toBe('Dad'); // non-PII untouched
    expect(newC.decryptStrict(stored.healthInfo.emergencyContacts[0].phone)).toBe('7778889999');
  });

  it('is idempotent — a second pass modifies nothing', async () => {
    await coll.insertOne({
      name: 'Second Pass',
      phone: oldC.encrypt('5551112222'),
      phoneHash: oldC.hmac('5551112222'),
    });

    expect(await runReencrypt(coll)).toBe(1);
    // Everything is now under NEW; re-running finds nothing to change.
    expect(await runReencrypt(coll)).toBe(0);

    const stored = await coll.findOne({ name: 'Second Pass' });
    expect(newC.decryptStrict(stored.phone)).toBe('5551112222');
  });
});
