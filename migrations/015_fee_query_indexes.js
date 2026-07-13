/** Align finance indexes with tenant-first production query patterns. */

export const description =
  'Replace legacy fee-ledger index order and add finance list/refund lookup indexes';

async function exists(db, name) {
  return (await db.listCollections({ name }).toArray()).length > 0;
}

async function dropIfPresent(collection, name) {
  const indexes = await collection.indexes();
  if (indexes.some((index) => index.name === name)) await collection.dropIndex(name);
}

export async function up(db, { dryRun }) {
  console.log('    [SCAN] finance query indexes will be synchronized (no document updates)');
  if (dryRun) return;

  if (await exists(db, 'studentfeestructures')) {
    const ledgers = db.collection('studentfeestructures');
    await dropIfPresent(ledgers, 'studentId_1_academicYear_1_schoolId_1');
    await ledgers.createIndex(
      { schoolId: 1, studentId: 1, academicYear: 1 },
      { unique: true, name: 'schoolId_1_studentId_1_academicYear_1' }
    );
  }
  if (await exists(db, 'feepayments')) {
    await db
      .collection('feepayments')
      .createIndex(
        { schoolId: 1, academicYear: 1, status: 1, paymentDate: -1 },
        { name: 'schoolId_1_academicYear_1_status_1_paymentDate_-1' }
      );
  }
  if (await exists(db, 'feerefunds')) {
    await db
      .collection('feerefunds')
      .createIndex(
        { schoolId: 1, originalPaymentId: 1, status: 1 },
        { name: 'schoolId_1_originalPaymentId_1_status_1' }
      );
  }
  if (await exists(db, 'feetemplates')) {
    const templates = db.collection('feetemplates');
    await templates.createIndex(
      { schoolId: 1, academicYear: 1, isActive: 1, name: 1 },
      { name: 'schoolId_1_academicYear_1_isActive_1_name_1' }
    );
    await templates.createIndex(
      { groupId: 1, academicYear: 1, isGroupTemplate: 1, isActive: 1 },
      { name: 'groupId_1_academicYear_1_isGroupTemplate_1_isActive_1' }
    );
  }
}

export async function down(db, { dryRun }) {
  console.log('    [SCAN] finance query indexes will be restored to their legacy shape');
  if (dryRun) return;
  if (await exists(db, 'studentfeestructures')) {
    const ledgers = db.collection('studentfeestructures');
    await dropIfPresent(ledgers, 'schoolId_1_studentId_1_academicYear_1');
    await ledgers.createIndex(
      { studentId: 1, academicYear: 1, schoolId: 1 },
      { unique: true, name: 'studentId_1_academicYear_1_schoolId_1' }
    );
  }
  if (await exists(db, 'feepayments')) {
    await dropIfPresent(
      db.collection('feepayments'),
      'schoolId_1_academicYear_1_status_1_paymentDate_-1'
    );
  }
  if (await exists(db, 'feerefunds')) {
    await dropIfPresent(db.collection('feerefunds'), 'schoolId_1_originalPaymentId_1_status_1');
  }
  if (await exists(db, 'feetemplates')) {
    const templates = db.collection('feetemplates');
    await dropIfPresent(templates, 'schoolId_1_academicYear_1_isActive_1_name_1');
    await dropIfPresent(templates, 'groupId_1_academicYear_1_isGroupTemplate_1_isActive_1');
  }
}
