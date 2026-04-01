/**
 * @swagger
 * tags:
 *   name: Classes
 *   description: Class & section management
 */

/**
 * @swagger
 * /classes:
 *   get:
 *     summary: List all classes
 *     tags: [Classes]
 *     parameters:
 *       - $ref: '#/components/parameters/AcademicYearQuery'
 *       - $ref: '#/components/parameters/SearchQuery'
 *     responses:
 *       200:
 *         description: Array of classes
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ClassBase'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *   post:
 *     summary: Create a class
 *     tags: [Classes]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateClassRequest'
 *     responses:
 *       201:
 *         description: Class created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ClassBase'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       409:
 *         description: Class with same name & section already exists
 */

/**
 * @swagger
 * /classes/{id}:
 *   get:
 *     summary: Get a class by ID
 *     tags: [Classes]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: Class details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ClassBase'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   put:
 *     summary: Update a class
 *     tags: [Classes]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateClassRequest'
 *     responses:
 *       200:
 *         description: Updated class
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ClassBase'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   delete:
 *     summary: Delete a class
 *     tags: [Classes]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         $ref: '#/components/responses/NotFound'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @swagger
 * /classes/{id}/students:
 *   get:
 *     summary: List students in a class
 *     tags: [Classes, Students]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *       - $ref: '#/components/parameters/AcademicYearQuery'
 *     responses:
 *       200:
 *         description: Students array
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/StudentBase'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @swagger
 * /classes/{id}/teacher:
 *   put:
 *     summary: Assign class teacher
 *     tags: [Classes]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [classTeacherId]
 *             properties:
 *               classTeacherId:
 *                 $ref: '#/components/schemas/ObjectId'
 *     responses:
 *       200:
 *         description: Teacher assigned
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */

import express from 'express';
import {
  Class,
  Staff,
  Student,
  Timetable,
  TeacherTimetable,
  Exam,
  Result,
  Attendance,
  ClassAnnouncement,
  ChapterProgress,
  ClassRating,
  getNextRollNumber,
} from '../database.js';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import Homework from '../models/Homework.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { validateZod } from '../middleware/validation.js';
import {
  createClassSchema,
  updateClassSchema,
  updateClassTeacherSchema,
  updateClassSubjectsSchema,
  updateClassTagSchema,
} from '../validators/index.js';
import resolveClassId from '../utils/resolveClassId.js';
import { extractSchoolId, ensureDefaultSchool } from '../utils/schoolContext.js';
import { countActiveStudents, checkClassCapacity } from '../utils/classCapacity.js';
import { sendNotification } from './notifications.js';
import { EVENTS, emitEvent } from '../utils/socketEvents.js';

const router = express.Router();
router.use(authenticate);

function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) throw new Error('schoolId is required for scoped queries');
  return { ...query, schoolId: normalizedSchoolId };
}

async function resolveRequestSchoolId(req) {
  if (req.user?.schoolId) return extractSchoolId(req.user.schoolId);
  const school = await ensureDefaultSchool();
  return extractSchoolId(school._id);
}

/**
 * Sync Staff document when class teacher assignment changes.
 * Clears the old teacher's fields and sets the new teacher's fields.
 */
async function syncClassTeacherStaff({ oldTeacherId, newTeacherId, classDoc }) {
  if (oldTeacherId && String(oldTeacherId) !== String(newTeacherId)) {
    await Staff.findByIdAndUpdate(oldTeacherId, {
      classTeacherOf: null,
      isClassTeacher: false,
    });
  }

  if (newTeacherId) {
    await Staff.findByIdAndUpdate(newTeacherId, {
      classTeacherOf: `${classDoc.name}-${classDoc.section}`,
      isClassTeacher: true,
    });
  }
}

async function ensureTeacherAvailable(classTeacherId, currentClassId = null, schoolId = null) {
  if (classTeacherId === null || classTeacherId === undefined || classTeacherId === '') {
    return null;
  }

  const teacherQuery = schoolId
    ? scopeBySchool(schoolId, { _id: classTeacherId })
    : { _id: classTeacherId };
  const teacher = await Staff.findOne(teacherQuery);
  if (!teacher) {
    return { error: { status: 404, body: { error: 'Teacher not found' } } };
  }

  const query = schoolId
    ? scopeBySchool(schoolId, { classTeacherId, isDeleted: { $ne: true } })
    : { classTeacherId, isDeleted: { $ne: true } };
  if (currentClassId) {
    query._id = { $ne: currentClassId };
  }

  const existingClass = await Class.findOne(query);
  if (existingClass) {
    return {
      error: {
        status: 400,
        body: {
          error: 'Teacher is already assigned as class teacher to another class',
          teacherName: teacher.name,
          teacherCode: teacher.code,
          existingClass: {
            id: existingClass._id,
            name: existingClass.name,
            section: existingClass.section,
          },
          message: `${teacher.name} (${teacher.code}) is already assigned to ${existingClass.name} ${existingClass.section}. Please unassign them first.`,
        },
      },
    };
  }

  return { teacher };
}

router.get('/public', authenticate, async (req, res) => {
  try {
    const schoolId = await resolveRequestSchoolId(req);
    const classes = await Class.find(scopeBySchool(schoolId, { isDeleted: { $ne: true } })).sort({
      name: 1,
      section: 1,
    });
    const formatted = classes.map((cls) => ({
      id: cls._id,
      name: cls.name,
      section: cls.section,
      displayName: cls.section ? `${cls.name}-${cls.section}` : cls.name,
    }));

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/', authenticate, checkPermission('classes', 'view'), async (req, res) => {
  try {
    const baseQuery = req.query.teacherId ? { classTeacherId: req.query.teacherId } : {};
    baseQuery.isDeleted = { $ne: true };
    const query = scopeBySchool(req.user?.schoolId, baseQuery);
    const classes = await Class.find(query)
      .populate('classTeacherId', 'name')
      .sort({ name: 1, section: 1 });

    // AUDIT-65: Bulk-fetch student counts instead of N+1 individual queries
    const classIds = classes.map((cls) => cls._id);
    const studentCountAgg = await Student.aggregate([
      {
        $match: {
          classId: { $in: classIds },
          status: 'active',
          isDeleted: { $ne: true },
          ...(req.user?.schoolId ? { schoolId: extractSchoolId(req.user.schoolId) } : {}),
        },
      },
      { $group: { _id: '$classId', count: { $sum: 1 } } },
    ]);
    const studentCountMap = new Map(
      studentCountAgg.map((item) => [item._id.toString(), item.count])
    );

    const formatted = classes.map((cls) => ({
      id: cls._id.toString(),
      name: cls.name,
      section: cls.section,
      subjects: cls.subjects,
      classTeacherId: cls.classTeacherId?._id?.toString(),
      classTeacherName: cls.classTeacherId?.name,
      studentCount: studentCountMap.get(cls._id.toString()) || 0,
      academicYear: cls.academicYear,
      strengthLimit: cls.strengthLimit,
    }));

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post(
  '/',
  authenticate,
  checkPermission('classes', 'create'),
  validateZod(createClassSchema),
  async (req, res) => {
    try {
      const { name, section, classTeacherId, subjects, academicYear, strengthLimit } = req.body;
      const schoolId = await resolveRequestSchoolId(req);
      if (!schoolId) {
        return res.status(400).json({ error: 'School context is required' });
      }
      const validation = await ensureTeacherAvailable(classTeacherId, null, req.user?.schoolId);
      if (validation?.error) {
        return res.status(validation.error.status).json(validation.error.body);
      }
      const classDoc = new Class({
        name,
        section,
        classTeacherId,
        subjects,
        academicYear,
        schoolId,
        ...(strengthLimit && { strengthLimit }),
      });
      await classDoc.save();

      // Sync Staff record if a class teacher was assigned at creation
      if (classTeacherId) {
        await syncClassTeacherStaff({ oldTeacherId: null, newTeacherId: classTeacherId, classDoc });
      }

      res.status(201).json({ id: classDoc._id, ...classDoc.toObject() });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(400).json({
          error: 'A class with this name, section, and academic year already exists',
        });
      }

      res.status(500).json({ error: error.message });
    }
  }
);

router.put(
  '/:id/class-teacher',
  authenticate,
  checkPermission('classes', 'edit'),
  validateZod(updateClassTeacherSchema),
  async (req, res) => {
    try {
      const { classTeacherId } = req.body;
      const classDoc = await Class.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
      );
      if (!classDoc) {
        return res.status(404).json({ error: req.t('common:errors.classNotFound') });
      }

      const validation = await ensureTeacherAvailable(
        classTeacherId,
        req.params.id,
        req.user?.schoolId
      );
      if (validation?.error) {
        return res.status(validation.error.status).json(validation.error.body);
      }

      const oldTeacherId = classDoc.classTeacherId;
      classDoc.classTeacherId = classTeacherId || null;
      await classDoc.save();

      await syncClassTeacherStaff({ oldTeacherId, newTeacherId: classTeacherId, classDoc });

      // Notify old and new teachers about the assignment change
      const className = `${classDoc.name}-${classDoc.section}`;
      if (oldTeacherId && String(oldTeacherId) !== String(classTeacherId || '')) {
        sendNotification(
          oldTeacherId,
          'Staff',
          'class_teacher',
          'Class Teacher Unassigned',
          `You have been unassigned as class teacher of ${className}.`,
          { relatedId: classDoc._id, relatedType: 'Class' }
        ).catch((err) => console.error('Notification error (old teacher):', err));
      }
      if (classTeacherId) {
        sendNotification(
          classTeacherId,
          'Staff',
          'class_teacher',
          'Class Teacher Assigned',
          `You have been assigned as class teacher of ${className}.`,
          { relatedId: classDoc._id, relatedType: 'Class' }
        ).catch((err) => console.error('Notification error (new teacher):', err));
      }

      const io = req.app.get('io');
      emitEvent(io, EVENTS.CLASS_UPDATED, {
        schoolId: req.user.schoolId?.toString(),
        classId: classDoc._id.toString(),
        name: classDoc.name,
        section: classDoc.section,
        classTeacherId: classDoc.classTeacherId,
        teacher: validation?.teacher?.name || null,
        teacherPhoto:
          validation?.teacher?.picture ||
          validation?.teacher?.photoURL ||
          validation?.teacher?.photo ||
          null,
      });

      res.json({
        id: classDoc._id,
        ...classDoc.toObject(),
        teacherName: validation?.teacher?.name || null,
        teacherPhoto:
          validation?.teacher?.picture ||
          validation?.teacher?.photoURL ||
          validation?.teacher?.photo ||
          null,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// AUDIT-36: Added permission check
router.get('/:id/settings', authenticate, checkPermission('classes', 'view'), async (req, res) => {
  try {
    const classDoc = await Class.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
    );
    if (!classDoc) {
      return res.status(404).json({ error: req.t('common:errors.classNotFound') });
    }

    res.json({
      classId: classDoc._id,
      classTag: classDoc.classTag || '',
      assignedSubjects: classDoc.assignedSubjects || [],
      name: classDoc.name,
      section: classDoc.section,
    });
  } catch (error) {
    console.error('Error fetching class settings:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put(
  '/:id/tag',
  authenticate,
  checkPermission('classes', 'edit'),
  validateZod(updateClassTagSchema),
  async (req, res) => {
    try {
      const { classTag } = req.body;

      const classDoc = await Class.findOneAndUpdate(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
        { classTag },
        { new: true, runValidators: true }
      );

      if (!classDoc) {
        return res.status(404).json({ error: req.t('common:errors.classNotFound') });
      }

      res.json({
        success: true,
        classId: classDoc._id,
        classTag: classDoc.classTag,
      });
    } catch (error) {
      console.error('Error updating class tag:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

router.put(
  '/:id/subjects',
  authenticate,
  checkPermission('classes', 'edit'),
  validateZod(updateClassSubjectsSchema),
  async (req, res) => {
    try {
      const { assignedSubjects } = req.body;

      const classDoc = await Class.findOneAndUpdate(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
        { assignedSubjects, subjects: assignedSubjects },
        { new: true, runValidators: true }
      );

      if (!classDoc) {
        return res.status(404).json({ error: req.t('common:errors.classNotFound') });
      }

      res.json({
        success: true,
        classId: classDoc._id,
        subjects: classDoc.subjects,
        assignedSubjects: classDoc.assignedSubjects,
      });
    } catch (error) {
      console.error('Error updating class subjects:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// AUDIT-36: Added permission check
router.get('/:id/students', authenticate, checkPermission('classes', 'view'), async (req, res) => {
  try {
    const resolved = await resolveClassId(req.params.id, req.user?.schoolId);
    if (!resolved) {
      return res.status(404).json({ error: req.t('common:errors.classNotFound') });
    }

    const scopedClass = await Class.findOne(
      scopeBySchool(req.user?.schoolId, { _id: resolved.classId, isDeleted: { $ne: true } })
    );
    if (!scopedClass) {
      return res.status(404).json({ error: req.t('common:errors.classNotFound') });
    }

    const skip = parseInt(req.query.skip) || 0;
    const limit = parseInt(req.query.limit) || 50;

    const studentsQuery = scopeBySchool(req.user?.schoolId, {
      classId: resolved.classId,
      status: 'active',
      isDeleted: { $ne: true },
    });
    const total = await Student.countDocuments(studentsQuery);
    const students = await Student.find(studentsQuery).sort({ rollNo: 1 }).skip(skip).limit(limit);

    res.json({
      students: students.map((student) => ({ id: student._id, ...student.toObject() })),
      hasMore: skip + students.length < total,
      total,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get(
  '/:id/next-roll-number',
  authenticate,
  checkPermission('classes', 'view'),
  async (req, res) => {
    try {
      const rollNumber = await getNextRollNumber(req.params.id, req.user?.schoolId);
      res.json({ rollNumber });
    } catch (error) {
      console.error('Error getting next roll number:', error);
      res.status(500).json({ error: 'Failed to get next roll number' });
    }
  }
);

router.get('/:id/capacity', authenticate, checkPermission('classes', 'view'), async (req, res) => {
  try {
    const result = await checkClassCapacity(req.params.id, req.user?.schoolId);
    if (!result) {
      return res.status(404).json({ error: req.t('common:errors.classNotFound') });
    }

    res.json({
      classId: result.classData._id,
      name: result.classData.name,
      section: result.classData.section,
      current: result.currentCount,
      capacity: result.capacity,
      available: result.available,
      isFull: result.isFull,
    });
  } catch (error) {
    console.error('Error checking class capacity:', error);
    res.status(500).json({ error: 'Failed to check capacity' });
  }
});

// AUDIT-36: Added permission check
router.get('/:id', authenticate, checkPermission('classes', 'view'), async (req, res) => {
  try {
    const resolved = await resolveClassId(req.params.id, req.user?.schoolId);
    if (!resolved) {
      return res.status(404).json({ error: req.t('common:errors.classNotFound') });
    }

    const classDoc = await Class.findOne(
      scopeBySchool(req.user?.schoolId, { _id: resolved.classId, isDeleted: { $ne: true } })
    ).populate('classTeacherId', 'name');
    if (!classDoc) {
      return res.status(404).json({ error: req.t('common:errors.classNotFound') });
    }

    const studentCount = await countActiveStudents(classDoc._id, req.user?.schoolId);
    res.json({
      id: classDoc._id,
      name: classDoc.name,
      section: classDoc.section,
      subjects: classDoc.subjects,
      classTeacherId: classDoc.classTeacherId?._id,
      classTeacherName: classDoc.classTeacherId?.name,
      studentCount,
      academicYear: classDoc.academicYear,
      strengthLimit: classDoc.strengthLimit,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put(
  '/:id',
  authenticate,
  checkPermission('classes', 'edit'),
  validateZod(updateClassSchema),
  async (req, res) => {
    try {
      const { name, section, classTeacherId, subjects, academicYear, strengthLimit } = req.body;
      const validation = await ensureTeacherAvailable(
        classTeacherId,
        req.params.id,
        req.user?.schoolId
      );
      if (validation?.error) {
        return res.status(validation.error.status).json(validation.error.body);
      }

      const scopedCheck = await Class.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
      );
      if (!scopedCheck) {
        return res.status(404).json({ error: req.t('common:errors.classNotFound') });
      }

      const oldTeacherId = scopedCheck.classTeacherId;

      const updateData = { name, section, classTeacherId, subjects, academicYear };
      if (strengthLimit) {
        if (strengthLimit.current != null)
          updateData['strengthLimit.current'] = strengthLimit.current;
        if (strengthLimit.default != null)
          updateData['strengthLimit.default'] = strengthLimit.default;
      }

      const classDoc = await Class.findOneAndUpdate(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
        updateData,
        { new: true }
      );

      if (!classDoc) {
        return res.status(404).json({ error: req.t('common:errors.classNotFound') });
      }

      // Sync Staff records when classTeacherId changes via general update
      if (String(oldTeacherId || '') !== String(classTeacherId || '')) {
        await syncClassTeacherStaff({ oldTeacherId, newTeacherId: classTeacherId, classDoc });
      }

      const io = req.app.get('io');
      emitEvent(io, EVENTS.CLASS_UPDATED, {
        schoolId: req.user.schoolId?.toString(),
        classId: classDoc._id.toString(),
        name: classDoc.name,
        section: classDoc.section,
        classTeacherId: classDoc.classTeacherId,
      });

      const updatedDoc = classDoc.toObject();
      res.json({
        id: classDoc._id.toString(),
        ...updatedDoc,
        classTeacherId: updatedDoc.classTeacherId?.toString() || null,
        classTeacherName: validation?.teacher?.name || null,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

router.delete('/:id', authenticate, checkPermission('classes', 'delete'), async (req, res) => {
  try {
    const scopedCheck = await Class.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
    );
    if (!scopedCheck) {
      return res.status(404).json({ error: req.t('common:errors.classNotFound') });
    }

    const studentCount = await countActiveStudents(req.params.id, req.user?.schoolId);
    if (studentCount > 0) {
      return res.status(400).json({ error: 'Cannot delete class with active students' });
    }

    // Clear the teacher's staff record before deleting the class
    if (scopedCheck.classTeacherId) {
      await syncClassTeacherStaff({
        oldTeacherId: scopedCheck.classTeacherId,
        newTeacherId: null,
        classDoc: scopedCheck,
      });
    }

    const schoolId = req.user?.schoolId;
    const classId = req.params.id;

    // Soft-delete cascading related documents (standardized to soft-delete)
    const now = new Date();
    const softDelete = { $set: { isDeleted: true, deletedAt: now } };
    await Promise.all([
      Timetable.updateMany(
        scopeBySchool(schoolId, { classId, isDeleted: { $ne: true } }),
        softDelete
      ),
      Exam.updateMany(scopeBySchool(schoolId, { classId, isDeleted: { $ne: true } }), softDelete),
      Result.updateMany(scopeBySchool(schoolId, { classId, isDeleted: { $ne: true } }), softDelete),
      Attendance.updateMany(
        scopeBySchool(schoolId, { classId, isDeleted: { $ne: true } }),
        softDelete
      ),
      StudentFeeStructure.updateMany(
        scopeBySchool(schoolId, { classId, isDeleted: { $ne: true } }),
        softDelete
      ),
      ClassAnnouncement.updateMany(
        scopeBySchool(schoolId, { classId, isDeleted: { $ne: true } }),
        softDelete
      ),
      ChapterProgress.updateMany(
        scopeBySchool(schoolId, { classId, isDeleted: { $ne: true } }),
        softDelete
      ),
      ClassRating.updateMany(
        scopeBySchool(schoolId, { classId, isDeleted: { $ne: true } }),
        softDelete
      ),
      Homework.updateMany(
        scopeBySchool(schoolId, { classId, isDeleted: { $ne: true } }),
        softDelete
      ),
    ]);

    // Remove this class's periods from all teacher timetables
    const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    await Promise.all(
      DAYS.map((day) =>
        TeacherTimetable.updateMany(
          scopeBySchool(schoolId, { [`schedule.${day}.classId`]: classId }),
          { $pull: { [`schedule.${day}`]: { classId } } }
        )
      )
    );

    // Soft delete the class itself
    const classDoc = await Class.findOneAndUpdate(
      scopeBySchool(schoolId, { _id: classId }),
      { isDeleted: true, deletedAt: now },
      { new: true }
    );
    if (!classDoc) {
      return res.status(404).json({ error: req.t('common:errors.classNotFound') });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
