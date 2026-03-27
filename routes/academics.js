/**
 * @swagger
 * tags:
 *   name: Academics
 *   description: Exams, results & grading
 */

/**
 * @swagger
 * /exams:
 *   get:
 *     summary: List exams
 *     tags: [Academics]
 *     parameters:
 *       - $ref: '#/components/parameters/AcademicYearQuery'
 *       - in: query
 *         name: classId
 *         schema:
 *           $ref: '#/components/schemas/ObjectId'
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [scheduled, ongoing, completed, results_published]
 *     responses:
 *       200:
 *         description: Array of exams
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ExamBase'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *   post:
 *     summary: Create an exam
 *     tags: [Academics]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, classId, subject, maxMarks, academicYear]
 *             properties:
 *               name:          { type: string, example: "Mid-Term Examination" }
 *               classId:       { $ref: '#/components/schemas/ObjectId' }
 *               subject:       { type: string, example: "Mathematics" }
 *               date:          { type: string, format: date }
 *               maxMarks:      { type: number, example: 100 }
 *               passingMarks:  { type: number, example: 35 }
 *               academicYear:  { $ref: '#/components/schemas/AcademicYear' }
 *     responses:
 *       201:
 *         description: Exam created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ExamBase'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

/**
 * @swagger
 * /exams/{id}:
 *   get:
 *     summary: Get an exam by ID
 *     tags: [Academics]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: Exam details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ExamBase'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   put:
 *     summary: Update an exam
 *     tags: [Academics]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ExamBase'
 *     responses:
 *       200:
 *         description: Updated exam
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   delete:
 *     summary: Delete an exam
 *     tags: [Academics]
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
 * /exams/{id}/publish:
 *   post:
 *     summary: Publish exam results (notifies parents)
 *     tags: [Academics]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: Exam published
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @swagger
 * /exams/{id}/results:
 *   get:
 *     summary: Get all results for an exam
 *     tags: [Academics]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: Array of results
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ResultBase'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *   post:
 *     summary: Submit bulk results for an exam
 *     tags: [Academics]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [results]
 *             properties:
 *               results:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [studentId, marksObtained]
 *                   properties:
 *                     studentId:     { $ref: '#/components/schemas/ObjectId' }
 *                     marksObtained: { type: number, minimum: 0 }
 *                     status:        { type: string, enum: [pass, fail, absent] }
 *     responses:
 *       200:
 *         description: Results saved; grades and ranks computed
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

import express from 'express';
import { Class, Exam, Result, SchoolSettings, Staff, Student, Parent } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { validateZod } from '../middleware/validation.js';
import { createExamSchema, updateExamSchema, bulkResultsSchema } from '../validators/index.js';
import { sendNotification } from './notifications.js';
import resolveClassId from '../utils/resolveClassId.js';
import { resolveAcademicYear } from '../utils/academicYear.js';
import {
  buildSchoolScopedQuery,
  extractSchoolId,
  ensureDefaultSchool,
} from '../utils/schoolContext.js';
import { dispatchWebhookEvent } from '../services/webhookService.js';
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
 * Issue #17/#21 Fix: Compute grade from percentage.
 * Uses the school's configured grading scale if provided, otherwise falls back to the
 * default Indian grading scale.
 * @param {number} percentage - The percentage score (0-100)
 * @param {Array|null} gradingScale - Optional array of { minPercentage, grade } sorted desc
 * @returns {string} Grade string
 */
function computeGrade(percentage, gradingScale = null) {
  if (gradingScale && gradingScale.length > 0) {
    const sorted = [...gradingScale].sort((a, b) => b.minPercentage - a.minPercentage);
    for (const entry of sorted) {
      if (percentage >= entry.minPercentage) return entry.grade;
    }
    return sorted[sorted.length - 1].grade;
  }
  if (percentage >= 90) return 'A+';
  if (percentage >= 80) return 'A';
  if (percentage >= 70) return 'B+';
  if (percentage >= 60) return 'B';
  if (percentage >= 50) return 'C';
  if (percentage >= 40) return 'D';
  return 'F';
}

/**
 * Issue #22 Fix: Compute and persist ranks for all results in an exam+class.
 * Ranks are assigned by sorting students by percentage in descending order.
 * Students with equal percentages receive the same rank (dense ranking).
 * @param {string} examId - The exam ID
 * @param {string} classId - The class ID
 * @param {string} schoolId - The school ID (optional)
 */
async function computeAndSaveRanks(examId, classId, schoolId) {
  // Issue #18: Always require schoolId to prevent cross-school ranking
  if (!schoolId) {
    console.error('computeAndSaveRanks called without schoolId - skipping');
    return;
  }
  const query = { examId, schoolId, isDeleted: { $ne: true } };
  if (classId) query.classId = classId;

  const allResults = await Result.find(query).sort({ percentage: -1 });
  if (allResults.length === 0) return;

  const rankOps = [];
  let currentRank = 1;

  for (let i = 0; i < allResults.length; i++) {
    // Dense ranking: same percentage gets same rank, next unique value gets rank+1 (no gaps)
    if (i > 0 && allResults[i].percentage < allResults[i - 1].percentage) {
      currentRank++;
    }

    rankOps.push({
      updateOne: {
        filter: { _id: allResults[i]._id },
        update: { $set: { rank: currentRank } },
      },
    });
  }

  if (rankOps.length > 0) {
    await Result.bulkWrite(rankOps);
  }
}

router.get(
  '/exams/class/:classId',
  authenticate,
  checkPermission('academics', 'view'),
  async (req, res) => {
    try {
      const resolved = await resolveClassId(req.params.classId, req.user?.schoolId);
      if (!resolved) {
        return res.status(404).json({ error: req.t('common:errors.classNotFound') });
      }

      const exams = await Exam.find(
        scopeBySchool(req.user?.schoolId, { classId: resolved.classId, isDeleted: { $ne: true } })
      ).sort({ startDate: -1 });
      res.json(exams);
    } catch (error) {
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

router.get(
  '/exams/staff/:staffId',
  authenticate,
  checkPermission('academics', 'view'),
  async (req, res) => {
    try {
      const staff = await Staff.findById(req.params.staffId);
      if (!staff) {
        return res.status(404).json({ error: req.t('common:errors.staffNotFound') });
      }

      const skip = parseInt(req.query.skip) || 0;
      const limit = parseInt(req.query.limit) || 20;

      const assignedClassIds = staff.assignedClasses || [];
      const teacherAssignmentClasses = (staff.teacherAssignments || []).flatMap(
        (assignment) => assignment.classes || []
      );
      const allClassIds = [...new Set([...assignedClassIds, ...teacherAssignmentClasses])];

      const resolvedClassIds = [];
      for (const classId of allClassIds) {
        const resolved = await resolveClassId(classId.toString(), req.user?.schoolId);
        if (resolved) {
          resolvedClassIds.push(resolved.classId);
        }
      }

      const baseQuery = scopeBySchool(req.user?.schoolId, {
        classId: { $in: resolvedClassIds },
        isDeleted: { $ne: true },
      });
      const total = await Exam.countDocuments(baseQuery);
      const exams = await Exam.find(baseQuery).sort({ startDate: -1 }).skip(skip).limit(limit);

      const classIds = [
        ...new Set(
          exams
            .map((e) => e.classId)
            .filter(Boolean)
            .map((id) => id.toString())
        ),
      ];
      const classMap = new Map();
      for (const classId of classIds) {
        try {
          const classDoc = await Class.findById(classId);
          if (classDoc) {
            classMap.set(
              classId,
              classDoc.section ? `${classDoc.name}-${classDoc.section}` : classDoc.name
            );
          }
        } catch {
          // Keep without className if lookup fails
        }
      }

      const formattedExams = exams.map((exam) => ({
        ...exam.toObject(),
        id: exam._id.toString(),
        className: exam.classId ? classMap.get(exam.classId.toString()) || null : null,
      }));

      res.json({ exams: formattedExams, hasMore: skip + exams.length < total, total });
    } catch (error) {
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

router.get('/exams', authenticate, checkPermission('academics', 'view'), async (req, res) => {
  try {
    const { academicYear, classId, status } = req.query;
    const query = { isDeleted: { $ne: true } };

    if (academicYear) {
      query.academicYear = academicYear;
    }
    if (classId) {
      const resolved = await resolveClassId(classId, req.user?.schoolId);
      if (resolved) {
        query.classId = resolved.classId;
      }
    }
    if (status) {
      query.status = status;
    }

    const exams = await Exam.find(scopeBySchool(req.user?.schoolId, query)).sort({
      startDate: -1,
      createdAt: -1,
    });
    const classIds = [...new Set(exams.map((exam) => exam.classId).filter(Boolean))];
    const classMap = new Map();

    for (const classIdValue of classIds) {
      try {
        const classDoc = await Class.findById(classIdValue);
        if (classDoc) {
          classMap.set(
            classIdValue.toString(),
            classDoc.section ? `${classDoc.name}-${classDoc.section}` : classDoc.name
          );
        }
      } catch {
        // Keep original classId if lookup fails.
      }
    }

    const formattedExams = exams.map((exam) => ({
      ...exam.toObject(),
      id: exam._id,
      className: exam.classId ? classMap.get(exam.classId.toString()) : exam.classId,
    }));

    res.json(formattedExams);
  } catch (error) {
    res.status(500).json({ error: 'An internal error occurred. Please try again.' });
  }
});

router.get('/exams/:id', authenticate, checkPermission('academics', 'view'), async (req, res) => {
  try {
    const exam = await Exam.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
    );
    if (!exam) {
      return res.status(404).json({ error: 'Exam not found' });
    }

    let className = exam.classId;
    if (exam.classId) {
      try {
        const classDoc = await Class.findById(exam.classId);
        if (classDoc) {
          className = classDoc.section ? `${classDoc.name}-${classDoc.section}` : classDoc.name;
        }
      } catch {
        // Keep original classId if lookup fails.
      }
    }

    res.json({
      ...exam.toObject(),
      id: exam._id,
      className,
    });
  } catch (error) {
    res.status(500).json({ error: 'An internal error occurred. Please try again.' });
  }
});

router.post(
  '/exams',
  authenticate,
  checkPermission('academics', 'create'),
  validateZod(createExamSchema),
  async (req, res) => {
    try {
      const {
        name,
        type,
        examType,
        classId,
        subjectId,
        subjectName,
        academicYear,
        startDate,
        endDate,
        maxMarks,
        passingMarks,
        weightage,
        gradingType,
        instructions,
        term,
        duration,
      } = req.body;

      // Issue #17: Validate date range
      if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
        return res.status(400).json({ error: 'endDate must be on or after startDate' });
      }

      let resolvedClassId = classId;
      if (classId) {
        const resolved = await resolveClassId(classId, req.user?.schoolId);
        if (resolved) {
          resolvedClassId = resolved.classId;
        }
      }

      const exam = new Exam({
        name,
        type: type || (examType ? examType.replace(/-/g, '_') : undefined), // Issue #15: Normalize examType → type
        examType, // Keep for backward compat; pre-save hook also handles migration
        classId: resolvedClassId,
        subjectId,
        subjectName,
        academicYear: await resolveAcademicYear(academicYear),
        startDate,
        endDate,
        maxMarks: maxMarks || 100,
        passingMarks: passingMarks || 35,
        weightage: weightage || 10,
        gradingType: gradingType || 'numerical',
        instructions,
        term, // Issue #11: Accept term from staff app
        duration, // Issue #11: Accept duration from staff app
        createdBy: req.user?._id || req.user?.id,
        status: 'scheduled',
        schoolId: req.user?.schoolId ? extractSchoolId(req.user.schoolId) : undefined,
      });

      await exam.save();
      res.status(201).json(exam);
    } catch (error) {
      console.error('Exam creation failed:', error);
      if (error.code === 11000) {
        return res
          .status(400)
          .json({ error: 'A duplicate exam already exists for this class and academic year' });
      }
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

router.post(
  '/exams/create-with-results',
  authenticate,
  checkPermission('academics', 'create'),
  validateZod(createExamSchema),
  async (req, res) => {
    try {
      const {
        name,
        type,
        examType,
        classId,
        subjectId,
        subjectName,
        academicYear,
        startDate,
        endDate,
        maxMarks,
        passingMarks,
        weightage,
        gradingType,
        instructions,
        term,
        duration,
      } = req.body;

      if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
        return res.status(400).json({ error: 'endDate must be on or after startDate' });
      }

      let resolvedClassId = classId;
      if (classId) {
        const resolved = await resolveClassId(classId, req.user?.schoolId);
        if (resolved) {
          resolvedClassId = resolved.classId;
        }
      }

      const resolvedSchoolId = req.user?.schoolId ? extractSchoolId(req.user.schoolId) : undefined;

      const exam = new Exam({
        name,
        type: type || (examType ? examType.replace(/-/g, '_') : undefined),
        examType,
        classId: resolvedClassId,
        subjectId,
        subjectName,
        academicYear: await resolveAcademicYear(academicYear),
        startDate,
        endDate,
        maxMarks: maxMarks || 100,
        passingMarks: passingMarks || 35,
        weightage: weightage || 10,
        gradingType: gradingType || 'numerical',
        instructions,
        term,
        duration,
        createdBy: req.user?._id || req.user?.id,
        status: 'scheduled',
        schoolId: resolvedSchoolId,
      });

      await exam.save();

      // Initialize empty result rows for all active students in the class
      let resultsInitialized = 0;
      if (resolvedClassId) {
        const students = await Student.find(
          {
            classId: resolvedClassId,
            isDeleted: { $ne: true },
            ...(resolvedSchoolId ? { schoolId: resolvedSchoolId } : {}),
          },
          '_id'
        );

        if (students.length > 0) {
          const resultDocs = students.map((student) => ({
            schoolId: resolvedSchoolId,
            examId: exam._id,
            studentId: student._id,
            classId: resolvedClassId,
            academicYear: exam.academicYear,
            marksObtained: 0,
            maxMarks: exam.maxMarks,
            totalMarksObtained: 0,
            totalMaxMarks: exam.maxMarks,
            percentage: 0,
            status: 'pending',
            isPublished: false,
          }));

          try {
            await Result.insertMany(resultDocs, { ordered: false });
            resultsInitialized = students.length;
          } catch (insertError) {
            // Count successfully inserted docs if some duplicates existed
            resultsInitialized = insertError.insertedDocs?.length ?? 0;
            console.error('Some result initializations failed:', insertError.message);
          }
        }
      }

      res.status(201).json({
        ...exam.toObject(),
        id: exam._id,
        resultsInitialized,
      });
    } catch (error) {
      console.error('Exam creation with results failed:', error);
      if (error.code === 11000) {
        return res
          .status(400)
          .json({ error: 'A duplicate exam already exists for this class and academic year' });
      }
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

router.put(
  '/exams/:id',
  authenticate,
  checkPermission('academics', 'edit'),
  validateZod(updateExamSchema),
  async (req, res) => {
    try {
      const {
        name,
        type,
        examType,
        classId,
        subjectId,
        subjectName,
        academicYear,
        startDate,
        endDate,
        maxMarks,
        passingMarks,
        weightage,
        gradingType,
        instructions,
        status,
        term,
        duration,
      } = req.body;

      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (type !== undefined) updateData.type = type;
      // Issue #15: If examType sent (staff app), normalize to type
      if (examType !== undefined && type === undefined) {
        updateData.type = examType.replace(/-/g, '_');
      }
      if (classId !== undefined) {
        const resolved = await resolveClassId(classId, req.user?.schoolId);
        updateData.classId = resolved ? resolved.classId : classId;
      }
      if (subjectId !== undefined) updateData.subjectId = subjectId;
      if (subjectName !== undefined) updateData.subjectName = subjectName;
      if (academicYear !== undefined) updateData.academicYear = academicYear;
      if (startDate !== undefined) updateData.startDate = startDate;
      if (endDate !== undefined) updateData.endDate = endDate;
      if (maxMarks !== undefined) updateData.maxMarks = maxMarks;
      if (passingMarks !== undefined) updateData.passingMarks = passingMarks;
      if (weightage !== undefined) updateData.weightage = weightage;
      if (gradingType !== undefined) updateData.gradingType = gradingType;
      if (instructions !== undefined) updateData.instructions = instructions;
      if (status !== undefined) updateData.status = status;
      if (term !== undefined) updateData.term = term;
      if (duration !== undefined) updateData.duration = duration;

      // Issue #17: Validate date range (including partial updates against existing values)
      const existingExamForDates = await Exam.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id })
      );
      const resolvedStartDate =
        startDate !== undefined ? startDate : existingExamForDates?.startDate;
      const resolvedEndDate = endDate !== undefined ? endDate : existingExamForDates?.endDate;
      if (
        resolvedStartDate &&
        resolvedEndDate &&
        new Date(resolvedEndDate) < new Date(resolvedStartDate)
      ) {
        return res.status(400).json({ error: 'endDate must be on or after startDate' });
      }

      // Issue #13: Prevent maxMarks change if results already exist
      if (maxMarks !== undefined) {
        const existingExam = await Exam.findOne(
          scopeBySchool(req.user?.schoolId, { _id: req.params.id })
        );
        if (existingExam && maxMarks !== existingExam.maxMarks) {
          const resultsCount = await Result.countDocuments({ examId: req.params.id });
          if (resultsCount > 0) {
            return res.status(400).json({
              error:
                'Cannot change maxMarks after results have been entered. Delete existing results first.',
            });
          }
        }
      }

      // Issue #9: Keep maxMarks and totalMarks in sync (pre-save hook doesn't fire on findOneAndUpdate)
      if (updateData.maxMarks !== undefined && updateData.totalMarks === undefined) {
        updateData.totalMarks = updateData.maxMarks;
      }
      if (updateData.totalMarks !== undefined && updateData.maxMarks === undefined) {
        updateData.maxMarks = updateData.totalMarks;
      }

      // Issue #2: Use findOneAndUpdate with school scoping to prevent TOCTOU
      const exam = await Exam.findOneAndUpdate(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id }),
        updateData,
        { new: true }
      );
      if (!exam) {
        return res.status(404).json({ error: 'Exam not found' });
      }

      // If passingMarks changed, recalculate status for all existing results
      if (passingMarks !== undefined) {
        const schoolId = req.user?.schoolId ? extractSchoolId(req.user.schoolId) : undefined;
        const examPassingMarks = exam.passingMarks || 35;
        const results = await Result.find({ examId: exam._id, schoolId, isDeleted: { $ne: true } });
        if (results.length > 0) {
          const statusOps = results.map((result) => ({
            updateOne: {
              filter: { _id: result._id },
              update: {
                $set: {
                  status: (result.marksObtained || 0) >= examPassingMarks ? 'passed' : 'failed',
                },
              },
            },
          }));
          await Result.bulkWrite(statusOps);
          await computeAndSaveRanks(exam._id.toString(), results[0]?.classId?.toString(), schoolId);
        }
      }

      res.json(exam);
    } catch (error) {
      console.error('Exam update failed:', error);
      if (error.code === 11000) {
        return res
          .status(400)
          .json({ error: 'A duplicate exam already exists for this class and academic year' });
      }
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

router.delete(
  '/exams/:id',
  authenticate,
  checkPermission('academics', 'delete'),
  async (req, res) => {
    try {
      // Issue #25: Soft delete with audit trail
      const exam = await Exam.findOneAndUpdate(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
        { isDeleted: true, deletedAt: new Date() },
        { new: true }
      );
      if (!exam) {
        return res.status(404).json({ error: 'Exam not found' });
      }

      await Result.updateMany(scopeBySchool(req.user?.schoolId, { examId: req.params.id }), {
        isDeleted: true,
        deletedAt: new Date(),
      });
      res.json({ message: 'Exam deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

router.post(
  '/exams/:id/publish',
  authenticate,
  checkPermission('academics', 'publish'),
  async (req, res) => {
    try {
      // Verify results exist before publishing — prevents empty notifications to parents
      const resultsCount = await Result.countDocuments(
        scopeBySchool(req.user?.schoolId, { examId: req.params.id })
      );
      if (resultsCount === 0) {
        return res.status(400).json({ error: 'Cannot publish exam without any results entered' });
      }

      // Use school-scoped update to prevent cross-tenant manipulation
      // Exclude soft-deleted exams from being published
      const exam = await Exam.findOneAndUpdate(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
        { status: 'results_published', isPublished: true, publishedAt: new Date() },
        { new: true }
      );
      if (!exam) {
        return res.status(404).json({ error: 'Exam not found' });
      }

      // Issue #18 Fix: Also publish all Result documents for this exam
      await Result.updateMany(scopeBySchool(req.user?.schoolId, { examId: exam._id }), {
        $set: { isPublished: true },
      });

      // BUG-37 Fix: Recompute ranks at publish time to ensure freshness
      const schoolId = req.user?.schoolId ? extractSchoolId(req.user.schoolId) : undefined;
      if (schoolId && exam.classId) {
        await computeAndSaveRanks(exam._id.toString(), exam.classId.toString(), schoolId);
      }

      // Issue #10: Notify parents when results are published
      try {
        const results = await Result.find(
          scopeBySchool(req.user?.schoolId, { examId: exam._id })
        ).select('studentId');
        const studentIds = [
          ...new Set(results.map((r) => r.studentId?.toString()).filter(Boolean)),
        ];

        if (studentIds.length > 0) {
          const parents = await Parent.find(
            scopeBySchool(req.user?.schoolId, { 'children.studentId': { $in: studentIds } })
          ).select('_id');
          for (const parent of parents) {
            sendNotification(
              parent._id,
              'Parent',
              'academic',
              'Exam Results Published',
              `Results for ${exam.name} are now available. Check your child's performance.`,
              { relatedId: exam._id, relatedType: 'Exam', priority: 'normal' }
            ).catch((err) => console.error('Notification error (publish):', err));
          }
        }

        // Emit socket event for real-time update
        const io = req.app.get('io');
        emitEvent(io, EVENTS.RESULTS_PUBLISHED, {
          schoolId: exam.schoolId?.toString(),
          classId: exam.classId?.toString(),
          examId: exam._id.toString(),
          examName: exam.name,
        });
      } catch (notifError) {
        console.error('Error sending publish notifications:', notifError);
        // Don't fail the request if notifications fail
      }

      dispatchWebhookEvent(req.user?.schoolId, 'exam.published', {
        id: exam._id,
        name: exam.name,
        classId: exam.classId,
        academicYear: exam.academicYear,
      }).catch(() => {});

      res.json(exam);
    } catch (error) {
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

// Unpublish exam results — allows retracting a published exam
router.put(
  '/exams/:id/unpublish',
  authenticate,
  checkPermission('academics', 'publish'),
  async (req, res) => {
    try {
      // Only allow unpublishing exams that are currently published
      const exam = await Exam.findOneAndUpdate(
        scopeBySchool(req.user?.schoolId, {
          _id: req.params.id,
          isPublished: true,
          isDeleted: { $ne: true },
        }),
        { status: 'completed', isPublished: false, publishedAt: null },
        { new: true }
      );
      if (!exam) {
        return res.status(404).json({ error: 'Published exam not found' });
      }

      // Also unpublish all Result documents for this exam
      await Result.updateMany(scopeBySchool(req.user?.schoolId, { examId: exam._id }), {
        $set: { isPublished: false },
      });

      // Emit socket event for real-time update
      const io = req.app.get('io');
      emitEvent(io, EVENTS.RESULTS_PUBLISHED, {
        schoolId: exam.schoolId?.toString(),
        classId: exam.classId?.toString(),
        examId: exam._id.toString(),
        examName: exam.name,
        unpublished: true,
      });

      dispatchWebhookEvent(req.user?.schoolId, 'exam.unpublished', {
        id: exam._id,
        name: exam.name,
        classId: exam.classId,
        academicYear: exam.academicYear,
      }).catch(() => {});

      res.json(exam);
    } catch (error) {
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

router.get(
  '/results/class/:classId/exam/:examId',
  authenticate,
  checkPermission('academics', 'view'),
  async (req, res) => {
    try {
      const { classId, examId } = req.params;

      let resolvedClassId = classId;
      const resolved = await resolveClassId(classId, req.user?.schoolId);
      if (resolved) {
        resolvedClassId = resolved.classId;
      }

      let results = await Result.find(
        scopeBySchool(req.user?.schoolId, {
          classId: resolvedClassId,
          examId,
          isDeleted: { $ne: true },
        })
      );
      if (results.length === 0 && resolvedClassId !== classId) {
        results = await Result.find(
          scopeBySchool(req.user?.schoolId, { classId, examId, isDeleted: { $ne: true } })
        );
      }

      res.json(results);
    } catch (error) {
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

router.post(
  '/results/bulk',
  authenticate,
  checkPermission('academics', 'edit'),
  validateZod(bulkResultsSchema),
  async (req, res) => {
    try {
      const { results, examId, classId, loadedAt, forceOverwrite } = req.body;

      if (!Array.isArray(results) || results.length === 0) {
        return res.status(400).json({ error: 'Results array is required' });
      }

      // Issue #19 + BUG-31: Check for concurrent modifications if loadedAt is provided
      // Skip check if forceOverwrite is true (user reviewed conflicts and chose to overwrite)
      if (loadedAt && !forceOverwrite) {
        const loadedDate = new Date(loadedAt);
        const staleResults = await Result.find(
          scopeBySchool(req.user?.schoolId, {
            examId,
            updatedAt: { $gt: loadedDate },
            isDeleted: { $ne: true },
          })
        ).select('studentId marksObtained remarks updatedAt');
        if (staleResults.length > 0) {
          return res.status(409).json({
            error: 'Results were modified by another user since you loaded this page.',
            staleStudentIds: staleResults.map((r) => r.studentId),
            serverResults: staleResults.map((r) => ({
              studentId: r.studentId,
              marksObtained: r.marksObtained,
              remarks: r.remarks || '',
              updatedAt: r.updatedAt,
            })),
          });
        }
      }

      let resolvedClassId = classId;
      if (classId) {
        const resolved = await resolveClassId(classId, req.user?.schoolId);
        if (resolved) {
          resolvedClassId = resolved.classId;
        }
      }

      // Fetch the exam to get maxMarks, passingMarks, and academicYear
      const exam = await Exam.findById(examId);
      if (!exam) {
        return res.status(404).json({ error: 'Exam not found' });
      }

      const examMaxMarks = exam.maxMarks || exam.totalMarks || 100;
      const examPassingMarks = exam.passingMarks || 35;
      const examAcademicYear = exam.academicYear;

      // Issue #29 Fix: Validate mark ranges before saving
      for (const result of results) {
        const marks = result.marksObtained;
        if (marks != null && (marks < 0 || marks > examMaxMarks)) {
          return res.status(400).json({
            error: `Invalid marks for student ${result.studentId}: ${marks}. Marks must be between 0 and ${examMaxMarks}.`,
          });
        }
      }

      const resolvedSchoolId = req.user?.schoolId ? extractSchoolId(req.user.schoolId) : undefined;

      // AUDIT-25: Fetch school's configured grading scale for grade computation
      const schoolSettingsForGrade = resolvedSchoolId
        ? await SchoolSettings.findOne({ schoolId: resolvedSchoolId }).lean()
        : null;
      const schoolGradingScale = schoolSettingsForGrade?.gradingScale?.length
        ? schoolSettingsForGrade.gradingScale
        : null;

      // Issue #14 + BUG-51: Validate that submitted students belong to the exam's class
      // Instead of rejecting the entire save, filter out unenrolled students and save the rest
      let validResults = results;
      const skippedStudents = [];
      if (resolvedClassId) {
        const classStudents = await Student.find(
          { classId: resolvedClassId, isDeleted: { $ne: true } },
          '_id name'
        );
        const validStudentIds = new Set(classStudents.map((s) => s._id.toString()));
        const studentNameMap = new Map(classStudents.map((s) => [s._id.toString(), s.name]));

        validResults = [];
        for (const result of results) {
          if (!validStudentIds.has(result.studentId.toString())) {
            skippedStudents.push({ studentId: result.studentId, reason: 'not enrolled in class' });
          } else {
            validResults.push(result);
          }
        }

        if (validResults.length === 0) {
          return res.status(400).json({
            error:
              'No valid students to save results for. All submitted students are no longer enrolled in this class.',
            skippedStudents,
          });
        }

        // Issue #28: Use student names in mark validation errors (re-validate with names)
        for (const result of validResults) {
          const marks = result.marksObtained;
          if (marks != null && (marks < 0 || marks > examMaxMarks)) {
            const studentName = studentNameMap.get(result.studentId.toString()) || result.studentId;
            return res.status(400).json({
              error: `Invalid marks for ${studentName}: ${marks} exceeds maximum ${examMaxMarks}`,
            });
          }
        }
      }

      // Issue #17 Fix: Compute all derived fields (percentage, grade, status, maxMarks, totals, academicYear)
      const bulkOps = validResults.map((result) => {
        const marksObtained = result.marksObtained || 0;
        const rawPercentage =
          examMaxMarks > 0 ? Math.round((marksObtained / examMaxMarks) * 100 * 100) / 100 : 0;
        const percentage = Math.min(100, Math.max(0, rawPercentage));
        const grade = computeGrade(percentage, schoolGradingScale);
        const status = marksObtained >= examPassingMarks ? 'passed' : 'failed';

        return {
          updateOne: {
            filter: {
              studentId: result.studentId,
              examId,
              ...(resolvedSchoolId ? { schoolId: resolvedSchoolId } : {}),
            },
            update: {
              $set: {
                studentId: result.studentId,
                examId,
                classId: resolvedClassId,
                academicYear: examAcademicYear,
                marksObtained,
                maxMarks: examMaxMarks,
                totalMarksObtained: marksObtained,
                totalMaxMarks: examMaxMarks,
                percentage,
                grade,
                status,
                remarks: result.remarks || '',
                enteredBy: req.user?._id || req.user?.id,
                enteredAt: new Date(),
                ...(resolvedSchoolId ? { schoolId: resolvedSchoolId } : {}),
              },
            },
            upsert: true,
          },
        };
      });

      await Result.bulkWrite(bulkOps);

      // Issue #22 Fix: Compute ranks for all results in this exam+class based on percentage
      await computeAndSaveRanks(examId, resolvedClassId, resolvedSchoolId);

      dispatchWebhookEvent(req.user?.schoolId, 'result.entered', {
        examId,
        classId: resolvedClassId,
        count: validResults.length,
      }).catch(() => {});

      const response = { message: 'Results saved successfully', count: validResults.length };
      if (skippedStudents.length > 0) {
        response.message = `Results saved for ${validResults.length} students. ${skippedStudents.length} student(s) skipped (no longer enrolled).`;
        response.skippedStudents = skippedStudents;
      }
      res.json(response);
    } catch (error) {
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

// Recalculate percentage, grade, status, and ranks for all results of an exam
// based on the exam's current maxMarks and passingMarks
router.post(
  '/exams/:id/recalculate-results',
  authenticate,
  checkPermission('academics', 'edit'),
  async (req, res) => {
    try {
      const schoolId = req.user?.schoolId ? extractSchoolId(req.user.schoolId) : undefined;
      const exam = await Exam.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
      );
      if (!exam) {
        return res.status(404).json({ error: 'Exam not found' });
      }

      const examMaxMarks = exam.maxMarks || exam.totalMarks || 100;
      const examPassingMarks = exam.passingMarks || 35;

      // Use school's configured grading scale if available
      const schoolSettings = schoolId ? await SchoolSettings.findOne({ schoolId }).lean() : null;
      const gradingScale = schoolSettings?.gradingScale?.length
        ? schoolSettings.gradingScale
        : null;

      const results = await Result.find({
        examId: exam._id,
        schoolId,
        isDeleted: { $ne: true },
      });

      if (results.length === 0) {
        return res.json({ message: 'No results to recalculate', count: 0 });
      }

      const bulkOps = results.map((result) => {
        const marksObtained = result.marksObtained || 0;
        const rawPercentage =
          examMaxMarks > 0 ? Math.round((marksObtained / examMaxMarks) * 100 * 100) / 100 : 0;
        const percentage = Math.min(100, Math.max(0, rawPercentage));
        const grade = computeGrade(percentage, gradingScale);
        const status = marksObtained >= examPassingMarks ? 'passed' : 'failed';

        return {
          updateOne: {
            filter: { _id: result._id },
            update: {
              $set: {
                percentage,
                grade,
                status,
                maxMarks: examMaxMarks,
                totalMarksObtained: marksObtained,
                totalMaxMarks: examMaxMarks,
              },
            },
          },
        };
      });

      await Result.bulkWrite(bulkOps);

      // Recompute ranks after status/percentage recalculation
      const classId = results[0]?.classId;
      await computeAndSaveRanks(exam._id.toString(), classId?.toString(), schoolId);

      res.json({ message: 'Results recalculated successfully', count: results.length });
    } catch (error) {
      console.error('Recalculate results failed:', error);
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

router.get('/subjects', authenticate, checkPermission('academics', 'view'), async (req, res) => {
  try {
    const settings = await SchoolSettings.findOne(buildSchoolScopedQuery(req.user?.schoolId));
    if (settings?.subjects?.length) {
      return res.json(
        settings.subjects.map((subject, index) => ({
          id: subject._id || index.toString(),
          name: subject.name,
          code: subject.code,
          description: subject.description,
        }))
      );
    }

    const classes = await Class.find(scopeBySchool(req.user?.schoolId, {}), 'subjects');
    const subjectSet = new Set();
    classes.forEach((classDoc) => {
      if (!Array.isArray(classDoc.subjects)) {
        return;
      }

      classDoc.subjects.forEach((subject) => {
        if (typeof subject === 'string') {
          subjectSet.add(subject);
        } else if (subject?.name) {
          subjectSet.add(subject.name);
        }
      });
    });

    if (subjectSet.size > 0) {
      return res.json(
        Array.from(subjectSet).map((name, index) => ({
          id: index.toString(),
          name,
        }))
      );
    }

    // Return empty array when no subjects configured — avoid hardcoded defaults in multi-tenant system
    res.json([]);
  } catch (error) {
    res.status(500).json({ error: 'An internal error occurred. Please try again.' });
  }
});

export default router;
