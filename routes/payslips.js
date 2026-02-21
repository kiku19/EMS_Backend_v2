import express from 'express';
import Payslip from '../models/Payslip.js';
import PayrollRecord from '../models/PayrollRecord.js';
import { Staff } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import PDFDocument from 'pdfkit';

const router = express.Router();

// Helper to convert month number to name
const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * @route   GET /api/payslips/staff/:employeeId
 * @desc    Get all payroll records for a staff member
 * @access  Private
 */
router.get('/staff/:employeeId', authenticate, async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { year, month, limit = 24, skip = 0 } = req.query;

    const query = { employeeId };

    if (year) {
      query.year = parseInt(year);
    }
    if (month) {
      query.month = parseInt(month);
    }

    const payrollRecords = await PayrollRecord.find(query)
      .sort({ year: -1, month: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip));

    const total = await PayrollRecord.countDocuments(query);

    // Get associated payslips for file info
    const payslips = await Payslip.find({ employeeId });
    const payslipMap = new Map();
    payslips.forEach(p => {
      const key = `${p.year}-${p.month}`;
      payslipMap.set(key, p);
    });

    // Combine data
    const combinedData = payrollRecords.map(record => {
      const key = `${record.year}-${record.month}`;
      const payslip = payslipMap.get(key);
      return {
        _id: record._id,
        month: MONTH_NAMES[record.month] || `Month ${record.month}`,
        monthNumber: record.month,
        year: record.year,
        basicSalary: record.baseSalary,
        allowances: record.totalAllowances || 0,
        deductions: record.totalDeductions || 0,
        netSalary: record.netPay,
        paymentStatus: record.status,
        payslipGenerated: !!payslip,
        payslipId: payslip?._id,
        payslipFileUrl: payslip?.fileUrl,
        generatedAt: record.createdAt,
      };
    });

    res.json({
      success: true,
      payslips: combinedData,
      total,
      hasMore: skip + limit < total
    });
  } catch (error) {
    console.error('Error fetching payslips:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/payslips/:id
 * @desc    Get single payroll/payslip by ID
 * @access  Private
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const record = await PayrollRecord.findById(req.params.id);

    if (!record) {
      return res.status(404).json({
        success: false,
        message: 'Payroll record not found'
      });
    }

    // Get associated payslip
    const payslip = await Payslip.findOne({
      employeeId: record.employeeId,
      year: record.year,
      month: record.month
    });

    // Get staff details
    const staff = await Staff.findOne({ code: record.employeeId });

    res.json({
      success: true,
      payslip: {
        _id: record._id,
        month: MONTH_NAMES[record.month] || `Month ${record.month}`,
        monthNumber: record.month,
        year: record.year,
        basicSalary: record.baseSalary,
        allowances: record.totalAllowances || 0,
        deductions: record.totalDeductions || 0,
        grossPay: record.grossPay,
        netSalary: record.netPay,
        paymentStatus: record.status,
        staff: staff ? {
          name: staff.name,
          code: staff.code,
          email: staff.email
        } : null,
        payslip: payslip ? {
          fileUrl: payslip.fileUrl,
          generatedAt: payslip.generatedAt
        } : null
      }
    });
  } catch (error) {
    console.error('Error fetching payslip:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/payslips/:id/download
 * @desc    Download payslip as PDF
 * @access  Private
 */
router.get('/:id/download', authenticate, async (req, res) => {
  try {
    const record = await PayrollRecord.findById(req.params.id);

    if (!record) {
      return res.status(404).json({
        success: false,
        message: 'Payroll record not found'
      });
    }

    // Get staff details
    const staff = await Staff.findOne({ code: record.employeeId });

    // Generate PDF
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=payslip-${MONTH_NAMES[record.month]}-${record.year}.pdf`);

    // Pipe PDF to response
    doc.pipe(res);

    // PDF Content
    doc.fontSize(20).text('Payslip', { align: 'center' });
    doc.moveDown();

    doc.fontSize(12).text('School Management System', { align: 'center' });
    doc.moveDown();

    if (staff) {
      doc.fontSize(14).text(`Staff: ${staff.name} (${staff.code})`);
      doc.text(`Email: ${staff.email || 'N/A'}`);
    }
    doc.text(`Month: ${MONTH_NAMES[record.month]} ${record.year}`);

    doc.moveDown();
    doc.fontSize(10).text('Earnings:', { underline: true });
    doc.text(`Basic Salary: ${record.baseSalary}`);
    doc.text(`Allowances: ${record.totalAllowances || 0}`);
    doc.text(`Gross Pay: ${record.grossPay}`);

    doc.moveDown();
    doc.text('Deductions:', { underline: true });
    if (record.deductions && record.deductions.length > 0) {
      record.deductions.forEach(d => {
        doc.text(`  ${d.type}: ${d.amount}`);
      });
    }
    doc.text(`Total Deductions: ${record.totalDeductions || 0}`);

    doc.moveDown();
    doc.fontSize(12).text(`Net Salary: ${record.netPay}`, { underline: true });
    doc.moveDown();

    doc.fontSize(10).text(`Payment Status: ${record.status}`);
    if (record.paymentDate) {
      doc.text(`Payment Date: ${new Date(record.paymentDate).toLocaleDateString()}`);
    }

    doc.moveDown(2);
    doc.fontSize(8).text(`Generated on: ${new Date().toLocaleString()}`, { align: 'right' });

    doc.end();

  } catch (error) {
    console.error('Error downloading payslip:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/payslips/staff/:employeeId/summary
 * @desc    Get payslip summary for current year
 * @access  Private
 */
router.get('/staff/:employeeId/summary', authenticate, async (req, res) => {
  try {
    const { employeeId } = req.params;
    const currentYear = new Date().getFullYear();

    const records = await PayrollRecord.find({
      employeeId,
      year: currentYear
    });

    const totalEarnings = records.reduce((sum, r) => sum + (r.netPay || 0), 0);
    const monthlyData = records.map(r => ({
      month: MONTH_NAMES[r.month] || `Month ${r.month}`,
      monthNumber: r.month,
      netSalary: r.netPay,
      basicSalary: r.baseSalary,
      status: r.status
    }));

    res.json({
      success: true,
      year: currentYear,
      totalPayslips: records.length,
      totalEarnings,
      monthlyData
    });
  } catch (error) {
    console.error('Error fetching payslip summary:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

export default router;
