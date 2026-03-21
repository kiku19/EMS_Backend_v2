/**
 * Index Migration — Drop stale indexes and let Mongoose recreate them
 *
 * Drops old non-school-scoped or incorrectly defined indexes that were
 * replaced by the student journey audit fixes. Mongoose recreates the
 * correct indexes automatically on the next server start (ensureIndexes).
 *
 * This was previously a one-off script at scripts/migrateIndexes.js.
 */

export const description =
  'Drop stale indexes replaced by school-scoped or corrected compound indexes';

const INDEX_DROPS = [
  {
    collection: 'students',
    indexName: 'rollNo_1_classId_1_academicYear_1',
    reason: 'Replaced by partial-filter-expression index scoped to active students (Issue #4)',
  },
  {
    collection: 'classes',
    indexName: 'name_1_section_1_academicYear_1',
    reason: 'Replaced by schoolId-scoped compound unique index (Issue #16)',
  },
  {
    collection: 'feestructures',
    indexName: 'classId_1_academicYear_1',
    reason: 'Replaced by schoolId-scoped compound unique index (Issue #34)',
  },
  {
    collection: 'attendances',
    indexName: 'records.studentId_1_date_1',
    reason: 'Stale path — replaced by studentId_1_date_1 (Issue #52)',
  },
];

export async function up(db, { dryRun }) {
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
  // Restoring dropped indexes manually is rarely needed — Mongoose will recreate
  // the *correct* new indexes on startup. Recreating the *old* wrong indexes
  // would reintroduce the bugs they were removed to fix.
  console.log(
    '    Index drops are not individually reversible. ' +
      'If needed, recreate old indexes manually in MongoDB shell.'
  );
  if (dryRun) console.log('    (dry-run: no action taken)');
}
