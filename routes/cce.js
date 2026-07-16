import express from 'express';
import mongoose from 'mongoose';
import CCEConfig from '../models/CCEConfig.js';
import Result from '../models/Result.js';
import Exam from '../models/Exam.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { validateZod } from '../validators/zodHelpers.js';
import { validateObjectIdParam } from '../middleware/validation.js';
import {
  createCCEConfigSchema,
  updateCCEConfigSchema,
  cceReportCardQuerySchema,
} from '../validators/cceSchema.js';
import { extractSchoolId } from '../utils/schoolContext.js';
import { resolveAcademicYear } from '../utils/academicYear.js';
import { logToTrash } from '../services/trashService.js';

const router = express.Router();
router.use(authenticate);

// Standard CBSE CCE grading scale (default when no school config exists)
export const DEFAULT_CCE_SCALE = [
  {
    minPercentage: 91,
    maxPercentage: 100,
    grade: 'A1',
    gradePoint: 10,
    description: 'Outstanding',
  },
  { minPercentage: 81, maxPercentage: 90, grade: 'A2', gradePoint: 9, description: 'Excellent' },
  { minPercentage: 71, maxPercentage: 80, grade: 'B1', gradePoint: 8, description: 'Very Good' },
  { minPercentage: 61, maxPercentage: 70, grade: 'B2', gradePoint: 7, description: 'Good' },
  { minPercentage: 51, maxPercentage: 60, grade: 'C1', gradePoint: 6, description: 'Average' },
  { minPercentage: 41, maxPercentage: 50, grade: 'C2', gradePoint: 5, description: 'Marginal' },
  {
    minPercentage: 33,
    maxPercentage: 40,
    grade: 'D',
    gradePoint: 4,
    description: 'Needs Improvement',
  },
  {
    minPercentage: 21,
    maxPercentage: 32,
    grade: 'E1',
    gradePoint: 3,
    description: 'Below Average',
  },
  {
    minPercentage: 0,
    maxPercentage: 20,
    grade: 'E2',
    gradePoint: 2,
    description: 'Unsatisfactory',
  },
];

const DEFAULT_ASSESSMENT_TYPES = [
  { name: 'FA1', type: 'formative', term: 'term_1', weightage: 10, maxMarks: 20, isActive: true },
  { name: 'FA2', type: 'formative', term: 'term_1', weightage: 10, maxMarks: 20, isActive: true },
  { name: 'SA1', type: 'summative', term: 'term_1', weightage: 30, maxMarks: 80, isActive: true },
  { name: 'FA3', type: 'formative', term: 'term_2', weightage: 10, maxMarks: 20, isActive: true },
  { name: 'FA4', type: 'formative', term: 'term_2', weightage: 10, maxMarks: 20, isActive: true },
  { name: 'SA2', type: 'summative', term: 'term_2', weightage: 30, maxMarks: 80, isActive: true },
];

const DEFAULT_CO_SCHOLASTIC_AREAS = [
  { category: 'life_skills', name: 'Thinking Skills', isActive: true },
  { category: 'life_skills', name: 'Social Skills', isActive: true },
  { category: 'life_skills', name: 'Emotional Skills', isActive: true },
  { category: 'attitudes_values', name: 'Towards Teachers', isActive: true },
  { category: 'attitudes_values', name: 'Towards Classmates', isActive: true },
  { category: 'attitudes_values', name: 'Towards School', isActive: true },
  { category: 'co_curricular', name: 'Literary Activities', isActive: true },
  { category: 'co_curricular', name: 'Physical Activities', isActive: true },
];

function scope(schoolId, extra = {}) {
  const id = extractSchoolId(schoolId);
  if (!id) throw new Error('schoolId is required');
  return { ...extra, schoolId: id };
}

// ─── GET /cce/config ──────────────────────────────────────────────────────────
// Returns CCE config for the school/year; if none exists returns defaults
router.get('/cce/config', checkPermission('academics', 'view'), async (req, res) => {
  try {
    const schoolId = extractSchoolId(req.user.schoolId);
    const academicYear = await resolveAcademicYear(req.query.academicYear, schoolId);
    const config = await CCEConfig.findOne(
      scope(schoolId, { academicYear, isDeleted: { $ne: true } })
    );
    if (!config) {
      return res.json({
        _initialized: false,
        academicYear,
        enabled: true,
        gradingScale: DEFAULT_CCE_SCALE,
        assessmentTypes: DEFAULT_ASSESSMENT_TYPES,
        coScholasticAreas: DEFAULT_CO_SCHOLASTIC_AREAS,
      });
    }
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch CCE configuration' });
  }
});

// ─── PUT /cce/config ──────────────────────────────────────────────────────────
// Upsert CCE config for a school/year
router.put(
  '/cce/config',
  checkPermission('academics', 'manage'),
  validateZod(updateCCEConfigSchema),
  async (req, res) => {
    try {
      const schoolId = extractSchoolId(req.user.schoolId);
      const academicYear = await resolveAcademicYear(req.query.academicYear, schoolId);
      const config = await CCEConfig.findOneAndUpdate(
        scope(schoolId, { academicYear, isDeleted: { $ne: true } }),
        { $set: { ...req.body, schoolId, academicYear } },
        { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
      );
      res.json(config);
    } catch (err) {
      res.status(500).json({ error: 'Failed to update CCE configuration' });
    }
  }
);

// ─── POST /cce/config ─────────────────────────────────────────────────────────
// Create CCE config (fails if one already exists for this year)
router.post(
  '/cce/config',
  checkPermission('academics', 'manage'),
  validateZod(createCCEConfigSchema),
  async (req, res) => {
    try {
      const schoolId = extractSchoolId(req.user.schoolId);
      const academicYear = await resolveAcademicYear(req.body.academicYear, schoolId);
      const existing = await CCEConfig.findOne(
        scope(schoolId, { academicYear, isDeleted: { $ne: true } })
      );
      if (existing) {
        return res
          .status(409)
          .json({ error: 'CCE config already exists for this year. Use PUT to update.' });
      }
      const config = new CCEConfig({ ...req.body, schoolId, academicYear });
      await config.save();
      res.status(201).json(config);
    } catch (err) {
      res.status(500).json({ error: 'Failed to create CCE configuration' });
    }
  }
);

// ─── DELETE /cce/config ──────────────────────────────────────────────────────
// Soft-delete CCE config for a school/year
router.delete('/cce/config', checkPermission('academics', 'manage'), async (req, res) => {
  try {
    const schoolId = extractSchoolId(req.user.schoolId);
    const academicYear = await resolveAcademicYear(req.query.academicYear, schoolId);
    const config = await CCEConfig.findOne(
      scope(schoolId, { academicYear, isDeleted: { $ne: true } })
    );
    if (!config) {
      return res.status(404).json({ error: 'CCE config not found for this academic year' });
    }

    // Snapshot before mutation for trash logging
    const configSnapshot = config.toObject();

    config.isDeleted = true;
    config.deletedAt = new Date();
    await config.save();

    // Log to trash
    logToTrash({
      itemType: 'CCEConfig',
      itemId: config._id,
      itemName: `CCE Config ${academicYear}`,
      originalData: configSnapshot,
      deletedBy: req.user?.id || req.user?._id,
      schoolId,
    }).catch(() => {});

    res.json({ message: 'CCE configuration deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete CCE configuration' });
  }
});

// ─── GET /cce/report-card/:studentId ─────────────────────────────────────────
// Generate a CCE report card for a student by applying each configured
// assessment type's `weightage` to the marks earned in the matching exam.
//
// Weightage formula (per subject):
//   For each assessment type T (e.g. FA1 weightage 10):
//     contribution_T = (marksPercentage in the exam matching T) * T.weightage / 100
//   finalPercentage (subject) = sum of contributions across all assessment types
//                              = sum over T of (marksPct_T * weightage_T / 100)
//   Because active weightages sum to 100, this is a weighted average of the per-
//   assessment percentages. The grade is derived from the configured gradingScale
//   by finding the band whose [minPercentage, maxPercentage] range contains the
//   final percentage.
//
// Assessment types are matched to exams by name (Exam.name === assessmentType.name,
// e.g. "FA1"). Results carry examId, so we join Result → Exam to discover which
// assessment type each mark belongs to, and group by subject (Exam.subjectId /
// Exam.subjectName). Only single-subject Result documents (marksObtained / maxMarks
// / percentage at the top level) are consumed — multi-subject Result.marks[] rows
// are ignored here for simplicity.
router.get(
  '/cce/report-card/:studentId',
  validateObjectIdParam('studentId'),
  checkPermission('academics', 'view'),
  validateZod(cceReportCardQuerySchema, 'query'),
  async (req, res) => {
    try {
      const schoolId = extractSchoolId(req.user.schoolId);
      const studentId = req.params.studentId;
      const academicYear = await resolveAcademicYear(req.query.academicYear, schoolId);
      const subjectFilter = req.query.subjectId || null;

      // 1. Load the school's CCE config (assessmentTypes + gradingScale). Fall
      //    back to the standard CBSE defaults defined above when none exists so
      //    the endpoint is usable before a school configures CCE.
      const config = await CCEConfig.findOne(
        scope(schoolId, { academicYear, isDeleted: { $ne: true } })
      ).lean();
      const assessmentTypes = config?.assessmentTypes?.length
        ? config.assessmentTypes.filter((t) => t.isActive !== false)
        : DEFAULT_ASSESSMENT_TYPES;
      const gradingScale = config?.gradingScale?.length ? config.gradingScale : DEFAULT_CCE_SCALE;

      // Index assessment types by name (case-insensitive) for O(1) lookup.
      const assessmentByName = new Map();
      for (const t of assessmentTypes) {
        assessmentByName.set(String(t.name).trim().toLowerCase(), t);
      }

      // 2. Load every published/unpublished Result for this student+year+school.
      const resultQuery = scope(schoolId, {
        studentId: new mongoose.Types.ObjectId(String(studentId)),
        academicYear,
        isDeleted: { $ne: true },
      });
      const results = await Result.find(resultQuery).lean();

      if (results.length === 0) {
        return res.json({
          studentId,
          academicYear,
          subjects: [],
          overallPercentage: 0,
          overallGrade: deriveGradeFromScale(gradingScale, 0),
        });
      }

      // 3. Join to exams to learn subject + assessment-type name per result.
      const examIds = [...new Set(results.map((r) => String(r.examId)).filter(Boolean))];
      const exams = examIds.length
        ? await Exam.find(
            scope(schoolId, { _id: { $in: examIds.map((id) => new mongoose.Types.ObjectId(id)) } })
          ).lean()
        : [];
      const examById = new Map(exams.map((e) => [String(e._id), e]));

      // 4. Group results by subject and accumulate weighted contributions.
      //    subjectKey = subjectId (falling back to subjectName) so subjects
      //    without a subjectId still aggregate correctly.
      const bySubject = new Map();
      for (const result of results) {
        const exam = examById.get(String(result.examId));
        if (!exam) continue; // orphaned result (exam deleted) — skip

        // Optional single-subject filter (?subjectId=...)
        if (subjectFilter && String(exam.subjectId) !== String(subjectFilter)) continue;

        const subjectId = exam.subjectId ? String(exam.subjectId) : null;
        const subjectName = exam.subjectName || 'Unknown Subject';
        const subjectKey = subjectId || subjectName;

        // Match this exam to a configured assessment type by name (FA1/SA1...).
        const assessmentType = assessmentByName.get(
          String(exam.name || '')
            .trim()
            .toLowerCase()
        );
        if (!assessmentType) continue; // exam not part of CCE assessment plan

        // marksPercentage: prefer precomputed Result.percentage, else derive.
        const marksObtained = Number(result.marksObtained);
        const maxMarks = Number(result.maxMarks || exam.maxMarks || 100);
        let marksPercentage = null;
        if (typeof result.percentage === 'number' && result.percentage >= 0) {
          marksPercentage = result.percentage;
        } else if (marksObtained != null && maxMarks > 0) {
          marksPercentage = (marksObtained / maxMarks) * 100;
        }
        if (marksPercentage == null) continue; // no mark entered yet — skip

        // CCE weightage formula:
        //   contribution = marksPercentage * weightage / 100
        const weightage = Number(assessmentType.weightage) || 0;
        const contribution = (marksPercentage * weightage) / 100;

        if (!bySubject.has(subjectKey)) {
          bySubject.set(subjectKey, {
            subjectId,
            subjectName,
            assessmentBreakdown: [],
            _weightedSum: 0,
          });
        }
        const subject = bySubject.get(subjectKey);
        subject.assessmentBreakdown.push({
          type: assessmentType.name,
          marksPercentage: round2(marksPercentage),
          weightage,
          contribution: round2(contribution),
        });
        subject._weightedSum += contribution;
      }

      // 5. Finalize per-subject percentage + grade, then overall.
      const subjects = [...bySubject.values()].map((s) => {
        const finalPercentage = round2(s._weightedSum);
        const { _weightedSum, ...rest } = s;
        return {
          ...rest,
          finalPercentage,
          grade: deriveGradeFromScale(gradingScale, finalPercentage),
        };
      });

      const overallPercentage =
        subjects.length > 0
          ? round2(subjects.reduce((sum, s) => sum + s.finalPercentage, 0) / subjects.length)
          : 0;
      const overallGrade = deriveGradeFromScale(gradingScale, overallPercentage);

      res.json({
        studentId,
        academicYear,
        subjects,
        overallPercentage,
        overallGrade,
      });
    } catch (err) {
      console.error('[CCE] Failed to generate report card:', err);
      res.status(500).json({ error: 'Failed to generate CCE report card' });
    }
  }
);

// Derive a grade from a CCE grading scale by locating the band whose inclusive
// [minPercentage, maxPercentage] range contains the percentage. Falls back to
// the lowest band's grade when no band matches (defensive — should not happen
// for a well-formed scale that covers 0–100).
function deriveGradeFromScale(gradingScale, percentage) {
  if (!Array.isArray(gradingScale) || gradingScale.length === 0) return null;
  for (const band of gradingScale) {
    const min = Number(band.minPercentage);
    const max = Number(band.maxPercentage);
    if (percentage >= min && percentage <= max) return band.grade;
  }
  return gradingScale[gradingScale.length - 1].grade;
}

// Round to 2 decimal places for stable, human-friendly percentages.
function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export default router;
