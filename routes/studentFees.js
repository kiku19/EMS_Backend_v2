/**
 * @swagger
 * tags:
 *   name: Student Fees
 *   description: Per-student fee structure management — initialize, view, discount, pay, and reconcile
 */

/**
 * @swagger
 * /student-fees/student/{studentId}:
 *   get:
 *     summary: Get (or auto-initialize) the fee structure for a student
 *     description: |
 *       Auto-creates a fee structure from applicable fee heads if one does not yet exist.
 *       Returns `_initialized: false` when the student has no class assigned.
 *     tags: [Student Fees]
 *     parameters:
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           $ref: '#/components/schemas/ObjectId'
 *       - $ref: '#/components/parameters/AcademicYearQuery'
 *     responses:
 *       200:
 *         description: Student fee structure (populated with fee head details)
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         description: Student not found
 */

/**
 * @swagger
 * /student-fees/batch:
 *   post:
 *     summary: Batch fetch fee structures for multiple students (max 100)
 *     tags: [Student Fees]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [studentIds]
 *             properties:
 *               studentIds:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/ObjectId'
 *                 maxItems: 100
 *               academicYear:
 *                 $ref: '#/components/schemas/AcademicYear'
 *     responses:
 *       200:
 *         description: Map of studentId → fee structure
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @swagger
 * /student-fees/all:
 *   get:
 *     summary: List all student fee structures for the school
 *     tags: [Student Fees]
 *     parameters:
 *       - $ref: '#/components/parameters/AcademicYearQuery'
 *       - in: query
 *         name: classId
 *         schema:
 *           $ref: '#/components/schemas/ObjectId'
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, partial, paid, overdue]
 *     responses:
 *       200:
 *         description: Array of fee structures with student and class details
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @swagger
 * /student-fees/initialize/{studentId}:
 *   post:
 *     summary: Explicitly initialize fee structure for a student
 *     description: Idempotent — returns existing structure if already initialized.
 *     tags: [Student Fees]
 *     parameters:
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           $ref: '#/components/schemas/ObjectId'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               academicYear:
 *                 $ref: '#/components/schemas/AcademicYear'
 *     responses:
 *       201:
 *         description: Fee structure created
 *       200:
 *         description: Fee structure already exists
 *       400:
 *         description: Student has no class assigned
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         description: Student not found
 */

/**
 * @swagger
 * /student-fees/student/{studentId}/discount:
 *   put:
 *     summary: Apply a discount to a student's fee structure
 *     tags: [Student Fees]
 *     parameters:
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           $ref: '#/components/schemas/ObjectId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [discountAmount]
 *             properties:
 *               discountAmount:
 *                 type: number
 *                 minimum: 0
 *               discountReason:
 *                 type: string
 *               academicYear:
 *                 $ref: '#/components/schemas/AcademicYear'
 *     responses:
 *       200:
 *         description: Updated fee structure
 *       400:
 *         description: Discount exceeds outstanding balance
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         description: Fee structure not found
 */

/**
 * @swagger
 * /student-fees/student/{studentId}/payment:
 *   post:
 *     summary: Record a fee payment for a student
 *     tags: [Student Fees]
 *     parameters:
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           $ref: '#/components/schemas/ObjectId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount]
 *             properties:
 *               amount:
 *                 type: number
 *                 minimum: 0
 *               feeHeadPayments:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     feeHeadId:
 *                       $ref: '#/components/schemas/ObjectId'
 *                     amount:
 *                       type: number
 *               academicYear:
 *                 $ref: '#/components/schemas/AcademicYear'
 *               idempotencyKey:
 *                 type: string
 *                 maxLength: 100
 *                 description: Client-generated key to prevent duplicate payments
 *     responses:
 *       200:
 *         description: Payment recorded; fee structure updated
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         description: Fee structure not found
 *       409:
 *         description: Duplicate payment request — idempotency key already used
 */

/**
 * @swagger
 * /student-fees/defaulters:
 *   get:
 *     summary: List students with pending or overdue fee status (paginated)
 *     tags: [Student Fees]
 *     parameters:
 *       - $ref: '#/components/parameters/AcademicYearQuery'
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Search by student name
 *       - in: query
 *         name: minDaysOverdue
 *         schema: { type: integer }
 *         description: Filter by minimum days overdue
 *     responses:
 *       200:
 *         description: Paginated defaulters with pagination metadata
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @swagger
 * /student-fees/reconcile/{studentId}:
 *   post:
 *     summary: Reconcile fee structure with actual payment records
 *     description: Recalculates totals from the underlying FeePayment records to fix any data inconsistencies.
 *     tags: [Student Fees]
 *     parameters:
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           $ref: '#/components/schemas/ObjectId'
 *     responses:
 *       200:
 *         description: Reconciled fee structure
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         description: Fee structure not found
 */

import { resolveAcademicYear } from '../utils/academicYear.js';
import express from 'express';
import mongoose from 'mongoose';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import { Student, FeePayment, getNextAvailableReceiptNumber } from '../database.js';
import { emitFeeUpdate } from '../utils/socketEmitter.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { extractSchoolId, ensureDefaultSchool } from '../utils/schoolContext.js';
import { buildStudentFeeHeads, buildStudentInstallments } from '../utils/applyClassFeeStructure.js';
import {
  computeFeeBalance,
  computeFeeHeadStatus,
  syncStudentFeeDetails,
} from '../utils/feeCalculator.js';
import {
  validateZod,
  studentFeePaymentSchema,
  updateDiscountSchema,
  defaultersQuerySchema,
  studentFeeBatchSchema,
  initializeStudentFeeSchema,
  studentFeesAllQuerySchema,
  reconcileStudentFeesSchema,
} from '../validators/index.js';
import { createLogger } from '../utils/logger.js';
import { validateObjectIdParam } from '../middleware/validation.js';
import { updateFeeStructureWithRetry } from '../utils/sfsConcurrency.js';
import { classNameTokens } from './students/helpers.js';
import { createFeePaymentAuditEntry } from '../utils/feePaymentAudit.js';

const logger = createLogger('StudentFees');
const router = express.Router();
router.use(authenticate);

function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) throw new Error('schoolId is required for scoped queries');
  return { ...query, schoolId: normalizedSchoolId };
}

async function resolveRequestSchoolId(req) {
  if (req.user?.schoolId) return extractSchoolId(req.user.schoolId);
  const school = await ensureDefaultSchool();
  return extractSchoolId(school._id);
}

function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Get fee structure for a student (auto-initializes if missing)
router.get(
  '/student/:studentId',
  validateObjectIdParam('studentId'),
  checkPermission('fees', 'view'),
  validateZod(initializeStudentFeeSchema, 'query'),
  async (req, res) => {
    try {
      const schoolId = await resolveRequestSchoolId(req);
      const academicYear = await resolveAcademicYear(req.query.academicYear, req.user?.schoolId);

      // Validate student belongs to the school
      const student = await Student.findOne(
        scopeBySchool(schoolId, { _id: req.params.studentId })
      ).populate('classId');
      if (!student) {
        return res.status(404).json({ error: req.t('students:errors.notFound') });
      }

      let feeStructure = await StudentFeeStructure.findOne(
        scopeBySchool(schoolId, { studentId: req.params.studentId, academicYear })
      )
        .populate('studentId', 'name admissionId rollNo')
        .populate('classId', 'name section');

      // Auto-initialize fee structure if it doesn't exist and student has a class.
      // Prefer the class FeeStructure (admin-configured) over the FeeHead catalogue.
      if (!feeStructure && student.classId) {
        const { feeHeads: applicableFeeHeads, classStructure } = await buildStudentFeeHeads({
          schoolId,
          classId: student.classId._id,
          academicYear,
          classNameTokens: classNameTokens(student.classId.name),
        });

        feeStructure = new StudentFeeStructure({
          studentId: student._id,
          classId: student.classId._id,
          academicYear,
          schoolId,
          feeHeads: applicableFeeHeads.map((fh) => ({
            feeHeadId: fh.feeHeadId,
            name: fh.name,
            category: fh.category,
            baseAmount: fh.baseAmount,
            amount: fh.amount,
            mandatory: fh.mandatory,
            frequency: fh.frequency,
            applicableTerms: fh.applicableTerms,
            dueDay: fh.dueDay,
            refundable: fh.refundable,
            paidAmount: 0,
            balanceAmount: fh.amount,
            status: 'pending',
          })),
          installments: classStructure ? buildStudentInstallments(classStructure) : [],
        });

        feeStructure.totalFee = feeStructure.feeHeads.reduce((sum, fh) => sum + fh.amount, 0);
        feeStructure.totalPaid = 0;
        feeStructure.totalBalance = feeStructure.totalFee;
        feeStructure.overallStatus = 'pending';

        try {
          await feeStructure.save();

          await Student.findOneAndUpdate(scopeBySchool(schoolId, { _id: student._id }), {
            feeStatus: 'pending',
            feeDetails: {
              totalFee: feeStructure.totalFee,
              paidAmount: 0,
              balanceAmount: feeStructure.totalBalance,
              discountApplied: 0,
              lastPaymentDate: null,
            },
          });

          emitFeeUpdate(student._id, student.name, feeStructure);
        } catch (saveError) {
          // Race condition: another request already created it — fetch the existing one
          if (saveError.code === 11000) {
            feeStructure = await StudentFeeStructure.findOne(
              scopeBySchool(schoolId, { studentId: req.params.studentId, academicYear })
            );
            if (!feeStructure) {
              throw new Error('Fee structure creation raced but neither version found', {
                cause: saveError,
              });
            }
          } else {
            throw saveError;
          }
        }

        // Re-fetch with populated fields
        feeStructure = await StudentFeeStructure.findOne(
          scopeBySchool(schoolId, { studentId: req.params.studentId, academicYear })
        )
          .populate('studentId', 'name admissionId rollNo')
          .populate('classId', 'name section');
      }

      // Student has no class assigned - return empty structure
      if (!feeStructure) {
        return res.json({
          studentId: student._id,
          academicYear,
          feeHeads: [],
          totalFee: 0,
          totalPaid: 0,
          totalBalance: 0,
          discountApplied: 0,
          overallStatus: 'pending',
          _initialized: false,
        });
      }

      res.json(feeStructure);
    } catch (error) {
      logger.error({ err: error }, 'Error fetching student fee structure');
      res.status(500).json({ error: error.message });
    }
  }
);

// Batch get fee structures for multiple students
router.post(
  '/batch',
  checkPermission('fees', 'view'),
  validateZod(studentFeeBatchSchema),
  async (req, res) => {
    try {
      const { studentIds, academicYear } = req.body;

      const ids = studentIds;
      const year = await resolveAcademicYear(academicYear, req.user?.schoolId);

      const feeStructures = await StudentFeeStructure.find(
        scopeBySchool(req.user?.schoolId, {
          studentId: { $in: ids },
          academicYear: year,
        })
      )
        .populate('studentId', 'name admissionId rollNo')
        .populate('classId', 'name section');

      // Index by studentId for easy lookup
      const result = {};
      feeStructures.forEach((fs) => {
        const sid = fs.studentId?._id?.toString() || fs.studentId?.toString();
        if (sid) result[sid] = fs;
      });

      res.json(result);
    } catch (error) {
      logger.error({ err: error }, 'Error fetching batch fee structures');
      res.status(500).json({ error: error.message });
    }
  }
);

// Get all students with their fee structures
router.get(
  '/all',
  checkPermission('fees', 'view'),
  validateZod(studentFeesAllQuerySchema, 'query'),
  async (req, res) => {
    try {
      const { academicYear, classId, status, search, page, limit } = req.query;
      const resolvedYear = await resolveAcademicYear(academicYear, req.user?.schoolId);
      const schoolId = new mongoose.Types.ObjectId(extractSchoolId(req.user?.schoolId));
      const ledgerMatch = {
        schoolId,
        academicYear: resolvedYear,
        ...(classId ? { classId: new mongoose.Types.ObjectId(classId) } : {}),
        ...(status ? { overallStatus: status } : {}),
      };
      const studentMatch = {
        isDeleted: { $ne: true },
        status: 'active',
        ...(search
          ? {
              $or: [
                { name: { $regex: escapeRegex(search), $options: 'i' } },
                { admissionId: { $regex: escapeRegex(search), $options: 'i' } },
                { rollNo: { $regex: escapeRegex(search), $options: 'i' } },
              ],
            }
          : {}),
      };
      const [result] = await StudentFeeStructure.aggregate([
        { $match: ledgerMatch },
        {
          $lookup: {
            from: 'students',
            localField: 'studentId',
            foreignField: '_id',
            pipeline: [
              { $match: { schoolId, ...studentMatch } },
              { $project: { name: 1, admissionId: 1, rollNo: 1, photo: 1 } },
            ],
            as: 'studentId',
          },
        },
        { $unwind: '$studentId' },
        {
          $lookup: {
            from: 'classes',
            localField: 'classId',
            foreignField: '_id',
            pipeline: [
              { $match: { schoolId, isDeleted: { $ne: true } } },
              { $project: { name: 1, section: 1 } },
            ],
            as: 'classId',
          },
        },
        { $unwind: { path: '$classId', preserveNullAndEmptyArrays: true } },
        { $sort: { 'studentId.name': 1, _id: 1 } },
        {
          $facet: {
            data: [{ $skip: (page - 1) * limit }, { $limit: limit }],
            total: [{ $count: 'count' }],
          },
        },
      ]);
      const total = result?.total?.[0]?.count || 0;
      res.json({
        data: result?.data || [],
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    } catch (error) {
      logger.error({ err: error }, 'Error fetching all fee structures');
      res.status(500).json({ error: error.message });
    }
  }
);

// Initialize fee structure for a new student
router.post(
  '/initialize/:studentId',
  validateObjectIdParam('studentId'),
  checkPermission('fees', 'create'),
  validateZod(initializeStudentFeeSchema),
  async (req, res) => {
    try {
      // Validate student belongs to the school
      const student = await Student.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.studentId })
      ).populate('classId');

      if (!student) {
        return res.status(404).json({ error: req.t('students:errors.notFound') });
      }

      if (!student.classId) {
        return res.status(400).json({
          error: 'Student is not assigned to a class. Assign a class before initializing fees.',
        });
      }

      const year = await resolveAcademicYear(req.body.academicYear, req.user?.schoolId);
      const schoolId = await resolveRequestSchoolId(req);

      // Check if fee structure already exists
      let feeStructure = await StudentFeeStructure.findOne(
        scopeBySchool(schoolId, { studentId: student._id, academicYear: year })
      );

      if (feeStructure) {
        return res.json({
          message: 'Fee structure already exists',
          feeStructure,
        });
      }

      // Build heads from the class FeeStructure when one exists, falling back to
      // the FeeHead catalogue via applicableClasses.
      const { feeHeads: applicableFeeHeads, classStructure } = await buildStudentFeeHeads({
        schoolId,
        classId: student.classId._id,
        academicYear: year,
        classNameTokens: classNameTokens(student.classId.name),
      });

      // Create fee structure
      feeStructure = new StudentFeeStructure({
        studentId: student._id,
        classId: student.classId._id,
        academicYear: year,
        schoolId,
        feeHeads: applicableFeeHeads.map((fh) => ({
          feeHeadId: fh.feeHeadId,
          name: fh.name,
          category: fh.category,
          baseAmount: fh.baseAmount,
          amount: fh.amount,
          mandatory: fh.mandatory,
          frequency: fh.frequency,
          applicableTerms: fh.applicableTerms,
          dueDay: fh.dueDay,
          refundable: fh.refundable,
          paidAmount: 0,
          balanceAmount: fh.amount,
          status: 'pending',
        })),
        installments: classStructure ? buildStudentInstallments(classStructure) : [],
      });

      // Calculate totals
      feeStructure.totalFee = feeStructure.feeHeads.reduce((sum, fh) => sum + fh.amount, 0);
      feeStructure.totalPaid = 0;
      feeStructure.totalBalance = feeStructure.totalFee;
      feeStructure.overallStatus = 'pending';

      await feeStructure.save();

      // Sync fee data to Student model for consistent reads
      await Student.findOneAndUpdate(scopeBySchool(schoolId, { _id: student._id }), {
        feeStatus: 'pending',
        feeDetails: {
          totalFee: feeStructure.totalFee,
          paidAmount: 0,
          balanceAmount: feeStructure.totalBalance,
          discountApplied: 0,
          lastPaymentDate: null,
        },
      });

      // Emit socket event for real-time updates
      emitFeeUpdate(student._id, student.name, feeStructure);

      res.status(201).json(feeStructure);
    } catch (error) {
      // Handle race condition: duplicate key means another request already
      // initialised it. The lookup MUST scope by schoolId + academicYear —
      // without it the recovery could return a fee structure from a
      // different tenant (same studentId collision) or from a prior
      // academic year.
      if (error.code === 11000) {
        const year = await resolveAcademicYear(req.body.academicYear, req.user?.schoolId);
        const schoolId = await resolveRequestSchoolId(req);
        const existing = await StudentFeeStructure.findOne(
          scopeBySchool(schoolId, {
            studentId: req.params.studentId,
            academicYear: year,
          })
        );
        if (existing) {
          return res.json({ message: 'Fee structure already exists', feeStructure: existing });
        }
      }
      logger.error({ err: error }, 'Error initializing fee structure');
      res.status(500).json({ error: error.message });
    }
  }
);

// Update discount for a student
router.put(
  '/student/:studentId/discount',
  validateObjectIdParam('studentId'),
  checkPermission('fees', 'edit'),
  validateZod(updateDiscountSchema),
  async (req, res) => {
    try {
      const { discountAmount, discountReason, academicYear } = req.body;
      const resolvedYear = await resolveAcademicYear(academicYear, req.user?.schoolId);

      // Snapshot for audit trail
      const beforeSnapshot = await StudentFeeStructure.findOne(
        scopeBySchool(req.user?.schoolId, {
          studentId: req.params.studentId,
          academicYear: resolvedYear,
        })
      ).lean();

      let feeStructure = null;
      try {
        feeStructure = await updateFeeStructureWithRetry(
          scopeBySchool(req.user?.schoolId, {
            studentId: req.params.studentId,
            academicYear: resolvedYear,
          }),
          async (fs) => {
            const maxDiscount = fs.totalFee - fs.totalPaid;
            if ((discountAmount || 0) > maxDiscount) {
              const err = new Error(
                `Discount cannot exceed outstanding balance of ₹${maxDiscount}`
              );
              err.code = 'EXCEEDS_DISCOUNT';
              err.maxAllowed = maxDiscount;
              throw err;
            }
            fs.discountApplied = discountAmount || 0;
            fs.discountReason = discountReason || '';
            const { totalBalance, overallStatus } = computeFeeBalance(fs);
            fs.totalBalance = totalBalance;
            fs.overallStatus = overallStatus;
          }
        );
      } catch (err) {
        if (err.code === 'EXCEEDS_DISCOUNT') {
          return res.status(400).json({
            error: err.message,
            field: 'discountAmount',
            maxAllowed: err.maxAllowed,
          });
        }
        throw err;
      }

      if (!feeStructure) {
        return res.status(404).json({ error: 'Fee structure not found' });
      }

      // Sync fee data to Student model for consistent reads
      await syncStudentFeeDetails(req.params.studentId, feeStructure);

      // Audit trail — record discount change
      try {
        await createFeePaymentAuditEntry({
          schoolId: extractSchoolId(req.user?.schoolId),
          entityType: 'StudentFeeStructure',
          entityId: feeStructure._id,
          action: 'discount_applied',
          performedBy: req.user?._id || req.user?.id,
          performedByName: req.user?.name || req.user?.email || null,
          studentId: req.params.studentId,
          changes: {
            before: beforeSnapshot
              ? {
                  discountApplied: beforeSnapshot.discountApplied,
                  discountReason: beforeSnapshot.discountReason,
                  totalBalance: beforeSnapshot.totalBalance,
                  overallStatus: beforeSnapshot.overallStatus,
                }
              : undefined,
            after: {
              discountApplied: feeStructure.discountApplied,
              discountReason: feeStructure.discountReason,
              totalBalance: feeStructure.totalBalance,
              overallStatus: feeStructure.overallStatus,
            },
          },
          context: {
            amount: discountAmount,
            academicYear: resolvedYear,
            reason: discountReason,
          },
          req,
        });
      } catch {
        // Audit failures must never block the main request
      }

      // Get student details for socket event
      const student = await Student.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.studentId })
      ).select('name');

      // Emit socket event for real-time updates
      if (student) {
        emitFeeUpdate(student._id, student.name, feeStructure);
      }

      res.json(feeStructure);
    } catch (error) {
      logger.error({ err: error }, 'Error updating discount');
      res.status(500).json({ error: error.message });
    }
  }
);

// Record payment for a student
router.post(
  '/student/:studentId/payment',
  validateObjectIdParam('studentId'),
  checkPermission('fees', 'edit'),
  validateZod(studentFeePaymentSchema),
  async (req, res) => {
    let idempotencyKey;
    let schoolId;

    try {
      const { amount, feeHeadPayments, academicYear } = req.body;
      idempotencyKey = req.body.idempotencyKey;
      const resolvedAcademicYear = await resolveAcademicYear(academicYear, req.user?.schoolId);

      // Pre-flight balance check against the current snapshot — the
      // authoritative check is inside the retry loop below (since another
      // concurrent payment might have drained the balance).
      const preflight = await StudentFeeStructure.findOne(
        scopeBySchool(req.user?.schoolId, {
          studentId: req.params.studentId,
          academicYear: resolvedAcademicYear,
        })
      );
      if (!preflight) {
        return res.status(404).json({ error: 'Fee structure not found' });
      }
      if (amount > (preflight.totalBalance || 0)) {
        return res.status(400).json({
          error: `Payment amount (₹${amount}) exceeds outstanding balance (₹${preflight.totalBalance || 0})`,
        });
      }

      // Idempotency: reject duplicate payment requests
      schoolId = extractSchoolId(req.user?.schoolId);
      if (idempotencyKey) {
        const existingPayment = await FeePayment.findOne(
          scopeBySchool(schoolId, { idempotencyKey })
        );
        if (existingPayment) {
          return res.status(409).json({
            error: 'Duplicate payment request — this idempotency key has already been used.',
            code: 'IDEMPOTENCY_KEY_USED',
            receiptNumber: existingPayment.receiptNumber,
          });
        }
      }

      let distributedFeeHeadPayments = [];
      let feeStructure = null;
      let feePaymentDoc = null;
      const resolvedYear = await resolveAcademicYear(academicYear, req.user?.schoolId);

      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          // Update individual fee heads under optimistic concurrency within the transaction
          feeStructure = await updateFeeStructureWithRetry(
            scopeBySchool(req.user?.schoolId, {
              studentId: req.params.studentId,
              academicYear: resolvedAcademicYear,
            }),
            async (fs) => {
              // Re-check balance on the freshly-read snapshot inside the loop —
              // a concurrent payment might have changed it since the preflight.
              if (amount > (fs.totalBalance || 0)) {
                const err = new Error(
                  `Payment amount (₹${amount}) exceeds outstanding balance (₹${fs.totalBalance || 0})`
                );
                err.code = 'EXCEEDS_BALANCE';
                throw err;
              }

              distributedFeeHeadPayments = [];
              let remainingAmount = amount;
              const creditHead = (head, requestedAmount) => {
                const headBalance = Math.max(
                  Number(head.amount || 0) - Number(head.paidAmount || 0),
                  0
                );
                const credit = Math.min(Number(requestedAmount || 0), remainingAmount);
                if (credit > headBalance) {
                  const err = new Error(
                    `Payment for ${head.name || 'fee head'} exceeds its outstanding balance (₹${headBalance}).`
                  );
                  err.code = 'EXCEEDS_HEAD_BALANCE';
                  throw err;
                }
                head.paidAmount = Number(head.paidAmount || 0) + credit;
                const headResult = computeFeeHeadStatus(head);
                head.balanceAmount = headResult.balanceAmount;
                head.status = headResult.status;
                distributedFeeHeadPayments.push({
                  feeHeadId: head.feeHeadId,
                  name: head.name || '',
                  amount: credit,
                });
                remainingAmount -= credit;
              };

              if (feeHeadPayments?.length) {
                for (const payment of feeHeadPayments) {
                  const feeHeadIndex = fs.feeHeads.findIndex(
                    (fh) => String(fh.feeHeadId || '') === payment.feeHeadId
                  );
                  if (feeHeadIndex < 0) {
                    const err = new Error('A selected fee head is not assigned to this student.');
                    err.code = 'INVALID_FEE_HEAD';
                    throw err;
                  }
                  creditHead(fs.feeHeads[feeHeadIndex], payment.amount);
                }
              } else {
                for (const head of fs.feeHeads) {
                  if (remainingAmount <= 0.009) break;
                  const available = Math.max(
                    Number(head.amount || 0) - Number(head.paidAmount || 0),
                    0
                  );
                  if (available > 0) creditHead(head, Math.min(remainingAmount, available));
                }
              }

              if (fs.feeHeads.length > 0 && remainingAmount > 0.009) {
                const err = new Error(
                  'Payment exceeds the outstanding balance of the available fee heads.'
                );
                err.code = 'EXCEEDS_HEAD_BALANCE';
                throw err;
              }

              fs.totalPaid = Number(fs.totalPaid || 0) + amount;
              fs.lastPaymentDate = new Date();
              const { totalBalance, overallStatus } = computeFeeBalance(fs);
              fs.totalBalance = totalBalance;
              fs.overallStatus = overallStatus;
            },
            { session }
          );

          if (!feeStructure) {
            const err = new Error('Fee structure not found');
            err.code = 'FEE_STRUCTURE_NOT_FOUND';
            throw err;
          }

          const receiptNumber = await getNextAvailableReceiptNumber(schoolId);
          const studentDoc = await Student.findOne(
            scopeBySchool(schoolId, { _id: req.params.studentId })
          )
            .select('classId name')
            .session(session);
          if (!studentDoc) {
            const err = new Error('Student not found');
            err.code = 'STUDENT_NOT_FOUND';
            throw err;
          }

          feePaymentDoc = new FeePayment({
            schoolId,
            studentId: req.params.studentId,
            classId: feeStructure.classId || studentDoc?.classId,
            academicYear: resolvedYear,
            receiptNumber,
            paymentDate: new Date().toISOString().split('T')[0],
            amount,
            paymentMode: req.body.paymentMode || 'cash',
            feeHeads: distributedFeeHeadPayments,
            transactionId: req.body.transactionId || undefined,
            chequeNumber: req.body.chequeNumber || undefined,
            bankName: req.body.bankName || undefined,
            collectedBy: req.user?._id || req.user?.id || undefined,
            status: 'completed',
            remarks: req.body.remarks || '',
            ...(idempotencyKey ? { idempotencyKey } : {}),
          });
          await feePaymentDoc.save({ session });

          // Sync fee data to Student model for consistent reads
          await syncStudentFeeDetails(req.params.studentId, feeStructure, session);
        });
      } catch (txError) {
        if (
          ['EXCEEDS_BALANCE', 'EXCEEDS_HEAD_BALANCE', 'INVALID_FEE_HEAD'].includes(txError.code)
        ) {
          return res.status(400).json({ error: txError.message });
        }
        if (['FEE_STRUCTURE_NOT_FOUND', 'STUDENT_NOT_FOUND'].includes(txError.code)) {
          return res.status(404).json({ error: txError.message });
        }
        if (txError.code === 11000) {
          // Race-condition duplicate: look up the existing payment so we can
          // return the same 409 shape as the pre-flight guard.
          if (idempotencyKey) {
            const existingPayment = await FeePayment.findOne(
              scopeBySchool(schoolId, { idempotencyKey })
            );
            if (existingPayment) {
              return res.status(409).json({
                error: 'Duplicate payment request — this idempotency key has already been used.',
                code: 'IDEMPOTENCY_KEY_USED',
                receiptNumber: existingPayment.receiptNumber,
              });
            }
          }
          return res.status(409).json({
            error: 'Duplicate payment request.',
            code: 'DUPLICATE_PAYMENT',
          });
        }
        throw txError;
      } finally {
        await session.endSession();
      }

      // Audit trail — record WHO paid WHAT for WHICH student
      try {
        await createFeePaymentAuditEntry({
          schoolId,
          entityType: 'FeePayment',
          entityId: feePaymentDoc._id,
          action: 'payment_recorded',
          performedBy: req.user?._id || req.user?.id,
          performedByName: req.user?.name || req.user?.email || null,
          studentId: req.params.studentId,
          changes: {
            before: {
              totalPaid: preflight.totalPaid,
              totalBalance: preflight.totalBalance,
              overallStatus: preflight.overallStatus,
            },
            after: {
              totalPaid: feeStructure.totalPaid,
              totalBalance: feeStructure.totalBalance,
              overallStatus: feeStructure.overallStatus,
            },
          },
          context: {
            receiptNumber: feePaymentDoc.receiptNumber,
            amount,
            academicYear: resolvedAcademicYear,
            paymentMode: req.body.paymentMode || 'cash',
          },
          req,
        });
      } catch {
        // Audit failures must never block the main request
      }

      // Get student details for socket event (outside transaction)
      const student = await Student.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.studentId })
      ).select('name');

      // Emit socket event for real-time updates
      if (student) {
        emitFeeUpdate(student._id, student.name, feeStructure);
      }

      res.json(feeStructure);
    } catch (error) {
      if (error.code === 11000) {
        if (idempotencyKey) {
          const existingPayment = await FeePayment.findOne(
            scopeBySchool(schoolId, { idempotencyKey })
          );
          if (existingPayment) {
            return res.status(409).json({
              error: 'Duplicate payment request — this idempotency key has already been used.',
              code: 'IDEMPOTENCY_KEY_USED',
              receiptNumber: existingPayment.receiptNumber,
            });
          }
        }
        return res.status(409).json({
          error: 'Duplicate payment request.',
          code: 'DUPLICATE_PAYMENT',
        });
      }
      logger.error({ err: error }, 'Error recording payment');
      res.status(500).json({ error: error.message });
    }
  }
);

// Get fee defaulters (paginated)
router.get('/defaulters', checkPermission('fees', 'view'), async (req, res) => {
  try {
    const parsed = defaultersQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'Invalid query parameters', details: parsed.error.flatten().fieldErrors });
    }

    const { page, limit, search, minDaysOverdue, academicYear } = parsed.data;
    const skip = (page - 1) * limit;
    const schoolId = req.user?.schoolId;

    const filter = scopeBySchool(schoolId, {
      academicYear: await resolveAcademicYear(academicYear, schoolId),
      overallStatus: { $in: ['pending', 'partial'] },
      totalBalance: { $gt: 0 },
    });

    // If searching by student name, find matching student IDs first
    if (search) {
      const matchingStudents = await Student.find(
        scopeBySchool(schoolId, { name: { $regex: search, $options: 'i' } }),
        '_id'
      ).lean();
      filter.studentId = { $in: matchingStudents.map((s) => s._id) };
    }

    // If filtering by min days overdue, compute the cutoff date
    if (minDaysOverdue) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - minDaysOverdue);
      filter.$or = [
        { lastPaymentDate: { $lte: cutoffDate } },
        { lastPaymentDate: { $exists: false }, createdAt: { $lte: cutoffDate } },
      ];
    }

    const [defaulters, total] = await Promise.all([
      StudentFeeStructure.find(filter)
        .populate('studentId', 'name admissionId rollNo phone parents')
        .populate('classId', 'name section')
        .sort({ totalBalance: -1 })
        .skip(skip)
        .limit(limit),
      StudentFeeStructure.countDocuments(filter),
    ]);

    res.json({
      data: defaulters,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    logger.error({ err: error }, 'Error fetching defaulters');
    res.status(500).json({ error: error.message });
  }
});

// Reconciliation endpoint — recomputes fee totals from FeePayment records
// and corrects any drift between stored totals and actual payments.
// Admin-only; returns a diff report of what was changed.
router.post(
  '/reconcile/:studentId',
  validateObjectIdParam('studentId'),
  checkPermission('fees', 'edit'),
  validateZod(reconcileStudentFeesSchema),
  async (req, res) => {
    try {
      const schoolId = await resolveRequestSchoolId(req);
      const academicYear = await resolveAcademicYear(req.body.academicYear, req.user?.schoolId);

      const student = await Student.findOne(scopeBySchool(schoolId, { _id: req.params.studentId }));
      if (!student) {
        return res.status(404).json({ error: req.t('students:errors.notFound') });
      }

      // Capture "before" from a one-shot read (only for the diff report below).
      const preSnapshot = await StudentFeeStructure.findOne(
        scopeBySchool(schoolId, { studentId: req.params.studentId, academicYear })
      );
      if (!preSnapshot) {
        return res
          .status(404)
          .json({ error: 'Fee structure not found for this student and academic year' });
      }
      const before = {
        totalPaid: preSnapshot.totalPaid,
        totalBalance: preSnapshot.totalBalance,
        overallStatus: preSnapshot.overallStatus,
      };

      // Sum all completed payments from FeePayment records
      const payments = await FeePayment.find(
        scopeBySchool(schoolId, {
          studentId: req.params.studentId,
          academicYear,
          status: 'completed',
        })
      );
      const actualTotalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

      // Build a map of feeHeadId -> total paid from all FeePayment records.
      // Computed outside the retry loop since it depends only on FeePayment
      // records, not on the SFS doc being mutated.
      const headPaidMap = new Map();
      for (const payment of payments) {
        if (Array.isArray(payment.feeHeads)) {
          for (const ph of payment.feeHeads) {
            const key = ph.feeHeadId ? ph.feeHeadId.toString() : ph.name;
            if (key) {
              headPaidMap.set(key, (headPaidMap.get(key) || 0) + (ph.amount || 0));
            }
          }
        }
      }

      const feeStructure = await updateFeeStructureWithRetry(
        scopeBySchool(schoolId, { studentId: req.params.studentId, academicYear }),
        async (fs) => {
          if (Array.isArray(fs.feeHeads)) {
            for (const fh of fs.feeHeads) {
              const key = fh.feeHeadId ? fh.feeHeadId.toString() : fh.name;
              fh.paidAmount = headPaidMap.get(key) || 0;
              const headResult = computeFeeHeadStatus(fh);
              fh.balanceAmount = headResult.balanceAmount;
              fh.status = headResult.status;
            }
          }
          fs.totalPaid = actualTotalPaid;
          const { totalBalance, overallStatus } = computeFeeBalance(fs);
          fs.totalBalance = totalBalance;
          fs.overallStatus = overallStatus;
        }
      );
      await syncStudentFeeDetails(req.params.studentId, feeStructure);

      const after = {
        totalPaid: feeStructure.totalPaid,
        totalBalance: feeStructure.totalBalance,
        overallStatus: feeStructure.overallStatus,
      };

      const changed = JSON.stringify(before) !== JSON.stringify(after);

      // Audit trail — record reconciliation
      try {
        await createFeePaymentAuditEntry({
          schoolId: extractSchoolId(schoolId),
          entityType: 'StudentFeeStructure',
          entityId: feeStructure._id,
          action: 'structure_reconciled',
          performedBy: req.user?._id || req.user?.id,
          performedByName: req.user?.name || req.user?.email || null,
          studentId: req.params.studentId,
          changes: changed ? { before, after } : undefined,
          context: {
            academicYear,
            amount: actualTotalPaid,
            reason: `Reconciled from ${payments.length} payment records`,
          },
          req,
        });
      } catch {
        // Audit failures must never block the main request
      }
      res.json({
        studentId: req.params.studentId,
        academicYear,
        paymentCount: payments.length,
        changed,
        before,
        after,
      });
    } catch (error) {
      logger.error({ err: error }, 'Error reconciling fees');
      res.status(500).json({ error: error.message });
    }
  }
);

export default router;
