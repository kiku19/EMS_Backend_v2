import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { Class, Staff } from '../database.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Auth');
import {
  authenticate,
  requireAdmin as authRequireAdmin,
  generateToken,
  setAuthCookie,
  clearAuthCookie
} from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import {
  ensureDocumentSchool,
  resolveSchool,
  serializeSchool,
} from '../utils/schoolContext.js';
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

const router = express.Router();
const COOKIE_AUTH_MODE = 'cookie';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: () => process.env.NODE_ENV === 'test',
});

const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: 'Too many password reset attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

async function buildStaffAuthPayload(staff) {
  const resolvedSchoolId = await ensureDocumentSchool(staff);
  const classes = await Class.find({ classTeacherId: staff._id });
  const school = resolvedSchoolId ? await resolveSchool({ schoolId: resolvedSchoolId }) : null;
  const subscription = resolvedSchoolId
    ? await ensureSchoolSubscription(resolvedSchoolId, {
        billingContactName: school?.billingContactName || school?.name,
        billingEmail: school?.billingEmail || school?.contactEmail,
        billingPhone: school?.billingPhone || school?.contactPhone,
      })
    : null;

  return {
    id: staff._id,
    code: staff.code,
    name: staff.name,
    role: staff.role,
    email: staff.email,
    phone: staff.phone,
    classes: classes.map((cls) => ({ id: cls._id, name: cls.name, section: cls.section })),
    employeeId: staff.code,
    picture: staff.picture || staff.photo || null,
    schoolId: resolvedSchoolId?.toString?.() || resolvedSchoolId || null,
    school: serializeSchool(school),
    subscription: summarizeSubscription(subscription),
  };
}

async function authenticateStaff({ phone, email, password, schoolId, schoolCode }) {
  if (!password) {
    return { error: 'Password is required', status: 400 };
  }

  const query = { status: 'active' };
  if (phone) {
    query.phone = phone.trim();
  } else if (email) {
    query.email = email.toLowerCase().trim();
  } else {
    return { error: 'Phone or email is required', status: 400 };
  }

  const resolvedSchool = (schoolId || schoolCode)
    ? await resolveSchool({ schoolId, schoolCode })
    : null;

  if ((schoolId || schoolCode) && !resolvedSchool) {
    return { error: 'School not found', status: 404 };
  }

  if (resolvedSchool) {
    query.schoolId = resolvedSchool._id;
  }

  const matchingStaff = await Staff.find(query).limit(2);
  logger.warn({ query, matchCount: matchingStaff.length }, 'DEBUG: Login staff lookup');
  if (matchingStaff.length === 0) {
    return { error: 'Invalid credentials', status: 401 };
  }

  if (matchingStaff.length > 1) {
    return {
      error: 'Multiple accounts matched the provided credentials. Please provide a school identifier.',
      status: 409,
    };
  }

  const [staff] = matchingStaff;
  await ensureDocumentSchool(staff);

  const hasPassword = !!staff.password;
  const isPasswordValid = await staff.comparePassword(password);
  logger.warn({ hasPassword, isPasswordValid, staffId: staff._id.toString() }, 'DEBUG: Password check');
  if (!isPasswordValid) {
    return { error: 'Invalid credentials', status: 401 };
  }

  return { staff };
}

function normalizeSignupEmail(value) {
  return String(value || '').trim().toLowerCase();
}

router.get('/signup/invite-details', async (req, res) => {
  const inviteToken = String(req.query.token || '').trim();

  if (!inviteToken) {
    return res.status(400).json({ error: 'Invite token is required' });
  }

  const invite = verifySignupInvite(inviteToken);

  if (!invite) {
    return res.status(403).json({ error: 'Invite link is invalid or expired' });
  }

  return res.json({
    success: true,
    invite,
  });
});

router.post('/signup', validate(schemas.signup), async (req, res) => {
  try {
    const { name, email, schoolName, password, inviteToken } = req.body;
    const invite = verifySignupInvite(inviteToken);
    if (!invite) {
      return res.status(403).json({
        error: 'Signup is available by invitation only. Use the invite link sent to your school.',
      });
    }

    const normalizedEmail = normalizeSignupEmail(email);
    const normalizedSchoolName = normalizeInvitedSchoolName(schoolName);

    if (invite.email !== normalizedEmail || invite.schoolName !== normalizedSchoolName) {
      return res.status(400).json({
        error: 'Invite details do not match the signup form',
      });
    }

    const existingStaff = await Staff.findOne({ email: normalizedEmail });
    if (existingStaff) {
      return res.status(409).json({
        error: 'An account with this email already exists',
      });
    }

    const result = await onboardSchool({
      schoolName: normalizedSchoolName,
      contactEmail: normalizedEmail,
      adminName: name,
      adminEmail: normalizedEmail,
      adminPassword: password,
      plan: 'starter',
      planStatus: 'trialing',
      schoolSettings: {
        email: normalizedEmail,
      },
      provisionedBy: invite.invitedBy || normalizedEmail,
      source: 'invite-only-signup',
    });

    const school = result.school;
    school.billingContactName = name.trim();
    school.billingEmail = normalizedEmail;
    school.metadata = {
      ...(school.metadata || {}),
      signupSource: 'invite-only',
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

    res.status(201).json({
      success: true,
      message: 'Invite accepted successfully',
      school: serializeSchool(school),
      user: {
        id: staff._id.toString(),
        name: staff.name,
        email: staff.email,
        role: staff.role,
        schoolId: school._id.toString(),
        subscription: summarizeSubscription(subscription),
      },
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: 'Unable to create account with the provided details' });
    }

    logger.error({ err: error }, 'Signup error');
    res.status(500).json({ error: 'Signup failed. Please try again.' });
  }
});

router.post('/login', authLimiter, validate(schemas.login), async (req, res) => {
  try {
    if (req.body.email && await isSuperAdminLogin(req.body)) {
      const payload = buildSuperAdminAuthPayload();
      const token = generateToken(payload.id, payload.role, {
        userType: payload.userType,
        email: payload.email,
        name: payload.name,
      });

      if (req.get('X-Auth-Mode') === COOKIE_AUTH_MODE) {
        setAuthCookie(res, token);
      }

      return res.json({
        ...payload,
        token
      });
    }

    const { staff, error, status } = await authenticateStaff(req.body);

    if (!staff) {
      return res.status(status).json({ error });
    }

    const payload = await buildStaffAuthPayload(staff);
    const token = generateToken(staff._id.toString(), staff.role, {
      schoolId: payload.schoolId,
      userType: 'staff',
    });

    if (req.get('X-Auth-Mode') === COOKIE_AUTH_MODE) {
      setAuthCookie(res, token);
      return res.json({
        ...payload,
        token
      });
    }

    res.json({
      ...payload,
      token
    });
  } catch (error) {
    logger.error({ err: error }, 'Login error');
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

router.get('/session', authenticate, async (req, res) => {
  try {
    if (isSuperAdminUser(req.user)) {
      const payload = buildSuperAdminAuthPayload();
      const token = generateToken(payload.id, payload.role, {
        userType: payload.userType,
        email: payload.email,
        name: payload.name,
      });
      setAuthCookie(res, token);

      return res.json({
        ...payload,
        token
      });
    }

    const staff = await Staff.findOne({ _id: req.user.id, status: 'active' });

    if (!staff) {
      clearAuthCookie(res);
      return res.status(401).json({ error: 'Session is no longer valid' });
    }

    const payload = await buildStaffAuthPayload(staff);
    const token = generateToken(staff._id.toString(), staff.role, {
      schoolId: payload.schoolId,
      userType: 'staff',
    });
    setAuthCookie(res, token);

    res.json({
      ...payload,
      token
    });
  } catch (error) {
    logger.error({ err: error }, 'Session lookup error');
    res.status(500).json({ error: 'Failed to restore session' });
  }
});

router.post('/logout', async (req, res) => {
  clearAuthCookie(res);
  res.json({ success: true, message: 'Logged out successfully' });
});

// Emergency reset endpoint removed — use the standard password change flow or a DB admin script.

export default router;
