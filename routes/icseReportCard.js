/**
 * BOARD-02: ICSE Report Card API
 *
 * Generates ICSE-format report cards for students.
 * ICSE grading is percentage-based with letter grades A1–F.
 *
 * Grades:
 *   A1: 90–100 (Outstanding)
 *   A2: 80–89  (Excellent)
 *   B1: 70–79  (Very Good)
 *   B2: 60–69  (Good)
 *   C:  50–59  (Average)
 *   D:  40–49  (Below Average)
 *   E:  35–39  (Pass — only for some subjects)
 *   F:  0–34   (Fail)
 *
 * Endpoints:
 *   GET  /icse-report-card/student/:studentId         — report cards for a student
 *   POST /icse-report-card                            — create/upsert a report card
 *   PUT  /icse-report-card/:id                        — update an existing card
 *   GET  /icse-report-card/class/:classId             — all cards for a class (bulk)
 *   GET  /icse-report-card/:id                        — single card by ID
 */

import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Student, Attendance } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { extractSchoolId } from '../utils/schoolContext.js';
import { validateZod } from '../validators/zodHelpers.js';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

const router = express.Router();

// ── ICSE Report Card Model (inline — no separate model file needed) ────────────
const subjectSchema = new mongoose.Schema({
  subject: { type: String, required: true, trim: true },
  theoryMarks: { type: Number, min: 0 },
  practicalMarks: { type: Number, min: 0 },
  theoryMaxMarks: { type: Number, default: 80 },
  practicalMaxMarks: { type: Number, default: 20 },
  totalMarks: Number,
  maxMarks: Number,
  percentage: Number,
  grade: String,
  isPassed: Boolean,
  isAbsent: { type: Boolean, default: false },
});

const icseReportCardSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
      index: true,
    },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
    academicYear: { type: String, required: true },
    term: { type: String, enum: ['Term1', 'Term2', 'Annual'], required: true },
    subjects: [subjectSchema],
    totalMarksObtained: Number,
    totalMaxMarks: Number,
    overallPercentage: Number,
    overallGrade: String,
    rank: Number,
    attendanceDaysPresent: Number,
    attendanceTotalDays: Number,
    teacherRemarks: String,
    principalRemarks: String,
    isPublished: { type: Boolean, default: false },
    publishedAt: Date,
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

icseReportCardSchema.index(
  { schoolId: 1, studentId: 1, academicYear: 1, term: 1 },
  {
    unique: true,
    // `sparse: true` does not skip soft-deleted docs, so a re-created card for
    // the same student/year/term would still collide with the tombstone. A
    // partial filter on `isDeleted: false` keeps uniqueness enforced only
    // among live documents — matching CBSEReportCard.js and Exam.js.
    partialFilterExpression: { isDeleted: false },
  }
);

// Use existing model if already registered (to avoid Mongoose OverwriteModelError)
const ICSEReportCard =
  mongoose.models.ICSEReportCard || mongoose.model('ICSEReportCard', icseReportCardSchema);

// ── ICSE Grading Logic ─────────────────────────────────────────────────────────
const ICSE_GRADE_SCALE = [
  { min: 90, grade: 'A1', label: 'Outstanding' },
  { min: 80, grade: 'A2', label: 'Excellent' },
  { min: 70, grade: 'B1', label: 'Very Good' },
  { min: 60, grade: 'B2', label: 'Good' },
  { min: 50, grade: 'C', label: 'Average' },
  { min: 40, grade: 'D', label: 'Below Average' },
  { min: 35, grade: 'E', label: 'Pass' },
  { min: 0, grade: 'F', label: 'Fail' },
];

export function computeICSEGrade(marks, maxMarks) {
  if (maxMarks <= 0) return { grade: 'N/A', percentage: 0, isPassed: false, label: '' };
  const pct = (marks / maxMarks) * 100;
  const entry =
    ICSE_GRADE_SCALE.find((g) => pct >= g.min) || ICSE_GRADE_SCALE[ICSE_GRADE_SCALE.length - 1];
  return {
    grade: entry.grade,
    label: entry.label,
    percentage: Math.round(pct * 100) / 100,
    isPassed: pct >= 35,
  };
}

function applyICSEGrading(subjects) {
  return (subjects || []).map((s) => {
    if (s.isAbsent) return { ...s, grade: 'AB', isPassed: false, percentage: 0 };
    const theory = s.theoryMarks ?? 0;
    const practical = s.practicalMarks ?? 0;
    const total = theory + practical;
    const max = (s.theoryMaxMarks ?? 80) + (s.practicalMaxMarks ?? 20);
    const result = computeICSEGrade(total, max);
    return { ...s, totalMarks: total, maxMarks: max, ...result };
  });
}

function computeOverall(gradedSubjects) {
  const valid = gradedSubjects.filter((s) => !s.isAbsent && s.maxMarks > 0);
  if (!valid.length)
    return { totalMarksObtained: 0, totalMaxMarks: 0, overallPercentage: 0, overallGrade: 'N/A' };
  const totalObtained = valid.reduce((sum, s) => sum + (s.totalMarks ?? 0), 0);
  const totalMax = valid.reduce((sum, s) => sum + (s.maxMarks ?? 0), 0);
  const pct = totalMax > 0 ? (totalObtained / totalMax) * 100 : 0;
  const entry =
    ICSE_GRADE_SCALE.find((g) => pct >= g.min) || ICSE_GRADE_SCALE[ICSE_GRADE_SCALE.length - 1];
  return {
    totalMarksObtained: totalObtained,
    totalMaxMarks: totalMax,
    overallPercentage: Math.round(pct * 100) / 100,
    overallGrade: entry.grade,
  };
}

// ── Scoping Helper ─────────────────────────────────────────────────────────────
function scopeBySchool(schoolId, query = {}) {
  const id = extractSchoolId(schoolId);
  if (!id) throw new Error('schoolId is required');
  return { ...query, schoolId: id };
}

// ── Zod Schemas ────────────────────────────────────────────────────────────────
const subjectInputSchema = z.object({
  subject: z.string().min(1).max(100),
  theoryMarks: z.number().min(0).max(500).optional(),
  practicalMarks: z.number().min(0).max(500).optional(),
  theoryMaxMarks: z.number().min(0).max(500).default(80),
  practicalMaxMarks: z.number().min(0).max(500).default(20),
  isAbsent: z.boolean().default(false),
});

const createICSESchema = z.object({
  studentId: z.string().min(1),
  classId: z.string().optional(),
  academicYear: z.string().default(CURRENT_ACADEMIC_YEAR),
  term: z.enum(['Term1', 'Term2', 'Annual']),
  subjects: z.array(subjectInputSchema).min(1),
  attendanceDaysPresent: z.number().int().min(0).optional(),
  attendanceTotalDays: z.number().int().min(0).optional(),
  teacherRemarks: z.string().max(1000).optional(),
  principalRemarks: z.string().max(1000).optional(),
});

const updateICSESchema = createICSESchema
  .partial()
  .omit({ studentId: true, term: true, academicYear: true });

// ── Routes ─────────────────────────────────────────────────────────────────────
router.use(authenticate);

// GET /icse-report-card/student/:studentId
router.get('/student/:studentId', checkPermission('students', 'view'), async (req, res) => {
  try {
    const { studentId } = req.params;
    const { academicYear = CURRENT_ACADEMIC_YEAR, term } = req.query;
    const schoolId = req.user?.schoolId;

    const student = await Student.findOne(
      scopeBySchool(schoolId, { _id: studentId, isDeleted: { $ne: true } })
    )
      .populate('classId', 'name section')
      .lean();
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const query = scopeBySchool(schoolId, { studentId, academicYear, isDeleted: { $ne: true } });
    if (term) query.term = term;

    const cards = await ICSEReportCard.find(query).sort({ term: 1 }).lean();

    res.json({
      student: {
        _id: student._id,
        name: student.name,
        admissionNo: student.admissionNumber || student.admissionId,
        rollNo: student.rollNo,
        dob: student.dateOfBirth,
        className: student.classId
          ? `${student.classId.name}${student.classId.section ? ' ' + student.classId.section : ''}`
          : null,
      },
      reportCards: cards,
    });
  } catch (err) {
    console.error('ICSE report card fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch ICSE report cards' });
  }
});

// GET /icse-report-card/class/:classId — bulk for a class
router.get('/class/:classId', checkPermission('students', 'view'), async (req, res) => {
  try {
    const { classId } = req.params;
    const { academicYear = CURRENT_ACADEMIC_YEAR, term } = req.query;
    const schoolId = req.user?.schoolId;

    const query = scopeBySchool(schoolId, { classId, academicYear, isDeleted: { $ne: true } });
    if (term) query.term = term;

    const cards = await ICSEReportCard.find(query)
      .populate('studentId', 'name admissionId rollNo')
      .lean();

    res.json({ count: cards.length, reportCards: cards });
  } catch (err) {
    console.error('ICSE class report error:', err);
    res.status(500).json({ error: 'Failed to fetch class ICSE report cards' });
  }
});

// GET /icse-report-card/:id — single card
router.get('/:id', checkPermission('students', 'view'), async (req, res) => {
  try {
    const card = await ICSEReportCard.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
    )
      .populate('studentId', 'name admissionId rollNo classId')
      .lean();
    if (!card) return res.status(404).json({ error: 'ICSE report card not found' });
    res.json(card);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch ICSE report card' });
  }
});

// POST /icse-report-card — create/upsert
router.post(
  '/',
  checkPermission('students', 'create'),
  validateZod(createICSESchema),
  async (req, res) => {
    try {
      const schoolId = req.user?.schoolId;
      const { studentId, classId, academicYear, term, subjects, ...rest } = req.body;

      const gradedSubjects = applyICSEGrading(subjects);
      const overall = computeOverall(gradedSubjects);

      const cardData = {
        schoolId: extractSchoolId(schoolId),
        studentId,
        classId,
        academicYear,
        term,
        subjects: gradedSubjects,
        ...overall,
        ...rest,
      };

      // Upsert by student + year + term
      const card = await ICSEReportCard.findOneAndUpdate(
        scopeBySchool(schoolId, { studentId, academicYear, term }),
        { $set: cardData },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      res.status(201).json(card);
    } catch (err) {
      console.error('ICSE create error:', err);
      res.status(500).json({ error: 'Failed to create ICSE report card' });
    }
  }
);

// PUT /icse-report-card/:id — update
router.put(
  '/:id',
  checkPermission('students', 'update'),
  validateZod(updateICSESchema),
  async (req, res) => {
    try {
      const card = await ICSEReportCard.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
      );
      if (!card) return res.status(404).json({ error: 'ICSE report card not found' });

      // AC4: reject edits to a published card, mirroring the CBSE guard in
      // cbseReportCard.js. Once a card is published it must be immutable; edits
      // would silently change what parents/students have already received.
      if (card.isPublished) {
        return res.status(400).json({ error: 'Cannot modify published report card' });
      }

      const { subjects, ...rest } = req.body;
      if (subjects) {
        const gradedSubjects = applyICSEGrading(subjects);
        const overall = computeOverall(gradedSubjects);
        Object.assign(card, { subjects: gradedSubjects, ...overall });
      }
      Object.assign(card, rest);

      await card.save();
      res.json(card);
    } catch (err) {
      console.error('ICSE update error:', err);
      res.status(500).json({ error: 'Failed to update ICSE report card' });
    }
  }
);

// POST /icse-report-card/:id/publish — publish report card
router.post('/:id/publish', checkPermission('students', 'update'), async (req, res) => {
  try {
    const card = await ICSEReportCard.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    );
    if (!card) return res.status(404).json({ error: 'ICSE report card not found' });

    card.isPublished = true;
    card.publishedAt = new Date();
    await card.save();

    res.json({ message: 'Report card published', card });
  } catch (err) {
    res.status(500).json({ error: 'Failed to publish ICSE report card' });
  }
});

// GET /icse-report-card/grade-scale — return ICSE grading scale
router.get('/meta/grade-scale', (req, res) => {
  res.json({ gradeScale: ICSE_GRADE_SCALE, passingPercentage: 35 });
});

export default router;
