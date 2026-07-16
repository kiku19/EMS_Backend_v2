import express from 'express';
import jwt from 'jsonwebtoken';
import Payslip from '../models/Payslip.js';
import PayrollRecord from '../models/PayrollRecord.js';
import { Staff } from '../database.js';
import { authenticate, extractTokenFromRequest } from '../middleware/auth.js';
import { userHasPermission } from '../middleware/auth/permissions.js';
import { getRequiredSecret } from '../config/environment.js';
import { extractSchoolId } from '../utils/schoolContext.js';
import PDFDocument from 'pdfkit';

const router = express.Router();

/**
 * @route   GET /api/payslips/:id/download
 * @desc    Download payslip as PDF
 * @access  Private (Bearer header or short-lived download token via ?token=)
 */
router.get('/:id/download', downloadTokenAuth, async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const record = await PayrollRecord.findOne(scopeBySchool(schoolId, { _id: req.params.id }));

    if (!record) {
      return res.status(404).json({
        success: false,
        message: req.t('common:routes.payrollRecordNotFound'),
      });
    }

    // Get staff details
    const staff = await Staff.findOne(scopeBySchool(schoolId, { _id: record.employeeId }));

    // Build PDF into a buffer first so any generation error can be returned as JSON
    // (once res headers are sent we can no longer send a proper error response)
    const pdfBuffer = await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

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
        record.deductions.forEach((d) => {
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
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=payslip-${MONTH_NAMES[record.month]}-${record.year}.pdf`
    );
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Error downloading payslip:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: req.t('common:routes.serverError'),
        error: error.message,
      });
    }
  }
});
router.use(authenticate);

// Authenticate via short-lived download token (query param) OR standard Bearer header.
// The download token is purpose-scoped and resource-scoped — never exposes the full auth JWT.
function downloadTokenAuth(req, res, next) {
  const queryToken = req.query.token;
  if (queryToken && !extractTokenFromRequest(req)) {
    try {
      const jwtSecret = getRequiredSecret('JWT_SECRET');
      const payload = jwt.verify(queryToken, jwtSecret);
      if (payload.purpose !== 'payslip-download') {
        return res
          .status(403)
          .json({ success: false, message: req.t('common:routes.invalidDownloadToken') });
      }
      if (payload.payslipId !== req.params.id) {
        return res.status(403).json({
          success: false,
          message: req.t('common:routes.tokenDoesNotMatchRequestedResource'),
        });
      }
      req.user = { id: payload.userId, userId: payload.userId, schoolId: payload.schoolId };
      return next();
    } catch {
      return res
        .status(401)
        .json({ success: false, message: req.t('common:routes.downloadTokenExpiredOrInvalid') });
    }
  }
  // Fall through to standard Bearer auth
  return authenticate(req, res, next);
}

function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) throw new Error('schoolId is required for scoped queries');
  return { ...query, schoolId: normalizedSchoolId };
}

// Helper to convert month number to name
const MONTH_NAMES = [
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

/**
 * @route   GET /api/payslips/staff/:employeeId
 * @desc    Get all payroll records for a staff member
 * @access  Private
 */
router.get('/staff/:employeeId', async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { year, month, limit = 24, skip = 0 } = req.query;
    const schoolId = req.user?.schoolId;

    // Verify the employee belongs to the requesting user's school
    const staffMember = await Staff.findOne(scopeBySchool(schoolId, { code: employeeId }));
    if (!staffMember) {
      return res
        .status(404)
        .json({ success: false, message: req.t('common:routes.employeeNotFoundInYourSchool') });
    }

    // Use the staff ObjectId (not the code string) to query PayrollRecord
    const staffObjectId = staffMember._id;
    const query = scopeBySchool(schoolId, { employeeId: staffObjectId });

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
    const payslips = await Payslip.find(scopeBySchool(schoolId, { employeeId: staffObjectId }));
    const payslipMap = new Map();
    payslips.forEach((p) => {
      const key = `${p.year}-${p.month}`;
      payslipMap.set(key, p);
    });

    // Combine data
    const combinedData = payrollRecords.map((record) => {
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
      hasMore: skip + limit < total,
    });
  } catch (error) {
    console.error('Error fetching payslips:', error);
    res.status(500).json({
      success: false,
      message: req.t('common:routes.serverError'),
      error: error.message,
    });
  }
});

/**
 * @route   GET /api/payslips/staff/:employeeId/summary
 * @desc    Get payslip summary for current year
 * @access  Private
 *
 * IMPORTANT: This route MUST be defined before /:id to prevent Express
 * from matching "/staff/EMP001/summary" as /:id with id="staff".
 */
router.get('/staff/:employeeId/summary', async (req, res) => {
  try {
    const { employeeId } = req.params;
    const currentYear = new Date().getFullYear();
    const schoolId = req.user?.schoolId;

    // Look up staff by code to get the ObjectId
    const staffMember = await Staff.findOne(scopeBySchool(schoolId, { code: employeeId }));
    if (!staffMember) {
      return res
        .status(404)
        .json({ success: false, message: req.t('common:routes.employeeNotFoundInYourSchool') });
    }

    const records = await PayrollRecord.find(
      scopeBySchool(schoolId, {
        employeeId: staffMember._id,
        year: currentYear,
      })
    );

    const totalEarnings = records.reduce((sum, r) => sum + (r.netPay || 0), 0);
    const monthlyData = records.map((r) => ({
      month: MONTH_NAMES[r.month] || `Month ${r.month}`,
      monthNumber: r.month,
      netSalary: r.netPay,
      basicSalary: r.baseSalary,
      status: r.status,
    }));

    res.json({
      success: true,
      year: currentYear,
      totalPayslips: records.length,
      totalEarnings,
      monthlyData,
    });
  } catch (error) {
    console.error('Error fetching payslip summary:', error);
    res.status(500).json({
      success: false,
      message: req.t('common:routes.serverError'),
      error: error.message,
    });
  }
});

/**
 * @route   POST /api/payslips/:id/download-token
 * @desc    Generate a short-lived, purpose-scoped token for payslip download
 * @access  Private
 */
router.post('/:id/download-token', async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    // Load the payroll record (school-scoped) and verify the caller is allowed
    // to download it: they must own the record (be the employee) OR hold the
    // payroll:view permission. Without this check any authenticated user could
    // mint a download token for any payslip id in the system.
    const record = await PayrollRecord.findOne(scopeBySchool(schoolId, { _id: req.params.id }));

    if (!record) {
      return res.status(404).json({
        success: false,
        message: req.t('common:routes.payrollRecordNotFound'),
      });
    }

    const isOwner =
      req.user?._id && record.employeeId && String(req.user._id) === String(record.employeeId);
    const canViewPayroll = await userHasPermission(req, 'payroll', 'view');

    if (!isOwner && !canViewPayroll) {
      return res.status(403).json({
        success: false,
        message: req.t('common:routes.payrollRecordNotFound'),
      });
    }

    const jwtSecret = getRequiredSecret('JWT_SECRET');
    const downloadToken = jwt.sign(
      {
        purpose: 'payslip-download',
        payslipId: req.params.id,
        userId: req.user.id || req.user.userId,
        schoolId: req.user.schoolId,
      },
      jwtSecret,
      { expiresIn: '5m' }
    );
    res.json({ success: true, downloadToken });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: req.t('common:routes.failedToGenerateDownloadToken') });
  }
});

/**
 * @route   GET /api/payslips/:id
 * @desc    Get single payroll/payslip by ID
 * @access  Private
 *
 * IMPORTANT: This catch-all /:id route MUST be defined after all specific
 * path routes (like /staff/:employeeId, /staff/:employeeId/summary) to
 * prevent Express from matching those paths as /:id.
 */
router.get('/:id', async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const record = await PayrollRecord.findOne(scopeBySchool(schoolId, { _id: req.params.id }));

    if (!record) {
      return res.status(404).json({
        success: false,
        message: req.t('common:routes.payrollRecordNotFound'),
      });
    }

    // Get associated payslip
    const payslip = await Payslip.findOne(
      scopeBySchool(schoolId, {
        employeeId: record.employeeId,
        year: record.year,
        month: record.month,
      })
    );

    // Get staff details
    const staff = await Staff.findOne(scopeBySchool(schoolId, { _id: record.employeeId }));

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
        staff: staff
          ? {
              name: staff.name,
              code: staff.code,
              email: staff.email,
            }
          : null,
        payslip: payslip
          ? {
              fileUrl: payslip.fileUrl,
              generatedAt: payslip.generatedAt,
            }
          : null,
      },
    });
  } catch (error) {
    console.error('Error fetching payslip:', error);
    res.status(500).json({
      success: false,
      message: req.t('common:routes.serverError'),
      error: error.message,
    });
  }
});

export default router;
