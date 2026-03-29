import express from 'express';
import { rateLimit } from 'express-rate-limit';
import Parent from '../models/Parent.js';
import { Student } from '../database.js';
import {
  generateParentPassword,
  createOrUpdateParentAccount,
} from '../utils/parentAccountHelper.js';
import { buildSchoolScopedQuery } from '../utils/schoolContext.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { escapeRegex } from './students/helpers.js';

const router = express.Router();

// All parent management routes require authentication
router.use(authenticate);

const getParentQuery = (req, query = {}) => buildSchoolScopedQuery(req.user?.schoolId, query);
const parentPasswordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: (req) =>
    req.t
      ? req.t('common:routes.tooManyParentPasswordResetAttemptsPleaseTryAgainLater')
      : 'Too many password reset attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// GET /api/parents - List parents with pagination, search, filters
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, search, status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = getParentQuery(req);

    if (search) {
      const searchRegex = new RegExp(escapeRegex(search), 'i');
      query.$or = [{ name: searchRegex }, { phone: searchRegex }, { email: searchRegex }];
    }

    if (status) {
      query.status = status;
    }

    const [parents, total] = await Promise.all([
      Parent.find(query)
        .select('-password -fcmTokens -firebaseUid')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Parent.countDocuments(query),
    ]);

    // Populate children names for display
    const parentsWithChildren = await Promise.all(
      parents.map(async (parent) => {
        const childrenDetails = await Promise.all(
          parent.children.map(async (child) => {
            try {
              const student = await Student.findById(child.studentId)
                .select('name admissionId classId')
                .populate('classId', 'name section')
                .lean();
              return {
                studentId: child.studentId,
                name: student?.name || 'Unknown',
                admissionId: student?.admissionId,
                class: student?.classId
                  ? `${student.classId.name} ${student.classId.section}`
                  : null,
                relationship: child.relationship,
              };
            } catch {
              return {
                studentId: child.studentId,
                name: 'Unknown',
                relationship: child.relationship,
              };
            }
          })
        );
        return { ...parent, children: childrenDetails };
      })
    );

    res.json({
      success: true,
      data: {
        parents: parentsWithChildren,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error('List parents error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: req.t('common:routes.failedToFetchParents') },
    });
  }
});

// GET /api/parents/:id - Single parent with populated children
router.get('/:id', async (req, res) => {
  try {
    const parent = await Parent.findOne(getParentQuery(req, { _id: req.params.id }))
      .select('-password -fcmTokens -firebaseUid')
      .lean();

    if (!parent) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: req.t('common:routes.parentNotFound') },
      });
    }

    const childrenDetails = await Promise.all(
      parent.children.map(async (child) => {
        try {
          const student = await Student.findById(child.studentId)
            .select('name admissionId rollNo classId photo status dateOfBirth feeDetails')
            .populate('classId', 'name section academicYear')
            .lean();
          return {
            studentId: child.studentId,
            name: student?.name || 'Unknown',
            admissionId: student?.admissionId,
            rollNo: student?.rollNo,
            class: student?.classId,
            photo: student?.photo,
            status: student?.status,
            dateOfBirth: student?.dateOfBirth,
            feeDetails: student?.feeDetails,
            relationship: child.relationship,
            isPrimary: child.isPrimary,
          };
        } catch {
          return { studentId: child.studentId, name: 'Unknown', relationship: child.relationship };
        }
      })
    );

    res.json({
      success: true,
      data: { ...parent, children: childrenDetails },
    });
  } catch (error) {
    console.error('Get parent error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: req.t('common:routes.failedToFetchParent') },
    });
  }
});

// POST /api/parents/:id/reset-password - Regenerate password from child's DOB+AdmissionId
router.post('/:id/reset-password', parentPasswordResetLimiter, async (req, res) => {
  try {
    const parent = await Parent.findOne(getParentQuery(req, { _id: req.params.id }));
    if (!parent) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: req.t('common:routes.parentNotFound') },
      });
    }

    if (parent.children.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'NO_CHILDREN', message: req.t('common:routes.parentHasNoLinkedChildren') },
      });
    }

    // Use first child's DOB + admissionId to generate password
    const firstChild = parent.children[0];
    const student = await Student.findById(firstChild.studentId)
      .select('dateOfBirth admissionId')
      .lean();

    if (!student) {
      return res.status(400).json({
        success: false,
        error: { code: 'STUDENT_NOT_FOUND', message: req.t('common:routes.linkedStudentNotFound') },
      });
    }

    const plainPassword = generateParentPassword(student.dateOfBirth, student.admissionId);
    if (!plainPassword) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'CANNOT_GENERATE',
          message: req.t('common:routes.cannotGeneratePasswordStudentMissingDobOrAdmissionId'),
        },
      });
    }

    parent.password = plainPassword;
    await parent.save();

    res.json({
      success: true,
      message: req.t('common:routes.passwordResetSuccessfully'),
      data: { generatedPassword: plainPassword },
    });
  } catch (error) {
    console.error('Reset parent password error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: req.t('common:routes.failedToResetPassword') },
    });
  }
});

// PUT /api/parents/:id/status - Activate/deactivate parent account
router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'inactive', 'suspended'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATUS',
          message: req.t('common:routes.statusMustBeActiveInactiveOrSuspended'),
        },
      });
    }

    const parent = await Parent.findOneAndUpdate(
      getParentQuery(req, { _id: req.params.id }),
      { status },
      { new: true }
    ).select('-password -fcmTokens -firebaseUid');

    if (!parent) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: req.t('common:routes.parentNotFound') },
      });
    }

    res.json({ success: true, message: `Parent account ${status}`, data: parent });
  } catch (error) {
    console.error('Update parent status error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: req.t('common:routes.failedToUpdateStatus') },
    });
  }
});

// POST /api/parents/bulk-create - Create parent accounts for all students that don't have one
router.post('/bulk-create', requireAdmin, async (req, res) => {
  try {
    const students = await Student.find(
      getParentQuery(req, {
        status: 'active',
        isDeleted: { $ne: true },
      })
    )
      .select(
        'name admissionId dateOfBirth parentName parentPhone parentEmail parentRelationship parents schoolId'
      )
      .lean();

    let created = 0;
    const updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const student of students) {
      try {
        // Check if any parent already exists for this student
        const existingParent = await Parent.findOne(
          getParentQuery(req, {
            'children.studentId': student._id,
          })
        );

        if (existingParent) {
          skipped++;
          continue;
        }

        await createOrUpdateParentAccount(student);
        created++;
      } catch (err) {
        console.error(`Error processing student ${student.admissionId}:`, err.message);
        errors++;
      }
    }

    res.json({
      success: true,
      message: `Bulk parent account creation complete`,
      data: { totalStudents: students.length, created, updated, skipped, errors },
    });
  } catch (error) {
    console.error('Bulk create parents error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: req.t('common:routes.failedToBulkCreateParentAccounts'),
      },
    });
  }
});

export default router;
