import mongoose from 'mongoose';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';
import { parseAcademicYear } from '../utils/academicYear.js';

const classSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    name: { type: String, required: true }, // e.g., "Class 10"
    section: { type: String, required: true }, // e.g., "A"
    classTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    subjects: [String], // Subjects offered by this class (set at creation, used for academics/results)
    academicYear: { type: String, default: CURRENT_ACADEMIC_YEAR },

    // Strength management
    strengthLimit: {
      current: { type: Number, default: 40 },
      default: { type: Number, default: 40 },
      adjustments: [
        {
          newLimit: Number,
          reason: String,
          approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
          date: { type: Date, default: Date.now },
        },
      ],
    },

    // Academic and attendance tracking
    averageAttendance: { type: Number, default: 0, min: 0, max: 100 },
    averageAcademicPerformance: { type: Number, default: 0, min: 0, max: 100 },
    rating: { type: Number, default: 3, min: 1, max: 5 }, // Synced from ClassRating.rating via /:id/rating/recalculate

    // Chapter progress references
    chapterProgress: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ChapterProgress' }],

    // Room assignment
    room: String,
    block: String,

    // Timetable Management - Class Settings
    classTag: { type: String }, // Free-text tag for class identification
    assignedSubjects: [{ type: String }], // Subjects assigned to teachers for timetable scheduling (distinct from subjects[])

    // Soft Delete
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Compound unique index to prevent duplicate class name+section combinations
// partialFilterExpression excludes soft-deleted classes so a new class can reuse the same name
classSchema.index(
  { schoolId: 1, name: 1, section: 1, academicYear: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

/**
 * Compute and persist the average attendance percentage for a class.
 * Late weight is configurable via school settings (default 100%).
 * Halfday counts as 0.5 present.
 * Updates the `averageAttendance` field on the Class document.
 *
 * @param {ObjectId|string} classId - The class to update
 * @param {ObjectId|string} schoolId - School scope for multi-tenancy
 * @returns {number} The computed average attendance percentage (0-100)
 */
classSchema.statics.updateAverageAttendance = async function updateAverageAttendance(
  classId,
  schoolId
) {
  // Lazy import to avoid circular dependency (Attendance -> Class -> Attendance)
  const { default: Attendance } = await import('./Attendance.js');
  const { default: SchoolSettings } = await import('./SchoolSettings.js');

  // AUDIT-456: Use configurable late weight from school settings
  const settings = await SchoolSettings.findOne({ schoolId }).lean();
  const lateW = (settings?.attendanceRules?.lateWeight ?? 100) / 100;

  // Bound the average to the class's academic year. The Attendance collection
  // holds records for every year a student was enrolled, so without a date
  // filter the average bled across years (last year's absences dragged down
  // this year's Class.averageAttendance). `academicYear` is the class's own
  // value (defaults to CURRENT_ACADEMIC_YEAR); the start/end month-day come
  // from SchoolSettings (academicYearStart/End). Those are stored inconsistently
  // across the codebase — getDefaultSchoolSettings writes full YYYY-MM-DD
  // while routes/attendance.js treats them as MM-DD — so normalise both forms
  // here, defaulting to Apr–Mar for Indian schools.
  const toMonthDay = (value, fallback) => {
    const v = String(value || '').trim();
    if (/^\d{2}-\d{2}$/.test(v)) return v; // already MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v.slice(5); // YYYY-MM-DD → MM-DD
    return fallback;
  };
  const classDoc = await this.findById(classId).select('academicYear').lean();
  const academicYear = classDoc?.academicYear || CURRENT_ACADEMIC_YEAR;
  const { startYear, endYear } = parseAcademicYear(academicYear);
  const startMonthDay = toMonthDay(settings?.academicYearStart, '04-01');
  const endMonthDay = toMonthDay(settings?.academicYearEnd, '03-31');
  const dateRange = {
    $gte: `${startYear}-${startMonthDay}`,
    $lte: `${endYear}-${endMonthDay}`,
  };

  const pipeline = [
    {
      $match: {
        classId: new mongoose.Types.ObjectId(String(classId)),
        schoolId: new mongoose.Types.ObjectId(String(schoolId)),
        date: dateRange,
      },
    },
    {
      $group: {
        _id: null,
        totalRecords: { $sum: 1 },
        presentCount: {
          $sum: {
            $cond: [{ $eq: ['$status', 'present'] }, 1, 0],
          },
        },
        lateCount: {
          $sum: {
            $cond: [{ $eq: ['$status', 'late'] }, 1, 0],
          },
        },
        halfdayCount: {
          $sum: {
            $cond: [{ $eq: ['$status', 'halfday'] }, 1, 0],
          },
        },
      },
    },
  ];

  const [result] = await Attendance.aggregate(pipeline);

  let averageAttendance = 0;
  if (result && result.totalRecords > 0) {
    const effectivePresent =
      result.presentCount + result.lateCount * lateW + result.halfdayCount * 0.5;
    averageAttendance = Math.round((effectivePresent / result.totalRecords) * 100);
  }

  await this.findByIdAndUpdate(classId, { averageAttendance });
  return averageAttendance;
};

export default mongoose.model('Class', classSchema);
