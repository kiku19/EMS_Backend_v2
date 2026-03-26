import express from 'express';
import mongoose from 'mongoose';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { validateZod } from '../validators/zodHelpers.js';
import {
  studentsExportSchema,
  staffExportSchema,
  feeCollectionExportSchema,
  feeDefaultersExportSchema,
  attendanceExportSchema,
  examResultsExportSchema,
  payrollExportSchema,
  staffAttendanceExportSchema,
  classResultsExportSchema,
  studentStrengthExportSchema,
  admissionsExportSchema,
  concessionsExportSchema,
  feeHeadsExportSchema,
  udiseExportSchema,
  cbseExportSchema,
  icseExportSchema,
  stateBoardExportSchema,
  annualReportExportSchema,
  complianceChecklistExportSchema,
} from '../validators/exportSchema.js';
import { sendExport } from '../services/exportService.js';
import {
  getFeeCollectionSummary,
  getOutstandingDues,
  getStudentAttendanceReport,
  getRankList,
  getStaffAttendanceSummary,
  getClassResultsSummary,
  getStudentStrength,
  getAdmissionsReport,
  getConcessionReport,
  getFeeHeadWiseCollection,
} from '../services/reportService.js';
import { Student, Staff } from '../database.js';
import SchoolSettings from '../models/SchoolSettings.js';
import PayrollRecord from '../models/PayrollRecord.js';

const router = express.Router();

// Timezone-safe date formatter: converts "YYYY-MM-DD" or full ISO string to "DD/MM/YYYY"
// Using string manipulation avoids new Date() UTC-shift that can display wrong day
const formatDateSafe = (dateStr) => {
  if (!dateStr) return '';
  const d = String(dateStr).split('T')[0]; // strip time component if present
  const parts = d.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
};
router.use(authenticate);

function toOid(id) {
  return new mongoose.Types.ObjectId(String(id));
}

function schoolScope(schoolId, extra = {}) {
  return { ...extra, schoolId: toOid(schoolId) };
}

function today() {
  return new Date().toISOString().split('T')[0];
}

// ─── STUDENTS ────────────────────────────────────────────────────────────────

const STUDENT_COLS = [
  { key: 'admissionId', label: 'Admission ID', width: 15 },
  { key: 'name', label: 'Name', width: 25 },
  { key: 'class', label: 'Class', width: 14 },
  { key: 'rollNo', label: 'Roll No', width: 10 },
  { key: 'gender', label: 'Gender', width: 10 },
  { key: 'dob', label: 'Date of Birth', width: 15 },
  { key: 'phone', label: 'Phone', width: 15 },
  { key: 'email', label: 'Email', width: 25 },
  { key: 'parentName', label: 'Parent Name', width: 20 },
  { key: 'parentPhone', label: 'Parent Phone', width: 15 },
  { key: 'address', label: 'Address', width: 30 },
  { key: 'status', label: 'Status', width: 12 },
  { key: 'admissionDate', label: 'Admission Date', width: 15 },
  { key: 'bloodGroup', label: 'Blood Group', width: 12 },
];

router.get(
  '/students',
  checkPermission('students', 'view'),
  validateZod(studentsExportSchema, 'query'),
  async (req, res) => {
    try {
      const { format, classId, status, columns } = req.query;
      const schoolId = req.user.schoolId;

      const query = schoolScope(schoolId, { isDeleted: { $ne: true } });
      if (classId) query.classId = toOid(classId);
      if (status) query.status = status;

      const students = await Student.find(query).populate('classId', 'name section').lean();

      const selectedCols = columns
        ? STUDENT_COLS.filter((c) => columns.split(',').includes(c.key))
        : STUDENT_COLS;

      const rows = students.map((s) => ({
        admissionId: s.admissionId || s.admissionNo || '',
        name: s.name || '',
        class: s.classId
          ? `${s.classId.name}${s.classId.section ? ' - ' + s.classId.section : ''}`
          : '',
        rollNo: s.rollNo || '',
        gender: s.gender || '',
        dob: s.dateOfBirth ? new Date(s.dateOfBirth).toLocaleDateString() : '',
        phone: s.phone || '',
        email: s.email || '',
        parentName: s.parentName || s.fatherName || s.guardianName || '',
        parentPhone: s.parentPhone || s.fatherPhone || '',
        address: [s.address, s.city, s.state].filter(Boolean).join(', '),
        status: s.status || '',
        admissionDate: s.admissionDate ? new Date(s.admissionDate).toLocaleDateString() : '',
        bloodGroup: s.bloodGroup || '',
      }));

      await sendExport(res, {
        format,
        filename: `students_${today()}`,
        title: 'Student List',
        sheetName: 'Students',
        headers: selectedCols,
        rows,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── STAFF ───────────────────────────────────────────────────────────────────

const STAFF_COLS = [
  { key: 'code', label: 'Staff Code', width: 12 },
  { key: 'name', label: 'Name', width: 25 },
  { key: 'role', label: 'Role', width: 20 },
  { key: 'department', label: 'Department', width: 18 },
  { key: 'designation', label: 'Designation', width: 18 },
  { key: 'phone', label: 'Phone', width: 15 },
  { key: 'email', label: 'Email', width: 25 },
  { key: 'gender', label: 'Gender', width: 10 },
  { key: 'joinDate', label: 'Join Date', width: 15 },
  { key: 'status', label: 'Status', width: 12 },
  { key: 'salary', label: 'Salary', width: 12 },
];

router.get(
  '/staff',
  checkPermission('staff', 'view'),
  validateZod(staffExportSchema, 'query'),
  async (req, res) => {
    try {
      const { format, status, department, columns } = req.query;
      const schoolId = req.user.schoolId;

      const query = schoolScope(schoolId, { isDeleted: { $ne: true } });
      if (status) query.status = status;
      if (department) query.department = department;

      const staffList = await Staff.find(query, '-password').lean();

      const selectedCols = columns
        ? STAFF_COLS.filter((c) => columns.split(',').includes(c.key))
        : STAFF_COLS;

      const rows = staffList.map((s) => ({
        code: s.code || '',
        name: s.name || '',
        role: Array.isArray(s.role) ? s.role.join(', ') : s.role || '',
        department: s.department || '',
        designation: s.designation || '',
        phone: s.phone || '',
        email: s.email || '',
        gender: s.gender || '',
        joinDate: s.joinDate ? new Date(s.joinDate).toLocaleDateString() : '',
        status: s.status || '',
        salary: s.salary || 0,
      }));

      await sendExport(res, {
        format,
        filename: `staff_${today()}`,
        title: 'Staff List',
        sheetName: 'Staff',
        headers: selectedCols,
        rows,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── FEE COLLECTION ──────────────────────────────────────────────────────────

const FEE_COLLECTION_COLS = [
  { key: 'period', label: 'Period', width: 15 },
  { key: 'totalCollected', label: 'Total Collected (₹)', width: 22 },
  { key: 'cash', label: 'Cash (₹)', width: 14 },
  { key: 'online', label: 'Online (₹)', width: 14 },
  { key: 'cheque', label: 'Cheque (₹)', width: 14 },
  { key: 'transactionCount', label: 'Transactions', width: 14 },
];

router.get(
  '/fee-collection',
  checkPermission('fees', 'view'),
  validateZod(feeCollectionExportSchema, 'query'),
  async (req, res) => {
    try {
      const { format, academicYear, startDate, endDate } = req.query;
      const schoolId = req.user.schoolId;

      const data = await getFeeCollectionSummary(schoolId, {
        academicYear,
        startDate,
        endDate,
        groupBy: 'monthly',
      });

      const rows = data.map((d) => ({
        period: d._id || '',
        totalCollected: d.totalCollected || 0,
        cash: d.cash || 0,
        online: d.online || 0,
        cheque: d.cheque || 0,
        transactionCount: d.transactionCount || 0,
      }));

      await sendExport(res, {
        format,
        filename: `fee_collection_${today()}`,
        title: 'Fee Collection Report',
        sheetName: 'Fee Collection',
        headers: FEE_COLLECTION_COLS,
        rows,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── FEE DEFAULTERS ──────────────────────────────────────────────────────────

const FEE_DEFAULTERS_COLS = [
  { key: 'admissionId', label: 'Admission ID', width: 15 },
  { key: 'studentName', label: 'Student Name', width: 25 },
  { key: 'class', label: 'Class', width: 14 },
  { key: 'totalFee', label: 'Total Fee (₹)', width: 16 },
  { key: 'paidAmount', label: 'Paid (₹)', width: 14 },
  { key: 'balance', label: 'Balance (₹)', width: 14 },
  { key: 'status', label: 'Status', width: 12 },
];

router.get(
  '/fee-defaulters',
  checkPermission('fees', 'view'),
  validateZod(feeDefaultersExportSchema, 'query'),
  async (req, res) => {
    try {
      const { format, academicYear, classId } = req.query;
      const schoolId = req.user.schoolId;

      const data = await getOutstandingDues(schoolId, { academicYear, classId });

      const rows = data.map((d) => ({
        admissionId: d.studentId?.admissionId || '',
        studentName: d.studentId?.name || '',
        class: d.classId
          ? `${d.classId.name}${d.classId.section ? ' - ' + d.classId.section : ''}`
          : '',
        totalFee: d.totalFee || 0,
        paidAmount: d.totalPaid || 0,
        balance: d.totalBalance || 0,
        status: d.overallStatus || '',
      }));

      await sendExport(res, {
        format,
        filename: `fee_defaulters_${today()}`,
        title: 'Fee Defaulters Report',
        sheetName: 'Defaulters',
        headers: FEE_DEFAULTERS_COLS,
        rows,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── ATTENDANCE ───────────────────────────────────────────────────────────────

const ATTENDANCE_COLS = [
  { key: 'studentName', label: 'Student Name', width: 25 },
  { key: 'admissionId', label: 'Admission ID', width: 15 },
  { key: 'class', label: 'Class', width: 14 },
  { key: 'present', label: 'Present', width: 10 },
  { key: 'absent', label: 'Absent', width: 10 },
  { key: 'late', label: 'Late', width: 10 },
  { key: 'total', label: 'Total Days', width: 12 },
  { key: 'percentage', label: 'Attendance %', width: 14 },
];

router.get(
  '/attendance',
  checkPermission('students', 'view'),
  validateZod(attendanceExportSchema, 'query'),
  async (req, res) => {
    try {
      const { format, classId, startDate, endDate } = req.query;
      const schoolId = req.user.schoolId;

      const data = await getStudentAttendanceReport(schoolId, {
        classId,
        startDate,
        endDate,
      });

      const rows = data.map((d) => ({
        studentName: d.studentName || '',
        admissionId: d.admissionId || '',
        class: d.className ? `${d.className}${d.classSection ? ' - ' + d.classSection : ''}` : '',
        present: d.present || 0,
        absent: d.absent || 0,
        late: d.late || 0,
        total: d.total || 0,
        percentage: d.percentage != null ? `${d.percentage}%` : '0%',
      }));

      await sendExport(res, {
        format,
        filename: `attendance_${today()}`,
        title: `Attendance Summary (${startDate} to ${endDate})`,
        sheetName: 'Attendance',
        headers: ATTENDANCE_COLS,
        rows,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── EXAM RESULTS ────────────────────────────────────────────────────────────

const EXAM_RESULTS_COLS = [
  { key: 'rank', label: 'Rank', width: 8 },
  { key: 'admissionId', label: 'Admission ID', width: 15 },
  { key: 'studentName', label: 'Student Name', width: 25 },
  { key: 'class', label: 'Class', width: 14 },
  { key: 'marksObtained', label: 'Marks Obtained', width: 16 },
  { key: 'maxMarks', label: 'Max Marks', width: 12 },
  { key: 'percentage', label: 'Percentage', width: 12 },
  { key: 'grade', label: 'Grade', width: 8 },
  { key: 'status', label: 'Status', width: 10 },
];

router.get(
  '/exam-results',
  checkPermission('academics', 'view'),
  validateZod(examResultsExportSchema, 'query'),
  async (req, res) => {
    try {
      const { format, examId, classId, academicYear } = req.query;
      const schoolId = req.user.schoolId;

      const data = await getRankList(schoolId, { examId, classId, academicYear });

      const rows = data.map((d, idx) => ({
        rank: d.rank || idx + 1,
        admissionId: d.studentId?.admissionId || '',
        studentName: d.studentId?.name || '',
        class: d.classId
          ? `${d.classId.name}${d.classId.section ? ' - ' + d.classId.section : ''}`
          : '',
        marksObtained: d.totalMarksObtained || 0,
        maxMarks: d.totalMaxMarks || 0,
        percentage: d.percentage != null ? `${d.percentage}%` : '0%',
        grade: d.grade || '',
        status: d.status || '',
      }));

      await sendExport(res, {
        format,
        filename: `exam_results_${today()}`,
        title: 'Exam Results',
        sheetName: 'Results',
        headers: EXAM_RESULTS_COLS,
        rows,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── PAYROLL ─────────────────────────────────────────────────────────────────

const PAYROLL_COLS = [
  { key: 'employeeCode', label: 'Employee Code', width: 15 },
  { key: 'name', label: 'Name', width: 25 },
  { key: 'department', label: 'Department', width: 18 },
  { key: 'month', label: 'Month', width: 8 },
  { key: 'year', label: 'Year', width: 8 },
  { key: 'baseSalary', label: 'Base Salary', width: 14 },
  { key: 'totalAllowances', label: 'Allowances', width: 14 },
  { key: 'totalDeductions', label: 'Deductions', width: 14 },
  { key: 'grossPay', label: 'Gross Pay', width: 14 },
  { key: 'netPay', label: 'Net Pay', width: 14 },
  { key: 'status', label: 'Status', width: 12 },
];

router.get(
  '/payroll',
  checkPermission('payroll', 'view'),
  validateZod(payrollExportSchema, 'query'),
  async (req, res) => {
    try {
      const { format, month, year } = req.query;
      const schoolId = req.user.schoolId;

      // PayrollRecord has no schoolId — scope via Staff IDs belonging to this school
      const schoolStaff = await Staff.find(
        schoolScope(schoolId, { isDeleted: { $ne: true } }),
        '_id'
      ).lean();
      const staffIds = schoolStaff.map((s) => s._id);

      const records = await PayrollRecord.find({
        employeeId: { $in: staffIds },
        month: parseInt(month),
        year: parseInt(year),
      })
        .populate('employeeId', 'name code department')
        .lean();

      const rows = records.map((r) => ({
        employeeCode: r.employeeId?.code || '',
        name: r.employeeId?.name || '',
        department: r.employeeId?.department || '',
        month: r.month,
        year: r.year,
        baseSalary: r.baseSalary || 0,
        totalAllowances: r.totalAllowances || 0,
        totalDeductions: r.totalDeductions || 0,
        grossPay: r.grossPay || 0,
        netPay: r.netPay || 0,
        status: r.status || '',
      }));

      await sendExport(res, {
        format,
        filename: `payroll_${year}_${month}_${today()}`,
        title: `Payroll Summary — ${month}/${year}`,
        sheetName: 'Payroll',
        headers: PAYROLL_COLS,
        rows,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── STAFF ATTENDANCE ────────────────────────────────────────────────────────

const STAFF_ATTENDANCE_COLS = [
  { key: 'staffName', label: 'Staff Name', width: 25 },
  { key: 'designation', label: 'Designation', width: 18 },
  { key: 'department', label: 'Department', width: 18 },
  { key: 'present', label: 'Present', width: 10 },
  { key: 'absent', label: 'Absent', width: 10 },
  { key: 'late', label: 'Late', width: 10 },
  { key: 'leave', label: 'Leave', width: 10 },
  { key: 'total', label: 'Total Days', width: 12 },
  { key: 'attendanceRate', label: 'Attendance %', width: 14 },
];

router.get(
  '/staff-attendance',
  checkPermission('staff', 'view'),
  validateZod(staffAttendanceExportSchema, 'query'),
  async (req, res) => {
    try {
      const { format, startDate, endDate, department } = req.query;
      const schoolId = req.user.schoolId;

      const data = await getStaffAttendanceSummary(schoolId, { startDate, endDate, department });

      const rows = data.map((d) => ({
        staffName: d.staffName || '',
        designation: d.designation || '',
        department: d.department || '',
        present: d.present || 0,
        absent: d.absent || 0,
        late: d.late || 0,
        leave: d.leave || 0,
        total: d.total || 0,
        attendanceRate: d.attendanceRate != null ? `${d.attendanceRate}%` : '0%',
      }));

      await sendExport(res, {
        format,
        filename: `staff_attendance_${today()}`,
        title: `Staff Attendance (${startDate} to ${endDate})`,
        sheetName: 'Staff Attendance',
        headers: STAFF_ATTENDANCE_COLS,
        rows,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── CLASS RESULTS SUMMARY ────────────────────────────────────────────────────

const CLASS_RESULTS_COLS = [
  { key: 'class', label: 'Class', width: 18 },
  { key: 'totalStudents', label: 'Total Students', width: 16 },
  { key: 'passed', label: 'Passed', width: 10 },
  { key: 'failed', label: 'Failed', width: 10 },
  { key: 'passPercentage', label: 'Pass %', width: 10 },
  { key: 'avgPercentage', label: 'Avg %', width: 10 },
  { key: 'highestMarks', label: 'Highest Marks', width: 14 },
  { key: 'lowestMarks', label: 'Lowest Marks', width: 14 },
];

router.get(
  '/class-results',
  checkPermission('academics', 'view'),
  validateZod(classResultsExportSchema, 'query'),
  async (req, res) => {
    try {
      const { format, examId, classId, academicYear } = req.query;
      const schoolId = req.user.schoolId;

      const data = await getClassResultsSummary(schoolId, { examId, classId, academicYear });

      const rows = data.map((d) => ({
        class: d.className ? `${d.className}${d.classSection ? ' - ' + d.classSection : ''}` : '',
        totalStudents: d.totalStudents || 0,
        passed: d.passed || 0,
        failed: d.failed || 0,
        passPercentage: `${d.passPercentage}%`,
        avgPercentage: `${d.avgPercentage}%`,
        highestMarks: d.highestMarks || 0,
        lowestMarks: d.lowestMarks || 0,
      }));

      await sendExport(res, {
        format,
        filename: `class_results_${today()}`,
        title: 'Class-wise Results Summary',
        sheetName: 'Class Results',
        headers: CLASS_RESULTS_COLS,
        rows,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── STUDENT STRENGTH ─────────────────────────────────────────────────────────

const STUDENT_STRENGTH_COLS = [
  { key: 'class', label: 'Class', width: 18 },
  { key: 'total', label: 'Total Students', width: 16 },
  { key: 'male', label: 'Male', width: 10 },
  { key: 'female', label: 'Female', width: 10 },
  { key: 'strengthLimit', label: 'Capacity', width: 12 },
  { key: 'occupancyRate', label: 'Occupancy %', width: 14 },
];

router.get(
  '/student-strength',
  checkPermission('students', 'view'),
  validateZod(studentStrengthExportSchema, 'query'),
  async (req, res) => {
    try {
      const { format, academicYear } = req.query;
      const schoolId = req.user.schoolId;

      const data = await getStudentStrength(schoolId, { academicYear });

      const rows = data.map((d) => ({
        class: d.className ? `${d.className}${d.classSection ? ' - ' + d.classSection : ''}` : '',
        total: d.total || 0,
        male: d.male || 0,
        female: d.female || 0,
        strengthLimit: d.strengthLimit || '',
        occupancyRate: d.occupancyRate != null ? `${d.occupancyRate}%` : '',
      }));

      await sendExport(res, {
        format,
        filename: `student_strength_${today()}`,
        title: 'Student Strength by Class',
        sheetName: 'Strength',
        headers: STUDENT_STRENGTH_COLS,
        rows,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── ADMISSIONS ───────────────────────────────────────────────────────────────

const ADMISSIONS_COLS = [
  { key: 'month', label: 'Month', width: 12 },
  { key: 'year', label: 'Year', width: 8 },
  { key: 'count', label: 'Admissions', width: 14 },
  { key: 'male', label: 'Male', width: 10 },
  { key: 'female', label: 'Female', width: 10 },
];

router.get(
  '/admissions',
  checkPermission('students', 'view'),
  validateZod(admissionsExportSchema, 'query'),
  async (req, res) => {
    try {
      const { format, academicYear, startDate, endDate } = req.query;
      const schoolId = req.user.schoolId;

      const data = await getAdmissionsReport(schoolId, { academicYear, startDate, endDate });

      const MONTH_NAMES = [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec',
      ];
      const rows = data.map((d) => ({
        month: MONTH_NAMES[(d._id?.month || 1) - 1] || '',
        year: d._id?.year || '',
        count: d.count || 0,
        male: d.male || 0,
        female: d.female || 0,
      }));

      await sendExport(res, {
        format,
        filename: `admissions_${today()}`,
        title: 'New Admissions Report',
        sheetName: 'Admissions',
        headers: ADMISSIONS_COLS,
        rows,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── CONCESSIONS ──────────────────────────────────────────────────────────────

const CONCESSIONS_COLS = [
  { key: 'admissionId', label: 'Admission ID', width: 15 },
  { key: 'studentName', label: 'Student Name', width: 25 },
  { key: 'class', label: 'Class', width: 14 },
  { key: 'totalFee', label: 'Total Fee (₹)', width: 16 },
  { key: 'discountApplied', label: 'Discount (₹)', width: 16 },
  { key: 'discountReason', label: 'Discount Reason', width: 22 },
  { key: 'totalPaid', label: 'Paid (₹)', width: 14 },
  { key: 'totalBalance', label: 'Balance (₹)', width: 14 },
];

router.get(
  '/concessions',
  checkPermission('fees', 'view'),
  validateZod(concessionsExportSchema, 'query'),
  async (req, res) => {
    try {
      const { format, academicYear } = req.query;
      const schoolId = req.user.schoolId;

      const data = await getConcessionReport(schoolId, { academicYear });

      const rows = data.map((d) => ({
        admissionId: d.studentId?.admissionId || '',
        studentName: d.studentId?.name || '',
        class: d.classId
          ? `${d.classId.name}${d.classId.section ? ' - ' + d.classId.section : ''}`
          : '',
        totalFee: d.totalFee || 0,
        discountApplied: d.discountApplied || 0,
        discountReason: d.discountReason || '',
        totalPaid: d.totalPaid || 0,
        totalBalance: d.totalBalance || 0,
      }));

      await sendExport(res, {
        format,
        filename: `concessions_${today()}`,
        title: 'Concession / Discount Report',
        sheetName: 'Concessions',
        headers: CONCESSIONS_COLS,
        rows,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── FEE HEAD WISE COLLECTION ─────────────────────────────────────────────────

const FEE_HEADS_COLS = [
  { key: 'feeHead', label: 'Fee Head', width: 22 },
  { key: 'totalCollected', label: 'Total Collected (₹)', width: 22 },
  { key: 'transactionCount', label: 'Transactions', width: 14 },
];

router.get(
  '/fee-heads',
  checkPermission('fees', 'view'),
  validateZod(feeHeadsExportSchema, 'query'),
  async (req, res) => {
    try {
      const { format, academicYear, startDate, endDate } = req.query;
      const schoolId = req.user.schoolId;

      const data = await getFeeHeadWiseCollection(schoolId, { academicYear, startDate, endDate });

      const rows = data.map((d) => ({
        feeHead: d._id || 'Unknown',
        totalCollected: d.totalCollected || 0,
        transactionCount: d.transactionCount || 0,
      }));

      await sendExport(res, {
        format,
        filename: `fee_heads_${today()}`,
        title: 'Fee Head Wise Collection',
        sheetName: 'Fee Heads',
        headers: FEE_HEADS_COLS,
        rows,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── GOVERNMENT PORTAL EXPORTS ───────────────────────────────────────────────

// Helper: category normalisation for UDISE
function udiseCategory(cat) {
  if (!cat) return 'general';
  const c = cat.toUpperCase();
  if (c === 'SC') return 'sc';
  if (c === 'ST') return 'st';
  if (c.startsWith('OBC')) return 'obc';
  return 'general';
}

// ─── UDISE+ ENROLLMENT ───────────────────────────────────────────────────────

const UDISE_COLS = [
  { key: 'className', label: 'Class / Grade', width: 20 },
  { key: 'total', label: 'Total Enrolment', width: 18 },
  { key: 'boys', label: 'Boys', width: 10 },
  { key: 'girls', label: 'Girls', width: 10 },
  { key: 'sc', label: 'SC', width: 8 },
  { key: 'st', label: 'ST', width: 8 },
  { key: 'obc', label: 'OBC', width: 10 },
  { key: 'general', label: 'General', width: 10 },
];

router.get(
  '/govt/udise',
  checkPermission('students', 'view'),
  validateZod(udiseExportSchema, 'query'),
  async (req, res) => {
    try {
      const { format, academicYear } = req.query;
      const schoolId = req.user.schoolId;

      const query = schoolScope(schoolId, { isDeleted: { $ne: true }, status: 'active' });
      if (academicYear) query.academicYear = academicYear;

      const students = await Student.find(query).populate('classId', 'name section').lean();

      // Group by class
      const classMap = {};
      for (const s of students) {
        const key = s.classId
          ? `${s.classId.name}${s.classId.section ? ' ' + s.classId.section : ''}`
          : 'Unassigned';
        if (!classMap[key]) {
          classMap[key] = {
            className: key,
            total: 0,
            boys: 0,
            girls: 0,
            sc: 0,
            st: 0,
            obc: 0,
            general: 0,
          };
        }
        const row = classMap[key];
        row.total++;
        if ((s.gender || '').toLowerCase() === 'male') row.boys++;
        else if ((s.gender || '').toLowerCase() === 'female') row.girls++;
        row[udiseCategory(s.category)]++;
      }

      const rows = Object.values(classMap).sort((a, b) => a.className.localeCompare(b.className));

      await sendExport(res, {
        format,
        filename: `udise_enrollment_${today()}`,
        title: 'UDISE+ Enrolment Data',
        sheetName: 'UDISE Enrollment',
        headers: UDISE_COLS,
        rows,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── CBSE AFFILIATION DATA ───────────────────────────────────────────────────

const CBSE_COLS = [
  { key: 'srNo', label: 'Sr. No.', width: 8 },
  { key: 'admissionId', label: 'Admission No.', width: 16 },
  { key: 'name', label: 'Student Name', width: 28 },
  { key: 'dob', label: 'Date of Birth', width: 16 },
  { key: 'gender', label: 'Gender', width: 10 },
  { key: 'category', label: 'Category', width: 12 },
  { key: 'aadhaar', label: 'Aadhaar No.', width: 16 },
  { key: 'fatherName', label: "Father's Name", width: 25 },
  { key: 'motherName', label: "Mother's Name", width: 25 },
  { key: 'class', label: 'Class', width: 14 },
  { key: 'religion', label: 'Religion', width: 14 },
  { key: 'nationality', label: 'Nationality', width: 14 },
];

router.get(
  '/govt/cbse',
  checkPermission('students', 'view'),
  validateZod(cbseExportSchema, 'query'),
  async (req, res) => {
    try {
      const { format, academicYear, classId } = req.query;
      const schoolId = req.user.schoolId;

      const query = schoolScope(schoolId, { isDeleted: { $ne: true }, status: 'active' });
      if (academicYear) query.academicYear = academicYear;
      if (classId) query.classId = toOid(classId);

      const students = await Student.find(query).populate('classId', 'name section').lean();

      const rows = students.map((s, idx) => {
        const father = (s.parents || []).find(
          (p) => (p.relationship || '').toLowerCase() === 'father'
        );
        const mother = (s.parents || []).find(
          (p) => (p.relationship || '').toLowerCase() === 'mother'
        );
        return {
          srNo: idx + 1,
          admissionId: s.admissionId || '',
          name: s.name || '',
          dob: s.dateOfBirth ? formatDateSafe(s.dateOfBirth) : '',
          gender: s.gender || '',
          category: s.category || 'General',
          aadhaar: s.aadhaarNumber || '',
          fatherName: father?.name || s.parentName || '',
          motherName: mother?.name || '',
          class: s.classId
            ? `${s.classId.name}${s.classId.section ? ' - ' + s.classId.section : ''}`
            : '',
          religion: s.religion || '',
          nationality: s.nationality || 'Indian',
        };
      });

      await sendExport(res, {
        format,
        filename: `cbse_students_${today()}`,
        title: 'CBSE Affiliation — Student Data',
        sheetName: 'CBSE Students',
        headers: CBSE_COLS,
        rows,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── ICSE PORTAL FORMAT ───────────────────────────────────────────────────────

const ICSE_COLS = [
  { key: 'srNo', label: 'Sl. No.', width: 8 },
  { key: 'admissionId', label: 'Admission Number', width: 18 },
  { key: 'name', label: 'Candidate Name', width: 28 },
  { key: 'dob', label: 'D.O.B.', width: 14 },
  { key: 'gender', label: 'Sex', width: 8 },
  { key: 'category', label: 'Category', width: 12 },
  { key: 'aadhaar', label: 'Aadhaar', width: 16 },
  { key: 'guardianName', label: 'Guardian Name', width: 25 },
  { key: 'class', label: 'Class', width: 14 },
  { key: 'motherTongue', label: 'Mother Tongue', width: 16 },
  { key: 'religion', label: 'Religion', width: 14 },
  { key: 'previousSchool', label: 'Previous School', width: 25 },
];

router.get(
  '/govt/icse',
  checkPermission('students', 'view'),
  validateZod(icseExportSchema, 'query'),
  async (req, res) => {
    try {
      const { format, academicYear, classId } = req.query;
      const schoolId = req.user.schoolId;

      const query = schoolScope(schoolId, { isDeleted: { $ne: true }, status: 'active' });
      if (academicYear) query.academicYear = academicYear;
      if (classId) query.classId = toOid(classId);

      const students = await Student.find(query).populate('classId', 'name section').lean();

      const rows = students.map((s, idx) => ({
        srNo: idx + 1,
        admissionId: s.admissionId || '',
        name: s.name || '',
        dob: s.dateOfBirth ? formatDateSafe(s.dateOfBirth) : '',
        gender: (s.gender || '').charAt(0).toUpperCase() || '',
        category: s.category || 'General',
        aadhaar: s.aadhaarNumber || '',
        guardianName: s.parentName || s.parents?.[0]?.name || '',
        class: s.classId
          ? `${s.classId.name}${s.classId.section ? ' - ' + s.classId.section : ''}`
          : '',
        motherTongue: s.motherTongue || '',
        religion: s.religion || '',
        previousSchool: s.previousSchool || '',
      }));

      await sendExport(res, {
        format,
        filename: `icse_students_${today()}`,
        title: 'ICSE Portal — Student Data',
        sheetName: 'ICSE Students',
        headers: ICSE_COLS,
        rows,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── STATE BOARD FORMAT ───────────────────────────────────────────────────────

const STATE_BOARD_COLS = [
  { key: 'srNo', label: 'Sr. No.', width: 8 },
  { key: 'admissionId', label: 'Admission No.', width: 16 },
  { key: 'name', label: 'Student Name', width: 28 },
  { key: 'dob', label: 'Date of Birth', width: 14 },
  { key: 'gender', label: 'Gender', width: 10 },
  { key: 'category', label: 'Category/Caste', width: 16 },
  { key: 'aadhaar', label: 'Aadhaar No.', width: 16 },
  { key: 'parentName', label: 'Parent/Guardian', width: 25 },
  { key: 'class', label: 'Class', width: 14 },
  { key: 'religion', label: 'Religion', width: 14 },
  { key: 'motherTongue', label: 'Mother Tongue', width: 16 },
  { key: 'address', label: 'Address', width: 30 },
];

router.get(
  '/govt/state-board',
  checkPermission('students', 'view'),
  validateZod(stateBoardExportSchema, 'query'),
  async (req, res) => {
    try {
      const { format, academicYear, classId } = req.query;
      const schoolId = req.user.schoolId;

      const query = schoolScope(schoolId, { isDeleted: { $ne: true }, status: 'active' });
      if (academicYear) query.academicYear = academicYear;
      if (classId) query.classId = toOid(classId);

      const students = await Student.find(query).populate('classId', 'name section').lean();

      const rows = students.map((s, idx) => ({
        srNo: idx + 1,
        admissionId: s.admissionId || '',
        name: s.name || '',
        dob: s.dateOfBirth ? formatDateSafe(s.dateOfBirth) : '',
        gender: s.gender || '',
        category: s.category || 'General',
        aadhaar: s.aadhaarNumber || '',
        parentName: s.parentName || s.parents?.[0]?.name || '',
        class: s.classId
          ? `${s.classId.name}${s.classId.section ? ' - ' + s.classId.section : ''}`
          : '',
        religion: s.religion || '',
        motherTongue: s.motherTongue || '',
        address: [s.address, s.city, s.state, s.zipCode].filter(Boolean).join(', '),
      }));

      await sendExport(res, {
        format,
        filename: `state_board_students_${today()}`,
        title: 'State Board — Student Register',
        sheetName: 'Student Register',
        headers: STATE_BOARD_COLS,
        rows,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── ANNUAL REPORT ───────────────────────────────────────────────────────────

const ANNUAL_REPORT_COLS = [
  { key: 'metric', label: 'Metric', width: 35 },
  { key: 'value', label: 'Value', width: 20 },
];

router.get(
  '/govt/annual-report',
  checkPermission('students', 'view'),
  validateZod(annualReportExportSchema, 'query'),
  async (req, res) => {
    try {
      const { format, academicYear } = req.query;
      const schoolId = req.user.schoolId;

      const query = schoolScope(schoolId, { isDeleted: { $ne: true } });
      if (academicYear) query.academicYear = academicYear;

      const [settings, totalStudents, activeStudents, totalStaff, activeStaff] = await Promise.all([
        SchoolSettings.findOne({ schoolId: toOid(schoolId) }).lean(),
        Student.countDocuments(query),
        Student.countDocuments({ ...query, status: 'active' }),
        Staff.countDocuments(schoolScope(schoolId, { isDeleted: { $ne: true } })),
        Staff.countDocuments(schoolScope(schoolId, { isDeleted: { $ne: true }, status: 'active' })),
      ]);

      // Gender breakdown
      const genderStats = await Student.aggregate([
        { $match: { ...query, status: 'active' } },
        { $group: { _id: '$gender', count: { $sum: 1 } } },
      ]);
      const boys = genderStats.find((g) => (g._id || '').toLowerCase() === 'male')?.count || 0;
      const girls = genderStats.find((g) => (g._id || '').toLowerCase() === 'female')?.count || 0;

      // Category breakdown
      const catStats = await Student.aggregate([
        { $match: { ...query, status: 'active' } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
      ]);
      const catMap = {};
      for (const c of catStats)
        catMap[udiseCategory(c._id)] = (catMap[udiseCategory(c._id)] || 0) + c.count;

      const rows = [
        { metric: 'School Name', value: settings?.schoolName || settings?.name || '' },
        { metric: 'UDISE No.', value: settings?.udiseNo || '' },
        { metric: 'Affiliation No.', value: settings?.affiliationNo || '' },
        { metric: 'Board of Education', value: settings?.boardOfEducation || '' },
        { metric: 'Academic Year', value: academicYear || settings?.academicYear || '' },
        { metric: 'Report Generated On', value: new Date().toLocaleDateString('en-IN') },
        { metric: '─── Enrollment ───', value: '' },
        { metric: 'Total Students (Enrolled)', value: totalStudents },
        { metric: 'Active Students', value: activeStudents },
        { metric: 'Boys', value: boys },
        { metric: 'Girls', value: girls },
        { metric: '─── Category-wise ───', value: '' },
        { metric: 'SC Students', value: catMap.sc || 0 },
        { metric: 'ST Students', value: catMap.st || 0 },
        { metric: 'OBC Students', value: catMap.obc || 0 },
        { metric: 'General Students', value: catMap.general || 0 },
        { metric: '─── Staff ───', value: '' },
        { metric: 'Total Staff', value: totalStaff },
        { metric: 'Active Staff', value: activeStaff },
      ];

      await sendExport(res, {
        format,
        filename: `annual_report_${academicYear || today()}`,
        title: `Annual Report — ${academicYear || ''}`,
        sheetName: 'Annual Report',
        headers: ANNUAL_REPORT_COLS,
        rows,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── COMPLIANCE CHECKLIST ─────────────────────────────────────────────────────

const CHECKLIST_COLS = [
  { key: 'item', label: 'Compliance Item', width: 40 },
  { key: 'status', label: 'Status', width: 12 },
  { key: 'detail', label: 'Detail', width: 35 },
];

router.get(
  '/govt/compliance-checklist',
  checkPermission('students', 'view'),
  validateZod(complianceChecklistExportSchema, 'query'),
  async (req, res) => {
    try {
      const { format, academicYear } = req.query;
      const schoolId = req.user.schoolId;

      const settings = await SchoolSettings.findOne({ schoolId: toOid(schoolId) }).lean();

      const studentQuery = schoolScope(schoolId, { isDeleted: { $ne: true }, status: 'active' });
      if (academicYear) studentQuery.academicYear = academicYear;

      const [totalActive, withAadhaar, withDob, withCategory, withReligion] = await Promise.all([
        Student.countDocuments(studentQuery),
        Student.countDocuments({ ...studentQuery, aadhaarNumber: { $exists: true, $ne: '' } }),
        Student.countDocuments({ ...studentQuery, dateOfBirth: { $exists: true, $ne: '' } }),
        Student.countDocuments({ ...studentQuery, category: { $exists: true, $ne: '' } }),
        Student.countDocuments({ ...studentQuery, religion: { $exists: true, $ne: '' } }),
      ]);

      const pct = (n) => (totalActive > 0 ? `${Math.round((n / totalActive) * 100)}%` : 'N/A');
      const ok = (v) => (v ? 'OK' : 'MISSING');

      const rows = [
        {
          item: 'School UDISE No. configured',
          status: ok(settings?.udiseNo),
          detail: settings?.udiseNo || 'Not set in Institution Settings',
        },
        {
          item: 'Affiliation No. configured',
          status: ok(settings?.affiliationNo),
          detail: settings?.affiliationNo || 'Not set in Institution Settings',
        },
        {
          item: 'Board of Education configured',
          status: ok(settings?.boardOfEducation),
          detail: settings?.boardOfEducation || 'Not set in Institution Settings',
        },
        {
          item: 'Students with Aadhaar No.',
          status: withAadhaar === totalActive ? 'OK' : 'INCOMPLETE',
          detail: `${withAadhaar}/${totalActive} (${pct(withAadhaar)})`,
        },
        {
          item: 'Students with Date of Birth',
          status: withDob === totalActive ? 'OK' : 'INCOMPLETE',
          detail: `${withDob}/${totalActive} (${pct(withDob)})`,
        },
        {
          item: 'Students with Category (SC/ST/OBC/General)',
          status: withCategory === totalActive ? 'OK' : 'INCOMPLETE',
          detail: `${withCategory}/${totalActive} (${pct(withCategory)})`,
        },
        {
          item: 'Students with Religion',
          status: withReligion === totalActive ? 'OK' : 'INCOMPLETE',
          detail: `${withReligion}/${totalActive} (${pct(withReligion)})`,
        },
      ];

      await sendExport(res, {
        format,
        filename: `compliance_checklist_${today()}`,
        title: 'Government Compliance Checklist',
        sheetName: 'Compliance',
        headers: CHECKLIST_COLS,
        rows,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
