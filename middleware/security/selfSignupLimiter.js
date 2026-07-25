/**
 * Self-serve signup rate limiters (PR1 of the Self-Serve Onboarding Flow).
 *
 * The signup endpoint is the only unscoped query path in the platform, so it
 * needs explicit abuse controls separate from the tenant/IP limiters used by
 * authenticated traffic.  Three independent buckets:
 *
 *   - IP hourly   : 5 signups / IP / hour  (burst protection)
 *   - IP daily    : 10 signups / IP / day   (sustained abuse)
 *   - Email hourly: 3 signups / email / hour (single-user enumeration)
 *
 * Like the rest of the auth/credential limiters (routes/auth.js), these skip
 * outside production so local dev and the test suite aren't locked out.
 *
 * 429 responses follow the project-wide shape used by middleware/security/
 * tenantRateLimit.js so the dashboard's `request()` retry-after contract
 * (services/api/core.js) works without a new code path.
 */

import { rateLimit } from 'express-rate-limit';

const skipOutsideProduction = () => process.env.NODE_ENV !== 'production';

const signupIpHourlyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => `selfsignup:ip_hour:${req.ip}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipOutsideProduction,
  handler: (req, res, _next, options) => {
    res
      .status(429)
      .set('Retry-After', String(Math.ceil(options.windowMs / 1000)))
      .json({
        error: req.t ? req.t('common:errors.tooManyRequests') : 'Too many requests',
        message: 'Too many signup attempts from this IP. Try again later.',
        retryAfter: Math.ceil(options.windowMs / 1000),
      });
  },
});

const signupIpDailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => `selfsignup:ip_day:${req.ip}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipOutsideProduction,
  handler: (req, res, _next, options) => {
    res
      .status(429)
      .set('Retry-After', String(Math.ceil(options.windowMs / 1000)))
      .json({
        error: req.t ? req.t('common:errors.tooManyRequests') : 'Too many requests',
        message: 'Daily signup limit reached for this IP. Try again tomorrow.',
        retryAfter: Math.ceil(options.windowMs / 1000),
      });
  },
});

const signupEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  // The route normalises the email to lowercase before calling this; if no
  // email is present, fall back to IP so an attacker can't bypass by stripping
  // the field — Zod will reject the request before the limiter sees it.
  keyGenerator: (req) => {
    const email = String(req.body?.adminEmail || '')
      .trim()
      .toLowerCase();
    return email ? `selfsignup:email:${email}` : `selfsignup:email_ip:${req.ip}`;
  },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipOutsideProduction,
  handler: (req, res, _next, options) => {
    res
      .status(429)
      .set('Retry-After', String(Math.ceil(options.windowMs / 1000)))
      .json({
        error: req.t ? req.t('common:errors.tooManyRequests') : 'Too many requests',
        message: 'Too many signup attempts for this email. Try again later.',
        retryAfter: Math.ceil(options.windowMs / 1000),
      });
  },
});

// Order matters: most-restrictive first so a sustained attacker trips the IP
// limiter before consuming any per-email slots for real users behind a NAT.
export const selfSignupRateLimiters = [
  signupIpHourlyLimiter,
  signupIpDailyLimiter,
  signupEmailLimiter,
];

export const selfSignupLimiter = signupIpHourlyLimiter;

// PR2 — email verification + resend.
//
// resend-verification is a public endpoint keyed by the address being asked
// about, so the email bucket is the right place to cap abuse. Same shape as
// signupEmailLimiter so the 429 contract stays consistent for the dashboard.
const resendVerificationEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  keyGenerator: (req) => {
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    return email ? `resend_verification:email:${email}` : `resend_verification:ip:${req.ip}`;
  },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipOutsideProduction,
  handler: (req, res, _next, options) => {
    res
      .status(429)
      .set('Retry-After', String(Math.ceil(options.windowMs / 1000)))
      .json({
        error: req.t ? req.t('common:errors.tooManyRequests') : 'Too many requests',
        message: 'Too many verification email requests for this address. Try again later.',
        retryAfter: Math.ceil(options.windowMs / 1000),
      });
  },
});

export const resendVerificationLimiter = resendVerificationEmailLimiter;

export const SELF_SIGNUP_LIMITS = Object.freeze({
  ipHourly: 5,
  ipDaily: 10,
  emailHourly: 3,
  resendEmailHourly: 3,
});
