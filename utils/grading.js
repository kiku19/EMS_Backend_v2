/**
 * AUDIT-11: Centralized grading utility.
 *
 * Default grading scale (Indian standard):
 *   A+  >= 90%
 *   A   >= 80%
 *   B+  >= 70%
 *   B   >= 60%
 *   C   >= 50%
 *   D   >= 40%
 *   F   <  40%
 *
 * Schools can override this via SchoolSettings.gradingScale which stores
 * an array of { minPercentage, grade } objects.
 */

/** Default grade boundaries sorted descending by minPercentage */
export const DEFAULT_GRADING_SCALE = [
  { minPercentage: 90, grade: 'A+' },
  { minPercentage: 80, grade: 'A' },
  { minPercentage: 70, grade: 'B+' },
  { minPercentage: 60, grade: 'B' },
  { minPercentage: 50, grade: 'C' },
  { minPercentage: 40, grade: 'D' },
  { minPercentage: 0, grade: 'F' },
];

/**
 * Compute grade from a percentage score.
 * Uses the school's configured grading scale if provided, otherwise
 * falls back to the default Indian grading scale.
 *
 * @param {number} percentage - The percentage score (0-100, may include decimals)
 * @param {Array|null} gradingScale - Optional array of { minPercentage, grade } sorted desc
 * @returns {string} Grade string (e.g. 'A+', 'B', 'F')
 */
export function computeGrade(percentage, gradingScale = null) {
  const scale =
    gradingScale && gradingScale.length > 0
      ? [...gradingScale].sort((a, b) => b.minPercentage - a.minPercentage)
      : DEFAULT_GRADING_SCALE;

  for (const entry of scale) {
    if (percentage >= entry.minPercentage) {
      return entry.grade;
    }
  }

  // Fallback: return the lowest grade in the scale
  return scale[scale.length - 1].grade;
}

/**
 * Compute a percentage from marks/maxMarks.
 *
 * Single source of truth for percentage derivation across the app. Previously
 * the Result pre-save hook, the bulk/single/update result handlers in
 * academics.js and the recalculate handler in academicPerformance.js each
 * computed it with subtly different expressions (different rounding, some
 * clamped to 0–100, some not), which let inconsistent percentages leak into
 * grades/ranks. This helper standardises on: round to 2 decimal places, then
 * clamp to the [0, 100] range. A non-positive `maxMarks` yields 0.
 *
 * @param {number} marks - marks obtained (null/undefined treated as 0)
 * @param {number} maxMarks - maximum marks (denominator)
 * @returns {number} percentage in [0, 100] rounded to 2dp
 */
export function computePercentage(marks, maxMarks) {
  const m = Number(marks) || 0;
  const max = Number(maxMarks);
  if (!max || max <= 0) return 0;
  const raw = (m / max) * 100;
  const rounded = Math.round((raw + Number.EPSILON) * 100) / 100;
  return Math.min(100, Math.max(0, rounded));
}
