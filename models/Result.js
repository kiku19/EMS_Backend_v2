import mongoose from 'mongoose';

const resultSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School' },
    examId: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
    academicYear: { type: String },
    // Simple single-subject fields
    marksObtained: { type: Number, default: 0 },
    maxMarks: { type: Number, default: 100 },
    remarks: { type: String },
    enteredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    enteredAt: { type: Date },
    // Multi-subject support (legacy/advanced)
    marks: [
      {
        subjectId: { type: mongoose.Schema.Types.ObjectId },
        subjectName: String,
        marksObtained: Number,
        maxMarks: Number,
        passingMarks: Number,
        grade: String,
        remarks: String,
      },
    ],
    totalMarksObtained: { type: Number, default: 0 },
    totalMaxMarks: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
    grade: String,
    rank: Number,
    status: { type: String, enum: ['pending', 'passed', 'failed', 'promoted'] }, // No default - always compute from marks
    isPublished: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
  },
  { timestamps: true }
);

resultSchema.index(
  { schoolId: 1, examId: 1, studentId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } }
);
resultSchema.index({ studentId: 1, academicYear: 1 });
resultSchema.index({ examId: 1, classId: 1 });

export default mongoose.model('Result', resultSchema);
