import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';
import { Staff, Timetable, TeacherTimetable, ConflictLog } from '../database.js';
import { debounceAsync } from '../utils/debounce.js';
import cacheService from './cacheService.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ConflictDetection');

/**
 * Service for detecting and managing timetable conflicts
 */
class ConflictDetectionService {
  constructor() {
    // Debounce conflict checks to avoid excessive database queries during rapid edits
    this.debouncedConflictCheck = debounceAsync(
      this._checkTeacherConflictInternal.bind(this),
      500 // 500ms debounce
    );
  }
  /**
   * Check if a teacher has a conflict at a specific time slot (debounced)
   * @param {string} teacherId - The teacher's ID
   * @param {string} day - Day of the week (Monday, Tuesday, etc.)
   * @param {number} periodIndex - Index of the period
   * @param {string} excludeClassId - Optional class ID to exclude from conflict check
   * @param {boolean} skipDebounce - Skip debouncing for immediate checks
   * @returns {Object|null} Conflict details if found, null otherwise
   */
  async checkTeacherConflict(
    teacherId,
    day,
    periodIndex,
    excludeClassId = null,
    skipDebounce = false,
    schoolId = null,
    academicYear = null
  ) {
    // Cache key must include academicYear so last-year conflicts are not
    // served on this-year lookups (and vice-versa).
    const cacheKey = `conflict:${teacherId}:${day}:${periodIndex}:${excludeClassId || 'none'}:${academicYear || 'any'}`;
    const cached = await cacheService.get(cacheKey);
    if (cached !== null) {
      return cached;
    }

    // Skip debounce in test environment or when explicitly requested
    const shouldSkipDebounce = skipDebounce || process.env.NODE_ENV === 'test';

    const result = shouldSkipDebounce
      ? await this._checkTeacherConflictInternal(
          teacherId,
          day,
          periodIndex,
          excludeClassId,
          schoolId,
          academicYear
        )
      : await this.debouncedConflictCheck(
          teacherId,
          day,
          periodIndex,
          excludeClassId,
          schoolId,
          academicYear
        );

    // Cache the result for 30 seconds
    cacheService.set(cacheKey, result, 30000).catch(() => {}); // fire-and-forget
    return result;
  }

  /**
   * Internal method for checking teacher conflicts (not debounced)
   * @private
   */
  async _checkTeacherConflictInternal(
    teacherId,
    day,
    periodIndex,
    excludeClassId = null,
    schoolId = null,
    academicYear = null
  ) {
    try {
      // Find all timetables where this teacher is assigned at this time slot.
      // academicYear MUST scope the query — without it, a teacher still listed
      // in last-year's Timetable at the same day/period produced a false
      // conflict against their this-year assignment.
      const query = {};
      query[`schedule.${day}.teacherId`] = teacherId;
      if (schoolId) query.schoolId = schoolId;
      if (academicYear) query.academicYear = academicYear;

      const conflictingTimetables = await Timetable.find(query).populate('classId', 'name section');

      // Filter to the specific period and exclude the specified class if provided
      const conflicts = [];
      for (const timetable of conflictingTimetables) {
        const daySchedule = timetable.schedule[day];
        if (daySchedule && daySchedule[periodIndex]) {
          const slot = daySchedule[periodIndex];
          if (slot.teacherId && slot.teacherId.toString() === teacherId.toString()) {
            // Exclude the specified class if provided
            if (!excludeClassId || timetable.classId._id.toString() !== excludeClassId.toString()) {
              conflicts.push({
                classId: timetable.classId._id,
                className: `${timetable.classId.name} ${timetable.classId.section}`,
                subject: slot.subject,
                room: slot.room,
                day: day,
                periodIndex: periodIndex,
              });
            }
          }
        }
      }

      // If conflicts found, return the first one with details
      if (conflicts.length > 0) {
        const teacher = await Staff.findById(teacherId).select('name code');
        return {
          type: 'double_booking',
          teacherId: teacherId,
          teacherName: teacher ? teacher.name : 'Unknown',
          teacherCode: teacher ? teacher.code : 'Unknown',
          day: day,
          periodIndex: periodIndex,
          conflicts: conflicts,
          message: `Teacher ${teacher ? teacher.name : 'Unknown'} is already assigned to ${conflicts[0].className} for ${conflicts[0].subject} at ${day} Period ${periodIndex + 1}`,
        };
      }

      return null;
    } catch (error) {
      logger.error({ err: error, teacherId }, 'Error checking teacher conflict');
      throw error;
    }
  }

  /**
   * Get all conflicts for a teacher in a specific academic year
   * @param {string} teacherId - The teacher's ID
   * @param {string} academicYear - Academic year (e.g., CURRENT_ACADEMIC_YEAR)
   * @returns {Array} Array of conflict objects
   */
  async getTeacherConflicts(teacherId, academicYear = CURRENT_ACADEMIC_YEAR, schoolId = null) {
    try {
      const conflicts = [];
      const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      // Get all timetables for this academic year where the teacher is assigned
      const findQuery = {
        academicYear: academicYear,
        $or: days.map((day) => ({
          [`schedule.${day}.teacherId`]: teacherId,
        })),
      };
      if (schoolId) findQuery.schoolId = schoolId;
      const timetables = await Timetable.find(findQuery).populate('classId', 'name section');

      // Build a map of teacher assignments by day and period
      const assignmentMap = {};

      for (const timetable of timetables) {
        for (const day of days) {
          const daySchedule = timetable.schedule[day];
          if (daySchedule) {
            daySchedule.forEach((slot, periodIndex) => {
              if (slot.teacherId && slot.teacherId.toString() === teacherId.toString()) {
                const key = `${day}-${periodIndex}`;
                if (!assignmentMap[key]) {
                  assignmentMap[key] = [];
                }
                assignmentMap[key].push({
                  classId: timetable.classId._id,
                  className: `${timetable.classId.name} ${timetable.classId.section}`,
                  subject: slot.subject,
                  room: slot.room,
                });
              }
            });
          }
        }
      }

      // Find conflicts (where teacher is assigned to multiple classes at same time)
      for (const [key, assignments] of Object.entries(assignmentMap)) {
        if (assignments.length > 1) {
          const [day, periodIndex] = key.split('-');
          const teacher = await Staff.findById(teacherId).select('name code');

          conflicts.push({
            type: 'double_booking',
            teacherId: teacherId,
            teacherName: teacher ? teacher.name : 'Unknown',
            teacherCode: teacher ? teacher.code : 'Unknown',
            day: day,
            periodIndex: parseInt(periodIndex),
            conflicts: assignments,
            message: `Teacher ${teacher ? teacher.name : 'Unknown'} is assigned to multiple classes at ${day} Period ${parseInt(periodIndex) + 1}`,
          });
        }
      }

      return conflicts;
    } catch (error) {
      logger.error({ err: error, teacherId }, 'Error getting teacher conflicts');
      throw error;
    }
  }

  /**
   * Validate if a teacher can be assigned to a specific slot
   * @param {string} teacherId - The teacher's ID
   * @param {string} classId - The class ID
   * @param {string} subject - The subject
   * @param {string} day - Day of the week
   * @param {number} periodIndex - Index of the period
   * @param {boolean} strictMode - If true, enforce qualification checks; if false, only check conflicts
   * @returns {Object} Validation result with isValid flag and error/warning details
   */
  async validateSlotAssignment(
    teacherId,
    classId,
    subject,
    day,
    periodIndex,
    strictMode = true,
    schoolId = null,
    academicYear = null
  ) {
    try {
      // Always check for time conflicts (hard validation)
      const timeConflict = await this.checkTeacherConflict(
        teacherId,
        day,
        periodIndex,
        classId,
        false,
        schoolId,
        academicYear
      );
      if (timeConflict) {
        return {
          isValid: false,
          error: timeConflict,
        };
      }

      // Check if teacher is qualified (has assignment for this subject and class)
      const teacher = await Staff.findById(teacherId);
      if (!teacher) {
        return {
          isValid: false,
          error: {
            type: 'invalid_assignment',
            message: 'Teacher not found',
          },
        };
      }

      const hasQualification = teacher.teacherAssignments.some(
        (assignment) =>
          assignment.subject === subject &&
          assignment.classes.some((c) => c.toString() === classId.toString())
      );

      // In strict mode, qualification is required
      // In flexible mode (default), qualification is optional (just a warning)
      if (!hasQualification) {
        if (strictMode) {
          return {
            isValid: false,
            error: {
              type: 'unqualified',
              teacherId: teacherId,
              teacherName: teacher.name,
              classId: classId,
              subject: subject,
              message: `Teacher ${teacher.name} is not qualified to teach ${subject} in this class`,
            },
          };
        } else {
          // Flexible mode: allow assignment but return a warning
          return {
            isValid: true,
            warning: {
              type: 'unqualified',
              teacherId: teacherId,
              teacherName: teacher.name,
              classId: classId,
              subject: subject,
              message: `Teacher ${teacher.name} is not formally assigned to teach ${subject} in this class. Consider adding this assignment in Staff Management.`,
            },
          };
        }
      }

      return {
        isValid: true,
      };
    } catch (error) {
      logger.error({ err: error, teacherId, classId, subject }, 'Error validating slot assignment');
      throw error;
    }
  }

  /**
   * Log a conflict to the database
   * @param {Object} conflictData - Conflict details
   * @returns {Object} Created conflict log
   */
  async logConflict(conflictData) {
    try {
      const conflictLog = await ConflictLog.create({
        schoolId: conflictData.schoolId || null,
        teacherId: conflictData.teacherId,
        conflictType: conflictData.type,
        day: conflictData.day,
        periodIndex: conflictData.periodIndex,
        classes: conflictData.conflicts ? conflictData.conflicts.map((c) => c.classId) : [],
        subject:
          conflictData.subject ||
          (conflictData.conflicts && conflictData.conflicts[0]
            ? conflictData.conflicts[0].subject
            : null),
        status: 'active',
      });

      return conflictLog;
    } catch (error) {
      logger.error({ err: error }, 'Error logging conflict');
      throw error;
    }
  }

  /**
   * Resolve a conflict
   * @param {string} conflictId - The conflict log ID
   * @param {string} resolvedBy - Staff ID who resolved the conflict
   * @param {string} resolution - Description of how it was resolved
   * @returns {Object} Updated conflict log
   */
  async resolveConflict(conflictId, resolvedBy, resolution) {
    try {
      const conflictLog = await ConflictLog.findByIdAndUpdate(
        conflictId,
        {
          status: 'resolved',
          resolvedAt: new Date(),
          resolvedBy: resolvedBy,
          resolution: resolution,
        },
        { new: true }
      );

      return conflictLog;
    } catch (error) {
      logger.error({ err: error, conflictId }, 'Error resolving conflict');
      throw error;
    }
  }
}

export default new ConflictDetectionService();
