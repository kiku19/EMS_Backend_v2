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
 *     responses:
 *       200:
 *         description: Payment recorded; fee structure updated
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         description: Fee structure not found
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
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import FeeHead from '../models/FeeHead.js';
import { Student, Class, FeePayment, getNextReceiptNumber } from '../database.js';
import { emitFeeUpdate } from '../utils/socketEmitter.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { extractSchoolId, ensureDefaultSchool } from '../utils/schoolContext.js';
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
} from '../validators/index.js';
import { createLogger } from '../utils/logger.js';
import { validateObjectIdParam } from '../middleware/validation.js';
import { updateFeeStructureWithRetry } from '../utils/sfsConcurrency.js';

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

// TODO: Bug #50 — Auto-initializing the fee structure on GET causes a side-effect:
// visiting a student profile changes their feeStatus from undefined/"not set" to "pending"
// in the students list. This is because the auto-create below (lines ~360-372) calls
// Student.findByIdAndUpdate to set feeStatus='pending'. Consider either:
// 1) Not auto-creating fee structures on a read-only GET endpoint (move to POST/PUT), or
// 2) Only setting feeStatus on the Student document when fee heads are explicitly assigned
//    by an admin, not when auto-initialized from class defaults.
// Get fee structure for a student (auto-initializes if missing)
router.get(
  '/student/:studentId',
  validateObjectIdParam('studentId'),
  checkPermission('fees', 'view'),
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
        .populate('classId', 'name section')
        .populate('feeHeads.feeHeadId');

      // Auto-initialize fee structure if it doesn't exist and student has a class
      if (!feeStructure && student.classId) {
        const classNumber = student.classId.name.replace('Class ', '');
        const applicableFeeHeads = await FeeHead.find(
          scopeBySchool(schoolId, { applicableClasses: classNumber, isActive: true })
        );

        feeStructure = new StudentFeeStructure({
          studentId: student._id,
          classId: student.classId._id,
          academicYear,
          schoolId,
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

        feeStructure.totalFee = feeStructure.feeHeads.reduce((sum, fh) => sum + fh.amount, 0);
        feeStructure.totalPaid = 0;
        feeStructure.totalBalance = feeStructure.totalFee;
        feeStructure.overallStatus = 'pending';

        try {
          await feeStructure.save();

          await Student.findByIdAndUpdate(student._id, {
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
            ).populate('feeHeads.feeHeadId');
            if (!feeStructure) {
              throw new Error('Fee structure creation raced but neither version found');
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
          .populate('classId', 'name section')
          .populate('feeHeads.feeHeadId');
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
router.post('/batch', checkPermission('fees', 'view'), async (req, res) => {
  try {
    const { studentIds, academicYear } = req.body;

    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ error: 'studentIds array is required' });
    }

    // Cap at 100 to prevent abuse
    const ids = studentIds.slice(0, 100);
    const year = await resolveAcademicYear(academicYear, req.user?.schoolId);

    const feeStructures = await StudentFeeStructure.find(
      scopeBySchool(req.user?.schoolId, {
        studentId: { $in: ids },
        academicYear: year,
      })
    )
      .populate('studentId', 'name admissionId rollNo')
      .populate('classId', 'name section')
      .populate('feeHeads.feeHeadId');

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
});

// Get all students with their fee structures
router.get('/all', checkPermission('fees', 'view'), async (req, res) => {
  try {
    const { academicYear, classId, status } = req.query;
    const resolvedYear = await resolveAcademicYear(academicYear, req.user?.schoolId);
    const query = scopeBySchool(req.user?.schoolId, {});

    if (resolvedYear) query.academicYear = resolvedYear;
    if (classId) query.classId = classId;
    if (status) query.overallStatus = status;

    const feeStructures = await StudentFeeStructure.find(query)
      .populate('studentId', 'name admissionId rollNo photo')
      .populate('classId', 'name section')
      .sort({ 'studentId.name': 1 });

    res.json(feeStructures);
  } catch (error) {
    logger.error({ err: error }, 'Error fetching all fee structures');
    res.status(500).json({ error: error.message });
  }
});

// Initialize fee structure for a new student
router.post(
  '/initialize/:studentId',
  checkPermission('fees', 'create'),
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

      // Extract class number from class name (e.g., "Class 10" -> "10")
      const classNumber = student.classId.name.replace('Class ', '');

      // Find applicable fee heads for this class (fee heads are not academic year specific)
      const applicableFeeHeads = await FeeHead.find(
        scopeBySchool(schoolId, {
          applicableClasses: classNumber,
          isActive: true,
        })
      );

      // Create fee structure
      feeStructure = new StudentFeeStructure({
        studentId: student._id,
        classId: student.classId._id,
        academicYear: year,
        schoolId,
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

      // Calculate totals
      feeStructure.totalFee = feeStructure.feeHeads.reduce((sum, fh) => sum + fh.amount, 0);
      feeStructure.totalPaid = 0;
      feeStructure.totalBalance = feeStructure.totalFee;
      feeStructure.overallStatus = 'pending';

      await feeStructure.save();

      // Sync fee data to Student model for consistent reads
      await Student.findByIdAndUpdate(student._id, {
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

      const feeStructure = await StudentFeeStructure.findOne(
        scopeBySchool(req.user?.schoolId, {
          studentId: req.params.studentId,
          academicYear: await resolveAcademicYear(academicYear, req.user?.schoolId),
        })
      );

      if (!feeStructure) {
        return res.status(404).json({ error: 'Fee structure not found' });
      }

      const maxDiscount = feeStructure.totalFee - feeStructure.totalPaid;
      if ((discountAmount || 0) > maxDiscount) {
        return res.status(400).json({
          error: `Discount cannot exceed outstanding balance of ₹${maxDiscount}`,
          field: 'discountAmount',
          maxAllowed: maxDiscount,
        });
      }

      feeStructure.discountApplied = discountAmount || 0;
      feeStructure.discountReason = discountReason || '';

      const { totalBalance, overallStatus } = computeFeeBalance(feeStructure);
      feeStructure.totalBalance = totalBalance;
      feeStructure.overallStatus = overallStatus;

      await feeStructure.save();

      // Sync fee data to Student model for consistent reads
      await syncStudentFeeDetails(req.params.studentId, feeStructure);

      // Get student details for socket event
      const student = await Student.findById(req.params.studentId).select('name');

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
    try {
      const { amount, feeHeadPayments, academicYear } = req.body;

      const resolvedAcademicYear = await resolveAcademicYear(
        academicYear,
        req.user?.schoolId
      );

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

      // Update individual fee heads under optimistic concurrency. Before this
      // helper existed, two concurrent POSTs both read the same feeStructure,
      // mutated feeHeads independently, and the second save() silently
      // clobbered the first's feeHead updates.
      let distributedFeeHeadPayments = [];
      let feeStructure = null;
      try {
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
            if (feeHeadPayments && Array.isArray(feeHeadPayments)) {
              for (const payment of feeHeadPayments) {
                const feeHeadIndex = fs.feeHeads.findIndex(
                  (fh) => fh.feeHeadId.toString() === payment.feeHeadId
                );
                if (feeHeadIndex >= 0) {
                  const head = fs.feeHeads[feeHeadIndex];
                  const headBalance = (head.amount || 0) - (head.paidAmount || 0);
                  const safePayment = Math.min(payment.amount, Math.max(0, headBalance));
                  fs.feeHeads[feeHeadIndex].paidAmount += safePayment;
                  const headResult = computeFeeHeadStatus(fs.feeHeads[feeHeadIndex]);
                  fs.feeHeads[feeHeadIndex].balanceAmount = headResult.balanceAmount;
                  fs.feeHeads[feeHeadIndex].status = headResult.status;
                  distributedFeeHeadPayments.push({
                    feeHeadId: payment.feeHeadId,
                    name: payment.name || head.name || '',
                    amount: safePayment,
                  });
                }
              }
            }

            fs.totalPaid = fs.feeHeads.reduce((sum, fh) => sum + fh.paidAmount, 0);
            fs.lastPaymentDate = new Date();
            const { totalBalance, overallStatus } = computeFeeBalance(fs);
            fs.totalBalance = totalBalance;
            fs.overallStatus = overallStatus;
          }
        );
      } catch (err) {
        if (err.code === 'EXCEEDS_BALANCE') {
          return res.status(400).json({ error: err.message });
        }
        throw err;
      }

      if (!feeStructure) {
        return res.status(404).json({ error: 'Fee structure not found' });
      }

      // Create a FeePayment record so the payments collection stays in sync
      // (fixes bug where studentFees payment endpoint didn't create FeePayment)
      const schoolId = extractSchoolId(req.user?.schoolId);
      const resolvedYear = await resolveAcademicYear(academicYear, req.user?.schoolId);
      try {
        const receiptNumber = await getNextReceiptNumber(schoolId);
        const studentDoc = await Student.findById(req.params.studentId).select('classId name');
        const feePayment = new FeePayment({
          schoolId,
          studentId: req.params.studentId,
          classId: feeStructure.classId || studentDoc?.classId,
          academicYear: resolvedYear,
          receiptNumber,
          paymentDate: new Date().toISOString().split('T')[0],
          amount,
          paymentMode: req.body.paymentMode || 'cash',
          feeHeads: distributedFeeHeadPayments,
          status: 'completed',
          remarks: req.body.remarks || '',
        });
        await feePayment.save();
      } catch (fpError) {
        logger.warn({ err: fpError }, 'Non-critical: could not create FeePayment record');
      }

      // Sync fee data to Student model for consistent reads
      await syncStudentFeeDetails(req.params.studentId, feeStructure);

      // Get student details for socket event
      const student = await Student.findById(req.params.studentId).select('name');

      // Emit socket event for real-time updates
      if (student) {
        emitFeeUpdate(student._id, student.name, feeStructure);
      }

      res.json(feeStructure);
    } catch (error) {
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
        .populate('studentId', 'name admissionId rollNo phone parentPhone')
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
  checkPermission('fees', 'edit'),
  async (req, res) => {
    try {
      const schoolId = await resolveRequestSchoolId(req);
      const academicYear = await resolveAcademicYear(
        req.query.academicYear || req.body.academicYear,
        req.user?.schoolId
      );

      const student = await Student.findOne(scopeBySchool(schoolId, { _id: req.params.studentId }));
      if (!student) {
        return res.status(404).json({ error: req.t('students:errors.notFound') });
      }

      const feeStructure = await StudentFeeStructure.findOne(
        scopeBySchool(schoolId, { studentId: req.params.studentId, academicYear })
      );
      if (!feeStructure) {
        return res
          .status(404)
          .json({ error: 'Fee structure not found for this student and academic year' });
      }

      // Sum all completed payments from FeePayment records
      const payments = await FeePayment.find(
        scopeBySchool(schoolId, {
          studentId: req.params.studentId,
          academicYear,
          status: 'completed',
        })
      );
      const actualTotalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

      const before = {
        totalPaid: feeStructure.totalPaid,
        totalBalance: feeStructure.totalBalance,
        overallStatus: feeStructure.overallStatus,
      };

      // ── Redistribute payments across individual fee heads ────────────
      // Build a map of feeHeadId -> total paid from all FeePayment records
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

      // Update each fee head's paidAmount from the aggregated payment data
      if (Array.isArray(feeStructure.feeHeads)) {
        for (const fh of feeStructure.feeHeads) {
          const key = fh.feeHeadId ? fh.feeHeadId.toString() : fh.name;
          fh.paidAmount = headPaidMap.get(key) || 0;
          const headResult = computeFeeHeadStatus(fh);
          fh.balanceAmount = headResult.balanceAmount;
          fh.status = headResult.status;
        }
      }
      // ────────────────────────────────────────────────────────────────

      // Correct stored totals
      feeStructure.totalPaid = actualTotalPaid;
      const { totalBalance, overallStatus } = computeFeeBalance(feeStructure);
      feeStructure.totalBalance = totalBalance;
      feeStructure.overallStatus = overallStatus;

      await feeStructure.save();
      await syncStudentFeeDetails(req.params.studentId, feeStructure);

      const after = {
        totalPaid: feeStructure.totalPaid,
        totalBalance: feeStructure.totalBalance,
        overallStatus: feeStructure.overallStatus,
      };

      const changed = JSON.stringify(before) !== JSON.stringify(after);

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
