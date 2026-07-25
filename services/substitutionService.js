import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';
import { Staff, Timetable, TeacherTimetable, Class, Substitution } from '../database.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('SubstitutionService');

/**
 * Substitution Service
 * Handles substitution alerts, auto-suggestions, and notifications
 */
class SubstitutionService {
  /**
   * Generate substitution alerts for absent teachers on a specific date
   * @param {string} date - Date in YYYY-MM-DD format
   * @param {string} academicYear - Academic year
   * @returns {Promise<Array>} Array of substitution alerts
   */
  async generateSubstitutionAlerts(date, academicYear = CURRENT_ACADEMIC_YEAR) {
    try {
      const dayOfWeek = this.getDayOfWeek(date);

      // [SUBS-FIX] The original code queried Staff.find({ status: 'absent' }),
      // but 'absent' is not a valid Staff.status enum value
      // (['active','inactive','on-leave','suspended','terminated']), so it
      // ALWAYS returned [] — meaning this function could never generate alerts
      // from staff absence, only from pre-existing pending Substitution docs.
      //
      // Absence is a per-day fact recorded in StaffAttendance (see
      // checkTeacherAbsent below). Build the set of absent teacher ids so the
      // timetable loop below can flag slots whose teacher is actually absent
      // today, rather than blindly emitting every pending substitution.
      const { StaffAttendance } = await import('../database.js');
      const absenceRecords = await StaffAttendance.find({ date, status: 'absent' })
        .select('staffId')
        .lean();
      const absentTeacherIds = new Set(
        absenceRecords.map((rec) => rec.staffId?.toString()).filter(Boolean)
      );

      const alerts = [];

      // Get all timetables for the academic year
      const timetables = await Timetable.find({ academicYear })
        .populate('classId', 'name section')
        .populate(
          'schedule.Monday.teacherId schedule.Tuesday.teacherId schedule.Wednesday.teacherId schedule.Thursday.teacherId schedule.Friday.teacherId schedule.Saturday.teacherId',
          'name code'
        );

      // Process each timetable to find slots needing coverage
      for (const timetable of timetables) {
        if (!timetable.classId) continue;

        const daySchedule = timetable.schedule[dayOfWeek];
        if (!daySchedule) continue;

        for (let periodIndex = 0; periodIndex < daySchedule.length; periodIndex++) {
          const slot = daySchedule[periodIndex];

          // Skip empty slots and breaks
          if (!slot || !slot.subject || !slot.teacherId) continue;

          // [SUBS-FIX] A slot needs coverage only if its scheduled teacher is
          // actually absent today (sourced from StaffAttendance above). The
          // previous code emitted an alert for ANY pending substitution
          // regardless of whether the teacher was absent — and, because the
          // absent-staff query was broken, could never have known anyway.
          const slotTeacherId = slot.teacherId?._id?.toString?.() || slot.teacherId?.toString?.();
          if (!slotTeacherId || !absentTeacherIds.has(slotTeacherId)) continue;

          // Check if there's already a substitution for this slot
          const existingSubstitution = await Substitution.findOne({
            date,
            classId: timetable.classId._id,
            period: String(periodIndex + 1),
          });

          if (existingSubstitution && existingSubstitution.status === 'pending') {
            alerts.push({
              id: `alert-${timetable.classId._id}-${periodIndex}`,
              type: 'pending_substitution',
              date,
              classId: timetable.classId._id,
              className: `${timetable.classId.name}-${timetable.classId.section}`,
              period: periodIndex + 1,
              periodName: timetable.periods[periodIndex]?.name || `Period ${periodIndex + 1}`,
              subject: slot.subject,
              absentTeacher: {
                id: slot.teacherId._id,
                name: slot.teacherId.name,
                code: slot.teacherId.code,
              },
              substitutionId: existingSubstitution._id,
              priority: this.calculatePriority(periodIndex, date),
              createdAt: existingSubstitution.createdAt,
            });
          }
        }
      }

      // Sort by priority (highest first)
      alerts.sort((a, b) => b.priority - a.priority);

      return alerts;
    } catch (error) {
      logger.error({ err: error }, 'Error generating substitution alerts');
      throw error;
    }
  }

  /**
   * Get available teachers for substitution
   * @param {Object} params - { classId, subject, day, period, date, academicYear, schoolId }
   * @returns {Promise<Object>} Available and suggested teachers
   */
  async getAvailableTeachersForSubstitution(params) {
    const {
      classId,
      subject,
      day,
      period,
      date,
      academicYear = CURRENT_ACADEMIC_YEAR,
      schoolId,
    } = params;

    try {
      const periodIndex = parseInt(period) - 1;

      // [SUBS-FIX] Tenant scope: every query below is filtered by schoolId when
      // provided. Without this, a cross-tenant caller could read teachers and
      // timetables belonging to other schools.
      const schoolFilter = schoolId ? { schoolId } : {};

      // 1. Find teachers qualified for this subject
      const qualifiedTeachers = await Staff.find({
        ...schoolFilter,
        status: 'active',
        $or: [
          { role: { $in: ['Teacher', 'teacher'] } },
          { staffType: { $in: ['Teacher', 'teacher'] } },
        ],
        teacherAssignments: {
          $elemMatch: {
            subject: subject,
          },
        },
      }).select('_id name code department teacherAssignments');

      // 2. Get all timetables to check for conflicts
      const allTimetables = await Timetable.find({ ...schoolFilter, academicYear });

      // 3. Build conflict map
      const teacherConflicts = new Map();

      for (const timetable of allTimetables) {
        const daySchedule = timetable.schedule[day];
        if (daySchedule && daySchedule[periodIndex]) {
          const slot = daySchedule[periodIndex];
          if (slot.teacherId) {
            const teacherIdStr = slot.teacherId.toString();
            if (!teacherConflicts.has(teacherIdStr)) {
              teacherConflicts.set(teacherIdStr, []);
            }
            // Get class name for conflict info
            const classData = await Class.findById(timetable.classId).select('name section');
            teacherConflicts.get(teacherIdStr).push({
              classId: timetable.classId,
              className: classData ? `${classData.name}-${classData.section}` : 'Unknown',
              subject: slot.subject,
            });
          }
        }
      }

      // 4. Check which teachers are on free period
      const availableTeachers = [];
      const conflictedTeachers = [];

      for (const teacher of qualifiedTeachers) {
        const teacherIdStr = teacher._id.toString();
        const conflicts = teacherConflicts.get(teacherIdStr);

        if (!conflicts || conflicts.length === 0) {
          // Check if teacher is available (not absent)
          const isAbsent = await this.checkTeacherAbsent(teacher._id, date);

          if (!isAbsent) {
            // Calculate teacher's workload for the day
            const workload = await this.getTeacherWorkload(teacher._id, day, academicYear);

            availableTeachers.push({
              id: teacher._id,
              name: teacher.name,
              code: teacher.code,
              department: teacher.department,
              workload,
              recommendation: this.calculateRecommendation(
                workload,
                subject,
                teacher.teacherAssignments
              ),
              assignments: teacher.teacherAssignments.filter((a) => a.subject === subject),
            });
          }
        } else {
          conflictedTeachers.push({
            id: teacher._id,
            name: teacher.name,
            code: teacher.code,
            conflicts,
          });
        }
      }

      // 5. Also check for any teacher who might be free (not just qualified)
      const allTeachers = await Staff.find({
        ...schoolFilter,
        status: 'active',
        $or: [
          { role: { $in: ['Teacher', 'teacher'] } },
          { staffType: { $in: ['Teacher', 'teacher'] } },
        ],
      }).select('_id name code department teacherAssignments');

      const additionalAvailable = [];

      for (const teacher of allTeachers) {
        // Skip if already in qualified list
        if (qualifiedTeachers.some((t) => t._id.toString() === teacher._id.toString())) continue;

        const teacherIdStr = teacher._id.toString();
        const conflicts = teacherConflicts.get(teacherIdStr);

        if (!conflicts || conflicts.length === 0) {
          const isAbsent = await this.checkTeacherAbsent(teacher._id, date);

          if (!isAbsent) {
            additionalAvailable.push({
              id: teacher._id,
              name: teacher.name,
              code: teacher.code,
              department: teacher.department,
              workload: await this.getTeacherWorkload(teacher._id, day, academicYear),
              recommendation: 'backup', // Lower priority
              note: 'Not primarily assigned to this subject',
            });
          }
        }
      }

      // Sort by recommendation and workload
      availableTeachers.sort((a, b) => {
        const recOrder = { highly_recommended: 0, recommended: 1, available: 2 };
        const recDiff = (recOrder[a.recommendation] || 2) - (recOrder[b.recommendation] || 2);
        if (recDiff !== 0) return recDiff;
        return a.workload - b.workload; // Lower workload first
      });

      return {
        available: availableTeachers,
        backup: additionalAvailable.slice(0, 5), // Limit backup suggestions
        conflicted: conflictedTeachers,
        summary: {
          total: qualifiedTeachers.length,
          available: availableTeachers.length,
          conflicted: conflictedTeachers.length,
          backup: additionalAvailable.length,
        },
      };
    } catch (error) {
      logger.error({ err: error }, 'Error getting available teachers for substitution');
      throw error;
    }
  }

  /**
   * Create substitution alert from staff absence
   * @param {string} teacherId - Absent teacher ID
   * @param {string} date - Date of absence
   * @param {string} reason - Reason for absence
   * @returns {Promise<Array>} Created substitution records
   */
  async createSubstitutionFromAbsence(teacherId, date, reason = 'Absent', schoolId = null) {
    try {
      const dayOfWeek = this.getDayOfWeek(date);
      // ST14: resolve the academic year per request from SchoolSettings (falling
      // back to CURRENT_ACADEMIC_YEAR) instead of capturing it once at module
      // load. A module-load constant is wrong the moment a school rolls over
      // to a new academic year.
      const { getConfiguredAcademicYear } = await import('../utils/academicYear.js');
      const academicYear = await getConfiguredAcademicYear(schoolId);

      // Get teacher's timetable for the day (scoped by school)
      const ttQuery = { teacherId, academicYear };
      if (schoolId) ttQuery.schoolId = schoolId;
      const teacherTimetable = await TeacherTimetable.findOne(ttQuery);

      if (!teacherTimetable) {
        return [];
      }

      const daySchedule = teacherTimetable.schedule[dayOfWeek];
      if (!daySchedule || daySchedule.length === 0) {
        return [];
      }

      const substitutions = [];

      for (const slot of daySchedule) {
        if (!slot.classId || !slot.subject) continue;

        // Check if substitution already exists (scoped by school)
        const existingQuery = {
          date,
          classId: slot.classId,
          period: String(slot.periodIndex + 1),
        };
        if (schoolId) existingQuery.schoolId = schoolId;
        const existing = await Substitution.findOne(existingQuery);

        if (existing) {
          continue;
        }

        // Create pending substitution (with schoolId for multi-tenancy)
        // substituteTeacherId is required in the Substitution model, so we
        // temporarily assign the absent teacher themselves as a placeholder.
        // The status 'pending' signals that a real substitute still needs to
        // be assigned.  Without this, Mongoose validation rejects the doc.
        const substitution = new Substitution({
          date,
          classId: slot.classId,
          period: String(slot.periodIndex + 1),
          absentTeacherId: teacherId,
          substituteTeacherId: teacherId, // placeholder until a real substitute is assigned
          reason,
          type: 'auto',
          status: 'pending',
          ...(schoolId ? { schoolId } : {}),
        });

        await substitution.save();
        substitutions.push(substitution);
      }

      return substitutions;
    } catch (error) {
      logger.error({ err: error, teacherId }, 'Error creating substitution from absence');
      throw error;
    }
  }

  /**
   * Calculate priority for substitution alert
   * Higher number = higher priority
   */
  calculatePriority(periodIndex, date) {
    const now = new Date();
    const alertDate = new Date(date);
    const hoursUntilClass = (alertDate - now) / (1000 * 60 * 60);

    // Base priority from period (earlier periods = higher priority in morning)
    let priority = 10 - periodIndex;

    // Increase priority if class is soon
    if (hoursUntilClass < 1) priority += 20;
    else if (hoursUntilClass < 2) priority += 15;
    else if (hoursUntilClass < 4) priority += 10;
    else if (hoursUntilClass < 24) priority += 5;

    return priority;
  }

  /**
   * Calculate recommendation score for teacher
   */
  calculateRecommendation(workload, subject, assignments) {
    // Check if teacher is assigned to this subject
    const hasSubject = assignments.some((a) => a.subject === subject);

    if (hasSubject && workload < 3) return 'highly_recommended';
    if (hasSubject) return 'recommended';
    if (workload < 4) return 'available';
    return 'backup';
  }

  /**
   * Get day of week from a YYYY-MM-DD date string.
   *
   * [SUBS-FIX] Parse the date in LOCAL time, not UTC. `new Date('2026-07-12')`
   * is interpreted as UTC midnight, so in negative-offset zones (Americas)
   * getDay() returns the previous weekday and the wrong timetable slot is
   * read. Splitting on '-' and constructing with local parts keeps the
   * weekday stable regardless of server timezone.
   */
  getDayOfWeek(dateString) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const [year, month, day] = String(dateString).split('-').map(Number);
    const date = new Date(year, (month || 1) - 1, day || 1);
    return days[date.getDay()];
  }

  /**
   * Check if teacher is absent on a date
   * @param {string} teacherId
   * @param {string} date
   * @returns {Promise<boolean>}
   */
  async checkTeacherAbsent(teacherId, date) {
    try {
      // Import StaffAttendance model
      const { StaffAttendance } = await import('../database.js');

      const attendance = await StaffAttendance.findOne({
        staffId: teacherId,
        date,
      });

      return attendance && attendance.status === 'absent';
    } catch (error) {
      // If StaffAttendance model doesn't exist, return false
      logger.warn({ err: error, teacherId }, 'StaffAttendance check failed');
      return false;
    }
  }

  /**
   * Get teacher's workload for a day
   * @param {string} teacherId
   * @param {string} day
   * @param {string} academicYear
   * @returns {Promise<number>}
   */
  async getTeacherWorkload(teacherId, day, academicYear) {
    try {
      const teacherTimetable = await TeacherTimetable.findOne({
        teacherId,
        academicYear,
      });

      if (!teacherTimetable) return 0;

      const daySchedule = teacherTimetable.schedule[day];
      if (!daySchedule) return 0;

      return daySchedule.filter((slot) => slot.classId && slot.subject).length;
    } catch (error) {
      logger.warn({ err: error, teacherId }, 'Error getting teacher workload');
      return 0;
    }
  }

  /**
   * Get all pending substitutions with full details
   * @param {string} date
   * @returns {Promise<Array>}
   */
  async getPendingSubstitutionsWithDetails(date, schoolId = null) {
    try {
      const query = { date, status: 'pending' };
      if (schoolId) query.schoolId = schoolId;

      const substitutions = await Substitution.find(query)
        .populate('classId', 'name section')
        .populate('absentTeacherId', 'name code department')
        .populate('substituteTeacherId', 'name code department')
        .sort({ period: 1 });

      // Get available teachers for each substitution
      const enrichedSubstitutions = await Promise.all(
        substitutions.map(async (sub) => {
          const dayOfWeek = this.getDayOfWeek(date);

          // [SUBS-FIX] Guard against orphaned refs. populate() yields null when
          // the referenced Class/Staff was deleted. Dereferencing sub.classId._id
          // threw a TypeError and 500'd the whole endpoint. Skip gracefully.
          if (!sub.classId) {
            return {
              ...sub.toObject(),
              classId: null,
              subject: 'Unknown',
              periodName: `Period ${sub.period}`,
              timeSlot: null,
              availableTeachers: [],
              backupTeachers: [],
              skipped: 'orphaned class reference',
            };
          }

          // Get class timetable to find subject
          const timetable = await Timetable.findOne({
            classId: sub.classId._id,
          });

          const daySchedule = timetable?.schedule[dayOfWeek];
          const periodIndex = parseInt(sub.period) - 1;
          const slot = daySchedule?.[periodIndex];

          // [SUBS-FIX] Pass schoolId so the inner lookup is tenant-scoped —
          // previously this read teachers/timetables across ALL schools.
          const availableTeachers = await this.getAvailableTeachersForSubstitution({
            classId: sub.classId._id,
            subject: slot?.subject || '',
            day: dayOfWeek,
            period: sub.period,
            date,
            schoolId: schoolId || undefined,
            academicYear: timetable?.academicYear || CURRENT_ACADEMIC_YEAR,
          });

          return {
            ...sub.toObject(),
            subject: slot?.subject || 'Unknown',
            periodName: timetable?.periods[periodIndex]?.name || `Period ${sub.period}`,
            timeSlot: timetable?.periods[periodIndex]
              ? `${timetable.periods[periodIndex].startTime} - ${timetable.periods[periodIndex].endTime}`
              : null,
            availableTeachers: availableTeachers.available.slice(0, 5),
            backupTeachers: availableTeachers.backup.slice(0, 3),
          };
        })
      );

      return enrichedSubstitutions;
    } catch (error) {
      logger.error({ err: error }, 'Error getting pending substitutions');
      throw error;
    }
  }
}

export default new SubstitutionService();
