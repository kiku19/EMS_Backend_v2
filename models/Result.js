import mongoose from 'mongoose';
import { computeGrade, computePercentage } from '../utils/grading.js';

const resultSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    examId: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
    academicYear: { type: String },
    // Simple single-subject fields
    // `null` means the teacher has not entered a mark yet. Zero is a valid,
    // intentional mark and must never be used as the empty-state sentinel.
    marksObtained: { type: Number, default: null },
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
  // Placeholder rows created for a new exam must stay pending. Computing a
  // grade/status from null would turn an untouched row into a real zero-mark
  // result and make an incomplete exam publishable.
  if (this.marksObtained == null && (!this.marks || this.marks.length === 0)) {
    this.percentage = null;
    this.grade = undefined;
    this.status = 'pending';
    return next();
  }

  // Single-subject mode: use marksObtained / maxMarks
  if (this.isModified('marksObtained') || this.isModified('maxMarks') || this.isNew) {
    if (this.maxMarks > 0) {
      this.percentage = computePercentage(this.marksObtained || 0, this.maxMarks);
    }
  }

  // Multi-subject mode: aggregate from marks array
  if (this.marks && this.marks.length > 0 && (this.isModified('marks') || this.isNew)) {
    this.totalMarksObtained = this.marks.reduce((sum, m) => sum + (m.marksObtained || 0), 0);
    this.totalMaxMarks = this.marks.reduce((sum, m) => sum + (m.maxMarks || 0), 0);
    if (this.totalMaxMarks > 0) {
      this.percentage = computePercentage(this.totalMarksObtained, this.totalMaxMarks);
    }
  }

  const pct = this.percentage || 0;

  // Grade fallback — respects any caller-supplied value so school-specific
  // gradingScale wins. Only fills in a default for callers that didn't
  // bother (legacy call-sites, tests missing grade).
  if (!this.grade) {
    // Delegate to the shared default scale (utils/grading.js) so there is a
    // single source of truth for grade bands.
    this.grade = computeGrade(pct);
  }

  // Status fallback — only computed when the caller left it unset or 'pending'.
  // 'passed' / 'failed' / 'absent' / 'promoted' are now respected verbatim so
  // exam-specific passingMarks set at the route level survives save().
  if (!this.status || this.status === 'pending') {
    this.status = pct >= 40 ? 'passed' : 'failed';
  }

  next();
});

resultSchema.index(
  { schoolId: 1, examId: 1, studentId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
resultSchema.index({ studentId: 1, academicYear: 1 });
resultSchema.index({ examId: 1, classId: 1 });
// Classes list aggregates published performance by tenant, class and year.
// Keep that release-critical dashboard query bounded as historical results grow.
resultSchema.index({ schoolId: 1, classId: 1, academicYear: 1, isPublished: 1, isDeleted: 1 });

export default mongoose.model('Result', resultSchema);
