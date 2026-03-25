import express from 'express';
import mongoose from 'mongoose';
import { Staff, Class, Student } from '../../database.js';
import { authenticate } from '../../middleware/auth.js';
import { checkPermission } from '../../middleware/permissions.js';
import { scopeBySchool, formatStaffResponse } from './helpers.js';
import TeacherRating from '../../models/TeacherRating.js';

const router = express.Router();
router.use(authenticate);

// Fix 3.1: Add authenticate + schoolId scoping to /public
router.get('/public', authenticate, async (req, res) => {
  try {
    const staff = await Staff.find(
      scopeBySchool(req.user?.schoolId, { status: 'active', isDeleted: { $ne: true } })
    )
      .select('name role department')
      .sort({ name: 1 });

    res.json(staff);
  } catch (error) {
    console.error('Error fetching public staff list:', error);
    res.status(500).json({ error: req.t('common:routes.failedToFetchStaffList') });
  }
});

// Fix 3.2: Add authenticate + schoolId scoping, remove email/phone from response
router.get('/validate/:id', authenticate, async (req, res) => {
  try {
    const staff = await Staff.findOne(
      scopeBySchool(req.user?.schoolId, {
        _id: req.params.id,
        status: 'active',
        isDeleted: { $ne: true },
      })
    );
    if (!staff) {
      return res.json({ valid: false, reason: 'Staff member not found or inactive' });
    }

    res.json({
      valid: true,
      staff: {
        id: staff._id,
        name: staff.name,
        role: staff.role,
        status: staff.status,
      },
    });
  } catch (error) {
    console.error('Error validating staff member:', error);
    res.json({ valid: false, reason: 'Validation failed' });
  }
});

router.get('/me', authenticate, async (req, res) => {
  try {
    const staff = await Staff.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.user.id })
    ).populate('reporterId', 'name');
    if (!staff) {
      return res.status(404).json({ error: req.t('common:routes.staffNotFound') });
    }

    // Fix 3.21: Use formatStaffResponse for consistency
    res.json(formatStaffResponse(staff));
  } catch (error) {
    console.error('Error fetching own profile:', error);
    res.status(500).json({ error: req.t('common:routes.failedToFetchProfile') });
  }
});

// Fix 3.8: Add schoolId scoping to Class sub-queries
router.get('/:id/classes', authenticate, checkPermission('staff', 'view'), async (req, res) => {
  try {
    const staff = await Staff.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
    );
    if (!staff) {
      return res.status(404).json({ error: req.t('common:routes.staffNotFound') });
    }

    const { role } = req.query;
    let allClassIds = [];

    if (role === 'classTeacher') {
      const classTeacherClasses = await Class.find(
        scopeBySchool(req.user?.schoolId, { classTeacherId: staff._id })
      ).select('_id');
      allClassIds = classTeacherClasses.map((cls) => cls._id.toString());
    } else {
      const assignedClassIds = staff.assignedClasses || [];
      const teacherAssignmentClasses = (staff.teacherAssignments || []).flatMap(
        (assignment) => assignment.classes || []
      );
      const classTeacherClasses = await Class.find(
        scopeBySchool(req.user?.schoolId, { classTeacherId: staff._id })
      ).select('_id');
      const classTeacherClassIds = classTeacherClasses.map((cls) => cls._id.toString());
      allClassIds = [
        ...new Set([
          ...assignedClassIds,
          ...teacherAssignmentClasses.map((classId) => classId.toString()),
          ...classTeacherClassIds,
        ]),
      ];
    }

    // Fix 3.17: Batch queries instead of N+1 individual lookups
    const isValidObjectId = (value) => /^[a-f\d]{24}$/i.test(value);

    // Separate ObjectId-based and string-based class references
    const objectIdClassIds = [];
    const stringClassIds = [];
    for (const classId of allClassIds) {
      const classIdStr = classId.toString();
      if (isValidObjectId(classIdStr)) {
        objectIdClassIds.push(new mongoose.Types.ObjectId(classIdStr));
      } else {
        stringClassIds.push(classIdStr);
      }
    }

    // Batch fetch all ObjectId-based classes in one query
    const batchedClasses =
      objectIdClassIds.length > 0
        ? await Class.find(
            scopeBySchool(req.user?.schoolId, { _id: { $in: objectIdClassIds } })
          ).lean()
        : [];

    // Fall back to individual lookups for string-based class references
    const stringClassResults = await Promise.all(
      stringClassIds.map(async (classIdStr) => {
        const parts = classIdStr.split('-');
        if (parts.length >= 2) {
          return Class.findOne(
            scopeBySchool(req.user?.schoolId, { name: parts[0], section: parts[1] })
          ).lean();
        }
        return Class.findOne(scopeBySchool(req.user?.schoolId, { name: classIdStr })).lean();
      })
    );

    const allClasses = [...batchedClasses, ...stringClassResults.filter(Boolean)];

    // Batch student count aggregation for all classes at once
    const classObjectIds = allClasses.map((cls) => cls._id);
    const studentCounts =
      classObjectIds.length > 0
        ? await Student.aggregate([
            {
              $match: {
                classId: { $in: classObjectIds },
                status: 'active',
                isDeleted: { $ne: true },
              },
            },
            { $group: { _id: '$classId', count: { $sum: 1 } } },
          ])
        : [];

    const countMap = new Map(studentCounts.map((item) => [item._id.toString(), item.count]));

    const classDetails = allClasses.map((classData) => {
      const studentCount = countMap.get(classData._id.toString()) || 0;
      const isClassTeacher = classData.classTeacherId?.toString() === req.params.id;
      return {
        id: classData._id,
        name: `${classData.name}-${classData.section}`,
        className: classData.name,
        section: classData.section,
        subject: isClassTeacher
          ? `Class Teacher - ${classData.name}`
          : staff.department || 'General',
        studentCount,
        students: studentCount,
        isClassTeacher,
      };
    });

    res.json(classDetails);
  } catch (error) {
    console.error('Error fetching staff classes:', error);
    res.status(500).json({ error: req.t('common:routes.failedToFetchStaffClasses') });
  }
});

// GET /api/staff/:id/ratings — Admin: get teacher ratings summary
router.get('/:id/ratings', authenticate, checkPermission('staff', 'view'), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const teacherId = req.params.id;

    const [ratings, stats] = await Promise.all([
      TeacherRating.find({ schoolId, teacherId }).sort({ createdAt: -1 }).limit(50).lean(),
      TeacherRating.aggregate([
        {
          $match: {
            schoolId: new mongoose.Types.ObjectId(schoolId),
            teacherId: new mongoose.Types.ObjectId(teacherId),
          },
        },
        {
          $group: {
            _id: null,
            averageRating: { $avg: '$rating' },
            totalRatings: { $sum: 1 },
            distribution: {
              $push: '$rating',
            },
          },
        },
      ]),
    ]);

    const summary = stats[0] || { averageRating: 0, totalRatings: 0, distribution: [] };
    const dist = [1, 2, 3, 4, 5].map((star) => ({
      star,
      count: summary.distribution.filter((r) => r === star).length,
    }));

    res.json({
      success: true,
      data: {
        averageRating: summary.averageRating ? Math.round(summary.averageRating * 10) / 10 : 0,
        totalRatings: summary.totalRatings,
        distribution: dist,
        ratings,
      },
    });
  } catch (error) {
    console.error('GET /staff/:id/ratings error:', error);
    res.status(500).json({ success: false, error: req.t('common:routes.failedToFetchRatings') });
  }
});

export default router;
