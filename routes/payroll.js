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
    const pendingAmount = records.reduce(
      (sum, r) => sum + (r.status === 'generated' ? r.netPay : 0),
      0
    );
    const pendingCount = records.filter((r) => r.status === 'generated').length;
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

      // FIXED: Fetch staff data from database with salary field
      const staffFromDB = await Staff.find(
        { _id: { $in: validIds }, schoolId: req.user?.schoolId },
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

          const allowances = adjustments
            .filter((a) => a.type === 'allowance')
            .map((a) => ({
              type: a.category,
              amount: a.amount,
              description: a.description,
            }));

          const deductions = adjustments
            .filter((a) => a.type === 'deduction')
            .map((a) => ({
              type: a.category,
              amount: a.amount,
              description: a.description,
            }));

          // --- Auto-calculate leave & attendance-based adjustments ---
          const baseSalary = configuredSalary;
          const dailyRate = Math.round((baseSalary / payrollCalendar.workingDayCount) * 100) / 100;

          // 1. Leave deductions from approved TeacherLeave records.
          // Exact-match the auto type (case-insensitive) — the previous
          // substring include('leave') suppressed the auto-deduction when an
          // unrelated line item ('Sick Leave Claim', 'Leave Travel Bonus',
          // etc.) happened to contain the word "leave".
          const hasManualLeaveDeduction = deductions.some(
            (d) =>
              String(d.type || '')
                .trim()
                .toLowerCase() === 'leave deduction'
          );
          if (!hasManualLeaveDeduction) {
            const leaveDays = countUnpaidWorkingLeaveDays(
              leavesByEmployee.get(String(empId)) || [],
              month,
              year,
              payrollCalendar
            );
            if (leaveDays > 0) {
              const leaveAmount = Math.round(dailyRate * leaveDays * 100) / 100;
              deductions.push({
                type: 'Leave Deduction',
                amount: leaveAmount,
                description: `${leaveDays} unpaid working leave day(s) @ ${dailyRate.toFixed(2)}/day`,
              });
            }
          }

          // 2. Part-time staff: deduct for absent days based on attendance
          if (normalizeEmploymentType(employee.employmentType) === 'part_time') {
            const attendance = summarizeAttendance(
              attendanceByEmployee.get(String(empId)) || [],
              payrollCalendar.workingDateKeys
            );
            if (attendance.total > 0) {
              // Deduct for absent days (leave days already handled above)
              const absentDays = attendance.absent;
              if (absentDays > 0) {
                // Exact-match "absent deduction" so unrelated line items
                // mentioning "absent" don't silently suppress the
                // attendance-based auto deduction.
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

              // Half-day deductions
              const halfdayCount = attendance.halfday;
              if (halfdayCount > 0) {
                const halfdayAmount = Math.round(dailyRate * 0.5 * halfdayCount * 100) / 100;
                deductions.push({
                  type: 'Half-day Deduction',
                  amount: halfdayAmount,
                  description: `Part-time: ${halfdayCount} half-day(s) @ ${(dailyRate * 0.5).toFixed(2)}/day`,
                });
              }

              // Overtime: extra present days beyond expected working days (add as allowance)
              // Standard working days = total attendance days marked (school decides which days to mark)
              // If staff has more present days than expected, treat excess as overtime
              const overtimeRate = dailyRate * 1.5; // 1.5x daily rate for overtime
              const expectedWorkingDays = attendance.total - attendance.leave; // exclude approved leave days
              const actualWorkedDays = attendance.present + attendance.halfday * 0.5;
              if (actualWorkedDays > expectedWorkingDays && expectedWorkingDays > 0) {
                const overtimeDays = actualWorkedDays - expectedWorkingDays;
                const overtimeAmount = Math.round(overtimeRate * overtimeDays * 100) / 100;
                const hasManualOvertime = allowances.some((a) =>
                  a.type.toLowerCase().includes('overtime')
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

          // Calculate totals explicitly
          const totalAllowances = allowances.reduce((sum, a) => sum + a.amount, 0);
          const totalDeductions = deductions.reduce((sum, d) => sum + d.amount, 0);
          const grossPay = baseSalary + totalAllowances;
          const netPay = grossPay - totalDeductions;
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
      record.paymentMethod = undefined;
      record.paymentReference = undefined;
      record.isLocked = false;
      record.lockedAt = null;
      record.paidBy = null;

      await record.save();
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
    if (month || year) {
      query['context.month'] = month;
      query['context.year'] = year;
    }
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

export default router;
