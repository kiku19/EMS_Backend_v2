/**
 * Backend application constants
 * Centralized configuration values
 */

export function getDefaultAcademicYear(referenceDate = new Date()) {
  // Default to an April-March academic cycle unless overridden in school settings.
  const startYear =
    referenceDate.getMonth() >= 3 ? referenceDate.getFullYear() : referenceDate.getFullYear() - 1;

  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/**
 * Current Academic Year
 * Can be updated annually or fetched from school settings
 * Format: 'YYYY-YY' (e.g., '2024-25' for 2024-2025 academic year)
 */
export const CURRENT_ACADEMIC_YEAR = getDefaultAcademicYear();

/**
 * Calculate the next academic year from a given one
 * @param {string} current - Academic year in 'YYYY-YY' format (e.g., '2025-26')
 * @returns {string} Next academic year (e.g., '2026-27')
 */
export function getNextAcademicYear(current) {
  if (!current || typeof current !== 'string') return null;
  const [startStr] = current.split('-');
  const start = parseInt(startStr, 10);
  if (isNaN(start)) return null;
  return `${start + 1}-${String((start + 2) % 100).padStart(2, '0')}`;
}

/**
 * Parse academic year date range for filtering
 * @param {string} academicYear - Academic year in 'YYYY-YY' format
 * @returns {{ startDate: string, endDate: string } | null}
 */
export function getAcademicYearDateRange(academicYear) {
  if (!academicYear || typeof academicYear !== 'string') return null;
  const [startStr] = academicYear.split('-');
  const startYear = parseInt(startStr, 10);
  if (isNaN(startYear)) return null;
  return {
    startDate: `${startYear}-04-01`,
    endDate: `${startYear + 1}-03-31`,
  };
}

/**
 * Auto-suggest next class name based on current class name
 * Handles preschool (Nursery→KG, LKG→UKG, UKG→1) and numeric (4→5, 10→graduate)
 * @param {string} className - e.g., "4", "KG", "Nursery"
 * @param {number} [graduateAfter=10] - Grade number after which students graduate
 * @returns {{ nextName: string | null, isGraduating: boolean }}
 */
export function suggestNextClassName(className, graduateAfter = 10) {
  if (!className) return { nextName: null, isGraduating: false };

  const trimmed = className.trim();

  // Preschool mappings
  const preschoolMap = {
    Nursery: 'KG',
    nursery: 'KG',
    KG: '1',
    kg: '1',
    LKG: 'UKG',
    lkg: 'UKG',
    UKG: '1',
    ukg: '1',
    'Pre-KG': 'LKG',
    'pre-kg': 'LKG',
    'Pre KG': 'LKG',
  };

  if (preschoolMap[trimmed]) {
    return { nextName: preschoolMap[trimmed], isGraduating: false };
  }

  // Try to extract numeric grade (e.g., "Class 5" → 5, "5" → 5)
  const numMatch = trimmed.match(/(\d+)/);
  if (numMatch) {
    const grade = parseInt(numMatch[1], 10);
    if (grade >= graduateAfter) {
      return { nextName: null, isGraduating: true };
    }
    // Replace the number portion with next grade
    const nextName = trimmed.replace(/\d+/, String(grade + 1));
    return { nextName, isGraduating: false };
  }

  return { nextName: null, isGraduating: false };
}
