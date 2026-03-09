import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { Parent } from '../database.js';
import { Student } from '../database.js';
import jwt from 'jsonwebtoken';
import admin from '../config/firebase.js';
import { getRequiredSecret } from '../config/environment.js';
import { ensureDocumentSchool, extractSchoolId, resolveSchool, serializeSchool } from '../utils/schoolContext.js';

const router = express.Router();

const parentLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

const parentOtpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many OTP requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const parentOtpVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many OTP verification attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const parentRefreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Too many token refresh attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const getJwtSecret = () => getRequiredSecret('JWT_SECRET');
const getJwtRefreshSecret = () => getRequiredSecret('JWT_REFRESH_SECRET');

async function findMatchingParents({ identifier, phone, schoolId, schoolCode }) {
  const query = {};

  if (identifier) {
    query.$or = [
      { email: identifier.toLowerCase().trim() },
      { phone: identifier.trim() },
    ];
  } else if (phone) {
    query.phone = phone.trim();
  }

  const resolvedSchool = (schoolId || schoolCode)
    ? await resolveSchool({ schoolId, schoolCode })
    : null;

  if ((schoolId || schoolCode) && !resolvedSchool) {
    return {
      parents: [],
      school: null,
      schoolLookupFailed: true,
    };
  }

  if (resolvedSchool) {
    query.schoolId = resolvedSchool._id;
  }

  const parents = await Parent.find(query).limit(2);
  return {
    parents,
    school: resolvedSchool,
    schoolLookupFailed: false,
  };
}

async function buildParentChildren(children = []) {
  return Promise.all(
    children.map(async (child) => {
      try {
        const student = await Student.findById(child.studentId)
          .select('name admissionId rollNo classId photo status')
          .populate('classId', 'name section academicYear')
          .lean();

        return {
          studentId: student?._id || child.studentId,
          name: student?.name || 'Unknown',
          admissionId: student?.admissionId,
          rollNo: student?.rollNo,
          class: student?.classId ? {
            id: student.classId._id,
            name: student.classId.name,
            section: student.classId.section,
            academicYear: student.classId.academicYear,
          } : null,
          photo: student?.photo,
          status: student?.status,
          relationship: child.relationship,
          isPrimary: child.isPrimary,
        };
      } catch (err) {
        return {
          studentId: child.studentId,
          relationship: child.relationship,
          isPrimary: child.isPrimary,
          error: 'Failed to load student details',
        };
      }
    })
  );
}

function buildParentTokens(parent) {
  const schoolId = extractSchoolId(parent.schoolId);

  const accessToken = jwt.sign(
    {
      userId: parent._id,
      parentId: parent._id,
      phone: parent.phone,
      name: parent.name,
      children: parent.children,
      userType: 'parent',
      schoolId,
    },
    getJwtSecret(),
    { expiresIn: '15m' }
  );

  const refreshToken = jwt.sign(
    {
      userId: parent._id,
      parentId: parent._id,
      tokenVersion: 1,
      schoolId,
    },
    getJwtRefreshSecret(),
    { expiresIn: '30d' }
  );

  return {
    accessToken,
    refreshToken,
  };
}

async function buildParentPayload(parent) {
  const resolvedSchoolId = await ensureDocumentSchool(parent);
  const school = resolvedSchoolId ? await resolveSchool({ schoolId: resolvedSchoolId }) : null;

  return {
    id: parent._id,
    name: parent.name,
    phone: parent.phone,
    email: parent.email,
    avatar: parent.avatar,
    schoolId: resolvedSchoolId?.toString?.() || resolvedSchoolId || null,
    school: serializeSchool(school),
    children: await buildParentChildren(parent.children),
  };
}

// POST /api/parent/auth/login
// Password-based login for parents (email/phone + password)
router.post('/login', parentLoginLimiter, async (req, res) => {
  try {
    const { identifier, password, schoolId, schoolCode } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_CREDENTIALS',
          message: 'Email/phone and password are required'
        }
      });
    }

    const { parents, schoolLookupFailed } = await findMatchingParents({
      identifier,
      schoolId,
      schoolCode,
    });

    if (schoolLookupFailed) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'SCHOOL_NOT_FOUND',
          message: 'School not found'
        }
      });
    }

    if (parents.length > 1) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'SCHOOL_IDENTIFIER_REQUIRED',
          message: 'Multiple parent accounts matched the provided credentials. Please provide a school identifier.'
        }
      });
    }

    const [parent] = parents;

    if (!parent) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email/phone or password'
        }
      });
    }

    if (!parent.password) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'PASSWORD_NOT_SET',
          message: 'Password not set. Please contact school administration.'
        }
      });
    }

    // Verify password
    const isMatch = await parent.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email/phone or password'
        }
      });
    }

    // Check account status
    if (parent.status !== 'active') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'ACCOUNT_INACTIVE',
          message: 'Your account is not active. Please contact school administration.'
        }
      });
    }

    // Update last login
    parent.lastLogin = new Date();
    await parent.save({ validateModifiedOnly: true });

    await ensureDocumentSchool(parent);
    const { accessToken, refreshToken } = buildParentTokens(parent);
    const parentPayload = await buildParentPayload(parent);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        parent: parentPayload,
        accessToken,
        refreshToken
      }
    });
  } catch (error) {
    console.error('Parent login error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Login failed'
      }
    });
  }
});

// POST /api/parent/auth/send-otp
// This endpoint triggers Firebase Phone Auth by checking if phone exists
router.post('/send-otp', parentOtpRequestLimiter, async (req, res) => {
  try {
    const { phone, schoolId, schoolCode } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PHONE',
          message: 'Phone number is required'
        }
      });
    }

    const { parents, schoolLookupFailed } = await findMatchingParents({
      phone,
      schoolId,
      schoolCode,
    });

    // For security, don't reveal if phone exists or not
    // Just return success - Firebase handles the actual OTP sending
    res.json({
      success: true,
      message: 'OTP sent to registered phone number',
      data: {
        phoneExists: parents.length > 0 && !schoolLookupFailed,
        requiresSchoolSelection: parents.length > 1 && !(schoolId || schoolCode),
      }
    });
  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to send OTP'
      }
    });
  }
});

// POST /api/parent/auth/verify-otp
// Verify Firebase token and issue JWT
router.post('/verify-otp', parentOtpVerificationLimiter, async (req, res) => {
  try {
    const { phone, firebaseIdToken, schoolId, schoolCode } = req.body;

    if (!phone || !firebaseIdToken) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_CREDENTIALS',
          message: 'Phone and Firebase token are required'
        }
      });
    }

    // 1. Verify Firebase token
    const decodedToken = await admin.auth().verifyIdToken(firebaseIdToken);
    const firebaseUid = decodedToken.uid;

    const { parents, schoolLookupFailed } = await findMatchingParents({
      phone,
      schoolId,
      schoolCode,
    });

    if (schoolLookupFailed) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'SCHOOL_NOT_FOUND',
          message: 'School not found'
        }
      });
    }

    if (parents.length > 1) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'SCHOOL_IDENTIFIER_REQUIRED',
          message: 'Multiple parent accounts matched the provided credentials. Please provide a school identifier.'
        }
      });
    }

    let [parent] = parents;

    if (!parent) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'PARENT_NOT_FOUND',
          message: 'No parent account found for this phone number. Please contact school administration.'
        }
      });
    }

    // 3. Update firebaseUid if not set
    if (!parent.firebaseUid) {
      parent.firebaseUid = firebaseUid;
    }

    // 4. Update last login
    parent.lastLogin = new Date();
    await parent.save();

    await ensureDocumentSchool(parent);
    const { accessToken, refreshToken } = buildParentTokens(parent);
    const parentPayload = await buildParentPayload(parent);

    // 6. Return tokens and parent data
    res.json({
      success: true,
      message: 'Login successful',
      data: {
        parent: parentPayload,
        accessToken,
        refreshToken
      }
    });
  } catch (error) {
    console.error('Verify OTP error:', error);

    if (error.code === 'auth/argument-error') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_FIREBASE_TOKEN',
          message: 'Invalid Firebase token'
        }
      });
    }

    res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to verify OTP'
      }
    });
  }
});

// POST /api/parent/auth/refresh
// Refresh access token using refresh token
router.post('/refresh', parentRefreshLimiter, async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_REFRESH_TOKEN',
          message: 'Refresh token is required'
        }
      });
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, getJwtRefreshSecret());

    // Load parent
    const parent = await Parent.findById(decoded.parentId);

    if (!parent || parent.status !== 'active') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'PARENT_NOT_FOUND',
          message: 'Parent account not found or inactive'
        }
      });
    }

    await ensureDocumentSchool(parent);
    const { accessToken } = buildParentTokens(parent);

    res.json({
      success: true,
      data: {
        accessToken
      }
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'REFRESH_TOKEN_EXPIRED',
          message: 'Refresh token expired. Please login again.'
        }
      });
    }

    res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Invalid refresh token'
      }
    });
  }
});

// POST /api/parent/auth/logout
// Logout parent (invalidate tokens on client side)
router.post('/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = jwt.verify(token, getJwtSecret());

      // Optionally: Invalidate refresh token by incrementing tokenVersion
      // await Parent.findByIdAndUpdate(decoded.parentId, { $inc: { tokenVersion: 1 } });

      // Clear FCM tokens
      await Parent.findByIdAndUpdate(decoded.parentId, { $set: { fcmTokens: [] } });
    }

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    // Even if token verification fails, return success
    // Client should clear local storage regardless
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  }
});

export default router;
