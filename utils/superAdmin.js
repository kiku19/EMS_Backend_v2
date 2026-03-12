import bcrypt from 'bcrypt';
import crypto from 'crypto';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function getSuperAdminConfig() {
  const email = normalizeEmail(process.env.SUPER_ADMIN_EMAIL);
  const password = process.env.SUPER_ADMIN_PASSWORD || '';
  const name = String(process.env.SUPER_ADMIN_NAME || 'Super Admin').trim();

  return {
    enabled: Boolean(email && password),
    email,
    password,
    name,
  };
}

export function isSuperAdminRole(roleValue) {
  const roles = Array.isArray(roleValue) ? roleValue : [roleValue];
  return roles
    .map((role) => String(role || '').trim().toLowerCase())
    .some((role) => role === 'super admin' || role === 'superadmin');
}

export function isSuperAdminUser(user) {
  return user?.userType === 'super-admin' || isSuperAdminRole(user?.role);
}

/**
 * Timing-safe string comparison to prevent timing attacks.
 * Falls back to constant-time compare if strings differ in length.
 */
function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // Still do a comparison to avoid early exit timing leak
    crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length));
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify super admin credentials.
 * Supports both bcrypt hashes (recommended) and plaintext (legacy dev-only) passwords.
 * Set SUPER_ADMIN_PASSWORD to a bcrypt hash for production use:
 *   node -e "const b=require('bcrypt');b.hash('mypassword',12).then(console.log)"
 */
export async function isSuperAdminLogin({ email, password }) {
  const config = getSuperAdminConfig();
  if (!config.enabled) {
    return false;
  }

  if (normalizeEmail(email) !== config.email) {
    return false;
  }

  const storedPassword = config.password;

  // If stored password looks like a bcrypt hash, use bcrypt.compare
  if (storedPassword.startsWith('$2b$') || storedPassword.startsWith('$2a$')) {
    return bcrypt.compare(password, storedPassword);
  }

  // Plaintext fallback — only allowed outside production
  if (process.env.NODE_ENV === 'production') {
    return false;
  }

  return timingSafeEqual(password, storedPassword);
}

export function buildSuperAdminAuthPayload() {
  const config = getSuperAdminConfig();

  return {
    id: 'super-admin',
    code: 'SUPER-ADMIN',
    name: config.name,
    role: ['Super Admin'],
    email: config.email,
    phone: null,
    classes: [],
    employeeId: 'SUPER-ADMIN',
    picture: null,
    schoolId: null,
    school: null,
    userType: 'super-admin',
  };
}
