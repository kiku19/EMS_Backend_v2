import { StudentFeeStructure } from '../database.js';

/**
 * Read a StudentFeeStructure, apply `mutator(doc)`, and save — retrying
 * on Mongoose VersionError (concurrent payment mutated the same doc).
 *
 * Why: multiple payment flows (routes/fees.js, routes/studentFees.js) read
 * sfs.feeHeads into memory, mutate it, then call save(). Without optimistic
 * concurrency this silently dropped the loser's writes. The schema now has
 * `optimisticConcurrency: true` so save() throws VersionError on conflict;
 * this helper retries the read-mutate-save cycle so the caller doesn't
 * need to re-implement the loop every time.
 *
 * Returns the saved doc, or null when no doc matched the filter.
 * Throws if the mutator rejects or if the retries are exhausted.
 */
export async function updateFeeStructureWithRetry(
  filter,
  mutator,
  { maxRetries = 5, session } = {}
) {
  // Defense-in-depth: never mutate an archived student's fee structure.
  // Callers (payment/fee flows) already scope to live students, but merging
  // isDeleted here guarantees a soft-deleted ledger can't be paid/edited even
  // if a future caller forgets to filter.
  const mergedFilter = { ...filter, isDeleted: { $ne: true } };
  let lastError = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const doc = await StudentFeeStructure.findOne(mergedFilter).session(session || null);
    if (!doc) return null;

    await mutator(doc);
    try {
      return await doc.save({ session: session || undefined });
    } catch (err) {
      // Only retry on the optimistic-concurrency conflict. Anything else —
      // ValidationError, duplicate-key, etc. — the caller should handle.
      const isVersionConflict =
        err?.name === 'VersionError' ||
        (err?.name === 'MongoServerError' && /version/i.test(err.message));
      if (!isVersionConflict) throw err;
      lastError = err;
    }
  }
  throw lastError || new Error('StudentFeeStructure update exhausted retries');
}
