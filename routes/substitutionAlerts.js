import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';
import express from 'express';
import { Substitution, Staff, Class, Timetable } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { buildSchoolScopedQuery } from '../utils/schoolContext.js';
import substitutionService from '../services/substitutionService.js';

const router = express.Router();
router.use(authenticate);

/** Helper: build a school-scoped query from the authenticated user */
const schoolQuery = (req, extra = {}) => buildSchoolScopedQuery(req.user?.schoolId, extra);

/**
 * GET /api/substitution-alerts
 * Get all substitution alerts for a date
 * Query params: date (YYYY-MM-DD), academicYear
 */
router.get('/', authenticate, checkPermission('classes', 'view'), async (req, res) => {
  try {
    const { date = new Date().toISOString().split('T')[0], academicYear = CURRENT_ACADEMIC_YEAR } =
      req.query;

    // Get pending substitutions with details (scoped by school)
    const alerts = await substitutionService.getPendingSubstitutionsWithDetails(
      date,
      req.user?.schoolId
    );

    // Calculate summary stats
    const summary = {
      totalAlerts: alerts.length,
      unassigned: alerts.filter((a) => !a.substituteTeacherId).length,
      assigned: alerts.filter((a) => a.substituteTeacherId).length,
      urgentAlerts: alerts.filter((a) => {
        const now = new Date();
        const alertDate = new Date(date);
        const hoursUntil = (alertDate - now) / (1000 * 60 * 60);
        return hoursUntil < 2 && !a.substituteTeacherId;
      }).length,
    };

    res.json({
      success: true,
      date,
      alerts,
      summary,
    });
  } catch (error) {
    console.error('Error fetching substitution alerts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch substitution alerts',
      error: error.message,
    });
  }
});

/**
 * GET /api/substitution-alerts/available-teachers
 * Get available teachers for a specific substitution
 * Query params: classId, subject, day, period, date
 */
router.get(
  '/available-teachers',
  authenticate,
  checkPermission('classes', 'view'),
  async (req, res) => {
    try {
      const { classId, subject, day, period, date } = req.query;

      if (!classId || !subject || !day || !period) {
        return res.status(400).json({
          success: false,
          message: 'classId, subject, day, and period are required',
        });
      }

      const availableTeachers = await substitutionService.getAvailableTeachersForSubstitution({
        classId,
        subject,
        day,
        period,
        date,
        schoolId: req.user?.schoolId,
      });

      res.json({
        success: true,
        ...availableTeachers,
      });
    } catch (error) {
      console.error('Error fetching available teachers:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch available teachers',
        error: error.message,
      });
    }
  }
);

/**
 * POST /api/substitution-alerts/from-absence
 * Create substitution alerts from teacher absence
 * Body: { teacherId, date, reason }
 */
router.post('/from-absence', authenticate, checkPermission('classes', 'edit'), async (req, res) => {
  try {
    const { teacherId, date, reason = 'Absent' } = req.body;

    if (!teacherId || !date) {
      return res.status(400).json({
        success: false,
        message: 'teacherId and date are required',
      });
    }

    // Verify teacher exists within this school
    const teacher = await Staff.findOne(schoolQuery(req, { _id: teacherId }));
    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found',
      });
    }

    // Create substitutions from absence (scoped by school)
    const substitutions = await substitutionService.createSubstitutionFromAbsence(
      teacherId,
      date,
      reason,
      req.user?.schoolId
    );

    res.json({
      success: true,
      message: `Created ${substitutions.length} substitution alert(s) for ${teacher.name}`,
      substitutions,
      teacher: {
        id: teacher._id,
        name: teacher.name,
      },
    });
  } catch (error) {
    console.error('Error creating substitution from absence:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create substitution alerts',
      error: error.message,
    });
  }
});

/**
 * POST /api/substitution-alerts/:id/assign
 * Assign a substitute teacher to an alert
 * Body: { substituteTeacherId }
 */
router.post('/:id/assign', authenticate, checkPermission('classes', 'edit'), async (req, res) => {
  try {
    const { id } = req.params;
    const { substituteTeacherId } = req.body;

    if (!substituteTeacherId) {
      return res.status(400).json({
        success: false,
        message: 'substituteTeacherId is required',
      });
    }

    // Find the substitution (scoped by school)
    const substitution = await Substitution.findOne(schoolQuery(req, { _id: id }));
    if (!substitution) {
      return res.status(404).json({
        success: false,
        message: 'Substitution not found',
      });
    }

    // Verify substitute teacher exists and is active (scoped by school)
    const substitute = await Staff.findOne(
      schoolQuery(req, { _id: substituteTeacherId, status: 'active' })
    );
    if (!substitute) {
      return res.status(400).json({
        success: false,
        message: 'Substitute teacher not found or inactive',
      });
    }

    // Update substitution
    substitution.substituteTeacherId = substituteTeacherId;
    substitution.status = 'confirmed';
    await substitution.save();

    // Populate for response
    await substitution.populate('classId', 'name section');
    await substitution.populate('absentTeacherId', 'name code');
    await substitution.populate('substituteTeacherId', 'name code');

    // TODO: Send notification to substitute teacher (implement with push notifications)

    res.json({
      success: true,
      message: `Assigned ${substitute.name} as substitute`,
      substitution,
    });
  } catch (error) {
    console.error('Error assigning substitute:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to assign substitute',
      error: error.message,
    });
  }
});

/**
 * POST /api/substitution-alerts/:id/notify
 * Send notification to substitute teacher
 */
router.post('/:id/notify', authenticate, checkPermission('classes', 'edit'), async (req, res) => {
  try {
    const { id } = req.params;
    const { method = 'push' } = req.body;

    const substitution = await Substitution.findOne(schoolQuery(req, { _id: id }))
      .populate('classId', 'name section')
      .populate('substituteTeacherId', 'name code');

    if (!substitution) {
      return res.status(404).json({
        success: false,
        message: 'Substitution not found',
      });
    }

    if (!substitution.substituteTeacherId) {
      return res.status(400).json({
        success: false,
        message: 'No substitute teacher assigned',
      });
    }

    // TODO: Implement actual notification service
    // For now, just log the notification

    // Simulate notification sent
    const notificationSent = true;

    res.json({
      success: notificationSent,
      message: `Notification sent to ${substitution.substituteTeacherId.name}`,
      notification: {
        recipient: substitution.substituteTeacherId.name,
        method,
        sentAt: new Date(),
      },
    });
  } catch (error) {
    console.error('Error sending notification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send notification',
      error: error.message,
    });
  }
});

/**
 * GET /api/substitution-alerts/stats
 * Get statistics for substitution alerts
 * Query params: startDate, endDate
 */
router.get('/stats', authenticate, checkPermission('classes', 'view'), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.date = {};
      if (startDate) dateFilter.date.$gte = startDate;
      if (endDate) dateFilter.date.$lte = endDate;
    }

    const substitutions = await Substitution.find(schoolQuery(req, dateFilter));

    const stats = {
      total: substitutions.length,
      pending: substitutions.filter((s) => s.status === 'pending').length,
      confirmed: substitutions.filter((s) => s.status === 'confirmed').length,
      completed: substitutions.filter((s) => s.status === 'completed').length,
      auto: substitutions.filter((s) => s.type === 'auto').length,
      manual: substitutions.filter((s) => s.type === 'manual').length,
      byDate: {},
      byPeriod: {},
    };

    // Group by date
    substitutions.forEach((sub) => {
      if (!stats.byDate[sub.date]) {
        stats.byDate[sub.date] = 0;
      }
      stats.byDate[sub.date]++;
    });

    // Group by period
    substitutions.forEach((sub) => {
      if (!stats.byPeriod[sub.period]) {
        stats.byPeriod[sub.period] = 0;
      }
      stats.byPeriod[sub.period]++;
    });

    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error('Error fetching substitution stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch substitution statistics',
      error: error.message,
    });
  }
});

/**
 * POST /api/substitution-alerts/bulk-assign
 * Bulk assign substitutes to multiple alerts
 * Body: { assignments: [{ substitutionId, substituteTeacherId }] }
 */
router.post('/bulk-assign', authenticate, checkPermission('classes', 'edit'), async (req, res) => {
  try {
    const { assignments } = req.body;

    if (!Array.isArray(assignments) || assignments.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'assignments array is required',
      });
    }

    const results = {
      success: [],
      failed: [],
    };

    for (const assignment of assignments) {
      try {
        const { substitutionId, substituteTeacherId } = assignment;

        const substitution = await Substitution.findOne(schoolQuery(req, { _id: substitutionId }));
        if (!substitution) {
          results.failed.push({
            substitutionId,
            error: 'Substitution not found',
          });
          continue;
        }

        const substitute = await Staff.findOne(
          schoolQuery(req, { _id: substituteTeacherId, status: 'active' })
        );
        if (!substitute) {
          results.failed.push({
            substitutionId,
            error: 'Invalid substitute teacher',
          });
          continue;
        }

        substitution.substituteTeacherId = substituteTeacherId;
        substitution.status = 'confirmed';
        await substitution.save();

        results.success.push({
          substitutionId,
          substituteName: substitute.name,
        });
      } catch (err) {
        results.failed.push({
          substitutionId: assignment.substitutionId,
          error: err.message,
        });
      }
    }

    res.json({
      success: true,
      message: `Assigned ${results.success.length} substitutes, ${results.failed.length} failed`,
      results,
    });
  } catch (error) {
    console.error('Error in bulk assign:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to bulk assign substitutes',
      error: error.message,
    });
  }
});

export default router;
