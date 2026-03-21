import express from 'express';
import mongoose from 'mongoose';
import { Student, Class } from '../../database.js';
import { validateParentChildAccess } from '../../middleware/parentAuth.js';
import { validateZod, zodSchemas } from '../../middleware/validation.js';
import Staff from '../../models/Staff.js';

const router = express.Router();

// Normalize :id → req.params.studentId for validateParentChildAccess
router.param('id', (req, res, next, id) => {
  req.params.studentId = id;
  next();
});

// GET /api/parent/profile
router.get('/profile', async (req, res) => {
  try {
    const parent = req.parent;

    res.json({
      success: true,
      data: {
        id: parent._id,
        name: parent.name,
        phone: parent.phone,
        email: parent.email,
        avatar: parent.avatar,
        children: parent.children,
        preferences: parent.preferences,
        status: parent.status,
        lastLogin: parent.lastLogin,
        createdAt: parent.createdAt,
      },
    });
  } catch (error) {
    console.error('Get parent profile error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to fetch parent profile' },
    });
  }
});

// PUT /api/parent/profile
router.put('/profile', validateZod(zodSchemas.parentProfileUpdate), async (req, res) => {
  try {
    const parent = req.parent;
    const { email, avatar, preferences } = req.body;

    if (email !== undefined) parent.email = email;
    if (avatar !== undefined) parent.avatar = avatar;
    if (preferences !== undefined) {
      parent.preferences = { ...parent.preferences, ...preferences };
    }

    await parent.save();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        id: parent._id,
        name: parent.name,
        phone: parent.phone,
        email: parent.email,
        avatar: parent.avatar,
        preferences: parent.preferences,
      },
    });
  } catch (error) {
    console.error('Update parent profile error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to update profile' },
    });
  }
});

// GET /api/parent/children
router.get('/children', async (req, res) => {
  try {
    const parent = req.parent;

    const childrenWithDetails = await Promise.all(
      parent.children.map(async (child) => {
        try {
          const student = await Student.findById(child.studentId)
            .select('name admissionId rollNo classId photo status feeDetails')
            .populate('classId', 'name section academicYear')
            .lean();

          if (!student) {
            return {
              studentId: child.studentId,
              relationship: child.relationship,
              isPrimary: child.isPrimary,
              error: 'Student not found',
            };
          }

          return {
            studentId: student._id,
            name: student.name,
            admissionId: student.admissionId,
            rollNo: student.rollNo,
            class: student.classId
              ? {
                  id: student.classId._id,
                  name: student.classId.name,
                  section: student.classId.section,
                  academicYear: student.classId.academicYear,
                }
              : null,
            photo: student.photo,
            status: student.status,
            feeStatus: student.feeStatus,
            feeDetails: student.feeDetails,
            relationship: child.relationship,
            isPrimary: child.isPrimary,
          };
        } catch (error) {
          console.error('Error fetching child details:', error);
          return {
            studentId: child.studentId,
            relationship: child.relationship,
            isPrimary: child.isPrimary,
            error: 'Failed to fetch details',
          };
        }
      })
    );

    res.json({
      success: true,
      data: { children: childrenWithDetails, total: childrenWithDetails.length },
    });
  } catch (error) {
    console.error('Get children error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to fetch children data' },
    });
  }
});

// GET /api/parent/students/:id
router.get('/students/:id', validateParentChildAccess, async (req, res) => {
  try {
    const { id } = req.params;

    const student = await Student.findById(id)
      .select('-parents -siblings -isDeleted -deletedAt -deletedBy')
      .populate({
        path: 'classId',
        select: 'name section room block academicYear classTeacherId',
        populate: { path: 'classTeacherId', select: 'name phone email photo' },
      })
      .lean();

    if (!student) {
      return res.status(404).json({
        success: false,
        error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found' },
      });
    }

    const childInfo = req.parent.children.find((child) => child.studentId.toString() === id);

    res.json({
      success: true,
      data: { ...student, relationship: childInfo?.relationship, isPrimary: childInfo?.isPrimary },
    });
  } catch (error) {
    console.error('Get student details error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to fetch student details' },
    });
  }
});

// POST /api/parent/fcm-token
router.post('/fcm-token', validateZod(zodSchemas.fcmToken), async (req, res) => {
  try {
    const { token, deviceInfo } = req.body;
    const parent = req.parent;

    const existingTokenIndex = parent.fcmTokens.findIndex((t) => t.token === token);

    if (existingTokenIndex === -1) {
      parent.fcmTokens.push({ token, deviceInfo: deviceInfo || null, createdAt: new Date() });
    } else {
      parent.fcmTokens[existingTokenIndex].deviceInfo = deviceInfo;
    }

    await parent.save();

    res.json({
      success: true,
      message: 'FCM token registered successfully',
      data: { tokenCount: parent.fcmTokens.length },
    });
  } catch (error) {
    console.error('Register FCM token error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to register FCM token' },
    });
  }
});

// DELETE /api/parent/fcm-token
router.delete('/fcm-token', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_TOKEN', message: 'FCM token is required' },
      });
    }

    const parent = req.parent;
    parent.fcmTokens = parent.fcmTokens.filter((t) => t.token !== token);
    await parent.save();

    res.json({
      success: true,
      message: 'FCM token removed successfully',
      data: { tokenCount: parent.fcmTokens.length },
    });
  } catch (error) {
    console.error('Remove FCM token error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to remove FCM token' },
    });
  }
});

// POST /api/parent/register-fcm-token
router.post('/register-fcm-token', async (req, res) => {
  try {
    const { token, deviceInfo } = req.body;
    const parent = req.parent;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_TOKEN', message: 'Token is required' },
      });
    }

    const existingIndex = parent.fcmTokens.findIndex((t) => t.token === token);
    if (existingIndex >= 0) {
      if (deviceInfo !== undefined) {
        parent.fcmTokens[existingIndex].deviceInfo = deviceInfo;
      }
    } else {
      parent.fcmTokens.push({ token, deviceInfo: deviceInfo || null });
    }

    await parent.save();

    res.json({ success: true, message: 'FCM token registered successfully' });
  } catch (error) {
    console.error('Register FCM token error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to register token' },
    });
  }
});

// DELETE /api/parent/unregister-fcm-token
router.delete('/unregister-fcm-token', async (req, res) => {
  try {
    const { token } = req.body;
    const parent = req.parent;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_TOKEN', message: 'Token is required' },
      });
    }

    const originalCount = parent.fcmTokens.length;
    parent.fcmTokens = parent.fcmTokens.filter((t) => t.token !== token);

    if (parent.fcmTokens.length === originalCount) {
      return res.status(404).json({
        success: false,
        error: { code: 'TOKEN_NOT_FOUND', message: 'Token not found' },
      });
    }

    await parent.save();

    res.json({ success: true, message: 'FCM token unregistered successfully' });
  } catch (error) {
    console.error('Unregister FCM token error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to unregister token' },
    });
  }
});

// GET /api/parent/students/:id/teachers — Get teachers for a student (for rating)
router.get('/students/:id/teachers', validateParentChildAccess, async (req, res) => {
  try {
    const { id: studentId } = req.params;
    const schoolId = req.parent?.schoolId;

    const student = await Student.findOne({ _id: studentId, schoolId }).select('classId').lean();

    if (!student || !student.classId) {
      return res.json({ success: true, data: { teachers: [] } });
    }

    // Get class teacher
    const cls = await Class.findOne({ _id: student.classId, schoolId })
      .select('classTeacherId')
      .lean();

    // Get all staff teaching this class (via teacherAssignments)
    const subjectTeachers = await Staff.find({
      schoolId,
      isDeleted: { $ne: true },
      status: 'active',
      'teacherAssignments.classes': new mongoose.Types.ObjectId(student.classId),
    })
      .select('_id name role department picture')
      .lean();

    // Build teacher list, class teacher first and deduped
    const teacherMap = new Map();
    if (cls?.classTeacherId) {
      const ct = await Staff.findOne({
        _id: cls.classTeacherId,
        schoolId,
        isDeleted: { $ne: true },
      })
        .select('_id name role department picture')
        .lean();
      if (ct) teacherMap.set(ct._id.toString(), { ...ct, isClassTeacher: true });
    }
    for (const t of subjectTeachers) {
      if (!teacherMap.has(t._id.toString())) {
        teacherMap.set(t._id.toString(), { ...t, isClassTeacher: false });
      }
    }

    res.json({ success: true, data: { teachers: Array.from(teacherMap.values()) } });
  } catch (error) {
    console.error('GET /parent/students/:id/teachers error:', error);
    res
      .status(500)
      .json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch teachers' },
      });
  }
});

export default router;
