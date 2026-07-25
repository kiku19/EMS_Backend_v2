import { ipKeyGenerator, rateLimit } from 'express-rate-limit';

const skipAuthRateLimitOutsideProd = () => process.env.NODE_ENV !== 'production';

/**
 * Email-keyed rate limiter for POST /api/v1/auth/resend-verification
 * (PR2 / SCH-218). Limit: 3 resend attempts per hour per email address.
 *
 * Email enumeration resistance: callers who hit the limit on an unknown
 * email still receive the same 200 + idempotent body that already-verified
 * callers get — see `handleResendVerification` in routes/auth.js. The
 * limiter only protects against spam; it never confirms whether the email
 * is registered.
 *
 * Following the project-wide convention (see `signupLimiter` and
 * `authLimiter` in routes/auth.js), the limiter relaxes outside production
 * so local dev and the test runner are not locked out after a handful of
 * attempts.
 */
export const resendVerificationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 3,
  keyGenerator: (req) => {
    const raw = req.body?.email;
    const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    return email ? `resend-verify:${email}` : `resend-verify:ip:${ipKeyGenerator(req.ip)}`;
  },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipAuthRateLimitOutsideProd,
  handler: (req, res) =>
    res
      .status(429)
      .set('Retry-After', '3600')
      .json({
        error: req.t('auth:errors.tooManyResendAttempts'),
        retryAfter: 3600,
      }),
});
