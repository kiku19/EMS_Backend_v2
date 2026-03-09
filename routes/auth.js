import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { Class, Staff } from '../database.js';
import {
  authenticate,
  requireAdmin as authRequireAdmin,
  generateToken,
  setAuthCookie,
  clearAuthCookie
} from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import { ensureDocumentSchool, resolveSchool, serializeSchool } from '../utils/schoolContext.js';

const router = express.Router();
const COOKIE_AUTH_MODE = 'cookie';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
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

  const isPasswordValid = await staff.comparePassword(password);
  if (!isPasswordValid) {
    return { error: 'Invalid credentials', status: 401 };
  }

  return { staff };
}

router.post('/login', authLimiter, validate(schemas.login), async (req, res) => {
  try {
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
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

router.get('/session', authenticate, async (req, res) => {
  try {
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
    console.error('Session lookup error:', error);
    res.status(500).json({ error: 'Failed to restore session' });
  }
});

router.post('/logout', async (req, res) => {
  clearAuthCookie(res);
  res.json({ success: true, message: 'Logged out successfully' });
});

router.post('/emergency-reset', passwordResetLimiter, authenticate, authRequireAdmin, async (req, res) => {
  try {
    const { email, newPassword } = req.body;

    if (!email || !newPassword) {
      return res.status(400).json({ error: 'Email and newPassword required' });
    }

    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Not available in production' });
    }

    const bcrypt = await import('bcrypt');
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    const staff = await Staff.findOneAndUpdate(
      { email },
      { password: hashedPassword },
      { new: true }
    );

    if (!staff) {
      return res.status(404).json({ error: 'Staff not found with this email' });
    }

    console.log('Emergency password reset for:', staff.email, 'by admin:', req.user.userId);
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (error) {
    console.error('Emergency reset error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
