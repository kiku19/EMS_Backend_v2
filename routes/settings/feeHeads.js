import express from 'express';
import { authenticate } from '../../middleware/auth.js';
import { checkPermission } from '../../middleware/auth/permissions.js';
import { zodSchemas, validateZod } from '../../middleware/validation/validation.js';
import FeeHead from '../../models/FeeHead.js';
import StudentFeeStructure from '../../models/StudentFeeStructure.js';
import { createLogger } from '../../utils/logger.js';

const router = express.Router();
router.use(authenticate);
const logger = createLogger('SettingsFeeHeads');

// Get all fee heads
router.get('/fee-heads', authenticate, async (req, res) => {
  try {
    const feeHeads = await FeeHead.find({ schoolId: req.user.schoolId, isActive: true }).sort({
      createdAt: -1,
    });
    res.json(feeHeads);
  } catch (error) {
    logger.error('Error fetching fee heads:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create new fee head
router.post(
  '/fee-heads',
  authenticate,
  checkPermission('settings', 'create'),
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
        // F7: headType / customType / applicableStreams were validated by Zod
        // and exist on the FeeHead model, but the handler's fixed field-pick
        // silently discarded them.
        headType,
        customType,
        applicableStreams,
      } = req.body;

      // Create fee head
      const feeHead = new FeeHead({
        name,
        category: category || 'Academic',
        amount,
        mandatory: mandatory !== undefined ? mandatory : true,
        description,
        applicableClasses,
        frequency: frequency || 'yearly',
        schoolId: req.user?.schoolId,
        autoApply: autoApply !== undefined ? autoApply : true,
        headType,
        customType,
        applicableStreams,
      });

      await feeHead.save();

      res.status(201).json(feeHead);
    } catch (error) {
      logger.error('Error creating fee head:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Update fee head
router.put(
  '/fee-heads/:id',
  authenticate,
  checkPermission('settings', 'edit'),
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
        // F7: include the classified head fields on update too.
        headType,
        customType,
        applicableStreams,
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
          headType,
          customType,
          applicableStreams,
        },
        { new: true }
      );

      if (!feeHead) {
        return res.status(404).json({ error: 'Fee head not found' });
      }

      res.json(feeHead);
    } catch (error) {
      logger.error('Error updating fee head:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Delete fee head
router.delete(
  '/fee-heads/:id',
  authenticate,
  checkPermission('settings', 'delete'),
  async (req, res) => {
    try {
      const feeHead = await FeeHead.findOneAndDelete({
        _id: req.params.id,
        schoolId: req.user.schoolId,
      });

      if (!feeHead) {
        return res.status(404).json({ error: 'Fee head not found' });
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

      // Recalculate totals for affected student fee structures
      for (const structureId of affectedIds) {
        const structure = await StudentFeeStructure.findById(structureId);
        if (!structure) continue;

        structure.totalFee = structure.feeHeads.reduce((sum, fh) => sum + (fh.amount || 0), 0);
        structure.totalPaid = structure.feeHeads.reduce((sum, fh) => sum + (fh.paidAmount || 0), 0);
        structure.totalBalance =
          structure.totalFee - structure.totalPaid - (structure.discountApplied || 0);

        if (structure.totalBalance <= 0) {
          structure.overallStatus = 'paid';
        } else if (structure.totalPaid > 0) {
          structure.overallStatus = 'partial';
        } else {
          structure.overallStatus = 'pending';
        }

        await structure.save();
      }

      res.json({ success: true, message: 'Fee head deleted successfully' });
    } catch (error) {
      logger.error('Error deleting fee head:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

export default router;
