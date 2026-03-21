/**
 * COPPA (Children's Online Privacy Protection Act) utilities.
 * COPPA applies to personal data collection from children under 13.
 */

export const COPPA_AGE_THRESHOLD = 13;

/**
 * Calculate age in full years from a dateOfBirth string.
 * Returns null if dateOfBirth is missing or invalid.
 */
export function getAgeFromDob(dateOfBirth) {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

/**
 * Returns true if the student's date of birth indicates they are under 13
 * (COPPA threshold). Returns false if dateOfBirth is missing or invalid.
 */
export function isCoppaApplicable(dateOfBirth) {
  const age = getAgeFromDob(dateOfBirth);
  return age !== null && age < COPPA_AGE_THRESHOLD;
}
