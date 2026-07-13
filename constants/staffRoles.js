export const STAFF_ROLES = Object.freeze([
  'Admin',
  'Super Admin',
  'Teacher',
  'Accountant',
  'Librarian',
  'Principal',
  'Vice Principal',
  'Lab Assistant',
  'Receptionist',
  'Counselor',
  'Driver',
  'Security',
  'Administrative',
]);

export const LEGACY_STAFF_ROLE_ALIASES = Object.freeze({
  Teaching: 'Teacher',
});

export function normalizeStaffRoles(value) {
  const roles = Array.isArray(value) ? value : [value];
  return [
    ...new Set(
      roles
        .filter((role) => typeof role === 'string' && role.trim())
        .map((role) => LEGACY_STAFF_ROLE_ALIASES[role.trim()] || role.trim())
    ),
  ];
}
