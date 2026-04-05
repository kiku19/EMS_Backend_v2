import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';
import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import {
  Class,
  Student,
  Staff,
  Attendance,
  Result,
  ActivityLog,
  ClassRating,
  ChapterProgress,
  ClassAnnouncement,
  Timetable,
  StudentFeeStructure,
} from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { validateZod } from '../middleware/validation.js';
import { promoteClassSchema, updateStrengthLimitSchema } from '../validators/index.js';
import {
  objectId,
  optionalObjectId,
  academicYear as academicYearZod,
} from '../validators/zodHelpers.js';
import { extractSchoolId } from '../utils/schoolContext.js';

// ─── ADD SUBJECT / CHAPTER PROGRESS TO CLASS ────────────────────
const addClassSubjectSchema = z
  .object({
    subjectName: z.string().min(1, 'Subject name is required').max(100).trim(),
    subjectId: optionalObjectId,
    teacherId: objectId,
    academicYear: academicYearZod.optional(),
    chapters: z
      .array(
        z.object({
          chapterName: z.string().min(1).max(200).trim(),
          chapterNumber: z.number().int().min(1),
          status: z.enum(['not_started', 'in_progress', 'completed']).default('not_started'),
          progressPercentage: z.number().min(0).max(100).default(0),
          startDate: z.string().datetime().optional().nullable(),
          completedDate: z.string().datetime().optional().nullable(),
          topics: z.array(z.string().max(200).trim()).optional().default([]),
        })
      )
      .optional()
      .default([]),
    assignedStudents: z.array(objectId).optional().default([]),
  })
  .strip();

const updateClassSubjectSchema = z
  .object({
    subjectName: z.string().min(1, 'Subject name is required').max(100).trim().optional(),
    teacherId: objectId.optional(),
    chapters: z
      .array(
        z.object({
          chapterName: z.string().min(1).max(200).trim(),
          chapterNumber: z.number().int().min(1),
          status: z.enum(['not_started', 'in_progress', 'completed']).default('not_started'),
          progressPercentage: z.number().min(0).max(100).default(0),
          startDate: z.string().datetime().optional().nullable(),
          completedDate: z.string().datetime().optional().nullable(),
          topics: z.array(z.string().max(200).trim()).optional().default([]),
        })
      )
      .optional(),
    assignedStudents: z.array(objectId).optional(),
  })
  .strip();

const createAnnouncementSchema = z
  .object({
    title: z.string().min(1, 'Title is required').max(200).trim(),
    description: z.string().min(1, 'Content/description is required').max(5000).trim(),
    targetAudience: z.string().max(50).optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
    attachments: z.array(z.string().url()).optional().default([]),
    scheduledFor: z.string().datetime().optional().nullable(),
  })
  .strip();

const createActivityLogSchema = z
  .object({
    activityType: z.string().min(1, 'Activity type is required').max(100).trim(),
    description: z.string().min(1, 'Description is required').max(1000).trim(),
    details: z.record(z.string(), z.unknown()).optional().default({}),
  })
  .strip();

const router = express.Router();
router.use(authenticate);

function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) throw new Error('schoolId is required for scoped queries');
  return { ...query, schoolId: normalizedSchoolId };
}

// ============ MISSING SUBJECTS ENDPOINT ============
// NOTE: This static route MUST be registered BEFORE any /:id routes
// otherwise Express will match "missing-subjects" as an :id param.

// Get classes with missing subjects
router.get(
  '/missing-subjects',
  checkPermission('classes', 'view'),
  async (req, res) => {
    try {
      const schoolId = req.user?.schoolId;
      // Get all classes for this school
      const classes = await Class.find(scopeBySchool(schoolId, { isDeleted: { $ne: true } })).sort({
        name: 1,
        section: 1,
      });

      const missingSubjects = [];

      for (const cls of classes) {
        // Check if class has no subjects or empty subjects array
        if (!cls.subjects || cls.subjects.length === 0) {
          missingSubjects.push({
            classId: cls._id,
            className: `${cls.name}-${cls.section}`,
            subjectsCount: 0,
            hasSubjects: false,
          });
        }
      }

      res.json({
        totalClasses: classes.length,
        classesWithMissingSubjects: missingSubjects.length,
        missingSubjects,
      });
    } catch (error) {
      console.error('Error fetching missing subjects:', error);
      res.status(500).json({ error: 'Failed to fetch missing subjects' });
    }
  }
);

// ============ ACADEMIC PERFORMANCE ENDPOINTS ============

// Get academic performance for a class
router.get(
  '/:id/academic-performance',
  checkPermission('classes', 'view'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { academicYear = CURRENT_ACADEMIC_YEAR } = req.query;

      const schoolId = req.user?.schoolId;

      // Use aggregation pipeline to compute per-student academic performance in MongoDB
      const studentPerformance = await Student.aggregate([
        {
          $match: {
            schoolId,
            classId: new mongoose.Types.ObjectId(id),
            academicYear,
            status: 'active',
            isDeleted: { $ne: true },
          },
        },
        {
          $lookup: {
            from: 'results',
            let: { sid: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ['$studentId', '$$sid'] },
                  schoolId,
                  academicYear,
                },
              },
              {
                $group: {
                  _id: null,
                  avgPercentage: { $avg: { $ifNull: ['$percentage', 0] } },
                  count: { $sum: 1 },
                },
              },
            ],
            as: 'resultStats',
          },
        },
        { $unwind: { path: '$resultStats', preserveNullAndEmptyArrays: true } },
        { $match: { 'resultStats.count': { $gt: 0 } } },
        {
          $project: {
            studentId: '$_id',
            studentName: '$name',
            rollNo: '$rollNo',
            averagePercentage: { $round: [{ $ifNull: ['$resultStats.avgPercentage', 0] }, 1] },
          },
        },
        { $sort: { averagePercentage: -1 } },
      ]);

      const resultCount = studentPerformance.length;
      const classAverage =
        resultCount > 0
          ? Math.round(
              (studentPerformance.reduce((sum, s) => sum + s.averagePercentage, 0) / resultCount) * 10
            ) / 10
          : 0;

      res.json({
        classId: id,
        academicYear,
        classAverage,
        topPerformers: studentPerformance.slice(0, 5),
        needImprovement: studentPerformance.slice(-5).reverse(),
        totalStudentsEvaluated: resultCount,
      });
    } catch (error) {
      console.error('Error fetching academic performance:', error);
      res.status(500).json({ error: 'Failed to fetch academic performance' });
    }
  }
);

// Recalculate academic performance
router.post(
  '/:id/academic-performance/recalculate',
  checkPermission('classes', 'edit'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const schoolId = req.user?.schoolId;
      const classData = await Class.findOne(
        scopeBySchool(schoolId, { _id: id, isDeleted: { $ne: true } })
      );
      if (!classData) {
        return res.status(404).json({ error: req.t('common:errors.classNotFound') });
      }

      const normalizedSchoolId = extractSchoolId(schoolId);
      const matchFilter = { classId: classData._id, academicYear: classData.academicYear };
      if (normalizedSchoolId) matchFilter.schoolId = normalizedSchoolId;

      const performance = await Result.aggregate([
        {
          $match: matchFilter,
        },
        {
          $group: {
            _id: '$studentId',
            avgPercentage: { $avg: '$percentage' },
          },
        },
        {
          $group: {
            _id: null,
            classAverage: { $avg: '$avgPercentage' },
          },
        },
      ]);

      const classAverage = performance.length > 0 ? Math.round(performance[0].classAverage) : 0;

      await Class.findOneAndUpdate(scopeBySchool(schoolId, { _id: id }), {
        averageAcademicPerformance: classAverage,
      });

      res.json({ success: true, classAverage });
    } catch (error) {
      console.error('Error recalculating academic performance:', error);
      res.status(500).json({ error: 'Failed to recalculate academic performance' });
    }
  }
);

// ============ ACTIVITY LOG ENDPOINTS ============

// Get activity log for a class
router.get(
  '/:id/activity-log',
  checkPermission('classes', 'view'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { limit = 50, activityType, startDate, endDate } = req.query;

      const schoolId = req.user?.schoolId;
      const query = scopeBySchool(schoolId, { classId: id });
      if (activityType) query.activityType = activityType;
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      const activities = await ActivityLog.find(query)
        .populate('performedBy', 'name code')
        .sort({ createdAt: -1 })
        .limit(parseInt(limit));

      res.json(activities);
    } catch (error) {
      console.error('Error fetching activity log:', error);
      res.status(500).json({ error: 'Failed to fetch activity log' });
    }
  }
);

// Create activity log entry
router.post(
  '/:id/activity-log',
  checkPermission('classes', 'edit'),
  validateZod(createActivityLogSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const schoolId = req.user?.schoolId;
      const { activityType, description, details } = req.body;
      const performedBy = req.user?.id; // From authenticate middleware

      // Verify class belongs to this school
      const classDoc = await Class.findOne(
        scopeBySchool(schoolId, { _id: id, isDeleted: { $ne: true } })
      );
      if (!classDoc) {
        return res.status(404).json({ error: req.t('common:errors.classNotFound') });
      }

      const activity = await ActivityLog.create({
        classId: id,
        schoolId: extractSchoolId(schoolId),
        activityType,
        description,
        performedBy,
        details: details || {},
      });

      await activity.populate('performedBy', 'name code');
      res.status(201).json(activity);
    } catch (error) {
      console.error('Error creating activity log:', error);
      res.status(500).json({ error: 'Failed to create activity log entry' });
    }
  }
);

// ============ CLASS RATING ENDPOINTS ============

// Get class rating
router.get('/:id/rating', checkPermission('classes', 'view'), async (req, res) => {
  try {
    const { id } = req.params;
    const { academicYear = CURRENT_ACADEMIC_YEAR } = req.query;

    const schoolId = req.user?.schoolId;
    // Verify class belongs to this school
    const classDoc = await Class.findOne(
      scopeBySchool(schoolId, { _id: id, isDeleted: { $ne: true } })
    );
    if (!classDoc) {
      return res.status(404).json({ error: req.t('common:errors.classNotFound') });
    }

    let rating = await ClassRating.findOne(scopeBySchool(schoolId, { classId: id, academicYear }));
    if (!rating) {
      rating = await ClassRating.create({
        classId: id,
        academicYear,
        schoolId: extractSchoolId(schoolId),
      });
    }

    res.json(rating);
  } catch (error) {
    console.error('Error fetching class rating:', error);
    res.status(500).json({ error: 'Failed to fetch class rating' });
  }
});

// Recalculate class rating
router.post('/:id/rating/recalculate', checkPermission('classes', 'edit'), async (req, res) => {
  try {
    const { id } = req.params;
    const { academicYear = CURRENT_ACADEMIC_YEAR } = req.body;

    const schoolId = req.user?.schoolId;
    const classData = await Class.findOne(
      scopeBySchool(schoolId, { _id: id, isDeleted: { $ne: true } })
    );
    if (!classData) {
      return res.status(404).json({ error: req.t('common:errors.classNotFound') });
    }

    let rating = await ClassRating.findOne(scopeBySchool(schoolId, { classId: id, academicYear }));
    if (!rating) {
      rating = new ClassRating({ classId: id, academicYear, schoolId: extractSchoolId(schoolId) });
    }

    // Calculate attendance score (30% weight)
    const attendanceMatchFilter = { classId: classData._id, academicYear };
    const normalizedSchoolId = extractSchoolId(schoolId);
    if (normalizedSchoolId) attendanceMatchFilter.schoolId = normalizedSchoolId;

    const attendanceData = await Attendance.aggregate([
      {
        $match: attendanceMatchFilter,
      },
      {
        $group: {
          _id: '$studentId',
          presentCount: {
            $sum: { $cond: [{ $in: ['$status', ['present', 'late']] }, 1, 0] },
          },
          totalCount: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: null,
          avgAttendance: {
            $avg: {
              $multiply: [{ $divide: ['$presentCount', '$totalCount'] }, 100],
            },
          },
        },
      },
    ]);

    rating.attendanceScore =
      attendanceData.length > 0 ? Math.round(attendanceData[0].avgAttendance) : 70;

    // Calculate academic score (40% weight)
    rating.academicScore = classData.averageAcademicPerformance || 70;

    // Behavior score - based on remarks (20% weight)
    // For now, using a default value - can be enhanced later
    rating.behaviorScore = 70;

    // Fee score - based on fee compliance (10% weight)
    const students = await Student.find(
      scopeBySchool(schoolId, { classId: id, status: 'active', isDeleted: { $ne: true } })
    );
    const paidStudents = students.filter((s) => s.feeStatus === 'paid').length;
    rating.feeScore = students.length > 0 ? Math.round((paidStudents / students.length) * 100) : 70;

    // Calculate overall rating
    rating.calculateOverallRating();
    rating.lastCalculated = new Date();
    rating.calculatedBy = req.user?.id;

    // Add to history
    rating.ratingHistory.push({
      date: new Date(),
      rating: rating.rating,
      attendanceScore: rating.attendanceScore,
      academicScore: rating.academicScore,
      behaviorScore: rating.behaviorScore,
      feeScore: rating.feeScore,
    });

    await rating.save();

    // Update class with new rating
    classData.rating = rating.rating;
    await classData.save();

    res.json(rating);
  } catch (error) {
    console.error('Error recalculating class rating:', error);
    res.status(500).json({ error: 'Failed to recalculate class rating' });
  }
});

// ============ ATTENDANCE ANALYTICS ENDPOINTS ============

// Get attendance analytics for a class
router.get(
  '/:id/attendance-analytics',
  checkPermission('classes', 'view'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const schoolId = req.user?.schoolId;
      const { period = 'month' } = req.query; // week, month, term

      // Calculate date range based on period
      const now = new Date();
      const startDate = new Date();
      if (period === 'week') {
        startDate.setDate(now.getDate() - 7);
      } else if (period === 'month') {
        startDate.setMonth(now.getMonth() - 1);
      } else if (period === 'term') {
        startDate.setMonth(now.getMonth() - 3);
      }

      // Use aggregation pipeline to compute per-student attendance stats in MongoDB
      const studentAttendance = await Student.aggregate([
        { $match: { schoolId, classId: new mongoose.Types.ObjectId(id), status: 'active', isDeleted: { $ne: true } } },
        {
          $lookup: {
            from: 'attendances',
            let: { sid: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ['$studentId', '$$sid'] },
                  schoolId,
                  date: { $gte: startDate.toISOString().split('T')[0] },
                },
              },
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  presentFull: { $sum: { $cond: [{ $in: ['$status', ['present', 'late']] }, 1, 0] } },
                  halfday: { $sum: { $cond: [{ $eq: ['$status', 'halfday'] }, 1, 0] } },
                },
              },
            ],
            as: 'attStats',
          },
        },
        { $unwind: { path: '$attStats', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            studentId: '$_id',
            studentName: '$name',
            rollNo: '$rollNo',
            total: { $ifNull: ['$attStats.total', 0] },
            present: { $add: [{ $ifNull: ['$attStats.presentFull', 0] }, { $multiply: [{ $ifNull: ['$attStats.halfday', 0] }, 0.5] }] },
          },
        },
        {
          $addFields: {
            absent: { $subtract: ['$total', '$present'] },
            percentage: {
              $cond: [{ $gt: ['$total', 0] }, { $round: [{ $multiply: [{ $divide: ['$present', '$total'] }, 100] }, 0] }, 0],
            },
          },
        },
        { $sort: { percentage: -1 } },
      ]);

      const classAverage =
        studentAttendance.length > 0
          ? Math.round(studentAttendance.reduce((sum, s) => sum + s.percentage, 0) / studentAttendance.length)
          : 0;

      res.json({
        mostAttentive: studentAttendance.slice(0, 5),
        lessAttentive: studentAttendance.slice(-5).reverse(),
        classAverage,
      });
    } catch (error) {
      console.error('Error fetching attendance analytics:', error);
      res.status(500).json({ error: 'Failed to fetch attendance analytics' });
    }
  }
);

// Get chronic absentees
router.get(
  '/:id/chronic-absentees',
  checkPermission('classes', 'view'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const schoolId = req.user?.schoolId;
      const { threshold = 60 } = req.query;

      const students = await Student.find(
        scopeBySchool(schoolId, { classId: id, status: 'active', isDeleted: { $ne: true } })
      );
      const studentIds = students.map((s) => s._id);

      // Get last 30 days attendance
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const attendance = await Attendance.find(
        scopeBySchool(schoolId, {
          studentId: { $in: studentIds },
          date: { $gte: thirtyDaysAgo.toISOString().split('T')[0] },
        })
      );

      const chronicAbsentees = [];

      for (const student of students) {
        const studentAtt = attendance.filter(
          (a) => a.studentId.toString() === student._id.toString()
        );
        const present = studentAtt.filter(
          (a) => a.status === 'present' || a.status === 'late'
        ).length + studentAtt.filter((a) => a.status === 'halfday').length * 0.5;
        const total = studentAtt.length;
        const percentage = total > 0 ? Math.round((present / total) * 100) : 0;

        if (percentage < threshold && total >= 10) {
          // Mask parent PII — only show last 4 digits of phone and domain-masked email
          const maskedPhone = student.parentPhone ? '****' + student.parentPhone.slice(-4) : null;
          const maskedEmail = student.parentEmail
            ? student.parentEmail.replace(/^(.{2})(.*)(@.*)$/, '$1***$3')
            : null;
          chronicAbsentees.push({
            studentId: student._id,
            studentName: student.name,
            rollNo: student.rollNo,
            percentage,
            parentPhone: maskedPhone,
            parentEmail: maskedEmail,
            hasParentContact: Boolean(student.parentPhone || student.parentEmail),
          });
        }
      }

      res.json(chronicAbsentees);
    } catch (error) {
      console.error('Error fetching chronic absentees:', error);
      res.status(500).json({ error: 'Failed to fetch chronic absentees' });
    }
  }
);

// ============ TODAY'S STATUS ENDPOINT ============

// Get today's status for a class
router.get(
  '/:id/today-status',
  checkPermission('classes', 'view'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const schoolId = req.user?.schoolId;
      const today = new Date().toISOString().split('T')[0];

      // Get today's attendance
      const students = await Student.find(
        scopeBySchool(schoolId, { classId: id, status: 'active', isDeleted: { $ne: true } })
      );
      const studentIds = students.map((s) => s._id);

      const todayAttendance = await Attendance.find(
        scopeBySchool(schoolId, {
          studentId: { $in: studentIds },
          date: today,
        })
      );

      const present = todayAttendance.filter(
        (a) => a.status === 'present' || a.status === 'late'
      ).length + todayAttendance.filter((a) => a.status === 'halfday').length * 0.5;
      const absent = todayAttendance.filter((a) => a.status === 'absent').length;

      // Get timetable
      const timetable = await Timetable.findOne(
        scopeBySchool(schoolId, { classId: id, academicYear: CURRENT_ACADEMIC_YEAR })
      );
      const timezone = req.query.timezone || 'Asia/Kolkata';
      const todayDay = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        timeZone: timezone,
      });

      let currentClass = null;
      let upcomingClass = null;

      if (timetable && timetable.schedule && timetable.schedule[todayDay]) {
        const now = new Date();
        const timeParts = new Intl.DateTimeFormat('en-US', {
          hour: 'numeric',
          minute: 'numeric',
          hour12: false,
          timeZone: timezone,
        }).formatToParts(now);
        const currentTime =
          parseInt(timeParts.find((p) => p.type === 'hour').value) * 60 +
          parseInt(timeParts.find((p) => p.type === 'minute').value);

        const schedule = timetable.schedule[todayDay];
        const periods = timetable.periods || [];

        for (let i = 0; i < schedule.length; i++) {
          if (schedule[i] && periods[i] && !periods[i].isBreak) {
            const [startH, startM] = periods[i].startTime.split(':').map(Number);
            const periodStartMinutes = startH * 60 + (startM || 0);

            let periodEndMinutes = null;
            if (periods[i].endTime) {
              const [endH, endM] = periods[i].endTime.split(':').map(Number);
              periodEndMinutes = endH * 60 + (endM || 0);
            }

            if (currentTime >= periodStartMinutes && (periodEndMinutes === null || currentTime < periodEndMinutes)) {
              currentClass = {
                period: periods[i].name,
                subject: schedule[i].subject,
                teacherId: schedule[i].teacherId,
              };
            } else if (currentTime < periodStartMinutes && !upcomingClass) {
              upcomingClass = {
                period: periods[i].name,
                subject: schedule[i].subject,
                teacherId: schedule[i].teacherId,
                time: periods[i].startTime,
              };
            }
          }
        }
      }

      res.json({
        date: today,
        attendance: {
          total: students.length,
          present,
          absent,
          percentage: students.length > 0 ? Math.round((present / students.length) * 100) : 0,
        },
        currentClass,
        upcomingClass,
      });
    } catch (error) {
      console.error('Error fetching today status:', error);
      res.status(500).json({ error: 'Failed to fetch today status' });
    }
  }
);

// ============ PROMOTION ENDPOINT ============

// Promote class to next grade
router.post(
  '/:id/promote',
  checkPermission('classes', 'edit'),
  validateZod(promoteClassSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const schoolId = req.user?.schoolId;
      const {
        targetClassId,
        academicYear = CURRENT_ACADEMIC_YEAR,
        skipFeeCheck = false,
        skipAttendanceCheck = false,
      } = req.body;

      const currentClass = await Class.findOne(
        scopeBySchool(schoolId, { _id: id, isDeleted: { $ne: true } })
      );
      if (!currentClass) {
        return res.status(404).json({ error: req.t('common:errors.classNotFound') });
      }

      // Validate target class exists and belongs to the same school
      const targetClass = await Class.findOne(
        scopeBySchool(schoolId, { _id: targetClassId, isDeleted: { $ne: true } })
      );
      if (!targetClass) {
        return res.status(400).json({ error: 'Target class not found in your school' });
      }

      const students = await Student.find(
        scopeBySchool(schoolId, { classId: id, status: 'active', isDeleted: { $ne: true } })
      );

      const promotionResults = {
        promoted: [],
        notPromoted: [],
        errors: [],
      };

      // Batch-fetch attendance stats upfront to avoid N+1 queries per student
      let attendanceMap = new Map(); // studentId -> { present, total }
      if (!skipAttendanceCheck) {
        const normalizedSchoolId = extractSchoolId(schoolId);
        const studentIds = students.map((s) => s._id);
        const attendanceAgg = await Attendance.aggregate([
          {
            $match: {
              studentId: { $in: studentIds },
              classId: currentClass._id,
              ...(normalizedSchoolId ? { schoolId: normalizedSchoolId } : {}),
            },
          },
          {
            $group: {
              _id: '$studentId',
              total: { $sum: 1 },
              present: {
                $sum: { $cond: [{ $in: ['$status', ['present', 'late']] }, 1, 0] },
              },
              halfday: {
                $sum: { $cond: [{ $eq: ['$status', 'halfday'] }, 1, 0] },
              },
            },
          },
        ]);
        attendanceAgg.forEach((a) => {
          attendanceMap.set(a._id.toString(), {
            present: a.present + a.halfday * 0.5,
            total: a.total,
          });
        });
      }

      // Determine which students are eligible for promotion
      const eligible = [];
      for (const student of students) {
        // Check fee status (skip if override requested)
        if (!skipFeeCheck && student.feeStatus === 'pending') {
          promotionResults.notPromoted.push({
            studentId: student._id,
            studentName: student.name,
            reason: 'Fee pending',
          });
          continue;
        }

        // Check attendance using pre-fetched data (should be above 60%)
        if (!skipAttendanceCheck) {
          const att = attendanceMap.get(student._id.toString());
          const attendancePercent =
            att && att.total > 0 ? (att.present / att.total) * 100 : 0;

          if (attendancePercent < 60) {
            promotionResults.notPromoted.push({
              studentId: student._id,
              studentName: student.name,
              reason: 'Low attendance',
            });
            continue;
          }
        }

        eligible.push(student);
      }

      // Bulk update eligible students using bulkWrite for atomicity
      if (eligible.length > 0) {
        const bulkOps = eligible.map((student) => ({
          updateOne: {
            filter: scopeBySchool(schoolId, { _id: student._id, classId: id }),
            update: {
              $set: {
                classId: targetClassId,
                academicYear,
                feeStatus: 'pending',
                feeDetails: {
                  totalFee: 0,
                  paidAmount: 0,
                  balanceAmount: 0,
                  discountApplied: 0,
                  lastPaymentDate: null,
                },
              },
            },
          },
        }));

        const bulkResult = await Student.bulkWrite(bulkOps, { ordered: false });

        // Soft-delete old fee structures in bulk
        const eligibleIds = eligible.map((s) => s._id);
        await StudentFeeStructure.updateMany(
          scopeBySchool(schoolId, {
            studentId: { $in: eligibleIds },
            academicYear: currentClass.academicYear || CURRENT_ACADEMIC_YEAR,
          }),
          { $set: { isDeleted: true, deletedAt: new Date() } }
        );

        // Log activity in bulk
        const activityDocs = eligible.map((student) => ({
          classId: id,
          schoolId: extractSchoolId(schoolId),
          activityType: 'class_promoted',
          description: `Student ${student.name} promoted from ${currentClass.name}-${currentClass.section} to ${targetClass.name}-${targetClass.section}`,
          performedBy: req.user?.id,
          details: {
            studentId: student._id,
            fromClass: id,
            toClass: targetClassId,
            academicYear,
          },
        }));
        await ActivityLog.insertMany(activityDocs);

        // Mark promoted (matched count tells us which succeeded)
        eligible.forEach((student) => {
          promotionResults.promoted.push({
            studentId: student._id,
            studentName: student.name,
          });
        });
      }

      res.json({
        success: true,
        summary: {
          total: students.length,
          promoted: promotionResults.promoted.length,
          notPromoted: promotionResults.notPromoted.length,
          errors: promotionResults.errors.length,
        },
        details: promotionResults,
      });
    } catch (error) {
      console.error('Error promoting class:', error);
      res.status(500).json({ error: 'Failed to promote class' });
    }
  }
);

// ============ CHAPTERS & SUBJECTS ENDPOINTS ============

// Get chapters for a class
router.get('/:id/subjects', checkPermission('classes', 'view'), async (req, res) => {
  try {
    const { id } = req.params;
    const schoolId = req.user?.schoolId;
    const { academicYear = CURRENT_ACADEMIC_YEAR } = req.query;

    // Verify class belongs to this school
    const classDoc = await Class.findOne(
      scopeBySchool(schoolId, { _id: id, isDeleted: { $ne: true } })
    );
    if (!classDoc) {
      return res.status(404).json({ error: req.t('common:errors.classNotFound') });
    }

    const chapters = await ChapterProgress.find(
      scopeBySchool(schoolId, {
        classId: id,
        academicYear,
      })
    ).populate('teacherId', 'name code');

    res.json(chapters);
  } catch (error) {
    console.error('Error fetching chapters:', error);
    res.status(500).json({ error: 'Failed to fetch chapters' });
  }
});

// Add chapter/subject to class
router.post(
  '/:id/subjects',
  checkPermission('classes', 'edit'),
  validateZod(addClassSubjectSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const schoolId = req.user?.schoolId;
      const { subjectName, subjectId, teacherId, chapters, assignedStudents } = req.body;
      const { academicYear = CURRENT_ACADEMIC_YEAR } = req.body;

      // Verify class belongs to this school BEFORE creating any documents
      const classData = await Class.findOne(
        scopeBySchool(schoolId, { _id: id, isDeleted: { $ne: true } })
      );
      if (!classData) {
        return res.status(404).json({ error: req.t('common:errors.classNotFound') });
      }

      const chapterProgress = await ChapterProgress.create({
        classId: id,
        schoolId: extractSchoolId(schoolId),
        subjectId,
        subjectName,
        teacherId,
        academicYear,
        chapters: chapters || [],
        assignedStudents: assignedStudents || [],
      });

      // Update class subjects list
      if (!classData.subjects.includes(subjectName)) {
        classData.subjects.push(subjectName);
        await classData.save();
      }

      // Log activity
      await ActivityLog.create({
        classId: id,
        schoolId: extractSchoolId(schoolId),
        activityType: 'subject_assigned',
        description: `Subject ${subjectName} assigned to teacher`,
        performedBy: req.user?.id,
        details: { subjectName, teacherId },
      });

      res.status(201).json(chapterProgress);
    } catch (error) {
      console.error('Error adding subject:', error);
      res.status(500).json({ error: 'Failed to add subject' });
    }
  }
);

// Update a subject (ChapterProgress) for a class
router.put(
  '/:id/subjects/:subjectProgressId',
  checkPermission('classes', 'edit'),
  validateZod(updateClassSubjectSchema),
  async (req, res) => {
    try {
      const { id, subjectProgressId } = req.params;
      const schoolId = req.user?.schoolId;

      // Verify class belongs to this school
      const classData = await Class.findOne(
        scopeBySchool(schoolId, { _id: id, isDeleted: { $ne: true } })
      );
      if (!classData) {
        return res.status(404).json({ error: req.t('common:errors.classNotFound') });
      }

      // Verify subject progress belongs to this class and school
      const existing = await ChapterProgress.findOne(
        scopeBySchool(schoolId, { _id: subjectProgressId, classId: id })
      );
      if (!existing) {
        return res.status(404).json({ error: 'Subject progress not found for this class' });
      }

      const { subjectName, teacherId, chapters, assignedStudents } = req.body;
      const oldSubjectName = existing.subjectName;

      if (subjectName !== undefined) existing.subjectName = subjectName;
      if (teacherId !== undefined) existing.teacherId = teacherId;
      if (chapters !== undefined) existing.chapters = chapters;
      if (assignedStudents !== undefined) existing.assignedStudents = assignedStudents;

      if (existing.calculateOverallProgress) {
        existing.calculateOverallProgress();
      }
      await existing.save();

      // If subject name changed, update the class subjects list
      if (subjectName && subjectName !== oldSubjectName) {
        const idx = classData.subjects.indexOf(oldSubjectName);
        if (idx !== -1) {
          classData.subjects[idx] = subjectName;
        } else if (!classData.subjects.includes(subjectName)) {
          classData.subjects.push(subjectName);
        }
        await classData.save();
      }

      // Log activity
      await ActivityLog.create({
        classId: id,
        schoolId: extractSchoolId(schoolId),
        activityType: 'subject_updated',
        description: `Subject ${existing.subjectName} updated`,
        performedBy: req.user?.id,
        details: { subjectProgressId, subjectName: existing.subjectName },
      });

      res.json(existing);
    } catch (error) {
      console.error('Error updating subject:', error);
      res.status(500).json({ error: 'Failed to update subject' });
    }
  }
);

// Delete a subject (ChapterProgress) from a class
router.delete(
  '/:id/subjects/:subjectProgressId',
  checkPermission('classes', 'delete'),
  async (req, res) => {
    try {
      const { id, subjectProgressId } = req.params;
      const schoolId = req.user?.schoolId;

      // Verify class belongs to this school
      const classData = await Class.findOne(
        scopeBySchool(schoolId, { _id: id, isDeleted: { $ne: true } })
      );
      if (!classData) {
        return res.status(404).json({ error: req.t('common:errors.classNotFound') });
      }

      // Verify subject progress belongs to this class and school
      const existing = await ChapterProgress.findOne(
        scopeBySchool(schoolId, { _id: subjectProgressId, classId: id })
      );
      if (!existing) {
        return res.status(404).json({ error: 'Subject progress not found for this class' });
      }

      const deletedSubjectName = existing.subjectName;
      await ChapterProgress.updateOne({ _id: subjectProgressId }, { $set: { isDeleted: true, deletedAt: new Date() } });

      // Check if any other active ChapterProgress references this subject for the same class
      const otherRefs = await ChapterProgress.countDocuments(
        scopeBySchool(schoolId, { classId: id, subjectName: deletedSubjectName, isDeleted: { $ne: true } })
      );
      // If no other references remain, remove from class subjects list
      if (otherRefs === 0) {
        classData.subjects = classData.subjects.filter((s) => s !== deletedSubjectName);
        await classData.save();
      }

      // Log activity
      await ActivityLog.create({
        classId: id,
        schoolId: extractSchoolId(schoolId),
        activityType: 'subject_removed',
        description: `Subject ${deletedSubjectName} removed from class`,
        performedBy: req.user?.id,
        details: { subjectProgressId, subjectName: deletedSubjectName },
      });

      res.json({ success: true, message: `Subject "${deletedSubjectName}" removed from class` });
    } catch (error) {
      console.error('Error deleting subject:', error);
      res.status(500).json({ error: 'Failed to delete subject' });
    }
  }
);

// Update chapter progress
router.put(
  '/chapters/:chapterId',
  checkPermission('classes', 'edit'),
  async (req, res) => {
    try {
      const { chapterId } = req.params;
      const schoolId = req.user?.schoolId;
      const { chapters, status, completedDate, notes } = req.body;

      // Verify chapter belongs to this school
      const existing = await ChapterProgress.findOne(scopeBySchool(schoolId, { _id: chapterId }));
      if (!existing) {
        return res.status(404).json({ error: 'Chapter progress not found' });
      }

      // Support both bulk update (chapters array) and individual chapter update
      if (chapters && Array.isArray(chapters)) {
        existing.chapters = chapters;
        existing.calculateOverallProgress();
        await existing.save();

        res.json(existing);
      } else if (status || completedDate || notes) {
        if (status) existing.status = status;
        if (completedDate) existing.completedDate = completedDate;
        if (notes) existing.notes = notes;
        await existing.save();

        res.json(existing);
      } else {
        return res.status(400).json({ error: 'No valid update data provided' });
      }
    } catch (error) {
      console.error('Error updating chapter progress:', error);
      res.status(500).json({ error: 'Failed to update chapter progress' });
    }
  }
);

// ============ STRENGTH LIMIT ENDPOINT ============

// Adjust class strength limit
router.put(
  '/:id/strength-limit',
  checkPermission('classes', 'edit'),
  validateZod(updateStrengthLimitSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const schoolId = req.user?.schoolId;
      const { newLimit, reason, approvedBy } = req.body;

      const classData = await Class.findOne(
        scopeBySchool(schoolId, { _id: id, isDeleted: { $ne: true } })
      );
      if (!classData) {
        return res.status(404).json({ error: req.t('common:errors.classNotFound') });
      }

      classData.strengthLimit.current = newLimit;
      classData.strengthLimit.adjustments.push({
        newLimit,
        reason,
        approvedBy: approvedBy || req.user?.id,
        date: new Date(),
      });

      await classData.save();

      // Log activity
      await ActivityLog.create({
        classId: id,
        schoolId: extractSchoolId(schoolId),
        activityType: 'strength_changed',
        description: `Class strength limit adjusted to ${newLimit}`,
        performedBy: req.user?.id,
        details: { oldLimit: classData.strengthLimit.default, newLimit, reason },
      });

      res.json({
        success: true,
        currentLimit: classData.strengthLimit.current,
      });
    } catch (error) {
      console.error('Error adjusting strength limit:', error);
      res.status(500).json({ error: 'Failed to adjust strength limit' });
    }
  }
);

// ============ ANNOUNCEMENTS ENDPOINT ============

// Send announcement to class
router.post(
  '/:id/announcements',
  checkPermission('classes', 'edit'),
  validateZod(createAnnouncementSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const schoolId = req.user?.schoolId;
      const { title, description, targetAudience, priority, attachments, scheduledFor } = req.body;

      // Verify class belongs to this school
      const classDoc = await Class.findOne(
        scopeBySchool(schoolId, { _id: id, isDeleted: { $ne: true } })
      );
      if (!classDoc) {
        return res.status(404).json({ error: req.t('common:errors.classNotFound') });
      }

      // Get all students in class
      const students = await Student.find(
        scopeBySchool(schoolId, { classId: id, status: 'active', isDeleted: { $ne: true } })
      );

      const announcement = await ClassAnnouncement.create({
        classId: id,
        schoolId: extractSchoolId(schoolId),
        title,
        description,
        targetAudience,
        priority: priority || 'normal',
        attachments: attachments || [],
        scheduledFor,
        sentAt: scheduledFor ? undefined : new Date(),
        sentBy: req.user?.id,
        deliveryStatus: {
          total: students.length,
          sent: 0,
          delivered: 0,
          read: 0,
        },
        recipients: students.map((s) => ({
          studentId: s._id,
          status: 'pending',
        })),
      });

      // Log activity
      await ActivityLog.create({
        classId: id,
        schoolId: extractSchoolId(schoolId),
        activityType: 'announcement_sent',
        description: `Announcement "${title}" sent to class`,
        performedBy: req.user?.id,
        details: { announcementId: announcement._id, targetAudience, priority },
      });

      res.status(201).json(announcement);
    } catch (error) {
      console.error('Error sending announcement:', error);
      res.status(500).json({ error: 'Failed to send announcement' });
    }
  }
);

// Get announcements for class
router.get(
  '/:id/announcements',
  checkPermission('classes', 'view'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const schoolId = req.user?.schoolId;
      const { limit: rawLimit = 20 } = req.query;
      const limit = Math.min(parseInt(rawLimit) || 20, 100);

      // Verify class belongs to this school
      const classDoc = await Class.findOne(
        scopeBySchool(schoolId, { _id: id, isDeleted: { $ne: true } })
      );
      if (!classDoc) {
        return res.status(404).json({ error: req.t('common:errors.classNotFound') });
      }

      const announcements = await ClassAnnouncement.find(scopeBySchool(schoolId, { classId: id, isDeleted: { $ne: true } }))
        .populate('sentBy', 'name code')
        .sort({ createdAt: -1 })
        .limit(limit);

      res.json(announcements);
    } catch (error) {
      console.error('Error fetching announcements:', error);
      res.status(500).json({ error: 'Failed to fetch announcements' });
    }
  }
);

// ============ FEES OVERVIEW ENDPOINT ============

// Get fees overview for class
router.get(
  '/:id/fees-overview',
  checkPermission('classes', 'view'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const schoolId = req.user?.schoolId;
      const { academicYear = CURRENT_ACADEMIC_YEAR } = req.query;

      const students = await Student.find(
        scopeBySchool(schoolId, { classId: id, status: 'active', isDeleted: { $ne: true } })
      );

      // Use StudentFeeStructure for year-scoped fee data instead of student.feeStatus
      const studentIds = students.map((s) => s._id);
      const feeStructures = await StudentFeeStructure.find(
        scopeBySchool(schoolId, {
          studentId: { $in: studentIds },
          academicYear,
          isDeleted: { $ne: true },
        })
      );

      const feeStructureMap = {};
      feeStructures.forEach((fs) => {
        feeStructureMap[fs.studentId.toString()] = fs;
      });

      const feeStats = {
        totalStudents: students.length,
        paid: 0,
        unpaid: 0,
        partial: 0,
        totalPendingAmount: 0,
        totalPaidAmount: 0,
      };

      students.forEach((student) => {
        const fs = feeStructureMap[student._id.toString()];
        if (fs) {
          const paidAmount = fs.paidAmount || 0;
          const totalFee = fs.totalFee || 0;
          const balanceAmount = fs.balanceAmount ?? (totalFee - paidAmount);

          if (paidAmount >= totalFee && totalFee > 0) {
            feeStats.paid++;
            feeStats.totalPaidAmount += paidAmount;
          } else if (paidAmount === 0) {
            feeStats.unpaid++;
            feeStats.totalPendingAmount += balanceAmount;
          } else {
            feeStats.partial++;
            feeStats.totalPendingAmount += balanceAmount;
            feeStats.totalPaidAmount += paidAmount;
          }
        } else {
          feeStats.unpaid++;
        }
      });

      res.json(feeStats);
    } catch (error) {
      console.error('Error fetching fees overview:', error);
      res.status(500).json({ error: 'Failed to fetch fees overview' });
    }
  }
);

export default router;
