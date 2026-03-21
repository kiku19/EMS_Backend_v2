import mongoose from 'mongoose';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

const examSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School' },
    name: { type: String, required: true },
    type: { type: String }, // Canonical field: unit_test, quiz, midterm, final
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
    gradingType: { type: String, default: 'numerical' }, // numerical, grades, cgpa
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
    status: { type: String, default: 'scheduled' }, // scheduled, ongoing, completed, results_published
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
examSchema.index(
  { schoolId: 1, classId: 1, name: 1, academicYear: 1 },
  { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } }
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
