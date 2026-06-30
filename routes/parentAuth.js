/**
 * @swagger
 * tags:
 *   name: Parent Auth
 *   description: Parent portal authentication — phone+password login and Firebase OTP login
 */

/**
 * @swagger
 * /parent/auth/login:
 *   post:
 *     summary: Parent login with phone and password
 *     tags: [Parent Auth]
 *     security: []
 *     description: Rate-limited to 5 attempts per 15 minutes.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone, password]
 *             properties:
 *               phone:
 *                 type: string
 *                 pattern: '^[0-9]{10}$'
 *                 example: '9876543210'
 *               password:
 *                 type: string
 *                 minLength: 8
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                 refreshToken:
 *                   type: string
 *                 parent:
 *                   type: object
 *       401:
 *         description: Invalid credentials
 *       429:
 *         description: Too many login attempts
 */

/**
 * @swagger
 * /parent/auth/send-otp:
 *   post:
 *     summary: Request an OTP for parent phone login
 *     tags: [Parent Auth]
 *     security: []
 *     description: Rate-limited to 5 requests per 15 minutes. Uses Firebase when configured; otherwise falls back to server-generated SMS OTP.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone]
 *             properties:
 *               phone:
 *                 type: string
 *                 example: '+919876543210'
 *               schoolId:
 *                 type: string
 *                 example: '507f1f77bcf86cd799439011'
 *               schoolCode:
 *                 type: string
 *                 example: 'SCH001'
 *     responses:
 *       200:
 *         description: OTP request accepted (SMS sent by server or Firebase client)
 *       503:
 *         description: No OTP provider configured
 *       429:
 *         description: Too many OTP requests
 */

/**
 * @swagger
 * /parent/auth/verify-otp:
 *   post:
 *     summary: Verify an OTP and log in as parent
 *     tags: [Parent Auth]
 *     security: []
 *     description: Rate-limited to 5 verifications per 15 minutes. Accepts either a Firebase ID token (Firebase mode) or a server-generated SMS OTP (SMS fallback mode).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone]
 *             properties:
 *               phone:
 *                 type: string
 *                 example: '+919876543210'
 *               firebaseIdToken:
 *                 type: string
 *                 description: Firebase ID token from the client SDK (Firebase mode)
 *               otp:
 *                 type: string
 *                 description: Server-generated SMS OTP (SMS fallback mode)
 *               schoolId:
 *                 type: string
 *                 example: '507f1f77bcf86cd799439011'
 *               schoolCode:
 *                 type: string
 *                 example: 'SCH001'
 *     responses:
 *       200:
 *         description: OTP verified; returns EMS JWT token
 *       401:
 *         description: Invalid or expired OTP
 *       429:
 *         description: Too many OTP verifications
 */

/**
 * @swagger
 * /parent/auth/refresh:
 *   post:
 *     summary: Refresh parent access token
 *     tags: [Parent Auth]
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
 *     responses:
 *       200:
 *         description: New access token
 *       401:
 *         description: Invalid or expired refresh token
 */

/**
 * @swagger
 * /parent/auth/logout:
 *   post:
 *     summary: Log out parent (clears cookie if cookie-auth mode)
 *     tags: [Parent Auth]
 *     responses:
 *       200:
 *         description: Logged out
 */

import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { Parent, Student, OtpAttempt } from '../database.js';
import jwt from 'jsonwebtoken';
import admin, { getFirebaseInitializationError, isFirebaseConfigured } from '../config/firebase.js';
import { getRequiredSecret } from '../config/environment.js';
import {
  ensureDocumentSchool,
  extractSchoolId,
  resolveSchool,
  serializeSchool,
} from '../utils/schoolContext.js';
import { authenticateParent } from '../middleware/parentAuth.js';
import { validateZod } from '../validators/zodHelpers.js';
import {
  changePasswordSchema,
  sendOtpSchema,
  verifyOtpSchema,
} from '../validators/parentAuthSchema.js';
import { piiMatch, hmac } from '../utils/encryption.js';
import {
  generateOTP,
  hashOTP,
  verifyOTP,
  getOtpExpiryMinutes,
  getOtpMaxAttempts,
} from '../utils/otp.js';
import { sendOTPSMS, isSmsConfigured } from '../services/smsService.js';

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

export { parentOtpRequestLimiter, parentOtpVerificationLimiter };

const parentRefreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Too many token refresh attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const getJwtSecret = () => getRequiredSecret('JWT_SECRET');
const getJwtRefreshSecret = () => getRequiredSecret('JWT_REFRESH_SECRET');

function normalizePhoneNumber(value) {
  return String(value || '').replace(/\D/g, '');
}

function phoneNumbersMatch(requestedPhone, tokenPhone) {
  const requested = normalizePhoneNumber(requestedPhone);
  const token = normalizePhoneNumber(tokenPhone);

  if (!requested || !token) {
    return false;
  }

  // Exact match OR country-code prefix tolerance:
  // e.g. "919876543210" matches "9876543210" only when the longer number
  // consists of the shorter number with a 1-3 digit country code prefix.
  if (requested === token) return true;

  // Only allow prefix tolerance for numbers of the same local part length
  // i.e., both must share the same last 10 digits
  const last10Requested = requested.slice(-10);
  const last10Token = token.slice(-10);
  const MIN_LOCAL_DIGITS = 10;

  if (
    last10Requested.length === MIN_LOCAL_DIGITS &&
    last10Token.length === MIN_LOCAL_DIGITS &&
    last10Requested === last10Token
  ) {
    return true;
  }

  return false;
}

function buildFirebaseUnavailablePayload() {
  const initializationError = getFirebaseInitializationError();
  const payload = {
    success: false,
    error: {
      code: 'OTP_PROVIDER_NOT_CONFIGURED',
      message: 'OTP login is not configured on the server. Please contact support.',
    },
  };

  if (process.env.NODE_ENV !== 'production' && initializationError?.message) {
    payload.error.details = initializationError.message;
  }

  return payload;
}

function buildSmsUnavailablePayload() {
  return {
    success: false,
    error: {
      code: 'OTP_PROVIDER_NOT_CONFIGURED',
      message: 'OTP login is not configured on the server. Please contact support.',
    },
  };
}

function isOtpProviderConfigured() {
  return isFirebaseConfigured() || isSmsConfigured();
}

async function issueParentAuthResponse(parent, res) {
  await ensureDocumentSchool(parent);
  const { accessToken, refreshToken } = buildParentTokens(parent);
  const parentPayload = await buildParentPayload(parent);

  res.json({
    success: true,
    message: 'Login successful',
    data: {
      parent: parentPayload,
      accessToken,
      refreshToken,
    },
  });
}

async function findMatchingParents({ identifier, phone, schoolId, schoolCode }) {
  const query = {};

  if (identifier) {
    const emailHash = hmac(identifier.toLowerCase().trim());
    const phoneHash = hmac(identifier.trim());
    query.$or = [
      { emailHash },
      { phoneHash },
      { email: identifier.toLowerCase().trim() }, // fallback for un-migrated records
      { phone: identifier.trim() }, // fallback for un-migrated records
    ];
  } else if (phone) {
    Object.assign(query, piiMatch('phone', phone.trim()));
  }

  const resolvedSchool =
    schoolId || schoolCode ? await resolveSchool({ schoolId, schoolCode }) : null;

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
          class: student?.classId
            ? {
                id: student.classId._id,
                name: student.classId.name,
                section: student.classId.section,
                academicYear: student.classId.academicYear,
              }
            : null,
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
      tokenVersion: parent.tokenVersion || 1,
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
          message: 'Email/phone and password are required',
        },
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
          message: req.t('common:errors.schoolNotFound'),
        },
      });
    }

    if (parents.length > 1) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'SCHOOL_IDENTIFIER_REQUIRED',
          message:
            'Multiple parent accounts matched the provided credentials. Please provide a school identifier.',
        },
      });
    }

    const [parent] = parents;

    if (!parent) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email/phone or password',
        },
      });
    }

    if (!parent.password) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'PASSWORD_NOT_SET',
          message: 'Password not set. Please contact school administration.',
        },
      });
    }

    // Verify password
    const isMatch = await parent.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email/phone or password',
        },
      });
    }

    // Check account status
    if (parent.status !== 'active') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'ACCOUNT_INACTIVE',
          message: 'Your account is not active. Please contact school administration.',
        },
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
        refreshToken,
      },
    });
  } catch (error) {
    console.error('Parent login error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Login failed',
      },
    });
  }
});

// POST /api/parent/auth/send-otp
// Triggers an OTP for the provided phone number.
// When Firebase is configured, the client initiates Firebase Phone Auth itself.
// When Firebase is not configured, the server generates and sends an OTP via SMS.
router.post('/send-otp', parentOtpRequestLimiter, validateZod(sendOtpSchema), async (req, res) => {
  try {
    const { phone, schoolId, schoolCode } = req.body;

    if (!isOtpProviderConfigured()) {
      return res.status(503).json(buildSmsUnavailablePayload());
    }

    // Check if any parent matches (used only when sending via SMS; result is not leaked).
    const { parents } = await findMatchingParents({
      phone,
      schoolId,
      schoolCode,
    });

    if (isFirebaseConfigured()) {
      // Firebase mode: the client uses the Firebase SDK to send the SMS.
      // We do not reveal whether the phone is registered.
      return res.json({
        success: true,
        message: 'If this phone number is registered, an OTP has been sent.',
      });
    }

    // SMS fallback mode: server-generated OTP delivered by MSG91.
    if (!parents.length) {
      // Don't reveal that the phone is not registered.
      return res.json({
        success: true,
        message: 'If this phone number is registered, an OTP has been sent.',
      });
    }

    const otp = generateOTP();
    const otpHash = hashOTP(otp);
    const expiresAt = new Date(Date.now() + getOtpExpiryMinutes() * 60 * 1000);

    await OtpAttempt.findOneAndUpdate(
      { phone: normalizePhoneNumber(phone) },
      {
        otpHash,
        expiresAt,
        attempts: 0,
        used: false,
      },
      { upsert: true, new: true }
    );

    const smsResult = await sendOTPSMS(phone, otp);
    if (!smsResult.success) {
      console.error('Failed to send OTP SMS:', smsResult.error);
      // Don't leak SMS failure details to the client
    }

    res.json({
      success: true,
      message: 'If this phone number is registered, an OTP has been sent.',
    });
  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to send OTP',
      },
    });
  }
});

// POST /api/parent/auth/verify-otp
// Verifies an OTP and issues a JWT.
// Supports Firebase ID tokens (when Firebase is configured) or server-generated SMS OTPs.
router.post(
  '/verify-otp',
  parentOtpVerificationLimiter,
  validateZod(verifyOtpSchema),
  async (req, res) => {
    try {
      const { phone, firebaseIdToken, otp, schoolId, schoolCode } = req.body;

      if (!isOtpProviderConfigured()) {
        return res.status(503).json(buildSmsUnavailablePayload());
      }

      const verifiedPhone = phone;

      if (firebaseIdToken) {
        if (!isFirebaseConfigured()) {
          return res.status(503).json(buildFirebaseUnavailablePayload());
        }

        // Verify Firebase token
        const decodedToken = await admin.auth().verifyIdToken(firebaseIdToken);
        const firebaseUid = decodedToken.uid;

        if (!phoneNumbersMatch(phone, decodedToken.phone_number)) {
          return res.status(401).json({
            success: false,
            error: {
              code: 'PHONE_MISMATCH',
              message: 'The verified phone number does not match the requested phone number',
            },
          });
        }

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
              message: req.t('common:errors.schoolNotFound'),
            },
          });
        }

        if (parents.length > 1) {
          return res.status(409).json({
            success: false,
            error: {
              code: 'SCHOOL_IDENTIFIER_REQUIRED',
              message:
                'Multiple parent accounts matched the provided credentials. Please provide a school identifier.',
            },
          });
        }

        const [parent] = parents;

        if (!parent) {
          return res.status(404).json({
            success: false,
            error: {
              code: 'PARENT_NOT_FOUND',
              message:
                'No parent account found for this phone number. Please contact school administration.',
            },
          });
        }

        if (parent.status !== 'active') {
          return res.status(401).json({
            success: false,
            error: {
              code: 'ACCOUNT_INACTIVE',
              message: 'Your account is not active. Please contact school administration.',
            },
          });
        }

        if (!parent.firebaseUid) {
          parent.firebaseUid = firebaseUid;
        }

        parent.lastLogin = new Date();
        await parent.save();

        return issueParentAuthResponse(parent, res);
      }

      if (otp) {
        // Server-generated SMS OTP verification
        const normalizedPhone = normalizePhoneNumber(phone);
        const otpAttempt = await OtpAttempt.findOne({ phone: normalizedPhone });

        if (!otpAttempt) {
          return res.status(401).json({
            success: false,
            error: {
              code: 'INVALID_OTP',
              message: 'Invalid or expired OTP',
            },
          });
        }

        if (otpAttempt.used) {
          return res.status(401).json({
            success: false,
            error: {
              code: 'INVALID_OTP',
              message: 'OTP has already been used',
            },
          });
        }

        if (new Date() > otpAttempt.expiresAt) {
          return res.status(401).json({
            success: false,
            error: {
              code: 'OTP_EXPIRED',
              message: 'OTP has expired. Please request a new one.',
            },
          });
        }

        if (otpAttempt.attempts >= getOtpMaxAttempts()) {
          return res.status(429).json({
            success: false,
            error: {
              code: 'TOO_MANY_ATTEMPTS',
              message: 'Too many failed attempts. Please request a new OTP.',
            },
          });
        }

        otpAttempt.attempts += 1;
        const isValid = verifyOTP(otp, otpAttempt.otpHash);

        if (!isValid) {
          await otpAttempt.save();
          return res.status(401).json({
            success: false,
            error: {
              code: 'INVALID_OTP',
              message: 'Invalid OTP',
            },
          });
        }

        otpAttempt.used = true;
        await otpAttempt.save();

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
              message: req.t('common:errors.schoolNotFound'),
            },
          });
        }

        if (parents.length > 1) {
          return res.status(409).json({
            success: false,
            error: {
              code: 'SCHOOL_IDENTIFIER_REQUIRED',
              message:
                'Multiple parent accounts matched the provided credentials. Please provide a school identifier.',
            },
          });
        }

        const [parent] = parents;

        if (!parent) {
          return res.status(404).json({
            success: false,
            error: {
              code: 'PARENT_NOT_FOUND',
              message:
                'No parent account found for this phone number. Please contact school administration.',
            },
          });
        }

        if (parent.status !== 'active') {
          return res.status(401).json({
            success: false,
            error: {
              code: 'ACCOUNT_INACTIVE',
              message: 'Your account is not active. Please contact school administration.',
            },
          });
        }

        parent.lastLogin = new Date();
        await parent.save();

        return issueParentAuthResponse(parent, res);
      }

      // Neither firebaseIdToken nor otp provided
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_CREDENTIALS',
          message: 'Firebase token or OTP is required',
        },
      });
    } catch (error) {
      console.error('Verify OTP error:', error);

      if (error.code === 'auth/argument-error') {
        return res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_FIREBASE_TOKEN',
            message: 'Invalid Firebase token',
          },
        });
      }

      res.status(500).json({
        success: false,
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to verify OTP',
        },
      });
    }
  }
);

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
          message: 'Refresh token is required',
        },
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
          message: 'Parent account not found or inactive',
        },
      });
    }

    // Validate tokenVersion — if mismatch, the token was revoked (e.g. user logged out)
    if (decoded.tokenVersion !== undefined && decoded.tokenVersion !== (parent.tokenVersion || 1)) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'TOKEN_REVOKED',
          message: 'Refresh token has been revoked. Please login again.',
        },
      });
    }

    await ensureDocumentSchool(parent);
    const { accessToken } = buildParentTokens(parent);

    res.json({
      success: true,
      data: {
        accessToken,
      },
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'REFRESH_TOKEN_EXPIRED',
          message: 'Refresh token expired. Please login again.',
        },
      });
    }

    res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Invalid refresh token',
      },
    });
  }
});

// POST /api/parent/auth/change-password
// Authenticated: change password and invalidate other sessions via tokenVersion bump
router.post(
  '/change-password',
  authenticateParent,
  validateZod(changePasswordSchema),
  async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;

      // Re-fetch parent with password field (authenticateParent strips it)
      const parent = await Parent.findById(req.user.userId).select('+password');
      if (!parent || parent.status !== 'active') {
        return res.status(401).json({
          success: false,
          error: { code: 'ACCOUNT_INACTIVE', message: 'Account not found or inactive' },
        });
      }

      if (!parent.password) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'PASSWORD_NOT_SET',
            message: 'No password set on this account. Use OTP login.',
          },
        });
      }

      const isMatch = await parent.comparePassword(currentPassword);
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          error: { code: 'INCORRECT_PASSWORD', message: 'Current password is incorrect' },
        });
      }

      parent.password = newPassword;
      parent.tokenVersion = (parent.tokenVersion || 1) + 1;
      await parent.save({ validateModifiedOnly: true });

      res.json({
        success: true,
        message: 'Password changed successfully. Please log in again.',
      });
    } catch (error) {
      console.error('Change password error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to change password' },
      });
    }
  }
);

// POST /api/parent/auth/logout
// Logout parent (invalidate tokens on client side)
router.post('/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = jwt.verify(token, getJwtSecret());

      // Invalidate existing refresh tokens by incrementing tokenVersion
      await Parent.findByIdAndUpdate(decoded.parentId, { $inc: { tokenVersion: 1 } });

      // Clear FCM tokens
      await Parent.findByIdAndUpdate(decoded.parentId, { $set: { fcmTokens: [] } });
    }

    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    // Even if token verification fails, return success
    // Client should clear local storage regardless
    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  }
});

export default router;
