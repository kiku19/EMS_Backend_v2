/**
 * @swagger
 * tags:
 *   name: Fee Heads
 *   description: Fee head configuration — named fee components applied to students (e.g. Tuition, Transport)
 */

/**
 * @swagger
 * /fee-heads:
 *   get:
 *     summary: List all active fee heads for the school
 *     tags: [Fee Heads]
 *     responses:
 *       200:
 *         description: Array of fee heads
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   _id:
 *                     $ref: '#/components/schemas/ObjectId'
 *                   name:
 *                     type: string
 *                     example: Tuition Fee
 *                   category:
 *                     type: string
 *                     example: Academic
 *                   amount:
 *                     type: number
 *                     example: 12000
 *                   mandatory:
 *                     type: boolean
 *                   frequency:
 *                     type: string
 *                     enum: [monthly, quarterly, yearly, one-time]
 *                   applicableClasses:
 *                     type: array
 *                     items:
 *                       type: string
 *                   autoApply:
 *                     type: boolean
 *                   isActive:
 *                     type: boolean
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *   post:
 *     summary: Create a new fee head
 *     description: Creates the fee head and auto-applies it to existing students in the applicable classes if `autoApply` is true.
 *     tags: [Fee Heads]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, amount, applicableClasses]
 *             properties:
 *               name:
 *                 type: string
 *                 example: Tuition Fee
 *               category:
 *                 type: string
 *                 example: Academic
 *               amount:
 *                 type: number
 *                 minimum: 0
 *                 example: 12000
 *               mandatory:
 *                 type: boolean
 *                 default: true
 *               description:
 *                 type: string
 *               applicableClasses:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ['9', '10']
 *               frequency:
 *                 type: string
 *                 enum: [monthly, quarterly, yearly, one-time]
 *                 default: yearly
 *               autoApply:
 *                 type: boolean
 *                 default: true
 *     responses:
 *       201:
 *         description: Fee head created; `studentsUpdated` indicates how many student fee structures were updated
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @swagger
 * /fee-heads/{id}:
 *   get:
 *     summary: Get a fee head by ID
 *     tags: [Fee Heads]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: Fee head document
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   put:
 *     summary: Update a fee head (re-applies to students if autoApply is enabled)
 *     tags: [Fee Heads]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               category:
 *                 type: string
 *               amount:
 *                 type: number
 *               mandatory:
 *                 type: boolean
 *               description:
 *                 type: string
 *               applicableClasses:
 *                 type: array
 *                 items:
 *                   type: string
 *               frequency:
 *                 type: string
 *               autoApply:
 *                 type: boolean
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Updated fee head
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   delete:
 *     summary: Delete a fee head and remove it from all student fee structures
 *     tags: [Fee Heads]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         $ref: '#/components/responses/NotFound'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @swagger
 * /fee-heads/{id}/apply:
 *   post:
 *     summary: Manually apply a fee head to all applicable students
 *     tags: [Fee Heads]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: Fee head applied; returns number of students updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 studentsUpdated:
 *                   type: integer
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */

import { resolveAcademicYear } from '../utils/academicYear.js';
import express from 'express';
import mongoose from 'mongoose';
import FeeHead from '../models/FeeHead.js';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import { Student, Class, FeeStructure } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import {
  zodSchemas,
  validateObjectIdParam,
  validateZod,
} from '../middleware/validation/validation.js';
import { emptyFeeActionSchema } from '../validators/index.js';
import { computeFeeBalance, computeFeeHeadStatus } from '../utils/feeCalculator.js';
import { annualizedAmount } from '../utils/applyClassFeeStructure.js';
import { createLogger } from '../utils/logger.js';
import { extractSchoolId } from '../utils/schoolContext.js';
import { logToTrash } from '../services/trashService.js';

const router = express.Router();
router.use(authenticate);
const logger = createLogger('FeeHeads');

// Get all fee heads
router.get('/', checkPermission('fees', 'view'), async (req, res) => {
  try {
    const schoolId = extractSchoolId(req.user?.schoolId);
    if (!schoolId) return res.status(400).json({ error: 'schoolId is required' });
    const feeHeads = await FeeHead.find({ schoolId, isActive: true }).sort({
      createdAt: -1,
    });
    res.json(feeHeads);
  } catch (error) {
    logger.error('Error fetching fee heads:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get fee head by ID
router.get(
  '/:id',
  checkPermission('fees', 'view'),
  validateObjectIdParam('id'),
  async (req, res) => {
    try {
      const feeHead = await FeeHead.findOne({
        _id: req.params.id,
        schoolId: extractSchoolId(req.user?.schoolId),
      });
      if (!feeHead) {
        return res.status(404).json({ error: req.t('common:routes.feeHeadNotFound') });
      }
      res.json(feeHead);
    } catch (error) {
      logger.error('Error fetching fee head:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Create new fee head
router.post(
  '/',
  checkPermission('fees', 'create'),
  validateZod(zodSchemas.createFeeHead),
  async (req, res) => {
    const session = await mongoose.startSession();
    try {
      const {
        name,
        category,
        amount,
        mandatory,
        description,
        applicableClasses,
        frequency,
        autoApply,
        // F7: headType / customType / applicableStreams were validated by Zod
        // and exist on the FeeHead model, but the handler's fixed field-pick
        // silently discarded them.
        headType,
        customType,
        applicableStreams,
      } = req.body;

      const schoolId = extractSchoolId(req.user?.schoolId);

      let feeHead;
      let applyResult = { studentsUpdated: 0 };
      await session.withTransaction(async () => {
        feeHead = new FeeHead({
          name,
          category: category || 'Academic',
          amount,
          mandatory: mandatory !== undefined ? mandatory : true,
          description,
          applicableClasses,
          frequency: frequency || 'yearly',
          schoolId,
          autoApply: autoApply !== undefined ? autoApply : true,
          headType,
          customType,
          applicableStreams,
        });
        await feeHead.save({ session });
        if (feeHead.autoApply) {
          applyResult = await applyFeeHeadToStudents(feeHead, schoolId, session);
        }
      });

      const response = {
        feeHead,
        applied: Boolean(feeHead.autoApply),
        studentsUpdated: applyResult.studentsUpdated,
      };
      if (feeHead.autoApply && applyResult.studentsUpdated === 0) {
        response.applyWarning =
          'Fee head created, but no active students matched the selected classes.';
      }

      res.status(201).json(response);
    } catch (error) {
      logger.error('Error creating fee head:', error);
      res.status(500).json({ error: error.message });
    } finally {
      await session.endSession();
    }
  }
);

// Update fee head
router.put(
  '/:id',
  checkPermission('fees', 'edit'),
  validateObjectIdParam('id'),
  validateZod(zodSchemas.updateFeeHead),
  async (req, res) => {
    const session = await mongoose.startSession();
    try {
      let feeHead;
      let applyResult = { studentsUpdated: 0 };
      await session.withTransaction(async () => {
        feeHead = await FeeHead.findOne({
          _id: req.params.id,
          schoolId: req.user.schoolId,
        }).session(session);
        if (!feeHead) {
          const error = new Error(req.t('common:routes.feeHeadNotFound'));
          error.code = 'FEE_HEAD_NOT_FOUND';
          throw error;
        }
        Object.assign(feeHead, req.body);
        await feeHead.save({ session });
        if (feeHead.autoApply && feeHead.isActive) {
          applyResult = await applyFeeHeadToStudents(feeHead, req.user.schoolId, session);
        }
      });

      const response = {
        feeHead,
        applied: Boolean(feeHead.autoApply && feeHead.isActive),
        studentsUpdated: applyResult.studentsUpdated,
      };
      if (response.applied && applyResult.studentsUpdated === 0) {
        response.applyWarning = 'Fee head updated, but no active students matched its classes.';
      }

      res.json(response);
    } catch (error) {
      if (error.code === 'FEE_HEAD_NOT_FOUND') {
        return res.status(404).json({ error: error.message });
      }
      logger.error('Error updating fee head:', error);
      res.status(500).json({ error: error.message });
    } finally {
      await session.endSession();
    }
  }
);

// Delete fee head
router.delete(
  '/:id',
  checkPermission('fees', 'delete'),
  validateObjectIdParam('id'),
  async (req, res) => {
    try {
      // Snapshot before deletion for trash logging
      const feeHeadSnapshot = await FeeHead.findOne({
        _id: req.params.id,
        schoolId: req.user.schoolId,
      }).lean();

      const [ledgerReference, structureReference] = await Promise.all([
        StudentFeeStructure.exists({
          schoolId: req.user.schoolId,
          'feeHeads.feeHeadId': req.params.id,
          isDeleted: { $ne: true },
        }),
        FeeStructure.exists({
          schoolId: req.user.schoolId,
          'feeHeads.feeHeadId': req.params.id,
        }),
      ]);

      const feeHead =
        ledgerReference || structureReference
          ? await FeeHead.findOneAndUpdate(
              { _id: req.params.id, schoolId: req.user.schoolId },
              { isActive: false, autoApply: false },
              { new: true }
            )
          : await FeeHead.findOneAndDelete({
              _id: req.params.id,
              schoolId: req.user.schoolId,
            });

      if (!feeHead) {
        return res.status(404).json({ error: req.t('common:routes.feeHeadNotFound') });
      }

      // Log to trash
      if (feeHeadSnapshot && !ledgerReference && !structureReference) {
        logToTrash({
          itemType: 'FeeHead',
          itemId: feeHeadSnapshot._id,
          itemName: feeHeadSnapshot.name || 'Fee Head',
          originalData: feeHeadSnapshot,
          deletedBy: req.user?.id || req.user?._id,
          schoolId: req.user.schoolId,
        }).catch(() => {});
      }

      res.json({
        success: true,
        archived: Boolean(ledgerReference || structureReference),
        message:
          ledgerReference || structureReference
            ? 'Fee head archived. Existing fee structures and payment history were preserved.'
            : req.t('common:routes.feeHeadDeletedSuccessfully'),
      });
    } catch (error) {
      logger.error('Error deleting fee head:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Apply fee head to all applicable students
router.post(
  '/:id/apply',
  checkPermission('fees', 'edit'),
  validateObjectIdParam('id'),
  validateZod(emptyFeeActionSchema),
  async (req, res) => {
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        const feeHead = await FeeHead.findOne({
          _id: req.params.id,
          schoolId: extractSchoolId(req.user?.schoolId),
          isActive: true,
        }).session(session);

        if (!feeHead) {
          const error = new Error(req.t('common:routes.feeHeadNotFound'));
          error.code = 'FEE_HEAD_NOT_FOUND';
          throw error;
        }
        result = await applyFeeHeadToStudents(feeHead, req.user.schoolId, session);
      });

      res.json({
        success: true,
        message: `Fee head applied to ${result.studentsUpdated} students`,
        studentsUpdated: result.studentsUpdated,
      });
    } catch (error) {
      if (error.code === 'FEE_HEAD_NOT_FOUND') {
        return res.status(404).json({ error: error.message });
      }
      logger.error('Error applying fee head:', error);
      res.status(500).json({ error: error.message });
    } finally {
      await session.endSession();
    }
  }
);

// Helper function to apply fee head to students.
// Accept class names in any convention — "Class 10", "Grade 10", "10",
// Roman numerals. Previously only the "Class N" prefix matched and schools
// using "Grade N" or raw numbers got zero class matches and zero students
// updated (silent no-op). Match ON EITHER side: the raw token OR the
// "Class N" / "Grade N" wrapped form.
async function applyFeeHeadToStudents(feeHead, schoolId, session) {
  try {
    const tokenSet = new Set();
    for (const c of feeHead.applicableClasses || []) {
      if (!c) continue;
      tokenSet.add(c);
      tokenSet.add(`Class ${c}`);
      tokenSet.add(`Grade ${c}`);
    }

    const academicYear = await resolveAcademicYear(null, schoolId);

    // Find all active classes that match the applicable classes in the same
    // academic year. A same-named historical class must never receive writes.
    const classes = await Class.find({
      schoolId,
      name: { $in: Array.from(tokenSet) },
      academicYear,
      isDeleted: { $ne: true },
    }).session(session || null);

    if (classes.length === 0) {
      return { studentsUpdated: 0 };
    }

    const classIds = classes.map((c) => c._id);

    // Find all students in these classes
    const students = await Student.find({
      schoolId,
      classId: { $in: classIds },
      academicYear,
      status: 'active',
      isDeleted: { $ne: true },
    }).session(session || null);

    let studentsUpdated = 0;
    const ledgerAmount = annualizedAmount(feeHead);

    for (const student of students) {
      // Find or create student fee structure for the current academic year
      let feeStructure = await StudentFeeStructure.findOne({
        studentId: student._id,
        schoolId,
        academicYear,
        isDeleted: { $ne: true },
      }).session(session || null);

      if (!feeStructure) {
        feeStructure = new StudentFeeStructure({
          studentId: student._id,
          classId: student.classId,
          schoolId: schoolId,
          academicYear,
          feeHeads: [],
        });
      }

      // Check if fee head already exists
      const existingIndex = feeStructure.feeHeads.findIndex(
        (fh) => String(fh.feeHeadId || '') === String(feeHead._id)
      );

      if (existingIndex >= 0) {
        // Update existing fee head — preserve paidAmount and recalculate balance/status
        const existing = feeStructure.feeHeads[existingIndex];
        const preservedPaidAmount = existing.paidAmount || 0;

        feeStructure.feeHeads[existingIndex] = {
          ...existing.toObject(),
          // Update metadata from the fee head definition
          name: feeHead.name,
          category: feeHead.category,
          baseAmount: feeHead.amount,
          amount: ledgerAmount,
          mandatory: feeHead.mandatory,
          frequency: feeHead.frequency,
          // F10: keep the propagated head in sync with the source FeeHead for
          // the term/due/refund metadata. Previously the spread of
          // existing.toObject() kept the OLD values, so lowering/editing a head
          // never refreshed applicableTerms, dueDay or refundable. Source wins
          // when present; otherwise preserve what was already on the subdoc.
          applicableTerms:
            feeHead.applicableTerms ??
            existing.applicableTerms ??
            existing.toObject().applicableTerms,
          dueDay: feeHead.dueDay ?? existing.dueDay ?? existing.toObject().dueDay,
          refundable: feeHead.refundable ?? existing.refundable ?? existing.toObject().refundable,
          // Preserve the payment data
          paidAmount: preservedPaidAmount,
        };

        // Recalculate balance and status using centralized helper
        const headResult = computeFeeHeadStatus({
          amount: ledgerAmount,
          paidAmount: preservedPaidAmount,
        });
        feeStructure.feeHeads[existingIndex].balanceAmount = headResult.balanceAmount;
        feeStructure.feeHeads[existingIndex].status = headResult.status;

        // Capture the surplus when a fee head is lowered below what was
        // already paid. computeFeeHeadStatus clamps balanceAmount to 0, so
        // without this the overpaid amount disappears from the ledger and
        // the school can no longer see what it owes back to the student.
        const overpaid = Math.max(Number(preservedPaidAmount || 0) - Number(ledgerAmount || 0), 0);
        feeStructure.feeHeads[existingIndex].overpaidAmount = overpaid;
      } else {
        // Add new fee head with zero payments
        feeStructure.feeHeads.push({
          feeHeadId: feeHead._id,
          name: feeHead.name,
          category: feeHead.category,
          baseAmount: feeHead.amount,
          amount: ledgerAmount,
          mandatory: feeHead.mandatory,
          frequency: feeHead.frequency,
          // F10: propagate the term/due/refund metadata from the source FeeHead
          // so a freshly-applied head carries the same scheduling info as one
          // built via buildStudentFeeHeads (which copies these for every head).
          applicableTerms: feeHead.applicableTerms,
          dueDay: feeHead.dueDay,
          refundable: feeHead.refundable,
          paidAmount: 0,
          balanceAmount: ledgerAmount,
          status: 'pending',
        });
      }

      // Recalculate totals
      feeStructure.totalFee = feeStructure.feeHeads.reduce((sum, fh) => sum + fh.amount, 0);
      feeStructure.totalPaid = feeStructure.feeHeads.reduce((sum, fh) => sum + fh.paidAmount, 0);
      const { totalBalance, overallStatus } = computeFeeBalance(feeStructure);
      feeStructure.totalBalance = totalBalance;
      feeStructure.overallStatus = overallStatus;

      await feeStructure.save({ session: session || undefined });
      await Student.findOneAndUpdate(
        { _id: student._id, schoolId, academicYear },
        {
          feeStatus: feeStructure.overallStatus,
          feeDetails: {
            totalFee: feeStructure.totalFee,
            paidAmount: feeStructure.totalPaid,
            balanceAmount: feeStructure.totalBalance,
            discountApplied: feeStructure.discountApplied || 0,
            lastPaymentDate: feeStructure.lastPaymentDate || null,
          },
        },
        { session: session || undefined }
      );
      studentsUpdated++;
    }

    return { studentsUpdated };
  } catch (error) {
    logger.error('Error applying fee head to students:', error);
    throw error;
  }
}

export default router;
