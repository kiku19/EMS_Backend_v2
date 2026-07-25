/**
 * Exam status helper.
 *
 * Exam.status on disk only ever carries two values in practice: 'scheduled'
 * (the schema default, set on creation) and 'results_published' (set by the
 * publish endpoint). The 'ongoing' and 'completed' states from the enum are
 * never written by any route, yet the parent app + dashboard both want to
 * surface them. Rather than run a migration, we derive an *effective* status
 * from the exam's dates on read and expose it as a computed field
 * (`effectiveStatus`) alongside the stored `status`.
 *
 * Precedence:
 *   1. isPublished === true  → 'results_published' (results are out — this
 *      overrides the date logic so a published exam stays "published" even
 *      if its endDate is in the future, and an unpublish correctly falls back
 *      to a date-derived value because the publish route also clears the flag)
 *   2. now < startDate        → 'scheduled'
 *   3. startDate <= now <= endDate → 'ongoing'
 *   4. now > endDate          → 'completed'
 *
 * The function never mutates its input.
 */

export const EXAM_EFFECTIVE_STATUSES = ['scheduled', 'ongoing', 'completed', 'results_published'];

/**
 * Compute the effective, date-derived status of an exam.
 *
 * @param {object} exam  Exam document (Mongoose doc or plain object). Only the
 *                       `isPublished`, `startDate` and `endDate` fields are read.
 * @param {Date} [now]   Reference time. Defaults to `new Date()`; tests pass a
 *                       frozen value so assertions are deterministic.
 * @returns {'scheduled'|'ongoing'|'completed'|'results_published'}
 */
export function effectiveExamStatus(exam, now = new Date()) {
  if (!exam) return 'scheduled';

  // Published results are the source of truth — the publish route sets both
  // `status: 'results_published'` and `isPublished: true`; unpublish clears
  // the flag and resets status to 'completed', at which point we want the
  // date logic below to re-derive. Reading `isPublished` (rather than the
  // stored `status`) keeps this robust to legacy rows whose status field
  // never got migrated.
  if (exam.isPublished === true) return 'results_published';

  const ref = now instanceof Date ? now : new Date(now);
  const refTime = Number.isFinite(ref.getTime()) ? ref.getTime() : Date.now();

  const start = exam.startDate ? new Date(exam.startDate).getTime() : null;
  const end = exam.endDate ? new Date(exam.endDate).getTime() : null;

  // No start date → we can't place it on the timeline, keep it scheduled.
  if (start == null || Number.isNaN(start)) return 'scheduled';

  if (refTime < start) return 'scheduled';
  // Missing endDate: treat a same-day / single-moment exam as ongoing for the
  // instant it starts, then completed once that instant has passed. With both
  // dates present we use an inclusive range so an exam whose end == now is
  // still "ongoing" (e.g. an exam ending at 23:59 on the current day).
  if (end == null || Number.isNaN(end)) {
    return refTime === start ? 'ongoing' : 'completed';
  }
  if (refTime > end) return 'completed';
  return 'ongoing';
}

/**
 * Attach the computed `effectiveStatus` to an exam object without overwriting
 * the persisted `status` field. Returns a new object (or the same plain object
 * reference with the field added when the input is already a plain object —
 * callers spread the result so this stays safe). For Mongoose documents pass
 * `doc.toObject()` first.
 *
 * @param {object} exam
 * @param {Date} [now]
 * @returns {object} exam with an added `effectiveStatus` field
 */
export function withEffectiveStatus(exam, now = new Date()) {
  if (!exam) return exam;
  return { ...exam, effectiveStatus: effectiveExamStatus(exam, now) };
}
