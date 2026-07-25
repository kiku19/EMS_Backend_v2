import jwt from 'jsonwebtoken';
import { sendSchoolWelcomeEmail } from './emailService.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('EmailVerification');

// Same payload shape used by PR1's /self-signup and the legacy invite-based
// signup. PR2 reads it; no caller has to change.
const EMAIL_VERIFICATION_PURPOSE = 'email-verification';

// 24 hours (PR1 spec). The legacy invite-based flow used 48h; we align to
// PR1 for new self-serve signups. The token's `expiresIn` is read by
// `jwt.verify` so expired tokens surface as a 410 from the route handler.
const VERIFICATION_TOKEN_TTL = '24h';

/**
 * Issue a fresh email-verification JWT and queue a welcome email. Fire-and-
 * forget: never throws to the caller; email failures are logged.
 *
 * @param {object} params
 * @param {object} params.school  School doc (with ._id and .name/.code/.trialEndsAt)
 * @param {object} params.staff   Staff doc (with .name and the email address)
 * @param {string} params.email   Email address to embed in the token (admin's email)
 * @param {object} params.req     Express request (for logging context only)
 * @returns {string} the signed verification token
 */
export function issueEmailVerificationToken({ school, staff, email, req } = {}) {
  const jwtSecret = process.env.JWT_SECRET?.trim();
  if (!jwtSecret) {
    logger.warn('JWT_SECRET missing — cannot issue verification token');
    return null;
  }

  const token = jwt.sign(
    {
      purpose: EMAIL_VERIFICATION_PURPOSE,
      schoolId: school._id.toString(),
      email,
    },
    jwtSecret,
    { expiresIn: VERIFICATION_TOKEN_TTL }
  );

  // Fire-and-forget the email. Failures are logged but never bubble up —
  // signup / resend must succeed even if SMTP is down (the user can retry
  // resend later). PR6 will wire Sentry breadcrumbs to this log line.
  sendSchoolWelcomeEmail(
    { name: staff?.name || 'Admin', email },
    {
      name: school.name,
      code: school.code,
      trialEndsAt: school.trialEndsAt,
    },
    token
  ).catch((err) =>
    logger.warn(
      {
        err: err?.message || err,
        schoolId: school._id?.toString?.(),
        ip: req?.ip,
      },
      'Failed to send verification email'
    )
  );

  return token;
}

/**
 * Read-only helper for the audit-log line. Centralized so the audit action
 * string stays consistent across `verify-email` and `resend-verification`.
 */
export function describeVerificationToken(token) {
  if (!token) return null;
  try {
    const decoded = jwt.decode(token);
    return {
      purpose: decoded?.purpose,
      schoolId: decoded?.schoolId,
      email: decoded?.email,
      expiresAt: decoded?.exp ? new Date(decoded.exp * 1000).toISOString() : null,
    };
  } catch {
    return null;
  }
}
