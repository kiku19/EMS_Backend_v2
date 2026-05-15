/**
 * Remove Legacy Flat Parent Fields from Student Schema
 *
 * Migrates any remaining flat parent field data into the canonical `parents[]`
 * array, then unsets the legacy fields:
 *   - parentName
 *   - parentPhone
 *   - parentEmail
 *   - parentRelationship
 *   - parentOccupation
 *   - alternatePhone
 *
 * IMPORTANT: Run this migration BEFORE deploying the code changes that remove
 * the flat fields from the Mongoose schema, OR deploy the code with both old
 * and new fields first, then run this migration, then deploy the final cleanup.
 */

export const description =
  'Migrate legacy flat parent fields to parents[] array and unset them';

// ---------------------------------------------------------------------------
// up
// ---------------------------------------------------------------------------

export async function up(db, { dryRun }) {
  const studentCollection = db.collection('students');

  const stats = {
    total: 0,
    parentsArrayCreated: 0,
    fieldsUnsets: 0,
    errors: [],
  };

  const cursor = studentCollection.find({
    $or: [
      { parentName: { $exists: true, $ne: null } },
      { parentPhone: { $exists: true, $ne: null } },
      { parentEmail: { $exists: true, $ne: null } },
      { parentRelationship: { $exists: true, $ne: null } },
      { parentOccupation: { $exists: true, $ne: null } },
      { alternatePhone: { $exists: true, $ne: null } },
    ],
  });

  let batch = [];
  const BATCH_SIZE = 100;

  const flush = async () => {
    if (batch.length > 0 && !dryRun) {
      await studentCollection.bulkWrite(batch);
    }
    batch = [];
  };

  while (await cursor.hasNext()) {
    const student = await cursor.next();
    stats.total++;

    const $set = {};
    const $unset = {};
    let changed = false;

    // If the student has no parents array (or it's empty), build one from flat fields
    const hasParentsArray = Array.isArray(student.parents) && student.parents.length > 0;

    if (!hasParentsArray) {
      const parentEntry = {
        name: student.parentName || 'Parent',
        relationship: student.parentRelationship || 'Parent',
        phone: student.parentPhone || undefined,
        email: student.parentEmail || undefined,
        occupation: student.parentOccupation || undefined,
        isWhatsapp: true,
      };

      // Clean undefined values
      Object.keys(parentEntry).forEach((key) => {
        if (parentEntry[key] === undefined) delete parentEntry[key];
      });

      $set.parents = [parentEntry];
      stats.parentsArrayCreated++;
      changed = true;
    }

    // Unset all legacy flat parent fields
    const legacyFields = [
      'parentName',
      'parentPhone',
      'parentEmail',
      'parentRelationship',
      'parentOccupation',
      'alternatePhone',
    ];

    for (const field of legacyFields) {
      if (student[field] !== undefined) {
        $unset[field] = '';
        changed = true;
      }
    }

    if (changed) {
      const updateDoc = {};
      if (Object.keys($set).length > 0) updateDoc.$set = $set;
      if (Object.keys($unset).length > 0) updateDoc.$unset = $unset;

      batch.push({ updateOne: { filter: { _id: student._id }, update: updateDoc } });
      stats.fieldsUnsets += Object.keys($unset).length;

      if (batch.length >= BATCH_SIZE) await flush();
    }
  }

  await flush();

  console.log(`    Processed: ${stats.total} students`);
  console.log(`    parents[] arrays created: ${stats.parentsArrayCreated}`);
  console.log(`    legacy fields unset: ${stats.fieldsUnsets}`);
  if (stats.errors.length > 0) {
    console.warn(`    Warnings (${stats.errors.length}):`);
    stats.errors.forEach((e) => console.warn(`      - ${e}`));
  }
}

// ---------------------------------------------------------------------------
// down — not reversible (data is intentionally migrated, not duplicated back)
// ---------------------------------------------------------------------------

export async function down(_db, { dryRun }) {
  console.log(
    '    Flat parent field removal is not reversible. ' +
      'Restore from a database backup to undo this migration.'
  );
  if (dryRun) console.log('    (dry-run: no action taken)');
}
