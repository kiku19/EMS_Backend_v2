/**
 * Backend application constants
 * Centralized configuration values
 */

export function getDefaultAcademicYear(referenceDate = new Date()) {
  // Default to an April-March academic cycle unless overridden in school settings.
  const startYear = referenceDate.getMonth() >= 3
    ? referenceDate.getFullYear()
    : referenceDate.getFullYear() - 1;

  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/**
 * Current Academic Year
 * Can be updated annually or fetched from school settings
 * Format: 'YYYY-YY' (e.g., '2024-25' for 2024-2025 academic year)
 */
export const CURRENT_ACADEMIC_YEAR = getDefaultAcademicYear();
