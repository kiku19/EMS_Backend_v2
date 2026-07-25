/**
 * Canonical list of permission module names.
 *
 * SINGLE SOURCE OF TRUTH — both the Mongoose schema enum (models/UserPermission.js,
 * models/CustomRole.js) and the Zod route validator (routes/permissions.js) MUST
 * import this so the API accepts every module the model can store. Previously
 * the route's inline enum listed only 15 modules while the model allowed 21, so
 * saving permissions that included `homework`, `hostel`, `inventory`, `library`,
 * `ptm`, or `transport` failed validation with a 400 even though the model and
 * UI both supported them.
 */
export const PERMISSION_MODULES = Object.freeze([
  'dashboard',
  'staff',
  'students',
  'classes',
  'academics',
  'attendance',
  'timetable',
  'fees',
  'payroll',
  'messaging',
  'communication',
  'reports',
  'settings',
  'front-desk',
  'intake-forms',
  'homework',
  'hostel',
  'inventory',
  'library',
  'ptm',
  'transport',
]);
