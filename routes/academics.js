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
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Case-insensitive substring match on exam name or subject name (PAG-09).
 *       - in: query
 *         name: skip
 *         schema: { type: integer, minimum: 0 }
 *         description: Pagination offset (default 0).
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200 }
 *         description: Page size (default 50, capped at 200).
 *     responses:
 *       200:
 *         description: "Paginated list of exams for the current school (PAG-10: pagination lives in the body, not headers)"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ExamBase'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total:    { type: integer, description: 'Total exams matching the filter (across all pages).' }
 *                     skip:     { type: integer, description: 'Offset used for this page.' }
 *                     limit:    { type: integer, description: 'Page size used for this page.' }
 *                     hasMore:  { type: boolean, description: 'True when more exams exist past the current page.' }
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
 *                     status:        { type: string, enum: [passed, failed, absent] }
 *     responses:
 *       200:
 *         description: Results saved; grades and ranks computed
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

import express from 'express';
import mongoose from 'mongoose';
import {
  Class,
  Exam,
  ExamSchedule,
  Result,
  SchoolSettings,
  Staff,
  Student,
  Parent,
} from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { validateZod, validateObjectIdParam, sanitizeQueryStr } from '../middleware/validation.js';
import {
  createExamSchema,
  updateExamSchema,
  examListQuerySchema,
  bulkCreateExamsSchema,
  bulkResultsSchema,
  createResultSchema,
  updateResultSchema,
  emptyExamActionSchema,
} from '../validators/index.js';
import { sendNotification } from './notifications.js';
import resolveClassId from '../utils/resolveClassId.js';
import { resolveAcademicYear } from '../utils/academicYear.js';
import { buildSchoolScopedQuery, extractSchoolId } from '../utils/schoolContext.js';
import { dispatchWebhookEvent } from '../services/webhookService.js';
import { EVENTS, emitEvent } from '../utils/socketEvents.js';
import { computeGrade } from '../utils/grading.js';
import { withEffectiveStatus } from '../utils/examStatus.js';
import { logToTrash } from '../services/trashService.js';

const router = express.Router();
router.use(authenticate);

function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) throw new Error('schoolId is required for scoped queries');
  return { ...query, schoolId: normalizedSchoolId };
}

// AUDIT-11: computeGrade moved to ../utils/grading.js for centralized use

/**
 * Issue #22 Fix: Compute and persist ranks for all results in an exam+class.
 * Ranks are assigned by sorting students by percentage in descending order.
 * Students with equal percentages receive the same rank (dense ranking).
 * @param {string} examId - The exam ID
 * @param {string} classId - The class ID
 * @param {string} schoolId - The school ID (required)
 * @param {mongoose.ClientSession} [session] - Optional transaction session
 */
async function computeAndSaveRanks(examId, classId, schoolId, session = null) {
  // Issue #18: Always require schoolId to prevent cross-school ranking
  if (!schoolId) {
    console.error('computeAndSaveRanks called without schoolId - skipping');
    return;
  }
  const query = {
    examId,
    schoolId,
    marksObtained: { $ne: null },
    status: { $ne: 'pending' },
    isDeleted: { $ne: true },
  };
  if (classId) query.classId = classId;

  const allResults = await Result.find(query).sort({ percentage: -1 }).session(session);
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
    await Result.bulkWrite(rankOps, session ? { session } : undefined);
  }
}

router.get(
  '/exams/class/:classId',
  checkPermission('academics', 'view'),
  validateObjectIdParam('classId'),
  async (req, res) => {
    try {
      const resolved = await resolveClassId(req.params.classId, req.user?.schoolId);
      if (!resolved) {
        return res.status(404).json({ error: req.t('common:errors.classNotFound') });
      }

      const query = scopeBySchool(req.user?.schoolId, {
        classId: resolved.classId,
        isDeleted: { $ne: true },
      });
      const academicYear = sanitizeQueryStr(req.query.academicYear);
      if (academicYear) query.academicYear = academicYear;
      const exams = await Exam.find(query).sort({ startDate: -1 });
      // Attach date-derived `effectiveStatus` without overwriting stored `status`.
      res.json(exams.map((exam) => withEffectiveStatus(exam.toObject())));
    } catch {
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

router.get(
  '/exams/staff/:staffId',
  checkPermission('academics', 'view'),
  validateObjectIdParam('staffId'),
  async (req, res) => {
    try {
      const staff = await Staff.findOne({
        _id: req.params.staffId,
        schoolId: req.user?.schoolId,
        isDeleted: { $ne: true },
      });
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
      // AUDIT-65: Bulk-fetch classes instead of N+1 individual queries
      if (classIds.length > 0) {
        const classDocs = await Class.find(
          scopeBySchool(req.user?.schoolId, { _id: { $in: classIds } })
        ).select('name section');
        for (const classDoc of classDocs) {
          classMap.set(
            classDoc._id.toString(),
            classDoc.section ? `${classDoc.name}-${classDoc.section}` : classDoc.name
          );
        }
      }

      const formattedExams = exams.map((exam) => ({
        ...withEffectiveStatus(exam.toObject()),
        id: exam._id.toString(),
        className: exam.classId ? classMap.get(exam.classId.toString()) || null : null,
      }));

      res.json({ exams: formattedExams, hasMore: skip + exams.length < total, total });
    } catch {
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

router.get(
  '/exams',
  checkPermission('academics', 'view'),
  validateZod(examListQuerySchema, 'query'),
  async (req, res) => {
    try {
      const { academicYear, classId, status, q, skip, limit } = req.query;

      const query = { isDeleted: { $ne: true } };

      if (academicYear) {
        query.academicYear = academicYear;
      }
      if (classId) {
        const resolved = await resolveClassId(classId, req.user?.schoolId);
        if (!resolved) {
          return res.status(404).json({ error: 'Class not found' });
        }
        query.classId = resolved.classId;
      }
      if (status) {
        query.status = status;
      }
      // PAG-09: server-side name/subject search so the Results-entry picker
      // can find older exams across years. Regex is escaped and length-bounded
      // to avoid ReDoS on hostile input.
      if (typeof q === 'string' && q.trim()) {
        const safe = q
          .trim()
          .slice(0, 100)
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        query.$or = [
          { name: { $regex: safe, $options: 'i' } },
          { subjectName: { $regex: safe, $options: 'i' } },
        ];
      }

      const scopedQuery = scopeBySchool(req.user?.schoolId, query);
      const total = await Exam.countDocuments(scopedQuery);
      const exams = await Exam.find(scopedQuery)
        .sort({ startDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit);
      const classIds = [...new Set(exams.map((exam) => exam.classId).filter(Boolean))];
      const classMap = new Map();

      // AUDIT-5/65: Bulk-fetch classes instead of N+1 individual queries
      if (classIds.length > 0) {
        const classDocs = await Class.find(
          scopeBySchool(req.user?.schoolId, { _id: { $in: classIds } })
        ).select('name section');
        for (const classDoc of classDocs) {
          classMap.set(
            classDoc._id.toString(),
            classDoc.section ? `${classDoc.name}-${classDoc.section}` : classDoc.name
          );
        }
      }

      // Per-exam "results entered" count: non-deleted Result docs with a non-null
      // marksObtained. School-scoped (multi-tenant safe) and bounded by the page
      // size (≤200). Uses find() (not aggregate) so Mongoose auto-casts the
      // string schoolId/examIds to ObjectId — mirrors the /academic-board route.
      const examIds = exams.map((e) => e._id);
      const enteredMap = new Map();
      if (examIds.length > 0) {
        const enteredResults = await Result.find(
          scopeBySchool(req.user?.schoolId, {
            examId: { $in: examIds },
            isDeleted: { $ne: true },
            marksObtained: { $ne: null },
          })
        )
          .select('examId -_id')
          .lean();
        for (const r of enteredResults) {
          const key = String(r.examId);
          enteredMap.set(key, (enteredMap.get(key) || 0) + 1);
        }
      }

      // Per-exam average percentage across entered results. Feeds the data grid's
      // "Avg" column and the average-performance KPI. Aggregated from Result docs
      // (the pre-save hook stores `percentage`), school-scoped and page-bounded.
      const avgMap = new Map();
      if (examIds.length > 0) {
        const avgBuckets = await Result.aggregate([
          {
            $match: scopeBySchool(req.user?.schoolId, {
              examId: { $in: examIds },
              isDeleted: { $ne: true },
              marksObtained: { $ne: null },
            }),
          },
          { $group: { _id: '$examId', avgPercentage: { $avg: '$percentage' } } },
        ]);
        for (const b of avgBuckets) {
          avgMap.set(String(b._id), Math.round((b.avgPercentage || 0) * 10) / 10);
        }
      }

      const formattedExams = exams.map((exam) => ({
        ...withEffectiveStatus(exam.toObject()),
        id: exam._id,
        className: exam.classId ? classMap.get(exam.classId.toString()) : exam.classId,
        resultsEntered: enteredMap.get(exam._id.toString()) || 0,
        averagePercentage: avgMap.has(exam._id.toString()) ? avgMap.get(exam._id.toString()) : null,
      }));

      // AUDIT-66 + PAG-10: Return pagination metadata in the response body so
      // the dashboard (which parses JSON only and can't read headers) can
      // discover total counts and whether more pages exist.
      res.json({
        data: formattedExams,
        pagination: {
          total,
          skip,
          limit,
          hasMore: skip + exams.length < total,
        },
      });
    } catch {
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

router.get(
  '/exams/:id',
  checkPermission('academics', 'view'),
  validateObjectIdParam('id'),
  async (req, res) => {
    try {
      const exam = await Exam.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
      );
      if (!exam) {
        return res.status(404).json({ error: 'Exam not found' });
      }

      // AUDIT-5: Use school-scoped query instead of findById
      let className = exam.classId;
      if (exam.classId) {
        try {
          const classDoc = await Class.findOne(
            scopeBySchool(req.user?.schoolId, { _id: exam.classId })
          );
          if (classDoc) {
            className = classDoc.section ? `${classDoc.name}-${classDoc.section}` : classDoc.name;
          }
        } catch {
          // Keep original classId if lookup fails.
        }
      }

      // If this exam was generated from an ExamSchedule, surface the link
      // (name + status only) so the dashboard can render a "Part of" chip.
      // Scoping is mandatory — never expose schedules from other schools.
      let examSchedule = null;
      if (exam.examScheduleId) {
        try {
          const scheduleDoc = await ExamSchedule.findOne(
            scopeBySchool(req.user?.schoolId, {
              _id: exam.examScheduleId,
              isDeleted: { $ne: true },
            })
          )
            .select('name status')
            .lean();
          if (scheduleDoc) {
            examSchedule = {
              id: scheduleDoc._id,
              name: scheduleDoc.name,
              status: scheduleDoc.status,
            };
          }
        } catch {
          // Keep examSchedule null if lookup fails.
        }
      }

      res.json({
        ...withEffectiveStatus(exam.toObject()),
        id: exam._id,
        className,
        examSchedule,
      });
    } catch {
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

router.post(
  '/exams',
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
        // AUDIT-62: Validate classId exists in the database before creating an exam
        const classExists = await Class.findOne(
          scopeBySchool(req.user?.schoolId, { _id: resolvedClassId, isDeleted: { $ne: true } })
        );
        if (!classExists) {
          return res
            .status(404)
            .json({ error: 'Class not found. Cannot create exam for a non-existent class.' });
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
        const classExists = await Class.findOne(
          scopeBySchool(req.user?.schoolId, {
            _id: resolvedClassId,
            isDeleted: { $ne: true },
          })
        ).select('_id');
        if (!classExists) {
          return res.status(404).json({ error: 'Class not found' });
        }
      }

      const resolvedSchoolId = req.user?.schoolId ? extractSchoolId(req.user.schoolId) : undefined;

      const mongoSession = await mongoose.startSession();
      let exam;
      let resultsInitialized = 0;
      try {
        await mongoSession.withTransaction(async () => {
          exam = new Exam({
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
          await exam.save({ session: mongoSession });

          // Initialize pending rows for every active student. Exam creation and
          // placeholder creation commit together or not at all.
          if (resolvedClassId) {
            const students = await Student.find(
              {
                classId: resolvedClassId,
                status: 'active',
                isDeleted: { $ne: true },
                ...(resolvedSchoolId ? { schoolId: resolvedSchoolId } : {}),
              },
              '_id'
            ).session(mongoSession);

            if (students.length > 0) {
              const resultDocs = students.map((student) => ({
                schoolId: resolvedSchoolId,
                examId: exam._id,
                studentId: student._id,
                classId: resolvedClassId,
                academicYear: exam.academicYear,
                marksObtained: null,
                maxMarks: exam.maxMarks,
                totalMarksObtained: null,
                totalMaxMarks: exam.maxMarks,
                percentage: null,
                status: 'pending',
                isPublished: false,
              }));
              await Result.insertMany(resultDocs, {
                ordered: true,
                session: mongoSession,
              });
              resultsInitialized = students.length;
            }
          }
        });
      } finally {
        await mongoSession.endSession();
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

// ─── BULK CREATE EXAMS ─────────────────────────────────────────────
// One-shot generation of multiple exams for a single class.
// Materializes one Exam per (subject × date). Duplicates (same name + class
// + academicYear) are skipped with { ordered: false } and reported back so
// the UI can toast "Created N · skipped M duplicate".
//
// NOTE: pre('save') does not fire on insertMany, so totalMarks and type are
// normalized here before insert (mirrors the Exam pre-save hook).
router.post(
  '/exams/bulk',
  checkPermission('academics', 'create'),
  validateZod(bulkCreateExamsSchema),
  async (req, res) => {
    try {
      const {
        classId,
        name,
        type,
        subjects,
        dates,
        maxMarks,
        passingMarks,
        weightage,
        academicYear,
      } = req.body;

      const resolvedSchoolId = req.user?.schoolId ? extractSchoolId(req.user.schoolId) : undefined;

      // Resolve + validate the class exists
      const resolved = await resolveClassId(classId, req.user?.schoolId);
      if (!resolved) {
        return res.status(404).json({ error: 'Class not found.' });
      }
      const resolvedClassId = resolved.classId;
      const klass = await Class.findOne(
        scopeBySchool(req.user?.schoolId, { _id: resolvedClassId, isDeleted: { $ne: true } })
      );
      if (!klass) {
        return res
          .status(404)
          .json({ error: 'Class not found. Cannot create exams for a non-existent class.' });
      }

      // Resolve subject list
      const classSubjects = Array.isArray(klass.subjects) ? klass.subjects.filter(Boolean) : [];
      let subjectNames;
      if (subjects === 'all') {
        if (classSubjects.length === 0) {
          return res.status(400).json({
            error:
              'This class has no subjects. Add subjects to the class before bulk-creating exams.',
          });
        }
        subjectNames = classSubjects;
      } else {
        // Validate each requested subject exists on the class
        const invalid = subjects.filter((s) => !classSubjects.includes(s));
        if (invalid.length > 0) {
          return res.status(400).json({
            error: `Subject(s) not found on this class: ${invalid.join(', ')}`,
          });
        }
        subjectNames = subjects;
      }

      // Resolve academic year
      const resolvedAcademicYear = await resolveAcademicYear(academicYear);

      // Resolve dates into a { subjectName -> date } map
      const dateBySubject = {};
      if (Array.isArray(dates)) {
        for (const d of dates) dateBySubject[d.subjectName] = d.date;
      } else {
        for (const s of subjectNames) dateBySubject[s] = dates;
      }

      const normalizedType = type || undefined;

      // Build exam docs (pre('save') doesn't run on insertMany, so set totalMarks here)
      const isMultiSubject = subjectNames.length > 1;
      const docs = subjectNames.map((subjectName) => {
        const examName = isMultiSubject ? `${name} · ${subjectName}` : name;
        const date = dateBySubject[subjectName];
        return {
          schoolId: resolvedSchoolId,
          name: examName,
          type: normalizedType,
          classId: resolvedClassId,
          subjectName,
          academicYear: resolvedAcademicYear,
          startDate: date,
          endDate: date,
          maxMarks: maxMarks || 100,
          totalMarks: maxMarks || 100,
          passingMarks: passingMarks || 35,
          weightage: weightage || 10,
          gradingType: 'numerical',
          status: 'scheduled',
          createdBy: req.user?._id || req.user?.id,
        };
      });

      let insertedDocs = [];
      let skippedCount = 0;
      try {
        insertedDocs = await Exam.insertMany(docs, { ordered: false });
      } catch (insertError) {
        // Partial success: insertMany with ordered:false throws on dup keys,
        // but inserts everything else. insertedDocs holds the successes.
        if (insertError && insertError.insertedDocs) {
          insertedDocs = insertError.insertedDocs;
          skippedCount = (insertError.writeErrors || []).filter(
            (e) => e?.err?.code === 11000 || e?.code === 11000
          ).length;
        } else {
          throw insertError;
        }
      }

      res.status(201).json({
        created: insertedDocs.length,
        skipped: skippedCount,
        exams: insertedDocs,
      });
    } catch (error) {
      console.error('Bulk exam creation failed:', error);
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

// ─── ACADEMICS CLASSES BOARD ───────────────────────────────────────
// One row per Class (non-deleted, school-scoped) with the class teacher,
// per-subject teachers (derived from Staff.teacherAssignments), and exam
// counts by status. Powers the /academics/classes home base.
router.get('/academic-board', checkPermission('academics', 'view'), async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const resolvedSchoolId = schoolId ? extractSchoolId(schoolId) : undefined;

    const academicYearQ = req.query.academicYear
      ? await resolveAcademicYear(req.query.academicYear)
      : await resolveAcademicYear(undefined);
    const rawQ = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 25, 1), 200);

    const classQuery = { isDeleted: { $ne: true } };
    if (resolvedSchoolId) classQuery.schoolId = resolvedSchoolId;
    if (rawQ) {
      const safe = rawQ.slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      classQuery.name = { $regex: safe, $options: 'i' };
    }

    const total = await Class.countDocuments(classQuery);
    const classes = await Class.find(classQuery)
      .sort({ name: 1, section: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    if (classes.length === 0) {
      return res.json({
        data: [],
        pagination: { total, skip: (page - 1) * limit, limit, hasMore: false },
      });
    }

    const classIds = classes.map((c) => c._id);

    // Batch-fetch class teachers
    const classTeacherIds = classes.map((c) => c.classTeacherId).filter(Boolean);
    const teachers = classTeacherIds.length
      ? await Staff.find({ _id: { $in: classTeacherIds } }, 'name').lean()
      : [];
    const teacherNameById = new Map(teachers.map((t) => [String(t._id), t.name]));

    // Batch-fetch subject teachers for these classes via teacherAssignments
    const staffWithAssignments = await Staff.find(
      scopeBySchool(schoolId, {
        isDeleted: { $ne: true },
        'teacherAssignments.classes': { $in: classIds },
      }),
      'name teacherAssignments'
    ).lean();

    // Build { classIdStr -> [{ subject, teacherId, teacherName }] }
    const subjectTeachersByClass = new Map();
    for (const s of staffWithAssignments) {
      for (const ta of s.teacherAssignments || []) {
        const taClasses = Array.isArray(ta.classes) ? ta.classes : [];
        for (const c of taClasses) {
          const key = String(c);
          if (!classIds.some((cid) => String(cid) === key)) continue;
          if (!subjectTeachersByClass.has(key)) subjectTeachersByClass.set(key, []);
          const list = subjectTeachersByClass.get(key);
          if (!list.some((e) => e.subject === ta.subject)) {
            list.push({ subject: ta.subject, teacherId: String(s._id), teacherName: s.name });
          }
        }
      }
    }

    // Batch-fetch exam counts by status per class (for this academic year).
    // Use find() (not aggregate) so Mongoose auto-casts schoolId/classId.
    const examDocs = await Exam.find(
      scopeBySchool(schoolId, {
        classId: { $in: classIds },
        academicYear: academicYearQ,
        isDeleted: { $ne: true },
      }),
      'classId status'
    ).lean();
    const examCountsByClass = new Map();
    for (const ex of examDocs) {
      const cid = String(ex.classId);
      const status = ex.status;
      if (!examCountsByClass.has(cid)) {
        examCountsByClass.set(cid, {
          upcoming: 0,
          drafts: 0,
          published: 0,
          completed: 0,
          total: 0,
        });
      }
      const counts = examCountsByClass.get(cid);
      counts.total++;
      if (status === 'scheduled' || status === 'ongoing') counts.upcoming++;
      if (status === 'scheduled') counts.drafts++;
      if (status === 'results_published') counts.published++;
      if (status === 'completed') counts.completed++;
    }

    const rows = classes.map((c) => {
      const classTeacherId = c.classTeacherId ? String(c.classTeacherId) : null;
      const examCounts = examCountsByClass.get(String(c._id)) || {
        upcoming: 0,
        drafts: 0,
        published: 0,
        completed: 0,
        total: 0,
      };
      return {
        classId: String(c._id),
        name: c.name,
        section: c.section,
        classTeacher: classTeacherId
          ? { id: classTeacherId, name: teacherNameById.get(classTeacherId) || '—' }
          : null,
        subjectTeachers: subjectTeachersByClass.get(String(c._id)) || [],
        examCounts,
      };
    });

    res.json({
      data: rows,
      pagination: {
        total,
        skip: (page - 1) * limit,
        limit,
        hasMore: page * limit < total,
      },
    });
  } catch (error) {
    console.error('Academic board failed:', error);
    res.status(500).json({ error: 'An internal error occurred. Please try again.' });
  }
});

router.put(
  '/exams/:id',
  checkPermission('academics', 'edit'),
  validateObjectIdParam('id'),
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

      // Guard: gradingType, weightage, and term shape the report-card
      // calculation. Changing them AFTER publish silently rewrites
      // historical report cards with the new rules, with no caller
      // expecting it. Block unless the caller passes an explicit override.
      const existingExam = await Exam.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
      );
      if (!existingExam) {
        return res.status(404).json({ error: 'Exam not found' });
      }
      if (existingExam.isPublished) {
        return res.status(409).json({
          error: 'Published exams cannot be edited. Unpublish the exam before making changes.',
          code: 'PUBLISHED_EXAM_LOCKED',
        });
      }

      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (type !== undefined) updateData.type = type;
      // Issue #15: If examType sent (staff app), normalize to type
      if (examType !== undefined && type === undefined) {
        updateData.type = examType.replace(/-/g, '_');
      }
      if (classId !== undefined) {
        const resolved = await resolveClassId(classId, req.user?.schoolId);
        if (!resolved) {
          return res.status(404).json({ error: 'Class not found' });
        }
        const targetClass = await Class.findOne(
          scopeBySchool(req.user?.schoolId, {
            _id: resolved.classId,
            isDeleted: { $ne: true },
          })
        ).select('_id subjects');
        if (!targetClass) {
          return res.status(404).json({ error: 'Class not found' });
        }
        if (subjectName && !(targetClass.subjects || []).includes(subjectName)) {
          return res.status(400).json({
            error: `Subject "${subjectName}" is not configured for the selected class`,
          });
        }
        updateData.classId = targetClass._id;
      }
      if (subjectName !== undefined && classId === undefined && existingExam.classId) {
        const currentClass = await Class.findOne(
          scopeBySchool(req.user?.schoolId, {
            _id: existingExam.classId,
            isDeleted: { $ne: true },
          })
        ).select('subjects');
        if (
          !currentClass ||
          (subjectName && !(currentClass.subjects || []).includes(subjectName))
        ) {
          return res.status(400).json({
            error: `Subject "${subjectName}" is not configured for this class`,
          });
        }
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

      const effectiveMaxMarks = maxMarks ?? existingExam.maxMarks;
      const effectivePassingMarks = passingMarks ?? existingExam.passingMarks;
      if (effectivePassingMarks > effectiveMaxMarks) {
        return res.status(400).json({
          error: 'Passing marks cannot exceed maximum marks',
        });
      }

      // Validate the merged date range. Zod can only compare fields present in
      // the PATCH-like body, so a start-only/end-only update must be checked
      // against the persisted counterpart before the write.
      const resolvedStartDate = startDate !== undefined ? startDate : existingExam.startDate;
      const resolvedEndDate = endDate !== undefined ? endDate : existingExam.endDate;
      if (
        resolvedStartDate &&
        resolvedEndDate &&
        new Date(resolvedEndDate) < new Date(resolvedStartDate)
      ) {
        return res.status(400).json({ error: 'endDate must be on or after startDate' });
      }

      // Issue #13: Prevent maxMarks change if results already exist
      if (maxMarks !== undefined) {
        if (maxMarks !== existingExam.maxMarks) {
          const resultsCount = await Result.countDocuments(
            scopeBySchool(req.user?.schoolId, { examId: req.params.id })
          );
          if (resultsCount > 0) {
            return res.status(400).json({
              error:
                'Cannot change maxMarks after results have been entered. Delete existing results first.',
            });
          }
        }
      }

      // Result rows carry their own class/year scope. Moving an exam after any
      // rows (including initialized placeholders) exist would orphan those rows
      // from the exam's new scope and make marks appear to disappear.
      const classScopeChanged =
        updateData.classId !== undefined &&
        String(updateData.classId) !== String(existingExam.classId);
      const yearScopeChanged =
        academicYear !== undefined && academicYear !== existingExam.academicYear;
      if (classScopeChanged || yearScopeChanged) {
        const resultsCount = await Result.countDocuments(
          scopeBySchool(req.user?.schoolId, {
            examId: existingExam._id,
            isDeleted: { $ne: true },
          })
        );
        if (resultsCount > 0) {
          return res.status(409).json({
            error:
              'Cannot change the class or academic year after result rows exist. Remove the result rows first.',
            code: 'EXAM_RESULT_SCOPE_LOCKED',
          });
        }
      }

      // Issue #9: Keep maxMarks and totalMarks in sync (pre-save hook doesn't fire on findOneAndUpdate)
      if (updateData.maxMarks !== undefined && updateData.totalMarks === undefined) {
        updateData.totalMarks = updateData.maxMarks;
      }
      if (updateData.totalMarks !== undefined && updateData.maxMarks === undefined) {
        updateData.maxMarks = updateData.totalMarks;
      }

      let exam;
      const mongoSession = await mongoose.startSession();
      try {
        await mongoSession.withTransaction(async () => {
          // The exam edit and every derived result field are one write unit.
          // A grading failure cannot persist a new threshold with stale grades.
          exam = await Exam.findOneAndUpdate(
            scopeBySchool(req.user?.schoolId, {
              _id: req.params.id,
              updatedAt: existingExam.updatedAt,
              isDeleted: { $ne: true },
            }),
            updateData,
            { new: true, session: mongoSession }
          );
          if (!exam) {
            const error = new Error(
              'The exam changed while it was being edited. Reload and try again.'
            );
            error.statusCode = 409;
            error.code = 'EXAM_MODIFIED';
            throw error;
          }

          if (passingMarks !== undefined) {
            const schoolId = req.user?.schoolId ? extractSchoolId(req.user.schoolId) : undefined;
            const examPassingMarks = exam.passingMarks || 35;
            const examMaxMarks = exam.maxMarks || 100;
            const schoolSettings = schoolId
              ? await SchoolSettings.findOne({ schoolId }).session(mongoSession).lean()
              : null;
            const gradingScale = schoolSettings?.gradingScale?.length
              ? schoolSettings.gradingScale
              : null;
            const results = await Result.find({
              examId: exam._id,
              schoolId,
              marksObtained: { $ne: null },
              status: { $ne: 'pending' },
              isDeleted: { $ne: true },
            }).session(mongoSession);
            if (results.length > 0) {
              const statusOps = results.map((result) => {
                const marks = result.marksObtained || 0;
                const pct = examMaxMarks > 0 ? Math.round((marks / examMaxMarks) * 10000) / 100 : 0;
                return {
                  updateOne: {
                    filter: { _id: result._id },
                    update: {
                      $set: {
                        status:
                          result.status === 'absent'
                            ? 'absent'
                            : marks >= examPassingMarks
                              ? 'passed'
                              : 'failed',
                        grade: computeGrade(pct, gradingScale),
                        percentage: pct,
                      },
                    },
                  },
                };
              });
              await Result.bulkWrite(statusOps, { session: mongoSession });
              await computeAndSaveRanks(
                exam._id.toString(),
                results[0]?.classId?.toString(),
                schoolId,
                mongoSession
              );
            }
          }
        });
      } finally {
        await mongoSession.endSession();
      }

      res.json(exam);
    } catch (error) {
      console.error('Exam update failed:', error);
      if (error.code === 11000) {
        return res
          .status(400)
          .json({ error: 'A duplicate exam already exists for this class and academic year' });
      }
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          error: error.message,
          ...(error.code ? { code: error.code } : {}),
        });
      }
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

router.delete(
  '/exams/:id',
  checkPermission('academics', 'delete'),
  validateObjectIdParam('id'),
  async (req, res) => {
    const mongoSession = await mongoose.startSession();
    try {
      const cascadeDeletedAt = new Date();
      let exam;
      await mongoSession.withTransaction(async () => {
        // Snapshot before mutation for trash logging. The trash record, exam,
        // results, and ExamSchedule reference are one atomic unit so a failure
        // cannot leave a half-deleted, non-restorable exam.
        const examSnapshot = await Exam.findOne(
          scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
        )
          .session(mongoSession)
          .lean();
        if (!examSnapshot) {
          const error = new Error('Exam not found');
          error.statusCode = 404;
          throw error;
        }

        exam = await Exam.findOneAndUpdate(
          scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
          { isDeleted: true, deletedAt: cascadeDeletedAt },
          { new: true, session: mongoSession }
        );

        // Only archive currently-active results. Pre-existing deleted results
        // retain their original deletion marker and must not be resurrected by
        // restoring this exam later.
        await Result.updateMany(
          scopeBySchool(req.user?.schoolId, {
            examId: req.params.id,
            isDeleted: { $ne: true },
          }),
          { isDeleted: true, deletedAt: cascadeDeletedAt },
          { session: mongoSession }
        );

        await ExamSchedule.updateMany(
          scopeBySchool(req.user?.schoolId, { generatedExamIds: exam._id }),
          { $pull: { generatedExamIds: exam._id } },
          { session: mongoSession }
        );

        await logToTrash({
          itemType: 'Exam',
          itemId: exam._id,
          itemName: examSnapshot.name || 'Exam',
          originalData: examSnapshot,
          deletedBy: req.user?.id || req.user?._id,
          schoolId: req.user?.schoolId,
          deletionContext: { cascadeDeletedAt },
          session: mongoSession,
        });
      });

      res.json({ message: 'Exam deleted successfully' });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    } finally {
      await mongoSession.endSession();
    }
  }
);

router.post(
  '/exams/:id/publish',
  checkPermission('academics', 'publish'),
  validateObjectIdParam('id'),
  validateZod(emptyExamActionSchema),
  async (req, res) => {
    try {
      let exam;
      const schoolId = req.user?.schoolId ? extractSchoolId(req.user.schoolId) : undefined;
      const mongoSession = await mongoose.startSession();
      try {
        // Completeness checks, rank writes, exam state, and result visibility
        // are one atomic release operation. A failure cannot leave a published
        // exam with private results (or the reverse).
        await mongoSession.withTransaction(async () => {
          const existingExam = await Exam.findOne(
            scopeBySchool(req.user?.schoolId, {
              _id: req.params.id,
              isDeleted: { $ne: true },
            })
          )
            .select('_id classId isPublished')
            .session(mongoSession);
          if (!existingExam) {
            const error = new Error('Exam not found');
            error.statusCode = 404;
            throw error;
          }
          if (existingExam.isPublished) {
            const error = new Error('Exam is already published');
            error.statusCode = 409;
            error.code = 'EXAM_ALREADY_PUBLISHED';
            throw error;
          }

          const activeStudentRows = await Student.find(
            scopeBySchool(req.user?.schoolId, {
              classId: existingExam.classId,
              status: 'active',
              isDeleted: { $ne: true },
            })
          )
            .select('_id')
            .session(mongoSession)
            .lean();
          const activeStudentIds = activeStudentRows.map((student) => student._id);
          const activeStudents = activeStudentIds.length;
          if (activeStudents === 0) {
            const error = new Error('Cannot publish an exam for a class with no active students');
            error.statusCode = 400;
            error.code = 'NO_ACTIVE_STUDENTS';
            throw error;
          }

          // A placeholder row has marksObtained:null/status:pending. Require one
          // intentional result for every active student before publishing. Zero
          // and absent both count because they are real entries.
          const enteredResults = await Result.countDocuments(
            scopeBySchool(req.user?.schoolId, {
              examId: existingExam._id,
              classId: existingExam.classId,
              studentId: { $in: activeStudentIds },
              marksObtained: { $ne: null },
              status: { $ne: 'pending' },
              isDeleted: { $ne: true },
            })
          ).session(mongoSession);
          if (enteredResults < activeStudents) {
            const error = new Error(
              `Cannot publish: results are entered for ${enteredResults} of ${activeStudents} active students`
            );
            error.statusCode = 409;
            error.code = 'RESULTS_INCOMPLETE';
            error.details = { entered: enteredResults, expected: activeStudents };
            throw error;
          }

          await computeAndSaveRanks(
            existingExam._id.toString(),
            existingExam.classId.toString(),
            schoolId,
            mongoSession
          );

          exam = await Exam.findOneAndUpdate(
            scopeBySchool(req.user?.schoolId, {
              _id: existingExam._id,
              isPublished: { $ne: true },
              isDeleted: { $ne: true },
            }),
            { status: 'results_published', isPublished: true, publishedAt: new Date() },
            { new: true, session: mongoSession }
          );
          if (!exam) {
            const error = new Error('Exam not found or already published');
            error.statusCode = 409;
            error.code = 'EXAM_ALREADY_PUBLISHED';
            throw error;
          }

          await Result.updateMany(
            scopeBySchool(req.user?.schoolId, {
              examId: exam._id,
              classId: exam.classId,
              studentId: { $in: activeStudentIds },
              marksObtained: { $ne: null },
              status: { $ne: 'pending' },
              isDeleted: { $ne: true },
            }),
            { $set: { isPublished: true } },
            { session: mongoSession }
          );
        });
      } finally {
        await mongoSession.endSession();
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
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          error: error.message,
          ...(error.code ? { code: error.code } : {}),
          ...(error.details || {}),
        });
      }
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

// Unpublish exam results — allows retracting a published exam
router.put(
  '/exams/:id/unpublish',
  checkPermission('academics', 'publish'),
  validateObjectIdParam('id'),
  validateZod(emptyExamActionSchema),
  async (req, res) => {
    try {
      let exam;
      const mongoSession = await mongoose.startSession();
      try {
        await mongoSession.withTransaction(async () => {
          exam = await Exam.findOneAndUpdate(
            scopeBySchool(req.user?.schoolId, {
              _id: req.params.id,
              isPublished: true,
              isDeleted: { $ne: true },
            }),
            { status: 'completed', isPublished: false, publishedAt: null },
            { new: true, session: mongoSession }
          );
          if (!exam) {
            const error = new Error('Published exam not found');
            error.statusCode = 404;
            throw error;
          }
          await Result.updateMany(
            scopeBySchool(req.user?.schoolId, {
              examId: exam._id,
              isDeleted: { $ne: true },
            }),
            { $set: { isPublished: false } },
            { session: mongoSession }
          );
        });
      } finally {
        await mongoSession.endSession();
      }

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

      // Notify parents that the results have been retracted — otherwise
      // they'd click the earlier 'results published' notification and get
      // a 'not available' screen with no explanation.
      try {
        const { sendNotification } = await import('./notifications.js');
        const { Parent } = await import('../database.js');
        const students = await Result.find(
          scopeBySchool(req.user?.schoolId, { examId: exam._id, isDeleted: { $ne: true } })
        )
          .select('studentId')
          .lean();
        const studentIds = students.map((s) => s.studentId).filter(Boolean);
        if (studentIds.length) {
          const parents = await Parent.find(
            scopeBySchool(req.user?.schoolId, { 'children.studentId': { $in: studentIds } })
          ).select('_id');
          for (const parent of parents) {
            await sendNotification(
              parent._id,
              'Parent',
              'academic',
              `${exam.name} results retracted`,
              `The ${exam.name} results have been temporarily retracted while the school reviews them. We'll notify you when they're republished.`,
              {
                relatedId: exam._id,
                relatedType: 'Exam',
                priority: 'normal',
              }
            ).catch(() => {});
          }
        }
      } catch {
        // Non-critical — unpublish succeeds even if notifications fail
      }

      res.json(exam);
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

router.get(
  '/results/class/:classId/exam/:examId',
  checkPermission('academics', 'view'),
  validateObjectIdParam('classId'),
  validateObjectIdParam('examId'),
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
      ).populate('studentId', 'name rollNo');
      if (results.length === 0 && resolvedClassId !== classId) {
        results = await Result.find(
          scopeBySchool(req.user?.schoolId, { classId, examId, isDeleted: { $ne: true } })
        ).populate('studentId', 'name rollNo');
      }

      // Attach studentName for easy frontend consumption
      const enriched = results.map((r) => {
        const obj = r.toObject();
        if (r.studentId && typeof r.studentId === 'object' && r.studentId.name) {
          obj.studentName = r.studentId.name;
          obj.studentRollNo = r.studentId.rollNo;
        }
        return obj;
      });

      res.json(enriched);
    } catch {
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

router.post(
  '/results/bulk',
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
      const exam = await Exam.findOne({
        _id: examId,
        schoolId: req.user?.schoolId,
        isDeleted: { $ne: true },
      });
      if (!exam) {
        return res.status(404).json({ error: 'Exam not found' });
      }
      if (exam.isPublished) {
        return res.status(409).json({
          error: 'Published results are locked. Unpublish the exam before editing marks.',
          code: 'PUBLISHED_RESULTS_LOCKED',
        });
      }

      // A5: If the caller (e.g. staff-app ExamContext) omitted classId, fall
      // back to the exam's class. Without this, the enrollment gate below was
      // skipped entirely (un-enrolled students' results were written) and the
      // $set below wrote classId: undefined, so newly upserted rows lacked a
      // classId and dropped out of class-scoped dashboard queries.
      if (!resolvedClassId && exam.classId) {
        resolvedClassId = exam.classId;
      }
      if (!exam.classId || String(resolvedClassId) !== String(exam.classId)) {
        return res.status(400).json({
          error: 'The selected class does not match the exam class.',
          code: 'EXAM_CLASS_MISMATCH',
        });
      }
      // Persist only the canonical class owned by the exam. Never trust a
      // caller-supplied class id for a result relationship.
      resolvedClassId = exam.classId;

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
          { classId: resolvedClassId, isDeleted: { $ne: true }, schoolId: resolvedSchoolId },
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
        const marksObtained = result.status === 'absent' ? 0 : (result.marksObtained ?? 0);
        const rawPercentage =
          examMaxMarks > 0 ? Math.round((marksObtained / examMaxMarks) * 100 * 100) / 100 : 0;
        const percentage = Math.min(100, Math.max(0, rawPercentage));
        const grade = computeGrade(percentage, schoolGradingScale);
        // AUDIT-748: Respect 'absent' status from frontend; do not override it with pass/fail
        const status =
          result.status === 'absent'
            ? 'absent'
            : marksObtained >= examPassingMarks
              ? 'passed'
              : 'failed';

        return {
          updateOne: {
            filter: {
              studentId: result.studentId,
              examId,
              isDeleted: { $ne: true },
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
                isDeleted: false,
                ...(resolvedSchoolId ? { schoolId: resolvedSchoolId } : {}),
              },
            },
            upsert: true,
          },
        };
      });

      const mongoSession = await mongoose.startSession();
      try {
        await mongoSession.withTransaction(async () => {
          // Serialize mark writes with edits to the exam's thresholds/scope.
          // The optimistic timestamp filter turns a concurrent exam edit into
          // an explicit reload conflict instead of deriving results from stale
          // max/passing marks.
          const examLock = await Exam.updateOne(
            scopeBySchool(req.user?.schoolId, {
              _id: exam._id,
              updatedAt: exam.updatedAt,
              isPublished: { $ne: true },
              isDeleted: { $ne: true },
            }),
            { $set: { updatedAt: new Date() } },
            { session: mongoSession }
          );
          if (examLock.matchedCount !== 1) {
            const error = new Error(
              'The exam settings changed while marks were being saved. Reload and try again.'
            );
            error.statusCode = 409;
            error.code = 'EXAM_MODIFIED';
            throw error;
          }
          await Result.bulkWrite(bulkOps, { session: mongoSession });

          // Marks and their derived ranks are one atomic write. If ranking
          // fails, no partial mark imports remain for the user to repair.
          await computeAndSaveRanks(examId, resolvedClassId, resolvedSchoolId, mongoSession);
        });
      } finally {
        await mongoSession.endSession();
      }

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
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          error: error.message,
          ...(error.code ? { code: error.code } : {}),
        });
      }
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

// Recalculate percentage, grade, status, and ranks for all results of an exam
// based on the exam's current maxMarks and passingMarks
router.post(
  '/exams/:id/recalculate-results',
  checkPermission('academics', 'edit'),
  validateObjectIdParam('id'),
  validateZod(emptyExamActionSchema),
  async (req, res) => {
    try {
      const schoolId = req.user?.schoolId ? extractSchoolId(req.user.schoolId) : undefined;
      const exam = await Exam.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
      );
      if (!exam) {
        return res.status(404).json({ error: 'Exam not found' });
      }
      if (exam.isPublished) {
        return res.status(409).json({
          error: 'Published results are locked. Unpublish the exam before recalculating results.',
          code: 'PUBLISHED_RESULTS_LOCKED',
        });
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
        marksObtained: { $ne: null },
        status: { $ne: 'pending' },
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
        // AUDIT-748: Preserve 'absent' status; only recompute pass/fail for non-absent results
        const status =
          result.status === 'absent'
            ? 'absent'
            : marksObtained >= examPassingMarks
              ? 'passed'
              : 'failed';

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

      const mongoSession = await mongoose.startSession();
      try {
        await mongoSession.withTransaction(async () => {
          const examLock = await Exam.updateOne(
            scopeBySchool(req.user?.schoolId, {
              _id: exam._id,
              updatedAt: exam.updatedAt,
              isPublished: { $ne: true },
              isDeleted: { $ne: true },
            }),
            { $set: { updatedAt: new Date() } },
            { session: mongoSession }
          );
          if (examLock.matchedCount !== 1) {
            const error = new Error(
              'The exam changed while results were being recalculated. Reload and try again.'
            );
            error.statusCode = 409;
            error.code = 'EXAM_MODIFIED';
            throw error;
          }

          await Result.bulkWrite(bulkOps, { session: mongoSession });

          // Recompute ranks in the same transaction as derived result fields.
          const classId = results[0]?.classId;
          await computeAndSaveRanks(
            exam._id.toString(),
            classId?.toString(),
            schoolId,
            mongoSession
          );
        });
      } finally {
        await mongoSession.endSession();
      }

      res.json({ message: 'Results recalculated successfully', count: results.length });
    } catch (error) {
      console.error('Recalculate results failed:', error);
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          error: error.message,
          ...(error.code ? { code: error.code } : {}),
        });
      }
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

// ────────────────────────────────────────────────────────────────
// GET /exams/:id/results — Return all results for a specific exam
// ────────────────────────────────────────────────────────────────
router.get(
  '/exams/:id/results',
  checkPermission('academics', 'view'),
  validateObjectIdParam('id'),
  async (req, res) => {
    try {
      const schoolId = req.user?.schoolId;
      const exam = await Exam.findOne(
        scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
      );
      if (!exam) {
        return res.status(404).json({ error: 'Exam not found' });
      }
      const results = await Result.find(
        scopeBySchool(schoolId, { examId: req.params.id, isDeleted: { $ne: true } })
      )
        .populate('studentId', 'name rollNo admissionId')
        .populate('classId', 'name section')
        .sort({ rank: 1, percentage: -1 });

      res.json(results);
    } catch (error) {
      console.error('Get exam results failed:', error);
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

// ────────────────────────────────────────────────────────────────
// POST /results — Create a single result entry
// ────────────────────────────────────────────────────────────────
router.post(
  '/results',
  checkPermission('academics', 'edit'),
  validateZod(createResultSchema),
  async (req, res) => {
    try {
      const {
        examId,
        studentId,
        classId,
        marksObtained,
        maxMarks,
        remarks,
        academicYear,
        status: requestedStatus,
      } = req.body;

      const schoolId = req.user?.schoolId ? extractSchoolId(req.user.schoolId) : undefined;

      // Verify exam exists and belongs to this school
      const exam = await Exam.findOne(
        scopeBySchool(req.user?.schoolId, { _id: examId, isDeleted: { $ne: true } })
      );
      if (!exam) {
        return res.status(404).json({ error: 'Exam not found' });
      }
      if (exam.isPublished) {
        return res.status(409).json({
          error: 'Published results are locked. Unpublish the exam before editing marks.',
          code: 'PUBLISHED_RESULTS_LOCKED',
        });
      }

      // Verify student exists
      const student = await Student.findOne(
        scopeBySchool(req.user?.schoolId, { _id: studentId, isDeleted: { $ne: true } })
      );
      if (!student) {
        return res.status(404).json({ error: 'Student not found' });
      }
      if (
        !exam.classId ||
        !student.classId ||
        String(student.classId) !== String(exam.classId) ||
        (classId && String(classId) !== String(exam.classId))
      ) {
        return res.status(400).json({
          error: 'The student and selected class must match the exam class.',
          code: 'EXAM_CLASS_MISMATCH',
        });
      }

      // Check for duplicate
      const existing = await Result.findOne(
        scopeBySchool(req.user?.schoolId, {
          examId,
          studentId,
          isDeleted: { $ne: true },
        })
      );
      if (existing) {
        return res.status(409).json({ error: 'Result already exists for this student and exam' });
      }

      const examMaxMarks = exam.maxMarks || exam.totalMarks || 100;
      const examPassingMarks = exam.passingMarks || 35;
      if (maxMarks !== undefined && maxMarks !== examMaxMarks) {
        return res.status(400).json({
          error: `maxMarks must match the exam maximum of ${examMaxMarks}.`,
          code: 'EXAM_MAX_MARKS_MISMATCH',
        });
      }
      if (academicYear !== undefined && academicYear !== exam.academicYear) {
        return res.status(400).json({
          error: 'academicYear must match the exam academic year.',
          code: 'EXAM_ACADEMIC_YEAR_MISMATCH',
        });
      }
      const marks = requestedStatus === 'absent' ? 0 : marksObtained;

      if (marks < 0 || marks > examMaxMarks) {
        return res.status(400).json({
          error: `Invalid marks: ${marks} exceeds maximum ${examMaxMarks}`,
        });
      }

      // AUDIT-63: Fetch school's custom grading scale for grade computation
      const schoolSettingsForResult = schoolId
        ? await SchoolSettings.findOne({ schoolId }).lean()
        : null;
      const schoolGradingScaleForResult = schoolSettingsForResult?.gradingScale?.length
        ? schoolSettingsForResult.gradingScale
        : null;

      const rawPercentage =
        examMaxMarks > 0 ? Math.round((marks / examMaxMarks) * 100 * 100) / 100 : 0;
      const percentage = Math.min(100, Math.max(0, rawPercentage));
      const grade = computeGrade(percentage, schoolGradingScaleForResult);
      // A8: honor an explicit 'absent' status from the caller; otherwise derive
      // pass/fail from the marks.
      const status =
        requestedStatus === 'absent' ? 'absent' : marks >= examPassingMarks ? 'passed' : 'failed';

      const result = new Result({
        schoolId,
        examId,
        studentId,
        classId: exam.classId,
        academicYear: exam.academicYear,
        marksObtained: marks,
        maxMarks: examMaxMarks,
        totalMarksObtained: marks,
        totalMaxMarks: examMaxMarks,
        percentage,
        grade,
        status,
        remarks,
        enteredBy: req.user?._id || req.user?.id,
        enteredAt: new Date(),
        isPublished: exam.isPublished || false,
      });

      const mongoSession = await mongoose.startSession();
      try {
        await mongoSession.withTransaction(async () => {
          const examLock = await Exam.updateOne(
            scopeBySchool(req.user?.schoolId, {
              _id: exam._id,
              updatedAt: exam.updatedAt,
              isPublished: { $ne: true },
              isDeleted: { $ne: true },
            }),
            { $set: { updatedAt: new Date() } },
            { session: mongoSession }
          );
          if (examLock.matchedCount !== 1) {
            const error = new Error(
              'The exam changed while the result was being saved. Reload and try again.'
            );
            error.statusCode = 409;
            error.code = 'EXAM_MODIFIED';
            throw error;
          }

          await result.save({ session: mongoSession });

          const resultClassId = result.classId?.toString();
          if (resultClassId) {
            await computeAndSaveRanks(examId, resultClassId, schoolId, mongoSession);
          }
        });
      } finally {
        await mongoSession.endSession();
      }

      res.status(201).json(result);
    } catch (error) {
      console.error('Create result failed:', error);
      if (error.code === 11000) {
        return res.status(409).json({ error: 'Result already exists for this student and exam' });
      }
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          error: error.message,
          ...(error.code ? { code: error.code } : {}),
        });
      }
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

// ────────────────────────────────────────────────────────────────
// PUT /results/:id — Update a single result entry
// ────────────────────────────────────────────────────────────────
router.put(
  '/results/:id',
  checkPermission('academics', 'edit'),
  validateObjectIdParam('id'),
  validateZod(updateResultSchema),
  async (req, res) => {
    try {
      const schoolId = req.user?.schoolId ? extractSchoolId(req.user.schoolId) : undefined;

      const result = await Result.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
      );
      if (!result) {
        return res.status(404).json({ error: 'Result not found' });
      }

      const exam = await Exam.findOne(
        scopeBySchool(req.user?.schoolId, { _id: result.examId, isDeleted: { $ne: true } })
      );
      if (!exam) {
        return res.status(404).json({ error: 'Exam not found' });
      }
      if (exam.isPublished) {
        return res.status(409).json({
          error: 'Published results are locked. Unpublish the exam before editing marks.',
          code: 'PUBLISHED_RESULTS_LOCKED',
        });
      }

      const { marksObtained, maxMarks, remarks, status: requestedStatus } = req.body;

      const canonicalMaxMarks = exam.maxMarks || exam.totalMarks || result.maxMarks || 100;
      if (maxMarks !== undefined && maxMarks !== canonicalMaxMarks) {
        return res.status(400).json({
          error: `maxMarks must match the exam maximum of ${canonicalMaxMarks}.`,
          code: 'EXAM_MAX_MARKS_MISMATCH',
        });
      }

      const examPassingMarks = exam?.passingMarks || 35;

      // AUDIT-63: Fetch school's custom grading scale for grade computation
      const schoolSettingsForUpdate = schoolId
        ? await SchoolSettings.findOne({ schoolId }).lean()
        : null;
      const schoolGradingScaleForUpdate = schoolSettingsForUpdate?.gradingScale?.length
        ? schoolSettingsForUpdate.gradingScale
        : null;

      if (marksObtained !== undefined) {
        const examMaxMarks = canonicalMaxMarks;
        const marks = marksObtained;
        if (marks < 0 || marks > examMaxMarks) {
          return res.status(400).json({
            error: `Invalid marks: ${marks} exceeds maximum ${examMaxMarks}`,
          });
        }
        const rawPercentage =
          examMaxMarks > 0 ? Math.round((marks / examMaxMarks) * 100 * 100) / 100 : 0;
        const percentage = Math.min(100, Math.max(0, rawPercentage));
        const grade = computeGrade(percentage, schoolGradingScaleForUpdate);
        const computedStatus =
          requestedStatus === 'absent' ? 'absent' : marks >= examPassingMarks ? 'passed' : 'failed';

        result.marksObtained = marks;
        result.maxMarks = examMaxMarks;
        result.totalMarksObtained = marks;
        result.totalMaxMarks = examMaxMarks;
        result.percentage = percentage;
        result.grade = grade;
        result.status = computedStatus;
      } else if (maxMarks !== undefined) {
        // A7: standalone maxMarks update — recompute percentage/grade/status
        // against the stored marks (marksObtained was not sent in this branch).
        const examMaxMarks = canonicalMaxMarks;
        const marks = result.marksObtained || 0;
        if (marks > examMaxMarks) {
          return res.status(400).json({
            error: `Invalid marks: ${marks} exceeds maximum ${examMaxMarks}`,
          });
        }
        const rawPercentage =
          examMaxMarks > 0 ? Math.round((marks / examMaxMarks) * 100 * 100) / 100 : 0;
        const percentage = Math.min(100, Math.max(0, rawPercentage));
        result.maxMarks = examMaxMarks;
        result.totalMaxMarks = examMaxMarks;
        result.percentage = percentage;
        result.grade = computeGrade(percentage, schoolGradingScaleForUpdate);
        // Only recompute pass/fail if status isn't being explicitly overridden.
        if (requestedStatus === undefined) {
          result.status =
            result.status === 'absent' ? 'absent' : marks >= examPassingMarks ? 'passed' : 'failed';
        }
      }

      // Lifecycle-only overrides. pass/fail is never client-controlled; it is
      // derived above from marks and the exam threshold.
      if (requestedStatus === 'absent') {
        result.marksObtained = 0;
        result.maxMarks = canonicalMaxMarks;
        result.totalMarksObtained = 0;
        result.totalMaxMarks = canonicalMaxMarks;
        result.percentage = 0;
        result.grade = computeGrade(0, schoolGradingScaleForUpdate);
        result.status = 'absent';
      } else if (requestedStatus === 'pending') {
        result.marksObtained = null;
        result.totalMarksObtained = null;
        result.percentage = null;
        result.grade = null;
        result.rank = undefined;
        result.status = 'pending';
      }

      if (remarks !== undefined) {
        result.remarks = remarks;
      }

      result.enteredBy = req.user?._id || req.user?.id;
      result.enteredAt = new Date();

      const mongoSession = await mongoose.startSession();
      try {
        await mongoSession.withTransaction(async () => {
          const examLock = await Exam.updateOne(
            scopeBySchool(req.user?.schoolId, {
              _id: exam._id,
              updatedAt: exam.updatedAt,
              isPublished: { $ne: true },
              isDeleted: { $ne: true },
            }),
            { $set: { updatedAt: new Date() } },
            { session: mongoSession }
          );
          if (examLock.matchedCount !== 1) {
            const error = new Error(
              'The exam changed while the result was being saved. Reload and try again.'
            );
            error.statusCode = 409;
            error.code = 'EXAM_MODIFIED';
            throw error;
          }

          await result.save({ session: mongoSession });

          const resultClassId = result.classId?.toString();
          if (resultClassId) {
            await computeAndSaveRanks(
              result.examId.toString(),
              resultClassId,
              schoolId,
              mongoSession
            );
          }
        });
      } finally {
        await mongoSession.endSession();
      }

      res.json(result);
    } catch (error) {
      console.error('Update result failed:', error);
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          error: error.message,
          ...(error.code ? { code: error.code } : {}),
        });
      }
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

router.get('/subjects', checkPermission('academics', 'view'), async (req, res) => {
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
  } catch {
    res.status(500).json({ error: 'An internal error occurred. Please try again.' });
  }
});

export default router;
