import conflictDetectionService from '../../services/conflictDetectionService.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('ConflictDetection');

/**
 * Middleware to check for teacher conflicts before saving timetable slots
 * Uses flexible mode by default - only blocks on time conflicts, not qualification issues
 */
export const checkConflicts = async (req, res, next) => {
  try {
    const { teacherId, day, periodIndex, classId, subject } = req.body;

    // Skip conflict check if no teacher is assigned
    if (!teacherId) {
      return next();
    }

    // Validate the slot assignment (flexible mode - only check time conflicts)
    const validation = await conflictDetectionService.validateSlotAssignment(
      teacherId,
      classId,
      subject,
      day,
      periodIndex,
      false // Flexible mode - allow scheduling without formal assignments
    );

    if (!validation.isValid) {
      // Log the conflict
      await conflictDetectionService.logConflict(validation.error);

      return res.status(409).json({
        type: 'ConflictError',
        message: validation.error.message,
        details: validation.error,
      });
    }

    // Log warning if teacher is not formally assigned
    if (validation.warning) {
      logger.warn({ warning: validation.warning }, 'Timetable assignment warning');
    }

    next();
  } catch (error) {
    logger.error({ err: error }, 'Teacher timetable conflict detection error');
    res.status(500).json({
      type: 'ServerError',
      message: 'Error checking for conflicts',
      error: error.message,
    });
  }
};

/**
 * Middleware to check conflicts for teacher timetable updates
 * Uses flexible mode by default - only blocks on time conflicts, not qualification issues
 */
export const checkTeacherTimetableConflicts = async (req, res, next) => {
  try {
    const { teacherId } = req.params;
    const { day, periodIndex, classId, subject } = req.body;

    // Skip conflict check if no class is assigned
    if (!classId) {
      return next();
    }

    // Validate the slot assignment (flexible mode - only check time conflicts)
    const validation = await conflictDetectionService.validateSlotAssignment(
      teacherId,
      classId,
      subject,
      day,
      periodIndex,
      false // Flexible mode - allow scheduling without formal assignments
    );

    if (!validation.isValid) {
      // Log the conflict
      await conflictDetectionService.logConflict(validation.error);

      return res.status(409).json({
        type: 'ConflictError',
        message: validation.error.message,
        details: validation.error,
      });
    }

    // Log warning if teacher is not formally assigned
    if (validation.warning) {
      logger.warn({ warning: validation.warning }, 'Timetable assignment warning');
    }

    next();
  } catch (error) {
    logger.error({ err: error }, 'Teacher timetable conflict detection error');
    res.status(500).json({
      type: 'ServerError',
      message: 'Error checking for conflicts',
      error: error.message,
    });
  }
};
