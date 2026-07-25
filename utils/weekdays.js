// Single source of truth for the weekly schedule day list. Keep this in
// sync with the Timetable schema's `schedule` sub-document keys.
//
// Sunday is included so Gulf/Middle-Eastern schools whose week runs
// Sun–Thu can store their schedule. Schools on a Mon–Sat week simply
// leave Sunday empty — loops iterate an empty array harmlessly.
export const SCHEDULE_DAYS = Object.freeze([
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
]);

export const DEFAULT_WORKING_DAY_CODES = Object.freeze(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);

export const DAY_CODE_TO_NAME = Object.freeze({
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday',
  Sun: 'Sunday',
});

export const DAY_CODE_TO_INDEX = Object.freeze({
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
});

/**
 * Resolve the school's configured working-day codes to full schedule keys.
 * Empty/missing settings retain the long-standing Mon-Sat default; an
 * explicitly configured Sunday is preserved end-to-end.
 */
export function resolveWorkingScheduleDays(workingDays) {
  const configured =
    Array.isArray(workingDays) && workingDays.length > 0 ? workingDays : DEFAULT_WORKING_DAY_CODES;
  return configured.map((code) => DAY_CODE_TO_NAME[code]).filter(Boolean);
}
