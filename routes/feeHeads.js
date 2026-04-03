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
import FeeHead from '../models/FeeHead.js';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import { Student, Class } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { zodSchemas, validateZod } from '../middleware/validation/validation.js';
import { computeFeeHeadStatus } from '../utils/feeCalculator.js';
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
router.get('/:id', checkPermission('fees', 'view'), async (req, res) => {
  try {
    const feeHead = await FeeHead.findOne({ _id: req.params.id, schoolId: extractSchoolId(req.user?.schoolId) });
    if (!feeHead) {
      return res.status(404).json({ error: req.t('common:routes.feeHeadNotFound') });
    }
    res.json(feeHead);
  } catch (error) {
    logger.error('Error fetching fee head:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create new fee head
router.post(
  '/',
  checkPermission('fees', 'create'),
  validateZod(zodSchemas.createFeeHead),
  async (req, res) => {
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
      } = req.body;

      const schoolId = extractSchoolId(req.user?.schoolId);

      // Create fee head
      const feeHead = new FeeHead({
        name,
        category: category || 'Academic',
        amount,
        mandatory: mandatory !== undefined ? mandatory : true,
        description,
        applicableClasses,
        frequency: frequency || 'yearly',
        schoolId,
        autoApply: autoApply !== undefined ? autoApply : true,
      });

      await feeHead.save();

      // Auto-apply to existing students if enabled
      const response = { feeHead };
      if (feeHead.autoApply) {
        try {
          const applyResult = await applyFeeHeadToStudents(feeHead, schoolId);
          response.applied = true;
          response.studentsUpdated = applyResult.studentsUpdated;
          if (applyResult.studentsUpdated === 0) {
            response.applyWarning =
              'Fee head created but no students were found to apply it to. Check that students exist in the selected classes.';
          }
        } catch (applyError) {
          logger.error('Failed to auto-apply fee head to students:', applyError);
          response.applied = false;
          response.applyError = `Fee head created but failed to apply to students: ${applyError.message}`;
        }
      }

      res.status(201).json(response);
    } catch (error) {
      logger.error('Error creating fee head:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Update fee head
router.put(
  '/:id',
  checkPermission('fees', 'edit'),
  validateZod(zodSchemas.updateFeeHead),
  async (req, res) => {
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
        isActive,
      } = req.body;

      const feeHead = await FeeHead.findOneAndUpdate(
        { _id: req.params.id, schoolId: req.user.schoolId },
        {
          name,
          category,
          amount,
          mandatory,
          description,
          applicableClasses,
          frequency,
          autoApply,
          isActive,
        },
        { new: true }
      );

      if (!feeHead) {
        return res.status(404).json({ error: req.t('common:routes.feeHeadNotFound') });
      }

      // Re-apply to students if autoApply is enabled
      const response = { feeHead };
      if (feeHead.autoApply && feeHead.isActive) {
        try {
          const applyResult = await applyFeeHeadToStudents(feeHead, req.user.schoolId);
          response.applied = true;
          response.studentsUpdated = applyResult.studentsUpdated;
          if (applyResult.studentsUpdated === 0) {
            response.applyWarning = 'Fee head updated but no students were found to apply it to.';
          }
        } catch (applyError) {
          logger.error('Failed to auto-apply fee head to students:', applyError);
          response.applied = false;
          response.applyError = `Fee head updated but failed to apply to students: ${applyError.message}`;
        }
      }

      res.json(response);
    } catch (error) {
      logger.error('Error updating fee head:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Delete fee head
router.delete('/:id', checkPermission('fees', 'delete'), async (req, res) => {
  try {
    // Snapshot before deletion for trash logging
    const feeHeadSnapshot = await FeeHead.findOne({
      _id: req.params.id,
      schoolId: req.user.schoolId,
    }).lean();

    const feeHead = await FeeHead.findOneAndDelete({
      _id: req.params.id,
      schoolId: req.user.schoolId,
    });

    if (!feeHead) {
      return res.status(404).json({ error: req.t('common:routes.feeHeadNotFound') });
    }

    // Log to trash
    if (feeHeadSnapshot) {
      logToTrash({
        itemType: 'FeeHead',
        itemId: feeHeadSnapshot._id,
        itemName: feeHeadSnapshot.name || 'Fee Head',
        originalData: feeHeadSnapshot,
        deletedBy: req.user?.id || req.user?._id,
        schoolId: req.user.schoolId,
      }).catch(() => {});
    }

    // Save affected structure IDs BEFORE the $pull operation
    const affectedStructures = await StudentFeeStructure.find(
      { 'feeHeads.feeHeadId': req.params.id, schoolId: req.user.schoolId },
      { _id: 1 }
    ).lean();
    const affectedIds = affectedStructures.map((s) => s._id);

    // Remove this fee head from all student fee structures
    await StudentFeeStructure.updateMany(
      { _id: { $in: affectedIds } },
      { $pull: { feeHeads: { feeHeadId: req.params.id } } }
    );

    // Recalculate totals for affected students
    for (const structureId of affectedIds) {
      await recalculateStudentFeeStructure(structureId, req.user.schoolId);
    }

    res.json({ success: true, message: req.t('common:routes.feeHeadDeletedSuccessfully') });
  } catch (error) {
    logger.error('Error deleting fee head:', error);
    res.status(500).json({ error: error.message });
  }
});

// Apply fee head to all applicable students
router.post('/:id/apply', checkPermission('fees', 'edit'), async (req, res) => {
  try {
    const feeHead = await FeeHead.findOne({ _id: req.params.id, schoolId: extractSchoolId(req.user?.schoolId) });

    if (!feeHead) {
      return res.status(404).json({ error: req.t('common:routes.feeHeadNotFound') });
    }

    const result = await applyFeeHeadToStudents(feeHead, req.user.schoolId);

    res.json({
      success: true,
      message: `Fee head applied to ${result.studentsUpdated} students`,
      studentsUpdated: result.studentsUpdated,
    });
  } catch (error) {
    logger.error('Error applying fee head:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to apply fee head to students
async function applyFeeHeadToStudents(feeHead, schoolId) {
  try {
    // Find all classes that match the applicable classes
    const classes = await Class.find({
      schoolId,
      name: {
        $in: feeHead.applicableClasses.map((c) => `Class ${c}`),
      },
    });

    if (classes.length === 0) {
      return { studentsUpdated: 0 };
    }

    const classIds = classes.map((c) => c._id);

    // Find all students in these classes
    const students = await Student.find({
      schoolId,
      classId: { $in: classIds },
      status: 'active',
    });

    // Resolve the school's current academic year for StudentFeeStructure
    const academicYear = await resolveAcademicYear(null, schoolId);

    let studentsUpdated = 0;

    for (const student of students) {
      // Find or create student fee structure for the current academic year
      let feeStructure = await StudentFeeStructure.findOne({
        studentId: student._id,
        schoolId,
        academicYear,
      });

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
        (fh) => fh.feeHeadId.toString() === feeHead._id.toString()
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
          amount: feeHead.amount,
          mandatory: feeHead.mandatory,
          frequency: feeHead.frequency,
          // Preserve the payment data
          paidAmount: preservedPaidAmount,
        };

        // Recalculate balance and status using centralized helper
        const headResult = computeFeeHeadStatus({
          amount: feeHead.amount,
          paidAmount: preservedPaidAmount,
        });
        feeStructure.feeHeads[existingIndex].balanceAmount = headResult.balanceAmount;
        feeStructure.feeHeads[existingIndex].status = headResult.status;
      } else {
        // Add new fee head with zero payments
        feeStructure.feeHeads.push({
          feeHeadId: feeHead._id,
          name: feeHead.name,
          category: feeHead.category,
          amount: feeHead.amount,
          mandatory: feeHead.mandatory,
          frequency: feeHead.frequency,
          paidAmount: 0,
          balanceAmount: feeHead.amount,
          status: 'pending',
        });
      }

      // Recalculate totals
      feeStructure.totalFee = feeStructure.feeHeads.reduce((sum, fh) => sum + fh.amount, 0);
      feeStructure.totalPaid = feeStructure.feeHeads.reduce((sum, fh) => sum + fh.paidAmount, 0);
      feeStructure.totalBalance =
        feeStructure.totalFee - feeStructure.totalPaid - (feeStructure.discountApplied || 0);

      // Update overall status
      if (feeStructure.totalBalance <= 0) {
        feeStructure.overallStatus = 'paid';
      } else if (feeStructure.totalPaid > 0) {
        feeStructure.overallStatus = 'partial';
      } else {
        feeStructure.overallStatus = 'pending';
      }

      await feeStructure.save();
      studentsUpdated++;
    }

    return { studentsUpdated };
  } catch (error) {
    logger.error('Error applying fee head to students:', error);
    throw error;
  }
}

// Helper function to recalculate student fee structure
async function recalculateStudentFeeStructure(structureId, schoolId) {
  const structure = await StudentFeeStructure.findOne({ _id: structureId, schoolId });
  if (!structure) return;

  structure.totalFee = structure.feeHeads.reduce((sum, fh) => sum + fh.amount, 0);
  structure.totalPaid = structure.feeHeads.reduce((sum, fh) => sum + fh.paidAmount, 0);
  structure.totalBalance = structure.totalFee - structure.totalPaid - structure.discountApplied;

  if (structure.totalBalance <= 0) {
    structure.overallStatus = 'paid';
  } else if (structure.totalPaid > 0) {
    structure.overallStatus = 'partial';
  } else {
    structure.overallStatus = 'pending';
  }

  await structure.save();
}

export default router;
