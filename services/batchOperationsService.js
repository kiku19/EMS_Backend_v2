import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';
import { Timetable, TeacherTimetable } from '../database.js';
import timetableService from './timetableService.js';
import conflictDetectionService from './conflictDetectionService.js';
import cacheService from './cacheService.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('BatchOperations');

/**
 * Service for handling batch operations on timetables
 * Optimizes multiple slot updates by batching database operations
 */
class BatchOperationsService {
  /**
   * Update multiple slots in a class timetable
   * @param {Object} options - Batch update options
   * @param {string} options.classId - Class ID
   * @param {Array} options.slots - Array of slot updates
   * @param {string} options.academicYear - Academic year
   * @param {string} options.modifiedBy - User ID making changes
   * @returns {Promise<Object>} Result with success status and conflicts
   */
  async batchUpdateClassSlots(options) {
    const { classId, slots, academicYear = CURRENT_ACADEMIC_YEAR, modifiedBy } = options;

    if (!classId || !slots || !Array.isArray(slots) || slots.length === 0) {
      throw new Error('Invalid batch update parameters');
    }

    const results = {
      success: [],
      conflicts: [],
      errors: [],
    };

    // Step 1: Validate all slots for conflicts before making any changes
    const validationPromises = slots.map(async (slot) => {
      const { day, periodIndex, teacherId, subject } = slot;

      if (!teacherId) {
        return { valid: true, slot };
      }

      try {
        // Check for conflicts (skip debounce for batch operations). Scope by
        // academicYear so last-year timetable entries don't produce false
        // conflicts against this-year assignments.
        const conflict = await conflictDetectionService.checkTeacherConflict(
          teacherId,
          day,
          periodIndex,
          classId,
          true, // Skip debounce
          options.schoolId || null,
          academicYear,
          true // skipCache — write-path, must see freshest state (CT16)
        );

        if (conflict) {
          return { valid: false, slot, conflict };
        }

        // Validate teacher qualification
        const validation = await conflictDetectionService.validateSlotAssignment(
          teacherId,
          classId,
          subject,
          day,
          periodIndex,
          true,
          options.schoolId || null,
          academicYear
        );

        return { valid: validation.isValid, slot, error: validation.error };
      } catch (error) {
        return { valid: false, slot, error: { message: error.message } };
      }
    });

    const validations = await Promise.all(validationPromises);

    // Collect conflicts and errors
    const invalidSlots = validations.filter((v) => !v.valid);
    if (invalidSlots.length > 0) {
      invalidSlots.forEach(({ slot, conflict, error }) => {
        if (conflict) {
          results.conflicts.push({ slot, conflict });
        } else if (error) {
          results.errors.push({ slot, error });
        }
      });

      // If there are any conflicts or errors, don't proceed with updates
      return {
        success: false,
        message: 'Batch update aborted due to conflicts or validation errors',
        results,
      };
    }

    // Step 2: Get the class timetable once
    const classTimetable = await Timetable.findOne({ classId, academicYear });
    if (!classTimetable) {
      throw new Error(`Class timetable not found for classId: ${classId}`);
    }

    // Store original state for rollback
    const originalSchedule = JSON.parse(JSON.stringify(classTimetable.schedule));

    try {
      // Step 3: Apply all updates to the class timetable
      const teacherUpdates = new Map(); // Track teacher timetable updates

      for (const slot of slots) {
        const { day, periodIndex, subject, teacherId, room = '' } = slot;

        // Initialize day schedule if needed
        if (!classTimetable.schedule[day]) {
          classTimetable.schedule[day] = [];
        }

        // Ensure array has enough slots
        while (classTimetable.schedule[day].length <= periodIndex) {
          classTimetable.schedule[day].push({});
        }

        // Get old teacher ID
        const oldTeacherId = classTimetable.schedule[day][periodIndex]?.teacherId;

        // Update the slot
        classTimetable.schedule[day][periodIndex] = {
          subject: subject || '',
          teacherId: teacherId || null,
          room: room || '',
          lastModified: new Date(),
          modifiedBy: modifiedBy || null,
        };

        // Track teacher updates
        if (oldTeacherId && oldTeacherId.toString() !== teacherId?.toString()) {
          // Remove from old teacher
          if (!teacherUpdates.has(oldTeacherId.toString())) {
            teacherUpdates.set(oldTeacherId.toString(), { add: [], remove: [] });
          }
          teacherUpdates.get(oldTeacherId.toString()).remove.push({ day, periodIndex });
        }

        if (teacherId) {
          // Add to new teacher
          if (!teacherUpdates.has(teacherId.toString())) {
            teacherUpdates.set(teacherId.toString(), { add: [], remove: [] });
          }
          teacherUpdates.get(teacherId.toString()).add.push({
            day,
            periodIndex,
            classId,
            subject,
            room,
          });
        }

        results.success.push({ slot, status: 'updated' });
      }

      // Update version and sync time
      classTimetable.version += 1;
      classTimetable.lastSyncedAt = new Date();

      // Save class timetable
      await classTimetable.save();

      // Step 4: Batch update teacher timetables
      const teacherUpdatePromises = Array.from(teacherUpdates.entries()).map(
        async ([teacherId, updates]) => {
          let teacherTimetable = await TeacherTimetable.findOne({
            teacherId,
            academicYear,
          });

          if (!teacherTimetable) {
            teacherTimetable = new TeacherTimetable({
              teacherId,
              academicYear,
              schedule: {},
            });
          }

          // Apply removals
          for (const { day, periodIndex } of updates.remove) {
            if (teacherTimetable.schedule[day]) {
              teacherTimetable.schedule[day] = teacherTimetable.schedule[day].filter(
                (slot) =>
                  !(
                    slot.periodIndex === periodIndex &&
                    slot.classId?.toString() === classId.toString()
                  )
              );
            }
          }

          // Apply additions
          for (const { day, periodIndex, classId: cId, subject, room } of updates.add) {
            if (!teacherTimetable.schedule[day]) {
              teacherTimetable.schedule[day] = [];
            }

            // Remove existing slot at this period
            teacherTimetable.schedule[day] = teacherTimetable.schedule[day].filter(
              (slot) => slot.periodIndex !== periodIndex
            );

            // Add new slot
            teacherTimetable.schedule[day].push({
              periodIndex,
              classId: cId,
              subject,
              room,
              lastModified: new Date(),
            });

            // Sort by periodIndex
            teacherTimetable.schedule[day].sort((a, b) => a.periodIndex - b.periodIndex);
          }

          teacherTimetable.version += 1;
          teacherTimetable.lastSyncedAt = new Date();

          await teacherTimetable.save();

          // Invalidate teacher cache
          cacheService.invalidateTeacherCache(teacherId);
        }
      );

      await Promise.all(teacherUpdatePromises);

      // Invalidate class cache
      cacheService.invalidateClassCache(classId);

      return {
        success: true,
        message: `Successfully updated ${slots.length} slots`,
        results,
      };
    } catch (error) {
      // Rollback class timetable on failure
      logger.error({ err: error }, 'Batch update failed, rolling back');

      try {
        await Timetable.findOneAndUpdate({ classId, academicYear }, { schedule: originalSchedule });
      } catch (rollbackError) {
        logger.error({ err: rollbackError }, 'Rollback failed');
      }

      throw error;
    }
  }

  /**
   * Update multiple slots in a teacher timetable
   * @param {Object} options - Batch update options
   * @param {string} options.teacherId - Teacher ID
   * @param {Array} options.slots - Array of slot updates
   * @param {string} options.academicYear - Academic year
   * @returns {Promise<Object>} Result with success status
   */
  async batchUpdateTeacherSlots(options) {
    const { teacherId, slots, academicYear = CURRENT_ACADEMIC_YEAR } = options;

    if (!teacherId || !slots || !Array.isArray(slots) || slots.length === 0) {
      throw new Error('Invalid batch update parameters');
    }

    const results = {
      success: [],
      conflicts: [],
      errors: [],
    };

    // Validate all slots first
    const validationPromises = slots.map(async (slot) => {
      const { day, periodIndex, classId, subject } = slot;

      if (!classId) {
        return { valid: true, slot };
      }

      try {
        // Check for conflicts — scope by academicYear so last-year entries
        // don't produce false-positive double-booking errors.
        const conflict = await conflictDetectionService.checkTeacherConflict(
          teacherId,
          day,
          periodIndex,
          classId,
          true, // Skip debounce
          options.schoolId || null,
          academicYear,
          true // skipCache — write-path, must see freshest state (CT16)
        );

        if (conflict) {
          return { valid: false, slot, conflict };
        }

        // Validate teacher qualification
        const validation = await conflictDetectionService.validateSlotAssignment(
          teacherId,
          classId,
          subject,
          day,
          periodIndex,
          true,
          options.schoolId || null,
          academicYear
        );

        return { valid: validation.isValid, slot, error: validation.error };
      } catch (error) {
        return { valid: false, slot, error: { message: error.message } };
      }
    });

    const validations = await Promise.all(validationPromises);

    // Collect conflicts and errors
    const invalidSlots = validations.filter((v) => !v.valid);
    if (invalidSlots.length > 0) {
      invalidSlots.forEach(({ slot, conflict, error }) => {
        if (conflict) {
          results.conflicts.push({ slot, conflict });
        } else if (error) {
          results.errors.push({ slot, error });
        }
      });

      return {
        success: false,
        message: 'Batch update aborted due to conflicts or validation errors',
        results,
      };
    }

    // Get teacher timetable
    let teacherTimetable = await TeacherTimetable.findOne({ teacherId, academicYear });
    if (!teacherTimetable) {
      teacherTimetable = new TeacherTimetable({
        teacherId,
        academicYear,
        schedule: {},
      });
    }

    const originalSchedule = JSON.parse(JSON.stringify(teacherTimetable.schedule));

    try {
      // Track class updates
      const classUpdates = new Map();

      // Apply all updates
      for (const slot of slots) {
        const { day, periodIndex, classId, subject, room = '' } = slot;

        if (!teacherTimetable.schedule[day]) {
          teacherTimetable.schedule[day] = [];
        }

        // Get old class ID
        const oldSlot = teacherTimetable.schedule[day].find((s) => s.periodIndex === periodIndex);
        const oldClassId = oldSlot?.classId;

        // Remove old slot
        teacherTimetable.schedule[day] = teacherTimetable.schedule[day].filter(
          (s) => s.periodIndex !== periodIndex
        );

        // Add new slot if classId provided
        if (classId) {
          teacherTimetable.schedule[day].push({
            periodIndex,
            classId,
            subject,
            room,
            lastModified: new Date(),
          });
        }

        // Sort by periodIndex
        teacherTimetable.schedule[day].sort((a, b) => a.periodIndex - b.periodIndex);

        // Track class updates
        if (oldClassId && oldClassId.toString() !== classId?.toString()) {
          if (!classUpdates.has(oldClassId.toString())) {
            classUpdates.set(oldClassId.toString(), { add: [], remove: [] });
          }
          classUpdates.get(oldClassId.toString()).remove.push({ day, periodIndex });
        }

        if (classId) {
          if (!classUpdates.has(classId.toString())) {
            classUpdates.set(classId.toString(), { add: [], remove: [] });
          }
          classUpdates.get(classId.toString()).add.push({
            day,
            periodIndex,
            teacherId,
            subject,
            room,
          });
        }

        results.success.push({ slot, status: 'updated' });
      }

      teacherTimetable.version += 1;
      teacherTimetable.lastSyncedAt = new Date();
      await teacherTimetable.save();

      // Batch update class timetables
      const classUpdatePromises = Array.from(classUpdates.entries()).map(
        async ([classId, updates]) => {
          const classTimetable = await Timetable.findOne({ classId, academicYear });
          if (!classTimetable) return;

          // Apply updates
          for (const { day, periodIndex } of updates.remove) {
            if (classTimetable.schedule[day] && classTimetable.schedule[day][periodIndex]) {
              if (
                classTimetable.schedule[day][periodIndex].teacherId?.toString() ===
                teacherId.toString()
              ) {
                classTimetable.schedule[day][periodIndex] = {
                  subject: '',
                  teacherId: null,
                  room: '',
                  lastModified: new Date(),
                  modifiedBy: null,
                };
              }
            }
          }

          for (const { day, periodIndex, subject, room } of updates.add) {
            if (!classTimetable.schedule[day]) {
              classTimetable.schedule[day] = [];
            }

            while (classTimetable.schedule[day].length <= periodIndex) {
              classTimetable.schedule[day].push({});
            }

            classTimetable.schedule[day][periodIndex] = {
              subject,
              teacherId,
              room,
              lastModified: new Date(),
              modifiedBy: null,
            };
          }

          classTimetable.version += 1;
          classTimetable.lastSyncedAt = new Date();
          await classTimetable.save();

          // Invalidate class cache
          cacheService.invalidateClassCache(classId);
        }
      );

      await Promise.all(classUpdatePromises);

      // Invalidate teacher cache
      cacheService.invalidateTeacherCache(teacherId);

      return {
        success: true,
        message: `Successfully updated ${slots.length} slots`,
        results,
      };
    } catch (error) {
      logger.error({ err: error }, 'Batch update failed, rolling back');

      try {
        await TeacherTimetable.findOneAndUpdate(
          { teacherId, academicYear },
          { schedule: originalSchedule }
        );
      } catch (rollbackError) {
        logger.error({ err: rollbackError }, 'Rollback failed');
      }

      throw error;
    }
  }
}

export default new BatchOperationsService();
