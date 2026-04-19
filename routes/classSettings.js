import express from 'express';
import { z } from 'zod';
import { Class } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { buildSchoolScopedQuery } from '../utils/schoolContext.js';

const router = express.Router();
router.use(authenticate);

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const updateTagSchema = z.object({
  classTag: z
    .string()
    .max(50, 'Class tag must be 50 characters or less')
    .trim()
    .optional()
    .default(''),
});

const updateSubjectsSchema = z.object({
  subjects: z.array(z.string().trim()).min(1, 'At least one subject must be assigned'),
});

// ─── Helper ──────────────────────────────────────────────────────────────────

const schoolQuery = (req, extra = {}) =>
  buildSchoolScopedQuery(req.user?.schoolId, { isDeleted: { $ne: true }, ...extra });

/**
 * GET /api/class-settings/:id
 * Get class settings (tag and subjects)
 */
router.get('/:id', checkPermission('classes', 'view'), async (req, res) => {
  try {
    const { id } = req.params;

    const classData = await Class.findOne(schoolQuery(req, { _id: id })).select(
      'classTag assignedSubjects subjects name section'
    );

    if (!classData) {
      return res.status(404).json({
        success: false,
        message: req.t('common:errors.classNotFound'),
      });
    }

    // Use subjects field if assignedSubjects is empty (backward compatibility)
    const finalSubjects =
      classData.assignedSubjects && classData.assignedSubjects.length > 0
        ? classData.assignedSubjects
        : classData.subjects || [];

    res.json({
      success: true,
      classTag: classData.classTag || '',
      assignedSubjects: finalSubjects,
      subjects: finalSubjects,
      className: `${classData.name} ${classData.section}`,
    });
  } catch (error) {
    console.error('Error fetching class settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch class settings',
    });
  }
});

/**
 * PUT /api/class-settings/:id/tag
 * Update class tag
 */
router.put('/:id/tag', checkPermission('classes', 'edit'), async (req, res) => {
  try {
    const { id } = req.params;
    const parsed = updateTagSchema.parse(req.body);

    const classData = await Class.findOneAndUpdate(
      schoolQuery(req, { _id: id }),
      { classTag: parsed.classTag },
      { new: true, runValidators: true }
    ).select('classTag name section');

    if (!classData) {
      return res.status(404).json({
        success: false,
        message: req.t('common:errors.classNotFound'),
      });
    }

    res.json({
      success: true,
      message: 'Class tag updated successfully',
      classTag: classData.classTag,
      className: `${classData.name} ${classData.section}`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
      });
    }
    console.error('Error updating class tag:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update class tag',
    });
  }
});

/**
 * PUT /api/class-settings/:id/subjects
 * Update assigned subjects for a class
 */
router.put('/:id/subjects', checkPermission('classes', 'edit'), async (req, res) => {
  try {
    const { id } = req.params;
    const parsed = updateSubjectsSchema.parse(req.body);

    // Update both assignedSubjects AND subjects fields to ensure consistency
    // This fixes the issue where missing-subjects check uses 'subjects' field
    const classData = await Class.findOneAndUpdate(
      schoolQuery(req, { _id: id }),
      {
        assignedSubjects: parsed.subjects,
        subjects: parsed.subjects, // Sync to subjects field for backward compatibility
      },
      { new: true, runValidators: true }
    ).select('assignedSubjects subjects name section');

    if (!classData) {
      return res.status(404).json({
        success: false,
        message: req.t('common:errors.classNotFound'),
      });
    }

    res.json({
      success: true,
      message: 'Subjects updated successfully',
      assignedSubjects: classData.assignedSubjects,
      subjects: classData.subjects,
      className: `${classData.name} ${classData.section}`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
      });
    }
    console.error('Error updating subjects:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update subjects',
    });
  }
});

export default router;
