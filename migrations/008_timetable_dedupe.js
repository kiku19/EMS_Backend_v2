/**
 * Migration — Deduplicate Timetable documents and ensure the unique index
 *
 * Background
 * ----------
 * The Timetable schema declares a unique compound index:
 *   { schoolId: 1, classId: 1, academicYear: 1 }
 * with partialFilterExpression { isDeleted: false }.
 *
 * But several write paths in routes/timetable.js used a non-atomic
 * check-then-act pattern (`findOne` → if missing → `new Timetable().save()`).
 * Under concurrent requests (e.g. the wizard's "Generate" firing while a
 * per-slot save lands), both calls see `null` and both insert → duplicate
 * documents per class+year. If the unique index was never actually created in
 * MongoDB (common when DB_DISABLE_AUTOINDEX=true or the server started before
 * the index was added), nothing stopped the second insert.
 *
 * Symptom: GET /api/timetable returns more Timetable documents than classes.
 *
 * This migration:
 *   1. Soft-deletes the loser(s) of every (schoolId, classId, academicYear)
 *      group, keeping the newest non-deleted document (by lastSyncedAt, then
 *      updatedAt, then _id as a stable tiebreaker).
 *   2. Calls createIndexes() on the Timetable collection so the unique index
 *      is guaranteed to exist going forward — blocking new duplicates at the
 *      DB level regardless of the application path.
 *
 * The defensive collapse-by-classId in GET /api/timetable is a belt-and-
 * suspenders stopgap; this migration removes the underlying duplicates so the
 * data is correct and the index enforces uniqueness.
 */

export const description =
  'Soft-delete duplicate Timetable docs per class+year and ensure the unique index';

function rankScore(doc) {
  return (
    new Date(doc.lastSyncedAt || doc.updatedAt || 0).getTime() ||
    new Date(doc._id?.getTimestamp?.() || 0).getTime()
  );
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function normalizeSlots(slots = []) {
  const normalized = slots.map((slot) => ({
    subject: slot?.subject || '',
    teacherId: slot?.teacherId ? String(slot.teacherId) : null,
    room: slot?.room || '',
  }));
  // Missing trailing empty slots and explicitly stored trailing empty slots
  // are semantically equivalent for duplicate detection.
  while (
    normalized.length > 0 &&
    !normalized.at(-1).subject &&
    !normalized.at(-1).teacherId &&
    !normalized.at(-1).room
  ) {
    normalized.pop();
  }
  return normalized;
}

function semanticPayload(doc) {
  return JSON.stringify({
    periods: (doc.periods || []).map((period) => ({
      name: period?.name || '',
      startTime: period?.startTime || '',
      endTime: period?.endTime || '',
      isBreak: Boolean(period?.isBreak),
    })),
    schedule: Object.fromEntries(DAYS.map((day) => [day, normalizeSlots(doc.schedule?.[day])])),
  });
}

export async function up(db, { dryRun }) {
  const collection = 'timetables';

  const colls = await db.listCollections({ name: collection }).toArray();
  if (colls.length === 0) {
    console.log(`    [SKIP] ${collection}: collection does not exist`);
    return;
  }

  // ── 1. Dedupe ──────────────────────────────────────────────────────
  const all = await db
    .collection(collection)
    .find({ isDeleted: { $ne: true } })
    .toArray();

  // Group by the unique key. classId may be null for orphan docs — those are
  // excluded from dedup (they can't conflict on the index anyway).
  const groups = new Map();
  let orphanCount = 0;
  for (const doc of all) {
    if (!doc.classId) {
      orphanCount += 1;
      continue;
    }
    const key = `${String(doc.schoolId)}::${String(doc.classId)}::${String(doc.academicYear)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(doc);
  }

  const losers = [];
  const divergentGroups = [];
  let dupGroups = 0;
  for (const [key, docs] of groups) {
    if (docs.length <= 1) continue;
    dupGroups += 1;
    // Keep the highest-ranked; soft-delete the rest.
    const sorted = docs.sort((a, b) => rankScore(b) - rankScore(a));
    const payloads = new Set(sorted.map(semanticPayload));
    if (payloads.size > 1) {
      // Refuse to guess which divergent class schedule is correct. A silent
      // newest-wins policy can drop valid teacher/room assignments. The
      // migration must stop before making any writes so the operator can
      // reconcile this small, explicitly reported set from the backup.
      divergentGroups.push({ key, ids: sorted.map((doc) => String(doc._id)) });
      continue;
    }
    sorted.slice(1).forEach((d) => losers.push(d._id));
  }

  console.log(
    `    [SCAN] ${collection}: ${all.length} active docs, ${groups.size} unique keys, ${dupGroups} duplicated, ${orphanCount} orphan (no classId)`
  );

  if (divergentGroups.length > 0) {
    divergentGroups.forEach((group) => {
      console.log(`    [BLOCK] Divergent duplicate ${group.key}: ${group.ids.join(', ')}`);
    });
    const message =
      `Refusing to deduplicate ${divergentGroups.length} timetable group(s) with different periods/schedules. ` +
      'Reconcile the listed document ids from a backup, then rerun the migration.';
    if (dryRun) {
      console.log(`    [DRY-RUN] ${message}`);
      return;
    }
    throw new Error(message);
  }

  if (losers.length === 0) {
    console.log(`    [OK]   No duplicate timetables found.`);
  } else {
    console.log(
      `    [DEDUP] Soft-deleting ${losers.length} duplicate document(s), keeping the newest per class+year.`
    );
    if (!dryRun) {
      const result = await db
        .collection(collection)
        .updateMany(
          { _id: { $in: losers } },
          { $set: { isDeleted: true, deletedAt: new Date(), dedupReason: '008_timetable_dedupe' } }
        );
      console.log(`    [OK]   Marked ${result.modifiedCount} duplicate(s) as isDeleted.`);
    }
  }

  // Legacy active documents often pre-date the isDeleted field. A partial
  // unique index with `{ isDeleted: false }` does not cover a missing field,
  // so normalize every survivor before creating the index. Without this, a
  // new `isDeleted:false` document can coexist with a legacy missing-field
  // winner and recreate the duplicate immediately.
  const loserKeys = new Set(losers.map(String));
  const survivorIds = all.filter((doc) => !loserKeys.has(String(doc._id))).map((doc) => doc._id);
  const needsNormalization = all.filter(
    (doc) => !loserKeys.has(String(doc._id)) && doc.isDeleted !== false
  ).length;
  console.log(`    [NORMALIZE] ${needsNormalization} active survivor(s) need isDeleted=false.`);
  if (!dryRun && survivorIds.length > 0) {
    await db
      .collection(collection)
      .updateMany({ _id: { $in: survivorIds } }, { $set: { isDeleted: false } });
  }

  // ── 2. Ensure the unique index exists ──────────────────────────────
  const indexName = 'schoolId_1_classId_1_academicYear_1';
  const indexes = await db.collection(collection).indexes();
  const existing = indexes.find(
    (i) =>
      Object.keys(i.key || {}).length === 3 &&
      i.key.schoolId === 1 &&
      i.key.classId === 1 &&
      i.key.academicYear === 1
  );

  if (existing?.unique) {
    console.log(`    [SKIP] Unique index '${existing.name}' already present.`);
  } else {
    if (existing) {
      console.log(
        `    [DROP] Non-unique index '${existing.name}' — dropping so we can recreate it unique.`
      );
      if (!dryRun) {
        try {
          await db.collection(collection).dropIndex(existing.name);
        } catch (err) {
          if (!(err.code === 27 || err.codeName === 'IndexNotFound')) throw err;
        }
      }
    }
    console.log(
      `    [CREATE] Unique index '${indexName}' with partialFilterExpression { isDeleted: false }.`
    );
    if (!dryRun) {
      try {
        await db
          .collection(collection)
          .createIndex(
            { schoolId: 1, classId: 1, academicYear: 1 },
            { unique: true, name: indexName, partialFilterExpression: { isDeleted: false } }
          );
        console.log(`    [OK]   Unique index created.`);
      } catch (err) {
        // If duplicates survived (shouldn't, since we just soft-deleted them),
        // surface a clear message instead of a cryptic E11000.
        if (err?.code === 11000 || err?.code === 11001) {
          throw new Error(
            `Cannot create unique index: duplicate timetables still present after dedup. ` +
              `Re-run the migration or inspect the timetables collection manually.`,
            { cause: err }
          );
        }
        throw err;
      }
    }
  }
}

export async function down(db, { dryRun }) {
  // Restore soft-deleted docs flagged by this migration (re-introduces the
  // duplicate problem — only run this if you know why). The unique index
  // created by `up` must be removed first; otherwise MongoDB rejects the
  // restore with E11000 and leaves the rollback half-applied.
  console.log(
    '    Dropping the timetable uniqueness index and restoring docs flagged dedupReason=008_timetable_dedupe (re-introduces duplicates).'
  );
  if (dryRun) {
    console.log('    (dry-run: no action taken)');
    return;
  }

  const collection = db.collection('timetables');
  const indexes = await collection.indexes();
  const uniqueIndex = indexes.find(
    (index) =>
      index.unique === true &&
      Object.keys(index.key || {}).length === 3 &&
      index.key.schoolId === 1 &&
      index.key.classId === 1 &&
      index.key.academicYear === 1
  );
  if (uniqueIndex) {
    await collection.dropIndex(uniqueIndex.name);
    console.log(`    [OK] Dropped unique index '${uniqueIndex.name}'.`);
  }

  const result = await collection.updateMany(
    { dedupReason: '008_timetable_dedupe' },
    { $set: { isDeleted: false }, $unset: { deletedAt: '', dedupReason: '' } }
  );
  console.log(`    [OK] Restored ${result.modifiedCount} document(s).`);
}
