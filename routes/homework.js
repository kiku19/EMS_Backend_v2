/**
 * @swagger
 * tags:
 *   name: Homework
 *   description: Homework assignment management — create, submit, and grade assignments
 */

/**
 * @swagger
 * /homework/teacher/{teacherId}:
 *   get:
 *     summary: Get all homework assigned by a teacher
 *     tags: [Homework]
 *     parameters:
 *       - in: path
 *         name: teacherId
 *         required: true
 *         schema:
 *           $ref: '#/components/schemas/ObjectId'
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, completed, expired]
 *       - in: query
 *         name: classId
 *         schema:
 *           $ref: '#/components/schemas/ObjectId'
 *     responses:
 *       200:
 *         description: List of homework assignments
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

/**
 * @swagger
 * /homework/class/{classId}:
 *   get:
 *     summary: Get active homework for a class (for students/parents)
 *     tags: [Homework]
 *     parameters:
 *       - in: path
 *         name: classId
 *         required: true
 *         schema:
 *           $ref: '#/components/schemas/ObjectId'
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           default: active
 *     responses:
 *       200:
 *         description: Active homework due in future
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

/**
 * @swagger
 * /homework/{id}:
 *   get:
 *     summary: Get homework details with all submissions
 *     tags: [Homework]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: Homework with submissions
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   put:
 *     summary: Update a homework assignment
 *     tags: [Homework]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               subject:
 *                 type: string
 *               dueDate:
 *                 type: string
 *                 format: date-time
 *               status:
 *                 type: string
 *                 enum: [active, completed, expired]
 *               attachments:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uri
 *     responses:
 *       200:
 *         description: Updated homework
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   delete:
 *     summary: Delete a homework assignment
 *     tags: [Homework]
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
 * /homework:
 *   post:
 *     summary: Create a homework assignment
 *     tags: [Homework]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, description, subject, classId, teacherId]
 *             properties:
 *               title:
 *                 type: string
 *                 example: Chapter 5 Exercise
 *               description:
 *                 type: string
 *                 example: Complete exercises 1–10 from Chapter 5
 *               subject:
 *                 type: string
 *                 example: Mathematics
 *               classId:
 *                 $ref: '#/components/schemas/ObjectId'
 *               teacherId:
 *                 $ref: '#/components/schemas/ObjectId'
 *               dueDate:
 *                 type: string
 *                 format: date-time
 *               attachments:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uri
 *               sentToParents:
 *                 type: boolean
 *                 default: true
 *     responses:
 *       201:
 *         description: Homework created; push notification sent to teacher
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

/**
 * @swagger
 * /homework/{id}/submit:
 *   post:
 *     summary: Submit homework (student)
 *     tags: [Homework]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [studentId]
 *             properties:
 *               studentId:
 *                 $ref: '#/components/schemas/ObjectId'
 *               attachments:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uri
 *               remarks:
 *                 type: string
 *     responses:
 *       200:
 *         description: Homework submitted (or re-submitted if previously submitted)
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @swagger
 * /homework/{id}/grade:
 *   post:
 *     summary: Grade a homework submission (teacher)
 *     tags: [Homework]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [studentId, marks]
 *             properties:
 *               studentId:
 *                 $ref: '#/components/schemas/ObjectId'
 *               marks:
 *                 type: number
 *                 minimum: 0
 *               remarks:
 *                 type: string
 *     responses:
 *       200:
 *         description: Submission graded
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Homework or submission not found
 */

import express from 'express';
import mongoose from 'mongoose';
import Homework from '../models/Homework.js';
import Parent from '../models/Parent.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { Student } from '../database.js';
import { extractSchoolId } from '../utils/schoolContext.js';
import { EVENTS, emitEvent } from '../utils/socketEvents.js';
import { zodSchemas, validateZod } from '../middleware/validation.js';

const router = express.Router();
router.use(authenticate);

// Fix 8.2: Helper to scope all queries by schoolId for multi-tenancy isolation
function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) {
    throw new Error('schoolId is required for scoped queries');
  }
  return { ...query, schoolId: normalizedSchoolId };
}

// Get all homework for a teacher
router.get('/teacher/:teacherId', authenticate, async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { status, classId, sectionId } = req.query;

    // Authorization: user must be the teacher themselves or an admin
    const isOwner = req.user._id?.toString() === teacherId || req.user.id?.toString() === teacherId;
    const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: "Not authorized to view this teacher's homework" });
    }

    const query = scopeBySchool(req.user.schoolId, { teacherId, isDeleted: { $ne: true } });
    if (status) query.status = status;
    if (classId) query.classId = classId;
    if (sectionId) query.sectionId = sectionId;

    const homework = await Homework.find(query)
      .populate('classId', 'name section')
      .sort({ dueDate: -1 });

    res.json(homework);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all homework for a class (for students/parents)
router.get('/class/:classId', authenticate, async (req, res) => {
  try {
    const { classId } = req.params;
    const { status = 'active', sectionId } = req.query;

    const filter = scopeBySchool(req.user.schoolId, { classId, status, isDeleted: { $ne: true } });
    // Optional section-level targeting within a class
    if (sectionId) filter.sectionId = sectionId;

    const homework = await Homework.find(filter)
      .populate('teacherId', 'name')
      .populate('classId', 'name section')
      .sort({ dueDate: 1 });

    res.json(homework);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all homework for the school (admin dashboard)
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, classId, teacherId } = req.query;

    const query = scopeBySchool(req.user.schoolId, { isDeleted: { $ne: true } });
    if (status) query.status = status;
    if (classId) query.classId = classId;
    if (teacherId) query.teacherId = teacherId;

    const homework = await Homework.find(query)
      .populate('classId', 'name section')
      .populate('teacherId', 'name')
      .sort({ dueDate: -1 })
      .limit(200);

    res.json(homework);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get homework analytics (completion rate, late submissions)
router.get('/analytics', authenticate, async (req, res) => {
  try {
    const { teacherId, classId, academicYear } = req.query;
    const query = scopeBySchool(req.user.schoolId, { isDeleted: { $ne: true } });
    if (teacherId) query.teacherId = teacherId;
    if (classId) query.classId = classId;
    if (academicYear) query.academicYear = academicYear;

    const homeworkList = await Homework.find(query).lean();

    // Batch-fetch student counts for all classIds
    const classIds = [...new Set(homeworkList.map((h) => h.classId?.toString()).filter(Boolean))];
    const studentCounts = {};
    if (classIds.length > 0) {
      const counts = await Student.aggregate([
        {
          $match: {
            schoolId: new mongoose.Types.ObjectId(req.user.schoolId),
            classId: { $in: classIds.map((id) => new mongoose.Types.ObjectId(id)) },
            status: 'active',
            isDeleted: { $ne: true },
          },
        },
        { $group: { _id: '$classId', count: { $sum: 1 } } },
      ]);
      counts.forEach((c) => {
        studentCounts[c._id.toString()] = c.count;
      });
    }

    let totalSubmissions = 0;
    let totalLateSubmissions = 0;
    let totalExpectedSubmissions = 0;
    const byStatus = { active: 0, completed: 0, cancelled: 0 };
    const subjectMap = {};

    for (const hw of homeworkList) {
      byStatus[hw.status] = (byStatus[hw.status] || 0) + 1;
      const classStudentCount = studentCounts[hw.classId?.toString()] || 0;
      totalExpectedSubmissions += classStudentCount;

      let hwLateCount = 0;
      for (const sub of hw.submissions || []) {
        totalSubmissions++;
        if (sub.submittedAt && hw.dueDate && new Date(sub.submittedAt) > new Date(hw.dueDate)) {
          hwLateCount++;
          totalLateSubmissions++;
        }
      }

      const subject = hw.subject || 'Unknown';
      if (!subjectMap[subject]) {
        subjectMap[subject] = {
          subject,
          totalHomework: 0,
          totalSubmissions: 0,
          lateSubmissions: 0,
          expectedSubmissions: 0,
        };
      }
      subjectMap[subject].totalHomework++;
      subjectMap[subject].totalSubmissions += (hw.submissions || []).length;
      subjectMap[subject].lateSubmissions += hwLateCount;
      subjectMap[subject].expectedSubmissions += classStudentCount;
    }

    const completionRate =
      totalExpectedSubmissions > 0
        ? Math.round((totalSubmissions / totalExpectedSubmissions) * 1000) / 10
        : 0;

    res.json({
      totalHomework: homeworkList.length,
      totalSubmissions,
      lateSubmissions: totalLateSubmissions,
      completionRate,
      byStatus,
      bySubject: Object.values(subjectMap).map((s) => ({
        subject: s.subject,
        totalHomework: s.totalHomework,
        totalSubmissions: s.totalSubmissions,
        lateSubmissions: s.lateSubmissions,
        completionRate:
          s.expectedSubmissions > 0
            ? Math.round((s.totalSubmissions / s.expectedSubmissions) * 1000) / 10
            : 0,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get homework by ID
router.get('/:id', authenticate, async (req, res) => {
  try {
    const homework = await Homework.findOne(
      scopeBySchool(req.user.schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
    )
      .populate('teacherId', 'name email')
      .populate('classId', 'name section')
      .populate('submissions.studentId', 'name rollNo admissionId');

    if (!homework) {
      return res.status(404).json({ error: req.t('common:routes.homeworkNotFound') });
    }

    res.json(homework);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create homework (teacher)
router.post(
  '/',
  authenticate,
  checkPermission('homework', 'create'),
  validateZod(zodSchemas.createHomework),
  async (req, res) => {
    try {
      const {
        title,
        description,
        subject,
        classId,
        sectionId,
        teacherId,
        dueDate,
        attachments,
        sentToParents,
      } = req.body;

      // Validate and parse dueDate — default to 7 days from now if omitted
      const parsedDueDate = dueDate
        ? new Date(dueDate)
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      if (isNaN(parsedDueDate.getTime())) {
        return res
          .status(400)
          .json({ error: req.t('common:routes.invalidDueDateFormatUseYyyyMmDdOrIsoFormat') });
      }

      const schoolId = extractSchoolId(req.user.schoolId);
      const homework = new Homework({
        schoolId,
        title,
        description,
        subject,
        classId,
        ...(sectionId && { sectionId }),
        teacherId,
        dueDate: parsedDueDate,
        attachments: attachments || [],
        sentToParents: sentToParents !== false,
      });

      await homework.save();

      // Emit socket event for real-time notification
      const io = req.app.get('io');
      emitEvent(io, EVENTS.HOMEWORK_CREATED, {
        schoolId: req.user?.schoolId?.toString(),
        classId: classId?.toString(),
        homeworkId: homework._id.toString(),
        teacherId: teacherId?.toString(),
        title,
        subject,
        dueDate,
      });

      // Send push notification to teacher (confirmation) and parents
      try {
        const { default: pushNotificationService } =
          await import('../services/pushNotificationService.js');

        const notificationData = {
          type: 'homework',
          homeworkId: homework._id,
          classId,
          subject,
          dueDate,
        };

        // Send to teacher as confirmation
        await pushNotificationService.sendToMultipleUsers(
          [teacherId],
          'Homework Created',
          `${title} has been assigned for ${subject}`,
          notificationData
        );

        // Send to parents of students in this class
        const students = await Student.find({
          classId,
          status: 'active',
          isDeleted: { $ne: true },
        }).select('_id');
        const studentIds = students.map((s) => s._id);

        if (studentIds.length > 0) {
          const parents = await Parent.find({
            'children.studentId': { $in: studentIds },
          }).select('_id');

          for (const parent of parents) {
            try {
              await pushNotificationService.sendToParent(
                parent._id,
                'New Homework',
                `${title} has been assigned for ${subject}. Due: ${dueDate ? new Date(dueDate).toLocaleDateString() : 'TBD'}`,
                notificationData
              );
            } catch {
              // Individual parent notification failure is non-critical
            }
          }
        }
      } catch (error) {
        console.error('Error sending push notification:', error);
      }

      const populatedHomework = await Homework.findById(homework._id)
        .populate('classId', 'name section')
        .populate('teacherId', 'name');

      res.status(201).json(populatedHomework);
    } catch (error) {
      console.error('Error creating homework:', error);
      res.status(500).json({
        error: error.message,
        details: error.name === 'ValidationError' ? error.errors : undefined,
      });
    }
  }
);

// Update homework
router.put(
  '/:id',
  authenticate,
  checkPermission('homework', 'edit'),
  validateZod(zodSchemas.updateHomework),
  async (req, res) => {
    try {
      const { title, description, subject, dueDate, attachments, status } = req.body;

      // Validate dueDate if provided (same as create route)
      let parsedDueDate;
      if (dueDate !== undefined) {
        parsedDueDate = new Date(dueDate);
        if (isNaN(parsedDueDate.getTime())) {
          return res
            .status(400)
            .json({ error: req.t('common:routes.invalidDueDateFormatUseYyyyMmDdOrIsoFormat') });
        }
      }

      const homework = await Homework.findOneAndUpdate(
        scopeBySchool(req.user.schoolId, { _id: req.params.id }),
        {
          title,
          description,
          subject,
          ...(parsedDueDate !== undefined && { dueDate: parsedDueDate }),
          attachments,
          status,
          updatedAt: new Date(),
        },
        { new: true }
      )
        .populate('classId', 'name section')
        .populate('teacherId', 'name');

      if (!homework) {
        return res.status(404).json({ error: req.t('common:routes.homeworkNotFound') });
      }

      res.json(homework);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// Submit homework (student — submitted by staff/admin on behalf of student)
router.post(
  '/:id/submit',
  authenticate,
  validateZod(zodSchemas.teacherSubmitHomework),
  async (req, res) => {
    try {
      const { studentId, attachments, remarks } = req.body;

      const homework = await Homework.findOne(
        scopeBySchool(req.user.schoolId, { _id: req.params.id })
      );

      if (!homework) {
        return res.status(404).json({ error: req.t('common:routes.homeworkNotFound') });
      }

      // Check if already submitted
      const existingSubmission = homework.submissions.find(
        (s) => s.studentId.toString() === studentId
      );

      if (existingSubmission) {
        // Update existing submission (preserve marks/feedback if already graded)
        existingSubmission.attachments = attachments || existingSubmission.attachments;
        existingSubmission.remarks = remarks;
        existingSubmission.submittedAt = new Date();
      } else {
        // Add new submission
        homework.submissions.push({
          studentId,
          attachments: attachments || [],
          remarks,
          submittedAt: new Date(),
        });
      }

      homework.updatedAt = new Date();
      await homework.save();

      res.json({ success: true, message: req.t('common:routes.homeworkSubmittedSuccessfully') });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// Grade homework submission (teacher)
router.post('/:id/grade', authenticate, validateZod(zodSchemas.gradeHomework), async (req, res) => {
  try {
    const { studentId, marks, feedback } = req.body;

    const homework = await Homework.findOne(
      scopeBySchool(req.user.schoolId, { _id: req.params.id })
    );

    if (!homework) {
      return res.status(404).json({ error: req.t('common:routes.homeworkNotFound') });
    }

    const submission = homework.submissions.find((s) => s.studentId.toString() === studentId);

    if (!submission) {
      return res.status(404).json({
        error: req.t('common:routes.submissionNotFoundStudentHasNotSubmittedThisHomework'),
      });
    }

    submission.marks = marks;
    if (feedback !== undefined) submission.feedback = feedback;
    submission.gradedAt = new Date();

    homework.updatedAt = new Date();
    await homework.save();

    res.json({ success: true, message: req.t('common:routes.homeworkGradedSuccessfully') });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete homework (soft delete — preserves grading data)
router.delete('/:id', authenticate, checkPermission('homework', 'delete'), async (req, res) => {
  try {
    const homework = await Homework.findOneAndUpdate(
      scopeBySchool(req.user.schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
      { $set: { isDeleted: true, deletedAt: new Date() } },
      { new: true }
    );

    if (!homework) {
      return res.status(404).json({ error: req.t('common:routes.homeworkNotFound') });
    }

    res.json({ success: true, message: req.t('common:routes.homeworkDeletedSuccessfully') });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
