/** Allow a salary-template name to be reused after any number of soft deletes. */

export const description =
  'Replace salary template soft-delete uniqueness with an active-only index';

const COLLECTION = 'salarytemplates';
const LEGACY_INDEX = 'schoolId_1_name_1_isDeleted_1';
const ACTIVE_INDEX = 'schoolId_1_name_1';

async function collectionExists(db) {
  return (await db.listCollections({ name: COLLECTION }).toArray()).length > 0;
}

async function dropIfPresent(collection, indexName) {
  const indexes = await collection.indexes();
  if (indexes.some((index) => index.name === indexName)) await collection.dropIndex(indexName);
}

export async function up(db, { dryRun }) {
  if (!(await collectionExists(db))) {
    console.log(`    [SKIP] ${COLLECTION}: collection does not exist`);
    return;
  }
  console.log('    Replacing salary-template uniqueness with an active-only partial index.');
  if (dryRun) return;
  const collection = db.collection(COLLECTION);
  await dropIfPresent(collection, LEGACY_INDEX);
  await collection.createIndex(
    { schoolId: 1, name: 1 },
    { name: ACTIVE_INDEX, unique: true, partialFilterExpression: { isDeleted: false } }
  );
}

export async function down(db, { dryRun }) {
  if (!(await collectionExists(db))) return;
  console.log('    Restoring legacy salary-template soft-delete uniqueness.');
  if (dryRun) return;
  const collection = db.collection(COLLECTION);
  await dropIfPresent(collection, ACTIVE_INDEX);
  await collection.createIndex(
    { schoolId: 1, name: 1, isDeleted: 1 },
    { name: LEGACY_INDEX, unique: true }
  );
}
