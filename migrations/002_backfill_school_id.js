/**
 * Backfill schoolId on all legacy documents
 *
 * Finds documents in every multi-tenant collection that are missing the
 * schoolId field and sets them to the default school's _id.
 *
 * This was previously a one-off script at scripts/backfillSchoolId.js.
 * Wrapping it here makes it tracked, versioned, and safe to re-run (idempotent).
 */

export const description =
  'Backfill missing schoolId on all legacy documents using the default school';

/** Collections that require schoolId for multi-tenancy scoping. */
const COLLECTIONS = [
  'staffs',
  'students',
  'classes',
  'attendances',
  'exams',
  'results',
  'teachertimetables',
  'substitutions',
  'appointments',
  'announcements',
  'staffattendances',
  'gatepasses',
  'studentfeestructures',
  'feepayments',
];

async function getDefaultSchool(db) {
  // Prefer a school flagged as default, otherwise take the first one found.
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

  const missingFilter = { $or: [{ schoolId: { $exists: false } }, { schoolId: null }] };

  let totalUpdated = 0;

  for (const collName of COLLECTIONS) {
    const coll = db.collection(collName);

    // Check collection exists
    const existing = await db.listCollections({ name: collName }).toArray();
    if (existing.length === 0) {
      console.log(`    [SKIP] ${collName}: collection does not exist`);
      continue;
    }

    const pendingCount = await coll.countDocuments(missingFilter);
    if (pendingCount === 0) {
      console.log(`    [OK]   ${collName}: all documents already have schoolId`);
      continue;
    }

    if (dryRun) {
      console.log(`    [DRY]  ${collName}: ${pendingCount} documents would be updated`);
    } else {
      const result = await coll.updateMany(missingFilter, { $set: { schoolId } });
      const updated = result.modifiedCount ?? 0;
      totalUpdated += updated;
      console.log(`    [DONE] ${collName}: ${updated} documents updated`);
    }
  }

  if (!dryRun) {
    console.log(`    Total documents updated: ${totalUpdated}`);
  }
}

export async function down(_db, { dryRun }) {
  // Removing schoolId from documents would break the multi-tenant app.
  // This migration is intentionally non-reversible.
  console.log(
    '    schoolId backfill is not reversible — removing it would break multi-tenancy. ' +
      'No action taken.'
  );
  if (dryRun) console.log('    (dry-run: no action taken)');
}
