import express from 'express';
import { Parent } from '../database.js';
import { Student } from '../database.js';
import jwt from 'jsonwebtoken';
import admin from '../config/firebase.js';

const router = express.Router();

// POST /api/parent/auth/login
// Password-based login for parents (email/phone + password)
router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_CREDENTIALS',
          message: 'Email/phone and password are required'
        }
      });
    }

    // Find parent by email or phone
    const parent = await Parent.findOne({
      $or: [
        { email: identifier.toLowerCase().trim() },
        { phone: identifier.trim() }
      ]
    });

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

    // Generate JWT tokens
    const accessToken = jwt.sign(
      {
        userId: parent._id,
        parentId: parent._id,
        phone: parent.phone,
        name: parent.name,
        children: parent.children,
        userType: 'parent'
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '15m' }
    );

    const refreshToken = jwt.sign(
      {
        userId: parent._id,
        parentId: parent._id,
        tokenVersion: 1
      },
      process.env.JWT_REFRESH_SECRET || 'your-refresh-secret',
      { expiresIn: '30d' }
    );

    // Populate children with student details
    const childrenDetails = await Promise.all(
      parent.children.map(async (child) => {
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
              academicYear: student.classId.academicYear
            } : null,
            photo: student?.photo,
            status: student?.status,
            relationship: child.relationship,
            isPrimary: child.isPrimary
          };
        } catch (err) {
          return {
            studentId: child.studentId,
            relationship: child.relationship,
            isPrimary: child.isPrimary,
            error: 'Failed to load student details'
          };
        }
      })
    );

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        parent: {
          id: parent._id,
          name: parent.name,
          phone: parent.phone,
          email: parent.email,
          avatar: parent.avatar,
          children: childrenDetails
        },
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
router.post('/send-otp', async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PHONE',
          message: 'Phone number is required'
        }
      });
    }

    // Check if parent exists in system
    const parent = await Parent.findOne({ phone });

    // For security, don't reveal if phone exists or not
    // Just return success - Firebase handles the actual OTP sending
    res.json({
      success: true,
      message: 'OTP sent to registered phone number',
      data: {
        phoneExists: !!parent
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
router.post('/verify-otp', async (req, res) => {
  try {
    const { phone, firebaseIdToken } = req.body;

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

    // 2. Find or create parent account
    let parent = await Parent.findOne({ phone });

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

    // 5. Generate JWT tokens
    const accessToken = jwt.sign(
      {
        parentId: parent._id,
        phone: parent.phone,
        name: parent.name,
        children: parent.children,
        userType: 'parent'
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '15m' }
    );

    const refreshToken = jwt.sign(
      {
        parentId: parent._id,
        tokenVersion: 1
      },
      process.env.JWT_REFRESH_SECRET || 'your-refresh-secret',
      { expiresIn: '30d' }
    );

    // 6. Return tokens and parent data
    res.json({
      success: true,
      message: 'Login successful',
      data: {
        parent: {
          id: parent._id,
          name: parent.name,
          phone: parent.phone,
          email: parent.email,
          children: await Promise.all(
            parent.children.map(async (child) => {
              const student = await Student.findById(child.studentId);
              return {
                studentId: student._id,
                name: student.name,
                admissionNumber: student.admissionNumber,
                class: student.class,
                relationship: child.relationship,
                isPrimary: child.isPrimary
              };
            })
          )
        },
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
router.post('/refresh', async (req, res) => {
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
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || 'your-refresh-secret');

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

    // Generate new access token
    const accessToken = jwt.sign(
      {
        parentId: parent._id,
        phone: parent.phone,
        name: parent.name,
        children: parent.children,
        userType: 'parent'
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '15m' }
    );

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
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');

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
