import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';
import { Timetable, TeacherTimetable, Class, Staff } from '../database.js';

/**
 * Service for validating timetable completeness and identifying gaps
 * Implements validation for both class and teacher timetables
 */
class ValidationService {
  /**
   * Identify empty slots in a class timetable
   * @param {string} classId - Class ID
   * @param {string} academicYear - Academic year
   * @returns {Promise<Array>} - Array of empty slots with day and period information
   */
  async identifyEmptySlots(classId, academicYear = CURRENT_ACADEMIC_YEAR) {
    const classTimetable = await Timetable.findOne({ classId, academicYear });
    
    if (!classTimetable) {
      throw new Error(`Class timetable not found for classId: ${classId}`);
    }

    const emptySlots = [];
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    for (const day of days) {
      if (!classTimetable.schedule[day]) {
        continue;
      }

      classTimetable.schedule[day].forEach((slot, periodIndex) => {
        // A slot is empty if subject is empty/null or teacherId is null/undefined
        if (!slot.subject || slot.subject === '' || !slot.teacherId) {
          emptySlots.push({
            day,
            periodIndex,
            periodName: classTimetable.periods[periodIndex]?.name || `Period ${periodIndex + 1}`,
            startTime: classTimetable.periods[periodIndex]?.startTime || '',
            endTime: classTimetable.periods[periodIndex]?.endTime || '',
            isBreak: classTimetable.periods[periodIndex]?.isBreak || false
          });
        }
      });
    }

    return emptySlots;
  }

  /**
   * Identify unassigned periods in a teacher timetable
   * @param {string} teacherId - Teacher ID
   * @param {string} academicYear - Academic year
   * @returns {Promise<Array>} - Array of unassigned periods with day and period information
   */
  async identifyTeacherScheduleGaps(teacherId, academicYear = CURRENT_ACADEMIC_YEAR) {
    const teacherTimetable = await TeacherTimetable.findOne({ teacherId, academicYear });
    
    if (!teacherTimetable) {
      // If no timetable exists, all periods are gaps
      // We need to get a reference timetable to know the periods structure
      const referenceTimetable = await Timetable.findOne({ academicYear }).limit(1);
      
      if (!referenceTimetable) {
        return []; // No reference timetable available
      }

      const gaps = [];
      const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const totalPeriods = referenceTimetable.periods.length;

      for (const day of days) {
        for (let periodIndex = 0; periodIndex < totalPeriods; periodIndex++) {
          const period = referenceTimetable.periods[periodIndex];
          if (!period.isBreak) {
            gaps.push({
              day,
              periodIndex,
              periodName: period.name || `Period ${periodIndex + 1}`,
              startTime: period.startTime || '',
              endTime: period.endTime || ''
            });
          }
        }
      }

      return gaps;
    }

    // Get a reference timetable to know the total periods
    const referenceTimetable = await Timetable.findOne({ academicYear }).limit(1);
    
    if (!referenceTimetable) {
      return []; // No reference timetable available
    }

    const gaps = [];
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const totalPeriods = referenceTimetable.periods.length;

    for (const day of days) {
      const daySchedule = teacherTimetable.schedule[day] || [];
      
      for (let periodIndex = 0; periodIndex < totalPeriods; periodIndex++) {
        const period = referenceTimetable.periods[periodIndex];
        
        // Skip breaks
        if (period.isBreak) {
          continue;
        }

        // Check if teacher has an assignment for this period
        const hasAssignment = daySchedule.some(slot => slot.periodIndex === periodIndex && slot.classId);

        if (!hasAssignment) {
          gaps.push({
            day,
            periodIndex,
            periodName: period.name || `Period ${periodIndex + 1}`,
            startTime: period.startTime || '',
            endTime: period.endTime || ''
          });
        }
      }
    }

    return gaps;
  }

  /**
   * Generate a validation report for a class timetable
   * @param {string} classId - Class ID
   * @param {string} academicYear - Academic year
   * @returns {Promise<Object>} - Validation report with statistics
   */
  async generateClassValidationReport(classId, academicYear = CURRENT_ACADEMIC_YEAR) {
    const classDoc = await Class.findById(classId);
    if (!classDoc) {
      throw new Error(`Class not found: ${classId}`);
    }

    const emptySlots = await this.identifyEmptySlots(classId, academicYear);
    const classTimetable = await Timetable.findOne({ classId, academicYear });

    if (!classTimetable) {
      return {
        classId,
        className: `${classDoc.name} ${classDoc.section}`,
        academicYear,
        totalSlots: 0,
        filledSlots: 0,
        emptySlots: 0,
        completenessPercentage: 0,
        emptySlotDetails: []
      };
    }

    // Calculate total non-break slots
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    let totalSlots = 0;

    for (const day of days) {
      if (classTimetable.schedule[day]) {
        classTimetable.schedule[day].forEach((slot, index) => {
          const period = classTimetable.periods[index];
          if (!period?.isBreak) {
            totalSlots++;
          }
        });
      }
    }

    const filledSlots = totalSlots - emptySlots.length;
    const completenessPercentage = totalSlots > 0 ? Math.round((filledSlots / totalSlots) * 100) : 0;

    return {
      classId,
      className: `${classDoc.name} ${classDoc.section}`,
      academicYear,
      totalSlots,
      filledSlots,
      emptySlots: emptySlots.length,
      completenessPercentage,
      emptySlotDetails: emptySlots
    };
  }

  /**
   * Generate a validation report for a teacher timetable
   * @param {string} teacherId - Teacher ID
   * @param {string} academicYear - Academic year
   * @returns {Promise<Object>} - Validation report with statistics
   */
  async generateTeacherValidationReport(teacherId, academicYear = CURRENT_ACADEMIC_YEAR) {
    const teacher = await Staff.findById(teacherId);
    if (!teacher) {
      throw new Error(`Teacher not found: ${teacherId}`);
    }

    const gaps = await this.identifyTeacherScheduleGaps(teacherId, academicYear);
    
    // Get reference timetable to calculate total periods
    const referenceTimetable = await Timetable.findOne({ academicYear }).limit(1);
    
    if (!referenceTimetable) {
      return {
        teacherId,
        teacherName: teacher.name,
        academicYear,
        totalPeriods: 0,
        assignedPeriods: 0,
        unassignedPeriods: 0,
        utilizationPercentage: 0,
        gapDetails: []
      };
    }

    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const nonBreakPeriods = referenceTimetable.periods.filter(p => !p.isBreak).length;
    const totalPeriods = days.length * nonBreakPeriods;
    const assignedPeriods = totalPeriods - gaps.length;
    const utilizationPercentage = totalPeriods > 0 ? Math.round((assignedPeriods / totalPeriods) * 100) : 0;

    return {
      teacherId,
      teacherName: teacher.name,
      academicYear,
      totalPeriods,
      assignedPeriods,
      unassignedPeriods: gaps.length,
      utilizationPercentage,
      gapDetails: gaps
    };
  }

  /**
   * Generate a comprehensive validation report for all classes
   * @param {string} academicYear - Academic year
   * @returns {Promise<Object>} - Comprehensive validation report
   */
  async generateComprehensiveClassReport(academicYear = CURRENT_ACADEMIC_YEAR) {
    const classes = await Class.find({ academicYear });
    const reports = [];

    for (const classDoc of classes) {
      try {
        const report = await this.generateClassValidationReport(classDoc._id, academicYear);
        reports.push(report);
      } catch (error) {
        console.error(`Error generating report for class ${classDoc._id}:`, error);
      }
    }

    // Calculate overall statistics
    const totalClasses = reports.length;
    const completeClasses = reports.filter(r => r.completenessPercentage === 100).length;
    const incompleteClasses = totalClasses - completeClasses;
    const averageCompleteness = reports.length > 0
      ? Math.round(reports.reduce((sum, r) => sum + r.completenessPercentage, 0) / reports.length)
      : 0;

    return {
      academicYear,
      totalClasses,
      completeClasses,
      incompleteClasses,
      averageCompleteness,
      classReports: reports
    };
  }

  /**
   * Generate a comprehensive validation report for all teachers
   * @param {string} academicYear - Academic year
   * @returns {Promise<Object>} - Comprehensive validation report
   */
  async generateComprehensiveTeacherReport(academicYear = CURRENT_ACADEMIC_YEAR) {
    const teachers = await Staff.find({ role: 'Teacher' });
    const reports = [];

    for (const teacher of teachers) {
      try {
        const report = await this.generateTeacherValidationReport(teacher._id, academicYear);
        reports.push(report);
      } catch (error) {
        console.error(`Error generating report for teacher ${teacher._id}:`, error);
      }
    }

    // Calculate overall statistics
    const totalTeachers = reports.length;
    const fullyUtilizedTeachers = reports.filter(r => r.utilizationPercentage === 100).length;
    const underutilizedTeachers = totalTeachers - fullyUtilizedTeachers;
    const averageUtilization = reports.length > 0
      ? Math.round(reports.reduce((sum, r) => sum + r.utilizationPercentage, 0) / reports.length)
      : 0;

    return {
      academicYear,
      totalTeachers,
      fullyUtilizedTeachers,
      underutilizedTeachers,
      averageUtilization,
      teacherReports: reports
    };
  }
}

export default new ValidationService();


