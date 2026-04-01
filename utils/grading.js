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
