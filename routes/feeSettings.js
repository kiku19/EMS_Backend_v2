import express from 'express';
import FeeConsession from '../models/FeeConsession.js';
import LateFeeRule from '../models/LateFeeRule.js';
import FeeRule from '../models/FeeRule.js';
import PaymentMethodConfig from '../models/PaymentMethodConfig.js';
import FeeCollectionPeriod from '../models/FeeCollectionPeriod.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { sanitizeQueryStr } from '../middleware/validation.js';

const router = express.Router();

// ============ FEE CONCESSIONS ============

// Get all concessions
router.get('/concessions', authenticate, checkPermission('fees', 'view'), async (req, res) => {
  try {
    const academicYear = sanitizeQueryStr(req.query.academicYear);
    const query = { schoolId: req.user.schoolId };
    if (academicYear) query.academicYear = academicYear;

    const concessions = await FeeConsession.find(query)
      .populate('applicableFeeHeads', 'name amount')
      .sort({ createdAt: -1 });

    res.json(concessions);
  } catch (error) {
    console.error('Error fetching concessions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single concession
router.get('/concessions/:id', authenticate, checkPermission('fees', 'view'), async (req, res) => {
  try {
    const concession = await FeeConsession.findOne({
      _id: req.params.id,
      schoolId: req.user.schoolId,
    }).populate('applicableFeeHeads', 'name amount');

    if (!concession) {
      return res.status(404).json({ error: 'Concession not found' });
    }

    res.json(concession);
  } catch (error) {
    console.error('Error fetching concession:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create concession
router.post('/concessions', authenticate, checkPermission('fees', 'create'), async (req, res) => {
  try {
    const concession = new FeeConsession({ ...req.body, schoolId: req.user.schoolId });
    await concession.save();

    const populated = await FeeConsession.findById(concession._id).populate(
      'applicableFeeHeads',
      'name amount'
    );

    res.status(201).json(populated);
  } catch (error) {
    console.error('Error creating concession:', error);
    res.status(400).json({ error: error.message });
  }
});

// Update concession
router.put('/concessions/:id', authenticate, checkPermission('fees', 'edit'), async (req, res) => {
  try {
    const { schoolId, ...updateData } = req.body;
    const concession = await FeeConsession.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.user.schoolId },
      updateData,
      { new: true, runValidators: true }
    ).populate('applicableFeeHeads', 'name amount');

    if (!concession) {
      return res.status(404).json({ error: 'Concession not found' });
    }

    res.json(concession);
  } catch (error) {
    console.error('Error updating concession:', error);
    res.status(400).json({ error: error.message });
  }
});

// Delete concession
router.delete(
  '/concessions/:id',
  authenticate,
  checkPermission('fees', 'delete'),
  async (req, res) => {
    try {
      const concession = await FeeConsession.findOneAndDelete({
        _id: req.params.id,
        schoolId: req.user.schoolId,
      });

      if (!concession) {
        return res.status(404).json({ error: 'Concession not found' });
      }

      res.json({ message: 'Concession deleted successfully' });
    } catch (error) {
      console.error('Error deleting concession:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// ============ LATE FEE RULES ============

// Get late fee rule
router.get('/late-fee-rules', authenticate, checkPermission('fees', 'view'), async (req, res) => {
  try {
    const academicYear = sanitizeQueryStr(req.query.academicYear);
    const query = { schoolId: req.user.schoolId };
    if (academicYear) query.academicYear = academicYear;

    const rules = await LateFeeRule.find(query)
      .populate('applicableFeeHeads', 'name amount')
      .sort({ academicYear: -1 });

    res.json(rules);
  } catch (error) {
    console.error('Error fetching late fee rules:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single late fee rule
router.get(
  '/late-fee-rules/:id',
  authenticate,
  checkPermission('fees', 'view'),
  async (req, res) => {
    try {
      const rule = await LateFeeRule.findOne({
        _id: req.params.id,
        schoolId: req.user.schoolId,
      }).populate('applicableFeeHeads', 'name amount');

      if (!rule) {
        return res.status(404).json({ error: 'Late fee rule not found' });
      }

      res.json(rule);
    } catch (error) {
      console.error('Error fetching late fee rule:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Create or update late fee rule (only one per school per academic year)
router.post('/late-fee-rules', authenticate, checkPermission('fees', 'edit'), async (req, res) => {
  try {
    const { academicYear } = req.body;
    const schoolId = req.user.schoolId;

    // Check if rule already exists for this school + academic year
    let rule = await LateFeeRule.findOne({ schoolId, academicYear });

    if (rule) {
      // Update existing rule
      const { schoolId: _ignored, ...updateData } = req.body;
      Object.assign(rule, updateData);
      await rule.save();
    } else {
      // Create new rule
      rule = new LateFeeRule({ ...req.body, schoolId });
      await rule.save();
    }

    const populated = await LateFeeRule.findById(rule._id).populate(
      'applicableFeeHeads',
      'name amount'
    );

    res.status(rule.isNew ? 201 : 200).json(populated);
  } catch (error) {
    console.error('Error saving late fee rule:', error);
    res.status(400).json({ error: error.message });
  }
});

// Update late fee rule
router.put(
  '/late-fee-rules/:id',
  authenticate,
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
        return res.status(404).json({ error: 'Late fee rule not found' });
      }

      res.json(rule);
    } catch (error) {
      console.error('Error updating late fee rule:', error);
      res.status(400).json({ error: error.message });
    }
  }
);

// Delete late fee rule
router.delete(
  '/late-fee-rules/:id',
  authenticate,
  checkPermission('fees', 'delete'),
  async (req, res) => {
    try {
      const rule = await LateFeeRule.findOneAndDelete({
        _id: req.params.id,
        schoolId: req.user.schoolId,
      });

      if (!rule) {
        return res.status(404).json({ error: 'Late fee rule not found' });
      }

      res.json({ message: 'Late fee rule deleted successfully' });
    } catch (error) {
      console.error('Error deleting late fee rule:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// ============ FEE RULES ============

// Get fee rules
router.get('/rules', authenticate, checkPermission('fees', 'view'), async (req, res) => {
  try {
    const academicYear = sanitizeQueryStr(req.query.academicYear);
    const query = { schoolId: req.user.schoolId };
    if (academicYear) query.academicYear = academicYear;

    const rules = await FeeRule.find(query).sort({ academicYear: -1 });

    res.json(rules);
  } catch (error) {
    console.error('Error fetching fee rules:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single fee rule
router.get('/rules/:id', authenticate, checkPermission('fees', 'view'), async (req, res) => {
  try {
    const rule = await FeeRule.findOne({ _id: req.params.id, schoolId: req.user.schoolId });

    if (!rule) {
      return res.status(404).json({ error: 'Fee rule not found' });
    }

    res.json(rule);
  } catch (error) {
    console.error('Error fetching fee rule:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create or update fee rule (only one per school per academic year)
router.post('/rules', authenticate, checkPermission('fees', 'edit'), async (req, res) => {
  try {
    const { academicYear } = req.body;
    const schoolId = req.user.schoolId;

    // Check if rule already exists for this school + academic year
    let rule = await FeeRule.findOne({ schoolId, academicYear });

    if (rule) {
      // Update existing rule
      const { schoolId: _ignored, ...updateData } = req.body;
      Object.assign(rule, updateData);
      await rule.save();
    } else {
      // Create new rule
      rule = new FeeRule({ ...req.body, schoolId });
      await rule.save();
    }

    res.status(rule.isNew ? 201 : 200).json(rule);
  } catch (error) {
    console.error('Error saving fee rule:', error);
    res.status(400).json({ error: error.message });
  }
});

// Update fee rule
router.put('/rules/:id', authenticate, checkPermission('fees', 'edit'), async (req, res) => {
  try {
    const { schoolId, ...updateData } = req.body;
    const rule = await FeeRule.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.user.schoolId },
      updateData,
      { new: true, runValidators: true }
    );

    if (!rule) {
      return res.status(404).json({ error: 'Fee rule not found' });
    }

    res.json(rule);
  } catch (error) {
    console.error('Error updating fee rule:', error);
    res.status(400).json({ error: error.message });
  }
});

// Delete fee rule
router.delete('/rules/:id', authenticate, checkPermission('fees', 'delete'), async (req, res) => {
  try {
    const rule = await FeeRule.findOneAndDelete({
      _id: req.params.id,
      schoolId: req.user.schoolId,
    });

    if (!rule) {
      return res.status(404).json({ error: 'Fee rule not found' });
    }

    res.json({ message: 'Fee rule deleted successfully' });
  } catch (error) {
    console.error('Error deleting fee rule:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ PAYMENT METHOD CONFIG ============

// Get payment method config
router.get('/payment-methods', authenticate, checkPermission('fees', 'view'), async (req, res) => {
  try {
    const academicYear = sanitizeQueryStr(req.query.academicYear);
    const query = { schoolId: req.user.schoolId };
    if (academicYear) query.academicYear = academicYear;

    const configs = await PaymentMethodConfig.find(query).sort({ academicYear: -1 });

    res.json(configs);
  } catch (error) {
    console.error('Error fetching payment method config:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single payment method config
router.get(
  '/payment-methods/:id',
  authenticate,
  checkPermission('fees', 'view'),
  async (req, res) => {
    try {
      const config = await PaymentMethodConfig.findOne({
        _id: req.params.id,
        schoolId: req.user.schoolId,
      });

      if (!config) {
        return res.status(404).json({ error: 'Payment method config not found' });
      }

      res.json(config);
    } catch (error) {
      console.error('Error fetching payment method config:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Create or update payment method config (only one per school per academic year)
router.post('/payment-methods', authenticate, checkPermission('fees', 'edit'), async (req, res) => {
  try {
    const { academicYear } = req.body;
    const schoolId = req.user.schoolId;

    // Check if config already exists for this school + academic year
    let config = await PaymentMethodConfig.findOne({ schoolId, academicYear });

    if (config) {
      // Update existing config
      const { schoolId: _ignored, ...updateData } = req.body;
      Object.assign(config, updateData);
      await config.save();
    } else {
      // Create new config
      config = new PaymentMethodConfig({ ...req.body, schoolId });
      await config.save();
    }

    res.status(config.isNew ? 201 : 200).json(config);
  } catch (error) {
    console.error('Error saving payment method config:', error);
    res.status(400).json({ error: error.message });
  }
});

// Update payment method config
router.put(
  '/payment-methods/:id',
  authenticate,
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
        return res.status(404).json({ error: 'Payment method config not found' });
      }

      res.json(config);
    } catch (error) {
      console.error('Error updating payment method config:', error);
      res.status(400).json({ error: error.message });
    }
  }
);

// Delete payment method config
router.delete(
  '/payment-methods/:id',
  authenticate,
  checkPermission('fees', 'delete'),
  async (req, res) => {
    try {
      const config = await PaymentMethodConfig.findOneAndDelete({
        _id: req.params.id,
        schoolId: req.user.schoolId,
      });

      if (!config) {
        return res.status(404).json({ error: 'Payment method config not found' });
      }

      res.json({ message: 'Payment method config deleted successfully' });
    } catch (error) {
      console.error('Error deleting payment method config:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// ============ FEE COLLECTION PERIOD ============

// Get collection period config
router.get(
  '/collection-period',
  authenticate,
  checkPermission('fees', 'view'),
  async (req, res) => {
    try {
      const academicYear = sanitizeQueryStr(req.query.academicYear);
      const query = { schoolId: req.user.schoolId };
      if (academicYear) query.academicYear = academicYear;

      const configs = await FeeCollectionPeriod.find(query).sort({ academicYear: -1 });

      res.json(configs);
    } catch (error) {
      console.error('Error fetching collection period config:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Get single collection period config
router.get(
  '/collection-period/:id',
  authenticate,
  checkPermission('fees', 'view'),
  async (req, res) => {
    try {
      const config = await FeeCollectionPeriod.findOne({
        _id: req.params.id,
        schoolId: req.user.schoolId,
      });

      if (!config) {
        return res.status(404).json({ error: 'Collection period config not found' });
      }

      res.json(config);
    } catch (error) {
      console.error('Error fetching collection period config:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Create or update collection period config (only one per school per academic year)
router.post(
  '/collection-period',
  authenticate,
  checkPermission('fees', 'edit'),
  async (req, res) => {
    try {
      const { academicYear } = req.body;
      const schoolId = req.user.schoolId;

      // Check if config already exists for this school + academic year
      let config = await FeeCollectionPeriod.findOne({ schoolId, academicYear });

      if (config) {
        // Update existing config
        const { schoolId: _ignored, ...updateData } = req.body;
        Object.assign(config, updateData);
        await config.save();
      } else {
        // Create new config
        config = new FeeCollectionPeriod({ ...req.body, schoolId });
        await config.save();
      }

      res.status(config.isNew ? 201 : 200).json(config);
    } catch (error) {
      console.error('Error saving collection period config:', error);
      res.status(400).json({ error: error.message });
    }
  }
);

// Update collection period config
router.put(
  '/collection-period/:id',
  authenticate,
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
        return res.status(404).json({ error: 'Collection period config not found' });
      }

      res.json(config);
    } catch (error) {
      console.error('Error updating collection period config:', error);
      res.status(400).json({ error: error.message });
    }
  }
);

// Delete collection period config
router.delete(
  '/collection-period/:id',
  authenticate,
  checkPermission('fees', 'delete'),
  async (req, res) => {
    try {
      const config = await FeeCollectionPeriod.findOneAndDelete({
        _id: req.params.id,
        schoolId: req.user.schoolId,
      });

      if (!config) {
        return res.status(404).json({ error: 'Collection period config not found' });
      }

      res.json({ message: 'Collection period config deleted successfully' });
    } catch (error) {
      console.error('Error deleting collection period config:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

export default router;
