import mongoose from 'mongoose';
import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';

import * as feeSoftDeleteMigration from '../migrations/020_soft_delete_fee_collections.js';

// Validates migration 020 against the in-memory test DB: the $lookup correctly
// identifies fee docs whose owning Student is soft-deleted, dry-run scans
// without writing, the live run flags only the orphans (leaving live-student
// and already-flagged records untouched), and down() clears the flags.

const COLLECTIONS = ['studentfeestructures', 'feepayments', 'feerefunds'];

async function seedFixture(db) {
  const schoolId = new ObjectId();
  const classId = new ObjectId();

  // A soft-deleted (archived) student — its fee docs are latent orphans.
  const archivedStudentId = new ObjectId();
  // A live student — its fee docs must NOT be flagged.
  const liveStudentId = new ObjectId();

  await db.collection('students').insertMany([
    { _id: archivedStudentId, schoolId, name: 'Archived', isDeleted: true },
    { _id: liveStudentId, schoolId, name: 'Live', isDeleted: false },
  ]);

  const common = { schoolId, classId, academicYear: '2025-26' };

  // One orphan + one live doc per fee collection.
  await db.collection('studentfeestructures').insertMany([
    { ...common, _id: new ObjectId(), studentId: archivedStudentId, totalBalance: 100 },
    { ...common, _id: new ObjectId(), studentId: liveStudentId, totalBalance: 50 },
  ]);
  await db.collection('feepayments').insertMany([
    {
      ...common,
      _id: new ObjectId(),
      studentId: archivedStudentId,
      amount: 10,
      receiptNumber: 'R1',
    },
    { ...common, _id: new ObjectId(), studentId: liveStudentId, amount: 5, receiptNumber: 'R2' },
  ]);
  await db.collection('feerefunds').insertMany([
    { ...common, _id: new ObjectId(), studentId: archivedStudentId, amount: 1, refundNumber: 'F1' },
    { ...common, _id: new ObjectId(), studentId: liveStudentId, amount: 2, refundNumber: 'F2' },
  ]);

  return { schoolId, archivedStudentId, liveStudentId };
}

describe('020_soft_delete_fee_collections migration', () => {
  it('dry-run reports the orphan counts without writing any flags', async () => {
    const db = mongoose.connection.db;
    await seedFixture(db);

    const stdoutSpy = jestLikeSpy();
    const origLog = console.log;
    console.log = stdoutSpy.log;

    try {
      await feeSoftDeleteMigration.up(db, { dryRun: true });
    } finally {
      console.log = origLog;
    }

    const output = stdoutSpy.output();
    // Each of the three collections has exactly one orphan.
    expect(output).toMatch(/StudentFeeStructure: 1 orphan/);
    expect(output).toMatch(/FeePayment: 1 orphan/);
    expect(output).toMatch(/FeeRefund: 1 orphan/);
    expect(output).toMatch(/total orphans detected: 3/);

    // No flags written in dry-run.
    for (const name of COLLECTIONS) {
      const flagged = await db.collection(name).countDocuments({ isDeleted: true });
      expect(flagged).toBe(0);
    }
  });

  it('flags only the archived-student orphans and leaves live + already-flagged docs untouched', async () => {
    const db = mongoose.connection.db;
    const { archivedStudentId, liveStudentId } = await seedFixture(db);

    // Pre-flag one already-archived fee doc to prove the migration skips it
    // (it matches `isDeleted: { $ne: true }` and is not double-counted).
    const preFlagged = await db.collection('studentfeestructures').findOne({
      studentId: archivedStudentId,
    });
    await db
      .collection('studentfeestructures')
      .updateOne(
        { _id: preFlagged._id },
        { $set: { isDeleted: true, deletedAt: new Date('2024-01-01'), deletedBy: null } }
      );

    const origLog = console.log;
    console.log = () => {};
    try {
      await feeSoftDeleteMigration.up(db, { dryRun: false });
    } finally {
      console.log = origLog;
    }

    // studentfeestructures: 1 was pre-flagged, so 0 newly flagged by the
    // migration (the `isDeleted: { $ne: true }` filter excludes it).
    const sfsOrphans = await db
      .collection('studentfeestructures')
      .find({ studentId: archivedStudentId })
      .toArray();
    expect(sfsOrphans).toHaveLength(1);
    expect(sfsOrphans[0].isDeleted).toBe(true); // still flagged (pre-existing)
    expect(sfsOrphans[0].deletedAt).toEqual(new Date('2024-01-01')); // untouched

    // feepayments + feerefunds: the archived student's docs get newly flagged.
    const payOrphan = await db.collection('feepayments').findOne({ studentId: archivedStudentId });
    expect(payOrphan.isDeleted).toBe(true);
    expect(payOrphan.deletedAt).toBeInstanceOf(Date);

    const refOrphan = await db.collection('feerefunds').findOne({ studentId: archivedStudentId });
    expect(refOrphan.isDeleted).toBe(true);

    // The live student's docs are NEVER flagged.
    for (const name of COLLECTIONS) {
      const liveDocs = await db.collection(name).find({ studentId: liveStudentId }).toArray();
      expect(liveDocs).toHaveLength(1);
      expect(liveDocs[0].isDeleted).toBeFalsy();
    }
  });

  it('down() clears the soft-delete flags set by this migration', async () => {
    const db = mongoose.connection.db;
    await seedFixture(db);

    const origLog = console.log;
    console.log = () => {};
    try {
      await feeSoftDeleteMigration.up(db, { dryRun: false });
      await feeSoftDeleteMigration.down(db);
    } finally {
      console.log = origLog;
    }

    for (const name of COLLECTIONS) {
      const flagged = await db.collection(name).countDocuments({ isDeleted: true });
      expect(flagged).toBe(0);
    }
  });

  it('skips collections that do not exist without error', async () => {
    // Use an isolated database so the fee collections are absent.
    const dbName = `${mongoose.connection.db.databaseName}_migration020_${Date.now()}`;
    const db = mongoose.connection.client.db(dbName);

    const origLog = console.log;
    const logs = [];
    console.log = (msg) => logs.push(String(msg));
    try {
      await feeSoftDeleteMigration.up(db, { dryRun: false });
    } finally {
      console.log = origLog;
    }

    expect(logs.some((l) => l.includes('studentfeestructures: collection does not exist'))).toBe(
      true
    );
    expect(logs.some((l) => l.includes('feepayments: collection does not exist'))).toBe(true);
    expect(logs.some((l) => l.includes('feerefunds: collection does not exist'))).toBe(true);
  });
});

// Minimal console.log capture (Vitest has no built-in spy on console).
function jestLikeSpy() {
  const messages = [];
  return {
    log: (...args) => messages.push(args.map(String).join(' ')),
    output: () => messages.join('\n'),
  };
}
