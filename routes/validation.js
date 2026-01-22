import express from 'express';
import validationService from '../services/validationService.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/validation/class/:classId/empty-slots
 * Get empty slots for a specific class timetable
 */
router.get('/class/:classId/empty-slots', authenticate, async (req, res) => {
  try {
    const { classId } = req.params;
    const { academicYear = '2024-25' } = req.query;

    const emptySlots = await validationService.identifyEmptySlots(classId, academicYear);

    res.json({
      success: true,
      classId,
      academicYear,
      emptySlots,
      count: emptySlots.length
    });
  } catch (error) {
    console.error('Error identifying empty slots:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to identify empty slots'
    });
  }
});

/**
 * GET /api/validation/teacher/:teacherId/gaps
 * Get unassigned periods for a specific teacher timetable
 */
router.get('/teacher/:teacherId/gaps', authenticate, async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { academicYear = '2024-25' } = req.query;

    const gaps = await validationService.identifyTeacherScheduleGaps(teacherId, academicYear);

    res.json({
      success: true,
      teacherId,
      academicYear,
      gaps,
      count: gaps.length
    });
  } catch (error) {
    console.error('Error identifying teacher schedule gaps:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to identify teacher schedule gaps'
    });
  }
});

/**
 * GET /api/validation/class/:classId/report
 * Get validation report for a specific class timetable
 */
router.get('/class/:classId/report', authenticate, async (req, res) => {
  try {
    const { classId } = req.params;
    const { academicYear = '2024-25' } = req.query;

    const report = await validationService.generateClassValidationReport(classId, academicYear);

    res.json({
      success: true,
      report
    });
  } catch (error) {
    console.error('Error generating class validation report:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate class validation report'
    });
  }
});

/**
 * GET /api/validation/teacher/:teacherId/report
 * Get validation report for a specific teacher timetable
 */
router.get('/teacher/:teacherId/report', authenticate, async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { academicYear = '2024-25' } = req.query;

    const report = await validationService.generateTeacherValidationReport(teacherId, academicYear);

    res.json({
      success: true,
      report
    });
  } catch (error) {
    console.error('Error generating teacher validation report:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate teacher validation report'
    });
  }
});

/**
 * GET /api/validation/classes/comprehensive
 * Get comprehensive validation report for all classes
 */
router.get('/classes/comprehensive', authenticate, async (req, res) => {
  try {
    const { academicYear = '2024-25' } = req.query;

    const report = await validationService.generateComprehensiveClassReport(academicYear);

    res.json({
      success: true,
      report
    });
  } catch (error) {
    console.error('Error generating comprehensive class report:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate comprehensive class report'
    });
  }
});

/**
 * GET /api/validation/teachers/comprehensive
 * Get comprehensive validation report for all teachers
 */
router.get('/teachers/comprehensive', authenticate, async (req, res) => {
  try {
    const { academicYear = '2024-25' } = req.query;

    const report = await validationService.generateComprehensiveTeacherReport(academicYear);

    res.json({
      success: true,
      report
    });
  } catch (error) {
    console.error('Error generating comprehensive teacher report:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate comprehensive teacher report'
    });
  }
});

export default router;
