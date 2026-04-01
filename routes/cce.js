import express from 'express';
import CCEConfig from '../models/CCEConfig.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { validateZod } from '../validators/zodHelpers.js';
import { createCCEConfigSchema, updateCCEConfigSchema } from '../validators/cceSchema.js';
import { extractSchoolId } from '../utils/schoolContext.js';
import { resolveAcademicYear } from '../utils/academicYear.js';

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
router.get('/cce/config', authenticate, checkPermission('academics', 'view'), async (req, res) => {
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
  authenticate,
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
  authenticate,
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
router.delete(
  '/cce/config',
  authenticate,
  checkPermission('academics', 'manage'),
  async (req, res) => {
    try {
      const schoolId = extractSchoolId(req.user.schoolId);
      const academicYear = await resolveAcademicYear(req.query.academicYear, schoolId);
      const config = await CCEConfig.findOne(
        scope(schoolId, { academicYear, isDeleted: { $ne: true } })
      );
      if (!config) {
        return res.status(404).json({ error: 'CCE config not found for this academic year' });
      }
      config.isDeleted = true;
      config.deletedAt = new Date();
      await config.save();
      res.json({ message: 'CCE configuration deleted successfully' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete CCE configuration' });
    }
  }
);

export default router;
