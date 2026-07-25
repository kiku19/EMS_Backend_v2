import { z } from 'zod';
import { normalizeSchoolCode } from '../utils/schoolContext.js';

const E164_RE = /^\+[1-9]\d{6,14}$/;

const normalizeSchoolCodeTrimmed = (value) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return undefined;
  return normalizeSchoolCode(trimmed);
};

const PASSWORD_MIN = 10;
const PASSWORD_MAX = 128;

// Spec: 2 of {lower, upper, digit, symbol}. We collect ALL failures at once via
// superRefine so the client can render every message instead of fixing one,
// re-submitting, and discovering the next.
const PASSWORD_CATEGORY_CHECKS = [
  { id: 'lower', re: /[a-z]/, message: 'Password must contain at least one lowercase letter' },
  { id: 'upper', re: /[A-Z]/, message: 'Password must contain at least one uppercase letter' },
  { id: 'digit', re: /[0-9]/, message: 'Password must contain at least one digit' },
  { id: 'symbol', re: /[^A-Za-z0-9]/, message: 'Password must contain at least one symbol' },
];

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX, `Password must be at most ${PASSWORD_MAX} characters`)
  .superRefine((value, ctx) => {
    const satisfied = PASSWORD_CATEGORY_CHECKS.filter((c) => c.re.test(value));
    if (satisfied.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Password must include at least 2 of: lowercase, uppercase, digit, symbol',
      });
      PASSWORD_CATEGORY_CHECKS.forEach((check) => {
        if (!check.re.test(value)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: check.message,
          });
        }
      });
    }
  });

// Intl.supportedValuesOf('timeZone') returns canonical zones only (no aliases
// like Asia/Kolkata, UTC, GMT). To accept aliases too, validate via
// Intl.DateTimeFormat which accepts every spec-compliant IANA name.
const isValidTimezone = (value) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

const phoneSchema = z
  .string()
  .trim()
  .min(8, 'Phone number is required')
  .max(20, 'Phone number is too long')
  .refine((value) => {
    const digits = value.replace(/[\s\-().]/g, '');
    return E164_RE.test(digits);
  }, 'Phone number must be in E.164 format (e.g. +14155552671)')
  .transform((value) => value.replace(/[\s\-().]/g, ''));

// Spec: optional enum (website | referral | sales | other)
const sourceSchema = z.enum(['website', 'referral', 'sales', 'other']).optional();

// ISO 4217 — accept any 3-letter uppercase code; we don't ship a currency table
// and downstream billing already validates currency at the SchoolSubscription layer.
const currencySchema = z
  .string()
  .trim()
  .length(3, 'Currency must be a 3-letter ISO 4217 code')
  .regex(/^[A-Z]{3}$/, 'Currency must be uppercase ISO 4217 (e.g. INR, USD)')
  .default('INR');

const timezoneSchema = z
  .string()
  .trim()
  .min(1, 'Timezone must not be empty')
  .max(100, 'Timezone is too long')
  .refine(isValidTimezone, 'Timezone must be a valid IANA zone (e.g. Asia/Kolkata)')
  .optional();

const schoolCodeSchema = z
  .string()
  .trim()
  .max(40, 'School code is too long')
  .transform((value) => (value ? normalizeSchoolCodeTrimmed(value) : undefined))
  .optional();

// Honeypot: real users leave this empty. Bots auto-fill every field, so a
// non-empty value here is a strong signal. We never reject the request —
// the route returns a fake success response and creates nothing.
const honeypotSchema = z.string().max(200, 'company_website is too long').optional().default('');

// Captcha is only required when CAPTCHA_SECRET is set. The route enforces that
// rule; the schema only validates shape when present.
const captchaTokenSchema = z
  .string()
  .trim()
  .min(1, 'CAPTCHA token must not be empty')
  .max(2000, 'CAPTCHA token is too long')
  .optional();

export const selfSignupSchema = z
  .object({
    schoolName: z
      .string()
      .trim()
      .min(2, 'School name must be at least 2 characters')
      .max(100, 'School name must be at most 100 characters'),
    schoolCode: schoolCodeSchema,
    adminName: z
      .string()
      .trim()
      .min(2, 'Admin name must be at least 2 characters')
      .max(100, 'Admin name must be at most 100 characters'),
    adminEmail: z
      .string()
      .trim()
      .toLowerCase()
      .email('A valid email address is required')
      .max(254, 'Email address is too long'),
    adminPhone: phoneSchema,
    password: passwordSchema,
    acceptTerms: z.literal(true, {
      errorMap: () => ({ message: 'You must accept the terms to continue' }),
    }),
    source: sourceSchema,
    timezone: timezoneSchema,
    currency: currencySchema,
    company_website: honeypotSchema,
    captchaToken: captchaTokenSchema,
  })
  .strict();

export const SELF_SIGNUP_PASSWORD_LIMITS = Object.freeze({
  min: PASSWORD_MIN,
  max: PASSWORD_MAX,
  requiredCategories: 2,
});
