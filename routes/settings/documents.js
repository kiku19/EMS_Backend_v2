import express from 'express';
import mongoose from 'mongoose';
import { SchoolSettings } from '../../database.js';
import { authenticate } from '../../middleware/auth.js';
import { checkPermission } from '../../middleware/auth/permissions.js';
import Reminder from '../../models/Reminder.js';
import { ensureSchoolSettings } from '../../utils/academicYear.js';
import { buildSchoolScopedQuery } from '../../utils/schoolContext.js';

const router = express.Router();
router.use(authenticate);

const schoolQuery = (req, extra = {}) => buildSchoolScopedQuery(req.user?.schoolId, extra);

// ============================================================
// PAYROLL REMINDER ENDPOINT
// ============================================================

// Get payroll reminder
router.get('/payroll/reminder', authenticate, async (req, res) => {
  try {
    // Get the most recent payroll reminder scoped to this school
    const reminder = await Reminder.findOne(schoolQuery(req, { type: 'payroll', isActive: true }))
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
    const configs = await DocumentConfig.find(schoolQuery(req)).sort({ documentName: 1 });
    res.json(configs);
  } catch (error) {
    console.error('Error fetching document configs:', error);
    res.status(500).json({ error: 'Failed to fetch document configurations' });
  }
});

// Create document configuration
router.post(
  '/document-config',
  authenticate,
  checkPermission('settings', 'create'),
  async (req, res) => {
    try {
      const { DocumentConfig } = await import('../../database.js');
      // Only allow known fields — prevent injection of _id, createdAt, etc.
      const {
        documentName,
        isRequired,
        uploadType,
        allowedFormats,
        maxFileSize,
        displayOrder,
        description,
      } = req.body;
      const config = await DocumentConfig.create({
        documentName,
        isRequired,
        uploadType,
        allowedFormats,
        maxFileSize,
        displayOrder,
        description,
        schoolId: req.user.schoolId,
      });
      res.json(config);
    } catch (error) {
      console.error('Error creating document config:', error);
      res.status(500).json({ error: 'Failed to create document configuration' });
    }
  }
);

// Bulk update document configurations — must be before /:id to prevent Express matching "bulk" as an :id
router.put(
  '/document-config/bulk',
  authenticate,
  checkPermission('settings', 'edit'),
  async (req, res) => {
    try {
      const { DocumentConfig } = await import('../../database.js');
      const { configs } = req.body;

      if (!Array.isArray(configs) || configs.length === 0) {
        return res.status(400).json({ error: 'configs array is required and must not be empty' });
      }

      // Cap at 50 to prevent abuse
      if (configs.length > 50) {
        return res.status(400).json({ error: 'Maximum 50 configurations can be updated at once' });
      }

      const results = [];
      const errors = [];

      for (const configData of configs) {
        if (!configData._id) {
          errors.push({ error: 'Missing _id', data: configData });
          continue;
        }

        const {
          _id,
          schoolId: _ignored,
          createdAt: _ca,
          updatedAt: _ua,
          __v: _v,
          ...updateData
        } = configData;

        try {
          const updated = await DocumentConfig.findOneAndUpdate(
            schoolQuery(req, { _id }),
            updateData,
            { new: true, runValidators: true }
          );

          if (updated) {
            results.push(updated);
          } else {
            errors.push({ error: 'Not found', _id });
          }
        } catch (updateError) {
          errors.push({ error: updateError.message, _id });
        }
      }

      res.json({
        success: true,
        updated: results.length,
        failed: errors.length,
        results,
        ...(errors.length > 0 ? { errors } : {}),
      });
    } catch (error) {
      console.error('Error bulk updating document configs:', error);
      res.status(500).json({ error: 'Failed to bulk update document configurations' });
    }
  }
);

// Atomic save document configurations — replaces the entire school-scoped set in one transaction
router.put(
  '/document-config/atomic',
  authenticate,
  checkPermission('settings', 'edit'),
  async (req, res) => {
    try {
      const { DocumentConfig } = await import('../../database.js');
      const { configs } = req.body;

      if (!Array.isArray(configs)) {
        return res.status(400).json({ error: 'configs must be an array' });
      }

      // Cap at 50 to prevent abuse
      if (configs.length > 50) {
        return res.status(400).json({ error: 'Maximum 50 configurations can be saved at once' });
      }

      const schoolId = req.user?.schoolId;
      if (!schoolId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Validate every item has a documentName
      const invalidIndex = configs.findIndex(
        (cfg) => !cfg.documentName || typeof cfg.documentName !== 'string'
      );
      if (invalidIndex !== -1) {
        return res.status(400).json({
          error: `Validation failed: documentName is required at index ${invalidIndex}`,
        });
      }

      const mongoSession = await mongoose.startSession();
      let savedConfigs = [];

      try {
        await mongoSession.withTransaction(async () => {
          // 1. Delete all existing document configs for this school
          await DocumentConfig.deleteMany({ schoolId }).session(mongoSession);

          // 2. Prepare clean documents — strip any injected fields and enforce types
          const docsToInsert = configs.map((cfg, index) => ({
            documentName: cfg.documentName.trim(),
            isRequired: !!cfg.isRequired,
            uploadType: ['single', 'multiple', 'front-back'].includes(cfg.uploadType)
              ? cfg.uploadType
              : 'single',
            allowedFormats: Array.isArray(cfg.allowedFormats)
              ? cfg.allowedFormats.filter((f) => typeof f === 'string')
              : ['pdf', 'jpg', 'png'],
            maxFileSize:
              typeof cfg.maxFileSize === 'number' && cfg.maxFileSize > 0
                ? cfg.maxFileSize
                : 5242880,
            displayOrder: typeof cfg.displayOrder === 'number' ? cfg.displayOrder : index + 1,
            description: typeof cfg.description === 'string' ? cfg.description.trim() : '',
            schoolId,
          }));

          // 3. Insert the new set atomically inside the transaction
          if (docsToInsert.length > 0) {
            savedConfigs = await DocumentConfig.insertMany(docsToInsert, {
              session: mongoSession,
              ordered: true,
            });
          }
        });
      } finally {
        mongoSession.endSession();
      }

      res.json(savedConfigs);
    } catch (error) {
      console.error('Error atomic saving document configs:', error);
      res.status(500).json({ error: 'Failed to save document configurations' });
    }
  }
);

// Update document configuration
router.put(
  '/document-config/:id',
  authenticate,
  checkPermission('settings', 'edit'),
  async (req, res) => {
    try {
      const { DocumentConfig } = await import('../../database.js');
      const { schoolId: _ignored, ...updateData } = req.body; // never allow schoolId override from body
      const config = await DocumentConfig.findOneAndUpdate(
        schoolQuery(req, { _id: req.params.id }),
        updateData,
        { new: true, runValidators: true }
      );

      if (!config) {
        return res.status(404).json({ error: 'Document configuration not found' });
      }

      res.json(config);
    } catch (error) {
      console.error('Error updating document config:', error);
      res.status(500).json({ error: 'Failed to update document configuration' });
    }
  }
);

// Delete document configuration
router.delete(
  '/document-config/:id',
  authenticate,
  checkPermission('settings', 'delete'),
  async (req, res) => {
    try {
      const { DocumentConfig } = await import('../../database.js');
      const config = await DocumentConfig.findOneAndDelete(
        schoolQuery(req, { _id: req.params.id })
      );

      if (!config) {
        return res.status(404).json({ error: 'Document configuration not found' });
      }

      res.json({ success: true, message: 'Document configuration deleted' });
    } catch (error) {
      console.error('Error deleting document config:', error);
      res.status(500).json({ error: 'Failed to delete document configuration' });
    }
  }
);

// Get next TC serial number(s) and increment counter atomically
router.post(
  '/next-tc-number',
  authenticate,
  checkPermission('settings', 'edit'),
  async (req, res) => {
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
  }
);

export default router;
