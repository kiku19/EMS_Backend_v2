import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { validateZod } from '../validators/zodHelpers.js';
import { featureGate } from '../middleware/featureGate.js';
import {
  classResultsQuerySchema,
  subjectAnalysisQuerySchema,
  rankListQuerySchema,
  gradeDistributionQuerySchema,
  feeCollectionQuerySchema,
  outstandingDuesQuerySchema,
  feeHeadCollectionQuerySchema,
  paymentModeSummaryQuerySchema,
  concessionQuerySchema,
  studentAttendanceQuerySchema,
  classwiseAttendanceQuerySchema,
  monthlyAttendanceRegisterQuerySchema,
  absenteesQuerySchema,
  attendanceTrendQuerySchema,
  lateArrivalsQuerySchema,
  staffAttendanceSummaryQuerySchema,
  payrollSummaryQuerySchema,
  admissionsQuerySchema,
  studentStrengthQuerySchema,
  tcIssuedQuerySchema,
  visitorLogQuerySchema,
  dashboardMetricsQuerySchema,
} from '../validators/reportSchema.js';
import {
  getClassResultsSummary,
  getSubjectAnalysis,
  getRankList,
  getGradeDistribution,
  getFeeCollectionSummary,
  getOutstandingDues,
  getFeeHeadWiseCollection,
  getPaymentModeSummary,
  getConcessionReport,
  getStudentAttendanceReport,
  getClasswiseAttendanceSummary,
  getMonthlyAttendanceRegister,
  getAbsenteeReport,
  getAttendanceTrend,
  getLateArrivalsReport,
  getStaffAttendanceSummary,
  getPayrollSummary,
  getStaffCountByDepartment,
  getAdmissionsReport,
  getStudentStrength,
  getTCIssuedReport,
  getVisitorLogSummary,
  getDashboardMetrics,
} from '../services/reportService.js';

const router = express.Router();

// All report routes require authentication
router.use(authenticate);

// All non-dashboard report routes require the advancedReports feature (Growth+ plan)
router.use(/^\/(?!dashboard)/, featureGate('advancedReports'));

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

router.get(
  '/dashboard/metrics',
  checkPermission('dashboard', 'view'),
  validateZod(dashboardMetricsQuerySchema, 'query'),
  async (req, res) => {
    try {
      const data = await getDashboardMetrics(req.user.schoolId, req.query);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── ACADEMIC REPORTS ────────────────────────────────────────────────────────

router.get(
  '/academic/class-results',
  checkPermission('academics', 'view'),
  validateZod(classResultsQuerySchema, 'query'),
  async (req, res) => {
    try {
      const data = await getClassResultsSummary(req.user.schoolId, req.query);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.get(
  '/academic/subject-analysis',
  checkPermission('academics', 'view'),
  validateZod(subjectAnalysisQuerySchema, 'query'),
  async (req, res) => {
    try {
      const data = await getSubjectAnalysis(req.user.schoolId, req.query);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.get(
  '/academic/rank-list',
  checkPermission('academics', 'view'),
  validateZod(rankListQuerySchema, 'query'),
  async (req, res) => {
    try {
      const data = await getRankList(req.user.schoolId, req.query);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.get(
  '/academic/grade-distribution',
  checkPermission('academics', 'view'),
  validateZod(gradeDistributionQuerySchema, 'query'),
  async (req, res) => {
    try {
      const data = await getGradeDistribution(req.user.schoolId, req.query);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── FINANCIAL REPORTS ───────────────────────────────────────────────────────

router.get(
  '/financial/fee-collection',
  checkPermission('fees', 'view'),
  validateZod(feeCollectionQuerySchema, 'query'),
  async (req, res) => {
    try {
      const data = await getFeeCollectionSummary(req.user.schoolId, req.query);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.get(
  '/financial/outstanding-dues',
  checkPermission('fees', 'view'),
  validateZod(outstandingDuesQuerySchema, 'query'),
  async (req, res) => {
    try {
      const data = await getOutstandingDues(req.user.schoolId, req.query);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.get(
  '/financial/fee-head-collection',
  checkPermission('fees', 'view'),
  validateZod(feeHeadCollectionQuerySchema, 'query'),
  async (req, res) => {
    try {
      const data = await getFeeHeadWiseCollection(req.user.schoolId, req.query);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.get(
  '/financial/payment-mode-summary',
  checkPermission('fees', 'view'),
  validateZod(paymentModeSummaryQuerySchema, 'query'),
  async (req, res) => {
    try {
      const data = await getPaymentModeSummary(req.user.schoolId, req.query);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.get(
  '/financial/concession',
  checkPermission('fees', 'view'),
  validateZod(concessionQuerySchema, 'query'),
  async (req, res) => {
    try {
      const data = await getConcessionReport(req.user.schoolId, req.query);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── ATTENDANCE REPORTS ──────────────────────────────────────────────────────

router.get(
  '/attendance/student',
  checkPermission('students', 'view'),
  validateZod(studentAttendanceQuerySchema, 'query'),
  async (req, res) => {
    try {
      const data = await getStudentAttendanceReport(req.user.schoolId, req.query);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.get(
  '/attendance/class-summary',
  checkPermission('students', 'view'),
  validateZod(classwiseAttendanceQuerySchema, 'query'),
  async (req, res) => {
    try {
      const data = await getClasswiseAttendanceSummary(req.user.schoolId, req.query);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.get(
  '/attendance/monthly-register',
  checkPermission('students', 'view'),
  validateZod(monthlyAttendanceRegisterQuerySchema, 'query'),
  async (req, res) => {
    try {
      const data = await getMonthlyAttendanceRegister(req.user.schoolId, req.query);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.get(
  '/attendance/absentees',
  checkPermission('students', 'view'),
  validateZod(absenteesQuerySchema, 'query'),
  async (req, res) => {
    try {
      const data = await getAbsenteeReport(req.user.schoolId, req.query);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.get(
  '/attendance/trend',
  checkPermission('students', 'view'),
  validateZod(attendanceTrendQuerySchema, 'query'),
  async (req, res) => {
    try {
      const data = await getAttendanceTrend(req.user.schoolId, req.query);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.get(
  '/attendance/late-arrivals',
  checkPermission('students', 'view'),
  validateZod(lateArrivalsQuerySchema, 'query'),
  async (req, res) => {
    try {
      const data = await getLateArrivalsReport(req.user.schoolId, req.query);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── STAFF REPORTS ───────────────────────────────────────────────────────────

router.get(
  '/staff/attendance-summary',
  checkPermission('staff', 'view'),
  validateZod(staffAttendanceSummaryQuerySchema, 'query'),
  async (req, res) => {
    try {
      const data = await getStaffAttendanceSummary(req.user.schoolId, req.query);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.get(
  '/staff/payroll-summary',
  checkPermission('staff', 'view'),
  validateZod(payrollSummaryQuerySchema, 'query'),
  async (req, res) => {
    try {
      const data = await getPayrollSummary(req.user.schoolId, req.query);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.get('/staff/count-by-department', checkPermission('staff', 'view'), async (req, res) => {
  try {
    const data = await getStaffCountByDepartment(req.user.schoolId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── OPERATIONAL REPORTS ─────────────────────────────────────────────────────

router.get(
  '/operational/admissions',
  checkPermission('students', 'view'),
  validateZod(admissionsQuerySchema, 'query'),
  async (req, res) => {
    try {
      const data = await getAdmissionsReport(req.user.schoolId, req.query);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.get(
  '/operational/student-strength',
  checkPermission('students', 'view'),
  validateZod(studentStrengthQuerySchema, 'query'),
  async (req, res) => {
    try {
      const data = await getStudentStrength(req.user.schoolId, req.query);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.get(
  '/operational/tc-issued',
  checkPermission('students', 'view'),
  validateZod(tcIssuedQuerySchema, 'query'),
  async (req, res) => {
    try {
      const data = await getTCIssuedReport(req.user.schoolId, req.query);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.get(
  '/operational/visitor-log',
  checkPermission('front-desk', 'view'),
  validateZod(visitorLogQuerySchema, 'query'),
  async (req, res) => {
    try {
      const data = await getVisitorLogSummary(req.user.schoolId, req.query);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
