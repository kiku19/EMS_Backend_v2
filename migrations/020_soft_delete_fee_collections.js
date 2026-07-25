/**
 * Backfill: flag fee records whose owning Student was soft-deleted.
 *
 * The isDeleted/deletedAt/deletedBy fields are added in code (Mongoose) to
 * StudentFeeStructure, FeePayment, and FeeRefund. archiveStudent() now flags
 * all three when a Student is archived. This one-time backfill converts the
 * latent orphans that formed BEFORE that cascade existed into properly-flagged
 * records in a single pass, so they stop surfacing in read paths.
 *
 * A record is considered a latent orphan when its studentId points at a
 * Student with isDeleted: true AND the fee record itself is not yet flagged.
 * deletedBy is left null (the historical archive actor is not recoverable);
 * deletedAt is set to the run time so the flag is unambiguous.
 */

export const description =
  'Flag StudentFeeStructure/FeePayment/FeeRefund records whose owning Student is soft-deleted';

const COLLECTIONS = [
  { name: 'studentfeestructures', label: 'StudentFeeStructure' },
  { name: 'feepayments', label: 'FeePayment' },
  { name: 'feerefunds', label: 'FeeRefund' },
];

async function exists(db, name) {
  return (await db.listCollections({ name }).toArray()).length > 0;
}

/**
 * Finds fee docs whose studentId points at a soft-deleted Student and that are
 * not yet flagged themselves. Returns the list of orphan _ids.
 */
async function findOrphanIds(collection) {
  const orphans = await collection
    .aggregate([
      {
        $match: {
          studentId: { $exists: true, $ne: null },
          isDeleted: { $ne: true },
        },
      },
      {
        $lookup: {
          from: 'students',
          let: { sid: '$studentId' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$sid'] }, isDeleted: true } },
            { $project: { _id: 1 } },
          ],
          as: 'deletedStudent',
        },
      },
      { $match: { deletedStudent: { $size: 1 } } },
      { $project: { _id: 1 } },
    ])
    .toArray();
  return orphans.map((d) => d._id);
}

export async function up(db, { dryRun }) {
  const flaggedAt = new Date();
  let totalFlagged = 0;

  for (const { name, label } of COLLECTIONS) {
    if (!(await exists(db, name))) {
      console.log(`    [SKIP] ${name}: collection does not exist`);
      continue;
    }

    const orphanIds = await findOrphanIds(db.collection(name));
    const count = orphanIds.length;
    totalFlagged += count;

    if (dryRun) {
      console.log(`    [SCAN] ${label}: ${count} orphan record(s) would be flagged isDeleted`);
      continue;
    }

    if (count === 0) {
      console.log(`    [OK]   ${label}: 0 orphans — nothing to flag`);
      continue;
    }

    const result = await db
      .collection(name)
      .updateMany(
        { _id: { $in: orphanIds } },
        { $set: { isDeleted: true, deletedAt: flaggedAt, deletedBy: null } }
      );
    console.log(
      `    [FLAG] ${label}: flagged ${result.modifiedCount} of ${count} orphan record(s)`
    );
  }

  console.log(
    dryRun
      ? `    [SCAN] total orphans detected: ${totalFlagged}`
      : `    [DONE] total orphans flagged: ${totalFlagged}`
  );
}

export async function down(db) {
  // Best-effort rollback: clear the soft-delete flag on every record this
  // migration could have touched. Code-level default (isDeleted: false) means
  // unset is equivalent to false. Only run if you want to undo the backfill.
  for (const { name, label } of COLLECTIONS) {
    if (!(await exists(db, name))) continue;
    const result = await db
      .collection(name)
      .updateMany(
        { isDeleted: true },
        { $set: { isDeleted: false }, $unset: { deletedAt: '', deletedBy: '' } }
      );
    console.log(`    [ROLLBACK] ${label}: cleared ${result.modifiedCount} flag(s)`);
  }
}
