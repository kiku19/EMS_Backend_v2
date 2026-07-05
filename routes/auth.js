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
import { rateLimit } from 'express-rate-limit';
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
import { piiMatch } from '../utils/encryption.js';
import { resendVerificationLimiter } from '../middleware/security/resendVerificationLimiter.js';
import { issueEmailVerificationToken } from '../services/emailVerificationService.js';

// Self-serve signup feature flag (PR1 / PR2 of the Self-Serve School
// Onboarding Flow epic). Default false; PR6 flips on staging for soak
// before production. Verification routes also gate on this flag per the
// PR2 acceptance criteria — when off, no verification emails can be
// consumed by clients.
const isSelfSignupEnabled = () => process.env.ENABLE_SELF_SIGNUP === 'true';

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

// The auth/credential rate limiters below relax outside production (covers
// local dev and the test runner) so iterating locally isn't locked out after a
// handful of attempts. Production (NODE_ENV=production) enforces every limit.
// Mirrors the codebase convention of gating non-prod behaviour on
// `NODE_ENV !== 'production'` (see parentAuth.js, billingService.js).
const skipAuthRateLimitOutsideProd = () => process.env.NODE_ENV !== 'production';

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
  max: 5,
  handler: (req, res) => res.status(429).json({ error: req.t('auth:errors.tooManyLoginAttempts') }),
  standardHeaders: true,
  legacyHeaders: false,
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

// Shared handler for email verification (used by both GET and POST).
// Extended in PR2 / SCH-218 to also flip the per-staff `emailVerified`
// flag and emit an `email.verified` audit-log entry, so the dashboard's
// "verify to continue" interstitial can be driven off the staff record
// even for self-serve signups where no school-level audit entry exists.
async function handleVerifyEmail(token, req, res) {
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

    // Idempotent: if the school-level flag is already set, still try to
    // flip the staff-level flag below (the staff may have been created
    // after the school-level verification, e.g. for an additional admin).
    const schoolAlreadyVerified = Boolean(school.metadata?.emailVerified);

    if (!schoolAlreadyVerified) {
      school.metadata = {
        ...(school.metadata || {}),
        emailVerified: true,
        emailVerifiedAt: new Date().toISOString(),
      };
      school.markModified('metadata');
      await school.save();
    }

    // Flip the per-staff flag when we can locate the staff by email. The
    // PII-encrypted `email` field is searched via `piiMatch`, which is the
    // established lookup pattern for Staff email uniqueness checks. We do
    // NOT fail the verification when the staff can't be found — that would
    // regress legacy invite-based schools whose staff record predates the
    // `emailVerified` field.
    let staffForAudit = null;
    if (payload.email) {
      const staff = await Staff.findOne({
        ...piiMatch('email', payload.email),
        schoolId: school._id,
        isDeleted: { $ne: true },
      });
      if (staff && !staff.emailVerified) {
        staff.emailVerified = true;
        staff.emailVerifiedAt = new Date();
        await staff.save();
        staffForAudit = staff;
      } else if (staff?.emailVerified) {
        staffForAudit = staff;
      }
    }

    if (staffForAudit) {
      // PR6 audit-action conventions: actor is the staff themselves, entity
      // is "email_verification", and we tag with the schoolId so future
      // runs can scope audit-log queries.
      logAuthEvent('email_verified', staffForAudit, req);
    } else {
      // Fallback: log against the school so we still get an audit row even
      // for legacy invite-based schools where staff is missing.
      AuditTrail.create({
        schoolId: school._id,
        action: 'email.verified',
        entity: 'school',
        entityId: school._id.toString(),
        method: req.method,
        path: req.path,
        ipAddress:
          req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
          req.connection?.remoteAddress ||
          req.ip,
        userAgent: req.headers['user-agent'] || null,
        metadata: { source: schoolAlreadyVerified ? 'already_verified' : 'fresh' },
      }).catch(() => {});
    }

    return res.json({
      success: true,
      message: req.t('auth:success.emailVerified'),
      alreadyVerified: schoolAlreadyVerified,
    });
  } catch (err) {
    logger.error({ err }, 'Email verification error');
    return res.status(500).json({ error: req.t('auth:errors.verificationFailed') });
  }
}

// POST preferred — token in body avoids exposure in URL/browser history/Referer.
// Gated behind ENABLE_SELF_SIGNUP per PR2 acceptance criteria: the spec
// rolls both verification routes in with the self-serve flow.
router.post('/verify-email', validateZod(zodSchemas.verifyEmail), async (req, res) => {
  if (!isSelfSignupEnabled()) {
    return res.status(404).json({ error: 'Not found' });
  }
  return handleVerifyEmail(req.body.token, req, res);
});

// GET kept for backward-compat email links; Referrer-Policy mitigates leakage
router.get('/verify-email', (req, res) => {
  if (!isSelfSignupEnabled()) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.setHeader('Referrer-Policy', 'no-referrer');
  return handleVerifyEmail(String(req.query.token || '').trim(), req, res);
});

// Public, idempotent resend endpoint (PR2 / SCH-218).
// Body: { email }. Rate-limited 3/hour/email (skipped outside production).
//
// Email-enumeration resistance: the response is the same 200 success shape
// whether the email is registered, unverified, already verified, or
// unknown. The rate limiter + idempotency are the only signals an attacker
// gets. We deliberately do NOT differentiate the cases in the response.
router.post(
  '/resend-verification',
  validateZod(zodSchemas.resendVerification),
  resendVerificationLimiter,
  async (req, res) => {
    if (!isSelfSignupEnabled()) {
      return res.status(404).json({ error: 'Not found' });
    }

    const email = String(req.body.email || '')
      .trim()
      .toLowerCase();

    try {
      // Locate the staff by encrypted-email match. `piiMatch` handles the
      // PII encryption layer; we then pick the most recent active staff as
      // the canonical admin for the school.
      const staff = await Staff.findOne({
        ...piiMatch('email', email),
        isDeleted: { $ne: true },
      })
        .sort({ createdAt: -1 })
        .lean();

      // Idempotent success path: unknown email OR already verified.
      if (!staff || staff.emailVerified) {
        logger.debug(
          { emailExists: Boolean(staff), alreadyVerified: Boolean(staff?.emailVerified) },
          'Resend verification: idempotent 200 returned'
        );
        return res.json({
          success: true,
          message: req.t('auth:success.emailVerified'),
        });
      }

      const school = await School.findById(staff.schoolId).lean();
      if (!school) {
        // School was deleted after the staff was created — same idempotent
        // 200 to avoid leaking school existence.
        return res.json({
          success: true,
          message: req.t('auth:success.emailVerified'),
        });
      }

      const token = issueEmailVerificationToken({ school, staff, email, req });

      if (!token) {
        // JWT_SECRET missing — surface a 500 because we can't honor the
        // request, but never leak why.
        return res.status(500).json({
          error: req.t('auth:errors.verificationFailed'),
        });
      }

      return res.json({
        success: true,
        message: req.t('auth:success.emailVerified'),
      });
    } catch (err) {
      logger.error({ err: err?.message || err, email }, 'Resend verification error');
      return res.status(500).json({
        error: req.t('auth:errors.verificationFailed'),
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
    const staffSchool = await School.findById(staff.schoolId).select('ssoConfig').lean();
    if (staffSchool?.ssoConfig?.ssoOnly) {
      logAuthEvent('login_blocked_sso_only', staff, req);
      return res.status(403).json({
        error: 'Password login is disabled for this school. Please use Single Sign-On (SSO).',
        ssoOnly: true,
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
