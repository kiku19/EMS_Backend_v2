/**
 * Replace global SalaryAdjustment indexes with tenant-prefixed indexes.
 *
 * The migration changes indexes only; it does not modify payroll data.
 */

export const description = 'Prefix SalaryAdjustment query indexes with schoolId';

const COLLECTION = 'salaryadjustments';
const TENANT_EMPLOYEE_INDEX = 'schoolId_1_employeeId_1_effectiveMonth_1_effectiveYear_1';
const TENANT_ACTIVE_INDEX = 'schoolId_1_isActive_1';

async function collectionExists(db) {
  return (await db.listCollections({ name: COLLECTION }).toArray()).length > 0;
}

async function dropIfPresent(collection, indexName) {
  const indexes = await collection.indexes();
  if (!indexes.some((index) => index.name === indexName)) return;
  await collection.dropIndex(indexName);
}

export async function up(db, { dryRun }) {
  if (!(await collectionExists(db))) {
    console.log(`    [SKIP] ${COLLECTION}: collection does not exist`);
    return;
  }

  console.log('    Replacing global SalaryAdjustment indexes with tenant-prefixed indexes.');
  if (dryRun) return;

  const collection = db.collection(COLLECTION);
  await dropIfPresent(collection, 'employeeId_1_effectiveMonth_1_effectiveYear_1');
  await dropIfPresent(collection, 'isActive_1');
  await collection.createIndex(
    { schoolId: 1, employeeId: 1, effectiveMonth: 1, effectiveYear: 1 },
    { name: TENANT_EMPLOYEE_INDEX }
  );
  await collection.createIndex({ schoolId: 1, isActive: 1 }, { name: TENANT_ACTIVE_INDEX });
}

export async function down(db, { dryRun }) {
  if (!(await collectionExists(db))) return;
  console.log('    Restoring the legacy SalaryAdjustment indexes.');
  if (dryRun) return;

  const collection = db.collection(COLLECTION);
  await dropIfPresent(collection, TENANT_EMPLOYEE_INDEX);
  await dropIfPresent(collection, TENANT_ACTIVE_INDEX);
  await collection.createIndex(
    { employeeId: 1, effectiveMonth: 1, effectiveYear: 1 },
    { name: 'employeeId_1_effectiveMonth_1_effectiveYear_1' }
  );
  await collection.createIndex({ isActive: 1 }, { name: 'isActive_1' });
}
