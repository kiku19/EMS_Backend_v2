/**
 * Link Student.parents entries to the canonical Parent collection
 *
 * Background: the EMS backend historically maintained parent data in two
 * independent places:
 *   1. The standalone `parents` collection (used by the parent app for auth,
 *      messaging and profile).
 *   2. The embedded `students.parents` array (used by student management).
 *
 * `createOrUpdateParentAccount` already kept them loosely in sync by phone,
 * but there was no explicit foreign-key style link. This migration backfills
 * `student.parents.parentId` for existing records by matching the parent phone
 * to a Parent document that has the same student linked.
 *
 * Reversible: yes. The down migration clears the backfilled parentId values
 * but leaves the rest of the document untouched.
 */

import Parent from '../models/Parent.js';
import { Student } from '../database.js';
import { piiMatch } from '../utils/encryption.js';

export const description =
  'Backfill parentId on Student.parents entries from the Parent collection';

// ---------------------------------------------------------------------------
// up
// ---------------------------------------------------------------------------

export async function up(db, { dryRun }) {
  const stats = {
    scanned: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  // Find every student that has parents entries missing parentId.
  // Use a Mongoose query so PII decryption/encryption is handled transparently.
  const cursor = Student.find({
    parents: { $exists: true, $not: { $size: 0 } },
    $or: [{ 'parents.parentId': { $exists: false } }, { 'parents.parentId': null }],
  }).cursor();

  let batch = [];
  const BATCH_SIZE = 100;

  const flush = async () => {
    if (batch.length > 0 && !dryRun) {
      await Student.bulkWrite(batch);
    }
    batch = [];
  };

  for (let student = await cursor.next(); student != null; student = await cursor.next()) {
    stats.scanned++;

    try {
      const parentEntries = student.parents || [];
      const updates = [];

      for (let i = 0; i < parentEntries.length; i++) {
        const entry = parentEntries[i];
        if (entry.parentId) continue;

        const phone = typeof entry.phone === 'string' ? entry.phone.trim() : '';
        if (!phone) continue;

        // Match by phone and the linked student. The Parent schema enforces a
        // schoolId+phone unique index, so phone + student link is sufficient.
        const parent = await Parent.findOne({
          'children.studentId': student._id,
          ...piiMatch('phone', phone),
        });

        if (parent) {
          updates.push({ index: i, parentId: parent._id });
        }
      }

      if (updates.length === 0) {
        stats.skipped++;
        continue;
      }

      const $set = {};
      for (const update of updates) {
        $set[`parents.${update.index}.parentId`] = update.parentId;
      }

      batch.push({
        updateOne: {
          filter: { _id: student._id },
          update: { $set },
        },
      });
      stats.updated++;

      if (batch.length >= BATCH_SIZE) await flush();
    } catch (err) {
      stats.errors.push(`Student ${student._id}: ${err.message}`);
    }
  }

  await flush();
  await cursor.close();

  console.log(`    Scanned: ${stats.scanned} students`);
  console.log(`    Updated: ${stats.updated} students`);
  console.log(`    Skipped: ${stats.skipped} students`);
  if (stats.errors.length > 0) {
    console.warn(`    Warnings (${stats.errors.length}):`);
    stats.errors.forEach((e) => console.warn(`      - ${e}`));
  }
}

// ---------------------------------------------------------------------------
// down
// ---------------------------------------------------------------------------

export async function down(_db, { dryRun }) {
  const result = dryRun
    ? { modifiedCount: 0 }
    : await Student.updateMany(
        { 'parents.parentId': { $exists: true, $ne: null } },
        { $set: { 'parents.$[elem].parentId': null } },
        { arrayFilters: [{ 'elem.parentId': { $exists: true, $ne: null } }] }
      );

  console.log(`    Cleared parentId on ${result.modifiedCount} student documents`);
  if (dryRun) console.log('    (dry-run: no action taken)');
}
