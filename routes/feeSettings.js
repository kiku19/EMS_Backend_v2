import express from 'express';
import FeeConsession from '../models/FeeConsession.js';
import LateFeeRule from '../models/LateFeeRule.js';
import FeeRule from '../models/FeeRule.js';
import PaymentMethodConfig from '../models/PaymentMethodConfig.js';
import FeeCollectionPeriod from '../models/FeeCollectionPeriod.js';

const router = express.Router();

// ============ FEE CONCESSIONS ============

// Get all concessions
router.get('/concessions', async (req, res) => {
  try {
    const { academicYear } = req.query;
    const query = academicYear ? { academicYear } : {};
    
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
router.get('/concessions/:id', async (req, res) => {
  try {
    const concession = await FeeConsession.findById(req.params.id)
      .populate('applicableFeeHeads', 'name amount');
    
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
router.post('/concessions', async (req, res) => {
  try {
    const concession = new FeeConsession(req.body);
    await concession.save();
    
    const populated = await FeeConsession.findById(concession._id)
      .populate('applicableFeeHeads', 'name amount');
    
    res.status(201).json(populated);
  } catch (error) {
    console.error('Error creating concession:', error);
    res.status(400).json({ error: error.message });
  }
});

// Update concession
router.put('/concessions/:id', async (req, res) => {
  try {
    const concession = await FeeConsession.findByIdAndUpdate(
      req.params.id,
      req.body,
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
router.delete('/concessions/:id', async (req, res) => {
  try {
    const concession = await FeeConsession.findByIdAndDelete(req.params.id);
    
    if (!concession) {
      return res.status(404).json({ error: 'Concession not found' });
    }
    
    res.json({ message: 'Concession deleted successfully' });
  } catch (error) {
    console.error('Error deleting concession:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ LATE FEE RULES ============

// Get late fee rule
router.get('/late-fee-rules', async (req, res) => {
  try {
    const { academicYear } = req.query;
    const query = academicYear ? { academicYear } : {};
    
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
router.get('/late-fee-rules/:id', async (req, res) => {
  try {
    const rule = await LateFeeRule.findById(req.params.id)
      .populate('applicableFeeHeads', 'name amount');
    
    if (!rule) {
      return res.status(404).json({ error: 'Late fee rule not found' });
    }
    
    res.json(rule);
  } catch (error) {
    console.error('Error fetching late fee rule:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create or update late fee rule (only one per academic year)
router.post('/late-fee-rules', async (req, res) => {
  try {
    const { academicYear } = req.body;
    
    // Check if rule already exists for this academic year
    let rule = await LateFeeRule.findOne({ academicYear });
    
    if (rule) {
      // Update existing rule
      Object.assign(rule, req.body);
      await rule.save();
    } else {
      // Create new rule
      rule = new LateFeeRule(req.body);
      await rule.save();
    }
    
    const populated = await LateFeeRule.findById(rule._id)
      .populate('applicableFeeHeads', 'name amount');
    
    res.status(rule.isNew ? 201 : 200).json(populated);
  } catch (error) {
    console.error('Error saving late fee rule:', error);
    res.status(400).json({ error: error.message });
  }
});

// Update late fee rule
router.put('/late-fee-rules/:id', async (req, res) => {
  try {
    const rule = await LateFeeRule.findByIdAndUpdate(
      req.params.id,
      req.body,
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
});

// Delete late fee rule
router.delete('/late-fee-rules/:id', async (req, res) => {
  try {
    const rule = await LateFeeRule.findByIdAndDelete(req.params.id);
    
    if (!rule) {
      return res.status(404).json({ error: 'Late fee rule not found' });
    }
    
    res.json({ message: 'Late fee rule deleted successfully' });
  } catch (error) {
    console.error('Error deleting late fee rule:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ FEE RULES ============

// Get fee rules
router.get('/rules', async (req, res) => {
  try {
    const { academicYear } = req.query;
    const query = academicYear ? { academicYear } : {};
    
    const rules = await FeeRule.find(query).sort({ academicYear: -1 });
    
    res.json(rules);
  } catch (error) {
    console.error('Error fetching fee rules:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single fee rule
router.get('/rules/:id', async (req, res) => {
  try {
    const rule = await FeeRule.findById(req.params.id);
    
    if (!rule) {
      return res.status(404).json({ error: 'Fee rule not found' });
    }
    
    res.json(rule);
  } catch (error) {
    console.error('Error fetching fee rule:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create or update fee rule (only one per academic year)
router.post('/rules', async (req, res) => {
  try {
    const { academicYear } = req.body;
    
    // Check if rule already exists for this academic year
    let rule = await FeeRule.findOne({ academicYear });
    
    if (rule) {
      // Update existing rule
      Object.assign(rule, req.body);
      await rule.save();
    } else {
      // Create new rule
      rule = new FeeRule(req.body);
      await rule.save();
    }
    
    res.status(rule.isNew ? 201 : 200).json(rule);
  } catch (error) {
    console.error('Error saving fee rule:', error);
    res.status(400).json({ error: error.message });
  }
});

// Update fee rule
router.put('/rules/:id', async (req, res) => {
  try {
    const rule = await FeeRule.findByIdAndUpdate(
      req.params.id,
      req.body,
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
router.delete('/rules/:id', async (req, res) => {
  try {
    const rule = await FeeRule.findByIdAndDelete(req.params.id);
    
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
router.get('/payment-methods', async (req, res) => {
  try {
    const { academicYear } = req.query;
    const query = academicYear ? { academicYear } : {};
    
    const configs = await PaymentMethodConfig.find(query).sort({ academicYear: -1 });
    
    res.json(configs);
  } catch (error) {
    console.error('Error fetching payment method config:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single payment method config
router.get('/payment-methods/:id', async (req, res) => {
  try {
    const config = await PaymentMethodConfig.findById(req.params.id);
    
    if (!config) {
      return res.status(404).json({ error: 'Payment method config not found' });
    }
    
    res.json(config);
  } catch (error) {
    console.error('Error fetching payment method config:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create or update payment method config (only one per academic year)
router.post('/payment-methods', async (req, res) => {
  try {
    const { academicYear } = req.body;
    
    // Check if config already exists for this academic year
    let config = await PaymentMethodConfig.findOne({ academicYear });
    
    if (config) {
      // Update existing config
      Object.assign(config, req.body);
      await config.save();
    } else {
      // Create new config
      config = new PaymentMethodConfig(req.body);
      await config.save();
    }
    
    res.status(config.isNew ? 201 : 200).json(config);
  } catch (error) {
    console.error('Error saving payment method config:', error);
    res.status(400).json({ error: error.message });
  }
});

// Update payment method config
router.put('/payment-methods/:id', async (req, res) => {
  try {
    const config = await PaymentMethodConfig.findByIdAndUpdate(
      req.params.id,
      req.body,
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
});

// Delete payment method config
router.delete('/payment-methods/:id', async (req, res) => {
  try {
    const config = await PaymentMethodConfig.findByIdAndDelete(req.params.id);
    
    if (!config) {
      return res.status(404).json({ error: 'Payment method config not found' });
    }
    
    res.json({ message: 'Payment method config deleted successfully' });
  } catch (error) {
    console.error('Error deleting payment method config:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ FEE COLLECTION PERIOD ============

// Get collection period config
router.get('/collection-period', async (req, res) => {
  try {
    const { academicYear } = req.query;
    const query = academicYear ? { academicYear } : {};
    
    const configs = await FeeCollectionPeriod.find(query).sort({ academicYear: -1 });
    
    res.json(configs);
  } catch (error) {
    console.error('Error fetching collection period config:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single collection period config
router.get('/collection-period/:id', async (req, res) => {
  try {
    const config = await FeeCollectionPeriod.findById(req.params.id);
    
    if (!config) {
      return res.status(404).json({ error: 'Collection period config not found' });
    }
    
    res.json(config);
  } catch (error) {
    console.error('Error fetching collection period config:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create or update collection period config (only one per academic year)
router.post('/collection-period', async (req, res) => {
  try {
    const { academicYear } = req.body;
    
    // Check if config already exists for this academic year
    let config = await FeeCollectionPeriod.findOne({ academicYear });
    
    if (config) {
      // Update existing config
      Object.assign(config, req.body);
      await config.save();
    } else {
      // Create new config
      config = new FeeCollectionPeriod(req.body);
      await config.save();
    }
    
    res.status(config.isNew ? 201 : 200).json(config);
  } catch (error) {
    console.error('Error saving collection period config:', error);
    res.status(400).json({ error: error.message });
  }
});

// Update collection period config
router.put('/collection-period/:id', async (req, res) => {
  try {
    const config = await FeeCollectionPeriod.findByIdAndUpdate(
      req.params.id,
      req.body,
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
});

// Delete collection period config
router.delete('/collection-period/:id', async (req, res) => {
  try {
    const config = await FeeCollectionPeriod.findByIdAndDelete(req.params.id);
    
    if (!config) {
      return res.status(404).json({ error: 'Collection period config not found' });
    }
    
    res.json({ message: 'Collection period config deleted successfully' });
  } catch (error) {
    console.error('Error deleting collection period config:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
