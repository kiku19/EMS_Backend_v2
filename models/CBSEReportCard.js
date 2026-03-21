import mongoose from 'mongoose';

// CBSE 9-point scholastic grading scale
// A1: 91-100 (GP 10), A2: 81-90 (GP 9), B1: 71-80 (GP 8), B2: 61-70 (GP 7),
// C1: 51-60 (GP 6), C2: 41-50 (GP 5), D: 33-40 (GP 4), E1/E2: <33 (Fail)
export const CBSE_GRADE_SCALE = [
  { min: 91, max: 100, grade: 'A1', gradePoint: 10, isPassed: true },
  { min: 81, max: 90, grade: 'A2', gradePoint: 9, isPassed: true },
  { min: 71, max: 80, grade: 'B1', gradePoint: 8, isPassed: true },
  { min: 61, max: 70, grade: 'B2', gradePoint: 7, isPassed: true },
  { min: 51, max: 60, grade: 'C1', gradePoint: 6, isPassed: true },
  { min: 41, max: 50, grade: 'C2', gradePoint: 5, isPassed: true },
  { min: 33, max: 40, grade: 'D', gradePoint: 4, isPassed: true },
  { min: 21, max: 32, grade: 'E1', gradePoint: 3, isPassed: false },
  { min: 0, max: 20, grade: 'E2', gradePoint: 2, isPassed: false },
];

export function computeCBSEGrade(marks, maxMarks = 100) {
  if (marks == null || maxMarks == null || maxMarks === 0) return null;
  const pct = (marks / maxMarks) * 100;
  return (
    CBSE_GRADE_SCALE.find((s) => pct >= s.min && pct <= s.max) ||
    CBSE_GRADE_SCALE[CBSE_GRADE_SCALE.length - 1]
  );
}

export function computeCBSECGPA(scholasticGrades) {
  const graded = scholasticGrades.filter((s) => s.gradePoint != null);
  if (graded.length === 0) return null;
  // CGPA = average of best 5 subjects' grade points
  const sorted = [...graded].sort((a, b) => b.gradePoint - a.gradePoint);
  const best5 = sorted.slice(0, 5);
  const total = best5.reduce((sum, s) => sum + s.gradePoint, 0);
  return Math.round((total / best5.length) * 10) / 10;
}

// ─── Sub-schemas ─────────────────────────────────────────────────────────────

const scholasticSubjectSchema = new mongoose.Schema(
  {
    subjectName: { type: String, required: true, trim: true },
    subjectCode: { type: String, trim: true },
    // Theory component
    theoryMaxMarks: { type: Number, default: 80 },
    theoryMarks: { type: Number, default: null },
    // Practical/Internal Assessment component
    practicalMaxMarks: { type: Number, default: 20 },
    practicalMarks: { type: Number, default: null },
    // Totals (theory + practical)
    totalMarks: { type: Number, default: null },
    maxMarks: { type: Number, default: 100 },
    // Computed grading
    grade: { type: String, enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D', 'E1', 'E2'] },
    gradePoint: { type: Number },
    isPassed: { type: Boolean, default: true },
    remarks: { type: String, maxlength: 200 },
  },
  { _id: false }
);

const coScholasticAreaSchema = new mongoose.Schema(
  {
    // CBSE Co-Scholastic Areas: Work Education, Art Education, Health & Physical Education
    area: { type: String, required: true, trim: true },
    activity: { type: String, trim: true },
    grade: { type: String, enum: ['A', 'B', 'C', 'D'] },
  },
  { _id: false }
);

// ─── Main Schema ──────────────────────────────────────────────────────────────

const cbseReportCardSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    academicYear: { type: String, required: true },
    term: {
      type: String,
      enum: ['term_1', 'term_2', 'annual'],
      required: true,
    },

    // Part I — Scholastic Areas
    scholasticGrades: [scholasticSubjectSchema],

    // Part II — Co-Scholastic Areas (graded A–D)
    coScholasticGrades: [coScholasticAreaSchema],

    // Part III — Discipline
    disciplineGrade: { type: String, enum: ['A', 'B', 'C', 'D'] },
    disciplineRemarks: { type: String, maxlength: 300 },

    // Computed summary
    cgpa: { type: Number }, // Best-5 CGPA
    totalGradePoints: { type: Number }, // Sum across all scholastic subjects

    // Remarks
    classTeacherRemarks: { type: String, maxlength: 500 },
    principalRemarks: { type: String, maxlength: 500 },

    // Publishing
    isPublished: { type: Boolean, default: false },
    publishedAt: { type: Date },

    // Audit
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
  },
  { timestamps: true }
);

// One report card per student per term per academic year
cbseReportCardSchema.index(
  { schoolId: 1, studentId: 1, academicYear: 1, term: 1 },
  { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } }
);
cbseReportCardSchema.index({ schoolId: 1, classId: 1, academicYear: 1, term: 1 });

export default mongoose.model('CBSEReportCard', cbseReportCardSchema);
