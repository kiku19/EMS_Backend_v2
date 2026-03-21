import mongoose from 'mongoose';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

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
  { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } }
);

export default mongoose.model('Class', classSchema);
