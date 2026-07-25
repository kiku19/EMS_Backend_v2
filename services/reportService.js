import mongoose from 'mongoose';
import {
  Student,
  Class,
  Attendance,
  Result,
  FeePayment,
  StudentFeeStructure,
  Staff,
} from '../database.js';
import StaffAttendance from '../models/StaffAttendance.js';
import PayrollRecord from '../models/PayrollRecord.js';
import Visitor from '../models/Visitor.js';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

function toObjectId(id) {
  return new mongoose.Types.ObjectId(String(id));
}

// ─── ACADEMIC REPORTS ────────────────────────────────────────────────────────

/**
 * Class-wise result summary for a given exam.
 * Groups results by class and computes pass/fail counts, average percentage.
 */
export async function getClassResultsSummary(schoolId, { classId, examId, academicYear }) {
  const match = {
    schoolId: toObjectId(schoolId),
    examId: toObjectId(examId),
    isDeleted: { $ne: true },
    isPublished: true,
  };
  if (classId) match.classId = toObjectId(classId);
  if (academicYear) match.academicYear = academicYear;

  const results = await Result.aggregate([
    { $match: match },
    {
      $lookup: {
        from: 'classes',
        localField: 'classId',
        foreignField: '_id',
        as: 'class',
        pipeline: [{ $project: { name: 1, section: 1 } }],
      },
    },
    { $unwind: { path: '$class', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: '$classId',
        className: { $first: '$class.name' },
        classSection: { $first: '$class.section' },
        totalStudents: { $sum: 1 },
        passed: { $sum: { $cond: [{ $eq: ['$status', 'passed'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        avgPercentage: { $avg: '$percentage' },
        highestMarks: { $max: '$totalMarksObtained' },
        lowestMarks: { $min: '$totalMarksObtained' },
      },
    },
    { $sort: { className: 1, classSection: 1 } },
  ]);

  return results.map((r) => ({
    classId: r._id,
    className: r.className,
    classSection: r.classSection,
    totalStudents: r.totalStudents,
    passed: r.passed,
    failed: r.failed,
    avgPercentage: r.avgPercentage != null ? Number(r.avgPercentage.toFixed(2)) : 0,
    highestMarks: r.highestMarks,
    lowestMarks: r.lowestMarks,
    passPercentage:
      r.totalStudents > 0 ? Number(((r.passed / r.totalStudents) * 100).toFixed(2)) : 0,
  }));
}

/**
 * Subject-wise analysis for a given exam (uses the marks[] multi-subject array).
 */
export async function getSubjectAnalysis(schoolId, { examId, classId, academicYear }) {
  const match = {
    schoolId: toObjectId(schoolId),
    examId: toObjectId(examId),
    isDeleted: { $ne: true },
    isPublished: true,
    'marks.0': { $exists: true },
  };
  if (classId) match.classId = toObjectId(classId);
  if (academicYear) match.academicYear = academicYear;

  const results = await Result.aggregate([
    { $match: match },
    { $unwind: '$marks' },
    {
      $group: {
        _id: '$marks.subjectName',
        totalStudents: { $sum: 1 },
        avgMarks: { $avg: '$marks.marksObtained' },
        maxMarks: { $first: '$marks.maxMarks' },
        highestMarks: { $max: '$marks.marksObtained' },
        lowestMarks: { $min: '$marks.marksObtained' },
        passed: {
          $sum: {
            $cond: [
              {
                $gte: [
                  '$marks.marksObtained',
                  {
                    $ifNull: ['$marks.passingMarks', { $multiply: ['$marks.maxMarks', 0.35] }],
                  },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return results.map((r) => ({
    subject: r._id,
    totalStudents: r.totalStudents,
    avgMarks: r.avgMarks != null ? Number(r.avgMarks.toFixed(2)) : 0,
    maxMarks: r.maxMarks,
    highestMarks: r.highestMarks,
    lowestMarks: r.lowestMarks,
    passed: r.passed,
    passPercentage:
      r.totalStudents > 0 ? Number(((r.passed / r.totalStudents) * 100).toFixed(2)) : 0,
  }));
}

/**
 * Rank list for a given exam (sorted by percentage desc).
 * Returns a full array — kept for non-export callers.
 */
export async function getRankList(schoolId, { examId, classId, academicYear }) {
  const cursor = streamRankList(schoolId, { examId, classId, academicYear });
  const out = [];
  let doc;
  while ((doc = await cursor.next())) out.push(doc);
  return out;
}

/**
 * Mongoose query builder shared by getRankList() and streamRankList().
 */
function rankListQuery(schoolId, { examId, classId, academicYear }) {
  const match = {
    schoolId: toObjectId(schoolId),
    examId: toObjectId(examId),
    isDeleted: { $ne: true },
    isPublished: true,
  };
  if (classId) match.classId = toObjectId(classId);
  if (academicYear) match.academicYear = academicYear;

  return Result.find(match)
    .populate('studentId', 'name rollNo admissionId')
    .populate('classId', 'name section')
    .sort({ percentage: -1, totalMarksObtained: -1 })
    .select('studentId classId totalMarksObtained totalMaxMarks percentage grade rank status');
}

/**
 * Cursor variant of getRankList() — yields one Result document at a time
 * (already populated + sorted), so exportService.sendStreamedExport() can
 * stream rows without buffering the whole result set in memory.
 */
export function streamRankList(schoolId, opts) {
  return rankListQuery(schoolId, opts).lean().cursor();
}

/**
 * Grade distribution for a given exam.
 */
export async function getGradeDistribution(schoolId, { examId, classId, academicYear }) {
  const match = {
    schoolId: toObjectId(schoolId),
    examId: toObjectId(examId),
    isDeleted: { $ne: true },
    isPublished: true,
  };
  if (classId) match.classId = toObjectId(classId);
  if (academicYear) match.academicYear = academicYear;

  return Result.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $ifNull: ['$grade', 'N/A'] },
        count: { $sum: 1 },
        avgPercentage: { $avg: '$percentage' },
      },
    },
    { $sort: { _id: 1 } },
  ]);
}

// ─── FINANCIAL REPORTS ───────────────────────────────────────────────────────

/**
 * Fee collection summary grouped by daily / monthly / yearly.
 */
export async function getFeeCollectionSummary(
  schoolId,
  { academicYear, startDate, endDate, groupBy = 'monthly' }
) {
  const match = {
    schoolId: toObjectId(schoolId),
    status: 'completed',
    isDeleted: { $ne: true },
  };
  if (academicYear) match.academicYear = academicYear;
  if (startDate || endDate) {
    match.paymentDate = {};
    if (startDate) match.paymentDate.$gte = startDate;
    if (endDate) match.paymentDate.$lte = endDate;
  }

  const groupId =
    groupBy === 'daily'
      ? '$paymentDate'
      : groupBy === 'monthly'
        ? { $substr: ['$paymentDate', 0, 7] }
        : { $substr: ['$paymentDate', 0, 4] };

  return FeePayment.aggregate([
    { $match: match },
    {
      $group: {
        _id: groupId,
        totalCollected: { $sum: '$amount' },
        transactionCount: { $sum: 1 },
        cash: { $sum: { $cond: [{ $eq: ['$paymentMode', 'cash'] }, '$amount', 0] } },
        online: { $sum: { $cond: [{ $eq: ['$paymentMode', 'online'] }, '$amount', 0] } },
        cheque: { $sum: { $cond: [{ $eq: ['$paymentMode', 'cheque'] }, '$amount', 0] } },
        card: { $sum: { $cond: [{ $eq: ['$paymentMode', 'card'] }, '$amount', 0] } },
      },
    },
    { $sort: { _id: 1 } },
  ]);
}

/**
 * Outstanding dues — students with pending or partial fee status.
 * Returns a full array — kept for non-export callers.
 */
export async function getOutstandingDues(schoolId, opts) {
  const cursor = streamOutstandingDues(schoolId, opts);
  const out = [];
  let doc;
  while ((doc = await cursor.next())) out.push(doc);
  return out;
}

/**
 * Shared query builder for outstanding dues.
 */
function outstandingDuesQuery(schoolId, { academicYear, classId }) {
  const match = {
    schoolId: toObjectId(schoolId),
    overallStatus: { $in: ['pending', 'partial'] },
    isDeleted: { $ne: true },
  };
  if (academicYear) match.academicYear = academicYear;
  if (classId) match.classId = toObjectId(classId);

  return StudentFeeStructure.find(match)
    .populate({
      path: 'studentId',
      select: 'name admissionId rollNo status',
      match: { isDeleted: { $ne: true } },
    })
    .populate('classId', 'name section')
    .select(
      'studentId classId academicYear totalFee totalPaid totalBalance overallStatus lastPaymentDate'
    )
    .sort({ totalBalance: -1 });
}

/**
 * Cursor variant of getOutstandingDues() — yields one StudentFeeStructure
 * document at a time. Records whose student was soft-deleted (populate
 * returned null for studentId) are skipped so the stream matches the
 * array variant's filter. The returned object is a wrapper exposing a
 * Mongoose-compatible .next() that skips filtered-out docs.
 */
export function streamOutstandingDues(schoolId, opts) {
  const cursor = outstandingDuesQuery(schoolId, opts).lean().cursor();
  // Wrap so the export helper's `while (await cursor.next())` loop skips
  // records where populate set studentId to null (soft-deleted student).
  return {
    async next() {
      let doc;
      while ((doc = await cursor.next())) {
        if (doc.studentId != null) return doc;
      }
      return null;
    },
  };
}

/**
 * Fee head wise collection summary.
 */
export async function getFeeHeadWiseCollection(schoolId, { academicYear, startDate, endDate }) {
  const match = {
    schoolId: toObjectId(schoolId),
    status: 'completed',
    isDeleted: { $ne: true },
  };
  if (academicYear) match.academicYear = academicYear;
  if (startDate || endDate) {
    match.paymentDate = {};
    if (startDate) match.paymentDate.$gte = startDate;
    if (endDate) match.paymentDate.$lte = endDate;
  }

  return FeePayment.aggregate([
    { $match: match },
    { $unwind: { path: '$feeHeads', preserveNullAndEmptyArrays: false } },
    {
      $group: {
        _id: { $ifNull: ['$feeHeads.name', 'Unknown'] },
        totalCollected: { $sum: '$feeHeads.amount' },
        transactionCount: { $sum: 1 },
      },
    },
    { $sort: { totalCollected: -1 } },
  ]);
}

/**
 * Payment mode wise summary.
 */
export async function getPaymentModeSummary(schoolId, { academicYear, startDate, endDate }) {
  const match = {
    schoolId: toObjectId(schoolId),
    status: 'completed',
    isDeleted: { $ne: true },
  };
  if (academicYear) match.academicYear = academicYear;
  if (startDate || endDate) {
    match.paymentDate = {};
    if (startDate) match.paymentDate.$gte = startDate;
    if (endDate) match.paymentDate.$lte = endDate;
  }

  return FeePayment.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$paymentMode',
        totalAmount: { $sum: '$amount' },
        transactionCount: { $sum: 1 },
        avgTransactionAmount: { $avg: '$amount' },
      },
    },
    { $sort: { totalAmount: -1 } },
  ]);
}

/**
 * Concession/discount report — students who received discounts.
 */
export async function getConcessionReport(schoolId, { academicYear }) {
  const match = {
    schoolId: toObjectId(schoolId),
    discountApplied: { $gt: 0 },
    isDeleted: { $ne: true },
  };
  if (academicYear) match.academicYear = academicYear;

  const results = await StudentFeeStructure.find(match)
    .populate({
      path: 'studentId',
      select: 'name admissionId rollNo',
      match: { isDeleted: { $ne: true } },
    })
    .populate('classId', 'name section')
    .select(
      'studentId classId academicYear totalFee discountApplied discountReason totalPaid totalBalance'
    )
    .sort({ discountApplied: -1 });

  // Filter out records where the student was deleted (populate returns null)
  return results.filter((r) => r.studentId != null);
}

// ─── ATTENDANCE REPORTS ──────────────────────────────────────────────────────

/**
 * Per-row transform for the student attendance aggregate: takes a grouped
 * aggregate document and returns the normalized attendance row. Shared by
 * getStudentAttendanceReport() (array) and streamStudentAttendanceReport()
 * (cursor) so both paths stay identical.
 */
function attendanceRowFromDoc(r) {
  return {
    studentId: r._id,
    studentName: r.student?.name,
    rollNo: r.student?.rollNo,
    admissionId: r.student?.admissionId,
    className: r.class?.name,
    classSection: r.class?.section,
    present: r.present,
    absent: r.absent,
    late: r.late,
    leave: r.leave,
    halfday: r.halfday,
    total: r.total,
    percentage: r.total > 0 ? Number((((r.present + r.late) / r.total) * 100).toFixed(2)) : 0,
  };
}

/**
 * Shared aggregate pipeline for student-wise attendance in a date range.
 */
function studentAttendancePipeline(schoolId, { startDate, endDate, classId, studentId }) {
  const match = {
    schoolId: toObjectId(schoolId),
    date: { $gte: startDate, $lte: endDate },
  };
  if (classId) match.classId = toObjectId(classId);
  if (studentId) match.studentId = toObjectId(studentId);

  return [
    { $match: match },
    {
      $group: {
        _id: '$studentId',
        present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
        absent: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
        late: { $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] } },
        leave: { $sum: { $cond: [{ $eq: ['$status', 'leave'] }, 1, 0] } },
        halfday: { $sum: { $cond: [{ $eq: ['$status', 'halfday'] }, 1, 0] } },
        total: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: 'students',
        localField: '_id',
        foreignField: '_id',
        as: 'student',
        pipeline: [{ $project: { name: 1, rollNo: 1, admissionId: 1, classId: 1 } }],
      },
    },
    { $unwind: { path: '$student', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'classes',
        localField: 'student.classId',
        foreignField: '_id',
        as: 'class',
        pipeline: [{ $project: { name: 1, section: 1 } }],
      },
    },
    { $unwind: { path: '$class', preserveNullAndEmptyArrays: true } },
    { $sort: { 'student.rollNo': 1 } },
  ];
}

/**
 * Student-wise attendance percentage for a date range.
 * Returns a full array — kept for non-export callers.
 */
export async function getStudentAttendanceReport(schoolId, opts) {
  const records = await Attendance.aggregate(studentAttendancePipeline(schoolId, opts));
  return records.map(attendanceRowFromDoc);
}

/**
 * Cursor variant of getStudentAttendanceReport() — yields one transformed
 * attendance row at a time from the aggregate pipeline, so
 * sendStreamedExport() can stream without buffering the full result set.
 * Each document from the aggregate cursor is mapped through
 * attendanceRowFromDoc() on the fly.
 */
export function streamStudentAttendanceReport(schoolId, opts) {
  const cursor = Attendance.aggregate(studentAttendancePipeline(schoolId, opts)).cursor();
  return {
    async next() {
      const doc = await cursor.next();
      if (doc === null) return null;
      return attendanceRowFromDoc(doc);
    },
  };
}

/**
 * Class-wise attendance summary for a date range.
 */
export async function getClasswiseAttendanceSummary(schoolId, { startDate, endDate }) {
  const results = await Attendance.aggregate([
    {
      $match: {
        schoolId: toObjectId(schoolId),
        date: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: '$classId',
        totalRecords: { $sum: 1 },
        present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
        absent: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
        late: { $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] } },
        leave: { $sum: { $cond: [{ $eq: ['$status', 'leave'] }, 1, 0] } },
        halfday: { $sum: { $cond: [{ $eq: ['$status', 'halfday'] }, 1, 0] } },
      },
    },
    {
      $lookup: {
        from: 'classes',
        localField: '_id',
        foreignField: '_id',
        as: 'class',
        pipeline: [{ $project: { name: 1, section: 1 } }],
      },
    },
    { $unwind: { path: '$class', preserveNullAndEmptyArrays: true } },
    { $sort: { 'class.name': 1, 'class.section': 1 } },
  ]);

  return results.map((r) => ({
    classId: r._id,
    className: r.class?.name,
    classSection: r.class?.section,
    totalRecords: r.totalRecords,
    present: r.present,
    absent: r.absent,
    late: r.late,
    leave: r.leave,
    halfday: r.halfday,
    attendanceRate:
      r.totalRecords > 0 ? Number((((r.present + r.late) / r.totalRecords) * 100).toFixed(2)) : 0,
  }));
}

/**
 * Monthly attendance register — per-student daily attendance grid for a class.
 * month format: YYYY-MM
 */
export async function getMonthlyAttendanceRegister(schoolId, { classId, month }) {
  const startDate = `${month}-01`;
  const [year, m] = month.split('-').map(Number);
  const lastDay = new Date(year, m, 0).getDate();
  const endDate = `${month}-${String(lastDay).padStart(2, '0')}`;

  const records = await Attendance.find({
    schoolId: toObjectId(schoolId),
    classId: toObjectId(classId),
    date: { $gte: startDate, $lte: endDate },
  })
    .populate('studentId', 'name rollNo admissionId')
    .sort({ date: 1 });

  const byStudent = {};
  for (const record of records) {
    if (!record.studentId) continue;
    const sid = record.studentId._id.toString();
    if (!byStudent[sid]) {
      byStudent[sid] = {
        studentId: record.studentId._id,
        studentName: record.studentId.name,
        rollNo: record.studentId.rollNo,
        admissionId: record.studentId.admissionId,
        attendance: {},
      };
    }
    byStudent[sid].attendance[record.date] = record.status;
  }

  // Compute totals per student
  return Object.values(byStudent)
    .map((s) => {
      const days = Object.values(s.attendance);
      const total = days.length;
      const present = days.filter((d) => d === 'present').length;
      const absent = days.filter((d) => d === 'absent').length;
      const late = days.filter((d) => d === 'late').length;
      return {
        ...s,
        totals: {
          present,
          absent,
          late,
          leave: days.filter((d) => d === 'leave').length,
          halfday: days.filter((d) => d === 'halfday').length,
          total,
          percentage: total > 0 ? Number((((present + late) / total) * 100).toFixed(2)) : 0,
        },
      };
    })
    .sort((a, b) => (a.rollNo || 0) - (b.rollNo || 0));
}

/**
 * Absentee report — all absence records in a date range.
 */
export async function getAbsenteeReport(schoolId, { startDate, endDate, classId }) {
  const match = {
    schoolId: toObjectId(schoolId),
    date: { $gte: startDate, $lte: endDate },
    status: 'absent',
  };
  if (classId) match.classId = toObjectId(classId);

  return Attendance.find(match)
    .populate('studentId', 'name rollNo admissionId parents')
    .populate('classId', 'name section')
    .sort({ date: -1 })
    .select('studentId classId date status');
}

/**
 * Attendance trend — school-wide (or class-scoped) attendance rate grouped by day/week/month.
 * Returns an array of { period, present, absent, late, leave, halfday, total, rate }.
 */
export async function getAttendanceTrend(
  schoolId,
  { startDate, endDate, classId, groupBy = 'day' }
) {
  const match = {
    schoolId: toObjectId(schoolId),
    date: { $gte: startDate, $lte: endDate },
  };
  if (classId) match.classId = toObjectId(classId);

  // Build the grouping expression based on the date string (stored as 'YYYY-MM-DD')
  let periodExpr;
  if (groupBy === 'month') {
    // First 7 chars: 'YYYY-MM'
    periodExpr = { $substr: ['$date', 0, 7] };
  } else if (groupBy === 'week') {
    // ISO week: aggregate pipeline doesn't have direct week-of-year on strings,
    // so we convert the date string to a Date object and use $isoWeek/$isoWeekYear
    periodExpr = {
      $concat: [
        { $toString: { $isoWeekYear: { $dateFromString: { dateString: '$date' } } } },
        '-W',
        {
          $cond: [
            { $lt: [{ $isoWeek: { $dateFromString: { dateString: '$date' } } }, 10] },
            {
              $concat: [
                '0',
                { $toString: { $isoWeek: { $dateFromString: { dateString: '$date' } } } },
              ],
            },
            { $toString: { $isoWeek: { $dateFromString: { dateString: '$date' } } } },
          ],
        },
      ],
    };
  } else {
    // day: use the date string as-is
    periodExpr = '$date';
  }

  const results = await Attendance.aggregate([
    { $match: match },
    {
      $group: {
        _id: periodExpr,
        present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
        absent: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
        late: { $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] } },
        leave: { $sum: { $cond: [{ $eq: ['$status', 'leave'] }, 1, 0] } },
        halfday: { $sum: { $cond: [{ $eq: ['$status', 'halfday'] }, 1, 0] } },
        total: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return results.map((r) => ({
    period: r._id,
    present: r.present,
    absent: r.absent,
    late: r.late,
    leave: r.leave,
    halfday: r.halfday,
    total: r.total,
    rate: r.total > 0 ? Number((((r.present + r.late) / r.total) * 100).toFixed(1)) : 0,
  }));
}

/**
 * Late arrivals report.
 */
export async function getLateArrivalsReport(schoolId, { startDate, endDate, classId }) {
  const match = {
    schoolId: toObjectId(schoolId),
    date: { $gte: startDate, $lte: endDate },
    status: 'late',
  };
  if (classId) match.classId = toObjectId(classId);

  return Attendance.find(match)
    .populate('studentId', 'name rollNo admissionId')
    .populate('classId', 'name section')
    .sort({ date: -1 })
    .select('studentId classId date status');
}

// ─── STAFF REPORTS ───────────────────────────────────────────────────────────

/**
 * Staff attendance summary for a date range (optionally filtered by department).
 */
export async function getStaffAttendanceSummary(schoolId, { startDate, endDate, department }) {
  const records = await StaffAttendance.aggregate([
    {
      $match: {
        schoolId: toObjectId(schoolId),
        date: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: '$staffId',
        present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
        absent: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
        late: { $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] } },
        leave: { $sum: { $cond: [{ $eq: ['$status', 'leave'] }, 1, 0] } },
        halfday: { $sum: { $cond: [{ $eq: ['$status', 'halfday'] }, 1, 0] } },
        total: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: 'staffs',
        localField: '_id',
        foreignField: '_id',
        as: 'staff',
        pipeline: [{ $project: { name: 1, designation: 1, department: 1 } }],
      },
    },
    { $unwind: { path: '$staff', preserveNullAndEmptyArrays: true } },
  ]);

  let result = records.map((r) => ({
    staffId: r._id,
    staffName: r.staff?.name,
    designation: r.staff?.designation,
    department: r.staff?.department,
    present: r.present,
    absent: r.absent,
    late: r.late,
    leave: r.leave,
    halfday: r.halfday,
    total: r.total,
    attendanceRate: r.total > 0 ? Number((((r.present + r.late) / r.total) * 100).toFixed(2)) : 0,
  }));

  if (department) {
    result = result.filter((r) => r.department === department);
  }

  return result;
}

/**
 * Payroll summary grouped by month/year for a school.
 * Scoped by schoolId on PayrollRecord first, then joins Staff for metadata.
 */
export async function getPayrollSummary(schoolId, { month, year }) {
  const match = { schoolId: toObjectId(schoolId) };
  if (month) match.month = month;
  if (year) match.year = year;

  return PayrollRecord.aggregate([
    { $match: match },
    {
      $lookup: {
        from: 'staffs',
        localField: 'employeeId',
        foreignField: '_id',
        as: 'staff',
        pipeline: [
          {
            $match: {
              isDeleted: { $ne: true },
            },
          },
          { $project: { name: 1, designation: 1, department: 1 } },
        ],
      },
    },
    // Inner join: only keep records where staff still exists and is not deleted
    { $match: { 'staff.0': { $exists: true } } },
    { $unwind: '$staff' },
    {
      $group: {
        _id: { month: '$month', year: '$year' },
        totalGrossPay: { $sum: '$grossPay' },
        totalNetPay: { $sum: '$netPay' },
        totalDeductions: { $sum: '$totalDeductions' },
        totalAllowances: { $sum: '$totalAllowances' },
        employeeCount: { $sum: 1 },
        paid: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $eq: ['$status', 'generated'] }, 1, 0] } },
      },
    },
    { $sort: { '_id.year': -1, '_id.month': -1 } },
  ]);
}

/**
 * Department-wise active staff count.
 */
export async function getStaffCountByDepartment(schoolId) {
  return Staff.aggregate([
    {
      $match: {
        schoolId: toObjectId(schoolId),
        isDeleted: { $ne: true },
        status: 'active',
      },
    },
    {
      $group: {
        _id: { $ifNull: ['$department', 'Unassigned'] },
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
  ]);
}

// ─── OPERATIONAL REPORTS ─────────────────────────────────────────────────────

/**
 * New admissions grouped by month.
 */
export async function getAdmissionsReport(schoolId, { academicYear, startDate, endDate }) {
  const match = {
    schoolId: toObjectId(schoolId),
    isDeleted: { $ne: true },
  };
  if (academicYear) match.academicYear = academicYear;
  if (startDate || endDate) {
    match.createdAt = {};
    if (startDate) match.createdAt.$gte = new Date(startDate);
    if (endDate) match.createdAt.$lte = new Date(`${endDate}T23:59:59`);
  }

  return Student.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
        },
        count: { $sum: 1 },
        male: { $sum: { $cond: [{ $eq: ['$gender', 'Male'] }, 1, 0] } },
        female: { $sum: { $cond: [{ $eq: ['$gender', 'Female'] }, 1, 0] } },
      },
    },
    { $sort: { '_id.year': 1, '_id.month': 1 } },
  ]);
}

/**
 * Student strength by class and section.
 */
export async function getStudentStrength(schoolId, { academicYear }) {
  const match = {
    schoolId: toObjectId(schoolId),
    isDeleted: { $ne: true },
    status: 'active',
  };
  if (academicYear) match.academicYear = academicYear;

  const results = await Student.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$classId',
        total: { $sum: 1 },
        male: { $sum: { $cond: [{ $eq: ['$gender', 'Male'] }, 1, 0] } },
        female: { $sum: { $cond: [{ $eq: ['$gender', 'Female'] }, 1, 0] } },
      },
    },
    {
      $lookup: {
        from: 'classes',
        localField: '_id',
        foreignField: '_id',
        as: 'class',
        pipeline: [{ $project: { name: 1, section: 1, strengthLimit: 1 } }],
      },
    },
    { $unwind: { path: '$class', preserveNullAndEmptyArrays: true } },
    { $sort: { 'class.name': 1, 'class.section': 1 } },
  ]);

  return results.map((r) => ({
    classId: r._id,
    className: r.class?.name,
    classSection: r.class?.section,
    strengthLimit: r.class?.strengthLimit?.current,
    total: r.total,
    male: r.male,
    female: r.female,
    occupancyRate: r.class?.strengthLimit?.current
      ? Number(((r.total / r.class.strengthLimit.current) * 100).toFixed(1))
      : null,
  }));
}

/**
 * TC (Transfer Certificate) issued — students with status 'transferred'.
 */
export async function getTCIssuedReport(schoolId, { academicYear, startDate, endDate }) {
  const match = {
    schoolId: toObjectId(schoolId),
    status: 'transferred',
  };
  if (academicYear) match.academicYear = academicYear;
  if (startDate || endDate) {
    match.deletedAt = {};
    if (startDate) match.deletedAt.$gte = new Date(startDate);
    if (endDate) match.deletedAt.$lte = new Date(`${endDate}T23:59:59`);
  }

  return Student.find(match)
    .populate('classId', 'name section')
    .select('name admissionId tcNumber classId academicYear status deletedAt gender')
    .sort({ deletedAt: -1 });
}

/**
 * Visitor log summary with purpose breakdown.
 */
export async function getVisitorLogSummary(schoolId, { startDate, endDate }) {
  const match = { schoolId: toObjectId(schoolId) };
  if (startDate || endDate) {
    match.checkInTime = {};
    if (startDate) match.checkInTime.$gte = new Date(startDate);
    if (endDate) match.checkInTime.$lte = new Date(`${endDate}T23:59:59`);
  }

  const [summary, byPurpose, recentVisitors] = await Promise.all([
    Visitor.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$status', 'ACTIVE'] }, 1, 0] } },
          checkedOut: { $sum: { $cond: [{ $eq: ['$status', 'CHECKED_OUT'] }, 1, 0] } },
        },
      },
    ]),
    Visitor.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $ifNull: ['$reasonForVisit', '$purpose'] },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]),
    Visitor.find(match)
      .sort({ checkInTime: -1 })
      .limit(50)
      .select('visitorName phoneNumber reasonForVisit checkInTime checkOutTime status')
      .lean(),
  ]);

  return {
    summary: summary[0] || { total: 0, active: 0, checkedOut: 0 },
    byPurpose,
    recentVisitors,
  };
}

// ─── DASHBOARD METRICS ───────────────────────────────────────────────────────

/**
 * Key metrics for the reports dashboard widget.
 */
export async function getDashboardMetrics(schoolId, { academicYear }) {
  const schoolObjId = toObjectId(schoolId);
  const ay = academicYear || CURRENT_ACADEMIC_YEAR;
  const today = new Date().toISOString().split('T')[0];
  const monthStart = `${today.substring(0, 7)}-01`;

  const [totalStudents, totalStaff, todayAttendance, monthlyFeeCollection, pendingFees] =
    await Promise.all([
      Student.countDocuments({
        schoolId: schoolObjId,
        academicYear: ay,
        isDeleted: { $ne: true },
        status: 'active',
      }),
      Staff.countDocuments({
        schoolId: schoolObjId,
        isDeleted: { $ne: true },
        status: 'active',
      }),
      Attendance.aggregate([
        { $match: { schoolId: schoolObjId, date: today } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
            late: { $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] } },
            absent: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
          },
        },
      ]),
      FeePayment.aggregate([
        {
          $match: {
            schoolId: schoolObjId,
            academicYear: ay,
            status: 'completed',
            paymentDate: { $gte: monthStart, $lte: today },
            isDeleted: { $ne: true },
          },
        },
        {
          $group: {
            _id: null,
            totalCollected: { $sum: '$amount' },
            transactionCount: { $sum: 1 },
          },
        },
      ]),
      StudentFeeStructure.aggregate([
        {
          $match: {
            schoolId: schoolObjId,
            academicYear: ay,
            overallStatus: { $in: ['pending', 'partial'] },
            isDeleted: { $ne: true },
          },
        },
        {
          $group: {
            _id: null,
            totalPending: { $sum: '$totalBalance' },
            studentCount: { $sum: 1 },
          },
        },
      ]),
    ]);

  const attData = todayAttendance[0] || { total: 0, present: 0, late: 0, absent: 0 };
  const feeData = monthlyFeeCollection[0] || { totalCollected: 0, transactionCount: 0 };
  const pendingData = pendingFees[0] || { totalPending: 0, studentCount: 0 };

  return {
    academicYear: ay,
    students: {
      total: totalStudents,
      todayPresent: attData.present,
      todayAbsent: attData.absent,
      todayAttendanceRate:
        attData.total > 0
          ? Number((((attData.present + attData.late) / attData.total) * 100).toFixed(1))
          : null,
    },
    staff: {
      total: totalStaff,
    },
    fees: {
      monthlyCollected: feeData.totalCollected,
      monthlyTransactions: feeData.transactionCount,
      pendingAmount: pendingData.totalPending,
      pendingStudents: pendingData.studentCount,
    },
  };
}
