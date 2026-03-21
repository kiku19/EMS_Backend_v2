import express from 'express';
import { SchoolSettings } from '../../database.js';
import { authenticate } from '../../middleware/auth.js';
import Reminder from '../../models/Reminder.js';
import { ensureSchoolSettings } from '../../utils/academicYear.js';
import { buildSchoolScopedQuery } from '../../utils/schoolContext.js';

const router = express.Router();

// ============================================================
// PAYROLL REMINDER ENDPOINT
// ============================================================

// Get payroll reminder
router.get('/payroll/reminder', authenticate, async (req, res) => {
  try {
    // Get the most recent payroll reminder
    const reminder = await Reminder.findOne({ type: 'payroll', isActive: true })
      .sort({ createdAt: -1 })
      .lean();

    if (!reminder) {
      return res.json({
        shouldShow: false,
        message: '',
      });
    }

    // Check if reminder should be shown based on triggers
    const today = new Date();
    const startDate = new Date(reminder.startDate);
    const endDate = reminder.endDate ? new Date(reminder.endDate) : null;

    // Check if current date is within reminder period
    const isWithinPeriod = today >= startDate && (!endDate || today <= endDate);

    // Check if it's time to show the reminder (e.g., 5 days before)
    const daysUntilStart = Math.ceil((startDate - today) / (1000 * 60 * 60 * 24));
    const shouldShow = isWithinPeriod || (daysUntilStart <= 5 && daysUntilStart >= 0);

    if (shouldShow && reminder.message) {
      res.json({
        shouldShow: true,
        message: reminder.message,
        daysUntilStart: Math.max(0, daysUntilStart),
        reminderId: reminder._id,
      });
    } else {
      res.json({
        shouldShow: false,
        message: '',
      });
    }
  } catch (error) {
    console.error('Error fetching payroll reminder:', error);
    res.status(500).json({ error: 'Failed to fetch payroll reminder' });
  }
});

// ============================================================
// DOCUMENT CONFIGURATION ENDPOINTS
// ============================================================

// Get all document configurations
router.get('/document-config', authenticate, async (req, res) => {
  try {
    const { DocumentConfig } = await import('../../database.js');
    const configs = await DocumentConfig.find().sort({ documentName: 1 });
    res.json(configs);
  } catch (error) {
    console.error('Error fetching document configs:', error);
    res.status(500).json({ error: 'Failed to fetch document configurations' });
  }
});

// Create document configuration
router.post('/document-config', authenticate, async (req, res) => {
  try {
    const { DocumentConfig } = await import('../../database.js');
    const config = await DocumentConfig.create(req.body);
    res.json(config);
  } catch (error) {
    console.error('Error creating document config:', error);
    res.status(500).json({ error: 'Failed to create document configuration' });
  }
});

// Update document configuration
router.put('/document-config/:id', authenticate, async (req, res) => {
  try {
    const { DocumentConfig } = await import('../../database.js');
    const config = await DocumentConfig.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!config) {
      return res.status(404).json({ error: 'Document configuration not found' });
    }

    res.json(config);
  } catch (error) {
    console.error('Error updating document config:', error);
    res.status(500).json({ error: 'Failed to update document configuration' });
  }
});

// Delete document configuration
router.delete('/document-config/:id', authenticate, async (req, res) => {
  try {
    const { DocumentConfig } = await import('../../database.js');
    const config = await DocumentConfig.findByIdAndDelete(req.params.id);

    if (!config) {
      return res.status(404).json({ error: 'Document configuration not found' });
    }

    res.json({ success: true, message: 'Document configuration deleted' });
  } catch (error) {
    console.error('Error deleting document config:', error);
    res.status(500).json({ error: 'Failed to delete document configuration' });
  }
});

// Get next TC serial number(s) and increment counter atomically
router.post('/next-tc-number', authenticate, async (req, res) => {
  try {
    const count = Math.max(1, parseInt(req.body.count) || 1);

    // Ensure settings exist before atomic increment
    await ensureSchoolSettings(req.user?.schoolId);

    // Atomically increment and return pre-update document
    const before = await SchoolSettings.findOneAndUpdate(
      buildSchoolScopedQuery(req.user?.schoolId),
      { $inc: { 'tc.currentNumber': count } },
      { new: false }
    );

    const prefix = before?.tc?.prefix || 'TC';
    const startNum = before?.tc?.currentNumber ?? 1;

    const numbers = Array.from(
      { length: count },
      (_, i) => `${prefix}${String(startNum + i).padStart(4, '0')}`
    );

    res.json({ numbers });
  } catch (error) {
    console.error('Error generating TC number:', error);
    res.status(500).json({ error: 'Failed to generate TC number' });
  }
});

export default router;
