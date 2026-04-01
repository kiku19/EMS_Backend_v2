import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';
import { Timetable, TeacherTimetable, Class, Staff } from '../database.js';
import mongoose from 'mongoose';
import cacheService from './cacheService.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('TimetableService');

/**
 * Service for managing timetable synchronization between class and teacher views
 * Implements bidirectional sync with rollback capability and version tracking
 */
class TimetableService {
  /**
   * Compute the total number of periods per week from a teacher timetable schedule.
   * Counts all non-empty slots across all days.
   * @param {Object} schedule - The schedule map { Monday: [...], Tuesday: [...], ... }
   * @returns {number} Total periods count
   * @private
   */
  _computeTotalPeriodsPerWeek(schedule) {
    if (!schedule) return 0;
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days.reduce((sum, day) => sum + (schedule[day]?.length || 0), 0);
  }

  /**
   * Synchronize timetables bidirectionally
   * @param {Object} options - Synchronization options
   * @param {string} options.sourceType - 'class' or 'teacher'
   * @param {string} options.sourceId - ID of the source (classId or teacherId)
   * @param {string} options.day - Day of the week
   * @param {number} options.periodIndex - Period index
   * @param {Object} options.slotData - Slot data to sync
   * @param {string} options.academicYear - Academic year
   * @param {string} options.modifiedBy - ID of user making the change
   * @returns {Promise<Object>} - Sync result with success status
   */
  async syncTimetables(options) {
    const {
      sourceType,
      sourceId,
      day,
      periodIndex,
      slotData,
      academicYear = CURRENT_ACADEMIC_YEAR,
      modifiedBy,
      schoolId,
    } = options;

    // Validate inputs
    if (!['class', 'teacher'].includes(sourceType)) {
      throw new Error('Invalid sourceType. Must be "class" or "teacher"');
    }

    if (!sourceId || !day || periodIndex === undefined) {
      throw new Error('Missing required parameters: sourceId, day, or periodIndex');
    }

    // WARNING: Transactions are disabled (session = null) for compatibility with
    // non-replica-set environments. Without transactions, a failure mid-sync can
    // leave class and teacher timetables out of sync. The caller MUST NOT silently
    // fall back to a partial save — it should surface the error instead.
    // TODO: Enable transactions when running with a replica set in production.
    const session = null;

    try {
      let result;

      if (sourceType === 'class') {
        result = await this._syncFromClassToTeacher({
          classId: sourceId,
          day,
          periodIndex,
          slotData,
          academicYear,
          modifiedBy,
          schoolId,
          session,
        });

        // Invalidate cache for affected class and teacher
        cacheService.invalidateClassCache(sourceId);
        if (slotData.teacherId) {
          cacheService.invalidateTeacherCache(slotData.teacherId);
        }
        if (result.oldTeacherId) {
          cacheService.invalidateTeacherCache(result.oldTeacherId);
        }
      } else {
        result = await this._syncFromTeacherToClass({
          teacherId: sourceId,
          day,
          periodIndex,
          slotData,
          academicYear,
          modifiedBy,
          schoolId,
          session,
        });

        // Invalidate cache for affected teacher and classes
        cacheService.invalidateTeacherCache(sourceId);
        if (slotData.classId) {
          cacheService.invalidateClassCache(slotData.classId);
        }
        if (result.oldClassId) {
          cacheService.invalidateClassCache(result.oldClassId);
        }
      }

      return { success: true, ...result };
    } catch (error) {
      logger.error({ err: error, sourceType, sourceId }, 'Timetable synchronization failed');
      throw error;
    }
  }

  /**
   * Sync from class timetable to teacher timetable
   * @private
   */
  async _syncFromClassToTeacher({
    classId,
    day,
    periodIndex,
    slotData,
    academicYear,
    modifiedBy,
    schoolId,
    session,
  }) {
    // Get or create class timetable
    const query = { classId, academicYear };
    if (!schoolId) throw new Error('schoolId is required for timetable operations');
    query.schoolId = schoolId;
    const classTimetable = session
      ? await Timetable.findOne(query).session(session)
      : await Timetable.findOne(query);

    if (!classTimetable) {
      throw new Error(`Class timetable not found for classId: ${classId}`);
    }

    // Store original state for rollback
    const originalClassSchedule = JSON.parse(JSON.stringify(classTimetable.schedule));

    // Update class timetable
    if (!classTimetable.schedule[day]) {
      classTimetable.schedule[day] = [];
    }

    // Ensure the array has enough slots
    while (classTimetable.schedule[day].length <= periodIndex) {
      classTimetable.schedule[day].push({});
    }

    // Get the old teacher ID before updating
    const oldTeacherId = classTimetable.schedule[day][periodIndex]?.teacherId;

    // Update the slot
    classTimetable.schedule[day][periodIndex] = {
      subject: slotData.subject || '',
      teacherId: slotData.teacherId || null,
      room: slotData.room || '',
      lastModified: new Date(),
      modifiedBy: modifiedBy || null,
    };

    classTimetable.version += 1;
    classTimetable.lastSyncedAt = new Date();

    if (session) {
      await classTimetable.save({ session });
    } else {
      await classTimetable.save();
    }

    // Remove from old teacher's timetable if teacher changed
    if (oldTeacherId && oldTeacherId.toString() !== slotData.teacherId?.toString()) {
      await this._removeFromTeacherTimetable({
        teacherId: oldTeacherId,
        classId,
        day,
        periodIndex,
        academicYear,
        schoolId,
        session,
      });
    }

    // Add to new teacher's timetable if teacher is assigned
    if (slotData.teacherId) {
      await this._addToTeacherTimetable({
        teacherId: slotData.teacherId,
        classId,
        day,
        periodIndex,
        subject: slotData.subject,
        room: slotData.room,
        academicYear,
        schoolId,
        session,
      });
    }

    return {
      classTimetable,
      oldTeacherId,
      newTeacherId: slotData.teacherId,
    };
  }

  /**
   * Sync from teacher timetable to class timetable
   * @private
   */
  async _syncFromTeacherToClass({
    teacherId,
    day,
    periodIndex,
    slotData,
    academicYear,
    modifiedBy,
    schoolId,
    session,
  }) {
    // Get or create teacher timetable
    const query = { teacherId, academicYear };
    if (!schoolId) throw new Error('schoolId is required for timetable operations');
    query.schoolId = schoolId;
    let teacherTimetable = session
      ? await TeacherTimetable.findOne(query).session(session)
      : await TeacherTimetable.findOne(query);

    if (!teacherTimetable) {
      // Create new teacher timetable
      teacherTimetable = new TeacherTimetable({
        teacherId,
        academicYear,
        schoolId,
        schedule: {},
      });
    }

    // Store original state for rollback
    const originalTeacherSchedule = JSON.parse(JSON.stringify(teacherTimetable.schedule));

    // Initialize day schedule if needed
    if (!teacherTimetable.schedule[day]) {
      teacherTimetable.schedule[day] = [];
    }

    // Get the old class ID before updating
    const oldSlot = teacherTimetable.schedule[day].find((slot) => slot.periodIndex === periodIndex);
    const oldClassId = oldSlot?.classId;

    // Remove old slot if exists
    teacherTimetable.schedule[day] = teacherTimetable.schedule[day].filter(
      (slot) => slot.periodIndex !== periodIndex
    );

    // Add new slot if classId is provided
    if (slotData.classId) {
      teacherTimetable.schedule[day].push({
        periodIndex,
        classId: slotData.classId,
        subject: slotData.subject || '',
        room: slotData.room || '',
        lastModified: new Date(),
      });
    }

    // Sort by periodIndex
    teacherTimetable.schedule[day].sort((a, b) => a.periodIndex - b.periodIndex);

    teacherTimetable.totalPeriodsPerWeek = this._computeTotalPeriodsPerWeek(
      teacherTimetable.schedule
    );
    teacherTimetable.version += 1;
    teacherTimetable.lastSyncedAt = new Date();

    if (session) {
      await teacherTimetable.save({ session });
    } else {
      await teacherTimetable.save();
    }

    // Remove teacher from old class timetable if class changed
    if (oldClassId && oldClassId.toString() !== slotData.classId?.toString()) {
      await this._removeFromClassTimetable({
        classId: oldClassId,
        teacherId,
        day,
        periodIndex,
        academicYear,
        schoolId,
        session,
      });
    }

    // Add teacher to new class timetable if class is assigned
    if (slotData.classId) {
      await this._addToClassTimetable({
        classId: slotData.classId,
        teacherId,
        day,
        periodIndex,
        subject: slotData.subject,
        room: slotData.room,
        academicYear,
        modifiedBy,
        schoolId,
        session,
      });
    }

    return {
      teacherTimetable,
      oldClassId,
      newClassId: slotData.classId,
    };
  }

  /**
   * Add teacher to class timetable
   * Auto-creates class timetable if it doesn't exist
   * @private
   */
  async _addToClassTimetable({
    classId,
    teacherId,
    day,
    periodIndex,
    subject,
    room,
    academicYear,
    modifiedBy,
    schoolId,
    session,
  }) {
    const query = { classId, academicYear };
    if (!schoolId) throw new Error('schoolId is required for timetable operations');
    query.schoolId = schoolId;
    let classTimetable = session
      ? await Timetable.findOne(query).session(session)
      : await Timetable.findOne(query);

    // Auto-create class timetable if it doesn't exist
    if (!classTimetable) {
      // Get default periods from school settings or use defaults
      const defaultPeriods = [
        { name: 'Period 1', startTime: '08:00', endTime: '08:45', isBreak: false },
        { name: 'Period 2', startTime: '08:45', endTime: '09:30', isBreak: false },
        { name: 'Break', startTime: '09:30', endTime: '09:45', isBreak: true },
        { name: 'Period 3', startTime: '09:45', endTime: '10:30', isBreak: false },
        { name: 'Period 4', startTime: '10:30', endTime: '11:15', isBreak: false },
        { name: 'Lunch', startTime: '11:15', endTime: '12:00', isBreak: true },
        { name: 'Period 5', startTime: '12:00', endTime: '12:45', isBreak: false },
        { name: 'Period 6', startTime: '12:45', endTime: '13:30', isBreak: false },
      ];

      const emptySchedule = {
        Monday: [],
        Tuesday: [],
        Wednesday: [],
        Thursday: [],
        Friday: [],
        Saturday: [],
      };

      classTimetable = new Timetable({
        classId,
        schoolId,
        academicYear,
        periods: defaultPeriods,
        schedule: emptySchedule,
        metadata: {
          createdBy: modifiedBy,
          lastModifiedBy: modifiedBy,
          version: 1,
        },
      });

      if (session) {
        await classTimetable.save({ session });
      } else {
        await classTimetable.save();
      }
    }

    if (!classTimetable.schedule[day]) {
      classTimetable.schedule[day] = [];
    }

    // Ensure the array has enough slots
    while (classTimetable.schedule[day].length <= periodIndex) {
      classTimetable.schedule[day].push({});
    }

    classTimetable.schedule[day][periodIndex] = {
      subject: subject || '',
      teacherId: teacherId,
      room: room || '',
      lastModified: new Date(),
      modifiedBy: modifiedBy || null,
    };

    classTimetable.version += 1;
    classTimetable.lastSyncedAt = new Date();

    if (session) {
      await classTimetable.save({ session });
    } else {
      await classTimetable.save();
    }
  }

  /**
   * Remove teacher from class timetable
   * @private
   */
  async _removeFromClassTimetable({
    classId,
    teacherId,
    day,
    periodIndex,
    academicYear,
    schoolId,
    session,
  }) {
    const query = { classId, academicYear };
    if (!schoolId) throw new Error('schoolId is required for timetable operations');
    query.schoolId = schoolId;
    const classTimetable = session
      ? await Timetable.findOne(query).session(session)
      : await Timetable.findOne(query);

    if (
      !classTimetable ||
      !classTimetable.schedule[day] ||
      !classTimetable.schedule[day][periodIndex]
    ) {
      return; // Nothing to remove
    }

    // Only remove if the teacher matches
    if (classTimetable.schedule[day][periodIndex].teacherId?.toString() === teacherId.toString()) {
      classTimetable.schedule[day][periodIndex] = {
        subject: '',
        teacherId: null,
        room: '',
        lastModified: new Date(),
        modifiedBy: null,
      };

      classTimetable.version += 1;
      classTimetable.lastSyncedAt = new Date();

      if (session) {
        await classTimetable.save({ session });
      } else {
        await classTimetable.save();
      }
    }
  }

  /**
   * Add class to teacher timetable
   * @private
   */
  async _addToTeacherTimetable({
    teacherId,
    classId,
    day,
    periodIndex,
    subject,
    room,
    academicYear,
    schoolId,
    session,
  }) {
    const query = { teacherId, academicYear };
    if (!schoolId) throw new Error('schoolId is required for timetable operations');
    query.schoolId = schoolId;
    let teacherTimetable = session
      ? await TeacherTimetable.findOne(query).session(session)
      : await TeacherTimetable.findOne(query);

    if (!teacherTimetable) {
      teacherTimetable = new TeacherTimetable({
        teacherId,
        academicYear,
        schoolId,
        schedule: {},
      });
    }

    if (!teacherTimetable.schedule[day]) {
      teacherTimetable.schedule[day] = [];
    }

    // Remove existing slot at this period if any
    teacherTimetable.schedule[day] = teacherTimetable.schedule[day].filter(
      (slot) => slot.periodIndex !== periodIndex
    );

    // Add new slot
    teacherTimetable.schedule[day].push({
      periodIndex,
      classId: classId,
      subject: subject || '',
      room: room || '',
      lastModified: new Date(),
    });

    // Sort by periodIndex
    teacherTimetable.schedule[day].sort((a, b) => a.periodIndex - b.periodIndex);

    teacherTimetable.totalPeriodsPerWeek = this._computeTotalPeriodsPerWeek(
      teacherTimetable.schedule
    );
    teacherTimetable.version += 1;
    teacherTimetable.lastSyncedAt = new Date();

    if (session) {
      await teacherTimetable.save({ session });
    } else {
      await teacherTimetable.save();
    }
  }

  /**
   * Remove class from teacher timetable
   * @private
   */
  async _removeFromTeacherTimetable({
    teacherId,
    classId,
    day,
    periodIndex,
    academicYear,
    schoolId,
    session,
  }) {
    const query = { teacherId, academicYear };
    if (!schoolId) throw new Error('schoolId is required for timetable operations');
    query.schoolId = schoolId;
    const teacherTimetable = session
      ? await TeacherTimetable.findOne(query).session(session)
      : await TeacherTimetable.findOne(query);

    if (!teacherTimetable || !teacherTimetable.schedule[day]) {
      return; // Nothing to remove
    }

    // Remove the slot at this period if it matches the class
    teacherTimetable.schedule[day] = teacherTimetable.schedule[day].filter(
      (slot) =>
        !(slot.periodIndex === periodIndex && slot.classId?.toString() === classId.toString())
    );

    teacherTimetable.totalPeriodsPerWeek = this._computeTotalPeriodsPerWeek(
      teacherTimetable.schedule
    );
    teacherTimetable.version += 1;
    teacherTimetable.lastSyncedAt = new Date();

    if (session) {
      await teacherTimetable.save({ session });
    } else {
      await teacherTimetable.save();
    }
  }

  /**
   * Delete a slot from class timetable and sync to teacher
   */
  async deleteClassSlot({
    classId,
    day,
    periodIndex,
    academicYear = CURRENT_ACADEMIC_YEAR,
    schoolId,
  }) {
    // Proceed without transactions for compatibility
    const session = null;

    const query = { classId, academicYear };
    if (!schoolId) throw new Error('schoolId is required for timetable operations');
    query.schoolId = schoolId;
    const classTimetable = await Timetable.findOne(query);

    if (
      !classTimetable ||
      !classTimetable.schedule[day] ||
      !classTimetable.schedule[day][periodIndex]
    ) {
      return { success: true, message: 'Slot already empty' };
    }

    const teacherId = classTimetable.schedule[day][periodIndex].teacherId;

    // Clear the slot
    classTimetable.schedule[day][periodIndex] = {
      subject: '',
      teacherId: null,
      room: '',
      lastModified: new Date(),
      modifiedBy: null,
    };

    classTimetable.version += 1;
    classTimetable.lastSyncedAt = new Date();
    await classTimetable.save();

    // Invalidate cache for affected class and teacher
    cacheService.invalidateClassCache(classId);
    if (teacherId) {
      cacheService.invalidateTeacherCache(teacherId);
    }

    // Remove from teacher timetable if teacher was assigned
    if (teacherId) {
      await this._removeFromTeacherTimetable({
        teacherId,
        classId,
        day,
        periodIndex,
        academicYear,
        schoolId,
        session,
      });
    }

    return { success: true, teacherId };
  }

  /**
   * Delete a slot from teacher timetable and sync to class
   */
  async deleteTeacherSlot({
    teacherId,
    day,
    periodIndex,
    academicYear = CURRENT_ACADEMIC_YEAR,
    schoolId,
  }) {
    // Proceed without transactions for compatibility
    const session = null;

    const query = { teacherId, academicYear };
    if (!schoolId) throw new Error('schoolId is required for timetable operations');
    query.schoolId = schoolId;
    const teacherTimetable = await TeacherTimetable.findOne(query);

    if (!teacherTimetable || !teacherTimetable.schedule[day]) {
      return { success: true, message: 'Slot already empty' };
    }

    const slot = teacherTimetable.schedule[day].find((s) => s.periodIndex === periodIndex);
    if (!slot) {
      return { success: true, message: 'Slot already empty' };
    }

    const classId = slot.classId;

    // Remove the slot
    teacherTimetable.schedule[day] = teacherTimetable.schedule[day].filter(
      (s) => s.periodIndex !== periodIndex
    );

    teacherTimetable.totalPeriodsPerWeek = this._computeTotalPeriodsPerWeek(
      teacherTimetable.schedule
    );
    teacherTimetable.version += 1;
    teacherTimetable.lastSyncedAt = new Date();
    await teacherTimetable.save();

    // Invalidate cache for affected teacher and class
    cacheService.invalidateTeacherCache(teacherId);
    if (classId) {
      cacheService.invalidateClassCache(classId);
    }

    // Remove from class timetable if class was assigned
    if (classId) {
      await this._removeFromClassTimetable({
        classId,
        teacherId,
        day,
        periodIndex,
        academicYear,
        schoolId,
        session,
      });
    }

    return { success: true, classId };
  }

  /**
   * Get class timetable
   */
  async getClassTimetable(classId, academicYear = CURRENT_ACADEMIC_YEAR, schoolId = null) {
    // Check cache first
    const cacheKey = cacheService.getClassTimetableKey(classId, academicYear);
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return cached;
    }

    const findQuery = { classId, academicYear };
    if (schoolId) findQuery.schoolId = schoolId;

    const timetable = await Timetable.findOne(findQuery)
      .populate('classId', 'name section')
      .populate('schedule.Monday.teacherId', 'name code')
      .populate('schedule.Tuesday.teacherId', 'name code')
      .populate('schedule.Wednesday.teacherId', 'name code')
      .populate('schedule.Thursday.teacherId', 'name code')
      .populate('schedule.Friday.teacherId', 'name code')
      .populate('schedule.Saturday.teacherId', 'name code');

    // Cache for 2 minutes
    if (timetable) {
      cacheService
        .set(cacheKey, timetable, 2 * 60 * 1000)
        .catch((err) => logger.warn({ err, cacheKey }, 'Cache set failed'));
    }

    return timetable;
  }

  /**
   * Get teacher timetable
   */
  async getTeacherTimetable(teacherId, academicYear = CURRENT_ACADEMIC_YEAR, schoolId = null) {
    // Check cache first
    const cacheKey = cacheService.getTeacherTimetableKey(teacherId, academicYear);
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return cached;
    }

    const findQuery = { teacherId, academicYear };
    if (schoolId) findQuery.schoolId = schoolId;

    const timetable = await TeacherTimetable.findOne(findQuery)
      .populate('teacherId', 'name code')
      .populate('schedule.Monday.classId', 'name section')
      .populate('schedule.Tuesday.classId', 'name section')
      .populate('schedule.Wednesday.classId', 'name section')
      .populate('schedule.Thursday.classId', 'name section')
      .populate('schedule.Friday.classId', 'name section')
      .populate('schedule.Saturday.classId', 'name section');

    // Cache for 2 minutes
    if (timetable) {
      cacheService
        .set(cacheKey, timetable, 2 * 60 * 1000)
        .catch((err) => logger.warn({ err, cacheKey }, 'Cache set failed'));
    }

    return timetable;
  }

  /**
   * Switch class for a teacher in a specific time slot
   * Validates teacher qualification, removes from old class, adds to new class
   * Implements rollback on failure
   *
   * @param {Object} options - Switch options
   * @param {string} options.teacherId - Teacher ID
   * @param {string} options.oldClassId - Current class ID (to remove from)
   * @param {string} options.newClassId - New class ID (to add to)
   * @param {string} options.day - Day of the week
   * @param {number} options.periodIndex - Period index
   * @param {string} options.subject - Subject being taught
   * @param {string} options.room - Room number (optional)
   * @param {string} options.academicYear - Academic year
   * @param {string} options.modifiedBy - User ID making the change
   * @returns {Promise<Object>} - Result with success status and updated timetables
   */
  async switchClass(options) {
    const {
      teacherId,
      oldClassId,
      newClassId,
      day,
      periodIndex,
      subject,
      room = '',
      academicYear = CURRENT_ACADEMIC_YEAR,
      modifiedBy = null,
      schoolId = null,
    } = options;

    // Validate inputs
    if (!teacherId || !newClassId || !day || periodIndex === undefined || !subject) {
      throw new Error(
        'Missing required parameters: teacherId, newClassId, day, periodIndex, and subject are required'
      );
    }

    // Validate day
    const validDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    if (!validDays.includes(day)) {
      throw new Error(`Invalid day. Must be one of: ${validDays.join(', ')}`);
    }

    // Validate teacher exists within the school
    const teacherQuery = { _id: teacherId };
    if (schoolId) teacherQuery.schoolId = schoolId;
    const teacher = await Staff.findOne(teacherQuery);
    if (!teacher) {
      throw new Error('Teacher not found');
    }

    // Validate new class exists within the school
    const classQuery = { _id: newClassId };
    if (schoolId) classQuery.schoolId = schoolId;
    const newClass = await Class.findOne(classQuery);
    if (!newClass) {
      throw new Error('New class not found');
    }

    // Validate teacher qualification for new class and subject
    const hasQualification = teacher.teacherAssignments.some(
      (assignment) =>
        assignment.subject === subject &&
        assignment.classes.some((c) => c.toString() === newClassId.toString())
    );

    if (!hasQualification) {
      throw new Error(
        `Teacher ${teacher.name} is not qualified to teach ${subject} in class ${newClass.name} ${newClass.section}`
      );
    }

    // Store original states for rollback
    let originalOldClassTimetable = null;
    let originalNewClassTimetable = null;
    let originalTeacherTimetable = null;

    try {
      // Get original states
      const ttQuery = (extra) => {
        const q = { ...extra, academicYear };
        if (schoolId) q.schoolId = schoolId;
        return q;
      };

      if (oldClassId) {
        originalOldClassTimetable = await Timetable.findOne(ttQuery({ classId: oldClassId }));
        if (originalOldClassTimetable) {
          originalOldClassTimetable = JSON.parse(
            JSON.stringify(originalOldClassTimetable.toObject())
          );
        }
      }

      originalNewClassTimetable = await Timetable.findOne(ttQuery({ classId: newClassId }));
      if (originalNewClassTimetable) {
        originalNewClassTimetable = JSON.parse(
          JSON.stringify(originalNewClassTimetable.toObject())
        );
      }

      originalTeacherTimetable = await TeacherTimetable.findOne(ttQuery({ teacherId }));
      if (originalTeacherTimetable) {
        originalTeacherTimetable = JSON.parse(JSON.stringify(originalTeacherTimetable.toObject()));
      }

      // Step 1: Remove teacher from old class slot (if oldClassId provided)
      if (oldClassId) {
        await this.removeTeacherFromSlot({
          classId: oldClassId,
          teacherId,
          day,
          periodIndex,
          academicYear,
          schoolId,
        });
      }

      // Step 2: Add teacher to new class slot
      await this.addTeacherToSlot({
        classId: newClassId,
        teacherId,
        day,
        periodIndex,
        subject,
        room,
        academicYear,
        modifiedBy,
        schoolId,
      });

      // Step 3: Update teacher timetable
      const teacherTimetable = await TeacherTimetable.findOne(ttQuery({ teacherId }));
      if (!teacherTimetable) {
        throw new Error('Teacher timetable not found');
      }

      if (!teacherTimetable.schedule[day]) {
        teacherTimetable.schedule[day] = [];
      }

      // Remove old slot entry
      teacherTimetable.schedule[day] = teacherTimetable.schedule[day].filter(
        (slot) => slot.periodIndex !== periodIndex
      );

      // Add new slot entry
      teacherTimetable.schedule[day].push({
        periodIndex,
        classId: newClassId,
        subject,
        room,
        lastModified: new Date(),
      });

      // Sort by periodIndex
      teacherTimetable.schedule[day].sort((a, b) => a.periodIndex - b.periodIndex);

      teacherTimetable.totalPeriodsPerWeek = this._computeTotalPeriodsPerWeek(
        teacherTimetable.schedule
      );
      teacherTimetable.version += 1;
      teacherTimetable.lastSyncedAt = new Date();
      await teacherTimetable.save();

      // Get updated timetables for response
      const updatedOldClassTimetable = oldClassId
        ? await Timetable.findOne(ttQuery({ classId: oldClassId }))
        : null;
      const updatedNewClassTimetable = await Timetable.findOne(ttQuery({ classId: newClassId }));
      const updatedTeacherTimetable = await TeacherTimetable.findOne(ttQuery({ teacherId }));

      return {
        success: true,
        message: 'Class switched successfully',
        oldClassTimetable: updatedOldClassTimetable,
        newClassTimetable: updatedNewClassTimetable,
        teacherTimetable: updatedTeacherTimetable,
        oldClassId,
        newClassId,
      };
    } catch (error) {
      // Rollback on failure
      logger.error(
        { err: error, teacherId, oldClassId, newClassId },
        'Class switch failed, rolling back'
      );

      try {
        const rbQuery = (extra) => {
          const q = { ...extra, academicYear };
          if (schoolId) q.schoolId = schoolId;
          return q;
        };

        // Restore old class timetable
        if (originalOldClassTimetable) {
          await Timetable.findOneAndUpdate(rbQuery({ classId: oldClassId }), {
            schedule: originalOldClassTimetable.schedule,
            version: originalOldClassTimetable.version,
            lastSyncedAt: originalOldClassTimetable.lastSyncedAt,
          });
        }

        // Restore new class timetable
        if (originalNewClassTimetable) {
          await Timetable.findOneAndUpdate(rbQuery({ classId: newClassId }), {
            schedule: originalNewClassTimetable.schedule,
            version: originalNewClassTimetable.version,
            lastSyncedAt: originalNewClassTimetable.lastSyncedAt,
          });
        }

        // Restore teacher timetable
        if (originalTeacherTimetable) {
          await TeacherTimetable.findOneAndUpdate(rbQuery({ teacherId }), {
            schedule: originalTeacherTimetable.schedule,
            version: originalTeacherTimetable.version,
            lastSyncedAt: originalTeacherTimetable.lastSyncedAt,
          });
        }
      } catch (rollbackError) {
        logger.error({ err: rollbackError }, 'Rollback failed');
        throw new Error(
          `Class switch failed and rollback also failed: ${error.message}. Rollback error: ${rollbackError.message}`,
          { cause: rollbackError }
        );
      }

      throw error;
    }
  }

  /**
   * Remove teacher from a specific class time slot
   *
   * @param {Object} options - Remove options
   * @param {string} options.classId - Class ID
   * @param {string} options.teacherId - Teacher ID
   * @param {string} options.day - Day of the week
   * @param {number} options.periodIndex - Period index
   * @param {string} options.academicYear - Academic year
   * @returns {Promise<Object>} - Result with success status
   */
  async removeTeacherFromSlot(options) {
    const {
      classId,
      teacherId,
      day,
      periodIndex,
      academicYear = CURRENT_ACADEMIC_YEAR,
      schoolId,
    } = options;

    // Validate inputs
    if (!classId || !teacherId || !day || periodIndex === undefined) {
      throw new Error(
        'Missing required parameters: classId, teacherId, day, and periodIndex are required'
      );
    }

    // Get class timetable
    const query = { classId, academicYear };
    if (!schoolId) throw new Error('schoolId is required for timetable operations');
    query.schoolId = schoolId;
    const classTimetable = await Timetable.findOne(query);
    if (!classTimetable) {
      throw new Error(`Class timetable not found for classId: ${classId}`);
    }

    // Check if slot exists and has the specified teacher
    if (!classTimetable.schedule[day] || !classTimetable.schedule[day][periodIndex]) {
      return { success: true, message: 'Slot is already empty' };
    }

    const currentTeacherId = classTimetable.schedule[day][periodIndex].teacherId;
    if (!currentTeacherId || currentTeacherId.toString() !== teacherId.toString()) {
      return { success: true, message: 'Teacher is not assigned to this slot' };
    }

    // Clear the slot
    classTimetable.schedule[day][periodIndex] = {
      subject: '',
      teacherId: null,
      room: '',
      lastModified: new Date(),
      modifiedBy: null,
    };

    classTimetable.version += 1;
    classTimetable.lastSyncedAt = new Date();
    await classTimetable.save();

    return {
      success: true,
      message: 'Teacher removed from slot successfully',
      classTimetable,
    };
  }

  /**
   * Add teacher to a specific class time slot
   *
   * @param {Object} options - Add options
   * @param {string} options.classId - Class ID
   * @param {string} options.teacherId - Teacher ID
   * @param {string} options.day - Day of the week
   * @param {number} options.periodIndex - Period index
   * @param {string} options.subject - Subject
   * @param {string} options.room - Room number (optional)
   * @param {string} options.academicYear - Academic year
   * @param {string} options.modifiedBy - User ID making the change
   * @returns {Promise<Object>} - Result with success status
   */
  async addTeacherToSlot(options) {
    const {
      classId,
      teacherId,
      day,
      periodIndex,
      subject,
      room = '',
      academicYear = CURRENT_ACADEMIC_YEAR,
      modifiedBy = null,
      schoolId = null,
    } = options;

    // Validate inputs
    if (!classId || !teacherId || !day || periodIndex === undefined || !subject) {
      throw new Error(
        'Missing required parameters: classId, teacherId, day, periodIndex, and subject are required'
      );
    }

    // Get or create class timetable
    const query = { classId, academicYear };
    if (!schoolId) throw new Error('schoolId is required for timetable operations');
    query.schoolId = schoolId;
    const classTimetable = await Timetable.findOne(query);
    if (!classTimetable) {
      throw new Error(`Class timetable not found for classId: ${classId}`);
    }

    // Initialize day schedule if needed
    if (!classTimetable.schedule[day]) {
      classTimetable.schedule[day] = [];
    }

    // Ensure the array has enough slots
    while (classTimetable.schedule[day].length <= periodIndex) {
      classTimetable.schedule[day].push({});
    }

    // Add teacher to the slot
    classTimetable.schedule[day][periodIndex] = {
      subject,
      teacherId,
      room,
      lastModified: new Date(),
      modifiedBy,
    };

    classTimetable.version += 1;
    classTimetable.lastSyncedAt = new Date();
    await classTimetable.save();

    return {
      success: true,
      message: 'Teacher added to slot successfully',
      classTimetable,
    };
  }
}

export default new TimetableService();
