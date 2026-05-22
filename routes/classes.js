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
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';
import mongoose from 'mongoose';
import { logToTrash } from '../services/trashService.js';

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
  const schoolId = classDoc.schoolId;
  if (oldTeacherId && String(oldTeacherId) !== String(newTeacherId)) {
    await Staff.findOneAndUpdate(scopeBySchool(schoolId, { _id: oldTeacherId }), {
      classTeacherOf: null,
      isClassTeacher: false,
    });
  }

  if (newTeacherId) {
    await Staff.findOneAndUpdate(scopeBySchool(schoolId, { _id: newTeacherId }), {
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

router.get('/public', async (req, res) => {
  try {
    const schoolId = await resolveRequestSchoolId(req);
    const { academicYear = CURRENT_ACADEMIC_YEAR } = req.query;
    const classes = await Class.find(
      scopeBySchool(schoolId, { isDeleted: { $ne: true }, academicYear })
    ).sort({
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

router.get('/', checkPermission('classes', 'view'), async (req, res) => {
  try {
    const { academicYear = CURRENT_ACADEMIC_YEAR, teacherId } = req.query;
    const baseQuery = {};
    if (teacherId) {
      if (!mongoose.isValidObjectId(teacherId)) {
        return res.status(400).json({ error: 'Invalid teacherId format' });
      }
      baseQuery.classTeacherId = teacherId;
    }
    baseQuery.isDeleted = { $ne: true };
    baseQuery.academicYear = academicYear;
    const query = scopeBySchool(req.user?.schoolId, baseQuery);
    const classes = await Class.find(query)
      .populate('classTeacherId', 'name')
      .sort({ name: 1, section: 1 });

    // AUDIT-65: Bulk-fetch student counts instead of N+1 individual queries
    const classIds = classes.map((cls) => cls._id);
    const schoolIdRaw = extractSchoolId(req.user?.schoolId);
    const schoolOid = schoolIdRaw ? new mongoose.Types.ObjectId(schoolIdRaw) : null;
    const schoolMatch = schoolOid ? { schoolId: schoolOid } : {};

    // AUDIT-339: Bulk-fetch student counts, attendance, and academic performance in parallel
    const [studentCountAgg, attendanceAgg, academicAgg] = await Promise.all([
      Student.aggregate([
        {
          $match: {
            classId: { $in: classIds },
            status: 'active',
            isDeleted: { $ne: true },
            ...schoolMatch,
          },
        },
        { $group: { _id: '$classId', count: { $sum: 1 } } },
      ]),
      Attendance.aggregate([
        {
          $match: {
            classId: { $in: classIds },
            ...schoolMatch,
          },
        },
        {
          $group: {
            _id: '$classId',
            total: { $sum: 1 },
            present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
            late: { $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] } },
          },
        },
      ]),
      Result.aggregate([
        {
          $match: {
            classId: { $in: classIds },
            isDeleted: { $ne: true },
            isPublished: true,
            ...schoolMatch,
          },
        },
        {
          $group: {
            _id: '$classId',
            avgPercentage: { $avg: '$percentage' },
          },
        },
      ]),
    ]);

    const studentCountMap = new Map(
      studentCountAgg.map((item) => [item._id.toString(), item.count])
    );
    const attendanceMap = new Map(
      attendanceAgg.map((item) => [
        item._id.toString(),
        item.total > 0 ? Math.round(((item.present + item.late) / item.total) * 100) : null,
      ])
    );
    const academicMap = new Map(
      academicAgg.map((item) => [
        item._id.toString(),
        item.avgPercentage != null ? Math.round(item.avgPercentage) : 0,
      ])
    );

    const formatted = classes.map((cls) => ({
      id: cls._id.toString(),
      name: cls.name,
      section: cls.section,
      subjects: cls.subjects,
      classTeacherId: cls.classTeacherId?._id?.toString(),
      classTeacherName: cls.classTeacherId?.name,
      studentCount: studentCountMap.get(cls._id.toString()) || 0,
      averageAttendance: attendanceMap.get(cls._id.toString()) ?? null,
      averageAcademicPerformance: academicMap.get(cls._id.toString()) ?? 0,
      academicYear: cls.academicYear,
      strengthLimit: cls.strengthLimit,
      room: cls.room,
      block: cls.block,
      classTag: cls.classTag,
      assignedSubjects: cls.assignedSubjects,
    }));

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post(
  '/',
  checkPermission('classes', 'create'),
  validateZod(createClassSchema),
  async (req, res) => {
    try {
      const {
        name,
        section,
        classTeacherId,
        subjects,
        academicYear,
        strengthLimit,
        room,
        block,
        classTag,
        assignedSubjects,
      } = req.body;
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
        ...(room && { room }),
        ...(block && { block }),
        ...(classTag && { classTag }),
        ...(assignedSubjects?.length && { assignedSubjects }),
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
  checkPermission('classes', 'edit'),
  validateZod(updateClassTeacherSchema),
  async (req, res) => {
    try {
      const { classTeacherId, force } = req.body;
      const classDoc = await Class.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
      );
      if (!classDoc) {
        return res.status(404).json({ error: req.t('common:errors.classNotFound') });
      }

      let validation = await ensureTeacherAvailable(
        classTeacherId,
        req.params.id,
        req.user?.schoolId
      );
      if (validation?.error) {
        // If force=true, unassign the teacher from their current class first
        if (force && validation.error.body?.existingClass?.id) {
          const prevClassId = validation.error.body.existingClass.id;
          const prevClass = await Class.findById(prevClassId);
          if (prevClass) {
            const prevOldTeacherId = prevClass.classTeacherId;
            prevClass.classTeacherId = null;
            await prevClass.save();
            await syncClassTeacherStaff({
              oldTeacherId: prevOldTeacherId,
              newTeacherId: null,
              classDoc: prevClass,
            });

            // Emit update for the previous class so frontend clears it
            const io = req.app.get('io');
            if (io) {
              emitEvent(io, EVENTS.CLASS_UPDATED, {
                schoolId: req.user.schoolId?.toString(),
                classId: prevClass._id.toString(),
                name: prevClass.name,
                section: prevClass.section,
                classTeacherId: null,
                teacher: null,
                teacherPhoto: null,
              });
            }
          }
          // Re-validate — teacher is now available
          validation = await ensureTeacherAvailable(
            classTeacherId,
            req.params.id,
            req.user?.schoolId
          );
        } else {
          return res.status(validation.error.status).json(validation.error.body);
        }
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
          { schoolId: classDoc.schoolId, relatedId: classDoc._id, relatedType: 'Class' }
        ).catch((err) => console.error('Notification error (old teacher):', err));
      }
      if (classTeacherId) {
        sendNotification(
          classTeacherId,
          'Staff',
          'class_teacher',
          'Class Teacher Assigned',
          `You have been assigned as class teacher of ${className}.`,
          { schoolId: classDoc.schoolId, relatedId: classDoc._id, relatedType: 'Class' }
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
router.get('/:id/settings', checkPermission('classes', 'view'), async (req, res) => {
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
  checkPermission('classes', 'edit'),
  validateZod(updateClassSubjectsSchema),
  async (req, res) => {
    try {
      const { assignedSubjects } = req.body;

      // Get previous subjects before update to detect removals
      const prevClass = await Class.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
      );
      if (!prevClass) {
        return res.status(404).json({ error: req.t('common:errors.classNotFound') });
      }

      const prevSubjects = new Set(
        (prevClass.assignedSubjects || []).map((s) => (typeof s === 'string' ? s : s.name))
      );
      const newSubjects = new Set(
        assignedSubjects.map((s) => (typeof s === 'string' ? s : s.name))
      );
      const removedSubjects = [...prevSubjects].filter((s) => !newSubjects.has(s));

      const classDoc = await Class.findOneAndUpdate(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
        { assignedSubjects, subjects: assignedSubjects },
        { new: true, runValidators: true }
      );

      // Clean up timetable slots for removed subjects
      if (removedSubjects.length > 0) {
        try {
          const timetable = await Timetable.findOne(
            scopeBySchool(req.user?.schoolId, {
              classId: req.params.id,
              academicYear: CURRENT_ACADEMIC_YEAR,
              isDeleted: { $ne: true },
            })
          );
          if (timetable) {
            let modified = false;
            const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            for (const day of days) {
              if (!timetable.schedule[day]) continue;
              for (let i = 0; i < timetable.schedule[day].length; i++) {
                const slot = timetable.schedule[day][i];
                if (slot.subject && removedSubjects.includes(slot.subject)) {
                  timetable.schedule[day][i] = {
                    subject: '',
                    teacherId: null,
                    room: '',
                    lastModified: new Date(),
                    modifiedBy: req.user?.id,
                  };
                  modified = true;
                }
              }
            }
            if (modified) {
              timetable.version += 1;
              timetable.lastSyncedAt = new Date();
              await timetable.save();
            }
          }
        } catch (cleanupError) {
          console.error('Error cleaning timetable after subject removal:', cleanupError);
        }
      }

      res.json({
        success: true,
        classId: classDoc._id,
        subjects: classDoc.subjects,
        assignedSubjects: classDoc.assignedSubjects,
        removedSubjects: removedSubjects.length > 0 ? removedSubjects : undefined,
      });
    } catch (error) {
      console.error('Error updating class subjects:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// AUDIT-36: Added permission check
router.get('/:id/students', checkPermission('classes', 'view'), async (req, res) => {
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

router.get('/:id/next-roll-number', checkPermission('classes', 'view'), async (req, res) => {
  try {
    const rollNumber = await getNextRollNumber(req.params.id, req.user?.schoolId);
    res.json({ rollNumber });
  } catch (error) {
    console.error('Error getting next roll number:', error);
    res.status(500).json({ error: 'Failed to get next roll number' });
  }
});

router.get('/:id/capacity', checkPermission('classes', 'view'), async (req, res) => {
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
router.get('/:id', checkPermission('classes', 'view'), async (req, res) => {
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
      room: classDoc.room,
      block: classDoc.block,
      classTag: classDoc.classTag,
      assignedSubjects: classDoc.assignedSubjects,
      averageAttendance: classDoc.averageAttendance,
      rating: classDoc.rating,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put(
  '/:id',
  checkPermission('classes', 'edit'),
  validateZod(updateClassSchema),
  async (req, res) => {
    try {
      const {
        name,
        section,
        classTeacherId,
        subjects,
        assignedSubjects,
        academicYear,
        classTag,
        room,
        block,
        strengthLimit,
      } = req.body;
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

      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (section !== undefined) updateData.section = section;
      if (classTeacherId !== undefined) updateData.classTeacherId = classTeacherId;
      if (subjects !== undefined) updateData.subjects = subjects;
      if (assignedSubjects !== undefined) updateData.assignedSubjects = assignedSubjects;
      if (academicYear !== undefined) updateData.academicYear = academicYear;
      if (classTag !== undefined) updateData.classTag = classTag;
      if (room !== undefined) updateData.room = room;
      if (block !== undefined) updateData.block = block;
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

router.delete('/:id', checkPermission('classes', 'delete'), async (req, res) => {
  try {
    const scopedCheck = await Class.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
    );
    if (!scopedCheck) {
      return res.status(404).json({ error: req.t('common:errors.classNotFound') });
    }

    // Snapshot before mutation for trash logging
    const classSnapshot = scopedCheck.toObject();

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

    // Log to trash for restore capability
    logToTrash({
      itemType: 'Class',
      itemId: classDoc._id,
      itemName: classSnapshot.name || 'Class',
      originalData: classSnapshot,
      deletedBy: req.user?.id || req.user?._id,
      schoolId,
    }).catch(() => {});

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
