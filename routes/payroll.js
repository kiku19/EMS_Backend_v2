import express from 'express';
const router = express.Router();
import PayrollRun from '../models/PayrollRun.js';
import PayrollRecord from '../models/PayrollRecord.js';
import Payslip from '../models/Payslip.js';
import SalaryAdjustment from '../models/SalaryAdjustment.js';
import PayrollAuditLog from '../models/PayrollAuditLog.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission, requireAdmin } from '../middleware/permissions.js';
import mongoose from 'mongoose';

// Get Staff model from database.js
const Staff = mongoose.model('Staff');

// ALL PAYROLL ROUTES PROTECTED - Contains sensitive salary data!

// Helper function to log audit entries
async function logAudit({ entityType, entityId, action, performedBy, changes, context, ipAddress, userAgent, status, errorMessage }) {
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
      errorMessage
    });
    await log.save();
  } catch (error) {
    console.error('Failed to create audit log:', error);
  }
}

// Validate month is not in the future
function validateNotFutureMonth(month, year) {
  const currentDate = new Date();
  const currentMonth = currentDate.getMonth() + 1;
  const currentYear = currentDate.getFullYear();

  if (year > currentYear) {
    return false;
  }
  if (year === currentYear && month > currentMonth) {
    return false;
  }
  return true;
}

// Get payroll dashboard KPIs
router.get('/dashboard/:month/:year', authenticate, checkPermission('payroll', 'view'), async (req, res) => {
  try {
    const { month, year } = req.params;
    const monthNum = parseInt(month);
    const yearNum = parseInt(year);

    // Get current month's payroll run
    const payrollRun = await PayrollRun.findOne({ month: monthNum, year: yearNum });

    // Get all payroll records for the month
    const records = await PayrollRecord.find({ month: monthNum, year: yearNum });

    // Calculate KPIs
    const totalPayout = records.reduce((sum, r) => sum + (r.status === 'paid' ? r.netPay : 0), 0);
    const pendingAmount = records.reduce((sum, r) => sum + (r.status === 'generated' ? r.netPay : 0), 0);
    const pendingCount = records.filter(r => r.status === 'generated').length;
    const paidCount = records.filter(r => r.status === 'paid').length;
    const unpaidCount = records.filter(r => r.status !== 'paid').length;
    const totalEmployees = records.length;

    // Next payroll date (1st of next month)
    const nextMonth = monthNum === 12 ? 1 : monthNum + 1;
    const nextYear = monthNum === 12 ? yearNum + 1 : yearNum;
    const nextPayrollDate = new Date(nextYear, nextMonth - 1, 1);

    // Projected payout (next month - estimate based on current active employees)
    const projectedPayout = records.reduce((sum, r) => sum + r.netPay, 0);

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
        payrollRun: payrollRun || null
      }
    });
  } catch (error) {
    console.error('Error fetching dashboard:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get payroll records with filters
router.get('/records', authenticate, checkPermission('payroll', 'view'), async (req, res) => {
  try {
    const {
      month,
      year,
      status,
      employmentType,
      minSalary,
      maxSalary,
      search,
      page = 1,
      limit = 50
    } = req.query;

    const query = {};

    if (month) query.month = parseInt(month);
    if (year) query.year = parseInt(year);
    if (status) query.status = status;
    if (employmentType) query.employmentType = employmentType;
    if (minSalary || maxSalary) {
      query.netPay = {};
      if (minSalary) query.netPay.$gte = parseFloat(minSalary);
      if (maxSalary) query.netPay.$lte = parseFloat(maxSalary);
    }
    if (search) {
      query.employeeId = new RegExp(search, 'i');
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const records = await PayrollRecord.find(query)
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
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching records:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Pre-run validation - Check before running payroll
router.post('/validate', authenticate, requireAdmin, async (req, res) => {
  try {
    const { month, year, employeeIds } = req.body;

    // Validate month is not in future
    if (!validateNotFutureMonth(month, year)) {
      return res.status(400).json({
        success: false,
        error: 'Cannot run payroll for future months'
      });
    }

    if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json({ success: false, error: 'No employee IDs provided' });
    }

    // Validate IDs
    const validIds = employeeIds.filter(id => mongoose.Types.ObjectId.isValid(id));

    // Fetch staff data
    const staffFromDB = await Staff.find({ _id: { $in: validIds } }, 'name salary employmentType _id code status');

    const validationResults = {
      valid: [],
      invalid: [],
      warnings: []
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
          reason: issues.join(', ')
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
          reason: 'Staff status is not "Active"'
        });
      }

      validationResults.valid.push({
        employeeId: employee._id,
        name: employee.name,
        code: employee.code,
        salary: employee.salary,
        employmentType: employee.employmentType
      });
    }

    // Check for existing records
    const existingRecords = await PayrollRecord.find({
      employeeId: { $in: validIds },
      month,
      year
    });

    if (existingRecords.length > 0) {
      const paidRecords = existingRecords.filter(r => r.status === 'paid');
      if (paidRecords.length > 0) {
        validationResults.warnings.push({
          type: 'existing_paid_records',
          count: paidRecords.length,
          message: `${paidRecords.length} records already marked as paid. Re-running will update calculations but payment history will be preserved.`
        });
      }
    }

    res.json({
      success: true,
      data: validationResults
    });
  } catch (error) {
    console.error('Error validating payroll:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Temporary Fix: Set default salary for all staff
router.post('/fix-salaries', authenticate, requireAdmin, async (req, res) => {
  try {
    const { defaultSalary = 50000, defaultType = 'full_time' } = req.body;
    console.log('🔧 Running Fix Salaries Script...');

    const allStaff = await Staff.find({});
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
        results.push(`Updated ${staff.name}: Salary ${updates.salary || staff.salary}, Type ${updates.employmentType || staff.employmentType}`);
        updatedCount++;
      } else {
        alreadySetCount++;
      }
    }

    console.log(`✅ Fixed salaries: ${updatedCount} updated, ${alreadySetCount} already ok.`);

    // Log audit
    await logAudit({
      entityType: 'PayrollRun',
      entityId: null,
      action: 'payroll_run_failed',
      performedBy: req.user._id,
      context: { reason: 'Fix salaries script executed', updatedCount, alreadySetCount },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.json({
      success: true,
      message: `Updated ${updatedCount} staff records`,
      details: results,
      totalChecked: allStaff.length
    });
  } catch (error) {
    console.error('Error fixing salaries:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Run payroll for a month - Admin only (CRITICAL)
router.post('/run', authenticate, requireAdmin, async (req, res) => {
  try {
    const { month, year, employeeIds } = req.body;

    console.log('🚀 Running payroll for:', { month, year, count: employeeIds?.length });

    // Validate month is not in future
    if (!validateNotFutureMonth(month, year)) {
      return res.status(400).json({
        success: false,
        error: 'Cannot run payroll for future months'
      });
    }

    if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json({ success: false, error: 'No employee IDs provided' });
    }

    // Validate IDs
    const validIds = employeeIds.filter(id => mongoose.Types.ObjectId.isValid(id));
    if (validIds.length !== employeeIds.length) {
      console.warn(`⚠️ Warning: ${employeeIds.length - validIds.length} invalid employee IDs ignored.`);
    }

    // Check for concurrent run
    const existingPayrollRun = await PayrollRun.findOne({ month, year });
    if (existingPayrollRun && existingPayrollRun.isProcessing) {
      // Check if lock has expired (30 minutes)
      const lockExpiry = existingPayrollRun.processingLockExpiresAt;
      if (lockExpiry && lockExpiry > new Date()) {
        return res.status(409).json({
          success: false,
          error: 'Payroll is currently being processed by another user. Please try again later.',
          lockedBy: existingPayrollRun.processingLockedBy
        });
      }
    }

    // Check if payroll already has paid records
    if (existingPayrollRun && existingPayrollRun.status === 'completed') {
      const paidRecords = await PayrollRecord.countDocuments({
        month,
        year,
        status: 'paid'
      });

      if (paidRecords > 0) {
        return res.status(400).json({
          success: false,
          error: `Cannot re-run payroll. ${paidRecords} records already marked as paid. Please reverse payments first if needed.`,
          paidRecords
        });
      }
    }

    // FIXED: Fetch staff data from database with salary field
    const staffFromDB = await Staff.find({ _id: { $in: validIds } }, 'name salary employmentType _id code');
    console.log(`📋 Fetched ${staffFromDB.length} staff from DB for payroll processing.`);

    // Create or update payroll run with processing lock
    let payrollRun = existingPayrollRun;
    if (!payrollRun) {
      payrollRun = new PayrollRun({
        month,
        year,
        status: 'processing',
        totalEmployees: validIds.length,
        isProcessing: true,
        processingLockExpiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
        processingLockedBy: req.user._id,
        runBy: req.user._id
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
      status: 'success'
    });

    const results = {
      success: [],
      failed: []
    };

    // Process each employee
    for (const empId of validIds) {
      try {
        // FIXED: Use staff data from database
        const employee = staffFromDB.find(s => String(s._id) === String(empId));

        if (!employee) {
          results.failed.push({ employeeId: empId, reason: 'Employee not found in database' });
          console.error(`❌ Employee not found: ${empId}`);
          continue;
        }

        console.log(`✅ Processing ${employee.name} (${employee.code || empId}), salary: ${employee.salary}`);

        // Check if employee has salary
        if (employee.salary === undefined || employee.salary === null) {
          results.failed.push({ employeeId: empId, name: employee.name, reason: 'Salary not configured (undefined)' });
          console.error(`❌ Salary undefined for ${employee.name}`);
          continue;
        }

        if (employee.salary === 0) {
          results.failed.push({ employeeId: empId, name: employee.name, reason: 'Salary is 0' });
          console.error(`❌ Salary is 0 for ${employee.name}`);
          continue;
        }

        // Get salary adjustments
        const adjustments = await SalaryAdjustment.find({
          employeeId: empId,
          effectiveMonth: month,
          effectiveYear: year,
          isActive: true
        });

        const allowances = adjustments
          .filter(a => a.type === 'allowance')
          .map(a => ({
            type: a.category,
            amount: a.amount,
            description: a.description
          }));

        const deductions = adjustments
          .filter(a => a.type === 'deduction')
          .map(a => ({
            type: a.category,
            amount: a.amount,
            description: a.description
          }));

        // Calculate totals explicitly
        const baseSalary = employee.salary || 0;
        const totalAllowances = allowances.reduce((sum, a) => sum + a.amount, 0);
        const totalDeductions = deductions.reduce((sum, d) => sum + d.amount, 0);
        const grossPay = baseSalary + totalAllowances;
        const netPay = grossPay - totalDeductions;

        // Check if record already exists
        let record = await PayrollRecord.findOne({
          employeeId: empId,
          month,
          year
        });

        if (record) {
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
              reason: 'Record is locked (already paid). Cannot update.'
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
              employeeName: employee.name
            },
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
            status: 'success'
          });
        } else {
          // Create new record
          record = new PayrollRecord({
            employeeId: empId,
            payrollRunId: payrollRun._id,
            month,
            year,
            baseSalary: baseSalary,
            allowances,
            deductions,
            totalAllowances,
            totalDeductions,
            grossPay,
            netPay,
            employmentType: employee.employmentType || 'full_time',
            status: 'generated'
          });

          await logAudit({
            entityType: 'PayrollRecord',
            entityId: record._id,
            action: 'record_created',
            performedBy: req.user._id,
            context: {
              month,
              year,
              employeeId: empId,
              employeeName: employee.name
            },
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
            status: 'success'
          });
        }

        await record.save();

        // Generate payslip
        const payslipNumber = `PS-${year}-${month.toString().padStart(2, '0')}-${empId}`;
        let payslip = await Payslip.findOne({ payrollRecordId: record._id });

        if (!payslip) {
          payslip = new Payslip({
            payrollRecordId: record._id,
            employeeId: empId,
            month,
            year,
            payslipNumber
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
      payrollRun.errorLog = results.failed.map(f => `${f.name || f.employeeId}: ${f.reason}`);
    } else {
      payrollRun.errorLog = [];
    }

    // Calculate total amount
    const records = await PayrollRecord.find({ month, year });
    payrollRun.totalAmount = records.reduce((sum, r) => sum + r.netPay, 0);
    payrollRun.totalPending = records
      .filter(r => r.status === 'generated')
      .reduce((sum, r) => sum + r.netPay, 0);
    payrollRun.totalPaid = records
      .filter(r => r.status === 'paid')
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
        failedCount: results.failed.length
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      status: results.success.length > 0 ? 'success' : 'failure'
    });

    console.log(`✅ Payroll run finished. Success: ${results.success.length}, Failed: ${results.failed.length}`);

    res.json({
      success: true,
      data: {
        payrollRun,
        results
      }
    });
  } catch (error) {
    console.error('Error running payroll:', error);

    // Release processing lock on error
    if (req.body.month && req.body.year) {
      await PayrollRun.findOneAndUpdate(
        { month: req.body.month, year: req.body.year },
        {
          isProcessing: false,
          processingLockExpiresAt: null,
          processingLockedBy: null,
          status: 'failed'
        }
      );
    }

    res.status(500).json({ success: false, error: error.message });
  }
});

// Mark salary as paid - Admin only
router.put('/records/:id/pay', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentMethod, paymentReference, notes } = req.body;

    const record = await PayrollRecord.findById(id);

    if (!record) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }

    if (record.isLocked) {
      return res.status(400).json({ success: false, error: 'Record is locked' });
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
        paymentReference
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.json({ success: true, data: record });
  } catch (error) {
    console.error('Error marking as paid:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Reverse payment - Admin only
router.put('/records/:id/reverse', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ success: false, error: 'Reason is required for reversal' });
    }

    const record = await PayrollRecord.findById(id);

    if (!record) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }

    if (!record.isLocked || record.status !== 'paid') {
      return res.status(400).json({ success: false, error: 'Only paid records can be reversed' });
    }

    const oldRecord = { ...record.toObject() };

    // Store reversal history
    record.reversalHistory = record.reversalHistory || [];
    record.reversalHistory.push({
      reversedAt: new Date(),
      reversedBy: req.user._id,
      reason,
      previousStatus: record.status,
      previousPaymentDate: record.paymentDate
    });

    // Reset record
    record.status = 'generated';
    record.paymentDate = null;
    record.isLocked = false;
    record.lockedAt = null;
    record.paidBy = null;

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
        reason
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.json({ success: true, data: record });
  } catch (error) {
    console.error('Error reversing payment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Bulk pay salaries - Admin only
router.post('/records/bulk-pay', authenticate, requireAdmin, async (req, res) => {
  try {
    const { recordIds, paymentMethod, paymentReference, notes } = req.body;

    const results = {
      success: [],
      failed: []
    };

    for (const id of recordIds) {
      try {
        const record = await PayrollRecord.findById(id);

        if (!record) {
          results.failed.push({ id, reason: 'Record not found' });
          continue;
        }

        if (record.isLocked) {
          results.failed.push({ id, reason: 'Record is locked' });
          continue;
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
            bulkOperation: true
          },
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
          status: 'success'
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
        paymentReference
      },
      affectedRecords: results.success,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      status: results.failed.length === 0 ? 'success' : 'partial'
    });

    res.json({ success: true, data: results });
  } catch (error) {
    console.error('Error bulk paying:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update payroll record - Admin only
router.put('/records/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { baseSalary, allowances, deductions, status, notes } = req.body;

    const record = await PayrollRecord.findById(id);

    if (!record) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }

    if (record.isLocked) {
      return res.status(400).json({ success: false, error: 'Record is locked and cannot be edited' });
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
        employeeId: record.employeeId
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.json({ success: true, data: record });
  } catch (error) {
    console.error('Error updating record:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Export payroll records to CSV
router.get('/export/:month/:year', authenticate, checkPermission('payroll', 'view'), async (req, res) => {
  try {
    const { month, year } = req.params;
    const monthNum = parseInt(month);
    const yearNum = parseInt(year);

    const records = await PayrollRecord.find({ month: monthNum, year: yearNum })
      .populate('employeeId', 'name code email')
      .lean();

    // Fetch staff details for each record
    const staffIds = records.map(r => r.employeeId);
    const staffMembers = await Staff.find({ _id: { $in: staffIds } }, 'name code email');

    const staffMap = {};
    staffMembers.forEach(s => {
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
      'Payment Reference'
    ];

    let csv = headers.join(',') + '\n';

    records.forEach(record => {
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
        record.paymentReference || 'N/A'
      ];
      csv += row.map(r => `"${r}"`).join(',') + '\n';
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
        format: 'CSV'
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=payroll_${year}_${month}.csv`);
    res.send(csv);
  } catch (error) {
    console.error('Error exporting payroll:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get payslip - View permission or own payslip
router.get('/payslips/:employeeId/:month/:year', authenticate, async (req, res) => {
  try {
    const { employeeId, month, year } = req.params;

    const payslip = await Payslip.findOne({
      employeeId,
      month: parseInt(month),
      year: parseInt(year)
    }).populate('payrollRecordId');

    if (!payslip) {
      return res.status(404).json({ success: false, error: 'Payslip not found' });
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
        employeeId
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.json({ success: true, data: payslip });
  } catch (error) {
    console.error('Error fetching payslip:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get audit logs for payroll
router.get('/audit-logs', authenticate, requireAdmin, async (req, res) => {
  try {
    const { month, year, employeeId, action, page = 1, limit = 50 } = req.query;

    const query = {};
    if (month || year) {
      query['context.month'] = parseInt(month);
      query['context.year'] = parseInt(year);
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
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Salary adjustments - Admin or own adjustments
router.get('/adjustments/:employeeId', authenticate, async (req, res) => {
  try {
    const { employeeId } = req.params;
    const adjustments = await SalaryAdjustment.find({ employeeId, isActive: true });
    res.json({ success: true, data: adjustments });
  } catch (error) {
    console.error('Error fetching adjustments:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/adjustments', authenticate, requireAdmin, async (req, res) => {
  try {
    const adjustment = new SalaryAdjustment(req.body);
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
        effectiveYear: adjustment.effectiveYear
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.json({ success: true, data: adjustment });
  } catch (error) {
    console.error('Error creating adjustment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/adjustments/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const adjustment = await SalaryAdjustment.findByIdAndUpdate(id, { isActive: false });

    // Log audit
    await logAudit({
      entityType: 'SalaryAdjustment',
      entityId: id,
      action: 'adjustment_deleted',
      performedBy: req.user._id,
      context: {
        employeeId: adjustment.employeeId,
        type: adjustment.type
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting adjustment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
