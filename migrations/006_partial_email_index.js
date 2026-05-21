/**
 * Migration — Replace sparse email compound index with partial-filter-expression
 *
 * The old sparse compound index on { schoolId: 1, email: 1 } did not exclude
 * documents where email was null, because MongoDB sparse indexes on compound
 * keys include any document that has at least one of the indexed fields.
 * Since schoolId is always present, all parent records were indexed, causing
 * E11000 duplicate-key errors when multiple parents with email: null were
 * created for the same school.
 *
 * Drops the old index so Mongoose recreates it with partialFilterExpression
 * on the next server start.
 */

export const description =
  'Drop stale schoolId_1_email_1 sparse index and let Mongoose recreate it as partial';

export async function up(db, { dryRun }) {
  const collection = 'parents';
  const indexName = 'schoolId_1_email_1';

  const colls = await db.listCollections({ name: collection }).toArray();
  if (colls.length === 0) {
    console.log(`    [SKIP] ${collection}: collection does not exist`);
    return;
  }

  const indexes = await db.collection(collection).indexes();
  const exists = indexes.some((i) => i.name === indexName);

  if (!exists) {
    console.log(`    [SKIP] ${collection}.${indexName}: already removed`);
    return;
  }

  console.log(`    [DROP] ${collection}.${indexName}`);
  console.log(`           Reason: sparse compound index does not exclude null emails`);

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

  console.log(
    '    New partial-filter-expression index will be created automatically on next server start (Mongoose ensureIndexes).'
  );
}

export async function down(db, { dryRun }) {
  console.log(
    '    Restoring the old sparse index would reintroduce the duplicate-key bug. ' +
      'If needed, recreate it manually in MongoDB shell.'
  );
  if (dryRun) console.log('    (dry-run: no action taken)');
}
