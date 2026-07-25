/** Make transfer-certificate issuance collision-safe per school. */

export const description =
  'Add a tenant-scoped unique index for issued transfer-certificate numbers';

const INDEX_NAME = 'schoolId_1_transferCertificate.tcNumber_1';

async function studentsCollectionExists(db) {
  return (await db.listCollections({ name: 'students' }).toArray()).length > 0;
}

export async function up(db, { dryRun }) {
  console.log('    [SCAN] transfer-certificate numbers will be checked for tenant duplicates');
  if (dryRun || !(await studentsCollectionExists(db))) return;

  const students = db.collection('students');
  const duplicates = await students
    .aggregate([
      {
        $match: {
          schoolId: { $exists: true },
          'transferCertificate.tcNumber': { $type: 'string' },
        },
      },
      {
        $group: {
          _id: {
            schoolId: '$schoolId',
            tcNumber: '$transferCertificate.tcNumber',
          },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
    ])
    .toArray();

  if (duplicates.length > 0) {
    throw new Error(
      'Duplicate transfer-certificate numbers exist within a school; resolve them before applying migration 017'
    );
  }

  await students.createIndex(
    { schoolId: 1, 'transferCertificate.tcNumber': 1 },
    {
      name: INDEX_NAME,
      unique: true,
      partialFilterExpression: { 'transferCertificate.tcNumber': { $type: 'string' } },
    }
  );
  console.log(`    [OK]   students.${INDEX_NAME}`);
}

export async function down(db, { dryRun }) {
  console.log('    [SCAN] transfer-certificate unique index will be removed');
  if (dryRun || !(await studentsCollectionExists(db))) return;

  const students = db.collection('students');
  const indexes = await students.indexes();
  if (indexes.some((index) => index.name === INDEX_NAME)) {
    await students.dropIndex(INDEX_NAME);
  }
}
