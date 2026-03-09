import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';
import { Staff, Timetable, TeacherTimetable, Class, Substitution } from '../database.js';

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

      // Get all staff who are marked absent for this date
      const absentStaff = await Staff.find({
        status: 'absent',
        // You might have an attendance collection to check instead
        // For now, we'll check staff with 'absent' status or use a different approach
      });

      // Alternative: Check via staff attendance records if you have that collection
      // For this implementation, we'll generate alerts based on requested absences

      const alerts = [];

      // Get all timetables for the academic year
      const timetables = await Timetable.find({ academicYear })
        .populate('classId', 'name section')
        .populate('schedule.Monday.teacherId schedule.Tuesday.teacherId schedule.Wednesday.teacherId schedule.Thursday.teacherId schedule.Friday.teacherId schedule.Saturday.teacherId', 'name code');

      // Process each timetable to find slots needing coverage
      for (const timetable of timetables) {
        if (!timetable.classId) continue;

        const daySchedule = timetable.schedule[dayOfWeek];
        if (!daySchedule) continue;

        for (let periodIndex = 0; periodIndex < daySchedule.length; periodIndex++) {
          const slot = daySchedule[periodIndex];

          // Skip empty slots and breaks
          if (!slot || !slot.subject || !slot.teacherId) continue;

          // Check if there's already a substitution for this slot
          const existingSubstitution = await Substitution.findOne({
            date,
            classId: timetable.classId._id,
            period: String(periodIndex + 1)
          });

          // Check if teacher is absent (you'd check attendance here)
          // For now, we'll check if substitution exists and is pending
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
                code: slot.teacherId.code
              },
              substitutionId: existingSubstitution._id,
              priority: this.calculatePriority(periodIndex, date),
              createdAt: existingSubstitution.createdAt
            });
          }
        }
      }

      // Sort by priority (highest first)
      alerts.sort((a, b) => b.priority - a.priority);

      return alerts;
    } catch (error) {
      console.error('Error generating substitution alerts:', error);
      throw error;
    }
  }

  /**
   * Get available teachers for substitution
   * @param {Object} params - { classId, subject, day, period, date, academicYear }
   * @returns {Promise<Object>} Available and suggested teachers
   */
  async getAvailableTeachersForSubstitution(params) {
    const { classId, subject, day, period, date, academicYear = CURRENT_ACADEMIC_YEAR } = params;

    try {
      const periodIndex = parseInt(period) - 1;

      // 1. Find teachers qualified for this subject
      const qualifiedTeachers = await Staff.find({
        status: 'active',
        $or: [
          { role: { $in: ['Teacher', 'teacher'] } },
          { staffType: { $in: ['Teacher', 'teacher'] } }
        ],
        'teacherAssignments': {
          $elemMatch: {
            subject: subject
          }
        }
      }).select('_id name code department teacherAssignments');

      // 2. Get all timetables to check for conflicts
      const allTimetables = await Timetable.find({ academicYear });

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
              subject: slot.subject
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
              recommendation: this.calculateRecommendation(workload, subject, teacher.teacherAssignments),
              assignments: teacher.teacherAssignments.filter(a => a.subject === subject)
            });
          }
        } else {
          conflictedTeachers.push({
            id: teacher._id,
            name: teacher.name,
            code: teacher.code,
            conflicts
          });
        }
      }

      // 5. Also check for any teacher who might be free (not just qualified)
      const allTeachers = await Staff.find({
        status: 'active',
        $or: [
          { role: { $in: ['Teacher', 'teacher'] } },
          { staffType: { $in: ['Teacher', 'teacher'] } }
        ]
      }).select('_id name code department teacherAssignments');

      const additionalAvailable = [];

      for (const teacher of allTeachers) {
        // Skip if already in qualified list
        if (qualifiedTeachers.some(t => t._id.toString() === teacher._id.toString())) continue;

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
              note: 'Not primarily assigned to this subject'
            });
          }
        }
      }

      // Sort by recommendation and workload
      availableTeachers.sort((a, b) => {
        const recOrder = { 'highly_recommended': 0, 'recommended': 1, 'available': 2 };
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
          backup: additionalAvailable.length
        }
      };
    } catch (error) {
      console.error('Error getting available teachers for substitution:', error);
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
  async createSubstitutionFromAbsence(teacherId, date, reason = 'Absent') {
    try {
      const dayOfWeek = this.getDayOfWeek(date);
      const academicYear = CURRENT_ACADEMIC_YEAR; // Should be dynamic

      // Get teacher's timetable for the day
      const teacherTimetable = await TeacherTimetable.findOne({
        teacherId,
        academicYear
      });

      if (!teacherTimetable) {
        console.log(`No timetable found for teacher ${teacherId}`);
        return [];
      }

      const daySchedule = teacherTimetable.schedule[dayOfWeek];
      if (!daySchedule || daySchedule.length === 0) {
        console.log(`No classes scheduled for teacher ${teacherId} on ${dayOfWeek}`);
        return [];
      }

      const substitutions = [];

      for (const slot of daySchedule) {
        if (!slot.classId || !slot.subject) continue;

        // Check if substitution already exists
        const existing = await Substitution.findOne({
          date,
          classId: slot.classId,
          period: String(slot.periodIndex + 1)
        });

        if (existing) {
          console.log(`Substitution already exists for class ${slot.classId}, period ${slot.periodIndex + 1}`);
          continue;
        }

        // Create pending substitution
        const substitution = new Substitution({
          date,
          classId: slot.classId,
          period: String(slot.periodIndex + 1),
          absentTeacherId: teacherId,
          substituteTeacherId: null, // To be assigned
          reason,
          type: 'auto',
          status: 'pending'
        });

        await substitution.save();
        substitutions.push(substitution);

        console.log(`Created substitution alert for class ${slot.classId}, period ${slot.periodIndex + 1}`);
      }

      return substitutions;
    } catch (error) {
      console.error('Error creating substitution from absence:', error);
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
    const hasSubject = assignments.some(a => a.subject === subject);

    if (hasSubject && workload < 3) return 'highly_recommended';
    if (hasSubject) return 'recommended';
    if (workload < 4) return 'available';
    return 'backup';
  }

  /**
   * Get day of week from date string
   */
  getDayOfWeek(dateString) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const date = new Date(dateString);
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
        date
      });

      return attendance && attendance.status === 'absent';
    } catch (error) {
      // If StaffAttendance model doesn't exist, return false
      console.warn('StaffAttendance check failed:', error.message);
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
        academicYear
      });

      if (!teacherTimetable) return 0;

      const daySchedule = teacherTimetable.schedule[day];
      if (!daySchedule) return 0;

      return daySchedule.filter(slot => slot.classId && slot.subject).length;
    } catch (error) {
      console.warn('Error getting teacher workload:', error.message);
      return 0;
    }
  }

  /**
   * Get all pending substitutions with full details
   * @param {string} date
   * @returns {Promise<Array>}
   */
  async getPendingSubstitutionsWithDetails(date) {
    try {
      const substitutions = await Substitution.find({
        date,
        status: 'pending'
      })
        .populate('classId', 'name section')
        .populate('absentTeacherId', 'name code department')
        .populate('substituteTeacherId', 'name code department')
        .sort({ period: 1 });

      // Get available teachers for each substitution
      const enrichedSubstitutions = await Promise.all(
        substitutions.map(async (sub) => {
          const dayOfWeek = this.getDayOfWeek(date);

          // Get class timetable to find subject
          const timetable = await Timetable.findOne({
            classId: sub.classId._id
          });

          const daySchedule = timetable?.schedule[dayOfWeek];
          const periodIndex = parseInt(sub.period) - 1;
          const slot = daySchedule?.[periodIndex];

          const availableTeachers = await this.getAvailableTeachersForSubstitution({
            classId: sub.classId._id,
            subject: slot?.subject || '',
            day: dayOfWeek,
            period: sub.period,
            date,
            academicYear: timetable?.academicYear || CURRENT_ACADEMIC_YEAR
          });

          return {
            ...sub.toObject(),
            subject: slot?.subject || 'Unknown',
            periodName: timetable?.periods[periodIndex]?.name || `Period ${sub.period}`,
            timeSlot: timetable?.periods[periodIndex]
              ? `${timetable.periods[periodIndex].startTime} - ${timetable.periods[periodIndex].endTime}`
              : null,
            availableTeachers: availableTeachers.available.slice(0, 5),
            backupTeachers: availableTeachers.backup.slice(0, 3)
          };
        })
      );

      return enrichedSubstitutions;
    } catch (error) {
      console.error('Error getting pending substitutions:', error);
      throw error;
    }
  }
}

export default new SubstitutionService();


