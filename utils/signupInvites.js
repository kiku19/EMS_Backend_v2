import jwt from 'jsonwebtoken';
import { getRequiredSecret } from '../config/environment.js';

const DEFAULT_INVITE_EXPIRY = '7d';
const INVITE_PURPOSE = 'school-signup';

function getSignupInviteSecret() {
  if (process.env.SIGNUP_INVITE_SECRET?.trim()) {
    return getRequiredSecret('SIGNUP_INVITE_SECRET');
  }

  return getRequiredSecret('JWT_SECRET');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeSchoolName(schoolName) {
  return String(schoolName || '').trim().replace(/\s+/g, ' ');
}

export function generateSignupInvite({ email, schoolName, invitedBy = 'system' }) {
  return jwt.sign(
    {
      purpose: INVITE_PURPOSE,
      email: normalizeEmail(email),
      schoolName: normalizeSchoolName(schoolName),
      invitedBy,
    },
    getSignupInviteSecret(),
    { expiresIn: process.env.SIGNUP_INVITE_EXPIRES_IN || DEFAULT_INVITE_EXPIRY }
  );
}

export function verifySignupInvite(token) {
  try {
    const decoded = jwt.verify(token, getSignupInviteSecret());

    if (decoded?.purpose !== INVITE_PURPOSE) {
      return null;
    }

    const email = normalizeEmail(decoded.email);
    const schoolName = normalizeSchoolName(decoded.schoolName);

    if (!email || !schoolName) {
      return null;
    }

    return {
      email,
      schoolName,
      invitedBy: decoded.invitedBy || 'system',
      expiresAt: decoded.exp ? new Date(decoded.exp * 1000).toISOString() : null,
    };
  } catch {
    return null;
  }
}

export function normalizeInvitedSchoolName(value) {
  return normalizeSchoolName(value);
}
