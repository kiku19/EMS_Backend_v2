import express from 'express';
const router = express.Router();
router.use(authenticate);
import PayrollRun from '../models/PayrollRun.js';
import PayrollRecord from '../models/PayrollRecord.js';
import Payslip from '../models/Payslip.js';
import SalaryAdjustment from '../models/SalaryAdjustment.js';
import PayrollAuditLog from '../models/PayrollAuditLog.js';
import TeacherLeave from '../models/TeacherLeave.js';
import StaffAttendance from '../models/StaffAttendance.js';
import SchoolSettings from '../models/SchoolSettings.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission, userHasPermission } from '../middleware/permissions.js';
import { sanitizeQueryStr, sanitizeQueryId } from '../middleware/validation.js';
import { escapeRegex } from './students/helpers.js';
import { validateZod } from '../validators/zodHelpers.js';
import {
  bulkPaySchema,
  markAsPaidSchema,
  reversePaymentSchema,
  runPayrollSchema,
  updatePayrollRecordSchema,
  validatePayrollSchema,
  createSalaryAdjustmentSchema,
  employeeAdjustmentParamsSchema,
  payslipParamsSchema,
  payrollRecordParamsSchema,
  salaryAdjustmentParamsSchema,
  updateSalaryAdjustmentSchema,
} from '../validators/payrollSchema.js';
import mongoose from 'mongoose';

// Get Staff model from database.js
const Staff = mongoose.model('Staff');

// Map any Staff.employmentType value (free String — may be a legacy display
// string like "Full-time" or already an enum value) to a valid
// PayrollRecord.employmentType enum value. Unknown values default to
// full_time so a payroll run never throws ValidationError on old/odd data.
// See C8 + EMS-backend/models/PayrollRecord.js enum.
const EMPLOYMENT_TYPE_ALIASES = {
  full_time: 'full_time',
  fulltime: 'full_time',
  'full-time': 'full_time',
  permanent: 'full_time',
  part_time: 'part_time',
  parttime: 'part_time',
  'part-time': 'part_time',
  contractor: 'contractor',
  contract: 'contractor',
  consultancy: 'contractor',
};
function normalizeEmploymentType(raw) {
  if (!raw) return 'full_time';
  const key = String(raw).trim().toLowerCase().replace(/\s+/g, '_');
  return EMPLOYMENT_TYPE_ALIASES[key] || 'full_time';
}

// Staff.salary is the canonical monthly payroll amount. The breakdown fallback
// keeps legacy template-assigned profiles usable until they are next saved,
// at which point the dashboard writes the same total back to Staff.salary.
function resolveStaffMonthlySalary(employee) {
  const configured = Number(employee?.salary);
  if (Number.isFinite(configured) && configured > 0) return configured;
  const templateTotal = (employee?.salaryBreakdown || []).reduce(
    (sum, component) => sum + (Number(component?.amount) || 0),
    0
  );
  if (templateTotal > 0) return templateTotal;
  return Number.isFinite(configured) && configured >= 0 ? configured : 0;
}

// P4: Expand Staff.salaryBreakdown (and the linked SalaryTemplate shape) into
// payroll components. Staff.salaryBreakdown / SalaryTemplate.breakdown is a flat
// `[{ component: String, amount: Number }]` list with NO earning/deduction type
// discriminator, so we classify by the component name: known statutory /
// deduction keywords become deductions, everything else is treated as an
// earning. Of the earnings, a component named "Basic" (the convention) becomes
// the record's baseSalary; the remaining earnings become allowances. This lets
// a salary structure defined as components flow through to the payslip instead
// of being collapsed into a single flat baseSalary number.
//
// Returns { baseSalary, allowances, deductions } where allowances/deductions
// are arrays of { type, amount, description }. Returns null when no usable
// breakdown exists, so the caller falls back to the flat Staff.salary path.
const BASIC_COMPONENT_ALIASES = new Set(['basic', 'basic salary', 'basic pay', 'basic wages']);
const DEDUCTION_KEYWORDS = [
  'pf',
  'provident fund',
  'epf',
  'esi',
  'esic',
  'tds',
  'tax',
  'income tax',
  'professional tax',
  'pt ',
  ' loan',
  'advance',
  'deduction',
];
function isDeductionComponent(name) {
  const lower = String(name || '')
    .trim()
    .toLowerCase();
  return DEDUCTION_KEYWORDS.some((kw) => lower === kw.trim() || lower.includes(kw));
}
function expandSalaryBreakdown(employee) {
  const breakdown = employee?.salaryBreakdown;
  if (!Array.isArray(breakdown) || breakdown.length === 0) return null;

  let baseSalary = 0;
  const allowances = [];
  const deductions = [];
  let hasBasic = false;

  for (const item of breakdown) {
    const name = String(item?.component || '').trim();
    const amount = Number(item?.amount) || 0;
    if (!name || amount === 0) continue;

    if (isDeductionComponent(name)) {
      deductions.push({
        type: name,
        amount: Math.abs(amount),
        description: 'Salary structure component',
      });
      continue;
    }

    if (!hasBasic && BASIC_COMPONENT_ALIASES.has(name.toLowerCase())) {
      baseSalary = amount;
      hasBasic = true;
      continue;
    }

    allowances.push({
      type: name,
      amount: Math.abs(amount),
      description: 'Salary structure component',
    });
  }

  // If the structure had no explicit "Basic", fall back to the sum of earnings
  // being treated as baseSalary so the gross math still balances. Earnings that
  // we cannot bucket as Basic collapse into a single baseSalary figure
  // (allowances stays empty) to avoid double-counting against the gross.
  if (!hasBasic) {
    const earningsTotal = baseSalary + allowances.reduce((s, a) => s + a.amount, 0);
    if (earningsTotal <= 0) return null;
    return {
      baseSalary: Math.round(earningsTotal * 100) / 100,
      allowances: [],
      deductions,
      __source: 'breakdown-no-basic',
    };
  }

  return {
    baseSalary: Math.round(baseSalary * 100) / 100,
    allowances,
    deductions,
    __source: 'breakdown',
  };
}

const PAYROLL_LOCK_DURATION_MS = 30 * 60 * 1000;

class PayrollRunLockedError extends Error {
  constructor(lockedBy = null) {
    super('Payroll is currently being processed by another request');
    this.name = 'PayrollRunLockedError';
    this.status = 409;
    this.lockedBy = lockedBy;
  }
}

async function acquirePayrollRunLock({ schoolId, month, year, userId, totalEmployees }) {
  const now = new Date();
  const lockToken = new mongoose.Types.ObjectId().toString();
  const lockFields = {
    status: 'processing',
    runDate: now,
    totalEmployees,
    isProcessing: true,
    processingLockExpiresAt: new Date(now.getTime() + PAYROLL_LOCK_DURATION_MS),
    processingLockedBy: userId,
    processingLockToken: lockToken,
    runBy: userId,
  };

  // Return the pre-lock document so completed/partial rerun rules are checked
  // against the state that existed before this request acquired ownership.
  const previousRun = await PayrollRun.findOneAndUpdate(
    {
      schoolId,
      month,
      year,
      $or: [{ isProcessing: { $ne: true } }, { processingLockExpiresAt: { $lte: now } }],
    },
    { $set: lockFields },
    { new: false }
  ).select('+processingLockToken');

  if (previousRun) {
    const payrollRun = await PayrollRun.findOne({
      _id: previousRun._id,
      processingLockToken: lockToken,
    }).select('+processingLockToken');
    if (!payrollRun) throw new PayrollRunLockedError();
    return { payrollRun, lockToken, previousStatus: previousRun.status };
  }

  try {
    const payrollRun = await PayrollRun.create({
      schoolId,
      month,
      year,
      ...lockFields,
    });
    return { payrollRun, lockToken, previousStatus: null };
  } catch (error) {
    // A unique {schoolId, month, year} collision means another request won
    // the first-run race after our atomic update found no existing document.
    if (error?.code === 11000) {
      const winner = await PayrollRun.findOne({ schoolId, month, year }).lean();
      throw new PayrollRunLockedError(winner?.processingLockedBy || null);
    }
    throw error;
  }
}

async function releasePayrollRunLock({
  payrollRunId,
  lockToken,
  status,
  completedAt,
  processedEmployees,
  failedEmployees,
  errorLog,
}) {
  const set = {
    isProcessing: false,
    processingLockExpiresAt: null,
    processingLockedBy: null,
    processingLockToken: null,
    status,
  };
  if (completedAt !== undefined) set.completedAt = completedAt;
  if (processedEmployees !== undefined) set.processedEmployees = processedEmployees;
  if (failedEmployees !== undefined) set.failedEmployees = failedEmployees;
  if (errorLog !== undefined) set.errorLog = errorLog;

  return PayrollRun.findOneAndUpdate(
    { _id: payrollRunId, processingLockToken: lockToken, isProcessing: true },
    { $set: set },
    { new: true }
  );
}

async function refreshPayrollRunLock(payrollRunId, lockToken) {
  const result = await PayrollRun.updateOne(
    { _id: payrollRunId, processingLockToken: lockToken, isProcessing: true },
    { $set: { processingLockExpiresAt: new Date(Date.now() + PAYROLL_LOCK_DURATION_MS) } }
  );
  if (result.matchedCount !== 1) {
    throw new PayrollRunLockedError();
  }
}

async function syncPayrollRunTotals(schoolId, month, year) {
  const [summary] = await PayrollRecord.aggregate([
    { $match: { schoolId: new mongoose.Types.ObjectId(String(schoolId)), month, year } },
    {
      $group: {
        _id: null,
        totalAmount: { $sum: '$netPay' },
        totalPaid: {
          $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$netPay', 0] },
        },
        totalPending: {
          $sum: { $cond: [{ $in: ['$status', ['generated', 'on_hold']] }, '$netPay', 0] },
        },
        processedEmployees: { $sum: 1 },
      },
    },
  ]);

  return PayrollRun.findOneAndUpdate(
    { schoolId, month, year },
    {
      $set: {
        totalAmount: summary?.totalAmount || 0,
        totalPaid: summary?.totalPaid || 0,
        totalPending: summary?.totalPending || 0,
        processedEmployees: summary?.processedEmployees || 0,
      },
    },
    { new: true }
  );
}

// ALL PAYROLL ROUTES PROTECTED - Contains sensitive salary data!

// Helper function to log audit entries
async function logAudit({
  schoolId,
  entityType,
  entityId,
  action,
  performedBy,
  changes,
  context,
  ipAddress,
  userAgent,
  status,
  errorMessage,
}) {
  try {
    const log = new PayrollAuditLog({
      schoolId,
      entityType,
      entityId,
      action,
      performedBy,
      changes,
      context,
      ipAddress,
      userAgent,
      status,
      errorMessage,
    });
    await log.save();
  } catch (error) {
    console.error('Failed to create audit log:', error);
  }
}

// Validate month is not in the future, using the school's local timezone
// (defaults to Asia/Kolkata). Using new Date() directly rejected legitimate
// end-of-month payroll runs near midnight in timezones ahead of server UTC.
function validateNotFutureMonth(month, year) {
  const tz = process.env.DEFAULT_SCHOOL_TIMEZONE || 'Asia/Kolkata';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const currentYear = parseInt(get('year'), 10);
  const currentMonth = parseInt(get('month'), 10);

  if (year > currentYear) return false;
  if (year === currentYear && month > currentMonth) return false;
  return true;
}

const DEFAULT_WORKING_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_CODES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dateKey(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function buildPayrollCalendar(settings, month, year) {
  const configuredWorkingDays = settings?.workingDays?.length
    ? settings.workingDays
    : DEFAULT_WORKING_DAYS;
  const workingDays = new Set(configuredWorkingDays);
  const holidayDates = new Set(
    (settings?.holidays || []).map((holiday) => String(holiday.date).slice(0, 10))
  );
  const workingDateKeys = new Set();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(Date.UTC(year, month - 1, day));
    const dayCode = DAY_CODES[date.getUTCDay()];
    const key = dateKey(year, month, day);
    const saturdayNumber = dayCode === 'Sat' ? Math.ceil(day / 7) : null;
    const isAlternatingSaturdayOff =
      settings?.secondFourthSaturdayOff &&
      dayCode === 'Sat' &&
      (saturdayNumber === 2 || saturdayNumber === 4);

    if (workingDays.has(dayCode) && !isAlternatingSaturdayOff && !holidayDates.has(key)) {
      workingDateKeys.add(key);
    }
  }

  return {
    workingDateKeys,
    workingDayCount: workingDateKeys.size,
    unpaidLeaveTypes: new Set(
      (settings?.leaveTypes || [])
        .filter((leaveType) => leaveType.paid === false)
        .map((leaveType) => String(leaveType.name).trim().toLowerCase())
    ),
  };
}

function isUnpaidLeaveType(leaveType, unpaidLeaveTypes) {
  const normalized = String(leaveType || '')
    .trim()
    .toLowerCase();
  return normalized === 'unpaid' || unpaidLeaveTypes.has(normalized);
}

function groupByEmployee(documents, field) {
  const grouped = new Map();
  for (const document of documents) {
    const key = String(document[field]);
    const items = grouped.get(key) || [];
    items.push(document);
    grouped.set(key, items);
  }
  return grouped;
}

function countUnpaidWorkingLeaveDays(leaves, month, year, payrollCalendar) {
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  const unpaidWorkingDates = new Set();

  for (const leave of leaves) {
    if (!isUnpaidLeaveType(leave.leaveType, payrollCalendar.unpaidLeaveTypes)) continue;
    const effectiveStart = leave.startDate < monthStart ? monthStart : leave.startDate;
    const effectiveEnd = leave.endDate > monthEnd ? monthEnd : leave.endDate;
    const cursor = new Date(
      Date.UTC(
        effectiveStart.getUTCFullYear(),
        effectiveStart.getUTCMonth(),
        effectiveStart.getUTCDate()
      )
    );
    const end = new Date(
      Date.UTC(effectiveEnd.getUTCFullYear(), effectiveEnd.getUTCMonth(), effectiveEnd.getUTCDate())
    );

    while (cursor <= end) {
      const key = dateKey(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate());
      if (payrollCalendar.workingDateKeys.has(key)) unpaidWorkingDates.add(key);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  return unpaidWorkingDates.size;
}

function summarizeAttendance(records, workingDateKeys) {
  const summary = { present: 0, absent: 0, leave: 0, halfday: 0, total: 0 };
  for (const record of records) {
    if (!workingDateKeys.has(record.date)) continue;
    summary.total += 1;
    if (summary[record.status] !== undefined) summary[record.status] += 1;
  }
  return summary;
}

// P8: Shared per-employee payroll computation. Both the /run loop and
// recomputeLOPForStaff() call this so leave/attendance-based (LOP) math stays
// identical between an initial run and a post-attendance-change recompute.
//
// Inputs are the already-loaded slices for ONE employee:
//   - employee       : Staff doc (needs salary/salaryBreakdown/employmentType)
//   - adjustments    : SalaryAdjustment[] (type 'allowance' | 'deduction')
//   - leaves         : TeacherLeave[] (approved)
//   - attendanceDocs : StaffAttendance[] for the period
//   - payrollCalendar: from buildPayrollCalendar()
//   - month, year    : the period
// Returns { baseSalary, allowances, deductions, totalAllowances,
//           totalDeductions, grossPay, netPay } or throws if netPay < 0.
function computeEmployeeComponents({
  employee,
  adjustments = [],
  leaves = [],
  attendanceDocs = [],
  payrollCalendar,
  month,
  year,
}) {
  const expanded = expandSalaryBreakdown(employee);
  const configuredSalary = resolveStaffMonthlySalary(employee);
  const baseSalary = expanded ? expanded.baseSalary : configuredSalary;

  const allowances = expanded ? expanded.allowances.slice() : [];
  for (const a of adjustments) {
    if (a.type === 'allowance') {
      allowances.push({ type: a.category, amount: a.amount, description: a.description });
    }
  }

  const deductions = expanded ? expanded.deductions.slice() : [];
  for (const a of adjustments) {
    if (a.type === 'deduction') {
      deductions.push({ type: a.category, amount: a.amount, description: a.description });
    }
  }

  const dailyRate = Math.round((baseSalary / (payrollCalendar.workingDayCount || 1)) * 100) / 100;

  // 1. Leave deductions (LOP) from approved unpaid leaves.
  const hasManualLeaveDeduction = deductions.some(
    (d) =>
      String(d.type || '')
        .trim()
        .toLowerCase() === 'leave deduction'
  );
  if (!hasManualLeaveDeduction) {
    const leaveDays = countUnpaidWorkingLeaveDays(leaves, month, year, payrollCalendar);
    if (leaveDays > 0) {
      const leaveAmount = Math.round(dailyRate * leaveDays * 100) / 100;
      deductions.push({
        type: 'Leave Deduction',
        amount: leaveAmount,
        description: `${leaveDays} unpaid working leave day(s) @ ${dailyRate.toFixed(2)}/day`,
      });
    }
  }

  // 2. Part-time attendance-based deductions + overtime.
  if (normalizeEmploymentType(employee.employmentType) === 'part_time') {
    const attendance = summarizeAttendance(attendanceDocs, payrollCalendar.workingDateKeys);
    if (attendance.total > 0) {
      const absentDays = attendance.absent;
      if (absentDays > 0) {
        const hasManualAbsentDeduction = deductions.some(
          (d) =>
            String(d.type || '')
              .trim()
              .toLowerCase() === 'absent deduction'
        );
        if (!hasManualAbsentDeduction) {
          const absentAmount = Math.round(dailyRate * absentDays * 100) / 100;
          deductions.push({
            type: 'Absent Deduction',
            amount: absentAmount,
            description: `Part-time: ${absentDays} absent day(s) @ ${dailyRate.toFixed(2)}/day`,
          });
        }
      }

      const halfdayCount = attendance.halfday;
      if (halfdayCount > 0) {
        const halfdayAmount = Math.round(dailyRate * 0.5 * halfdayCount * 100) / 100;
        deductions.push({
          type: 'Half-day Deduction',
          amount: halfdayAmount,
          description: `Part-time: ${halfdayCount} half-day(s) @ ${(dailyRate * 0.5).toFixed(2)}/day`,
        });
      }

      const overtimeRate = dailyRate * 1.5;
      const expectedWorkingDays = payrollCalendar.workingDayCount || 0;
      const actualWorkedDays = attendance.present + attendance.halfday * 0.5;
      if (actualWorkedDays > expectedWorkingDays && expectedWorkingDays > 0) {
        const overtimeDays = actualWorkedDays - expectedWorkingDays;
        const overtimeAmount = Math.round(overtimeRate * overtimeDays * 100) / 100;
        const hasManualOvertime = allowances.some((a) =>
          String(a.type || '')
            .toLowerCase()
            .includes('overtime')
        );
        if (!hasManualOvertime) {
          allowances.push({
            type: 'Overtime',
            amount: overtimeAmount,
            description: `Part-time: ${overtimeDays} overtime day(s) @ ${overtimeRate.toFixed(2)}/day (1.5x)`,
          });
        }
      }
    }
  }

  const totalAllowances = allowances.reduce((sum, a) => sum + a.amount, 0);
  const totalDeductions = deductions.reduce((sum, d) => sum + d.amount, 0);
  const grossPay = baseSalary + totalAllowances;
  const netPay = grossPay - totalDeductions;
  if (netPay < 0) {
    const err = new Error(`Deductions (${totalDeductions}) exceed gross pay (${grossPay})`);
    err.code = 'NEGATIVE_NET_PAY';
    throw err;
  }

  return {
    baseSalary,
    allowances,
    deductions,
    totalAllowances,
    totalDeductions,
    grossPay,
    netPay,
  };
}

// P8: Recompute LOP (and the rest of the auto-derived components) for a single
// employee+period AFTER attendance or leaves have changed following a payroll
// run. This is the payroll half of the cross-agent P8 follow-up: the
// staffAttendance / teacherLeaves agents should invoke this (or the internal
// /recompute-lop endpoint below) when they mutate data that affects an already
// generated PayrollRecord. It refuses to touch locked/paid records.
// Returns the updated record or null if no record / record locked.
// `performedBy` (optional ObjectId) is stamped on the audit entry; when omitted
// (e.g. an in-process call from the attendance/leave routes without a user
// context) the recomputed employee's own id is recorded so the audit row still
// satisfies the schema's required-field constraint and is traceable.
async function recomputeLOPForStaff(employeeId, month, year, { schoolId, performedBy } = {}) {
  if (!employeeId || !month || !year || !schoolId) {
    throw new Error('recomputeLOPForStaff requires employeeId, month, year, schoolId');
  }

  const record = await PayrollRecord.findOne({ schoolId, employeeId, month, year });
  if (!record) return null;
  // Never silently rewrite a paid/locked record — that would alter bank-statement
  // history. The caller must reverse the payment first, then recompute.
  if (record.isLocked || record.status === 'paid') {
    return { skipped: 'record_is_paid_or_locked', record };
  }

  const schoolSettings = await SchoolSettings.findOne({ schoolId }).lean();
  const payrollCalendar = buildPayrollCalendar(schoolSettings, month, year);
  if (payrollCalendar.workingDayCount === 0) {
    return { skipped: 'no_working_days_configured', record };
  }

  const employee = await Staff.findOne(
    { _id: employeeId, schoolId },
    'name salary salaryBreakdown employmentType _id code'
  ).lean();
  if (!employee) return null;

  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;

  const [adjustments, leaves, attendance] = await Promise.all([
    SalaryAdjustment.find({
      schoolId,
      employeeId,
      isActive: true,
      $or: [
        { isRecurring: { $ne: true }, effectiveMonth: month, effectiveYear: year },
        {
          isRecurring: true,
          $or: [
            { effectiveYear: { $lt: year } },
            { effectiveYear: year, effectiveMonth: { $lte: month } },
          ],
        },
      ],
    }).lean(),
    TeacherLeave.find({
      schoolId,
      teacherId: employeeId,
      status: 'approved',
      startDate: { $lte: monthEnd },
      endDate: { $gte: monthStart },
    }).lean(),
    StaffAttendance.find({
      schoolId,
      staffId: employeeId,
      date: { $regex: `^${monthPrefix}` },
    }).lean(),
  ]);

  const computed = computeEmployeeComponents({
    employee,
    adjustments,
    leaves,
    attendanceDocs: attendance,
    payrollCalendar,
    month,
    year,
  });

  record.baseSalary = computed.baseSalary;
  record.allowances = computed.allowances;
  record.deductions = computed.deductions;
  record.totalAllowances = computed.totalAllowances;
  record.totalDeductions = computed.totalDeductions;
  record.grossPay = computed.grossPay;
  record.netPay = computed.netPay;
  record.employmentType = normalizeEmploymentType(employee.employmentType);
  // Recompute keeps the record in 'generated' (still unpaid). status unchanged
  // if it was already generated/on_hold.
  await record.save();
  await syncPayrollRunTotals(schoolId, month, year);

  await logAudit({
    schoolId,
    entityType: 'PayrollRecord',
    entityId: record._id,
    action: 'record_lop_recomputed',
    performedBy: performedBy || employeeId,
    context: { month, year, employeeId, trigger: 'attendance_or_leave_change' },
    status: 'success',
  });

  return record;
}

// Get payroll dashboard KPIs
router.get('/dashboard/:month/:year', checkPermission('payroll', 'view'), async (req, res) => {
  try {
    const { month, year } = req.params;
    const monthNum = parseInt(month);
    const yearNum = parseInt(year);

    const schoolId = req.user.schoolId;

    // Get current month's payroll run
    const payrollRun = await PayrollRun.findOne({ schoolId, month: monthNum, year: yearNum });

    // Get all payroll records for the month
    const records = await PayrollRecord.find({ schoolId, month: monthNum, year: yearNum });

    // Calculate KPIs
    const totalPayout = records.reduce((sum, r) => sum + (r.status === 'paid' ? r.netPay : 0), 0);
    // "Pending" must mirror syncPayrollRunTotals (generated + on_hold). The
    // previous status === 'generated' filter counted on_hold records as unpaid
    // (excluded from totalPayout) but NOT pending, so a held payout vanished
    // from every KPI and the dashboard understated the outstanding amount.
    const pendingStatuses = ['generated', 'on_hold'];
    const pendingAmount = records.reduce(
      (sum, r) => sum + (pendingStatuses.includes(r.status) ? r.netPay : 0),
      0
    );
    const pendingCount = records.filter((r) => pendingStatuses.includes(r.status)).length;
    const paidCount = records.filter((r) => r.status === 'paid').length;
    const unpaidCount = records.filter((r) => r.status !== 'paid').length;
    const totalEmployees = records.length;
    const completionPercentage =
      totalEmployees > 0 ? Math.round((paidCount / totalEmployees) * 100) : 0;

    // Next payroll date (1st of next month)
    const nextMonth = monthNum === 12 ? 1 : monthNum + 1;
    const nextYear = monthNum === 12 ? yearNum + 1 : yearNum;
    const nextPayrollDate = new Date(nextYear, nextMonth - 1, 1);

    // Projected payout (next month - estimate based on current active employees)
    const projectedPayout = records.reduce((sum, r) => sum + r.netPay, 0);

    // Aggregate deductions and allowances by type across all records
    const deductionBreakdown = {};
    const allowanceBreakdown = {};
    records.forEach((r) => {
      (r.deductions || []).forEach((d) => {
        const key = d.type || 'Other';
        deductionBreakdown[key] = (deductionBreakdown[key] || 0) + (d.amount || 0);
      });
      (r.allowances || []).forEach((a) => {
        const key = a.type || 'Other';
        allowanceBreakdown[key] = (allowanceBreakdown[key] || 0) + (a.amount || 0);
      });
    });
    const totalDeductions = records.reduce((sum, r) => sum + (r.totalDeductions || 0), 0);
    const totalGrossPay = records.reduce((sum, r) => sum + (r.grossPay || 0), 0);

    res.json({
      success: true,
      data: {
        totalPayout,
        projectedPayout,
        nextPayrollDate,
        pendingCount,
        pendingAmount,
        paidCount,
        unpaidCount,
        totalEmployees,
        completionPercentage,
        period: { month: monthNum, year: yearNum },
        totalDeductions,
        totalGrossPay,
        deductionBreakdown,
        allowanceBreakdown,
        payrollRun: payrollRun || null,
      },
    });
  } catch (error) {
    console.error('Error fetching dashboard:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get payroll records with filters
router.get('/records', checkPermission('payroll', 'view'), async (req, res) => {
  try {
    const {
      month,
      year,
      status,
      employmentType,
      minSalary,
      maxSalary,
      search,
      employeeId,
      page = 1,
      limit = 50,
    } = req.query;

    const query = { schoolId: req.user.schoolId };

    if (month) query.month = parseInt(month);
    if (year) query.year = parseInt(year);
    if (status) query.status = status;
    if (employmentType) query.employmentType = employmentType;
    if (minSalary || maxSalary) {
      query.netPay = {};
      if (minSalary) query.netPay.$gte = parseFloat(minSalary);
      if (maxSalary) query.netPay.$lte = parseFloat(maxSalary);
    }
    if (employeeId) query.employeeId = employeeId;
    // `search` historically matched the Staff document's name/code — not
    // PayrollRecord.employeeId (an ObjectId ref). The previous regex assign
    // silently errored or returned nothing. Resolve search → Staff._id first,
    // then filter PayrollRecord by { employeeId: { $in: ... } }.
    if (search) {
      const Staff = req.app.locals.Staff;
      const re = new RegExp(escapeRegex(search), 'i');
      const matchingStaff = await Staff.find({
        schoolId: req.user.schoolId,
        isDeleted: { $ne: true },
        $or: [{ name: re }, { code: re }],
      })
        .select('_id')
        .lean();
      const staffIds = matchingStaff.map((s) => s._id);
      query.employeeId = { $in: staffIds.length ? staffIds : [null] };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const records = await PayrollRecord.find(query)
      .populate('employeeId', 'name role code designation')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await PayrollRecord.countDocuments(query);

    res.json({
      success: true,
      data: records,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Error fetching records:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Pre-run validation - Check before running payroll
router.post(
  '/validate',
  checkPermission('payroll', 'create'),
  validateZod(validatePayrollSchema),
  async (req, res) => {
    try {
      const { month, year, employeeIds } = req.body;

      // Validate month is not in future
      if (!validateNotFutureMonth(month, year)) {
        return res.status(400).json({
          success: false,
          error: req.t('common:routes.cannotRunPayrollForFutureMonths'),
        });
      }

      if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
        return res
          .status(400)
          .json({ success: false, error: req.t('common:routes.noEmployeeIdsProvided') });
      }

      // Validate IDs
      const validIds = employeeIds.filter((id) => mongoose.Types.ObjectId.isValid(id));

      // Fetch staff data
      const staffFromDB = await Staff.find(
        { _id: { $in: validIds }, schoolId: req.user?.schoolId },
        'name salary salaryBreakdown employmentType _id code status'
      );

      const validationResults = {
        valid: [],
        invalid: [],
        warnings: [],
      };

      for (const employee of staffFromDB) {
        const issues = [];

        // Check salary
        const configuredSalary = resolveStaffMonthlySalary(employee);
        if (!configuredSalary) {
          issues.push('Salary not configured or is zero');
          validationResults.invalid.push({
            employeeId: employee._id,
            name: employee.name,
            code: employee.code,
            reason: issues.join(', '),
          });
          continue;
        }

        // Check status
        const status = (employee.status || '').toLowerCase().trim();
        if (status !== 'active' && employee.status) {
          validationResults.warnings.push({
            employeeId: employee._id,
            name: employee.name,
            code: employee.code,
            status: employee.status,
            reason: 'Staff status is not "Active"',
          });
        }

        validationResults.valid.push({
          employeeId: employee._id,
          name: employee.name,
          code: employee.code,
          salary: configuredSalary,
          employmentType: employee.employmentType,
        });
      }

      // Check for existing records
      const existingRecords = await PayrollRecord.find({
        schoolId: req.user.schoolId,
        employeeId: { $in: validIds },
        month,
        year,
      });

      if (existingRecords.length > 0) {
        const paidRecords = existingRecords.filter((r) => r.status === 'paid');
        if (paidRecords.length > 0) {
          validationResults.warnings.push({
            type: 'existing_paid_records',
            count: paidRecords.length,
            message: `${paidRecords.length} records already marked as paid. Re-running will update calculations but payment history will be preserved.`,
          });
        }
      }

      res.json({
        success: true,
        data: validationResults,
      });
    } catch (error) {
      console.error('Error validating payroll:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ─── STATUTORY DEDUCTIONS — KNOWN LIMITATION (P12) ──────────────────────────
// This payroll run does NOT compute statutory/tax deductions automatically.
// TDS (income tax), PF (Provident Fund), ESI, and Professional Tax are NOT
// derived here. They are only applied when an admin creates an explicit
// SalaryAdjustment (type 'deduction') for the employee/period, which is then
// picked up by the `deductions` mapping below. Implementing accurate statutory
// math requires regime-aware rules, statutory declaration data (investments,
// rent, previous-employer income), PF/ESI wage ceilings and per-state PT
// slabs — out of scope for this fix. Treat all statutory deductions as MANUAL
// via SalaryAdjustments until a dedicated tax engine is built.
// Marked: DOCUMENTED (per P12 instructions — do not implement tax math here).
// ─────────────────────────────────────────────────────────────────────────────

// Run payroll for a month - Admin only (CRITICAL)
router.post(
  '/run',
  checkPermission('payroll', 'create'),
  validateZod(runPayrollSchema),
  async (req, res) => {
    let payrollRun = null;
    let payrollLockToken = null;
    let previousRunStatus;
    try {
      const { month, year, employeeIds } = req.body;

      // Validate month is not in future
      if (!validateNotFutureMonth(month, year)) {
        return res.status(400).json({
          success: false,
          error: req.t('common:routes.cannotRunPayrollForFutureMonths'),
        });
      }

      if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
        return res
          .status(400)
          .json({ success: false, error: req.t('common:routes.noEmployeeIdsProvided') });
      }

      // Validate IDs
      const validIds = employeeIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
      if (validIds.length !== employeeIds.length) {
        console.warn(
          `⚠️ Warning: ${employeeIds.length - validIds.length} invalid employee IDs ignored.`
        );
      }

      const schoolId = req.user.schoolId;
      const schoolSettings = await SchoolSettings.findOne({ schoolId }).lean();
      const payrollCalendar = buildPayrollCalendar(schoolSettings, month, year);
      if (payrollCalendar.workingDayCount === 0) {
        return res.status(400).json({
          success: false,
          error: 'Payroll cannot run because this month has no configured working days.',
        });
      }

      ({
        payrollRun,
        lockToken: payrollLockToken,
        previousStatus: previousRunStatus,
      } = await acquirePayrollRunLock({
        schoolId,
        month,
        year,
        userId: req.user._id,
        totalEmployees: validIds.length,
      }));

      // Check if payroll already has paid records (check ALL statuses, not just 'completed')
      if (previousRunStatus) {
        const paidRecords = await PayrollRecord.countDocuments({
          schoolId,
          month,
          year,
          status: 'paid',
        });

        if (paidRecords > 0) {
          await releasePayrollRunLock({
            payrollRunId: payrollRun._id,
            lockToken: payrollLockToken,
            status: previousRunStatus,
          });
          payrollLockToken = null;
          return res.status(400).json({
            success: false,
            error: `Cannot re-run payroll. ${paidRecords} records already marked as paid. Please reverse payments first if needed.`,
            paidRecords,
          });
        }

        // Block re-processing of completed/partial payroll unless explicitly forced
        if (['completed', 'partial'].includes(previousRunStatus) && !req.body.forceRerun) {
          await releasePayrollRunLock({
            payrollRunId: payrollRun._id,
            lockToken: payrollLockToken,
            status: previousRunStatus,
          });
          payrollLockToken = null;
          return res.status(400).json({
            success: false,
            error: `Payroll for this month has already been processed (status: ${previousRunStatus}). Use forceRerun to re-process.`,
            alreadyProcessed: true,
            runStatus: previousRunStatus,
          });
        }
      }

      // FIXED: Fetch staff data from database with salary field.
      // Exclude soft-deleted staff (P7): the Staff agent's delete cascade sets
      // SalaryAdjustment.isActive=false but leaves the staff doc present, so
      // without `isDeleted: { $ne: true }` a deleted employee could be pulled
      // back into a payroll run via an explicit employeeIds payload.
      const staffFromDB = await Staff.find(
        { _id: { $in: validIds }, schoolId: req.user?.schoolId, isDeleted: { $ne: true } },
        'name salary salaryBreakdown employmentType _id code'
      );
      const staffById = new Map(staffFromDB.map((employee) => [String(employee._id), employee]));
      const monthStart = new Date(Date.UTC(year, month - 1, 1));
      const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
      const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
      const [runAdjustments, runLeaves, runAttendance] = await Promise.all([
        SalaryAdjustment.find({
          schoolId,
          employeeId: { $in: validIds },
          isActive: true,
          $or: [
            { isRecurring: { $ne: true }, effectiveMonth: month, effectiveYear: year },
            {
              isRecurring: true,
              $or: [
                { effectiveYear: { $lt: year } },
                { effectiveYear: year, effectiveMonth: { $lte: month } },
              ],
            },
          ],
        }).lean(),
        TeacherLeave.find({
          schoolId,
          teacherId: { $in: validIds },
          status: 'approved',
          startDate: { $lte: monthEnd },
          endDate: { $gte: monthStart },
        }).lean(),
        StaffAttendance.find({
          schoolId,
          staffId: { $in: validIds },
          date: { $regex: `^${monthPrefix}` },
        }).lean(),
      ]);
      const adjustmentsByEmployee = groupByEmployee(runAdjustments, 'employeeId');
      const leavesByEmployee = groupByEmployee(runLeaves, 'teacherId');
      const attendanceByEmployee = groupByEmployee(runAttendance, 'staffId');

      // Log audit
      await logAudit({
        schoolId: req.user.schoolId,
        entityType: 'PayrollRun',
        entityId: payrollRun._id,
        action: 'payroll_run_started',
        performedBy: req.user._id,
        context: { month, year, employeeCount: validIds.length },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status: 'success',
      });

      const results = {
        success: [],
        failed: [],
      };

      // Process each employee
      for (const [employeeIndex, empId] of validIds.entries()) {
        try {
          // Long payrolls renew ownership periodically. A request that has lost
          // its token stops before it can mutate any further financial records.
          if (employeeIndex > 0 && employeeIndex % 25 === 0) {
            await refreshPayrollRunLock(payrollRun._id, payrollLockToken);
          }
          // FIXED: Use staff data from database
          const employee = staffById.get(String(empId));

          if (!employee) {
            results.failed.push({ employeeId: empId, reason: 'Employee not found in database' });
            console.error(`❌ Employee not found: ${empId}`);
            continue;
          }

          // Check if employee has salary
          const configuredSalary = resolveStaffMonthlySalary(employee);
          if (!Number.isFinite(configuredSalary)) {
            results.failed.push({
              employeeId: empId,
              name: employee.name,
              reason: 'Salary not configured (undefined)',
            });
            console.error(`❌ Salary undefined for ${employee.name}`);
            continue;
          }

          if (configuredSalary === 0) {
            results.failed.push({ employeeId: empId, name: employee.name, reason: 'Salary is 0' });
            console.error(`❌ Salary is 0 for ${employee.name}`);
            continue;
          }

          // Get salary adjustments: one-time for this exact month AND recurring
          // adjustments whose effective date is on or before this month
          const adjustments = adjustmentsByEmployee.get(String(empId)) || [];

          // Compute the full component breakdown (baseSalary + allowances +
          // deductions + totals) via the shared helper so this run and
          // recomputeLOPForStaff() stay identical. Includes P4 breakdown
          // expansion and P3 overtime (against workingDayCount) + leave/absent/
          // half-day (LOP) auto-derivation.
          let computed;
          try {
            computed = computeEmployeeComponents({
              employee,
              adjustments,
              leaves: leavesByEmployee.get(String(empId)) || [],
              attendanceDocs: attendanceByEmployee.get(String(empId)) || [],
              payrollCalendar,
              month,
              year,
            });
          } catch (componentError) {
            results.failed.push({
              employeeId: empId,
              name: employee.name,
              reason: componentError.message,
            });
            continue;
          }

          const {
            baseSalary,
            allowances,
            deductions,
            totalAllowances,
            totalDeductions,
            grossPay,
            netPay,
          } = computed;
          if (netPay < 0) {
            results.failed.push({
              employeeId: empId,
              name: employee.name,
              reason: `Deductions (${totalDeductions}) exceed gross pay (${grossPay})`,
            });
            continue;
          }

          // Atomic check-and-lock: use findOneAndUpdate to prevent race conditions (AUDIT-208)
          const record = await PayrollRecord.findOneAndUpdate(
            { schoolId, employeeId: empId, month, year },
            { $setOnInsert: { schoolId, employeeId: empId, month, year, status: 'not_generated' } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );

          const isExistingRecord = record.status !== 'not_generated';
          if (isExistingRecord) {
            // Log changes before update
            const oldRecord = { ...record.toObject() };

            // Update existing record (but preserve payment status if locked)
            if (!record.isLocked) {
              record.baseSalary = baseSalary;
              record.allowances = allowances;
              record.deductions = deductions;
              record.totalAllowances = totalAllowances;
              record.totalDeductions = totalDeductions;
              record.grossPay = grossPay;
              record.netPay = netPay;
              record.employmentType = normalizeEmploymentType(employee.employmentType);
              record.status = 'generated';
            } else {
              results.failed.push({
                employeeId: empId,
                name: employee.name,
                reason: 'Record is locked (already paid). Cannot update.',
              });
              console.warn(`⚠️ Skipping locked record for ${employee.name}`);
              continue;
            }

            await logAudit({
              schoolId: req.user.schoolId,
              entityType: 'PayrollRecord',
              entityId: record._id,
              action: 'record_updated',
              performedBy: req.user._id,
              changes: { before: oldRecord, after: record.toObject() },
              context: {
                month,
                year,
                employeeId: empId,
                employeeName: employee.name,
              },
              ipAddress: req.ip,
              userAgent: req.get('user-agent'),
              status: 'success',
            });
          } else {
            // Populate new record fields (record was created via upsert with minimal fields)
            record.payrollRunId = payrollRun._id;
            record.baseSalary = baseSalary;
            record.allowances = allowances;
            record.deductions = deductions;
            record.totalAllowances = totalAllowances;
            record.totalDeductions = totalDeductions;
            record.grossPay = grossPay;
            record.netPay = netPay;
            // Normalize employmentType to the PayrollRecord enum
            // (['full_time','part_time','contractor']). Staff.employmentType is a
            // free String, so legacy rows may still store display strings like
            // "Full-time"/"Part-time"/"Contract" that would make record.save()
            // throw ValidationError. Map known display variants + coerce unknowns
            // to the default so the run never fails on old data (C8).
            record.employmentType = normalizeEmploymentType(employee.employmentType);
            record.status = 'generated';

            await logAudit({
              schoolId: req.user.schoolId,
              entityType: 'PayrollRecord',
              entityId: record._id,
              action: 'record_created',
              performedBy: req.user._id,
              context: {
                month,
                year,
                employeeId: empId,
                employeeName: employee.name,
              },
              ipAddress: req.ip,
              userAgent: req.get('user-agent'),
              status: 'success',
            });
          }

          await record.save();

          // Generate payslip
          const payslipNumber = `PS-${year}-${month.toString().padStart(2, '0')}-${empId}`;
          await Payslip.updateOne(
            { schoolId, payrollRecordId: record._id },
            {
              $setOnInsert: {
                schoolId,
                payrollRecordId: record._id,
                employeeId: empId,
                month,
                year,
                payslipNumber,
              },
            },
            { upsert: true }
          );

          results.success.push(empId);
        } catch (error) {
          if (error instanceof PayrollRunLockedError) throw error;
          console.error(`❌ Error processing employee ${empId}:`, error);
          results.failed.push({ employeeId: empId, reason: error.message });
        }
      }

      const finalStatus =
        results.success.length > 0 && results.failed.length > 0
          ? 'partial'
          : results.success.length > 0
            ? 'completed'
            : 'failed';
      payrollRun = await releasePayrollRunLock({
        payrollRunId: payrollRun._id,
        lockToken: payrollLockToken,
        status: finalStatus,
        completedAt: new Date(),
        processedEmployees: results.success.length,
        failedEmployees: results.failed.length,
        errorLog:
          results.failed.length > 0
            ? results.failed.map((f) => `${f.name || f.employeeId}: ${f.reason}`)
            : [],
      });
      if (!payrollRun) {
        throw new PayrollRunLockedError();
      }
      payrollLockToken = null;
      payrollRun = (await syncPayrollRunTotals(schoolId, month, year)) || payrollRun;

      await logAudit({
        schoolId: req.user.schoolId,
        entityType: 'PayrollRun',
        entityId: payrollRun._id,
        action: results.success.length > 0 ? 'payroll_run_completed' : 'payroll_run_failed',
        performedBy: req.user._id,
        context: {
          month,
          year,
          successCount: results.success.length,
          failedCount: results.failed.length,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status: results.success.length > 0 ? 'success' : 'failure',
      });

      res.json({
        success: true,
        data: {
          payrollRun,
          results,
        },
      });
    } catch (error) {
      console.error('Error running payroll:', error);

      // Release only the lock owned by this request. A stale request must never
      // clear a newer request's lock after expiry/reacquisition.
      if (payrollRun?._id && payrollLockToken) {
        await releasePayrollRunLock({
          payrollRunId: payrollRun._id,
          lockToken: payrollLockToken,
          status: 'failed',
          completedAt: new Date(),
          errorLog: [error.message],
        }).catch(() => {});
      }

      if (error instanceof PayrollRunLockedError) {
        return res.status(409).json({
          success: false,
          error: req.t(
            'common:routes.payrollIsCurrentlyBeingProcessedByAnotherUserPleaseTryAgainLater'
          ),
          lockedBy: error.lockedBy,
        });
      }

      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Mark salary as paid - Admin only
router.put(
  '/records/:id/pay',
  checkPermission('payroll', 'edit'),
  validateZod(payrollRecordParamsSchema, 'params'),
  validateZod(markAsPaidSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { paymentMethod, paymentReference, notes, paymentDate } = req.body;

      const record = await PayrollRecord.findOne({ _id: id, schoolId: req.user.schoolId });

      if (!record) {
        return res
          .status(404)
          .json({ success: false, error: req.t('common:routes.recordNotFound') });
      }

      if (record.status === 'paid' || record.isLocked) {
        return res
          .status(400)
          .json({ success: false, error: req.t('common:routes.recordIsAlreadyPaidOrLocked') });
      }

      const oldRecord = { ...record.toObject() };

      record.status = 'paid';
      record.paymentDate = paymentDate ? new Date(paymentDate) : new Date();
      record.paymentMethod = paymentMethod || 'bank_transfer';
      record.paymentReference = paymentReference;
      record.notes = notes;
      record.isLocked = true;
      record.lockedAt = new Date();
      record.paidBy = req.user._id;

      await record.save();
      await syncPayrollRunTotals(req.user.schoolId, record.month, record.year);

      // Log audit
      await logAudit({
        schoolId: req.user.schoolId,
        entityType: 'PayrollRecord',
        entityId: record._id,
        action: 'payment_logged',
        performedBy: req.user._id,
        changes: { before: oldRecord, after: record.toObject() },
        context: {
          month: record.month,
          year: record.year,
          employeeId: record.employeeId,
          paymentMethod,
          paymentReference,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status: 'success',
      });

      res.json({
        success: true,
        data: record,
        paymentState: 'recorded',
        disbursementInitiated: false,
        message: 'Payment was recorded in EMS. No bank or payment-provider transfer was initiated.',
      });
    } catch (error) {
      console.error('Error marking as paid:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Reverse payment - Admin only
router.put(
  '/records/:id/reverse',
  checkPermission('payroll', 'edit'),
  validateZod(payrollRecordParamsSchema, 'params'),
  validateZod(reversePaymentSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const record = await PayrollRecord.findOne({ _id: id, schoolId: req.user.schoolId });

      if (!record) {
        return res
          .status(404)
          .json({ success: false, error: req.t('common:routes.recordNotFound') });
      }

      if (!record.isLocked || record.status !== 'paid') {
        return res
          .status(400)
          .json({ success: false, error: req.t('common:routes.onlyPaidRecordsCanBeReversed') });
      }

      // EMS does not integrate with a bank/payment provider in this release.
      // Unlocking an externally-recorded payment would falsely imply that the
      // real transfer was reversed. Cash is the only in-app correction we can
      // complete without an external reconciliation step.
      if (record.paymentMethod !== 'cash') {
        return res.status(409).json({
          success: false,
          code: 'EXTERNAL_REVERSAL_REQUIRED',
          error:
            'This payment was recorded with an external method. Reverse or cancel it with the bank/payment provider before changing the EMS payroll record.',
        });
      }

      const oldRecord = { ...record.toObject() };

      // Store reversal history
      record.reversalHistory = record.reversalHistory || [];
      record.reversalHistory.push({
        reversedAt: new Date(),
        reversedBy: req.user._id,
        reason,
        previousStatus: record.status,
        previousPaymentDate: record.paymentDate,
        previousPaymentReference: record.paymentReference,
      });

      // Cash has no external provider state, so the recorded payment can be
      // safely corrected in-app.
      record.status = 'generated';
      record.paymentDate = null;
      record.isLocked = false;
      record.lockedAt = null;
      record.paidBy = null;

      // P1: Clear the payment-method fields unambiguously. In Mongoose 8.x the
      // only reliable ways to $unset a schema path on an existing doc are:
      //   (a) assign `undefined` to a path that is SELECTED + modified, which
      //       $__delta() then converts to $unset; OR
      //   (b) an explicit updateOne({ $unset: {...} }).
      // `delete record.paymentMethod` is a no-op on a Mongoose document (the
      // getter/setter on the prototype is not invoked, so _doc keeps the value),
      // and assigning `null` persists an explicit null rather than removing the
      // field. We additionally use updateOne($unset) so the DB row is cleared
      // regardless of any default-reapplication subtlety (paymentMethod has a
      // schema default of 'bank_transfer' — on the next read Mongoose would
      // otherwise synthesise that default even though Mongo held nothing).
      record.paymentMethod = undefined;
      record.paymentReference = undefined;
      // Mark these two explicitly so save()'s delta emits $unset for them even
      // if some upstream projection skipped the change-tracking mark.
      if (record.isModified('paymentMethod') === false) record.markModified('paymentMethod');
      if (record.isModified('paymentReference') === false) record.markModified('paymentReference');

      await record.save();

      // Belt-and-suspenders: a direct $unset guarantees the fields are gone in
      // the persisted document, independent of Mongoose's undefined-handling
      // quirks across versions/strict modes.
      await PayrollRecord.updateOne(
        { _id: record._id },
        { $unset: { paymentMethod: '', paymentReference: '' } }
      );
      await syncPayrollRunTotals(req.user.schoolId, record.month, record.year);

      // Log audit
      await logAudit({
        schoolId: req.user.schoolId,
        entityType: 'PayrollRecord',
        entityId: record._id,
        action: 'payment_reversed',
        performedBy: req.user._id,
        changes: { before: oldRecord, after: record.toObject() },
        context: {
          month: record.month,
          year: record.year,
          employeeId: record.employeeId,
          reason,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status: 'success',
      });

      res.json({
        success: true,
        data: record,
        reversalState: 'cash_record_corrected',
        message: 'The cash payment record was reversed in EMS.',
      });
    } catch (error) {
      console.error('Error reversing payment:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Bulk pay salaries - Admin only
router.post(
  '/records/bulk-pay',
  checkPermission('payroll', 'edit'),
  validateZod(bulkPaySchema),
  async (req, res) => {
    try {
      const { recordIds, paymentMethod, paymentReference, notes, paymentDate } = req.body;

      const results = {
        success: [],
        failed: [],
      };
      const affectedPeriods = new Set();

      for (const id of recordIds) {
        try {
          const record = await PayrollRecord.findOne({ _id: id, schoolId: req.user.schoolId });

          if (!record) {
            results.failed.push({ id, reason: 'Record not found' });
            continue;
          }

          if (record.status === 'paid' || record.isLocked) {
            results.failed.push({ id, reason: 'Record is already paid or locked' });
            continue;
          }

          const oldRecord = { ...record.toObject() };

          record.status = 'paid';
          record.paymentDate = paymentDate ? new Date(paymentDate) : new Date();
          record.paymentMethod = paymentMethod || 'bank_transfer';
          // Make the reference unique per record so bank statements can be
          // reconciled. Bulk-pay previously wrote the SAME reference for
          // every record in the batch — impossible to trace individual
          // transfers afterward.
          record.paymentReference = paymentReference
            ? `${paymentReference}-${record._id.toString().slice(-8).toUpperCase()}`
            : undefined;
          record.paymentBatchReference = paymentReference || null;
          record.notes = notes;
          record.isLocked = true;
          record.lockedAt = new Date();
          record.paidBy = req.user._id;

          await record.save();
          affectedPeriods.add(`${record.year}-${record.month}`);
          results.success.push(id);

          // Log audit for each record
          await logAudit({
            schoolId: req.user.schoolId,
            entityType: 'PayrollRecord',
            entityId: record._id,
            action: 'payment_logged',
            performedBy: req.user._id,
            changes: { before: oldRecord, after: record.toObject() },
            context: {
              month: record.month,
              year: record.year,
              employeeId: record.employeeId,
              paymentMethod,
              paymentReference,
              bulkOperation: true,
            },
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
            status: 'success',
          });
        } catch (error) {
          results.failed.push({ id, reason: error.message });
        }
      }

      await Promise.all(
        [...affectedPeriods].map((period) => {
          const [periodYear, periodMonth] = period.split('-').map(Number);
          return syncPayrollRunTotals(req.user.schoolId, periodMonth, periodYear);
        })
      );

      // Log bulk operation
      await logAudit({
        schoolId: req.user.schoolId,
        entityType: 'PayrollRun',
        entityId: null,
        action: 'bulk_payment_logged',
        performedBy: req.user._id,
        context: {
          successCount: results.success.length,
          failedCount: results.failed.length,
          paymentMethod,
          paymentReference,
        },
        affectedRecords: results.success,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status: results.failed.length === 0 ? 'success' : 'partial',
      });

      res.json({
        success: results.failed.length === 0,
        data: results,
        paymentState: results.failed.length === 0 ? 'recorded' : 'partially_recorded',
        disbursementInitiated: false,
        message:
          'Payments were recorded in EMS. No bank or payment-provider transfers were initiated.',
      });
    } catch (error) {
      console.error('Error bulk paying:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Update payroll record - Admin only. Zod-validated so a missing/null
// amount on an allowance or deduction can't turn the pre-save hook's
// reduce() into NaN grossPay/netPay, and status is pinned to the schema
// enum.
router.put(
  '/records/:id',
  checkPermission('payroll', 'edit'),
  validateZod(payrollRecordParamsSchema, 'params'),
  validateZod(updatePayrollRecordSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { baseSalary, allowances, deductions, status, notes } = req.body;

      const record = await PayrollRecord.findOne({ _id: id, schoolId: req.user.schoolId });

      if (!record) {
        return res
          .status(404)
          .json({ success: false, error: req.t('common:routes.recordNotFound') });
      }

      if (record.isLocked) {
        return res
          .status(400)
          .json({ success: false, error: req.t('common:routes.recordIsLockedAndCannotBeEdited') });
      }

      const oldRecord = { ...record.toObject() };

      if (baseSalary !== undefined) record.baseSalary = baseSalary;
      if (allowances !== undefined) record.allowances = allowances;
      if (deductions !== undefined) record.deductions = deductions;
      if (status !== undefined) record.status = status;
      if (notes !== undefined) record.notes = notes;

      const nextBaseSalary = Number(record.baseSalary) || 0;
      const nextAllowances = (record.allowances || []).reduce(
        (sum, item) => sum + (Number(item.amount) || 0),
        0
      );
      const nextDeductions = (record.deductions || []).reduce(
        (sum, item) => sum + (Number(item.amount) || 0),
        0
      );
      if (nextDeductions > nextBaseSalary + nextAllowances) {
        return res.status(400).json({
          success: false,
          error: 'Deductions cannot exceed gross pay; net pay must not be negative.',
        });
      }

      await record.save();
      await syncPayrollRunTotals(req.user.schoolId, record.month, record.year);

      // Log audit
      await logAudit({
        schoolId: req.user.schoolId,
        entityType: 'PayrollRecord',
        entityId: record._id,
        action: 'record_updated',
        performedBy: req.user._id,
        changes: { before: oldRecord, after: record.toObject() },
        context: {
          month: record.month,
          year: record.year,
          employeeId: record.employeeId,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status: 'success',
      });

      res.json({ success: true, data: record });
    } catch (error) {
      console.error('Error updating record:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Export payroll records to CSV
router.get('/export/:month/:year', checkPermission('payroll', 'view'), async (req, res) => {
  try {
    const { month, year } = req.params;
    const monthNum = parseInt(month);
    const yearNum = parseInt(year);

    const records = await PayrollRecord.find({
      schoolId: req.user.schoolId,
      month: monthNum,
      year: yearNum,
    })
      .populate('employeeId', 'name code email')
      .lean();

    // Create CSV content
    const headers = [
      'Employee Code',
      'Employee Name',
      'Month',
      'Year',
      'Base Salary',
      'Total Allowances',
      'Total Deductions',
      'Gross Pay',
      'Net Pay',
      'Status',
      'Payment Date',
      'Payment Method',
      'Payment Reference',
    ];

    // CSV-safe cell: escape embedded double quotes per RFC 4180, and
    // prefix a leading single-quote to any value starting with =/+/-/@
    // so the cell is treated as text in Excel/LibreOffice/Sheets —
    // closes the CSV-injection vector.
    const csvCell = (v) => {
      if (v === null || v === undefined) return '""';
      let s = String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };

    let csv = headers.map(csvCell).join(',') + '\n';

    records.forEach((record) => {
      const staff = record.employeeId || {};
      const row = [
        staff.code || 'N/A',
        staff.name || 'N/A',
        monthNum,
        yearNum,
        record.baseSalary || 0,
        record.totalAllowances || 0,
        record.totalDeductions || 0,
        record.grossPay || 0,
        record.netPay || 0,
        record.status,
        record.paymentDate ? new Date(record.paymentDate).toLocaleDateString() : 'N/A',
        record.paymentMethod || 'N/A',
        record.paymentReference || 'N/A',
      ];
      csv += row.map(csvCell).join(',') + '\n';
    });

    // Log export
    await logAudit({
      schoolId: req.user.schoolId,
      entityType: 'PayrollRun',
      entityId: null,
      action: 'payroll_exported',
      performedBy: req.user._id,
      context: {
        month: monthNum,
        year: yearNum,
        recordCount: records.length,
        format: 'CSV',
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      status: 'success',
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=payroll-${yearNum}-${String(monthNum).padStart(2, '0')}.csv`
    );
    res.send(csv);
  } catch (error) {
    console.error('Error exporting payroll:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get own payslips list (staff-facing, paginated)
router.get('/my-payslips/summary', async (req, res) => {
  try {
    const employeeId = req.user._id;
    const currentYear = new Date().getFullYear();

    const records = await PayrollRecord.find({
      schoolId: req.user.schoolId,
      employeeId,
      year: currentYear,
    }).lean();

    const totalEarnings = records.reduce((sum, r) => sum + (r.netPay || 0), 0);

    res.json({
      success: true,
      year: currentYear,
      totalEarnings,
      totalPayslips: records.length,
    });
  } catch (error) {
    console.error('Error fetching payslips summary:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

const PAYROLL_MONTH_NAMES = [
  '',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

router.get('/my-payslips', async (req, res) => {
  try {
    const employeeId = req.user._id;
    const skip = parseInt(req.query.skip) || 0;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);

    const query = { schoolId: req.user.schoolId, employeeId };

    const records = await PayrollRecord.find(query)
      .sort({ year: -1, month: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Join Payslip documents for payslipId and fileUrl
    const recordIds = records.map((r) => r._id);
    const payslipDocs = await Payslip.find({
      schoolId: req.user.schoolId,
      employeeId,
      payrollRecordId: { $in: recordIds },
    }).lean();
    const payslipMap = new Map(payslipDocs.map((p) => [p.payrollRecordId.toString(), p]));

    const payslips = records.map((r) => {
      const payslip = payslipMap.get(r._id.toString());
      return {
        ...r,
        monthName: PAYROLL_MONTH_NAMES[r.month] || `Month ${r.month}`,
        payslipId: payslip?._id || null,
        fileUrl: payslip?.fileUrl || null,
      };
    });

    res.json({ success: true, payslips });
  } catch (error) {
    console.error('Error fetching my payslips:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get payslip - View permission or own payslip
router.get(
  '/payslips/:employeeId/:month/:year',
  validateZod(payslipParamsSchema, 'params'),
  async (req, res) => {
    try {
      const { employeeId, month, year } = req.params;

      // Authorization: user must be the employee themselves or have payroll view permission
      const isOwnPayslip = req.user._id.toString() === employeeId;
      const canViewPayroll = await userHasPermission(req, 'payroll', 'view');
      if (!isOwnPayslip && !canViewPayroll) {
        return res
          .status(403)
          .json({ success: false, error: 'Not authorized to view this payslip' });
      }

      const payslip = await Payslip.findOne({
        employeeId,
        schoolId: req.user.schoolId,
        month: parseInt(month),
        year: parseInt(year),
      }).populate('payrollRecordId');

      if (!payslip) {
        return res
          .status(404)
          .json({ success: false, error: req.t('common:routes.payslipNotFound') });
      }

      // Update download count
      payslip.downloadCount += 1;
      payslip.lastDownloadedAt = new Date();
      await payslip.save();

      // Log audit
      await logAudit({
        schoolId: req.user.schoolId,
        entityType: 'Payslip',
        entityId: payslip._id,
        action: 'payslip_downloaded',
        performedBy: req.user._id,
        context: {
          month: parseInt(month),
          year: parseInt(year),
          employeeId,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status: 'success',
      });

      res.json({ success: true, data: payslip });
    } catch (error) {
      console.error('Error fetching payslip:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Get audit logs for payroll
router.get('/audit-logs', checkPermission('payroll', 'view'), async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const month = parseInt(req.query.month);
    const year = parseInt(req.query.year);
    const employeeId = sanitizeQueryId(req.query.employeeId);
    const action = sanitizeQueryStr(req.query.action);

    const query = { schoolId: req.user.schoolId };
    // Guard each filter independently. parseInt(undefined) is NaN, so the
    // previous `if (month || year)` block wrote NaN for whichever param was
    // omitted (e.g. supplying only year set context.month = NaN), zeroing
    // the result set.
    if (month) query['context.month'] = month;
    if (year) query['context.year'] = year;
    if (employeeId) query['context.employeeId'] = employeeId;
    if (action) query.action = action;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const logs = await PayrollAuditLog.find(query)
      .populate('performedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await PayrollAuditLog.countDocuments(query);

    res.json({
      success: true,
      data: logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Salary adjustments - Admin or own adjustments
router.get(
  '/adjustments/:employeeId',
  validateZod(employeeAdjustmentParamsSchema, 'params'),
  async (req, res) => {
    try {
      const { employeeId } = req.params;

      // Authorization: user must be the employee themselves or an admin
      const isOwn = String(req.user._id || req.user.id) === employeeId;
      const canViewPayroll = await userHasPermission(req, 'payroll', 'view');
      if (!isOwn && !canViewPayroll) {
        return res
          .status(403)
          .json({ success: false, error: "Not authorized to view this employee's adjustments" });
      }

      const adjustments = await SalaryAdjustment.find({
        employeeId,
        schoolId: req.user.schoolId,
        isActive: true,
      });
      res.json({ success: true, data: adjustments });
    } catch (error) {
      console.error('Error fetching adjustments:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

router.post(
  '/adjustments',
  checkPermission('payroll', 'create'),
  validateZod(createSalaryAdjustmentSchema),
  async (req, res) => {
    try {
      const employee = await Staff.findOne({
        _id: req.body.employeeId,
        schoolId: req.user.schoolId,
        isDeleted: { $ne: true },
      }).select('_id');
      if (!employee) {
        return res.status(404).json({
          success: false,
          error: 'Employee not found in this school.',
        });
      }

      const adjustment = new SalaryAdjustment({
        ...req.body,
        schoolId: req.user.schoolId,
        createdBy: req.user._id,
        isActive: true,
      });
      await adjustment.save();

      // Log audit
      await logAudit({
        schoolId: req.user.schoolId,
        entityType: 'SalaryAdjustment',
        entityId: adjustment._id,
        action: 'adjustment_created',
        performedBy: req.user._id,
        context: {
          employeeId: adjustment.employeeId,
          type: adjustment.type,
          amount: adjustment.amount,
          effectiveMonth: adjustment.effectiveMonth,
          effectiveYear: adjustment.effectiveYear,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status: 'success',
      });

      res.status(201).json({ success: true, data: adjustment });
    } catch (error) {
      console.error('Error creating adjustment:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

router.put(
  '/adjustments/:id',
  checkPermission('payroll', 'edit'),
  validateZod(salaryAdjustmentParamsSchema, 'params'),
  validateZod(updateSalaryAdjustmentSchema),
  async (req, res) => {
    try {
      const adjustment = await SalaryAdjustment.findOneAndUpdate(
        { _id: req.params.id, schoolId: req.user.schoolId, isActive: true },
        { $set: req.body },
        { new: true, runValidators: true }
      );
      if (!adjustment) {
        return res.status(404).json({ success: false, error: 'Salary adjustment not found' });
      }
      res.json({ success: true, data: adjustment });
    } catch (error) {
      console.error('Error updating adjustment:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

router.delete(
  '/adjustments/:id',
  checkPermission('payroll', 'delete'),
  validateZod(salaryAdjustmentParamsSchema, 'params'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const adjustment = await SalaryAdjustment.findOneAndUpdate(
        { _id: id, schoolId: req.user.schoolId, isActive: true },
        { $set: { isActive: false } },
        { new: true }
      );

      if (!adjustment) {
        return res.status(404).json({ success: false, error: 'Salary adjustment not found' });
      }

      // Log audit
      await logAudit({
        schoolId: req.user.schoolId,
        entityType: 'SalaryAdjustment',
        entityId: id,
        action: 'adjustment_deleted',
        performedBy: req.user._id,
        context: {
          employeeId: adjustment.employeeId,
          type: adjustment.type,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status: 'success',
      });

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting adjustment:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// P8: Recompute LOP (and all auto-derived components) for one employee/period
// after attendance or leave data has changed. This is the payroll half of the
// cross-agent P8 fix: the staffAttendance / teacherLeaves routes (owned by
// other agents) should call this endpoint — or import recomputeLOPForStaff
// directly below — whenever they mutate data affecting an already-generated
// PayrollRecord. It skips paid/locked records; callers must reverse the payment
// first to recompute those. Kept under payroll:edit so only authorized users
// (and trusted internal callers passing through auth) can trigger it.
router.post(
  '/recompute-lop/:employeeId/:month/:year',
  checkPermission('payroll', 'edit'),
  async (req, res) => {
    try {
      const { employeeId, month: monthParam, year: yearParam } = req.params;
      const month = parseInt(monthParam, 10);
      const year = parseInt(yearParam, 10);
      if (!month || !year) {
        return res.status(400).json({ success: false, error: 'Valid month and year are required' });
      }
      if (!mongoose.Types.ObjectId.isValid(employeeId)) {
        return res.status(400).json({ success: false, error: 'Invalid employeeId' });
      }

      const result = await recomputeLOPForStaff(employeeId, month, year, {
        schoolId: req.user.schoolId,
        performedBy: req.user._id,
      });

      if (result === null) {
        return res.status(404).json({
          success: false,
          error: 'No payroll record found for this employee/period',
        });
      }
      if (result.skipped) {
        return res.status(409).json({
          success: false,
          error: `Cannot recompute: ${result.skipped}`,
          skipped: result.skipped,
        });
      }

      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error recomputing LOP:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Exported for in-process use by other modules (e.g. staffAttendance /
// teacherLeaves routes) that need to recompute LOP after a data change without
// going through HTTP. See P8 cross-agent follow-up.
export { recomputeLOPForStaff, computeEmployeeComponents };

export default router;
