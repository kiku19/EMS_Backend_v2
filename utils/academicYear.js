import { SchoolSettings } from '../database.js';
import { CURRENT_ACADEMIC_YEAR } from './constants.js';
import { buildSchoolScopedQuery, ensureDefaultSchool } from './schoolContext.js';

export function normalizeAcademicYear(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

/**
 * Validates that a string is a well-formed academic year in YYYY-YY format
 * where the YY suffix is exactly the last two digits of (YYYY + 1).
 * Examples: "2025-26" ✓, "2025-27" ✗, "2025-6" ✗
 */
export function isValidAcademicYear(value) {
  if (typeof value !== 'string') return false;
  const match = value.trim().match(/^(\d{4})-(\d{2})$/);
  if (!match) return false;
  const startYear = parseInt(match[1], 10);
  const endSuffix = parseInt(match[2], 10);
  const expectedSuffix = (startYear + 1) % 100;
  return endSuffix === expectedSuffix && startYear >= 2000 && startYear <= 2099;
}

export function parseAcademicYear(academicYear = CURRENT_ACADEMIC_YEAR) {
  const [startYearRaw, endYearRaw] = String(academicYear).split('-');
  const startYear = Number.parseInt(startYearRaw, 10);
  const endYearSuffix = Number.parseInt(endYearRaw, 10);

  if (Number.isNaN(startYear) || Number.isNaN(endYearSuffix)) {
    const [fallbackStartRaw] = CURRENT_ACADEMIC_YEAR.split('-');
    const fallbackStart = Number.parseInt(fallbackStartRaw, 10);
    return {
      startYear: fallbackStart,
      endYear: fallbackStart + 1,
    };
  }

  const century = Math.floor(startYear / 100) * 100;
  const rawEndYear = century + endYearSuffix;
  return {
    startYear,
    endYear: rawEndYear <= startYear ? rawEndYear + 100 : rawEndYear,
  };
}

export function getDefaultSchoolSettings(schoolId = null) {
  const { startYear, endYear } = parseAcademicYear(CURRENT_ACADEMIC_YEAR);

  return {
    ...(schoolId ? { schoolId } : {}),
    name: 'School Name',
    schoolName: 'School Name',
    address: '',
    phone: '',
    email: '',
    website: '',
    logo: '',
    academicYear: CURRENT_ACADEMIC_YEAR,
    currentSession: CURRENT_ACADEMIC_YEAR,
    academicYearStart: `${startYear}-04-01`,
    academicYearEnd: `${endYear}-03-31`,
    schoolStartTime: '08:00',
    schoolEndTime: '15:00',
    periodDuration: 45,
    periodsPerDay: 8,
    workingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    holidays: [],
    leaveTypes: [],
    subjects: [],
  };
}

export async function ensureSchoolSettings(schoolId = null) {
  const effectiveSchool = schoolId ? { _id: schoolId } : await ensureDefaultSchool();
  const effectiveSchoolId = effectiveSchool?._id || null;
  let settings = await SchoolSettings.findOne(buildSchoolScopedQuery(effectiveSchoolId));

  if (!settings) {
    settings = await SchoolSettings.create(getDefaultSchoolSettings(effectiveSchoolId));
  }

  let shouldSave = false;

  if (!settings.schoolId && effectiveSchoolId) {
    settings.schoolId = effectiveSchoolId;
    shouldSave = true;
  }

  if (!normalizeAcademicYear(settings.academicYear)) {
    settings.academicYear = normalizeAcademicYear(settings.currentSession) || CURRENT_ACADEMIC_YEAR;
    shouldSave = true;
  }

  if (!normalizeAcademicYear(settings.currentSession)) {
    settings.currentSession = settings.academicYear || CURRENT_ACADEMIC_YEAR;
    shouldSave = true;
  }

  if (!settings.name && settings.schoolName) {
    settings.name = settings.schoolName;
    shouldSave = true;
  }

  if (!settings.schoolName && settings.name) {
    settings.schoolName = settings.name;
    shouldSave = true;
  }

  if (shouldSave) {
    await settings.save();
  }

  return settings;
}

export async function getConfiguredAcademicYear(schoolId = null) {
  try {
    const settings = await ensureSchoolSettings(schoolId);
    return (
      normalizeAcademicYear(settings?.academicYear) ||
      normalizeAcademicYear(settings?.currentSession) ||
      CURRENT_ACADEMIC_YEAR
    );
  } catch (error) {
    console.warn('Falling back to default academic year:', error.message);
    return CURRENT_ACADEMIC_YEAR;
  }
}

export async function resolveAcademicYear(academicYear, schoolId = null) {
  const normalized = normalizeAcademicYear(academicYear);
  if (normalized && isValidAcademicYear(normalized)) return normalized;
  return getConfiguredAcademicYear(schoolId);
}

export function resolveAcademicYearSync(academicYear) {
  const normalized = normalizeAcademicYear(academicYear);
  if (normalized && isValidAcademicYear(normalized)) return normalized;
  return CURRENT_ACADEMIC_YEAR;
}
