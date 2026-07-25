/**
 * Regression tests for the FeePayment idempotency unique index (SCH-210).
 *
 * The index was declared with `partialFilterExpression: { idempotencyKey:
 * { $exists: true, $ne: null } }`. MongoDB partial indexes do NOT support
 * `$ne` (it compiles to `$not: { $eq }`), so `createIndexes`/`syncIndexes`
 * rejected it with "Expression not supported in partial index". With
 * Mongoose `autoIndex: true` that failure was swallowed at boot, so the
 * unique index was never actually created in production and duplicate fee
 * payments sharing an `idempotencyKey` were NOT blocked at the DB level.
 *
 * The fix scopes the partial filter to `{ idempotencyKey: { $type: 'string' } }`,
 * which MongoDB accepts and which indexes only real (non-null, present) keys.
 *
 * These tests build the index against the in-memory MongoDB — the same
 * `syncIndexes()` path that `npm run migrate:indexes` uses — so they fail on
 * the old spec and pass on the fixed one.
 */

import mongoose from 'mongoose';
import { describe, it, expect, beforeAll } from 'vitest';
import FeePayment from '../models/FeePayment.js';

const IDEMPOTENCY_INDEX_NAME = 'schoolId_1_idempotencyKey_1';

describe('FeePayment idempotency index spec', () => {
  it('scopes the partial filter to $type: "string" and never uses $ne/$not', () => {
    const idempotencyIndex = FeePayment.schema
      .indexes()
      .find(([keys]) => keys.schoolId === 1 && keys.idempotencyKey === 1);

    expect(idempotencyIndex, 'idempotency compound index should be declared').toBeDefined();

    const [, options] = idempotencyIndex;
    expect(options.unique).toBe(true);
    expect(options.partialFilterExpression).toEqual({ idempotencyKey: { $type: 'string' } });

    // Guard against the invalid operators that MongoDB rejects in partial indexes.
    const serialized = JSON.stringify(options.partialFilterExpression);
    expect(serialized).not.toContain('$ne');
    expect(serialized).not.toContain('$not');
  });
});

describe('FeePayment idempotency index — live build & behaviour', () => {
  const schoolId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    // syncIndexes() is exactly what `npm run migrate:indexes` runs. On the old
    // ($ne) spec this rejects; on the fixed ($type) spec it resolves.
    await FeePayment.syncIndexes();
  });

  it('builds without error and creates a unique partial index on real MongoDB', async () => {
    const indexes = await FeePayment.collection.indexes();
    const idempotencyIndex = indexes.find((i) => i.name === IDEMPOTENCY_INDEX_NAME);

    expect(idempotencyIndex, 'idempotency index should exist after syncIndexes').toBeDefined();
    expect(idempotencyIndex.unique).toBe(true);
    expect(idempotencyIndex.partialFilterExpression).toEqual({
      idempotencyKey: { $type: 'string' },
    });
  });

  it('blocks a second fee payment reusing the same (schoolId, idempotencyKey)', async () => {
    // Raw inserts bypass Mongoose validation so we can exercise the index in
    // isolation. Distinct receiptNumbers avoid tripping the separate
    // { schoolId, receiptNumber } unique index.
    await FeePayment.collection.insertOne({
      schoolId,
      receiptNumber: 'RCPT-DUP-1',
      idempotencyKey: 'idem-abc-123',
    });

    await expect(
      FeePayment.collection.insertOne({
        schoolId,
        receiptNumber: 'RCPT-DUP-2',
        idempotencyKey: 'idem-abc-123',
      })
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('allows many payments with null / missing idempotencyKey (partial filter excludes them)', async () => {
    // null and absent keys are excluded by `$type: 'string'`, so they must not
    // collide the way a plain unique index would.
    await FeePayment.collection.insertOne({
      schoolId,
      receiptNumber: 'RCPT-NULL-1',
      idempotencyKey: null,
    });
    await FeePayment.collection.insertOne({
      schoolId,
      receiptNumber: 'RCPT-NULL-2',
      idempotencyKey: null,
    });
    await FeePayment.collection.insertOne({
      schoolId,
      receiptNumber: 'RCPT-MISSING-1',
      // idempotencyKey omitted entirely
    });

    const count = await FeePayment.collection.countDocuments({
      schoolId,
      idempotencyKey: { $in: [null] },
    });
    expect(count).toBeGreaterThanOrEqual(2);
  });
});
