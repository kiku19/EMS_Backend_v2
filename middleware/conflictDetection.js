import conflictDetectionService from '../services/conflictDetectionService.js';

/**
 * Middleware to check for teacher conflicts before saving timetable slots
 */
export const checkConflicts = async (req, res, next) => {
  try {
    const { teacherId, day, periodIndex, classId, subject } = req.body;
    
    // Skip conflict check if no teacher is assigned
    if (!teacherId) {
      return next();
    }
    
    // Validate the slot assignment
    const validation = await conflictDetectionService.validateSlotAssignment(
      teacherId,
      classId,
      subject,
      day,
      periodIndex
    );
    
    if (!validation.isValid) {
      // Log the conflict
      await conflictDetectionService.logConflict(validation.error);
      
      return res.status(409).json({
        type: 'ConflictError',
        message: validation.error.message,
        details: validation.error
      });
    }
    
    next();
  } catch (error) {
    console.error('Error in conflict detection middleware:', error);
    res.status(500).json({
      type: 'ServerError',
      message: 'Error checking for conflicts',
      error: error.message
    });
  }
};

/**
 * Middleware to check conflicts for teacher timetable updates
 */
export const checkTeacherTimetableConflicts = async (req, res, next) => {
  try {
    const { teacherId } = req.params;
    const { day, periodIndex, classId, subject } = req.body;
    
    // Skip conflict check if no class is assigned
    if (!classId) {
      return next();
    }
    
    // Validate the slot assignment
    const validation = await conflictDetectionService.validateSlotAssignment(
      teacherId,
      classId,
      subject,
      day,
      periodIndex
    );
    
    if (!validation.isValid) {
      // Log the conflict
      await conflictDetectionService.logConflict(validation.error);
      
      return res.status(409).json({
        type: 'ConflictError',
        message: validation.error.message,
        details: validation.error
      });
    }
    
    next();
  } catch (error) {
    console.error('Error in teacher timetable conflict detection:', error);
    res.status(500).json({
      type: 'ServerError',
      message: 'Error checking for conflicts',
      error: error.message
    });
  }
};
