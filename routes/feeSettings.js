import express from 'express';
import { z } from 'zod';
import FeeConsession from '../models/FeeConcession.js';
import LateFeeRule from '../models/LateFeeRule.js';
import FeeRule from '../models/FeeRule.js';
import PaymentMethodConfig from '../models/PaymentMethodConfig.js';
import FeeCollectionPeriod from '../models/FeeCollectionPeriod.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { sanitizeQueryStr } from '../middleware/validation.js';
import { createLogger } from '../utils/logger.js';
import { logToTrash } from '../services/trashService.js';

const router = express.Router();
router.use(authenticate);
const logger = createLogger('FeeSettings');

// ============ FEE CONCESSIONS ============

// Get all concessions
router.get('/concessions', checkPermission('fees', 'view'), async (req, res) => {
  try {
    const academicYear = sanitizeQueryStr(req.query.academicYear);
    const query = { schoolId: req.user.schoolId };
    if (academicYear) query.academicYear = academicYear;

    const concessions = await FeeConsession.find(query)
      .populate('applicableFeeHeads', 'name amount')
      .sort({ createdAt: -1 });

    res.json(concessions);
  } catch (error) {
    logger.error('Error fetching concessions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single concession
router.get('/concessions/:id', checkPermission('fees', 'view'), async (req, res) => {
  try {
    const concession = await FeeConsession.findOne({
      _id: req.params.id,
      schoolId: req.user.schoolId,
    }).populate('applicableFeeHeads', 'name amount');

    if (!concession) {
      return res.status(404).json({ error: req.t('common:routes.concessionNotFound') });
    }

    res.json(concession);
  } catch (error) {
    logger.error('Error fetching concession:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create concession
router.post('/concessions', checkPermission('fees', 'create'), async (req, res) => {
  try {
    const { schoolId: _ignored, ...data } = req.body;
    const concession = new FeeConsession({ ...data, schoolId: req.user.schoolId });
    await concession.save();

    const populated = await FeeConsession.findById(concession._id).populate(
      'applicableFeeHeads',
      'name amount'
    );

    res.status(201).json(populated);
  } catch (error) {
    logger.error('Error creating concession:', error);
    res.status(400).json({ error: error.message });
  }
});

// Update concession
router.put('/concessions/:id', checkPermission('fees', 'edit'), async (req, res) => {
  try {
    const { schoolId, ...updateData } = req.body;
    const concession = await FeeConsession.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.user.schoolId },
      updateData,
      { new: true, runValidators: true }
    ).populate('applicableFeeHeads', 'name amount');

    if (!concession) {
      return res.status(404).json({ error: req.t('common:routes.concessionNotFound') });
    }

    res.json(concession);
  } catch (error) {
    logger.error('Error updating concession:', error);
    res.status(400).json({ error: error.message });
  }
});

// Delete concession
router.delete(
  '/concessions/:id',
  checkPermission('fees', 'delete'),
  async (req, res) => {
    try {
      const concession = await FeeConsession.findOneAndDelete({
        _id: req.params.id,
        schoolId: req.user.schoolId,
      });

      if (!concession) {
        return res.status(404).json({ error: req.t('common:routes.concessionNotFound') });
      }

      res.json({ message: req.t('common:routes.concessionDeletedSuccessfully') });
    } catch (error) {
      logger.error('Error deleting concession:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// ============ LATE FEE RULES ============

// Get late fee rule
router.get('/late-fee-rules', checkPermission('fees', 'view'), async (req, res) => {
  try {
    const academicYear = sanitizeQueryStr(req.query.academicYear);
    const query = { schoolId: req.user.schoolId };
    if (academicYear) query.academicYear = academicYear;

    const rules = await LateFeeRule.find(query)
      .populate('applicableFeeHeads', 'name amount')
      .sort({ academicYear: -1 });

    res.json(rules);
  } catch (error) {
    logger.error('Error fetching late fee rules:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single late fee rule
router.get(
  '/late-fee-rules/:id',
  checkPermission('fees', 'view'),
  async (req, res) => {
    try {
      const rule = await LateFeeRule.findOne({
        _id: req.params.id,
        schoolId: req.user.schoolId,
      }).populate('applicableFeeHeads', 'name amount');

      if (!rule) {
        return res.status(404).json({ error: req.t('common:routes.lateFeeRuleNotFound') });
      }

      res.json(rule);
    } catch (error) {
      logger.error('Error fetching late fee rule:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Create or update late fee rule (only one per school per academic year)
router.post('/late-fee-rules', checkPermission('fees', 'edit'), async (req, res) => {
  try {
    const { schoolId: _bodySchoolId, academicYear, ...rest } = req.body;
    const schoolId = req.user.schoolId;

    // Check if rule already exists for this school + academic year
    let rule = await LateFeeRule.findOne({ schoolId, academicYear });

    let isNewRule = false;
    if (rule) {
      // Update existing rule
      Object.assign(rule, { ...rest, academicYear });
      await rule.save();
    } else {
      // Create new rule
      isNewRule = true;
      rule = new LateFeeRule({ ...rest, academicYear, schoolId });
      await rule.save();
    }

    const populated = await LateFeeRule.findById(rule._id).populate(
      'applicableFeeHeads',
      'name amount'
    );

    res.status(isNewRule ? 201 : 200).json(populated);
  } catch (error) {
    logger.error('Error saving late fee rule:', error);
    res.status(400).json({ error: error.message });
  }
});

// Update late fee rule
router.put(
  '/late-fee-rules/:id',
  checkPermission('fees', 'edit'),
  async (req, res) => {
    try {
      const { schoolId, ...updateData } = req.body;
      const rule = await LateFeeRule.findOneAndUpdate(
        { _id: req.params.id, schoolId: req.user.schoolId },
        updateData,
        { new: true, runValidators: true }
      ).populate('applicableFeeHeads', 'name amount');

      if (!rule) {
        return res.status(404).json({ error: req.t('common:routes.lateFeeRuleNotFound') });
      }

      res.json(rule);
    } catch (error) {
      logger.error('Error updating late fee rule:', error);
      res.status(400).json({ error: error.message });
    }
  }
);

// Delete late fee rule
router.delete(
  '/late-fee-rules/:id',
  checkPermission('fees', 'delete'),
  async (req, res) => {
    try {
      const rule = await LateFeeRule.findOneAndDelete({
        _id: req.params.id,
        schoolId: req.user.schoolId,
      });

      if (!rule) {
        return res.status(404).json({ error: req.t('common:routes.lateFeeRuleNotFound') });
      }

      res.json({ message: req.t('common:routes.lateFeeRuleDeletedSuccessfully') });
    } catch (error) {
      logger.error('Error deleting late fee rule:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// ============ FEE RULES ============

// Get fee rules
router.get('/rules', checkPermission('fees', 'view'), async (req, res) => {
  try {
    const academicYear = sanitizeQueryStr(req.query.academicYear);
    const query = { schoolId: req.user.schoolId };
    if (academicYear) query.academicYear = academicYear;

    const rules = await FeeRule.find(query).sort({ academicYear: -1 });

    res.json(rules);
  } catch (error) {
    logger.error('Error fetching fee rules:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single fee rule
router.get('/rules/:id', checkPermission('fees', 'view'), async (req, res) => {
  try {
    const rule = await FeeRule.findOne({ _id: req.params.id, schoolId: req.user.schoolId });

    if (!rule) {
      return res.status(404).json({ error: req.t('common:routes.feeRuleNotFound') });
    }

    res.json(rule);
  } catch (error) {
    logger.error('Error fetching fee rule:', error);
    res.status(500).json({ error: error.message });
  }
});

// Zod schema for fee rule creation/update
const feeRuleSchema = z.object({
  academicYear: z.string().min(1),
  newAdmission: z.object({
    feeCalculation: z.enum(['total', 'prorated']).optional(),
    prorateFrom: z.enum(['admission_date', 'month_start', 'quarter_start']).optional(),
    prorateMethod: z.enum(['monthly', 'daily']).optional(),
  }).optional(),
  allowPartialPayment: z.boolean().optional(),
  minimumPartialPaymentPercent: z.number().min(0).max(100).optional(),
  refundPolicy: z.object({
    enabled: z.boolean().optional(),
    processingDays: z.number().min(1).max(365).optional(),
  }).optional(),
}).passthrough();

// Create or update fee rule (only one per school per academic year)
router.post('/rules', checkPermission('fees', 'edit'), async (req, res) => {
  try {
    const parsed = feeRuleSchema.parse(req.body);
    const { schoolId: _bodySchoolId, academicYear, ...rest } = parsed;
    const schoolId = req.user.schoolId;

    // Check if rule already exists for this school + academic year
    let rule = await FeeRule.findOne({ schoolId, academicYear });
    let isNewRule = false;

    if (rule) {
      // Update existing rule
      Object.assign(rule, { ...rest, academicYear });
      await rule.save();
    } else {
      // Create new rule
      isNewRule = true;
      rule = new FeeRule({ ...rest, academicYear, schoolId });
      await rule.save();
    }

    res.status(isNewRule ? 201 : 200).json(rule);
  } catch (error) {
    logger.error('Error saving fee rule:', error);
    res.status(400).json({ error: error.message });
  }
});

// Update fee rule
router.put('/rules/:id', checkPermission('fees', 'edit'), async (req, res) => {
  try {
    const { schoolId, ...updateData } = req.body;
    const rule = await FeeRule.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.user.schoolId },
      updateData,
      { new: true, runValidators: true }
    );

    if (!rule) {
      return res.status(404).json({ error: req.t('common:routes.feeRuleNotFound') });
    }

    res.json(rule);
  } catch (error) {
    logger.error('Error updating fee rule:', error);
    res.status(400).json({ error: error.message });
  }
});

// Delete fee rule
router.delete('/rules/:id', checkPermission('fees', 'delete'), async (req, res) => {
  try {
    // Snapshot before deletion for trash logging
    const ruleSnapshot = await FeeRule.findOne({
      _id: req.params.id,
      schoolId: req.user.schoolId,
    }).lean();

    const rule = await FeeRule.findOneAndDelete({
      _id: req.params.id,
      schoolId: req.user.schoolId,
    });

    if (!rule) {
      return res.status(404).json({ error: req.t('common:routes.feeRuleNotFound') });
    }

    // Log to trash
    if (ruleSnapshot) {
      logToTrash({
        itemType: 'FeeRule',
        itemId: ruleSnapshot._id,
        itemName: ruleSnapshot.name || 'Fee Rule',
        originalData: ruleSnapshot,
        deletedBy: req.user?.id || req.user?._id,
        schoolId: req.user.schoolId,
      }).catch(() => {});
    }

    res.json({ message: req.t('common:routes.feeRuleDeletedSuccessfully') });
  } catch (error) {
    logger.error('Error deleting fee rule:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ PAYMENT METHOD CONFIG ============

// Get payment method config
router.get('/payment-methods', checkPermission('fees', 'view'), async (req, res) => {
  try {
    const academicYear = sanitizeQueryStr(req.query.academicYear);
    const query = { schoolId: req.user.schoolId };
    if (academicYear) query.academicYear = academicYear;

    const configs = await PaymentMethodConfig.find(query).sort({ academicYear: -1 });

    res.json(configs);
  } catch (error) {
    logger.error('Error fetching payment method config:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single payment method config
router.get(
  '/payment-methods/:id',
  checkPermission('fees', 'view'),
  async (req, res) => {
    try {
      const config = await PaymentMethodConfig.findOne({
        _id: req.params.id,
        schoolId: req.user.schoolId,
      });

      if (!config) {
        return res.status(404).json({ error: req.t('common:routes.paymentMethodConfigNotFound') });
      }

      res.json(config);
    } catch (error) {
      logger.error('Error fetching payment method config:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Create or update payment method config (only one per school per academic year)
router.post('/payment-methods', checkPermission('fees', 'edit'), async (req, res) => {
  try {
    const { academicYear } = req.body;
    const schoolId = req.user.schoolId;

    // Check if config already exists for this school + academic year
    let config = await PaymentMethodConfig.findOne({ schoolId, academicYear });
    let isNewConfig = false;

    if (config) {
      // Update existing config
      const { schoolId: _ignored, ...updateData } = req.body;
      Object.assign(config, updateData);
      await config.save();
    } else {
      // Create new config
      isNewConfig = true;
      config = new PaymentMethodConfig({ ...req.body, schoolId });
      await config.save();
    }

    res.status(isNewConfig ? 201 : 200).json(config);
  } catch (error) {
    logger.error('Error saving payment method config:', error);
    res.status(400).json({ error: error.message });
  }
});

// Update payment method config
router.put(
  '/payment-methods/:id',
  checkPermission('fees', 'edit'),
  async (req, res) => {
    try {
      const { schoolId, ...updateData } = req.body;
      const config = await PaymentMethodConfig.findOneAndUpdate(
        { _id: req.params.id, schoolId: req.user.schoolId },
        updateData,
        { new: true, runValidators: true }
      );

      if (!config) {
        return res.status(404).json({ error: req.t('common:routes.paymentMethodConfigNotFound') });
      }

      res.json(config);
    } catch (error) {
      logger.error('Error updating payment method config:', error);
      res.status(400).json({ error: error.message });
    }
  }
);

// Delete payment method config
router.delete(
  '/payment-methods/:id',
  checkPermission('fees', 'delete'),
  async (req, res) => {
    try {
      const config = await PaymentMethodConfig.findOneAndDelete({
        _id: req.params.id,
        schoolId: req.user.schoolId,
      });

      if (!config) {
        return res.status(404).json({ error: req.t('common:routes.paymentMethodConfigNotFound') });
      }

      res.json({ message: req.t('common:routes.paymentMethodConfigDeletedSuccessfully') });
    } catch (error) {
      logger.error('Error deleting payment method config:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// ============ FEE COLLECTION PERIOD ============

// Get collection period config
router.get(
  '/collection-period',
  checkPermission('fees', 'view'),
  async (req, res) => {
    try {
      const academicYear = sanitizeQueryStr(req.query.academicYear);
      const query = { schoolId: req.user.schoolId };
      if (academicYear) query.academicYear = academicYear;

      const configs = await FeeCollectionPeriod.find(query).sort({ academicYear: -1 });

      res.json(configs);
    } catch (error) {
      logger.error('Error fetching collection period config:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Get single collection period config
router.get(
  '/collection-period/:id',
  checkPermission('fees', 'view'),
  async (req, res) => {
    try {
      const config = await FeeCollectionPeriod.findOne({
        _id: req.params.id,
        schoolId: req.user.schoolId,
      });

      if (!config) {
        return res
          .status(404)
          .json({ error: req.t('common:routes.collectionPeriodConfigNotFound') });
      }

      res.json(config);
    } catch (error) {
      logger.error('Error fetching collection period config:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Create or update collection period config (only one per school per academic year)
router.post(
  '/collection-period',
  checkPermission('fees', 'edit'),
  async (req, res) => {
    try {
      const { schoolId: _bodySchoolId, academicYear, ...rest } = req.body;
      const schoolId = req.user.schoolId;

      // Check if config already exists for this school + academic year
      let config = await FeeCollectionPeriod.findOne({ schoolId, academicYear });
      let isNewConfig = false;

      if (config) {
        // Update existing config
        Object.assign(config, { ...rest, academicYear });
        await config.save();
      } else {
        // Create new config
        isNewConfig = true;
        config = new FeeCollectionPeriod({ ...rest, academicYear, schoolId });
        await config.save();
      }

      res.status(isNewConfig ? 201 : 200).json(config);
    } catch (error) {
      logger.error('Error saving collection period config:', error);
      res.status(400).json({ error: error.message });
    }
  }
);

// Update collection period config
router.put(
  '/collection-period/:id',
  checkPermission('fees', 'edit'),
  async (req, res) => {
    try {
      const { schoolId, ...updateData } = req.body;
      const config = await FeeCollectionPeriod.findOneAndUpdate(
        { _id: req.params.id, schoolId: req.user.schoolId },
        updateData,
        { new: true, runValidators: true }
      );

      if (!config) {
        return res
          .status(404)
          .json({ error: req.t('common:routes.collectionPeriodConfigNotFound') });
      }

      res.json(config);
    } catch (error) {
      logger.error('Error updating collection period config:', error);
      res.status(400).json({ error: error.message });
    }
  }
);

// Delete collection period config
router.delete(
  '/collection-period/:id',
  checkPermission('fees', 'delete'),
  async (req, res) => {
    try {
      const config = await FeeCollectionPeriod.findOneAndDelete({
        _id: req.params.id,
        schoolId: req.user.schoolId,
      });

      if (!config) {
        return res
          .status(404)
          .json({ error: req.t('common:routes.collectionPeriodConfigNotFound') });
      }

      res.json({ message: req.t('common:routes.collectionPeriodConfigDeletedSuccessfully') });
    } catch (error) {
      logger.error('Error deleting collection period config:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

export default router;
