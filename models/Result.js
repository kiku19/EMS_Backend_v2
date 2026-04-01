import mongoose from 'mongoose';

const resultSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
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
    status: { type: String, enum: ['pending', 'passed', 'failed', 'promoted', 'absent'] }, // No default - always compute from marks
    isPublished: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
  },
  { timestamps: true }
);

// Pre-save hook: compute percentage, grade, and pass/fail status from marks
resultSchema.pre('save', function (next) {
  // Single-subject mode: use marksObtained / maxMarks
  if (this.isModified('marksObtained') || this.isModified('maxMarks') || this.isNew) {
    if (this.maxMarks > 0) {
      this.percentage = Math.round(((this.marksObtained || 0) / this.maxMarks) * 10000) / 100;
    }
  }

  // Multi-subject mode: aggregate from marks array
  if (this.marks && this.marks.length > 0 && (this.isModified('marks') || this.isNew)) {
    this.totalMarksObtained = this.marks.reduce((sum, m) => sum + (m.marksObtained || 0), 0);
    this.totalMaxMarks = this.marks.reduce((sum, m) => sum + (m.maxMarks || 0), 0);
    if (this.totalMaxMarks > 0) {
      this.percentage = Math.round((this.totalMarksObtained / this.totalMaxMarks) * 10000) / 100;
    }
  }

  // Determine grade from percentage
  const pct = this.percentage || 0;
  if (pct >= 91) this.grade = 'A1';
  else if (pct >= 81) this.grade = 'A2';
  else if (pct >= 71) this.grade = 'B1';
  else if (pct >= 61) this.grade = 'B2';
  else if (pct >= 51) this.grade = 'C1';
  else if (pct >= 41) this.grade = 'C2';
  else if (pct >= 33) this.grade = 'D';
  else this.grade = 'E';

  // Determine pass/fail status (33% is standard passing threshold)
  // Do not override if status is explicitly set to 'absent' or 'promoted'
  if (!this.status || this.status === 'pending' || this.status === 'passed' || this.status === 'failed') {
    this.status = pct >= 33 ? 'passed' : 'failed';
  }

  next();
});

resultSchema.index(
  { schoolId: 1, examId: 1, studentId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } }
);
resultSchema.index({ studentId: 1, academicYear: 1 });
resultSchema.index({ examId: 1, classId: 1 });

export default mongoose.model('Result', resultSchema);
