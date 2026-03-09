import express from 'express';
import { Class } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';

const router = express.Router();

/**
 * GET /api/class-settings/:id
 * Get class settings (tag and subjects)
 */
router.get('/:id', authenticate, checkPermission('classes', 'view'), async (req, res) => {
  try {
    const { id } = req.params;

    const classData = await Class.findById(id).select('classTag assignedSubjects subjects name section');
    
    if (!classData) {
      return res.status(404).json({
        success: false,
        message: 'Class not found'
      });
    }

    // Use subjects field if assignedSubjects is empty (backward compatibility)
    const finalSubjects = classData.assignedSubjects && classData.assignedSubjects.length > 0 
      ? classData.assignedSubjects 
      : (classData.subjects || []);

    res.json({
      success: true,
      classTag: classData.classTag || '',
      assignedSubjects: finalSubjects,
      subjects: finalSubjects,
      className: `${classData.name} ${classData.section}`
    });
  } catch (error) {
    console.error('Error fetching class settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch class settings',
      error: error.message
    });
  }
});

/**
 * PUT /api/class-settings/:id/tag
 * Update class tag
 */
router.put('/:id/tag', authenticate, checkPermission('classes', 'edit'), async (req, res) => {
  try {
    const { id } = req.params;
    const { classTag } = req.body;

    // Validate input
    if (classTag && typeof classTag !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Class tag must be a string'
      });
    }

    // Validate length
    if (classTag && classTag.length > 50) {
      return res.status(400).json({
        success: false,
        message: 'Class tag must be 50 characters or less'
      });
    }

    const classData = await Class.findByIdAndUpdate(
      id,
      { classTag: classTag || '' },
      { new: true, runValidators: true }
    ).select('classTag name section');

    if (!classData) {
      return res.status(404).json({
        success: false,
        message: 'Class not found'
      });
    }

    res.json({
      success: true,
      message: 'Class tag updated successfully',
      classTag: classData.classTag,
      className: `${classData.name} ${classData.section}`
    });
  } catch (error) {
    console.error('Error updating class tag:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update class tag',
      error: error.message
    });
  }
});

/**
 * PUT /api/class-settings/:id/subjects
 * Update assigned subjects for a class
 */
router.put('/:id/subjects', authenticate, checkPermission('classes', 'edit'), async (req, res) => {
  try {
    const { id } = req.params;
    const { subjects } = req.body;

    // Validate input
    if (!Array.isArray(subjects)) {
      return res.status(400).json({
        success: false,
        message: 'Subjects must be an array'
      });
    }

    // Validate that all subjects are strings
    if (!subjects.every(s => typeof s === 'string')) {
      return res.status(400).json({
        success: false,
        message: 'All subjects must be strings'
      });
    }

    // Validate at least one subject
    if (subjects.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one subject must be assigned'
      });
    }

    // Update both assignedSubjects AND subjects fields to ensure consistency
    // This fixes the issue where missing-subjects check uses 'subjects' field
    const classData = await Class.findByIdAndUpdate(
      id,
      { 
        assignedSubjects: subjects,
        subjects: subjects // Sync to subjects field for backward compatibility
      },
      { new: true, runValidators: true }
    ).select('assignedSubjects subjects name section');

    if (!classData) {
      return res.status(404).json({
        success: false,
        message: 'Class not found'
      });
    }

    res.json({
      success: true,
      message: 'Subjects updated successfully',
      assignedSubjects: classData.assignedSubjects,
      subjects: classData.subjects,
      className: `${classData.name} ${classData.section}`
    });
  } catch (error) {
    console.error('Error updating subjects:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update subjects',
      error: error.message
    });
  }
});

export default router;
