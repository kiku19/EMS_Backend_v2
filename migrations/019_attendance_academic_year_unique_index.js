/** Backfill Attendance.academicYear and migrate the uniqueness index. */

import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

export const description =
  'Backfill Attendance.academicYear from the record date, then replace the ' +
  '{ schoolId, studentId, date } unique index with one that includes academicYear';

const OLD_INDEX_NAME = 'schoolId_1_studentId_1_date_1';
const NEW_INDEX_NAME = 'schoolId_1_studentId_1_date_1_academicYear_1';

async function collectionExists(db) {
  return (await db.listCollections({ name: 'attendances' }).toArray()).length > 0;
}

/**
 * Derive the Indian academic year (Apr–Mar) from an attendance date, e.g.
 * 2025-03-31 → "2024-25", 2025-04-01 → "2025-26". Falls back to the calendar
 * year if the date is missing/invalid.
 */
function academicYearFromDate(value) {
  if (!value) return CURRENT_ACADEMIC_YEAR;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return CURRENT_ACADEMIC_YEAR;
  const year = d.getFullYear();
  // April (month index 3) or later belongs to the academic year starting that year.
  return d.getMonth() >= 3
    ? `${year}-${String((year + 1) % 100).padStart(2, '0')}`
    : `${year - 1}-${String(year % 100).padStart(2, '0')}`;
}

export async function up(db, { dryRun }) {
  if (!(await collectionExists(db))) return;
  const attendance = db.collection('attendances');

  // 1. Backfill academicYear on any documents that don't have one yet, derived
  //    from the record's date. Without this, the new unique index would group
  //    every legacy row under the schema default and could still collide.
  const filter = { academicYear: { $in: [null, undefined, ''] } };
  const toBackfill = await attendance.countDocuments(filter);
  console.log(`    [SCAN] ${toBackfill} attendance record(s) missing academicYear`);
  if (!dryRun && toBackfill > 0) {
    // Use a cursor-based loop so we can compute the year per document from its
    // date — a single updateMany can't express "academicYear = f(date)".
    const cursor = attendance.find(filter, { projection: { _id: 1, date: 1 } });
    let batch = [];
    let updated = 0;
    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      batch.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { academicYear: academicYearFromDate(doc.date) } },
        },
      });
      updated += 1;
      if (batch.length >= 500) {
        await attendance.bulkWrite(batch, { ordered: false });
        batch = [];
      }
    }
    if (batch.length) await attendance.bulkWrite(batch, { ordered: false });
    console.log(`    [OK]   backfilled academicYear on ${updated} record(s)`);
  }

  if (dryRun) return;

  // 2. Drop the legacy { schoolId, studentId, date } unique index. As long as
  //    it remains, the new compound index adds no additional uniqueness, so
  //    the re-enrollment collision this migration fixes stays possible.
  const indexes = await attendance.indexes();
  if (indexes.some((index) => index.name === OLD_INDEX_NAME)) {
    await attendance.dropIndex(OLD_INDEX_NAME);
    console.log(`    [OK]   dropped attendances.${OLD_INDEX_NAME}`);
  } else {
    console.log(`    [SKIP] attendances.${OLD_INDEX_NAME} not present`);
  }

  // 3. Create the new unique index including academicYear. (Mongoose already
  //    declares this on the model, but creating it here makes the migration
  //    self-sufficient if the model hasn't synced its indexes yet.)
  if (!indexes.some((index) => index.name === NEW_INDEX_NAME)) {
    await attendance.createIndex(
      { schoolId: 1, studentId: 1, date: 1, academicYear: 1 },
      { name: NEW_INDEX_NAME, unique: true, partialFilterExpression: { isDeleted: false } }
    );
    console.log(`    [OK]   created attendances.${NEW_INDEX_NAME}`);
  }
}

export async function down(db, { dryRun }) {
  if (!(await collectionExists(db))) return;
  const attendance = db.collection('attendances');
  const indexes = await attendance.indexes();

  if (!dryRun) {
    if (indexes.some((index) => index.name === NEW_INDEX_NAME)) {
      await attendance.dropIndex(NEW_INDEX_NAME);
      console.log(`    [OK]   dropped attendances.${NEW_INDEX_NAME}`);
    }
    if (!indexes.some((index) => index.name === OLD_INDEX_NAME)) {
      await attendance.createIndex(
        { schoolId: 1, studentId: 1, date: 1 },
        { name: OLD_INDEX_NAME, unique: true }
      );
      console.log(`    [OK]   restored attendances.${OLD_INDEX_NAME}`);
    }
  } else {
    console.log('    [DRY] would restore the legacy attendance unique index');
  }
}
