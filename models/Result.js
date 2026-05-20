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

// Pre-save hook: compute percentage from marks. Grade and status are NOT
// computed here — they depend on school.gradingScale + exam.passingMarks
// which aren't available on the document. Callers (routes/academics.js
// single and bulk result paths) compute them via computeGrade() and explicit
// status assignment. This hook falls back to a CBSE-ish default ONLY when
// the caller didn't set grade/status at all — previously it
// UNCONDITIONALLY overrode caller-supplied values so an admin marking a
// student 'passed' at 30% (legitimate — exam.passingMarks was 25) got
// silently flipped to 'failed'.
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

  const pct = this.percentage || 0;

  // Grade fallback — respects any caller-supplied value so school-specific
  // gradingScale wins. Only fills in a default for callers that didn't
  // bother (legacy call-sites, tests missing grade).
  if (!this.grade) {
    if (pct >= 91) this.grade = 'A1';
    else if (pct >= 81) this.grade = 'A2';
    else if (pct >= 71) this.grade = 'B1';
    else if (pct >= 61) this.grade = 'B2';
    else if (pct >= 51) this.grade = 'C1';
    else if (pct >= 41) this.grade = 'C2';
    else if (pct >= 33) this.grade = 'D';
    else this.grade = 'E';
  }

  // Status fallback — only computed when the caller left it unset or 'pending'.
  // 'passed' / 'failed' / 'absent' / 'promoted' are now respected verbatim so
  // exam-specific passingMarks set at the route level survives save().
  if (!this.status || this.status === 'pending') {
    this.status = pct >= 33 ? 'passed' : 'failed';
  }

  next();
});

resultSchema.index(
  { schoolId: 1, examId: 1, studentId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
resultSchema.index({ studentId: 1, academicYear: 1 });
resultSchema.index({ examId: 1, classId: 1 });

export default mongoose.model('Result', resultSchema);
