/**
 * Backfill fee-ledger tenant/year fields and replace global query indexes.
 *
 * This migration is intentionally dry-run friendly. It resolves missing
 * schoolId/academicYear from the referenced student and refuses to proceed
 * when an orphan cannot be repaired automatically.
 */

export const description =
  'Backfill fee tenant/year fields and create tenant-prefixed ledger indexes';

const COLLECTIONS = ['studentfeestructures', 'feepayments', 'feerefunds'];

async function exists(db, name) {
  return (await db.listCollections({ name }).toArray()).length > 0;
}

async function dropIfPresent(collection, name) {
  const indexes = await collection.indexes();
  if (indexes.some((index) => index.name === name)) await collection.dropIndex(name);
}

async function buildRepairs(db, collectionName) {
  if (!(await exists(db, collectionName))) return { repairs: [], orphans: [] };
  const docs = await db
    .collection(collectionName)
    .find({
      $or: [
        { schoolId: { $exists: false } },
        { schoolId: null },
        { academicYear: { $exists: false } },
        { academicYear: null },
        { academicYear: '' },
      ],
    })
    .project({ studentId: 1, schoolId: 1, academicYear: 1 })
    .toArray();
  const repairs = [];
  const orphans = [];
  for (const doc of docs) {
    const student = doc.studentId
      ? await db
          .collection('students')
          .findOne({ _id: doc.studentId }, { projection: { schoolId: 1, academicYear: 1 } })
      : null;
    const schoolId = doc.schoolId || student?.schoolId;
    const academicYear = doc.academicYear || student?.academicYear;
    if (!schoolId || !academicYear) {
      orphans.push(doc._id);
      continue;
    }
    repairs.push({ _id: doc._id, schoolId, academicYear });
  }
  return { repairs, orphans };
}

export async function up(db, { dryRun }) {
  const repairsByCollection = new Map();
  const allOrphans = [];
  for (const name of COLLECTIONS) {
    const result = await buildRepairs(db, name);
    repairsByCollection.set(name, result.repairs);
    allOrphans.push(...result.orphans.map((id) => `${name}:${id}`));
    console.log(
      `    [SCAN] ${name}: ${result.repairs.length} repairable, ${result.orphans.length} orphaned`
    );
  }
  if (allOrphans.length > 0) {
    throw new Error(
      `Fee ledger contains ${allOrphans.length} orphaned record(s) that require manual review: ${allOrphans.slice(0, 20).join(', ')}`
    );
  }
  if (dryRun) return;

  for (const [name, repairs] of repairsByCollection) {
    if (!repairs.length) continue;
    await db.collection(name).bulkWrite(
      repairs.map((repair) => ({
        updateOne: {
          filter: { _id: repair._id },
          update: { $set: { schoolId: repair.schoolId, academicYear: repair.academicYear } },
        },
      }))
    );
  }

  if (await exists(db, 'feepayments')) {
    const payments = db.collection('feepayments');
    for (const index of [
      'studentId_1_paymentDate_1',
      'studentId_1_academicYear_1',
      'classId_1_academicYear_1',
    ]) {
      await dropIfPresent(payments, index);
    }
    await payments.createIndex(
      { schoolId: 1, studentId: 1, paymentDate: -1 },
      { name: 'schoolId_1_studentId_1_paymentDate_-1' }
    );
    await payments.createIndex(
      { schoolId: 1, studentId: 1, academicYear: 1 },
      { name: 'schoolId_1_studentId_1_academicYear_1' }
    );
    await payments.createIndex(
      { schoolId: 1, classId: 1, academicYear: 1 },
      { name: 'schoolId_1_classId_1_academicYear_1' }
    );
  }

  if (await exists(db, 'feerefunds')) {
    const refunds = db.collection('feerefunds');
    await dropIfPresent(refunds, 'studentId_1_refundDate_1');
    await refunds.createIndex(
      { schoolId: 1, studentId: 1, academicYear: 1, refundDate: -1 },
      { name: 'schoolId_1_studentId_1_academicYear_1_refundDate_-1' }
    );
    await refunds.createIndex(
      { schoolId: 1, academicYear: 1, status: 1, refundDate: -1 },
      { name: 'schoolId_1_academicYear_1_status_1_refundDate_-1' }
    );
  }
}

export async function down(db, { dryRun }) {
  console.log('    Restoring legacy fee query indexes; backfilled tenant fields are retained.');
  if (dryRun) return;
  if (await exists(db, 'feepayments')) {
    const payments = db.collection('feepayments');
    await dropIfPresent(payments, 'schoolId_1_studentId_1_paymentDate_-1');
    await dropIfPresent(payments, 'schoolId_1_studentId_1_academicYear_1');
    await dropIfPresent(payments, 'schoolId_1_classId_1_academicYear_1');
    await payments.createIndex({ studentId: 1, paymentDate: 1 });
    await payments.createIndex({ studentId: 1, academicYear: 1 });
    await payments.createIndex({ classId: 1, academicYear: 1 });
  }
  if (await exists(db, 'feerefunds')) {
    const refunds = db.collection('feerefunds');
    await dropIfPresent(refunds, 'schoolId_1_studentId_1_academicYear_1_refundDate_-1');
    await dropIfPresent(refunds, 'schoolId_1_academicYear_1_status_1_refundDate_-1');
    await refunds.createIndex({ studentId: 1, refundDate: 1 });
  }
}
