import express from 'express';
import { Student, Attendance } from '../database.js';
import CBSEReportCard, { computeCBSEGrade, computeCBSECGPA } from '../models/CBSEReportCard.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { extractSchoolId } from '../utils/schoolContext.js';
import { validateZod } from '../validators/zodHelpers.js';
import {
  createCBSEReportCardSchema,
  updateCBSEReportCardSchema,
  bulkCBSEReportCardsSchema,
} from '../validators/cbseSchema.js';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

const router = express.Router();

function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) throw new Error('schoolId is required for scoped queries');
  return { ...query, schoolId: normalizedSchoolId };
}

/** Apply CBSE grading to all scholastic subjects and compute CGPA */
function applyGrading(scholasticGrades) {
  const graded = (scholasticGrades || []).map((s) => {
    const totalMarks = (s.theoryMarks ?? 0) + (s.practicalMarks ?? 0);
    const maxMarks = (s.theoryMaxMarks ?? 0) + (s.practicalMaxMarks ?? 0) || s.maxMarks || 100;
    const result = computeCBSEGrade(totalMarks, maxMarks);
    return {
      ...s,
      totalMarks,
      maxMarks,
      grade: result?.grade ?? s.grade,
      gradePoint: result?.gradePoint ?? s.gradePoint,
      isPassed: result?.isPassed ?? s.isPassed,
    };
  });
  return graded;
}

// ─── GET /cbse-report-card/student/:studentId ─────────────────────────────────
// Returns all CBSE report cards for a student (optionally filtered by term/year)
router.get(
  '/student/:studentId',
  authenticate,
  checkPermission('students', 'view'),
  async (req, res) => {
    try {
      const { studentId } = req.params;
      const schoolId = req.user?.schoolId;
      const { academicYear = CURRENT_ACADEMIC_YEAR, term } = req.query;

      const query = scopeBySchool(schoolId, {
        studentId,
        academicYear,
        isDeleted: { $ne: true },
      });
      if (term) query.term = term;

      const student = await Student.findOne(
        scopeBySchool(schoolId, { _id: studentId, isDeleted: { $ne: true } })
      )
        .populate('classId', 'name section')
        .lean();
      if (!student) return res.status(404).json({ error: 'Student not found' });

      const reportCards = await CBSEReportCard.find(query).lean();

      res.json({
        student: {
          _id: student._id,
          name: student.name,
          admissionNo: student.admissionNumber || student.admissionNo,
          rollNo: student.rollNo,
          dob: student.dob,
          fatherName: student.fatherName || student.guardianName,
          className: student.classId?.name
            ? `${student.classId.name}${student.classId.section ? ' ' + student.classId.section : ''}`
            : null,
        },
        reportCards,
      });
    } catch (error) {
      console.error('Error fetching CBSE report cards:', error);
      res.status(500).json({ error: 'Failed to fetch CBSE report cards' });
    }
  }
);

// ─── GET /cbse-report-card/class/:classId ─────────────────────────────────────
// Returns report cards for all students in a class for a given term
router.get(
  '/class/:classId',
  authenticate,
  checkPermission('students', 'view'),
  async (req, res) => {
    try {
      const { classId } = req.params;
      const schoolId = req.user?.schoolId;
      const { academicYear = CURRENT_ACADEMIC_YEAR, term } = req.query;

      const query = scopeBySchool(schoolId, {
        classId,
        academicYear,
        isDeleted: { $ne: true },
      });
      if (term) query.term = term;

      const reportCards = await CBSEReportCard.find(query)
        .populate('studentId', 'name admissionNumber rollNo')
        .lean();

      res.json({ classId, academicYear, term: term || null, reportCards });
    } catch (error) {
      console.error('Error fetching class CBSE report cards:', error);
      res.status(500).json({ error: 'Failed to fetch class CBSE report cards' });
    }
  }
);

// ─── GET /cbse-report-card/:id ────────────────────────────────────────────────
router.get('/:id', authenticate, checkPermission('students', 'view'), async (req, res) => {
  try {
    const { id } = req.params;
    const schoolId = req.user?.schoolId;

    const reportCard = await CBSEReportCard.findOne(
      scopeBySchool(schoolId, { _id: id, isDeleted: { $ne: true } })
    )
      .populate('studentId', 'name admissionNumber admissionNo rollNo dob fatherName guardianName')
      .populate('classId', 'name section')
      .lean();

    if (!reportCard) return res.status(404).json({ error: 'CBSE report card not found' });
    res.json(reportCard);
  } catch (error) {
    console.error('Error fetching CBSE report card:', error);
    res.status(500).json({ error: 'Failed to fetch CBSE report card' });
  }
});

// ─── POST /cbse-report-card ───────────────────────────────────────────────────
// Create or overwrite a student's CBSE report card for a given term/year
router.post(
  '/',
  authenticate,
  checkPermission('students', 'edit'),
  validateZod(createCBSEReportCardSchema),
  async (req, res) => {
    try {
      const schoolId = req.user?.schoolId;
      const { studentId, classId, academicYear, term, scholasticGrades, ...rest } = req.body;

      // Auto-compute CBSE grades on save
      const gradedScholastic = applyGrading(scholasticGrades);
      const cgpa = computeCBSECGPA(gradedScholastic);
      const totalGradePoints = gradedScholastic.reduce((s, g) => s + (g.gradePoint || 0), 0);

      // Upsert: one card per student/term/year
      const reportCard = await CBSEReportCard.findOneAndUpdate(
        scopeBySchool(schoolId, { studentId, academicYear, term, isDeleted: { $ne: true } }),
        {
          $set: {
            schoolId,
            studentId,
            classId,
            academicYear,
            term,
            scholasticGrades: gradedScholastic,
            cgpa,
            totalGradePoints,
            createdBy: req.user._id,
            ...rest,
          },
        },
        { new: true, upsert: true, runValidators: true }
      );

      res.status(201).json(reportCard);
    } catch (error) {
      if (error.code === 11000) {
        return res
          .status(409)
          .json({ error: 'A CBSE report card already exists for this student/term/year' });
      }
      console.error('Error creating CBSE report card:', error);
      res.status(500).json({ error: 'Failed to create CBSE report card' });
    }
  }
);

// ─── POST /cbse-report-card/bulk ──────────────────────────────────────────────
// Upsert report cards for multiple students in a class at once
router.post(
  '/bulk',
  authenticate,
  checkPermission('students', 'edit'),
  validateZod(bulkCBSEReportCardsSchema),
  async (req, res) => {
    try {
      const schoolId = req.user?.schoolId;
      const { classId, academicYear, term, reportCards } = req.body;

      const ops = reportCards.map((card) => {
        const gradedScholastic = applyGrading(card.scholasticGrades);
        const cgpa = computeCBSECGPA(gradedScholastic);
        const totalGradePoints = gradedScholastic.reduce((s, g) => s + (g.gradePoint || 0), 0);

        return {
          updateOne: {
            filter: scopeBySchool(schoolId, {
              studentId: card.studentId,
              academicYear,
              term,
              isDeleted: { $ne: true },
            }),
            update: {
              $set: {
                schoolId,
                studentId: card.studentId,
                classId,
                academicYear,
                term,
                scholasticGrades: gradedScholastic,
                coScholasticGrades: card.coScholasticGrades || [],
                disciplineGrade: card.disciplineGrade,
                classTeacherRemarks: card.classTeacherRemarks,
                cgpa,
                totalGradePoints,
                createdBy: req.user._id,
              },
            },
            upsert: true,
          },
        };
      });

      const result = await CBSEReportCard.bulkWrite(ops);
      res.json({
        message: 'Bulk CBSE report cards saved',
        upsertedCount: result.upsertedCount,
        modifiedCount: result.modifiedCount,
      });
    } catch (error) {
      console.error('Error bulk saving CBSE report cards:', error);
      res.status(500).json({ error: 'Failed to bulk save CBSE report cards' });
    }
  }
);

// ─── PUT /cbse-report-card/:id ────────────────────────────────────────────────
router.put(
  '/:id',
  authenticate,
  checkPermission('students', 'edit'),
  validateZod(updateCBSEReportCardSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const schoolId = req.user?.schoolId;

      const existing = await CBSEReportCard.findOne(
        scopeBySchool(schoolId, { _id: id, isDeleted: { $ne: true } })
      );
      if (!existing) return res.status(404).json({ error: 'CBSE report card not found' });

      const updates = { ...req.body };
      if (updates.scholasticGrades) {
        updates.scholasticGrades = applyGrading(updates.scholasticGrades);
        updates.cgpa = computeCBSECGPA(updates.scholasticGrades);
        updates.totalGradePoints = updates.scholasticGrades.reduce(
          (s, g) => s + (g.gradePoint || 0),
          0
        );
      }

      const updated = await CBSEReportCard.findByIdAndUpdate(
        id,
        { $set: updates },
        { new: true, runValidators: true }
      );
      res.json(updated);
    } catch (error) {
      console.error('Error updating CBSE report card:', error);
      res.status(500).json({ error: 'Failed to update CBSE report card' });
    }
  }
);

// ─── POST /cbse-report-card/:id/publish ──────────────────────────────────────
router.post('/:id/publish', authenticate, checkPermission('students', 'edit'), async (req, res) => {
  try {
    const { id } = req.params;
    const schoolId = req.user?.schoolId;

    const reportCard = await CBSEReportCard.findOneAndUpdate(
      scopeBySchool(schoolId, { _id: id, isDeleted: { $ne: true } }),
      { $set: { isPublished: true, publishedAt: new Date() } },
      { new: true }
    );
    if (!reportCard) return res.status(404).json({ error: 'CBSE report card not found' });
    res.json({ message: 'CBSE report card published', reportCard });
  } catch (error) {
    console.error('Error publishing CBSE report card:', error);
    res.status(500).json({ error: 'Failed to publish CBSE report card' });
  }
});

// ─── POST /cbse-report-card/class/:classId/publish ───────────────────────────
// Bulk publish all report cards for a class/term
router.post(
  '/class/:classId/publish',
  authenticate,
  checkPermission('students', 'edit'),
  async (req, res) => {
    try {
      const { classId } = req.params;
      const schoolId = req.user?.schoolId;
      const { academicYear = CURRENT_ACADEMIC_YEAR, term } = req.body;

      const query = scopeBySchool(schoolId, {
        classId,
        academicYear,
        isDeleted: { $ne: true },
        isPublished: false,
      });
      if (term) query.term = term;

      const result = await CBSEReportCard.updateMany(query, {
        $set: { isPublished: true, publishedAt: new Date() },
      });
      res.json({ message: `Published ${result.modifiedCount} CBSE report cards` });
    } catch (error) {
      console.error('Error bulk publishing CBSE report cards:', error);
      res.status(500).json({ error: 'Failed to bulk publish CBSE report cards' });
    }
  }
);

// ─── DELETE /cbse-report-card/:id ────────────────────────────────────────────
router.delete('/:id', authenticate, checkPermission('students', 'edit'), async (req, res) => {
  try {
    const { id } = req.params;
    const schoolId = req.user?.schoolId;

    const reportCard = await CBSEReportCard.findOneAndUpdate(
      scopeBySchool(schoolId, { _id: id, isDeleted: { $ne: true } }),
      { $set: { isDeleted: true, deletedAt: new Date() } },
      { new: true }
    );
    if (!reportCard) return res.status(404).json({ error: 'CBSE report card not found' });
    res.json({ message: 'CBSE report card deleted' });
  } catch (error) {
    console.error('Error deleting CBSE report card:', error);
    res.status(500).json({ error: 'Failed to delete CBSE report card' });
  }
});

export default router;
