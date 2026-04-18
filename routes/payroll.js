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
import { authenticate } from '../middleware/auth.js';
import { checkPermission, requireAdmin } from '../middleware/permissions.js';
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
} from '../validators/payrollSchema.js';
import mongoose from 'mongoose';

// Get Staff model from database.js
const Staff = mongoose.model('Staff');

// ALL PAYROLL ROUTES PROTECTED - Contains sensitive salary data!

// Helper function to log audit entries
async function logAudit({
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

// Helper: Count approved leave days for an employee falling within a specific month
async function getMonthlyLeaveDays(employeeId, schoolId, month, year) {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);

  const leaves = await TeacherLeave.find({
    schoolId,
    teacherId: employeeId,
    status: 'approved',
    startDate: { $lte: monthEnd },
    endDate: { $gte: monthStart },
  });

  let totalDays = 0;
  for (const leave of leaves) {
    const effectiveStart = leave.startDate < monthStart ? monthStart : leave.startDate;
    const effectiveEnd = leave.endDate > monthEnd ? monthEnd : leave.endDate;
    const days = Math.ceil((effectiveEnd - effectiveStart) / (1000 * 60 * 60 * 24)) + 1;
    totalDays += days;
  }

  return totalDays;
}

// Helper: Get staff attendance summary for a month from StaffAttendance records
async function getMonthlyAttendanceSummary(employeeId, schoolId, month, year) {
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;

  const records = await StaffAttendance.find({
    schoolId,
    staffId: employeeId,
    date: { $regex: `^${monthPrefix}` },
  });

  const summary = { present: 0, absent: 0, leave: 0, halfday: 0, total: records.length };
  for (const r of records) {
    if (summary[r.status] !== undefined) summary[r.status]++;
  }

  return summary;
}

// Get payroll dashboard KPIs
router.get(
  '/dashboard/:month/:year',
  checkPermission('payroll', 'view'),
  async (req, res) => {
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
  }
);

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
  requireAdmin,
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
        'name salary employmentType _id code status'
      );

      const validationResults = {
        valid: [],
        invalid: [],
        warnings: [],
      };

      for (const employee of staffFromDB) {
        const issues = [];

        // Check salary
        if (!employee.salary || employee.salary === 0) {
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
          salary: employee.salary,
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

// Temporary Fix: Set default salary for all staff
router.post('/fix-salaries', requireAdmin, async (req, res) => {
  try {
    const { defaultSalary = 50000, defaultType = 'full_time' } = req.body;

    const schoolId = req.user?.schoolId;
    if (!schoolId) {
      return res.status(400).json({ success: false, error: 'schoolId is required' });
    }

    const allStaff = await Staff.find({ schoolId });
    let updatedCount = 0;
    let alreadySetCount = 0;
    const results = [];

    for (const staff of allStaff) {
      let needsUpdate = false;
      const updates = {};

      if (!staff.salary || staff.salary === 0) {
        updates.salary = defaultSalary;
        needsUpdate = true;
      }

      if (!staff.employmentType) {
        updates.employmentType = defaultType;
        needsUpdate = true;
      }

      if (needsUpdate) {
        await Staff.findByIdAndUpdate(staff._id, updates);
        results.push(
          `Updated ${staff.name}: Salary ${updates.salary || staff.salary}, Type ${updates.employmentType || staff.employmentType}`
        );
        updatedCount++;
      } else {
        alreadySetCount++;
      }
    }

    // Log audit
    await logAudit({
      entityType: 'PayrollRun',
      entityId: null,
      action: 'payroll_run_failed',
      performedBy: req.user._id,
      context: { reason: 'Fix salaries script executed', updatedCount, alreadySetCount },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      status: 'success',
    });

    res.json({
      success: true,
      message: `Updated ${updatedCount} staff records`,
      details: results,
      totalChecked: allStaff.length,
    });
  } catch (error) {
    console.error('Error fixing salaries:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Run payroll for a month - Admin only (CRITICAL)
router.post('/run', requireAdmin, validateZod(runPayrollSchema), async (req, res) => {
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

    // Check for concurrent run
    const existingPayrollRun = await PayrollRun.findOne({ schoolId, month, year });
    if (existingPayrollRun && existingPayrollRun.isProcessing) {
      // Check if lock has expired (30 minutes)
      const lockExpiry = existingPayrollRun.processingLockExpiresAt;
      if (lockExpiry && lockExpiry > new Date()) {
        return res.status(409).json({
          success: false,
          error: req.t(
            'common:routes.payrollIsCurrentlyBeingProcessedByAnotherUserPleaseTryAgainLater'
          ),
          lockedBy: existingPayrollRun.processingLockedBy,
        });
      }
    }

    // Check if payroll already has paid records (check ALL statuses, not just 'completed')
    if (existingPayrollRun) {
      const paidRecords = await PayrollRecord.countDocuments({
        schoolId,
        month,
        year,
        status: 'paid',
      });

      if (paidRecords > 0) {
        return res.status(400).json({
          success: false,
          error: `Cannot re-run payroll. ${paidRecords} records already marked as paid. Please reverse payments first if needed.`,
          paidRecords,
        });
      }

      // Block re-processing of completed/partial payroll unless explicitly forced
      if (['completed', 'partial'].includes(existingPayrollRun.status) && !req.body.forceRerun) {
        return res.status(400).json({
          success: false,
          error: `Payroll for this month has already been processed (status: ${existingPayrollRun.status}). Use forceRerun to re-process.`,
          alreadyProcessed: true,
          runStatus: existingPayrollRun.status,
        });
      }
    }

    // FIXED: Fetch staff data from database with salary field
    const staffFromDB = await Staff.find(
      { _id: { $in: validIds }, schoolId: req.user?.schoolId },
      'name salary employmentType _id code'
    );

    // Create or update payroll run with processing lock
    let payrollRun = existingPayrollRun;
    if (!payrollRun) {
      payrollRun = new PayrollRun({
        schoolId,
        month,
        year,
        status: 'processing',
        totalEmployees: validIds.length,
        isProcessing: true,
        processingLockExpiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
        processingLockedBy: req.user._id,
        runBy: req.user._id,
      });
      await payrollRun.save();
    } else {
      payrollRun.status = 'processing';
      payrollRun.runDate = new Date();
      payrollRun.totalEmployees = validIds.length;
      payrollRun.isProcessing = true;
      payrollRun.processingLockExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
      payrollRun.processingLockedBy = req.user._id;
      payrollRun.runBy = req.user._id;
      await payrollRun.save();
    }

    // Log audit
    await logAudit({
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
    for (const empId of validIds) {
      try {
        // FIXED: Use staff data from database
        const employee = staffFromDB.find((s) => String(s._id) === String(empId));

        if (!employee) {
          results.failed.push({ employeeId: empId, reason: 'Employee not found in database' });
          console.error(`❌ Employee not found: ${empId}`);
          continue;
        }

        // Check if employee has salary
        if (employee.salary === undefined || employee.salary === null) {
          results.failed.push({
            employeeId: empId,
            name: employee.name,
            reason: 'Salary not configured (undefined)',
          });
          console.error(`❌ Salary undefined for ${employee.name}`);
          continue;
        }

        if (employee.salary === 0) {
          results.failed.push({ employeeId: empId, name: employee.name, reason: 'Salary is 0' });
          console.error(`❌ Salary is 0 for ${employee.name}`);
          continue;
        }

        // Get salary adjustments: one-time for this exact month AND recurring
        // adjustments whose effective date is on or before this month
        const adjustments = await SalaryAdjustment.find({
          employeeId: empId,
          isActive: true,
          $or: [
            // One-time adjustments for this exact month/year
            { isRecurring: { $ne: true }, effectiveMonth: month, effectiveYear: year },
            // Recurring adjustments that started on or before this month/year
            {
              isRecurring: true,
              $or: [
                { effectiveYear: { $lt: year } },
                { effectiveYear: year, effectiveMonth: { $lte: month } },
              ],
            },
          ],
        });

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
        const baseSalary = employee.salary || 0;
        const daysInMonth = new Date(year, month, 0).getDate();
        const dailyRate = Math.round((baseSalary / daysInMonth) * 100) / 100;

        // 1. Leave deductions from approved TeacherLeave records.
        // Exact-match the auto type (case-insensitive) — the previous
        // substring include('leave') suppressed the auto-deduction when an
        // unrelated line item ('Sick Leave Claim', 'Leave Travel Bonus',
        // etc.) happened to contain the word "leave".
        const hasManualLeaveDeduction = deductions.some(
          (d) => String(d.type || '').trim().toLowerCase() === 'leave deduction'
        );
        if (!hasManualLeaveDeduction) {
          const leaveDays = await getMonthlyLeaveDays(empId, schoolId, month, year);
          if (leaveDays > 0) {
            const leaveAmount = Math.round(dailyRate * leaveDays * 100) / 100;
            deductions.push({
              type: 'Leave Deduction',
              amount: leaveAmount,
              description: `${leaveDays} approved leave day(s) @ ${dailyRate.toFixed(2)}/day`,
            });
          }
        }

        // 2. Part-time staff: deduct for absent days based on attendance
        if (employee.employmentType === 'part_time') {
          const attendance = await getMonthlyAttendanceSummary(empId, schoolId, month, year);
          if (attendance.total > 0) {
            // Deduct for absent days (leave days already handled above)
            const absentDays = attendance.absent;
            if (absentDays > 0) {
              // Exact-match "absent deduction" so unrelated line items
              // mentioning "absent" don't silently suppress the
              // attendance-based auto deduction.
              const hasManualAbsentDeduction = deductions.some(
                (d) => String(d.type || '').trim().toLowerCase() === 'absent deduction'
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

        // Atomic check-and-lock: use findOneAndUpdate to prevent race conditions (AUDIT-208)
        let record = await PayrollRecord.findOneAndUpdate(
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
            record.employmentType = employee.employmentType || 'full_time';
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
          record.employmentType = employee.employmentType || 'full_time';
          record.status = 'generated';

          await logAudit({
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
        let payslip = await Payslip.findOne({ payrollRecordId: record._id });

        if (!payslip) {
          payslip = new Payslip({
            schoolId,
            payrollRecordId: record._id,
            employeeId: empId,
            month,
            year,
            payslipNumber,
          });
          await payslip.save();
        }

        results.success.push(empId);
      } catch (error) {
        console.error(`❌ Error processing employee ${empId}:`, error);
        results.failed.push({ employeeId: empId, reason: error.message });
      }
    }

    // Update payroll run
    payrollRun.processedEmployees = results.success.length;
    payrollRun.failedEmployees = results.failed.length;
    // Partial status if some failed but some succeeded
    if (results.success.length > 0 && results.failed.length > 0) {
      payrollRun.status = 'partial';
    } else if (results.success.length > 0) {
      payrollRun.status = 'completed';
    } else {
      payrollRun.status = 'failed'; // All failed
    }

    payrollRun.completedAt = new Date();
    payrollRun.isProcessing = false;
    payrollRun.processingLockExpiresAt = null;
    payrollRun.processingLockedBy = null;

    if (results.failed.length > 0) {
      payrollRun.errorLog = results.failed.map((f) => `${f.name || f.employeeId}: ${f.reason}`);
    } else {
      payrollRun.errorLog = [];
    }

    // Calculate total amount
    const records = await PayrollRecord.find({ schoolId, month, year });
    payrollRun.totalAmount = records.reduce((sum, r) => sum + r.netPay, 0);
    payrollRun.totalPending = records
      .filter((r) => r.status === 'generated')
      .reduce((sum, r) => sum + r.netPay, 0);
    payrollRun.totalPaid = records
      .filter((r) => r.status === 'paid')
      .reduce((sum, r) => sum + r.netPay, 0);

    await payrollRun.save();

    await logAudit({
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

    // Release processing lock on error
    if (req.body.month && req.body.year) {
      await PayrollRun.findOneAndUpdate(
        { schoolId: req.user?.schoolId, month: req.body.month, year: req.body.year },
        {
          isProcessing: false,
          processingLockExpiresAt: null,
          processingLockedBy: null,
          status: 'failed',
        }
      );
    }

    res.status(500).json({ success: false, error: error.message });
  }
});

// Mark salary as paid - Admin only
router.put(
  '/records/:id/pay',
  requireAdmin,
  validateZod(markAsPaidSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { paymentMethod, paymentReference, notes } = req.body;

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
      record.paymentDate = new Date();
      record.paymentMethod = paymentMethod || 'bank_transfer';
      record.paymentReference = paymentReference;
      record.notes = notes;
      record.isLocked = true;
      record.lockedAt = new Date();
      record.paidBy = req.user._id;

      await record.save();

      // Log audit
      await logAudit({
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

      res.json({ success: true, data: record });
    } catch (error) {
      console.error('Error marking as paid:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Reverse payment - Admin only
router.put(
  '/records/:id/reverse',
  requireAdmin,
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

      // Reset record. This is an IN-APP reversal only — the helper does
      // NOT initiate a bank / UPI / NEFT reversal, so the staff member may
      // still have received the money. `requiresBankReversal=true` is
      // surfaced on the record so finance can see outstanding real-world
      // reconciliation work, and the response payload includes a warning
      // for the admin UI to display.
      record.status = 'generated';
      record.paymentDate = null;
      record.isLocked = false;
      record.lockedAt = null;
      record.paidBy = null;
      record.requiresBankReversal = true;

      await record.save();

      // Log audit
      await logAudit({
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
        warning:
          'This is an in-app reversal only. If money has already been disbursed to the employee, initiate the bank/UPI reversal separately. Field `requiresBankReversal` is now true on this record.',
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
  requireAdmin,
  validateZod(bulkPaySchema),
  async (req, res) => {
    try {
      const { recordIds, paymentMethod, paymentReference, notes } = req.body;

      const results = {
        success: [],
        failed: [],
      };

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
          record.paymentDate = new Date();
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
          results.success.push(id);

          // Log audit for each record
          await logAudit({
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

      // Log bulk operation
      await logAudit({
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

      res.json({ success: true, data: results });
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
router.put('/records/:id', requireAdmin, validateZod(updatePayrollRecordSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const { baseSalary, allowances, deductions, status, notes } = req.body;

    const record = await PayrollRecord.findOne({ _id: id, schoolId: req.user.schoolId });

    if (!record) {
      return res.status(404).json({ success: false, error: req.t('common:routes.recordNotFound') });
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

    await record.save();

    // Log audit
    await logAudit({
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
});

// Export payroll records to CSV
router.get(
  '/export/:month/:year',
  checkPermission('payroll', 'view'),
  async (req, res) => {
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

      // Fetch staff details for each record
      const staffIds = records.map((r) => r.employeeId);
      const staffMembers = await Staff.find({ _id: { $in: staffIds } }, 'name code email');

      const staffMap = {};
      staffMembers.forEach((s) => {
        staffMap[s._id.toString()] = s;
      });

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
        const staff = staffMap[record.employeeId.toString()] || {};
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

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=payroll_${year}_${month}.csv`);
      res.send(csv);
    } catch (error) {
      console.error('Error exporting payroll:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

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
router.get('/payslips/:employeeId/:month/:year', async (req, res) => {
  try {
    const { employeeId, month, year } = req.params;

    // Authorization: user must be the employee themselves or have payroll view permission
    const isOwnPayslip = req.user._id.toString() === employeeId;
    const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
    if (!isOwnPayslip && !isAdmin) {
      return res.status(403).json({ success: false, error: 'Not authorized to view this payslip' });
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
});

// Get audit logs for payroll
router.get('/audit-logs', requireAdmin, async (req, res) => {
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
router.get('/adjustments/:employeeId', async (req, res) => {
  try {
    const { employeeId } = req.params;

    // Authorization: user must be the employee themselves or an admin
    const isOwn = req.user._id?.toString() === employeeId;
    const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
    if (!isOwn && !isAdmin) {
      return res.status(403).json({ success: false, error: 'Not authorized to view this employee\'s adjustments' });
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
});

router.post('/adjustments', requireAdmin, async (req, res) => {
  try {
    const adjustment = new SalaryAdjustment({ ...req.body, schoolId: req.user.schoolId });
    await adjustment.save();

    // Log audit
    await logAudit({
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

    res.json({ success: true, data: adjustment });
  } catch (error) {
    console.error('Error creating adjustment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/adjustments/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const adjustment = await SalaryAdjustment.findOneAndUpdate(
      { _id: id, schoolId: req.user.schoolId },
      { isActive: false }
    );

    // Log audit
    await logAudit({
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
});

export default router;
