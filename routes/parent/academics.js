import express from 'express';
import PDFDocument from 'pdfkit';
import { Student } from '../../database.js';
import { validateParentChildAccess } from '../../middleware/parentAuth.js';
import {
  examOutputSchema,
  resultOutputSchema,
  remarkOutputSchema,
  attendanceRecordOutputSchema,
  applyOutputSchema,
} from '../../validators/parentOutputSchemas.js';
import { withEffectiveStatus } from '../../utils/examStatus.js';

const router = express.Router();

// Normalize :id → req.params.studentId for validateParentChildAccess
router.param('id', (req, res, next, id) => {
  req.params.studentId = id;
  next();
});

// GET /api/parent/students/:id/attendance
router.get('/students/:id/attendance', validateParentChildAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const { startDate, endDate, limit = 30 } = req.query;

    const student = await Student.findOne({ _id: id, schoolId: req.schoolId }).select(
      'name classId'
    );

    if (!student) {
      return res.status(404).json({
        success: false,
        error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found' },
      });
    }

    const { Attendance } = await import('../../database.js');

    const query = { studentId: id, schoolId: req.schoolId };

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = startDate;
      if (endDate) query.date.$lte = endDate;
    }

    const attendance = await Attendance.find(query)
      .sort({ date: -1 })
      .limit(parseInt(limit))
      .lean();

    const stats = {
      total: attendance.length,
      present: attendance.filter((a) => a.status === 'present').length,
      absent: attendance.filter((a) => a.status === 'absent').length,
      late: attendance.filter((a) => a.status === 'late').length,
    };

    stats.percentage =
      stats.total > 0 ? Math.round(((stats.present + stats.late) / stats.total) * 100) : 0;

    res.json({
      success: true,
      data: {
        studentId: id,
        studentName: student.name,
        attendance: applyOutputSchema(attendanceRecordOutputSchema, attendance),
        records: applyOutputSchema(attendanceRecordOutputSchema, attendance),
        stats,
      },
    });
  } catch (error) {
    console.error('Get student attendance error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to fetch attendance data' },
    });
  }
});

// GET /api/parent/students/:id/exams
router.get('/students/:id/exams', validateParentChildAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const { academicYear, skip = 0, limit = 20 } = req.query;
    const skipNum = parseInt(skip);
    const limitNum = parseInt(limit);

    const student = await Student.findOne({ _id: id, schoolId: req.schoolId }).select(
      'name classId'
    );

    if (!student) {
      return res.status(404).json({
        success: false,
        error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found' },
      });
    }

    const { Exam } = await import('../../database.js');

    // Issue #21: Only show exams that are ongoing, completed, or published (not scheduled)
    // Issue #25: Exclude soft-deleted exams
    const query = {
      classId: student.classId,
      schoolId: req.schoolId,
      status: { $in: ['ongoing', 'completed', 'results_published'] },
      isDeleted: { $ne: true },
    };
    if (academicYear) query.academicYear = academicYear;

    const total = await Exam.countDocuments(query);
    const exams = await Exam.find(query)
      .sort({ startDate: 1 })
      .skip(skipNum)
      .limit(limitNum)
      .lean();

    // Surface a date-derived `effectiveStatus` so parents see the same
    // scheduled/ongoing/completed/results_published vocabulary as the
    // dashboard. The stored `status` field is left untouched (it never holds
    // 'ongoing'/'completed' on disk — see utils/examStatus.js).
    const examsWithStatus = exams.map((exam) => withEffectiveStatus(exam));

    const examsHasMore = skipNum + exams.length < total;
    res.json({
      success: true,
      data: {
        studentId: id,
        studentName: student.name,
        exams: applyOutputSchema(examOutputSchema, examsWithStatus),
        hasMore: examsHasMore,
        nextCursor: examsHasMore ? String(skipNum + limitNum) : undefined,
        total,
      },
    });
  } catch (error) {
    console.error('Get student exams error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to fetch exams' },
    });
  }
});

// GET /api/parent/students/:id/results
router.get('/students/:id/results', validateParentChildAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const { academicYear, skip = 0, limit = 20 } = req.query;
    const skipNum = parseInt(skip);
    const limitNum = parseInt(limit);

    const student = await Student.findOne({ _id: id, schoolId: req.schoolId }).select(
      'name classId'
    );

    if (!student) {
      return res.status(404).json({
        success: false,
        error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found' },
      });
    }

    const { Result, Exam } = await import('../../database.js');

    // Filter by exam's published status (source of truth) rather than Result.isPublished
    const examFilter = {
      status: 'results_published',
      isDeleted: { $ne: true },
      schoolId: req.schoolId,
    };
    if (academicYear) examFilter.academicYear = academicYear;
    const publishedExamIds = await Exam.find(examFilter).distinct('_id');

    const query = {
      studentId: id,
      schoolId: req.schoolId,
      examId: { $in: publishedExamIds },
      isDeleted: { $ne: true },
    };

    const total = await Result.countDocuments(query);
    const results = await Result.find(query)
      .populate({
        path: 'examId',
        match: { isDeleted: { $ne: true } },
        select: 'name type examType startDate endDate status',
      })
      .sort({ createdAt: -1 })
      .skip(skipNum)
      .limit(limitNum)
      .lean();

    // Filter out results where examId was soft-deleted after publish
    const filteredResults = results.filter((r) => r.examId != null);

    const resultsHasMore = skipNum + results.length < total;
    res.json({
      success: true,
      data: {
        studentId: id,
        studentName: student.name,
        results: applyOutputSchema(resultOutputSchema, filteredResults),
        hasMore: resultsHasMore,
        nextCursor: resultsHasMore ? String(skipNum + limitNum) : undefined,
        total,
      },
    });
  } catch (error) {
    console.error('Get student results error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to fetch results' },
    });
  }
});

// GET /api/parent/students/:id/results/:examId/report-card
router.get(
  '/students/:id/results/:examId/report-card',
  validateParentChildAccess,
  async (req, res) => {
    try {
      const { id, examId } = req.params;
      const { Result, Exam, School } = await import('../../database.js');

      const student = await Student.findOne({ _id: id, schoolId: req.schoolId })
        .populate({ path: 'classId', select: 'name section' })
        .select('name rollNo admissionId classId')
        .lean();

      if (!student) {
        return res.status(404).json({
          success: false,
          error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found' },
        });
      }

      const exam = await Exam.findOne({
        _id: examId,
        schoolId: req.schoolId,
        status: 'results_published',
        isDeleted: { $ne: true },
      }).lean();

      if (!exam) {
        return res.status(404).json({
          success: false,
          error: { code: 'EXAM_NOT_FOUND', message: 'Published exam not found' },
        });
      }

      const result = await Result.findOne({
        studentId: id,
        examId,
        schoolId: req.schoolId,
        isDeleted: { $ne: true },
      }).lean();

      if (!result) {
        return res.status(404).json({
          success: false,
          error: { code: 'RESULT_NOT_FOUND', message: 'Result not found' },
        });
      }

      const school = await School.findById(req.schoolId)
        .select('name contactEmail contactPhone')
        .lean();

      const safeName = (str) => (str || '').replace(/[^a-zA-Z0-9-_]/g, '-');
      const filename = `report-card-${safeName(student.name)}-${safeName(exam.name)}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      doc.pipe(res);

      // School header
      doc
        .fontSize(20)
        .font('Helvetica-Bold')
        .text(school?.name || 'School', { align: 'center' });
      if (school?.contactPhone) {
        doc
          .fontSize(10)
          .font('Helvetica')
          .text(`Phone: ${school.contactPhone}`, { align: 'center' });
      }
      if (school?.contactEmail) {
        doc
          .fontSize(10)
          .font('Helvetica')
          .text(`Email: ${school.contactEmail}`, { align: 'center' });
      }

      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.5);

      doc.fontSize(16).font('Helvetica-Bold').text('REPORT CARD', { align: 'center' });
      doc.moveDown(0.5);

      // Student info
      doc.fontSize(11).font('Helvetica');
      doc.text(`Exam: ${exam.name}`);
      doc.text(`Student Name: ${student.name}`);
      if (student.rollNo) doc.text(`Roll No: ${student.rollNo}`);
      if (student.admissionId) doc.text(`Admission No: ${student.admissionId}`);
      if (student.classId) {
        const className =
          student.classId.name + (student.classId.section ? ` (${student.classId.section})` : '');
        doc.text(`Class: ${className}`);
      }
      if (exam.academicYear) doc.text(`Academic Year: ${exam.academicYear}`);
      if (exam.startDate)
        doc.text(`Exam Date: ${new Date(exam.startDate).toLocaleDateString('en-IN')}`);

      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.5);

      // Summary
      doc.fontSize(13).font('Helvetica-Bold').text('Result Summary');
      doc.moveDown(0.3);
      doc.fontSize(11).font('Helvetica');

      const obtained = result.marks?.length > 0 ? result.totalMarksObtained : result.marksObtained;
      const total = result.marks?.length > 0 ? result.totalMaxMarks : result.maxMarks;

      doc.text(`Total Marks: ${obtained} / ${total}`);
      doc.text(`Percentage: ${result.percentage || 0}%`);
      doc.text(`Grade: ${result.grade || 'N/A'}`);
      if (result.rank) doc.text(`Class Rank: #${result.rank}`);
      if (result.status) {
        const statusLabel = result.status.charAt(0).toUpperCase() + result.status.slice(1);
        doc.text(`Status: ${statusLabel}`);
      }

      // Subject-wise marks table
      if (result.marks?.length > 0) {
        doc.moveDown(0.5);
        doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(0.5);

        doc.fontSize(13).font('Helvetica-Bold').text('Subject-wise Performance');
        doc.moveDown(0.3);

        const col1 = 50,
          col2 = 250,
          col3 = 330,
          col4 = 400,
          col5 = 460;
        doc.fontSize(10).font('Helvetica-Bold');
        const headerY = doc.y;
        doc.text('Subject', col1, headerY);
        doc.text('Obtained', col2, headerY);
        doc.text('Max', col3, headerY);
        doc.text('Percentage', col4, headerY);
        doc.text('Grade', col5, headerY);

        doc.moveDown(0.3);
        doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(0.2);

        doc.font('Helvetica').fontSize(10);
        for (const subject of result.marks) {
          const rowY = doc.y;
          const pct =
            subject.maxMarks > 0 ? Math.round((subject.marksObtained / subject.maxMarks) * 100) : 0;
          doc.text(subject.subjectName || 'Unknown', col1, rowY, { width: 190 });
          doc.text(String(subject.marksObtained ?? '-'), col2, rowY);
          doc.text(String(subject.maxMarks ?? '-'), col3, rowY);
          doc.text(`${pct}%`, col4, rowY);
          doc.text(subject.grade || 'N/A', col5, rowY);
          doc.moveDown(0.4);
        }
      }

      // Footer
      doc.moveDown(1);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.3);
      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('gray')
        .text(`Generated on ${new Date().toLocaleDateString('en-IN')}`, { align: 'right' });

      doc.end();
    } catch (error) {
      console.error('Report card generation error:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: { code: 'SERVER_ERROR', message: 'Failed to generate report card' },
        });
      }
    }
  }
);

// GET /api/parent/students/:id/remarks
router.get('/students/:id/remarks', validateParentChildAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const { skip = 0, limit = 20 } = req.query;
    const skipNum = parseInt(skip);
    const limitNum = parseInt(limit);

    const student = await Student.findOne({ _id: id, schoolId: req.schoolId }).select('name');
    if (!student) {
      return res.status(404).json({
        success: false,
        error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found' },
      });
    }

    const Remark = (await import('../../models/Remark.js')).default;
    const remarksQuery = {
      studentId: id,
      sentToParent: true,
      schoolId: req.schoolId,
      isDeleted: { $ne: true },
    };

    const total = await Remark.countDocuments(remarksQuery);
    const remarks = await Remark.find(remarksQuery)
      .sort({ date: -1 })
      .skip(skipNum)
      .limit(limitNum)
      .lean();

    const remarksHasMore = skipNum + remarks.length < total;
    res.json({
      success: true,
      data: {
        studentId: id,
        studentName: student.name,
        remarks: applyOutputSchema(remarkOutputSchema, remarks),
        hasMore: remarksHasMore,
        nextCursor: remarksHasMore ? String(skipNum + limitNum) : undefined,
        total,
      },
    });
  } catch (error) {
    console.error('Get student remarks error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to fetch remarks' },
    });
  }
});

export default router;
