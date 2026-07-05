import { z } from 'zod';

// Self-serve signup email verification (PR2 / SCH-218).
// Tokens are issued by POST /api/v1/auth/self-signup (PR1) and by the
// legacy invite-based signup, both via `jwt.sign` with the same payload
// shape: `{ purpose: 'email-verification', schoolId, email }`.
//
// We accept anything that *looks* like a JWT so a tampered payload returns
// the right error from `jwt.verify` (400 / 410) instead of a 400 from
// Zod saying "the token doesn't match the regex".

export const verifyEmailSchema = z.object({
  token: z
    .string()
    .trim()
    .min(10, 'Verification token is required')
    .max(4096, 'Verification token is too long'),
});

export const resendVerificationSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Must be a valid email address')
    .max(254, 'Email address is too long'),
});
