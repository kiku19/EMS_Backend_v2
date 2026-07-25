import { z } from 'zod';

// PR2 — email verification + resend (SCH-218).
//
// Body schemas for POST /api/v1/auth/verify-email and
// POST /api/v1/auth/resend-verification. Both endpoints are public
// (token / email is the auth) and behind the ENABLE_SELF_SIGNUP feature flag,
// not behind the staff auth middleware.
//
// Email is normalised to lowercase + trimmed before hashing / lookups to keep
// uniqueness checks stable across casing. We do not strip phone-style
// characters here — the only field is email.

// Verify-email: body carries the signed JWT issued at self-signup.
export const verifyEmailSchema = z
  .object({
    token: z.string().trim().min(1, 'Verification token is required'),
  })
  .strict();

// Resend-verification: idempotent, no info-leak; only the email field.
export const resendVerificationSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('A valid email is required'),
  })
  .strict();
