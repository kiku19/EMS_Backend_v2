import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';

import * as legacyIdentityIndexesMigration from '../migrations/021_remove_legacy_identity_indexes.js';

const LEGACY_INDEXES = [
  ['feepayments', 'receiptNumber_1'],
  ['parents', 'phone_1'],
  ['parents', 'schoolId_1_phone_1'],
  ['parents', 'schoolId_1_email_1'],
];

async function createLegacyIndexes(db) {
  await db.createCollection('feepayments');
  await db
    .collection('feepayments')
    .createIndex({ receiptNumber: 1 }, { name: 'receiptNumber_1', unique: true });
  await db
    .collection('feepayments')
    .createIndex(
      { schoolId: 1, receiptNumber: 1 },
      { name: 'schoolId_1_receiptNumber_1', unique: true }
    );

  await db.createCollection('parents');
  await db.collection('parents').createIndex({ phone: 1 }, { name: 'phone_1', unique: true });
  await db
    .collection('parents')
    .createIndex({ schoolId: 1, phone: 1 }, { name: 'schoolId_1_phone_1', unique: true });
  await db
    .collection('parents')
    .createIndex({ schoolId: 1, email: 1 }, { name: 'schoolId_1_email_1', unique: true });
  await db
    .collection('parents')
    .createIndex({ schoolId: 1, phoneHash: 1 }, { name: 'schoolId_1_phoneHash_1', unique: true });
  await db
    .collection('parents')
    .createIndex({ schoolId: 1, emailHash: 1 }, { name: 'schoolId_1_emailHash_1', unique: true });
}

async function indexNames(db, collection) {
  return (await db.collection(collection).indexes()).map((index) => index.name);
}

describe('021_remove_legacy_identity_indexes migration', () => {
  it('reports legacy indexes in dry-run without changing them', async () => {
    const db = mongoose.connection.client.db(`m021dry${Date.now().toString(36)}`);
    await createLegacyIndexes(db);

    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try {
      await legacyIdentityIndexesMigration.up(db, { dryRun: true });
    } finally {
      console.log = originalLog;
    }

    expect(logs.filter((line) => line.includes('would remove obsolete index'))).toHaveLength(4);
    for (const [collection, name] of LEGACY_INDEXES) {
      expect(await indexNames(db, collection)).toContain(name);
    }
  });

  it('removes only obsolete indexes and preserves tenant-safe replacements', async () => {
    const db = mongoose.connection.client.db(`m021live${Date.now().toString(36)}`);
    await createLegacyIndexes(db);

    const originalLog = console.log;
    console.log = () => {};
    try {
      await legacyIdentityIndexesMigration.up(db, { dryRun: false });
    } finally {
      console.log = originalLog;
    }

    for (const [collection, name] of LEGACY_INDEXES) {
      expect(await indexNames(db, collection)).not.toContain(name);
    }
    expect(await indexNames(db, 'feepayments')).toContain('schoolId_1_receiptNumber_1');
    expect(await indexNames(db, 'parents')).toEqual(
      expect.arrayContaining(['schoolId_1_phoneHash_1', 'schoolId_1_emailHash_1'])
    );
  });
});
