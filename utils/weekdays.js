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
