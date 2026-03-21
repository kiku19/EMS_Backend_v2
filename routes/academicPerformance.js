import express from 'express';
import { Student, Result, Attendance, Remark } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { extractSchoolId } from '../utils/schoolContext.js';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

const router = express.Router();

function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) throw new Error('schoolId is required for scoped queries');
  return { ...query, schoolId: normalizedSchoolId };
}

// GET /academic-performance/dashboard
// Returns school-wide aggregated performance stats for the dashboard
router.get('/dashboard', authenticate, checkPermission('academics', 'view'), async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const academicYear = req.query.academicYear || CURRENT_ACADEMIC_YEAR;

    const results = await Result.find(
      scopeBySchool(schoolId, {
        isPublished: true,
        isDeleted: { $ne: true },
        academicYear,
      })
    )
      .populate('studentId', 'name classId rollNo')
      .populate('examId', 'name subjectName')
      .populate('classId', 'name section')
      .lean();

    // Grade distribution
    const gradeCounts = {};
    let totalPercentage = 0;
    let passedCount = 0;

    for (const r of results) {
      const g = r.grade || 'Ungraded';
      gradeCounts[g] = (gradeCounts[g] || 0) + 1;
      if (r.percentage != null) totalPercentage += r.percentage;
      if (r.status === 'passed') passedCount++;
    }

    const averageScore =
      results.length > 0 ? Math.round((totalPercentage / results.length) * 10) / 10 : 0;
    const passingRate = results.length > 0 ? Math.round((passedCount / results.length) * 100) : 0;

    // Class performance averages
    const classMap = {};
    for (const r of results) {
      const cid = r.classId?._id?.toString() || r.classId?.toString();
      if (!cid) continue;
      if (!classMap[cid]) {
        const cls = typeof r.classId === 'object' && r.classId?.name ? r.classId : null;
        classMap[cid] = {
          classId: cid,
          className: cls ? `${cls.name}${cls.section ? ' ' + cls.section : ''}` : cid,
          total: 0,
          count: 0,
        };
      }
      classMap[cid].total += r.percentage || 0;
      classMap[cid].count++;
    }
    const classPerformance = Object.values(classMap).map((c) => ({
      classId: c.classId,
      className: c.className,
      averagePercentage: Math.round((c.total / c.count) * 10) / 10,
    }));

    // Subject averages
    const subjectMap = {};
    for (const r of results) {
      const subj = r.examId?.subjectName;
      if (!subj) continue;
      if (!subjectMap[subj]) subjectMap[subj] = { total: 0, count: 0 };
      subjectMap[subj].total += r.percentage || 0;
      subjectMap[subj].count++;
    }
    const subjectAverages = Object.entries(subjectMap).map(([name, data]) => ({
      subject: name,
      average: Math.round((data.total / data.count) * 10) / 10,
    }));

    // Top performers (aggregate per student)
    const studentMap = {};
    for (const r of results) {
      const sid = r.studentId?._id?.toString() || r.studentId?.toString();
      if (!sid) continue;
      if (!studentMap[sid]) {
        const cls = typeof r.classId === 'object' && r.classId?.name ? r.classId : null;
        studentMap[sid] = {
          studentId: sid,
          name: r.studentId?.name || 'Unknown',
          class: cls ? `${cls.name}${cls.section ? ' ' + cls.section : ''}` : '',
          total: 0,
          count: 0,
        };
      }
      studentMap[sid].total += r.percentage || 0;
      studentMap[sid].count++;
    }
    const topPerformers = Object.values(studentMap)
      .map((s) => ({ ...s, percentage: Math.round((s.total / s.count) * 10) / 10 }))
      .sort((a, b) => b.percentage - a.percentage)
      .slice(0, 10);

    // Format grade distribution
    const gradeOrder = ['A+', 'A', 'B+', 'B', 'C', 'D', 'F'];
    const gradeDistribution = gradeOrder
      .filter((g) => gradeCounts[g])
      .map((g) => ({ name: g, value: gradeCounts[g] }));
    for (const [g, count] of Object.entries(gradeCounts)) {
      if (!gradeOrder.includes(g) && g !== 'Ungraded') {
        gradeDistribution.push({ name: g, value: count });
      }
    }

    res.json({
      academicYear,
      averageScore,
      passingRate,
      totalResults: results.length,
      classPerformance,
      subjectAverages,
      topPerformers,
      gradeDistribution,
    });
  } catch (error) {
    console.error('Error fetching performance dashboard:', error);
    res.status(500).json({ error: 'Failed to fetch performance dashboard' });
  }
});

// GET /academic-performance/class/:classId
// Returns class-level performance detail with per-student breakdown
router.get(
  '/class/:classId',
  authenticate,
  checkPermission('academics', 'view'),
  async (req, res) => {
    try {
      const { classId } = req.params;
      const schoolId = req.user?.schoolId;
      const academicYear = req.query.academicYear || CURRENT_ACADEMIC_YEAR;

      const results = await Result.find(
        scopeBySchool(schoolId, {
          classId,
          isPublished: true,
          isDeleted: { $ne: true },
          academicYear,
        })
      )
        .populate('studentId', 'name rollNo')
        .populate('examId', 'name subjectName')
        .lean();

      // Per-student aggregation
      const studentMap = {};
      for (const r of results) {
        const sid = r.studentId?._id?.toString() || r.studentId?.toString();
        if (!sid) continue;
        if (!studentMap[sid]) {
          studentMap[sid] = {
            studentId: sid,
            name: r.studentId?.name || 'Unknown',
            rollNo: r.studentId?.rollNo || '-',
            totalPct: 0,
            count: 0,
            grades: [],
            passed: 0,
            total: 0,
          };
        }
        studentMap[sid].totalPct += r.percentage || 0;
        studentMap[sid].count++;
        if (r.grade) studentMap[sid].grades.push(r.grade);
        studentMap[sid].total++;
        if (r.status === 'passed') studentMap[sid].passed++;
      }

      function mostFrequent(arr) {
        const counts = {};
        let maxCount = 0,
          maxItem = arr[0];
        for (const item of arr) {
          counts[item] = (counts[item] || 0) + 1;
          if (counts[item] > maxCount) {
            maxCount = counts[item];
            maxItem = item;
          }
        }
        return maxItem;
      }

      const students = Object.values(studentMap)
        .map((s) => ({
          studentId: s.studentId,
          name: s.name,
          rollNo: s.rollNo,
          overallPercentage: Math.round((s.totalPct / s.count) * 10) / 10,
          overallGrade: s.grades.length > 0 ? mostFrequent(s.grades) : null,
          classRank: 0,
          trend: null,
        }))
        .sort((a, b) => b.overallPercentage - a.overallPercentage);

      students.forEach((s, idx) => {
        s.classRank = idx + 1;
      });

      // Subject breakdown
      const subjectMap = {};
      for (const r of results) {
        const subj = r.examId?.subjectName;
        if (!subj) continue;
        if (!subjectMap[subj]) {
          subjectMap[subj] = { subjectName: subj, percentages: [], passed: 0, total: 0 };
        }
        if (r.percentage != null) subjectMap[subj].percentages.push(r.percentage);
        subjectMap[subj].total++;
        if (r.status === 'passed') subjectMap[subj].passed++;
      }
      const subjectBreakdown = Object.values(subjectMap).map((s) => ({
        subjectName: s.subjectName,
        average:
          s.percentages.length > 0
            ? Math.round((s.percentages.reduce((a, b) => a + b, 0) / s.percentages.length) * 10) /
              10
            : 0,
        highest: s.percentages.length > 0 ? Math.round(Math.max(...s.percentages) * 10) / 10 : 0,
        lowest: s.percentages.length > 0 ? Math.round(Math.min(...s.percentages) * 10) / 10 : 0,
        passRate: s.total > 0 ? Math.round((s.passed / s.total) * 100) : 0,
      }));

      // Overall stats
      const allPcts = results.map((r) => r.percentage).filter((p) => p != null);
      const totalPassed = results.filter((r) => r.status === 'passed').length;

      const hasResults = results.length > 0;

      res.json({
        classId,
        academicYear,
        students,
        subjectBreakdown,
        stats: {
          totalStudents: Object.keys(studentMap).length,
          averageScore:
            allPcts.length > 0
              ? Math.round((allPcts.reduce((a, b) => a + b, 0) / allPcts.length) * 10) / 10
              : null,
          topScore: allPcts.length > 0 ? Math.round(Math.max(...allPcts) * 10) / 10 : null,
          passingRate: hasResults ? Math.round((totalPassed / results.length) * 100) : null,
        },
      });
    } catch (error) {
      console.error('Error fetching class performance:', error);
      res.status(500).json({ error: 'Failed to fetch class performance' });
    }
  }
);

// GET /academic-performance/student/:studentId
// Returns computed analytics summary for a student
router.get(
  '/student/:studentId',
  authenticate,
  checkPermission('students', 'view'),
  async (req, res) => {
    try {
      const { studentId } = req.params;
      const schoolId = req.user?.schoolId;
      const academicYear = req.query.academicYear || CURRENT_ACADEMIC_YEAR;

      const student = await Student.findOne(
        scopeBySchool(schoolId, { _id: studentId, isDeleted: { $ne: true } })
      ).lean();
      if (!student) return res.status(404).json({ error: 'Student not found' });

      const results = await Result.find(
        scopeBySchool(schoolId, {
          studentId,
          isPublished: true,
          isDeleted: { $ne: true },
          academicYear,
        })
      )
        .populate('examId', 'name type startDate')
        .sort({ createdAt: -1 })
        .lean();

      const gradeDistribution = {};
      let totalPercentage = 0;

      for (const r of results) {
        if (r.grade) gradeDistribution[r.grade] = (gradeDistribution[r.grade] || 0) + 1;
        if (r.percentage) totalPercentage += r.percentage;
      }

      const averagePercentage =
        results.length > 0 ? Math.round((totalPercentage / results.length) * 10) / 10 : null;

      const latest = results[0];
      const latestGrade = latest?.grade || null;
      const latestRank = latest?.rank || null;
      const latestTotalMarks =
        latest?.totalMarksObtained != null && latest?.totalMaxMarks
          ? `${latest.totalMarksObtained}/${latest.totalMaxMarks}`
          : latest?.marksObtained != null
            ? `${latest.marksObtained}/${latest.maxMarks}`
            : null;

      // Attendance — last 6 months
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      const startDate = sixMonthsAgo.toISOString().split('T')[0];
      const endDate = new Date().toISOString().split('T')[0];

      const attendanceRecords = await Attendance.find(
        scopeBySchool(schoolId, { studentId, date: { $gte: startDate, $lte: endDate } })
      ).lean();

      let attendancePercentage = null;
      if (attendanceRecords.length > 0) {
        const present = attendanceRecords.filter(
          (r) => r.status === 'present' || r.status === 'late'
        ).length;
        attendancePercentage = Math.round((present / attendanceRecords.length) * 100);
      }

      res.json({
        studentId,
        academicYear,
        totalExams: results.length,
        averagePercentage,
        latestGrade,
        latestRank,
        latestTotalMarks,
        gradeDistribution,
        attendancePercentage,
      });
    } catch (error) {
      console.error('Error fetching student academic performance:', error);
      res.status(500).json({ error: 'Failed to fetch academic performance' });
    }
  }
);

// GET /academic-performance/trends/:studentId
// Returns per-exam performance trend data for charting
router.get(
  '/trends/:studentId',
  authenticate,
  checkPermission('students', 'view'),
  async (req, res) => {
    try {
      const { studentId } = req.params;
      const schoolId = req.user?.schoolId;
      const academicYear = req.query.academicYear || CURRENT_ACADEMIC_YEAR;

      const student = await Student.findOne(
        scopeBySchool(schoolId, { _id: studentId, isDeleted: { $ne: true } })
      ).lean();
      if (!student) return res.status(404).json({ error: 'Student not found' });

      const results = await Result.find(
        scopeBySchool(schoolId, {
          studentId,
          isPublished: true,
          isDeleted: { $ne: true },
          academicYear,
        })
      )
        .populate('examId', 'name type startDate')
        .sort({ createdAt: 1 }) // ascending for trend chart
        .lean();

      const trends = results.map((r) => ({
        examId: r.examId?._id || r.examId,
        examName: r.examId?.name || 'Exam',
        examType: r.examId?.type || null,
        date: r.examId?.startDate || r.createdAt,
        percentage: r.percentage ?? null,
        grade: r.grade || null,
        rank: r.rank || null,
        marksObtained: r.totalMarksObtained ?? r.marksObtained ?? null,
        maxMarks: r.totalMaxMarks ?? r.maxMarks ?? null,
      }));

      res.json({ studentId, academicYear, trends });
    } catch (error) {
      console.error('Error fetching student performance trends:', error);
      res.status(500).json({ error: 'Failed to fetch performance trends' });
    }
  }
);

// GET /academic-performance/report-card/:studentId
// Returns a structured report card: all results, attendance, and academic remarks
router.get(
  '/report-card/:studentId',
  authenticate,
  checkPermission('students', 'view'),
  async (req, res) => {
    try {
      const { studentId } = req.params;
      const schoolId = req.user?.schoolId;
      const academicYear = req.query.academicYear || CURRENT_ACADEMIC_YEAR;

      const student = await Student.findOne(
        scopeBySchool(schoolId, { _id: studentId, isDeleted: { $ne: true } })
      )
        .populate('classId', 'name section')
        .lean();
      if (!student) return res.status(404).json({ error: 'Student not found' });

      // All published results for the student
      const results = await Result.find(
        scopeBySchool(schoolId, {
          studentId,
          isPublished: true,
          isDeleted: { $ne: true },
          academicYear,
        })
      )
        .populate('examId', 'name type startDate')
        .sort({ createdAt: -1 })
        .lean();

      // Compute overall stats
      let totalPercentage = 0;
      let resultsWithPercentage = 0;
      for (const r of results) {
        if (r.percentage != null) {
          totalPercentage += r.percentage;
          resultsWithPercentage++;
        }
      }
      const overallPercentage =
        resultsWithPercentage > 0
          ? Math.round((totalPercentage / resultsWithPercentage) * 10) / 10
          : null;

      const latest = results[0];
      const overallGrade = latest?.grade || null;
      const overallRank = latest?.rank || null;

      // Attendance for the academic year (approximate by 12 months window)
      const yearStart = `${academicYear.split('-')[0]}-04-01`;
      const yearEnd = new Date().toISOString().split('T')[0];

      const attendanceRecords = await Attendance.find(
        scopeBySchool(schoolId, { studentId, date: { $gte: yearStart, $lte: yearEnd } })
      ).lean();

      let attendancePercentage = null;
      let presentDays = 0;
      const totalDays = attendanceRecords.length;
      if (totalDays > 0) {
        presentDays = attendanceRecords.filter(
          (r) => r.status === 'present' || r.status === 'late'
        ).length;
        attendancePercentage = Math.round((presentDays / totalDays) * 100);
      }

      // Latest academic remarks (up to 5)
      const remarks = await Remark.find(
        scopeBySchool(schoolId, {
          studentId,
          category: 'academic',
          isDeleted: { $ne: true },
        })
      )
        .populate('authorId', 'name')
        .sort({ date: -1 })
        .limit(5)
        .lean();

      // Shape results for frontend
      const examResults = results.map((r) => ({
        examId: r.examId?._id || r.examId,
        examName: r.examId?.name || 'Exam',
        examType: r.examId?.type || null,
        examDate: r.examId?.startDate || r.createdAt,
        // Multi-subject breakdown
        subjects: (r.marks || []).map((m) => ({
          subjectName: m.subjectName,
          marksObtained: m.marksObtained,
          maxMarks: m.maxMarks,
          grade: m.grade || null,
          remarks: m.remarks || null,
        })),
        // Single-subject fallback
        marksObtained: r.totalMarksObtained ?? r.marksObtained ?? null,
        maxMarks: r.totalMaxMarks ?? r.maxMarks ?? null,
        percentage: r.percentage ?? null,
        grade: r.grade || null,
        rank: r.rank || null,
        status: r.status || null,
        teacherRemarks: r.remarks || null,
      }));

      res.json({
        studentId,
        academicYear,
        student: {
          name: student.name,
          admissionNo: student.admissionNumber || student.admissionNo,
          rollNo: student.rollNo,
          className: student.classId?.name
            ? `${student.classId.name}${student.classId.section ? ' ' + student.classId.section : ''}`
            : student.class || null,
          phone: student.phone,
          email: student.email,
        },
        summary: {
          totalExams: results.length,
          overallPercentage,
          overallGrade,
          overallRank,
          attendancePercentage,
          presentDays,
          totalDays,
        },
        examResults,
        remarks: remarks.map((r) => ({
          title: r.title,
          description: r.description,
          authorName: r.authorId?.name || null,
          date: r.date || r.createdAt,
        })),
      });
    } catch (error) {
      console.error('Error fetching report card:', error);
      res.status(500).json({ error: 'Failed to fetch report card' });
    }
  }
);

export default router;
