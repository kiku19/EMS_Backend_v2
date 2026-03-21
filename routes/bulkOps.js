/**
 * Bulk Operations Framework — Batch Create / Update / Delete
 * Endpoint base: /bulk-ops
 *
 * Supported operations:
 *   POST /bulk-ops/students/batch-create
 *   POST /bulk-ops/students/batch-update
 *   POST /bulk-ops/students/batch-delete
 *   POST /bulk-ops/staff/batch-update
 *   POST /bulk-ops/staff/batch-delete
 *   POST /bulk-ops/attendance/batch-create   (upsert)
 *   POST /bulk-ops/results/batch-create      (upsert)
 */

import express from 'express';
import mongoose from 'mongoose';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { extractSchoolId } from '../utils/schoolContext.js';
import {
  Student,
  Staff,
  Attendance,
  Result,
  Class,
  StudentFeeStructure,
  FeeHead,
} from '../database.js';
import { createLogger } from '../utils/logger.js';
import {
  batchCreateStudentsSchema,
  batchUpdateStudentsSchema,
  batchDeleteSchema,
  batchUpdateStaffSchema,
  batchAttendanceSchema,
  batchResultsSchema,
} from '../validators/bulkOpsSchema.js';

const router = express.Router();
const logger = createLogger('BulkOps');

// ─── HELPERS ─────────────────────────────────────────────────────

/**
 * Build a standard batch response.
 * results: array of { index, status: 'success'|'failed', id?, error? }
 */
function buildResponse(results) {
  const succeeded = results.filter((r) => r.status === 'success').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  return {
    summary: { total: results.length, succeeded, failed },
    results,
  };
}

// ─── STUDENTS ────────────────────────────────────────────────────

// POST /bulk-ops/students/batch-create
router.post(
  '/students/batch-create',
  authenticate,
  checkPermission('students', 'create'),
  async (req, res) => {
    const schoolId = extractSchoolId(req.user?.schoolId);
    if (!schoolId) return res.status(400).json({ error: 'School context missing' });

    const parsed = batchCreateStudentsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }

    const { items } = parsed.data;
    const results = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // Verify classId belongs to this school
      const classDoc = await Class.findOne({
        _id: item.classId,
        schoolId,
        isDeleted: { $ne: true },
      })
        .select('_id')
        .lean();
      if (!classDoc) {
        results.push({ index: i, status: 'failed', error: `Class '${item.classId}' not found` });
        continue;
      }

      // Duplicate admission ID check
      const existing = await Student.findOne({
        schoolId,
        admissionId: item.admissionId,
        isDeleted: { $ne: true },
      })
        .select('_id')
        .lean();
      if (existing) {
        results.push({
          index: i,
          status: 'failed',
          admissionId: item.admissionId,
          error: `Admission ID '${item.admissionId}' already exists`,
        });
        continue;
      }

      try {
        const student = new Student({
          schoolId,
          name: item.name,
          admissionId: item.admissionId,
          academicYear: item.academicYear,
          classId: item.classId,
          rollNo: item.rollNo || undefined,
          gender: item.gender || undefined,
          dateOfBirth: item.dateOfBirth || undefined,
          parentName: item.parentName,
          parentPhone: item.parentPhone || undefined,
          parentEmail: item.parentEmail || undefined,
          parents: [
            {
              name: item.parentName,
              phone: item.parentPhone || undefined,
              email: item.parentEmail || undefined,
              relationship: 'Parent',
              isWhatsapp: false,
            },
          ],
          phone: item.phone || undefined,
          email: item.email || undefined,
          address: item.address || undefined,
          status: item.status || 'active',
          feeStatus: 'pending',
        });

        await student.save();

        // Initialize fee structure if applicable
        await initStudentFeeStructure(student);

        results.push({
          index: i,
          status: 'success',
          id: student._id,
          admissionId: item.admissionId,
        });
      } catch (err) {
        logger.error({ err, index: i }, 'Batch student create error');
        results.push({
          index: i,
          status: 'failed',
          admissionId: item.admissionId,
          error: err.message,
        });
      }
    }

    res.json(buildResponse(results));
  }
);

// POST /bulk-ops/students/batch-update
router.post(
  '/students/batch-update',
  authenticate,
  checkPermission('students', 'update'),
  async (req, res) => {
    const schoolId = extractSchoolId(req.user?.schoolId);
    if (!schoolId) return res.status(400).json({ error: 'School context missing' });

    const parsed = batchUpdateStudentsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }

    const body = parsed.data;
    const results = [];

    // Mode A: same data to multiple IDs
    if ('ids' in body) {
      const { ids, data } = body;
      for (let i = 0; i < ids.length; i++) {
        try {
          const updated = await Student.findOneAndUpdate(
            { _id: ids[i], schoolId, isDeleted: { $ne: true } },
            { $set: buildStudentUpdateSet(data) },
            { new: false }
          )
            .select('_id')
            .lean();

          if (!updated) {
            results.push({ index: i, id: ids[i], status: 'failed', error: 'Student not found' });
          } else {
            results.push({ index: i, id: ids[i], status: 'success' });
          }
        } catch (err) {
          logger.error({ err, id: ids[i] }, 'Batch student update error');
          results.push({ index: i, id: ids[i], status: 'failed', error: err.message });
        }
      }
    } else {
      // Mode B: per-item updates
      const { items } = body;
      for (let i = 0; i < items.length; i++) {
        const { id, ...data } = items[i];
        try {
          const updated = await Student.findOneAndUpdate(
            { _id: id, schoolId, isDeleted: { $ne: true } },
            { $set: buildStudentUpdateSet(data) },
            { new: false }
          )
            .select('_id')
            .lean();

          if (!updated) {
            results.push({ index: i, id, status: 'failed', error: 'Student not found' });
          } else {
            results.push({ index: i, id, status: 'success' });
          }
        } catch (err) {
          logger.error({ err, id }, 'Batch student update error');
          results.push({ index: i, id, status: 'failed', error: err.message });
        }
      }
    }

    res.json(buildResponse(results));
  }
);

// POST /bulk-ops/students/batch-delete
router.post(
  '/students/batch-delete',
  authenticate,
  checkPermission('students', 'delete'),
  async (req, res) => {
    const schoolId = extractSchoolId(req.user?.schoolId);
    if (!schoolId) return res.status(400).json({ error: 'School context missing' });

    const parsed = batchDeleteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }

    const { ids } = parsed.data;

    try {
      const result = await Student.updateMany(
        { _id: { $in: ids }, schoolId, isDeleted: { $ne: true } },
        { isDeleted: true, deletedAt: new Date() }
      );

      res.json({
        summary: {
          total: ids.length,
          succeeded: result.modifiedCount,
          failed: ids.length - result.modifiedCount,
        },
        modifiedCount: result.modifiedCount,
      });
    } catch (err) {
      logger.error({ err }, 'Batch student delete error');
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── STAFF ───────────────────────────────────────────────────────

// POST /bulk-ops/staff/batch-update
router.post(
  '/staff/batch-update',
  authenticate,
  checkPermission('staff', 'update'),
  async (req, res) => {
    const schoolId = extractSchoolId(req.user?.schoolId);
    if (!schoolId) return res.status(400).json({ error: 'School context missing' });

    const parsed = batchUpdateStaffSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }

    const body = parsed.data;
    const results = [];

    if ('ids' in body) {
      const { ids, data } = body;
      for (let i = 0; i < ids.length; i++) {
        try {
          const updated = await Staff.findOneAndUpdate(
            { _id: ids[i], schoolId, isDeleted: { $ne: true } },
            { $set: buildStaffUpdateSet(data) },
            { new: false }
          )
            .select('_id')
            .lean();

          results.push(
            updated
              ? { index: i, id: ids[i], status: 'success' }
              : { index: i, id: ids[i], status: 'failed', error: 'Staff not found' }
          );
        } catch (err) {
          logger.error({ err, id: ids[i] }, 'Batch staff update error');
          results.push({ index: i, id: ids[i], status: 'failed', error: err.message });
        }
      }
    } else {
      const { items } = body;
      for (let i = 0; i < items.length; i++) {
        const { id, ...data } = items[i];
        try {
          const updated = await Staff.findOneAndUpdate(
            { _id: id, schoolId, isDeleted: { $ne: true } },
            { $set: buildStaffUpdateSet(data) },
            { new: false }
          )
            .select('_id')
            .lean();

          results.push(
            updated
              ? { index: i, id, status: 'success' }
              : { index: i, id, status: 'failed', error: 'Staff not found' }
          );
        } catch (err) {
          logger.error({ err, id }, 'Batch staff update error');
          results.push({ index: i, id, status: 'failed', error: err.message });
        }
      }
    }

    res.json(buildResponse(results));
  }
);

// POST /bulk-ops/staff/batch-delete
router.post(
  '/staff/batch-delete',
  authenticate,
  checkPermission('staff', 'delete'),
  async (req, res) => {
    const schoolId = extractSchoolId(req.user?.schoolId);
    if (!schoolId) return res.status(400).json({ error: 'School context missing' });

    const parsed = batchDeleteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }

    const { ids } = parsed.data;

    try {
      const result = await Staff.updateMany(
        { _id: { $in: ids }, schoolId, isDeleted: { $ne: true } },
        { isDeleted: true, deletedAt: new Date() }
      );

      res.json({
        summary: {
          total: ids.length,
          succeeded: result.modifiedCount,
          failed: ids.length - result.modifiedCount,
        },
        modifiedCount: result.modifiedCount,
      });
    } catch (err) {
      logger.error({ err }, 'Batch staff delete error');
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── ATTENDANCE ──────────────────────────────────────────────────

// POST /bulk-ops/attendance/batch-create
// Upserts attendance records for multiple students on a given date.
router.post(
  '/attendance/batch-create',
  authenticate,
  checkPermission('attendance', 'create'),
  async (req, res) => {
    const schoolId = extractSchoolId(req.user?.schoolId);
    if (!schoolId) return res.status(400).json({ error: 'School context missing' });

    const parsed = batchAttendanceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }

    const { date, classId, records } = parsed.data;

    // Verify classId belongs to this school
    const classDoc = await Class.findOne({ _id: classId, schoolId, isDeleted: { $ne: true } })
      .select('_id')
      .lean();
    if (!classDoc) return res.status(404).json({ error: 'Class not found' });

    const results = [];

    for (let i = 0; i < records.length; i++) {
      const { studentId, status, note } = records[i];

      // Verify student belongs to this school and class
      const student = await Student.findOne({
        _id: studentId,
        schoolId,
        classId,
        isDeleted: { $ne: true },
      })
        .select('_id')
        .lean();

      if (!student) {
        results.push({
          index: i,
          studentId,
          status: 'failed',
          error: 'Student not found in class',
        });
        continue;
      }

      try {
        const doc = await Attendance.findOneAndUpdate(
          { schoolId, studentId, date },
          {
            schoolId,
            studentId,
            classId,
            date,
            status,
            note: note || undefined,
            markedBy: req.user?._id || undefined,
          },
          { upsert: true, new: true }
        );

        results.push({ index: i, studentId, status: 'success', id: doc._id });
      } catch (err) {
        logger.error({ err, studentId }, 'Batch attendance upsert error');
        results.push({ index: i, studentId, status: 'failed', error: err.message });
      }
    }

    res.json(buildResponse(results));
  }
);

// ─── RESULTS ─────────────────────────────────────────────────────

// POST /bulk-ops/results/batch-create
// Upserts exam results for multiple students.
router.post(
  '/results/batch-create',
  authenticate,
  checkPermission('academics', 'create'),
  async (req, res) => {
    const schoolId = extractSchoolId(req.user?.schoolId);
    if (!schoolId) return res.status(400).json({ error: 'School context missing' });

    const parsed = batchResultsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }

    const { examId, records } = parsed.data;
    const results = [];

    for (let i = 0; i < records.length; i++) {
      const { studentId, marksObtained, maxMarks = 100, remarks } = records[i];

      const student = await Student.findOne({ _id: studentId, schoolId, isDeleted: { $ne: true } })
        .select('_id classId academicYear')
        .lean();

      if (!student) {
        results.push({ index: i, studentId, status: 'failed', error: 'Student not found' });
        continue;
      }

      try {
        const percentage = maxMarks > 0 ? Math.round((marksObtained / maxMarks) * 10000) / 100 : 0;

        const doc = await Result.findOneAndUpdate(
          { schoolId, examId, studentId, isDeleted: { $ne: true } },
          {
            schoolId,
            examId,
            studentId,
            classId: student.classId,
            academicYear: student.academicYear,
            marksObtained,
            maxMarks,
            totalMarksObtained: marksObtained,
            totalMaxMarks: maxMarks,
            percentage,
            remarks: remarks || undefined,
            enteredBy: req.user?._id || undefined,
            enteredAt: new Date(),
          },
          { upsert: true, new: true }
        );

        results.push({ index: i, studentId, status: 'success', id: doc._id, percentage });
      } catch (err) {
        logger.error({ err, studentId }, 'Batch result upsert error');
        results.push({ index: i, studentId, status: 'failed', error: err.message });
      }
    }

    res.json(buildResponse(results));
  }
);

// ─── FIELD BUILDERS ──────────────────────────────────────────────

function buildStudentUpdateSet(data) {
  const set = {};
  if (data.classId !== undefined) set.classId = data.classId;
  if (data.status !== undefined) set.status = data.status;
  if (data.rollNo !== undefined) set.rollNo = data.rollNo;
  if (data.gender !== undefined) set.gender = data.gender;
  if (data.address !== undefined) set.address = data.address;
  if (data.phone !== undefined) set.phone = data.phone;
  if (data.email !== undefined) set.email = data.email;
  if (data.parentName !== undefined) set.parentName = data.parentName;
  if (data.parentPhone !== undefined) set.parentPhone = data.parentPhone;
  if (data.parentEmail !== undefined) set.parentEmail = data.parentEmail;
  return set;
}

function buildStaffUpdateSet(data) {
  const set = {};
  if (data.status !== undefined) set.status = data.status;
  if (data.department !== undefined) set.department = data.department;
  if (data.designation !== undefined) set.designation = data.designation;
  if (data.phone !== undefined) set.phone = data.phone;
  if (data.email !== undefined) set.email = data.email;
  if (data.assignedClassId !== undefined) set.assignedClassId = data.assignedClassId;
  return set;
}

// ─── FEE STRUCTURE INIT (reused from bulkImport) ─────────────────

async function initStudentFeeStructure(student) {
  try {
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
  } catch (err) {
    logger.warn({ err, studentId: student._id }, 'Fee structure init failed during batch create');
  }
}

export default router;
