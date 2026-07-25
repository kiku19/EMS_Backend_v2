/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Authentication & session management
 */

/**
 * @swagger
 * /auth/signup/invite-details:
 *   post:
 *     summary: Get invite details for a signup token
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token:
 *                 type: string
 *                 description: Signup invite JWT token
 *     responses:
 *       200:
 *         description: Invite details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 invite: { type: object }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       403:
 *         description: Invalid or expired invite token
 */

/**
 * @swagger
 * /auth/signup:
 *   post:
 *     summary: Create a new school account via invite (admin signup)
 *     description: Signup is invite-only. A valid `inviteToken` obtained from /auth/signup/invite-details is required.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SignupRequest'
 *     responses:
 *       201:
 *         description: School and admin account created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       403:
 *         description: Invalid or missing invite token
 *       409:
 *         description: Email already in use
 */

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Staff / admin login
 *     description: |
 *       Provide either `phone` or `email` (not both) plus `password`.
 *       Optionally scope to a specific school via `schoolId` or `schoolCode`.
 *       Returns a short-lived access token and a 30-day refresh token.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         description: Invalid credentials
 *       409:
 *         description: Multiple accounts matched — provide schoolId or schoolCode
 */

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     summary: Refresh access token using refresh token
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 description: The 30-day refresh token from login
 *     responses:
 *       200:
 *         description: New access token issued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token: { type: string }
 *       401:
 *         description: Refresh token invalid or expired
 */

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Logout (clears auth cookie)
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Logged out
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessMessage'
 */

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Get current authenticated user profile
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Current user profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

/**
 * @swagger
 * /auth/change-password:
 *   post:
 *     summary: Change password for the authenticated user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword: { type: string, minLength: 8 }
 *               newPassword: { type: string, minLength: 8 }
 *     responses:
 *       200:
 *         $ref: '#/components/responses/NotFound'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         description: Current password incorrect
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import {
  buildRedisStore,
  isAuthRateLimitingDisabled,
} from '../middleware/security/tenantRateLimit.js';
import { Staff } from '../database.js';
import Session from '../models/Session.js';
import { createLogger } from '../utils/logger.js';
import { getRequiredSecret } from '../config/environment.js';

const logger = createLogger('Auth');
import {
  authenticate,
  requireAdmin as authRequireAdmin,
  generateToken,
  setAuthCookie,
  setRefreshCookie,
  clearAuthCookie,
  extractTokenFromRequest,
  extractRefreshTokenFromRequest,
} from '../middleware/auth.js';
import { validateZod, zodSchemas } from '../middleware/validation.js';
import { ensureDocumentSchool, resolveSchool, serializeSchool } from '../utils/schoolContext.js';
import { normalizeInvitedSchoolName, verifySignupInvite } from '../utils/signupInvites.js';
import {
  buildSuperAdminAuthPayload,
  isSuperAdminLogin,
  isSuperAdminUser,
} from '../utils/superAdmin.js';
import {
  ensureSchoolSubscription,
  provisionSchoolSubscription,
  summarizeSubscription,
  syncUsageMetrics,
} from '../services/billingService.js';
import { onboardSchool } from '../services/schoolProvisioningService.js';
import { sendSchoolWelcomeEmail, sendPasswordResetEmail } from '../services/emailService.js';
import School from '../models/School.js';
import AuditTrail from '../models/AuditTrail.js';
import { buildStaffAuthPayload, generateStaffRefreshToken } from './authHelpers.js';
import { issueTwoFactorToken, isTrustedDevice } from './twoFactor.js';
import { createSchoolWithAdmin } from '../services/schoolProvisioningService.js';
import Parent from '../models/Parent.js';
import {
  selfSignupRateLimiters,
  resendVerificationLimiter,
} from '../middleware/security/selfSignupLimiter.js';
import { hmac, piiMatch } from '../utils/encryption.js';

// Write an auth audit entry — never throws, always fire-and-forget
function logAuthEvent(action, staff, req) {
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.connection?.remoteAddress ||
    req.ip;
  AuditTrail.create({
    schoolId: staff.schoolId,
    userId: staff._id,
    userName: staff.name || staff.email || null,
    action,
    entity: 'auth',
    entityId: staff._id.toString(),
    method: req.method,
    path: req.path,
    ipAddress: ip,
    userAgent: req.headers['user-agent'] || null,
  }).catch(() => {});
}

// Parse a minimal device description from the User-Agent string
function parseDeviceInfo(userAgent = '') {
  const ua = userAgent || '';
  let browser = 'Unknown';
  let os = 'Unknown';
  let device = 'Desktop';

  if (/Mobile|Android|iPhone|iPad/.test(ua)) device = 'Mobile';
  else if (/Tablet/.test(ua)) device = 'Tablet';

  if (/Chrome\/(\d+)/.test(ua) && !/Chromium|Edg\/|OPR\//.test(ua))
    browser = `Chrome ${ua.match(/Chrome\/(\d+)/)?.[1] || ''}`.trim();
  else if (/Firefox\/(\d+)/.test(ua))
    browser = `Firefox ${ua.match(/Firefox\/(\d+)/)?.[1] || ''}`.trim();
  else if (/Edg\/(\d+)/.test(ua)) browser = `Edge ${ua.match(/Edg\/(\d+)/)?.[1] || ''}`.trim();
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';
  else if (/OPR\/(\d+)/.test(ua)) browser = `Opera ${ua.match(/OPR\/(\d+)/)?.[1] || ''}`.trim();

  if (/Windows NT/.test(ua)) os = 'Windows';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad/.test(ua)) os = 'iOS';

  return { browser, os, device };
}

// Create a session record on login — fire-and-forget
async function createSessionRecord(staff, req, sessionId) {
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.connection?.remoteAddress ||
    req.ip;
  const userAgent = req.headers['user-agent'] || null;
  const deviceInfo = parseDeviceInfo(userAgent);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days (refresh token lifetime)

  await Session.create({
    sessionId,
    userId: staff._id,
    schoolId: staff.schoolId,
    userType: 'staff',
    ipAddress: ip || null,
    userAgent,
    deviceInfo,
    lastActivityAt: new Date(),
    expiresAt,
    isRevoked: false,
  });
}

async function createSuperAdminSessionRecord(req, sessionId) {
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.connection?.remoteAddress ||
    req.ip;
  const userAgent = req.headers['user-agent'] || null;
  const deviceInfo = parseDeviceInfo(userAgent);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await Session.create({
    sessionId,
    userType: 'super-admin',
    ipAddress: ip || null,
    userAgent,
    deviceInfo,
    lastActivityAt: new Date(),
    expiresAt,
    isRevoked: false,
  });
}

const router = express.Router();
const TOKEN_EXPIRES_IN_MS = 8 * 60 * 60 * 1000; // Must match JWT_EXPIRES_IN in auth.js

const getJwtRefreshSecret = () => getRequiredSecret('JWT_REFRESH_SECRET');

// Optional CAPTCHA verification (Turnstile or hCaptcha). Only enforced when
// CAPTCHA_SECRET is set; dev/test always skip. Both providers use the same
// `siteverify` endpoint shape, so a single helper covers both.
async function verifyCaptchaToken(token, remoteIp) {
  const secret = process.env.CAPTCHA_SECRET?.trim();
  if (!secret) return { required: false, ok: true };
  if (!token || typeof token !== 'string') {
    return { required: true, ok: false, reason: 'missing' };
  }

  const params = new URLSearchParams();
  params.set('secret', secret);
  params.set('response', token);
  if (remoteIp) params.set('remoteip', remoteIp);

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, 'CAPTCHA siteverify non-OK status');
      return { required: true, ok: false, reason: 'verification_failed' };
    }

    const payload = await response.json().catch(() => ({}));
    const success = payload?.success === true;
    return { required: true, ok: success, reason: success ? null : 'invalid_token' };
  } catch (err) {
    logger.warn({ err: err?.message || err }, 'CAPTCHA verification threw — failing closed');
    return { required: true, ok: false, reason: 'verification_failed' };
  }
}

// The auth/credential rate limiters below relax outside production (covers
// local dev and the test runner) so iterating locally isn't locked out after a
// handful of attempts. DISABLE_AUTH_RATE_LIMITING=true is a temporary QA
// escape hatch for environments that must run with NODE_ENV=production.
// Mirrors the codebase convention of gating non-prod behaviour on
// `NODE_ENV !== 'production'` (see parentAuth.js, billingService.js).
const skipAuthRateLimitOutsideProd = () =>
  isAuthRateLimitingDisabled() || process.env.NODE_ENV !== 'production';

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  handler: (req, res) =>
    res.status(429).json({ error: req.t('auth:errors.tooManySignupAttempts') }),
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipAuthRateLimitOutsideProd,
});

const staffRefreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  handler: (req, res) =>
    res.status(429).json({ error: req.t('auth:errors.tooManyRefreshAttempts') }),
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipAuthRateLimitOutsideProd,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // [BUG-002/032] Aligned with the router-level auth limiter (createAuthRateLimiter):
  // account + IP keying (a NAT'd school shares one egress IP but many accounts),
  // a Redis store so the count is consistent across PM2 workers, and a Retry-After
  // header + body field so the frontend can show "try again in X min" instead of a
  // silent 429. Previously this was max:5, IP-only, in-memory, with no Retry-After.
  max: 20,
  keyGenerator: (req) => {
    const account = req.body?.email || req.body?.phone || 'nocred';
    return `auth:route:${account}:${ipKeyGenerator(req.ip)}`;
  },
  handler: (req, res, _next, options) => {
    const retryAfter = Math.ceil(options.windowMs / 1000);
    res
      .status(429)
      .set('Retry-After', String(retryAfter))
      .json({
        error: req.t('auth:errors.tooManyLoginAttempts'),
        retryAfter,
      });
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: buildRedisStore(),
  skipSuccessfulRequests: true,
  skip: skipAuthRateLimitOutsideProd,
});

async function authenticateStaff(req, { phone, email, password, schoolId, schoolCode }) {
  if (!password) {
    return { error: req.t('auth:errors.passwordRequired'), status: 400 };
  }

  let query = { status: 'active' };
  if (phone) {
    query = { ...query, ...piiMatch('phone', phone.trim()) };
  } else if (email) {
    query = { ...query, ...piiMatch('email', email.toLowerCase().trim()) };
  } else {
    return { error: req.t('auth:errors.phoneOrEmailRequired'), status: 400 };
  }

  const resolvedSchool =
    schoolId || schoolCode ? await resolveSchool({ schoolId, schoolCode }) : null;

  if ((schoolId || schoolCode) && !resolvedSchool) {
    return { error: req.t('auth:errors.schoolNotFound'), status: 404 };
  }

  if (resolvedSchool) {
    query.schoolId = resolvedSchool._id;
  }

  const matchingStaff = await Staff.find(query).limit(2);
  logger.debug({ matchCount: matchingStaff.length }, 'Login staff lookup');
  if (matchingStaff.length === 0) {
    return { error: req.t('auth:errors.invalidCredentials'), status: 401 };
  }

  if (matchingStaff.length > 1) {
    return {
      error: req.t('auth:errors.multipleAccounts'),
      status: 409,
    };
  }

  const [staff] = matchingStaff;
  await ensureDocumentSchool(staff);

  const hasPassword = !!staff.password;
  const isPasswordValid = await staff.comparePassword(password);
  logger.debug({ staffId: staff._id.toString() }, 'Password check completed');
  if (!isPasswordValid) {
    return { error: req.t('auth:errors.invalidCredentials'), status: 401, foundStaff: staff };
  }

  return { staff };
}

function normalizeSignupEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

// POST preferred — token in body avoids exposure in URL/browser history/Referer
router.post('/signup/invite-details', authLimiter, async (req, res) => {
  const inviteToken = String(req.body.token || '').trim();

  if (!inviteToken) {
    return res.status(400).json({ error: req.t('auth:errors.inviteTokenRequired') });
  }

  const invite = verifySignupInvite(inviteToken);

  if (!invite) {
    return res.status(403).json({ error: req.t('auth:errors.inviteExpired') });
  }

  return res.json({
    success: true,
    invite,
  });
});

// GET kept for backward-compat email links; Referrer-Policy mitigates leakage
router.get('/signup/invite-details', authLimiter, async (req, res) => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  const inviteToken = String(req.query.token || '').trim();

  if (!inviteToken) {
    return res.status(400).json({ error: req.t('auth:errors.inviteTokenRequired') });
  }

  const invite = verifySignupInvite(inviteToken);

  if (!invite) {
    return res.status(403).json({ error: req.t('auth:errors.inviteExpired') });
  }

  return res.json({
    success: true,
    invite,
  });
});

router.post('/signup', signupLimiter, validateZod(zodSchemas.signup), async (req, res) => {
  try {
    const { name, email, schoolName, password, phone, inviteToken } = req.body;

    const normalizedEmail = normalizeSignupEmail(email);
    const normalizedSchoolName = normalizeInvitedSchoolName(schoolName);

    // Signup is invite-only: a valid invite token is required.
    const invite = verifySignupInvite(inviteToken);
    if (!invite) {
      return res.status(403).json({
        error: req.t('auth:errors.inviteOnly'),
      });
    }

    if (invite.email !== normalizedEmail || invite.schoolName !== normalizedSchoolName) {
      return res.status(400).json({
        error: req.t('auth:errors.inviteMismatch'),
      });
    }

    const signupSource = 'invite-only';
    const provisionedBy = invite.invitedBy || normalizedEmail;

    const existingStaff = await Staff.findOne({
      ...piiMatch('email', normalizedEmail),
      isDeleted: { $ne: true },
    });
    if (existingStaff) {
      return res.status(409).json({
        error: req.t('auth:errors.emailAlreadyExists'),
      });
    }

    // Check for duplicate school name (case-insensitive)
    const existingSchoolByName = await School.findOne({
      name: {
        $regex: new RegExp(`^${normalizedSchoolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
      },
    });
    if (existingSchoolByName) {
      return res.status(409).json({
        error: req.t('auth:errors.schoolNameExists'),
      });
    }

    const result = await onboardSchool({
      schoolName: normalizedSchoolName,
      contactEmail: normalizedEmail,
      contactPhone: phone || null,
      adminName: name,
      adminEmail: normalizedEmail,
      adminPassword: password,
      plan: 'starter',
      planStatus: 'trialing',
      schoolSettings: {
        email: normalizedEmail,
      },
      provisionedBy,
      source: signupSource,
    });

    const school = result.school;
    school.billingContactName = name.trim();
    school.billingEmail = normalizedEmail;
    school.billingPhone = phone || null;
    school.metadata = {
      ...(school.metadata || {}),
      signupSource,
      ownerName: name.trim(),
      invitedBy: invite.invitedBy,
      inviteAcceptedAt: new Date().toISOString(),
    };
    await school.save();

    await provisionSchoolSubscription({
      schoolId: school._id,
      billingContactName: name.trim(),
      billingEmail: normalizedEmail,
    });

    const staff = result.admin;

    const subscription = await syncUsageMetrics(school._id);

    // Fire-and-forget: send welcome email with email verification link
    const jwtSecret = getRequiredSecret('JWT_SECRET');
    const verificationToken = jwt.sign(
      {
        purpose: 'email-verification',
        schoolId: school._id.toString(),
        email: normalizedEmail,
      },
      jwtSecret,
      { expiresIn: '48h' }
    );

    sendSchoolWelcomeEmail(
      { name: name.trim(), email: normalizedEmail },
      { name: school.name, code: school.code, trialEndsAt: school.trialEndsAt },
      verificationToken
    ).catch((err) => logger.warn({ err }, 'Failed to send welcome email'));

    // Generate JWT and session for immediate login
    const payload = await buildStaffAuthPayload(staff);
    const sessionId = randomUUID();
    const token = generateToken(staff._id.toString(), staff.role, {
      schoolId: payload.schoolId,
      userType: 'staff',
      sessionId,
    });
    const refreshToken = generateStaffRefreshToken(
      staff._id.toString(),
      payload.schoolId,
      staff.tokenVersion || 1,
      sessionId
    );

    await createSessionRecord(staff, req, sessionId);
    logAuthEvent('signup', staff, req);

    setAuthCookie(res, token);
    setRefreshCookie(res, refreshToken);

    res.status(201).json({
      success: true,
      message: req.t('auth:success.inviteAccepted'),
      school: serializeSchool(school),
      user: {
        id: staff._id.toString(),
        name: staff.name,
        email: staff.email,
        role: staff.role,
        schoolId: school._id.toString(),
        subscription: summarizeSubscription(subscription),
      },
      token,
      refreshToken,
      tokenExpiresAt: Date.now() + TOKEN_EXPIRES_IN_MS,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: req.t('auth:errors.accountCreateConflict') });
    }

    logger.error({ err: error }, 'Signup error');
    res.status(500).json({ error: req.t('auth:errors.signupFailed') });
  }
});

function isSelfSignupEnabled() {
  return process.env.ENABLE_SELF_SIGNUP === 'true';
}

async function checkSelfSignupUniqueness({ email, phone, code }) {
  const conflicts = [];

  if (email) {
    const existingStaff = await Staff.findOne({
      ...piiMatch('email', email),
      isDeleted: { $ne: true },
    }).lean();
    if (existingStaff) conflicts.push({ field: 'adminEmail', reason: 'email_taken' });
  }

  if (phone) {
    const existingStaffByPhone = await Staff.findOne({
      ...piiMatch('phone', phone),
      isDeleted: { $ne: true },
    }).lean();
    if (existingStaffByPhone) conflicts.push({ field: 'adminPhone', reason: 'phone_taken' });

    const phoneHash = hmac(phone);
    const existingParent = await Parent.findOne({
      $or: [{ phoneHash }, { phone }],
      status: { $ne: 'deleted' },
    }).lean();
    if (existingParent) conflicts.push({ field: 'adminPhone', reason: 'phone_taken_parent' });
  }

  if (code) {
    const existingSchool = await School.findOne({ code }).lean();
    if (existingSchool) conflicts.push({ field: 'schoolCode', reason: 'code_taken' });
  }

  return conflicts;
}

function logSelfSignupConflict(req, conflicts, payload) {
  logger.warn(
    {
      conflicts: conflicts.map((c) => c.field),
      ip: req.ip,
      ua: req.headers['user-agent'],
      schoolNameHash: payload?.schoolName ? hmac(payload.schoolName) : null,
    },
    'Self-serve signup duplicate preflight failed'
  );
}

// Self-serve signup: public, no invite token, no auth middleware. Mounted
// behind the ENABLE_SELF_SIGNUP feature flag (404 when off). This endpoint
// is the ONLY unscoped query path in the platform — every lookup below
// either (a) needs to run before the school exists (uniqueness checks,
// rate limiters keyed by IP/email) or (b) writes a new school+admin pair
// (the provisioning service). Audit line-by-line before extending.
async function handleSelfSignup(req, res) {
  try {
    if (!isSelfSignupEnabled()) {
      return res.status(404).json({ error: 'Not found' });
    }

    const body = req.body || {};

    // Honeypot: bots auto-fill every field. A non-empty `company_website` is a
    // strong signal. Return a fake 201 so the bot can't distinguish; do not
    // create anything and do not advance the rate-limit counter visibly
    // (the limiters still ran, but no side effect occurred).
    if (body.company_website && String(body.company_website).trim() !== '') {
      logger.warn({ ip: req.ip }, 'Self-serve honeypot triggered');
      return res.status(201).json({
        success: true,
        message: 'Account created. Please check your email to verify.',
        user: null,
        school: null,
        verificationRequired: true,
      });
    }

    const captchaResult = await verifyCaptchaToken(
      body.captchaToken,
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip
    );
    if (captchaResult.required && !captchaResult.ok) {
      return res.status(400).json({
        error: 'CAPTCHA verification failed',
        reason: captchaResult.reason,
      });
    }

    const { adminEmail, adminPhone, schoolCode } = body;
    const conflicts = await checkSelfSignupUniqueness({
      email: adminEmail,
      phone: adminPhone,
      code: schoolCode,
    });

    if (conflicts.length > 0) {
      logSelfSignupConflict(req, conflicts, body);
      // Email-enumeration resistance: generic message; structured per-field
      // detail so the dashboard can surface field-level errors. PR3 reads
      // `errors[].field` and `errors[].reason`.
      return res.status(409).json({
        error: 'Unable to create account with these details',
        errors: conflicts,
      });
    }

    let result;
    try {
      result = await createSchoolWithAdmin({
        school: {
          name: body.schoolName,
          code: body.schoolCode,
          contactEmail: body.adminEmail,
          contactPhone: body.adminPhone,
          source: body.source || 'self-signup',
          timezone: body.timezone,
          currency: body.currency,
        },
        admin: {
          name: body.adminName,
          email: body.adminEmail,
          phone: body.adminPhone,
          password: body.password,
        },
      });
    } catch (err) {
      // Race: two concurrent signups with the same email/code slip past the
      // preflight check; surface the same generic 409 shape.
      if (err?.code === 11000) {
        logSelfSignupConflict(req, [{ field: 'adminEmail', reason: 'race_conflict' }], body);
        return res.status(409).json({
          error: 'Unable to create account with these details',
          errors: [{ field: 'adminEmail', reason: 'race_conflict' }],
        });
      }
      throw err;
    }

    const { school, admin } = result;

    // Issue access + refresh JWTs and set httpOnly cookies exactly like login.
    const authPayload = await buildStaffAuthPayload(admin);
    const sessionId = randomUUID();
    const token = generateToken(admin._id.toString(), admin.role, {
      schoolId: authPayload.schoolId,
      userType: 'staff',
      sessionId,
    });
    const refreshToken = generateStaffRefreshToken(
      admin._id.toString(),
      authPayload.schoolId,
      admin.tokenVersion || 1,
      sessionId
    );
    await createSessionRecord(admin, req, sessionId);
    logAuthEvent('signup', admin, req);

    setAuthCookie(res, token);
    setRefreshCookie(res, refreshToken);

    // 24h email-verification token. Fire-and-forget the welcome email — do
    // not block the response on SMTP; failures are logged but never fail
    // the request.
    try {
      const jwtSecret = getRequiredSecret('JWT_SECRET');
      const verificationToken = jwt.sign(
        {
          purpose: 'email-verification',
          schoolId: school._id.toString(),
          email: adminEmail,
        },
        jwtSecret,
        { expiresIn: '24h' }
      );

      sendSchoolWelcomeEmail(
        { name: admin.name, email: adminEmail },
        { name: school.name, code: school.code, trialEndsAt: school.trialEndsAt },
        verificationToken
      ).catch((err) =>
        logger.warn({ err: err?.message || err }, 'Failed to send self-signup welcome email')
      );
    } catch (emailErr) {
      logger.warn(
        { err: emailErr?.message || emailErr },
        'Failed to issue verification token for self-signup'
      );
    }

    return res.status(201).json({
      success: true,
      message: req.t('auth:success.schoolCreated'),
      school: serializeSchool(school),
      user: {
        id: admin._id.toString(),
        name: admin.name,
        email: admin.email,
        role: admin.role,
        schoolId: school._id.toString(),
        emailVerified: false,
      },
      token,
      refreshToken,
      tokenExpiresAt: Date.now() + TOKEN_EXPIRES_IN_MS,
      verificationRequired: true,
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({
        error: 'Unable to create account with these details',
        errors: [{ field: 'adminEmail', reason: 'race_conflict' }],
      });
    }
    logger.error({ err: err?.message || err }, 'Self-serve signup failed');
    return res.status(500).json({ error: req.t('auth:errors.signupFailed') });
  }
}

// Self-serve signup endpoint. Mounted behind ENABLE_SELF_SIGNUP (404 when off).
// Rate limiters run before validation so abusive callers can't probe the
// validation schema for free.
router.post('/self-signup', ...selfSignupRateLimiters, async (req, res, next) => {
  if (!isSelfSignupEnabled()) {
    return res.status(404).json({ error: 'Not found' });
  }
  validateZod(zodSchemas.selfSignup)(req, res, (err) => {
    if (err) return next(err);
    return handleSelfSignup(req, res);
  });
});

// Shared handler for email verification (used by both GET and POST).
//
// PR2 (SCH-218): gated by ENABLE_SELF_SIGNUP — verification only exists for the
// self-serve flow. Sets Staff.emailVerified = true (the spec'd truth) and
// mirrors the flag onto school.metadata.emailVerified so the dashboard banner
// can read from either source. Writes an audit entry on success and returns
// the updated Staff user so the dashboard can refresh AuthContext without an
// extra round-trip.
async function handleVerifyEmail(token, req, res) {
  if (!isSelfSignupEnabled()) {
    return res.status(404).json({ error: 'Not found' });
  }

  if (!token) {
    return res.status(400).json({ error: req.t('auth:errors.verificationTokenRequired') });
  }

  const jwtSecret = getRequiredSecret('JWT_SECRET');

  let payload;
  try {
    payload = jwt.verify(token, jwtSecret);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(410).json({ error: req.t('auth:errors.verificationExpired') });
    }
    return res.status(400).json({ error: req.t('auth:errors.verificationTokenInvalid') });
  }

  if (payload.purpose !== 'email-verification' || !payload.schoolId) {
    return res.status(400).json({ error: req.t('auth:errors.verificationTokenInvalid') });
  }

  try {
    const school = await School.findById(payload.schoolId);
    if (!school) {
      return res.status(404).json({ error: req.t('auth:errors.schoolNotFound') });
    }

    // Token carries the verified address (PR1 self-signup signs it as
    // `email: adminEmail`). Use it to find the matching Staff across both
    // legacy invite-based and self-serve signups; piiMatch keeps the lookup
    // stable against the encrypted email field.
    const verifiedEmail = payload.email;
    const staffQuery = verifiedEmail
      ? { schoolId: school._id, ...piiMatch('email', verifiedEmail) }
      : { schoolId: school._id, role: 'Administrator', isDeleted: { $ne: true } };
    const staff = await Staff.findOne(staffQuery);

    if (!staff) {
      // The token is structurally valid (signed + unexpired + right purpose)
      // but the staff row has been deleted. We must not leak whether it ever
      // existed — collapse to the same generic response shape used for
      // already-verified so enumeration is impossible.
      logger.warn(
        { schoolId: school._id.toString(), hasEmail: !!verifiedEmail },
        'Verify-email token references a missing staff account'
      );
      return res.json({
        success: true,
        message: req.t('auth:success.emailAlreadyVerified'),
        alreadyVerified: true,
      });
    }

    if (staff.emailVerified) {
      return res.json({
        success: true,
        message: req.t('auth:success.emailAlreadyVerified'),
        alreadyVerified: true,
        user: { id: staff._id.toString(), emailVerified: true },
      });
    }

    const verifiedAt = new Date();
    staff.emailVerified = true;
    staff.emailVerifiedAt = verifiedAt;
    await staff.save();

    // Mirror the flag onto the school metadata so dashboard code reading
    // school.metadata.emailVerified (banner, onboarding check, etc.) keeps
    // working without having to denormalise the Staff collection.
    school.metadata = {
      ...(school.metadata || {}),
      emailVerified: true,
      emailVerifiedAt: verifiedAt.toISOString(),
    };
    school.markModified('metadata');
    await school.save();

    AuditTrail.create({
      schoolId: school._id,
      userId: staff._id,
      userName: staff.name || staff.email || null,
      action: 'email.verified',
      entity: 'auth',
      entityId: staff._id.toString(),
      method: req.method,
      path: req.path,
      ipAddress:
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.connection?.remoteAddress ||
        req.ip,
      userAgent: req.headers['user-agent'] || null,
    }).catch(() => {});

    return res.json({
      success: true,
      message: req.t('auth:success.emailVerified'),
      user: {
        id: staff._id.toString(),
        name: staff.name,
        email: staff.email,
        emailVerified: true,
        emailVerifiedAt: verifiedAt.toISOString(),
        schoolId: school._id.toString(),
      },
    });
  } catch (err) {
    logger.error({ err }, 'Email verification error');
    return res.status(500).json({ error: req.t('auth:errors.verificationFailed') });
  }
}

// POST preferred — token in body avoids exposure in URL/browser history/Referer
router.post('/verify-email', validateZod(zodSchemas.verifyEmail), async (req, res) => {
  const token = String(req.body.token || '').trim();
  return handleVerifyEmail(token, req, res);
});

// GET kept for backward-compat email links; Referrer-Policy mitigates leakage
router.get('/verify-email', async (req, res) => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  const token = String(req.query.token || '').trim();
  return handleVerifyEmail(token, req, res);
});

// Public, idempotent resend. Body carries the address; we look up the staff
// and re-issue a fresh 24h token. If the address is already verified, return
// 200 with alreadyVerified=true and skip the send — leaking verification
// state via differential responses is what we explicitly want to avoid.
// Rate-limited by the email-keyed limiter in middleware/security/selfSignupLimiter.
router.post(
  '/resend-verification',
  resendVerificationLimiter,
  validateZod(zodSchemas.resendVerification),
  async (req, res) => {
    if (!isSelfSignupEnabled()) {
      return res.status(404).json({ error: 'Not found' });
    }

    const email = String(req.body.email || '')
      .trim()
      .toLowerCase();

    try {
      const staff = await Staff.findOne({
        ...piiMatch('email', email),
        isDeleted: { $ne: true },
      });

      // Generic 200 either way: never disclose whether the account exists.
      if (!staff) {
        logger.info({ emailHash: hmac(email) }, 'Resend verification: no matching staff');
        return res.json({
          success: true,
          message: 'If an account exists for that email, a verification link has been sent.',
        });
      }

      if (staff.emailVerified) {
        return res.json({
          success: true,
          message: 'If an account exists for that email, a verification link has been sent.',
          alreadyVerified: true,
        });
      }

      const school = await School.findById(staff.schoolId);
      if (!school) {
        logger.warn(
          { staffId: staff._id.toString() },
          'Resend verification: staff has no school — bailing'
        );
        return res.json({
          success: true,
          message: 'If an account exists for that email, a verification link has been sent.',
        });
      }

      const jwtSecret = getRequiredSecret('JWT_SECRET');
      const verificationToken = jwt.sign(
        {
          purpose: 'email-verification',
          schoolId: school._id.toString(),
          email,
        },
        jwtSecret,
        { expiresIn: '24h' }
      );

      const adminName =
        staff.name || school.metadata?.ownerName || school.billingContactName || 'Admin';

      sendSchoolWelcomeEmail(
        { name: adminName, email },
        { name: school.name, code: school.code, trialEndsAt: school.trialEndsAt },
        verificationToken
      ).catch((err) =>
        logger.warn({ err: err?.message || err }, 'Failed to resend verification email')
      );

      return res.json({
        success: true,
        message: 'If an account exists for that email, a verification link has been sent.',
      });
    } catch (err) {
      logger.error({ err: err?.message || err }, 'Resend verification error');
      return res.status(500).json({
        error: 'Failed to resend verification email. Please try again.',
      });
    }
  }
);

router.post('/login', authLimiter, validateZod(zodSchemas.login), async (req, res) => {
  try {
    if (req.body.email && (await isSuperAdminLogin(req.body))) {
      const payload = buildSuperAdminAuthPayload();
      const sessionId = randomUUID();
      const token = generateToken(payload.id, payload.role, {
        userType: payload.userType,
        email: payload.email,
        name: payload.name,
        sessionId,
      });
      const refreshToken = jwt.sign(
        { userId: payload.id, userType: 'super-admin', sessionId },
        getJwtRefreshSecret(),
        { expiresIn: '30d' }
      );

      await createSuperAdminSessionRecord(req, sessionId);

      setAuthCookie(res, token);
      setRefreshCookie(res, refreshToken);

      return res.json({
        ...payload,
        token,
        refreshToken,
        tokenExpiresAt: Date.now() + TOKEN_EXPIRES_IN_MS,
      });
    }

    const { staff, error, status, foundStaff } = await authenticateStaff(req, req.body);

    if (!staff) {
      // Log failed login if we identified the user (wrong password scenario)
      if (foundStaff?.schoolId) logAuthEvent('login_failed', foundStaff, req);
      return res.status(status).json({ error });
    }

    // SSO-only mode: block password login if school requires SSO
    const staffSchool = await School.findById(staff.schoolId).select('ssoConfig code').lean();
    if (staffSchool?.ssoConfig?.ssoOnly) {
      logAuthEvent('login_blocked_sso_only', staff, req);
      // Surface the school code + an enabled provider so the frontend can build
      // the correct SSO initiate URL (GET /auth/sso/:provider/initiate?schoolCode=).
      const cfg = staffSchool.ssoConfig;
      const ssoProvider = ['google', 'microsoft', 'saml'].find(
        (p) => cfg[p]?.enabled && (p === 'saml' ? cfg[p].entryPoint : cfg[p].clientId)
      );
      return res.status(403).json({
        error: 'Password login is disabled for this school. Please use Single Sign-On (SSO).',
        ssoOnly: true,
        schoolCode: staffSchool.code || undefined,
        ssoProvider: ssoProvider || undefined,
      });
    }

    // 2FA check: if enabled, issue a short-lived challenge token unless device is trusted
    if (staff.twoFactorEnabled) {
      const trusted = await isTrustedDevice(req, staff);
      if (!trusted) {
        const twoFactorToken = issueTwoFactorToken(
          staff._id.toString(),
          staff.schoolId?.toString()
        );
        logAuthEvent('login_2fa_required', staff, req);
        return res.status(200).json({
          twoFactorRequired: true,
          twoFactorToken,
        });
      }
    }

    const payload = await buildStaffAuthPayload(staff);
    const sessionId = randomUUID();
    const token = generateToken(staff._id.toString(), staff.role, {
      schoolId: payload.schoolId,
      userType: 'staff',
      sessionId,
    });
    const refreshToken = generateStaffRefreshToken(
      staff._id.toString(),
      payload.schoolId,
      staff.tokenVersion || 1,
      sessionId
    );

    await createSessionRecord(staff, req, sessionId);
    logAuthEvent('login', staff, req);

    setAuthCookie(res, token);
    setRefreshCookie(res, refreshToken);

    res.json({
      ...payload,
      token,
      refreshToken,
      tokenExpiresAt: Date.now() + TOKEN_EXPIRES_IN_MS,
    });
  } catch (error) {
    logger.error({ err: error }, 'Login error');
    res.status(500).json({ error: req.t('auth:errors.loginFailed') });
  }
});

router.get('/session', authenticate, async (req, res) => {
  try {
    if (isSuperAdminUser(req.user)) {
      const payload = buildSuperAdminAuthPayload();
      let sessionId = req.user.sessionId;
      if (!sessionId) {
        sessionId = randomUUID();
        await createSuperAdminSessionRecord(req, sessionId);
      }
      const token = generateToken(payload.id, payload.role, {
        userType: payload.userType,
        email: payload.email,
        name: payload.name,
        sessionId,
      });
      const refreshToken = jwt.sign(
        { userId: payload.id, userType: 'super-admin', sessionId },
        getJwtRefreshSecret(),
        { expiresIn: '30d' }
      );
      setAuthCookie(res, token);
      setRefreshCookie(res, refreshToken);

      return res.json({
        ...payload,
        token,
        refreshToken,
        tokenExpiresAt: Date.now() + TOKEN_EXPIRES_IN_MS,
      });
    }

    const staff = await Staff.findOne({ _id: req.user.id, status: 'active' });

    if (!staff) {
      clearAuthCookie(res);
      return res.status(401).json({ error: 'Session is no longer valid' });
    }

    const payload = await buildStaffAuthPayload(staff);
    let sessionId = req.user.sessionId;
    if (!sessionId) {
      sessionId = randomUUID();
      await createSessionRecord(staff, req, sessionId);
    }
    const token = generateToken(staff._id.toString(), staff.role, {
      schoolId: payload.schoolId,
      userType: 'staff',
      sessionId,
    });
    const refreshToken = generateStaffRefreshToken(
      staff._id.toString(),
      payload.schoolId,
      staff.tokenVersion || 1,
      sessionId
    );
    setAuthCookie(res, token);
    setRefreshCookie(res, refreshToken);

    res.json({
      ...payload,
      token,
      refreshToken,
      tokenExpiresAt: Date.now() + TOKEN_EXPIRES_IN_MS,
    });
  } catch (error) {
    logger.error({ err: error }, 'Session lookup error');
    res.status(500).json({ error: 'Failed to restore session' });
  }
});

router.post('/logout', async (req, res) => {
  // Invalidate outstanding refresh tokens by incrementing tokenVersion
  try {
    // Extract token from Authorization header OR httpOnly cookie
    const token = extractTokenFromRequest(req);
    if (token) {
      // Use decode (not verify) so expired access tokens still trigger invalidation
      const decoded = jwt.decode(token);
      if (decoded && decoded.userId) {
        await Staff.findByIdAndUpdate(decoded.userId, { $inc: { tokenVersion: 1 } });
        // Also revoke this session so GET /auth/sessions stops showing it
        // as active and authenticate() middleware rejects the access token
        // immediately rather than waiting for it to expire naturally.
        if (decoded.sessionId) {
          await Session.findOneAndUpdate(
            { sessionId: decoded.sessionId },
            { $set: { isRevoked: true, revokedAt: new Date() } }
          ).catch(() => {});
        }
        // Log logout event if we have schoolId from the token claims
        if (decoded.schoolId) {
          logAuthEvent(
            'logout',
            {
              _id: decoded.userId,
              schoolId: decoded.schoolId,
              name: decoded.name,
              email: decoded.email,
            },
            req
          );
        }
      }
    }
  } catch {
    // Ignore — still clear cookie and return success
  }
  clearAuthCookie(res);
  res.json({ success: true, message: req.t('auth:success.logout') });
});

// POST /api/auth/refresh
// Refresh staff access token using a valid refresh token
router.post('/refresh', staffRefreshLimiter, async (req, res) => {
  try {
    // Read refresh token from httpOnly cookie first, then request body (mobile fallback)
    const refreshToken = extractRefreshTokenFromRequest(req) || req.body?.refreshToken;

    if (!refreshToken) {
      return res.status(400).json({ error: req.t('auth:errors.refreshTokenRequired') });
    }

    const decoded = jwt.verify(refreshToken, getJwtRefreshSecret());

    // Handle super-admin refresh tokens
    if (decoded.userType === 'super-admin') {
      let sessionId = decoded.sessionId;

      if (sessionId) {
        // Verify session is still active (revocable on /auth/sessions/:id DELETE)
        const existing = await Session.findOne(
          { sessionId, userType: 'super-admin' },
          { isRevoked: 1, expiresAt: 1 }
        ).lean();
        if (!existing || existing.isRevoked || existing.expiresAt < new Date()) {
          return res.status(401).json({ error: req.t('auth:errors.refreshTokenRevoked') });
        }
      } else {
        // Legacy refresh token (pre-sessionId) — mint a fresh session so future
        // refreshes are revocable
        sessionId = randomUUID();
        await createSuperAdminSessionRecord(req, sessionId);
      }

      const payload = buildSuperAdminAuthPayload();
      const newToken = generateToken(payload.id, payload.role, {
        userType: payload.userType,
        email: payload.email,
        name: payload.name,
        sessionId,
      });
      const newRefreshToken = jwt.sign(
        { userId: payload.id, userType: 'super-admin', sessionId },
        getJwtRefreshSecret(),
        { expiresIn: '30d' }
      );

      setAuthCookie(res, newToken);
      setRefreshCookie(res, newRefreshToken);

      return res.json({
        success: true,
        token: newToken,
        refreshToken: newRefreshToken,
        tokenExpiresAt: Date.now() + TOKEN_EXPIRES_IN_MS,
      });
    }

    if (decoded.userType !== 'staff') {
      return res.status(401).json({ error: req.t('auth:errors.invalidRefreshToken') });
    }

    const staff = await Staff.findOne({ _id: decoded.userId, status: 'active' });

    if (!staff) {
      return res.status(401).json({ error: 'Staff account not found or inactive' });
    }

    // Validate tokenVersion — if mismatch, the token was revoked (e.g. user logged out)
    if (decoded.tokenVersion !== undefined && decoded.tokenVersion !== (staff.tokenVersion || 1)) {
      return res.status(401).json({ error: req.t('auth:errors.refreshTokenRevoked') });
    }

    const payload = await buildStaffAuthPayload(staff);

    // Preserve the sessionId across rotations so Session.isRevoked remains enforceable.
    // If the refresh token carries a sessionId, the session must still be active —
    // otherwise revoking a session would be ineffective the moment the client refreshes.
    // Legacy refresh tokens (pre-sessionId) get a fresh session record minted here.
    let sessionId = decoded.sessionId;
    if (sessionId) {
      const existing = await Session.findOne({ sessionId }, { isRevoked: 1, expiresAt: 1 }).lean();
      if (!existing || existing.isRevoked || existing.expiresAt < new Date()) {
        return res.status(401).json({ error: req.t('auth:errors.refreshTokenRevoked') });
      }
    } else {
      sessionId = randomUUID();
      await createSessionRecord(staff, req, sessionId);
    }

    const newToken = generateToken(staff._id.toString(), staff.role, {
      schoolId: payload.schoolId,
      userType: 'staff',
      sessionId,
    });

    // Rotate refresh token: increment tokenVersion so old token is invalidated
    const newTokenVersion = (staff.tokenVersion || 1) + 1;
    await Staff.findByIdAndUpdate(staff._id, { tokenVersion: newTokenVersion });
    const newRefreshToken = generateStaffRefreshToken(
      staff._id.toString(),
      payload.schoolId,
      newTokenVersion,
      sessionId
    );

    setAuthCookie(res, newToken);
    setRefreshCookie(res, newRefreshToken);

    return res.json({
      success: true,
      token: newToken,
      refreshToken: newRefreshToken,
      tokenExpiresAt: Date.now() + TOKEN_EXPIRES_IN_MS,
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: req.t('auth:errors.refreshTokenExpired') });
    }
    return res.status(401).json({ error: req.t('auth:errors.invalidRefreshToken') });
  }
});

// Emergency reset endpoint removed — use the standard password change flow or a DB admin script.

// GET /auth/sessions — list active sessions for the authenticated user
router.get('/sessions', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const schoolId = req.user.schoolId;

    const sessions = await Session.find({
      userId,
      schoolId,
      isRevoked: false,
      expiresAt: { $gt: new Date() },
    })
      .select('sessionId ipAddress deviceInfo createdAt lastActivityAt userAgent')
      .sort({ lastActivityAt: -1 })
      .lean();

    // Mark which session is the current one (if token has sessionId claim)
    const currentSessionId = req.user.sessionId || null;

    return res.json({
      success: true,
      sessions: sessions.map((s) => ({
        ...s,
        isCurrent: s.sessionId === currentSessionId,
      })),
    });
  } catch (error) {
    logger.error({ err: error }, 'List sessions error');
    return res.status(500).json({ error: 'Failed to retrieve sessions' });
  }
});

// DELETE /auth/sessions/:sessionId — revoke a specific session
router.delete('/sessions/:sessionId', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const schoolId = req.user.schoolId;
    const { sessionId } = req.params;

    const session = await Session.findOne({ sessionId, userId, schoolId });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    session.isRevoked = true;
    session.revokedAt = new Date();
    await session.save();

    return res.json({ success: true, message: 'Session revoked' });
  } catch (error) {
    logger.error({ err: error }, 'Revoke session error');
    return res.status(500).json({ error: 'Failed to revoke session' });
  }
});

// DELETE /auth/sessions — revoke all other active sessions (keep current)
router.delete('/sessions', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const schoolId = req.user.schoolId;
    const currentSessionId = req.user.sessionId || null;

    const filter = {
      userId,
      schoolId,
      isRevoked: false,
      ...(currentSessionId ? { sessionId: { $ne: currentSessionId } } : {}),
    };

    const result = await Session.updateMany(filter, {
      $set: { isRevoked: true, revokedAt: new Date() },
    });

    return res.json({ success: true, revokedCount: result.modifiedCount });
  } catch (error) {
    logger.error({ err: error }, 'Revoke all sessions error');
    return res.status(500).json({ error: 'Failed to revoke sessions' });
  }
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: 'Too many password reset requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipAuthRateLimitOutsideProd,
});

// POST /api/auth/forgot-password
// Send a password reset email if the account exists (never reveals whether email is registered)
router.post(
  '/forgot-password',
  forgotPasswordLimiter,
  validateZod(zodSchemas.forgotPassword),
  async (req, res) => {
    const { email } = req.body;
    const GENERIC_RESPONSE = {
      success: true,
      message: 'If an account with that email exists, a reset link has been sent.',
    };

    try {
      const staff = await Staff.findOne({
        ...piiMatch('email', email),
        status: 'active',
        isDeleted: { $ne: true },
      });

      if (!staff) {
        return res.json(GENERIC_RESPONSE);
      }

      const jwtSecret = getRequiredSecret('JWT_SECRET');
      const resetToken = jwt.sign(
        {
          purpose: 'password-reset',
          staffId: staff._id.toString(),
          schoolId: staff.schoolId?.toString(),
        },
        jwtSecret,
        { expiresIn: '1h' }
      );

      sendPasswordResetEmail({ name: staff.name, email: staff.email }, resetToken).catch((err) =>
        logger.warn({ err }, 'Failed to send password reset email')
      );

      return res.json(GENERIC_RESPONSE);
    } catch (err) {
      logger.error({ err }, 'Forgot password error');
      return res.status(500).json({ error: 'Failed to process request. Please try again.' });
    }
  }
);

// POST /api/auth/reset-password
// Validate reset token and set a new password
router.post(
  '/reset-password',
  authLimiter,
  validateZod(zodSchemas.resetPassword),
  async (req, res) => {
    const { token, newPassword } = req.body;

    const jwtSecret = getRequiredSecret('JWT_SECRET');

    let payload;
    try {
      payload = jwt.verify(token, jwtSecret);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(410).json({ error: 'Reset link has expired. Please request a new one.' });
      }
      return res.status(400).json({ error: 'Invalid or malformed reset token.' });
    }

    if (payload.purpose !== 'password-reset' || !payload.staffId) {
      return res.status(400).json({ error: 'Invalid reset token.' });
    }

    try {
      const staff = await Staff.findOne({
        _id: payload.staffId,
        status: 'active',
        isDeleted: { $ne: true },
      });

      if (!staff) {
        return res.status(404).json({ error: 'Account not found or inactive.' });
      }

      staff.password = newPassword;
      staff.tokenVersion = (staff.tokenVersion || 1) + 1;
      await staff.save();

      logAuthEvent('password_reset', staff, req);

      return res.json({
        success: true,
        message: 'Password reset successfully. You can now log in with your new password.',
      });
    } catch (err) {
      logger.error({ err }, 'Reset password error');
      return res.status(500).json({ error: 'Failed to reset password. Please try again.' });
    }
  }
);

export default router;
