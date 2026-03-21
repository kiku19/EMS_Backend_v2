/**
 * Fee Settings Multi-Tenancy Fix
 *
 * Adds schoolId to fee config collections that were previously global:
 *   - feerules
 *   - latefeerules
 *   - feeconsessions
 *   - feecollectionperiods
 *   - paymentmethodconfigs
 *
 * 1. Backfills schoolId on existing documents using the default school.
 * 2. Drops old non-school-scoped unique indexes so Mongoose can recreate
 *    the correct { schoolId, academicYear } compound indexes on next start.
 */

export const description =
  'Backfill schoolId and drop stale indexes on fee config collections (FeeRule, LateFeeRule, FeeConsession, FeeCollectionPeriod, PaymentMethodConfig)';

const COLLECTIONS = [
  'feerules',
  'latefeerules',
  'feeconsessions',
  'feecollectionperiods',
  'paymentmethodconfigs',
];

const INDEX_DROPS = [
  {
    collection: 'feerules',
    indexName: 'academicYear_1',
    reason: 'Replaced by { schoolId, academicYear } compound unique index',
  },
  {
    collection: 'latefeerules',
    indexName: 'academicYear_1',
    reason: 'Replaced by { schoolId, academicYear } compound unique index',
  },
  {
    collection: 'feecollectionperiods',
    indexName: 'academicYear_1',
    reason: 'Replaced by { schoolId, academicYear } compound unique index',
  },
  {
    collection: 'paymentmethodconfigs',
    indexName: 'academicYear_1',
    reason: 'Replaced by { schoolId, academicYear } compound unique index',
  },
  {
    collection: 'feeconsessions',
    indexName: 'academicYear_1_isActive_1',
    reason: 'Replaced by { schoolId, academicYear, isActive } compound index',
  },
];

async function getDefaultSchool(db) {
  const school =
    (await db.collection('schools').findOne({ isDefault: true })) ||
    (await db.collection('schools').findOne({}));

  if (!school) {
    throw new Error(
      'No school document found in the "schools" collection. ' +
        'Run `npm run tenant:bootstrap` first to create the default school.'
    );
  }
  return school;
}

export async function up(db, { dryRun }) {
  const school = await getDefaultSchool(db);
  const schoolId = school._id;
  console.log(`    Default school: "${school.name}" (${schoolId})`);

  // Step 1: Backfill schoolId on existing documents
  const missingFilter = { $or: [{ schoolId: { $exists: false } }, { schoolId: null }] };

  for (const collName of COLLECTIONS) {
    const existing = await db.listCollections({ name: collName }).toArray();
    if (existing.length === 0) {
      console.log(`    [SKIP] ${collName}: collection does not exist`);
      continue;
    }

    const count = await db.collection(collName).countDocuments(missingFilter);
    if (count === 0) {
      console.log(`    [OK]   ${collName}: all documents already have schoolId`);
    } else {
      console.log(`    [FIX]  ${collName}: ${count} document(s) missing schoolId`);
      if (!dryRun) {
        await db.collection(collName).updateMany(missingFilter, { $set: { schoolId } });
        console.log(`    [OK]   Backfilled ${count} document(s)`);
      }
    }
  }

  // Step 2: Drop old indexes
  for (const { collection, indexName, reason } of INDEX_DROPS) {
    const colls = await db.listCollections({ name: collection }).toArray();
    if (colls.length === 0) {
      console.log(`    [SKIP] ${collection}: collection does not exist`);
      continue;
    }

    const indexes = await db.collection(collection).indexes();
    const exists = indexes.some((i) => i.name === indexName);

    if (!exists) {
      console.log(`    [SKIP] ${collection}.${indexName}: already removed`);
      continue;
    }

    console.log(`    [DROP] ${collection}.${indexName}`);
    console.log(`           Reason: ${reason}`);

    if (!dryRun) {
      try {
        await db.collection(collection).dropIndex(indexName);
        console.log(`    [OK]   Dropped.`);
      } catch (err) {
        if (err.code === 27 || err.codeName === 'IndexNotFound') {
          console.log(`    [OK]   Already gone.`);
        } else {
          throw err;
        }
      }
    }
  }

  console.log(
    '    New indexes will be created automatically on next server start (Mongoose ensureIndexes).'
  );
}

export async function down(db, { dryRun }) {
  console.log(
    '    Removing schoolId from fee config documents and restoring old indexes ' +
      'is not automatically reversible. Recreate old indexes manually if needed.'
  );
  if (dryRun) console.log('    (dry-run: no action taken)');
}
