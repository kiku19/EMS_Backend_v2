/**
 * Add the tenant-scoped indexes required by calendar range and recurrence queries.
 *
 * This migration changes indexes only. It does not modify calendar-event data.
 */

export const description = 'Create tenant-scoped calendar recurrence indexes';

const COLLECTION = 'calendarevents';
const RANGE_INDEX = 'schoolId_1_date_1_isDeleted_1';
const OCCURRENCE_INDEX = 'schoolId_1_recurrenceParentId_1_originalOccurrenceDate_1';

async function collectionExists(db) {
  return (await db.listCollections({ name: COLLECTION }).toArray()).length > 0;
}

async function dropIfPresent(collection, indexName) {
  const indexes = await collection.indexes();
  if (indexes.some((index) => index.name === indexName)) {
    await collection.dropIndex(indexName);
  }
}

export async function up(db, { dryRun }) {
  if (!(await collectionExists(db))) {
    console.log(`    [SKIP] ${COLLECTION}: collection does not exist`);
    return;
  }

  console.log('    Creating calendar range and detached-occurrence indexes.');
  if (dryRun) return;

  const collection = db.collection(COLLECTION);
  await collection.createIndex({ schoolId: 1, date: 1, isDeleted: 1 }, { name: RANGE_INDEX });
  await collection.createIndex(
    { schoolId: 1, recurrenceParentId: 1, originalOccurrenceDate: 1 },
    {
      name: OCCURRENCE_INDEX,
      unique: true,
      partialFilterExpression: { recurrenceParentId: { $exists: true }, isDeleted: false },
    }
  );
}

export async function down(db, { dryRun }) {
  if (!(await collectionExists(db))) return;
  console.log('    Removing calendar recurrence indexes.');
  if (dryRun) return;

  const collection = db.collection(COLLECTION);
  await dropIfPresent(collection, RANGE_INDEX);
  await dropIfPresent(collection, OCCURRENCE_INDEX);
}
