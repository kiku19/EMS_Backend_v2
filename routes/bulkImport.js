import express from 'express';
import { Readable } from 'stream';
import crypto from 'crypto';
import ExcelJS from 'exceljs';
import multer from 'multer';
import mongoose from 'mongoose';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { extractSchoolId } from '../utils/schoolContext.js';
import {
  getNextStaffCode,
  getNextAdmissionId,
  getNextReceiptNumber,
  Class,
  Staff,
  Student,
  StudentFeeStructure,
  FeePayment,
  Attendance,
  Result,
} from '../database.js';
import FeeHead from '../models/FeeHead.js';
import ImportJob from '../models/ImportJob.js';
import { computeFeeBalance } from '../utils/feeCalculator.js';
import { applyLateFeeToFeeStructure } from '../utils/lateFeeCalculator.js';
import {
  studentRowSchema,
  staffRowSchema,
  feePaymentRowSchema,
  attendanceCorrectionRowSchema,
  examResultRowSchema,
} from '../validators/bulkImportSchema.js';
import { createLogger } from '../utils/logger.js';
import agenda from '../config/agenda.js';
import { piiMatch } from '../utils/encryption.js';
import { updateFeeStructureWithRetry } from '../utils/sfsConcurrency.js';

const router = express.Router();
router.use(authenticate);
const logger = createLogger('BulkImport');

// In-memory storage — files are NOT saved to disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB cap
  fileFilter(_req, file, cb) {
    const allowed = new Set([
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ]);
    if (allowed.has(file.mimetype) || file.originalname.match(/\.(csv|xlsx|xls)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and Excel files are supported'));
    }
  },
});

const LARGE_IMPORT_THRESHOLD = 500;

// ─── CSV TEMPLATES ──────────────────────────────────────────────

const TEMPLATES = {
  students: {
    headers: [
      'name',
      'admissionId',
      'academicYear',
      'className',
      'section',
      'rollNo',
      'gender',
      'dateOfBirth',
      'parentName',
      'parentPhone',
      'parentEmail',
      'phone',
      'email',
      'address',
    ],
  },
  staff: {
    headers: [
      'name',
      'role',
      'department',
      'phone',
      'email',
      'gender',
      'joinDate',
      'designation',
      'salary',
    ],
  },
  fees: {
    headers: [
      'admissionId',
      'academicYear',
      'amount',
      'paymentDate',
      'paymentMode',
      'receiptNumber',
      'remarks',
    ],
  },
  attendance: {
    headers: ['admissionId', 'date', 'status'],
  },
  results: {
    headers: ['admissionId', 'marksObtained', 'maxMarks', 'remarks'],
  },
};

// GET /bulk-import/template/:type — download CSV template
router.get('/template/:type', (req, res) => {
  const { type } = req.params;
  const tpl = TEMPLATES[type];
  if (!tpl) {
    return res
      .status(400)
      .json({ error: `Invalid template type. Use: ${Object.keys(TEMPLATES).join(', ')}` });
  }

  const csvContent = tpl.headers.join(',');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="bulk-import-${type}-template.csv"`);
  res.send(csvContent);
});

// ─── FILE PARSER ─────────────────────────────────────────────────

async function parseFile(buffer, mimetype, originalname) {
  const workbook = new ExcelJS.Workbook();
  const stream = Readable.from(buffer);

  const isCsv = mimetype === 'text/csv' || /\.csv$/i.test(originalname);
  if (isCsv) {
    await workbook.csv.read(stream);
  } else {
    await workbook.xlsx.read(stream);
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('No worksheet found in file');

  const headers = [];
  const rows = [];

  worksheet.eachRow((row, rowIndex) => {
    if (rowIndex === 1) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        headers.push(
          String(cell.value ?? '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '')
        );
      });
    } else {
      const rowData = {};
      row.eachCell({ includeEmpty: true }, (cell, colIndex) => {
        const header = headers[colIndex - 1];
        if (header) {
          rowData[header] =
            cell.value === null || cell.value === undefined ? '' : String(cell.value).trim();
        }
      });
      // Skip fully empty rows
      if (Object.values(rowData).some((v) => v !== '')) {
        rows.push(rowData);
      }
    }
  });

  return { headers, rows };
}

// ─── IMPORT JOB HELPERS ──────────────────────────────────────────

async function createImportJob(schoolId, type, fileName, totalRows, dryRun, userId) {
  const job = new ImportJob({
    schoolId,
    type,
    fileName,
    totalRows,
    dryRun: !!dryRun,
    status: 'running',
    initiatedBy: userId || undefined,
  });
  await job.save();
  return job;
}

async function finalizeImportJob(job, results) {
  job.status =
    results.failed.length === results.rows.length + results.failed.length && results.imported === 0
      ? 'failed'
      : 'completed';
  job.processedRows = results.imported + results.skipped + results.failed.length;
  job.importedCount = results.imported;
  job.skippedCount = results.skipped;
  job.failedCount = results.failed.length;
  job.rows = [
    ...results.rows.map((r) => ({
      row: r.row,
      identifier: r.admissionId || r.name || r.code,
      status: 'imported',
    })),
    ...results.failed.map((r) => ({
      row: r.row,
      identifier: r.admissionId || r.name || '?',
      status: 'failed',
      error: r.error,
    })),
  ];
  job.completedAt = new Date();
  await job.save();
  return job;
}

// GET /bulk-import/history — list import jobs for school
router.get('/history', async (req, res) => {
  try {
    const schoolId = extractSchoolId(req.user?.schoolId);
    if (!schoolId) return res.status(400).json({ error: req.t('common:errors.unauthorized') });

    const { type, limit = 20, page = 1 } = req.query;
    const filter = { schoolId };
    if (type) filter.type = type;

    const skip = (Number(page) - 1) * Number(limit);
    const [jobs, total] = await Promise.all([
      ImportJob.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      ImportJob.countDocuments(filter),
    ]);

    res.json({ jobs, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    logger.error({ err }, 'Import history fetch error');
    res.status(500).json({ error: err.message });
  }
});

// GET /bulk-import/history/:jobId — get specific import job
router.get('/history/:jobId', async (req, res) => {
  try {
    const schoolId = extractSchoolId(req.user?.schoolId);
    const job = await ImportJob.findOne({ _id: req.params.jobId, schoolId }).lean();
    if (!job) return res.status(404).json({ error: 'Import job not found' });
    res.json({ job });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /bulk-import/history/:jobId/rollback — rollback a completed import
router.post('/history/:jobId/rollback', checkPermission('students', 'delete'), async (req, res) => {
  try {
    const schoolId = extractSchoolId(req.user?.schoolId);
    const job = await ImportJob.findOne({ _id: req.params.jobId, schoolId });
    if (!job) return res.status(404).json({ error: 'Import job not found' });
    if (job.status !== 'completed')
      return res.status(400).json({ error: 'Only completed imports can be rolled back' });
    if (job.dryRun)
      return res.status(400).json({ error: 'Dry-run imports have no data to roll back' });
    if (!job.createdIds || job.createdIds.length === 0)
      return res.status(400).json({ error: 'No rollback data available for this import' });

    let deletedCount = 0;
    if (job.type === 'students') {
      const result = await Student.deleteMany({ _id: { $in: job.createdIds }, schoolId });
      deletedCount = result.deletedCount;
    } else if (job.type === 'staff') {
      const result = await Staff.deleteMany({ _id: { $in: job.createdIds }, schoolId });
      deletedCount = result.deletedCount;
    } else if (job.type === 'fees') {
      const result = await FeePayment.deleteMany({ _id: { $in: job.createdIds }, schoolId });
      deletedCount = result.deletedCount;
    } else if (job.type === 'attendance') {
      const result = await Attendance.deleteMany({ _id: { $in: job.createdIds }, schoolId });
      deletedCount = result.deletedCount;
    } else if (job.type === 'results') {
      const result = await Result.deleteMany({ _id: { $in: job.createdIds }, schoolId });
      deletedCount = result.deletedCount;
    } else {
      return res.status(400).json({ error: `Rollback not supported for type: ${job.type}` });
    }

    job.status = 'rolled_back';
    await job.save();

    res.json({ message: `Rollback complete. ${deletedCount} records deleted.`, deletedCount });
  } catch (err) {
    logger.error({ err }, 'Import rollback error');
    res.status(500).json({ error: err.message });
  }
});

// ─── STUDENT FEE STRUCTURE INIT ──────────────────────────────────

async function initializeStudentFeeStructure(student) {
  const classInfo = await Class.findById(student.classId);
  if (!classInfo) return;

  const classNumber = classInfo.name.replace('Class ', '');
  const applicableFeeHeads = await FeeHead.find({
    schoolId: student.schoolId,
    applicableClasses: classNumber,
    academicYear: student.academicYear,
    isActive: true,
  });

  if (!applicableFeeHeads.length) return;

  const feeStructure = new StudentFeeStructure({
    studentId: student._id,
    classId: student.classId,
    academicYear: student.academicYear,
    schoolId: student.schoolId,
    feeHeads: applicableFeeHeads.map((fh) => ({
      feeHeadId: fh._id,
      name: fh.name,
      category: fh.category,
      amount: fh.amount,
      mandatory: fh.mandatory,
      frequency: fh.frequency,
      paidAmount: 0,
      balanceAmount: fh.amount,
      status: 'pending',
    })),
  });

  feeStructure.totalFee = feeStructure.feeHeads.reduce((s, fh) => s + fh.amount, 0);
  feeStructure.totalPaid = 0;
  feeStructure.totalBalance = feeStructure.totalFee;
  feeStructure.overallStatus = 'pending';

  await feeStructure.save();
}

// ─── STUDENT IMPORT ─────────────────────────────────────────────

// POST /bulk-import/students[?dryRun=true]
router.post(
  '/students',
  checkPermission('students', 'create'),
  upload.single('file'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const schoolId = extractSchoolId(req.user?.schoolId);
    if (!schoolId) return res.status(400).json({ error: req.t('common:errors.unauthorized') });

    const dryRun = req.query.dryRun === 'true';
    const results = { imported: 0, skipped: 0, failed: [], rows: [] };

    try {
      const { rows } = await parseFile(req.file.buffer, req.file.mimetype, req.file.originalname);
      if (!rows.length) return res.status(400).json({ error: 'File is empty or has no data rows' });

      // For large imports, queue as background job
      if (!dryRun && rows.length > LARGE_IMPORT_THRESHOLD) {
        const job = await createImportJob(
          schoolId,
          'students',
          req.file.originalname,
          rows.length,
          false,
          req.user?._id
        );
        await agenda.now('bulk import students', {
          jobId: job._id.toString(),
          schoolId: schoolId.toString(),
          rows,
        });
        return res.status(202).json({
          message: `Large import queued. ${rows.length} rows will be processed in background.`,
          jobId: job._id,
          status: 'queued',
        });
      }

      const createdIds = [];

      for (let i = 0; i < rows.length; i++) {
        const rowNum = i + 2;
        const raw = rows[i];

        const parsed = studentRowSchema.safeParse({
          name: raw.name,
          admissionId: raw.admissionid || raw.admissionId || raw.admission_id,
          academicYear: raw.academicyear || raw.academicYear || raw.academic_year,
          className: raw.classname || raw.className || raw.class,
          section: raw.section,
          rollNo: raw.rollno || raw.rollNo || raw.roll_no || undefined,
          gender: raw.gender || undefined,
          dateOfBirth:
            raw.dateofbirth || raw.dateOfBirth || raw.dob || raw.date_of_birth || undefined,
          parentName: raw.parentname || raw.parentName || raw.parent_name,
          parentPhone: raw.parentphone || raw.parentPhone || raw.parent_phone || undefined,
          parentEmail: raw.parentemail || raw.parentEmail || raw.parent_email || undefined,
          phone: raw.phone || undefined,
          email: raw.email || undefined,
          address: raw.address || undefined,
        });

        if (!parsed.success) {
          const errors = parsed.error.issues
            .map((e) => `${e.path.join('.')}: ${e.message}`)
            .join('; ');
          results.failed.push({
            row: rowNum,
            admissionId: raw.admissionid || raw.admissionId || '?',
            error: errors,
          });
          continue;
        }

        const data = parsed.data;

        const classNameFull = data.className.startsWith('Class ')
          ? data.className
          : `Class ${data.className}`;
        const classDoc = await Class.findOne({
          schoolId,
          name: classNameFull,
          section: data.section.toUpperCase(),
          isDeleted: { $ne: true },
        });

        if (!classDoc) {
          results.failed.push({
            row: rowNum,
            admissionId: data.admissionId,
            error: `Class '${data.className}-${data.section}' not found`,
          });
          continue;
        }

        const existing = await Student.findOne({
          schoolId,
          admissionId: data.admissionId,
          isDeleted: { $ne: true },
        });
        if (existing) {
          results.failed.push({
            row: rowNum,
            admissionId: data.admissionId,
            error: `Admission ID '${data.admissionId}' already exists`,
          });
          results.skipped++;
          continue;
        }

        if (dryRun) {
          results.imported++;
          results.rows.push({
            row: rowNum,
            admissionId: data.admissionId,
            name: data.name,
            status: 'imported',
          });
          continue;
        }

        try {
          const student = new Student({
            schoolId,
            name: data.name,
            admissionId: data.admissionId,
            academicYear: data.academicYear,
            classId: classDoc._id,
            rollNo: data.rollNo || undefined,
            gender: data.gender || undefined,
            dateOfBirth: data.dateOfBirth || undefined,
            parents: [
              {
                name: data.parentName,
                phone: data.parentPhone || undefined,
                email: data.parentEmail || undefined,
                relationship: 'Parent',
                isWhatsapp: false,
              },
            ],
            phone: data.phone || undefined,
            email: data.email || undefined,
            address: data.address || undefined,
            feeStatus: 'pending',
            status: 'active',
          });

          await student.save();
          await initializeStudentFeeStructure(student);
          createdIds.push(student._id);

          results.imported++;
          results.rows.push({
            row: rowNum,
            admissionId: data.admissionId,
            name: data.name,
            status: 'imported',
          });
        } catch (saveErr) {
          logger.error({ err: saveErr, row: rowNum }, 'Student save error in bulk import');
          results.failed.push({
            row: rowNum,
            admissionId: data.admissionId,
            error: saveErr.message,
          });
        }
      }

      // Save job record
      if (!dryRun) {
        const job = await createImportJob(
          schoolId,
          'students',
          req.file.originalname,
          rows.length,
          false,
          req.user?._id
        );
        job.createdIds = createdIds;
        await finalizeImportJob(job, results);
      }

      res.json({
        message: `${dryRun ? '[DRY RUN] ' : ''}Import complete: ${results.imported} imported, ${results.skipped} skipped, ${results.failed.length} failed`,
        dryRun,
        ...results,
      });
    } catch (err) {
      logger.error({ err }, 'Student bulk import error');
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── STAFF IMPORT ────────────────────────────────────────────────

function generatePassword(length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(crypto.randomInt(chars.length));
  }
  return password;
}

async function ensureUniqueUsername(baseUsername, schoolId) {
  let username = baseUsername;
  let suffix = 1;
  while (await Staff.findOne({ schoolId, username, isDeleted: { $ne: true } })) {
    username = `${baseUsername}${suffix}`;
    suffix++;
  }
  return username;
}

// POST /bulk-import/staff[?dryRun=true]
router.post(
  '/staff',
  checkPermission('staff', 'create'),
  upload.single('file'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const schoolId = extractSchoolId(req.user?.schoolId);
    if (!schoolId) return res.status(400).json({ error: req.t('common:errors.unauthorized') });

    const dryRun = req.query.dryRun === 'true';
    const results = { imported: 0, skipped: 0, failed: [], rows: [] };

    try {
      const { rows } = await parseFile(req.file.buffer, req.file.mimetype, req.file.originalname);
      if (!rows.length) return res.status(400).json({ error: 'File is empty or has no data rows' });

      if (!dryRun && rows.length > LARGE_IMPORT_THRESHOLD) {
        const job = await createImportJob(
          schoolId,
          'staff',
          req.file.originalname,
          rows.length,
          false,
          req.user?._id
        );
        await agenda.now('bulk import staff', {
          jobId: job._id.toString(),
          schoolId: schoolId.toString(),
          rows,
        });
        return res.status(202).json({
          message: `Large import queued. ${rows.length} rows will be processed in background.`,
          jobId: job._id,
          status: 'queued',
        });
      }

      const createdIds = [];

      for (let i = 0; i < rows.length; i++) {
        const rowNum = i + 2;
        const raw = rows[i];

        const parsed = staffRowSchema.safeParse({
          name: raw.name,
          role: raw.role,
          department: raw.department || undefined,
          phone: raw.phone || undefined,
          email: raw.email || undefined,
          gender: raw.gender || undefined,
          joinDate: raw.joindate || raw.joinDate || raw.join_date || undefined,
          designation: raw.designation || undefined,
          salary: raw.salary || undefined,
        });

        if (!parsed.success) {
          const errors = parsed.error.issues
            .map((e) => `${e.path.join('.')}: ${e.message}`)
            .join('; ');
          results.failed.push({ row: rowNum, name: raw.name || '?', error: errors });
          continue;
        }

        const data = parsed.data;

        if (data.email) {
          const existing = await Staff.findOne({
            schoolId,
            ...piiMatch('email', data.email.toLowerCase()),
            isDeleted: { $ne: true },
          });
          if (existing) {
            results.failed.push({
              row: rowNum,
              name: data.name,
              error: `Email '${data.email}' already in use by ${existing.name}`,
            });
            results.skipped++;
            continue;
          }
        }

        if (dryRun) {
          results.imported++;
          results.rows.push({ row: rowNum, name: data.name, status: 'imported' });
          continue;
        }

        try {
          const code = await getNextStaffCode(schoolId);
          const baseUsername = data.email
            ? data.email.split('@')[0].toLowerCase()
            : code.toLowerCase();
          const username = await ensureUniqueUsername(baseUsername, schoolId);
          const password = generatePassword(8);

          const staff = new Staff({
            schoolId,
            code,
            name: data.name,
            role: [data.role],
            department: data.department || 'General',
            status: 'active',
            phone: data.phone || undefined,
            email: data.email ? data.email.toLowerCase() : undefined,
            joinDate: data.joinDate || undefined,
            designation: data.designation || undefined,
            gender: data.gender || undefined,
            salary: data.salary || undefined,
            username,
            password,
          });

          await staff.save();
          createdIds.push(staff._id);

          results.imported++;
          results.rows.push({ row: rowNum, name: data.name, code, status: 'imported' });
        } catch (saveErr) {
          logger.error({ err: saveErr, row: rowNum }, 'Staff save error in bulk import');
          results.failed.push({ row: rowNum, name: data.name, error: saveErr.message });
        }
      }

      if (!dryRun) {
        const job = await createImportJob(
          schoolId,
          'staff',
          req.file.originalname,
          rows.length,
          false,
          req.user?._id
        );
        job.createdIds = createdIds;
        await finalizeImportJob(job, results);
      }

      res.json({
        message: `${dryRun ? '[DRY RUN] ' : ''}Import complete: ${results.imported} imported, ${results.skipped} skipped, ${results.failed.length} failed`,
        dryRun,
        ...results,
      });
    } catch (err) {
      logger.error({ err }, 'Staff bulk import error');
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── FEE PAYMENT IMPORT ──────────────────────────────────────────

// POST /bulk-import/fees[?dryRun=true]
router.post('/fees', checkPermission('fees', 'create'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const schoolId = extractSchoolId(req.user?.schoolId);
  if (!schoolId) return res.status(400).json({ error: req.t('common:errors.unauthorized') });

  const dryRun = req.query.dryRun === 'true';
  const results = { imported: 0, skipped: 0, failed: [], rows: [] };

  try {
    const { rows } = await parseFile(req.file.buffer, req.file.mimetype, req.file.originalname);
    if (!rows.length) return res.status(400).json({ error: 'File is empty or has no data rows' });

    const usedReceiptNumbers = new Set();
    const createdIds = [];

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 2;
      const raw = rows[i];

      const parsed = feePaymentRowSchema.safeParse({
        admissionId: raw.admissionid || raw.admissionId || raw.admission_id,
        academicYear: raw.academicyear || raw.academicYear || raw.academic_year,
        amount: raw.amount,
        paymentDate: raw.paymentdate || raw.paymentDate || raw.payment_date,
        paymentMode: raw.paymentmode || raw.paymentMode || raw.payment_mode,
        receiptNumber: raw.receiptnumber || raw.receiptNumber || raw.receipt_number || undefined,
        remarks: raw.remarks || undefined,
      });

      if (!parsed.success) {
        const errors = parsed.error.issues
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join('; ');
        results.failed.push({
          row: rowNum,
          admissionId: raw.admissionid || raw.admissionId || '?',
          error: errors,
        });
        continue;
      }

      const data = parsed.data;

      const student = await Student.findOne({
        schoolId,
        admissionId: data.admissionId,
        isDeleted: { $ne: true },
      });
      if (!student) {
        results.failed.push({
          row: rowNum,
          admissionId: data.admissionId,
          error: `Student with admissionId '${data.admissionId}' not found`,
        });
        continue;
      }

      let receiptNumber = data.receiptNumber;
      if (!receiptNumber) {
        receiptNumber = await getNextReceiptNumber(schoolId);
      }

      if (usedReceiptNumbers.has(receiptNumber)) {
        receiptNumber = await getNextReceiptNumber(schoolId);
      }

      const existingReceipt = await FeePayment.findOne({ schoolId, receiptNumber });
      if (existingReceipt) {
        receiptNumber = await getNextReceiptNumber(schoolId);
      }

      usedReceiptNumbers.add(receiptNumber);

      if (dryRun) {
        results.imported++;
        results.rows.push({
          row: rowNum,
          admissionId: data.admissionId,
          receiptNumber: '(dry-run)',
          amount: data.amount,
          status: 'imported',
        });
        continue;
      }

      try {
        const payment = new FeePayment({
          schoolId,
          studentId: student._id,
          classId: student.classId,
          academicYear: data.academicYear,
          receiptNumber,
          paymentDate: data.paymentDate,
          amount: data.amount,
          paymentMode: data.paymentMode,
          remarks: data.remarks || undefined,
          status: 'completed',
        });

        await payment.save();
        createdIds.push(payment._id);

        try {
          await Student.findByIdAndUpdate(student._id, {
            $inc: { 'feeDetails.paidAmount': data.amount },
          });

          // Retry-on-VersionError + scope by schoolId so we don't pick up
          // a cross-tenant row on collision.
          await updateFeeStructureWithRetry(
            {
              studentId: student._id,
              schoolId: student.schoolId,
              academicYear: data.academicYear,
            },
            async (sfs) => {
              sfs.totalPaid = (sfs.totalPaid || 0) + data.amount;
              // Use the canonical calculator so discountApplied AND
              // lateFeeApplied are factored in — the previous hand-rolled
              // math dropped both (and over-counted the balance for any
              // discounted or overdue student).
              await applyLateFeeToFeeStructure(sfs);
              const { totalBalance, overallStatus } = computeFeeBalance(sfs);
              sfs.totalBalance = totalBalance;
              sfs.overallStatus = overallStatus;
            }
          );
        } catch (updateErr) {
          logger.warn(
            { err: updateErr, studentId: student._id },
            'Could not update fee summary after bulk import payment'
          );
        }

        results.imported++;
        results.rows.push({
          row: rowNum,
          admissionId: data.admissionId,
          receiptNumber,
          amount: data.amount,
          status: 'imported',
        });
      } catch (saveErr) {
        logger.error({ err: saveErr, row: rowNum }, 'Fee payment save error in bulk import');
        results.failed.push({
          row: rowNum,
          admissionId: data.admissionId,
          error: saveErr.message,
        });
      }
    }

    if (!dryRun) {
      const job = await createImportJob(
        schoolId,
        'fees',
        req.file.originalname,
        rows.length,
        false,
        req.user?._id
      );
      job.createdIds = createdIds;
      await finalizeImportJob(job, results);
    }

    res.json({
      message: `${dryRun ? '[DRY RUN] ' : ''}Import complete: ${results.imported} imported, ${results.skipped} skipped, ${results.failed.length} failed`,
      dryRun,
      ...results,
    });
  } catch (err) {
    logger.error({ err }, 'Fee bulk import error');
    res.status(500).json({ error: err.message });
  }
});

// ─── ATTENDANCE CORRECTION IMPORT ────────────────────────────────

// POST /bulk-import/attendance[?dryRun=true]
// Body or query: classId (optional filter for lookup), examId not needed here
router.post(
  '/attendance',
  checkPermission('attendance', 'create'),
  upload.single('file'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const schoolId = extractSchoolId(req.user?.schoolId);
    if (!schoolId) return res.status(400).json({ error: req.t('common:errors.unauthorized') });

    const dryRun = req.query.dryRun === 'true';
    const results = { imported: 0, skipped: 0, failed: [], rows: [] };

    try {
      const { rows } = await parseFile(req.file.buffer, req.file.mimetype, req.file.originalname);
      if (!rows.length) return res.status(400).json({ error: 'File is empty or has no data rows' });

      const createdIds = [];

      for (let i = 0; i < rows.length; i++) {
        const rowNum = i + 2;
        const raw = rows[i];

        const parsed = attendanceCorrectionRowSchema.safeParse({
          admissionId: raw.admissionid || raw.admissionId || raw.admission_id,
          date: raw.date,
          status: raw.status,
        });

        if (!parsed.success) {
          const errors = parsed.error.issues
            .map((e) => `${e.path.join('.')}: ${e.message}`)
            .join('; ');
          results.failed.push({
            row: rowNum,
            admissionId: raw.admissionid || raw.admissionId || '?',
            error: errors,
          });
          continue;
        }

        const data = parsed.data;

        const student = await Student.findOne({
          schoolId,
          admissionId: data.admissionId,
          isDeleted: { $ne: true },
        }).select('_id classId');
        if (!student) {
          results.failed.push({
            row: rowNum,
            admissionId: data.admissionId,
            error: `Student '${data.admissionId}' not found`,
          });
          continue;
        }

        if (dryRun) {
          results.imported++;
          results.rows.push({
            row: rowNum,
            admissionId: data.admissionId,
            date: data.date,
            status: data.status,
          });
          continue;
        }

        try {
          // Upsert: update existing attendance record or create new
          const result = await Attendance.findOneAndUpdate(
            { schoolId, studentId: student._id, date: data.date },
            {
              schoolId,
              studentId: student._id,
              classId: student.classId,
              date: data.date,
              status: data.status,
              markedBy: req.user?._id || undefined,
            },
            { upsert: true, new: true }
          );

          createdIds.push(result._id);
          results.imported++;
          results.rows.push({
            row: rowNum,
            admissionId: data.admissionId,
            date: data.date,
            status: data.status,
          });
        } catch (saveErr) {
          logger.error({ err: saveErr, row: rowNum }, 'Attendance save error in bulk import');
          results.failed.push({
            row: rowNum,
            admissionId: data.admissionId,
            error: saveErr.message,
          });
        }
      }

      if (!dryRun) {
        const job = await createImportJob(
          schoolId,
          'attendance',
          req.file.originalname,
          rows.length,
          false,
          req.user?._id
        );
        job.createdIds = createdIds;
        await finalizeImportJob(job, results);
      }

      res.json({
        message: `${dryRun ? '[DRY RUN] ' : ''}Attendance correction complete: ${results.imported} updated, ${results.failed.length} failed`,
        dryRun,
        ...results,
      });
    } catch (err) {
      logger.error({ err }, 'Attendance bulk import error');
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── EXAM RESULTS IMPORT ─────────────────────────────────────────

// POST /bulk-import/results/:examId[?dryRun=true]
router.post(
  '/results/:examId',
  checkPermission('academics', 'create'),
  upload.single('file'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!mongoose.Types.ObjectId.isValid(req.params.examId)) {
      return res.status(400).json({ error: 'Invalid examId' });
    }

    const schoolId = extractSchoolId(req.user?.schoolId);
    if (!schoolId) return res.status(400).json({ error: req.t('common:errors.unauthorized') });

    const dryRun = req.query.dryRun === 'true';
    const examId = req.params.examId;
    const results = { imported: 0, skipped: 0, failed: [], rows: [] };

    try {
      const { rows } = await parseFile(req.file.buffer, req.file.mimetype, req.file.originalname);
      if (!rows.length) return res.status(400).json({ error: 'File is empty or has no data rows' });

      const createdIds = [];

      for (let i = 0; i < rows.length; i++) {
        const rowNum = i + 2;
        const raw = rows[i];

        const parsed = examResultRowSchema.safeParse({
          admissionId: raw.admissionid || raw.admissionId || raw.admission_id,
          marksObtained: raw.marksobtained || raw.marksObtained || raw.marks_obtained || raw.marks,
          maxMarks: raw.maxmarks || raw.maxMarks || raw.max_marks || undefined,
          remarks: raw.remarks || undefined,
        });

        if (!parsed.success) {
          const errors = parsed.error.issues
            .map((e) => `${e.path.join('.')}: ${e.message}`)
            .join('; ');
          results.failed.push({
            row: rowNum,
            admissionId: raw.admissionid || raw.admissionId || '?',
            error: errors,
          });
          continue;
        }

        const data = parsed.data;

        const student = await Student.findOne({
          schoolId,
          admissionId: data.admissionId,
          isDeleted: { $ne: true },
        }).select('_id classId academicYear');
        if (!student) {
          results.failed.push({
            row: rowNum,
            admissionId: data.admissionId,
            error: `Student '${data.admissionId}' not found`,
          });
          continue;
        }

        if (dryRun) {
          results.imported++;
          results.rows.push({
            row: rowNum,
            admissionId: data.admissionId,
            marksObtained: data.marksObtained,
          });
          continue;
        }

        try {
          const maxMarks = data.maxMarks || 100;
          const percentage =
            maxMarks > 0 ? Math.round((data.marksObtained / maxMarks) * 100 * 100) / 100 : 0;

          const result = await Result.findOneAndUpdate(
            { schoolId, examId, studentId: student._id, isDeleted: { $ne: true } },
            {
              schoolId,
              examId,
              studentId: student._id,
              classId: student.classId,
              academicYear: student.academicYear,
              marksObtained: data.marksObtained,
              maxMarks,
              totalMarksObtained: data.marksObtained,
              totalMaxMarks: maxMarks,
              percentage,
              remarks: data.remarks || undefined,
              enteredBy: req.user?._id || undefined,
              enteredAt: new Date(),
            },
            { upsert: true, new: true }
          );

          createdIds.push(result._id);
          results.imported++;
          results.rows.push({
            row: rowNum,
            admissionId: data.admissionId,
            marksObtained: data.marksObtained,
            percentage,
            status: 'imported',
          });
        } catch (saveErr) {
          logger.error({ err: saveErr, row: rowNum }, 'Result save error in bulk import');
          results.failed.push({
            row: rowNum,
            admissionId: data.admissionId,
            error: saveErr.message,
          });
        }
      }

      if (!dryRun) {
        const job = await createImportJob(
          schoolId,
          'results',
          req.file.originalname,
          rows.length,
          false,
          req.user?._id
        );
        job.createdIds = createdIds;
        job.rollbackData = { examId };
        await finalizeImportJob(job, results);
      }

      res.json({
        message: `${dryRun ? '[DRY RUN] ' : ''}Results import complete: ${results.imported} imported, ${results.failed.length} failed`,
        dryRun,
        ...results,
      });
    } catch (err) {
      logger.error({ err }, 'Results bulk import error');
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── BULK DELETE / ARCHIVE ──────────────────────────────────────

// POST /bulk-import/bulk-delete — bulk soft-delete students or staff
router.post('/bulk-delete', checkPermission('students', 'delete'), async (req, res) => {
  const schoolId = extractSchoolId(req.user?.schoolId);
  if (!schoolId) return res.status(400).json({ error: req.t('common:errors.unauthorized') });

  const { ids, type } = req.body;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array is required' });
  }
  if (!['students', 'staff'].includes(type)) {
    return res.status(400).json({ error: 'type must be "students" or "staff"' });
  }
  if (ids.length > 500) {
    return res.status(400).json({ error: 'Cannot delete more than 500 records at once' });
  }

  const validIds = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (validIds.length !== ids.length) {
    return res.status(400).json({ error: 'One or more IDs are invalid' });
  }

  try {
    const Model = type === 'students' ? Student : Staff;
    const result = await Model.updateMany(
      { _id: { $in: validIds }, schoolId, isDeleted: { $ne: true } },
      { isDeleted: true, deletedAt: new Date() }
    );

    res.json({
      message: `${result.modifiedCount} ${type} archived successfully`,
      modifiedCount: result.modifiedCount,
      requestedCount: validIds.length,
    });
  } catch (err) {
    logger.error({ err }, 'Bulk delete error');
    res.status(500).json({ error: err.message });
  }
});

// ─── BULK SMS / NOTIFICATION ────────────────────────────────────

// POST /bulk-import/bulk-notify — send SMS or push notification to multiple students/parents
router.post('/bulk-notify', checkPermission('students', 'read'), async (req, res) => {
  const schoolId = extractSchoolId(req.user?.schoolId);
  if (!schoolId) return res.status(400).json({ error: req.t('common:errors.unauthorized') });

  const { studentIds, classIds, message, channel } = req.body;

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'message is required' });
  }
  if (!['sms', 'push', 'both'].includes(channel)) {
    return res.status(400).json({ error: 'channel must be "sms", "push", or "both"' });
  }
  if ((!studentIds || studentIds.length === 0) && (!classIds || classIds.length === 0)) {
    return res.status(400).json({ error: 'Either studentIds or classIds must be provided' });
  }

  try {
    // Build query to get target students
    const query = { schoolId, isDeleted: { $ne: true }, status: 'active' };
    if (studentIds && studentIds.length > 0) {
      query._id = { $in: studentIds.filter((id) => mongoose.Types.ObjectId.isValid(id)) };
    } else if (classIds && classIds.length > 0) {
      query.classId = { $in: classIds.filter((id) => mongoose.Types.ObjectId.isValid(id)) };
    }

    const students = await Student.find(query).select('name parents').lean();
    if (!students.length)
      return res.status(404).json({ error: 'No students found matching criteria' });

    // Queue as background job
    await agenda.now('bulk notify parents', {
      schoolId: schoolId.toString(),
      students: students.map((s) => ({
        studentId: s._id.toString(),
        name: s.name,
        parentPhone: s.parents?.[0]?.phone,
        parentEmail: s.parents?.[0]?.email,
      })),
      message: message.trim(),
      channel,
      initiatedBy: req.user?._id?.toString(),
    });

    res.json({
      message: `Notification queued for ${students.length} students`,
      recipientCount: students.length,
      channel,
      status: 'queued',
    });
  } catch (err) {
    logger.error({ err }, 'Bulk notify error');
    res.status(500).json({ error: err.message });
  }
});

export default router;
