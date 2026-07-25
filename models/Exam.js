import mongoose from 'mongoose';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

const examSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    name: { type: String, required: true },
    type: {
      type: String,
      enum: [
        'unit_test',
        'quiz',
        'midterm',
        'final',
        'quarterly',
        'half_yearly',
        'annual',
        'practice',
        'class_test',
        'assignment',
        // Staff-app exam categories (CreateExamScreen segmented control). The
        // staff-app sends these as `examType`; the route handler maps
        // examType → type. Without them in the enum, staff-app exam creation
        // threw a Mongoose ValidationError (500).
        'written',
        'practical',
        'oral',
      ],
    }, // Canonical field
    examType: { type: String }, // Deprecated - use 'type' instead. Kept for backward compat, auto-migrated via pre-save
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
    subjectId: { type: mongoose.Schema.Types.ObjectId }, // Removed ref:'Subject' - no Subject model exists
    subjectName: { type: String }, // Single subject name
    academicYear: { type: String, default: CURRENT_ACADEMIC_YEAR },
    startDate: { type: Date },
    endDate: { type: Date },
    totalMarks: { type: Number, default: 100 }, // Kept in sync with maxMarks via pre-save hook
    maxMarks: { type: Number, default: 100 }, // Canonical field for maximum marks
    passingMarks: { type: Number, default: 35 },
    weightage: { type: Number, default: 10 },
    gradingType: { type: String, enum: ['numerical', 'grades', 'cgpa'], default: 'numerical' },
    instructions: { type: String },
    term: { type: String, enum: ['term_1', 'term_2', 'term_3', 'final'] },
    duration: { type: Number }, // Duration in minutes
    subjects: [
      {
        subjectId: { type: mongoose.Schema.Types.ObjectId },
        subjectName: String,
        date: Date,
        startTime: String,
        endTime: String,
        maxMarks: { type: Number, default: 100 },
        passingMarks: { type: Number, default: 35 },
      },
    ],
    status: {
      type: String,
      enum: ['scheduled', 'ongoing', 'completed', 'results_published'],
      default: 'scheduled',
    },
    isPublished: { type: Boolean, default: false },
    publishedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    examScheduleId: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamSchedule' },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
  },
  { timestamps: true }
);

examSchema.index({ schoolId: 1, classId: 1, academicYear: 1 });
// Exams grid: tenant/year filter followed by the release UI's newest-first sort.
examSchema.index({ schoolId: 1, academicYear: 1, isDeleted: 1, startDate: -1, createdAt: -1 });
examSchema.index(
  { schoolId: 1, classId: 1, name: 1, academicYear: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

examSchema.pre('save', function (next) {
  // Keep maxMarks and totalMarks in sync (maxMarks is canonical)
  if (this.isModified('maxMarks') && !this.isModified('totalMarks')) {
    this.totalMarks = this.maxMarks;
  } else if (this.isModified('totalMarks') && !this.isModified('maxMarks')) {
    this.maxMarks = this.totalMarks;
  }
  // Auto-migrate examType → type (convert hyphens to underscores)
  if (this.examType && !this.type) {
    this.type = this.examType.replace(/-/g, '_');
  }
  next();
});

export default mongoose.model('Exam', examSchema);
