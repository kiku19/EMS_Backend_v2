import express from 'express';
const router = express.Router();
import PayrollRun from '../models/PayrollRun.js';
import PayrollRecord from '../models/PayrollRecord.js';
import Payslip from '../models/Payslip.js';
import SalaryAdjustment from '../models/SalaryAdjustment.js';

// Get payroll dashboard KPIs
router.get('/dashboard/:month/:year', async (req, res) => {
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
router.get('/records', async (req, res) => {
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

// Run payroll for a month
router.post('/run', async (req, res) => {
  try {
    const { month, year, employeeIds, staffData } = req.body;

    // Check if payroll already exists
    let payrollRun = await PayrollRun.findOne({ month, year });
    
    if (payrollRun && payrollRun.status === 'completed') {
      return res.status(400).json({
        success: false,
        error: 'Payroll already completed for this month'
      });
    }

    // Create or update payroll run
    if (!payrollRun) {
      payrollRun = new PayrollRun({
        month,
        year,
        status: 'processing',
        totalEmployees: employeeIds.length
      });
      await payrollRun.save();
    } else {
      payrollRun.status = 'processing';
      payrollRun.runDate = new Date();
      await payrollRun.save();
    }

    const results = {
      success: [],
      failed: []
    };

    // Process each employee
    for (const empId of employeeIds) {
      try {
        const employee = staffData.find(s => s.id === empId);
        if (!employee) {
          results.failed.push({ employeeId: empId, reason: 'Employee not found' });
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

        // Check if record already exists
        let record = await PayrollRecord.findOne({
          employeeId: empId,
          month,
          year
        });

        if (record) {
          // Update existing record
          record.baseSalary = employee.salary || 0;
          record.allowances = allowances;
          record.deductions = deductions;
          record.employmentType = employee.employmentType || 'full_time';
          record.status = 'generated';
        } else {
          // Create new record
          record = new PayrollRecord({
            employeeId: empId,
            payrollRunId: payrollRun._id,
            month,
            year,
            baseSalary: employee.salary || 0,
            allowances,
            deductions,
            employmentType: employee.employmentType || 'full_time',
            status: 'generated'
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
        results.failed.push({ employeeId: empId, reason: error.message });
      }
    }

    // Update payroll run
    payrollRun.processedEmployees = results.success.length;
    payrollRun.failedEmployees = results.failed.length;
    payrollRun.status = results.failed.length === 0 ? 'completed' : 'partial';
    payrollRun.completedAt = new Date();
    
    if (results.failed.length > 0) {
      payrollRun.errorLog = results.failed.map(f => `${f.employeeId}: ${f.reason}`);
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

    res.json({
      success: true,
      data: {
        payrollRun,
        results
      }
    });
  } catch (error) {
    console.error('Error running payroll:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Mark salary as paid
router.put('/records/:id/pay', async (req, res) => {
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

    record.status = 'paid';
    record.paymentDate = new Date();
    record.paymentMethod = paymentMethod || 'bank_transfer';
    record.paymentReference = paymentReference;
    record.notes = notes;
    record.isLocked = true;
    record.lockedAt = new Date();

    await record.save();

    res.json({ success: true, data: record });
  } catch (error) {
    console.error('Error marking as paid:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Bulk pay salaries
router.post('/records/bulk-pay', async (req, res) => {
  try {
    const { recordIds, paymentMethod, paymentReference } = req.body;

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

        record.status = 'paid';
        record.paymentDate = new Date();
        record.paymentMethod = paymentMethod || 'bank_transfer';
        record.paymentReference = paymentReference;
        record.isLocked = true;
        record.lockedAt = new Date();

        await record.save();
        results.success.push(id);
      } catch (error) {
        results.failed.push({ id, reason: error.message });
      }
    }

    res.json({ success: true, data: results });
  } catch (error) {
    console.error('Error bulk paying:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update payroll record
router.put('/records/:id', async (req, res) => {
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

    if (baseSalary !== undefined) record.baseSalary = baseSalary;
    if (allowances !== undefined) record.allowances = allowances;
    if (deductions !== undefined) record.deductions = deductions;
    if (status !== undefined) record.status = status;
    if (notes !== undefined) record.notes = notes;

    await record.save();

    res.json({ success: true, data: record });
  } catch (error) {
    console.error('Error updating record:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get payslip
router.get('/payslips/:employeeId/:month/:year', async (req, res) => {
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

    res.json({ success: true, data: payslip });
  } catch (error) {
    console.error('Error fetching payslip:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Salary adjustments
router.get('/adjustments/:employeeId', async (req, res) => {
  try {
    const { employeeId } = req.params;
    const adjustments = await SalaryAdjustment.find({ employeeId, isActive: true });
    res.json({ success: true, data: adjustments });
  } catch (error) {
    console.error('Error fetching adjustments:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/adjustments', async (req, res) => {
  try {
    const adjustment = new SalaryAdjustment(req.body);
    await adjustment.save();
    res.json({ success: true, data: adjustment });
  } catch (error) {
    console.error('Error creating adjustment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/adjustments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await SalaryAdjustment.findByIdAndUpdate(id, { isActive: false });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting adjustment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
