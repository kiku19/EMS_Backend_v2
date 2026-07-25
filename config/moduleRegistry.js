/**
 * Module Registry — single source of truth for per-school module enablement.
 *
 * A "module" is a coarse-grained product area (Fees, Library, Messaging, …) that
 * a school can switch on or off from Settings → Modules. CORE modules are the
 * non-negotiable spine of the product (Students, Staff, Classes + the shell) and
 * can never be turned off. Everything else defaults to OFF so a school can launch
 * on the core and light up features one at a time.
 *
 * The frontend mirrors this list in src/config/moduleRegistry.js — keep the keys
 * in sync. Backend gating is enforced centrally by middleware/auth/moduleAccess.js,
 * which maps the first path segment of each /api request to a module key.
 */

// Always-on. The app is unusable without these, so they are never toggleable.
export const CORE_MODULES = Object.freeze([
  'dashboard',
  'students',
  'staff',
  'classes',
  'attendance',
  'timetable',
  'settings',
]);

// Toggleable modules. `default` is the out-of-the-box state for a brand-new
// school (all false → core-only launch). `group` is purely for UI grouping on
// the Settings page.
export const TOGGLEABLE_MODULES = Object.freeze([
  {
    key: 'academics',
    label: 'Academics',
    group: 'Academics',
    description: 'Exams, results, report cards, homework & PTM',
  },
  {
    key: 'fees',
    label: 'Fees',
    group: 'Finance',
    description: 'Fee structures, collection, refunds',
  },
  {
    key: 'payroll',
    label: 'Payroll',
    group: 'Finance',
    description: 'Staff salary, payslips & salary templates',
  },
  {
    key: 'expenses',
    label: 'Expenses',
    group: 'Finance',
    description: 'Expense tracking & approvals',
  },
  {
    key: 'messaging',
    label: 'Messaging',
    group: 'Communication',
    description: 'Chat, announcements, reminders & broadcasts',
  },
  {
    key: 'front-desk',
    label: 'Front Desk',
    group: 'Operations',
    description: 'Visitors, gate passes, admissions & enquiries',
  },
  {
    key: 'library',
    label: 'Library',
    group: 'Operations',
    description: 'Books, issue/return & catalogue',
  },
  {
    key: 'inventory',
    label: 'Inventory',
    group: 'Operations',
    description: 'Assets, procurement & maintenance',
  },
  {
    key: 'transport',
    label: 'Transport',
    group: 'Operations',
    description: 'Vehicles, routes & student assignments',
  },
  {
    key: 'hostel',
    label: 'Hostel',
    group: 'Operations',
    description: 'Rooms, allocation & hostel attendance',
  },
  {
    key: 'reports',
    label: 'Reports',
    group: 'Insights',
    description: 'Cross-module reports & data exports',
  },
  {
    key: 'analytics',
    label: 'Analytics',
    group: 'Insights',
    description: 'Business & engagement dashboards',
  },
  {
    key: 'intake-forms',
    label: 'Intake Forms',
    group: 'Admin',
    description: 'Custom enrolment forms & submission funnel',
  },
  {
    key: 'dataTools',
    label: 'Data Tools',
    group: 'Admin',
    description: 'Bulk import/export & data cleanup',
  },
  { key: 'audit_logs', label: 'Audit Logs', group: 'Admin', description: 'Admin action trail' },
  {
    key: 'ai-assistant',
    label: 'AI Assistant',
    group: 'Admin',
    description: 'AI tutor & assistant (plan-gated)',
  },
]);

export const TOGGLEABLE_MODULE_KEYS = Object.freeze(TOGGLEABLE_MODULES.map((m) => m.key));

export const ALL_MODULE_KEYS = Object.freeze([...CORE_MODULES, ...TOGGLEABLE_MODULE_KEYS]);

/**
 * Maps the FIRST path segment of an /api/v1 request to a toggleable module key.
 * Only segments listed here are gated. Anything not listed (auth, students,
 * staff, classes, attendance, timetable, notifications, dashboard, settings,
 * search, permissions, super-admin, subjects, …) is always allowed so core
 * flows and system endpoints can never be locked out.
 */
export const PATH_SEGMENT_TO_MODULE = Object.freeze({
  // Academics
  'academic-performance': 'academics',
  'cbse-report-card': 'academics',
  'icse-report-card': 'academics',
  'hall-tickets': 'academics',
  exams: 'academics',
  results: 'academics',
  cce: 'academics',
  homework: 'academics',
  ptm: 'academics',
  // Fees
  'fee-heads': 'fees',
  'student-fees': 'fees',
  'fee-settings': 'fees',
  fees: 'fees',
  'fee-templates': 'fees',
  'fee-structure': 'fees',
  // Payroll
  payroll: 'payroll',
  payslips: 'payroll',
  // Expenses
  expenses: 'expenses',
  // Messaging
  messages: 'messaging',
  announcements: 'messaging',
  // Calls are initiated from the Front Desk (receptionist ring-out) and are
  // gated by the front-desk permission (routes/calls.js checkPermission). They
  // were previously mapped to 'messaging', so disabling Front Desk left
  // /api/calls/* open — remap here so module access and RBAC agree.
  calls: 'front-desk',
  whatsapp: 'messaging',
  reminders: 'messaging',
  // Front Desk
  visitors: 'front-desk',
  'gate-passes': 'front-desk',
  'front-desk': 'front-desk',
  // Operations
  library: 'library',
  transport: 'transport',
  hostel: 'hostel',
  // Insights
  reports: 'reports',
  export: 'reports',
  // Admin
  'form-assignments': 'intake-forms',
  'form-submissions': 'intake-forms',
  'intake-forms': 'intake-forms',
  'bulk-import': 'dataTools',
  'bulk-ops': 'dataTools',
  'data-cleanup': 'dataTools',
  'audit-logs': 'audit_logs',
});

const CORE_SET = new Set(CORE_MODULES);

/**
 * Resolve a School document's effective enabled-module set.
 *
 * @param {string[]|undefined|null} enabledModulesField - the raw School.enabledModules value
 * @returns {{ managed: boolean, enabled: Set<string> }}
 *   managed=false means the school predates the feature (field never set) — treat
 *   as "everything enabled" for backwards compatibility (nothing is gated) until
 *   an admin saves an explicit list. managed=true returns CORE ∪ saved keys.
 */
export function resolveEnabledModules(enabledModulesField) {
  if (!Array.isArray(enabledModulesField)) {
    return { managed: false, enabled: new Set(ALL_MODULE_KEYS) };
  }
  const enabled = new Set(CORE_MODULES);
  for (const key of enabledModulesField) {
    if (TOGGLEABLE_MODULE_KEYS.includes(key)) enabled.add(key);
  }
  return { managed: true, enabled };
}

/** Normalise an incoming list into the canonical stored form (core stripped — core is implicit). */
export function normalizeToggleableSelection(keys = []) {
  const set = new Set();
  for (const key of keys) {
    if (TOGGLEABLE_MODULE_KEYS.includes(key) && !CORE_SET.has(key)) set.add(key);
  }
  return [...set];
}
