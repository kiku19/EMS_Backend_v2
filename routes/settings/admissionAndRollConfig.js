import express from 'express';
import { z } from 'zod';
import { AdmissionIdConfig, RollNumberConfig } from '../../database.js';
import { authenticate } from '../../middleware/auth.js';
import { checkPermission } from '../../middleware/auth/permissions.js';
import { buildSchoolScopedQuery } from '../../utils/schoolContext.js';

const router = express.Router();
router.use(authenticate);

const schoolQuery = (req, extra = {}) => buildSchoolScopedQuery(req.user?.schoolId, extra);

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

// Note: frontend sends the full config object (including _id, schoolId,
// currentNumber, timestamps, __v) from its state. We use default Zod
// strip behaviour so only the declared fields pass through to the update.
const admissionIdConfigSchema = z.object({
  prefix: z.string().trim().min(1).max(20),
  yearFormat: z.enum(['YYYY', 'YY', 'none']),
  separator: z.enum(['-', '/', '_', '']),
  numberPadding: z.number().int().min(1).max(10),
  startingNumber: z.number().int().min(1),
  resetFrequency: z.enum(['yearly', 'monthly', 'never']),
});

const rollNumberConfigSchema = z.object({
  format: z.enum(['sequential', 'class-based']),
  startingNumber: z.number().int().min(1),
  resetPerClass: z.boolean(),
});

// ─── Admission ID Config Defaults ────────────────────────────────────────────

const DEFAULT_ADMISSION_ID_CONFIG = {
  prefix: 'ADM',
  yearFormat: 'YYYY',
  separator: '-',
  numberPadding: 4,
  startingNumber: 1,
  currentNumber: 0,
  resetFrequency: 'yearly',
};

const DEFAULT_ROLL_NUMBER_CONFIG = {
  format: 'sequential',
  startingNumber: 1,
  resetPerClass: true,
};

// ─── Admission ID Config Routes ──────────────────────────────────────────────

// GET /settings/admission-id-config
router.get('/admission-id-config', authenticate, async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    if (!schoolId) return res.status(401).json({ error: 'Unauthorized' });

    const config = await AdmissionIdConfig.findOne({ schoolId }).lean();

    if (!config) {
      // Return defaults (not 404) per project convention
      return res.json({ ...DEFAULT_ADMISSION_ID_CONFIG, _initialized: false });
    }

    res.json(config);
  } catch (error) {
    console.error('Error fetching admission ID config:', error);
    res.status(500).json({ error: 'Failed to fetch admission ID configuration' });
  }
});

// PUT /settings/admission-id-config
router.put(
  '/admission-id-config',
  authenticate,
  checkPermission('settings', 'edit'),
  async (req, res) => {
    try {
      const parsed = admissionIdConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
      }

      const schoolId = req.user?.schoolId;
      if (!schoolId) return res.status(401).json({ error: 'Unauthorized' });

      // Upsert: create if not exists, update if exists
      // Never allow schoolId from body -- always from req.user
      const config = await AdmissionIdConfig.findOneAndUpdate(
        { schoolId },
        { $set: { ...parsed.data, schoolId } },
        { new: true, upsert: true, runValidators: true }
      );

      res.json(config);
    } catch (error) {
      console.error('Error updating admission ID config:', error);
      res.status(500).json({ error: 'Failed to update admission ID configuration' });
    }
  }
);

// POST /settings/admission-id-config/preview
router.post('/admission-id-config/preview', authenticate, async (req, res) => {
  try {
    const { prefix, yearFormat, separator, numberPadding, startingNumber } = req.body;

    const now = new Date();
    let preview = prefix || 'ADM';

    if (yearFormat && yearFormat !== 'none') {
      if (separator) preview += separator;
      preview += yearFormat === 'YYYY' ? now.getFullYear() : String(now.getFullYear()).slice(-2);
    }

    if (separator) preview += separator;
    preview += String(startingNumber || 1).padStart(numberPadding || 4, '0');

    res.json({ preview });
  } catch (error) {
    console.error('Error generating admission ID preview:', error);
    res.status(500).json({ error: 'Failed to generate preview' });
  }
});

// ─── Roll Number Config Routes ───────────────────────────────────────────────

// GET /settings/roll-number-config
router.get('/roll-number-config', authenticate, async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    if (!schoolId) return res.status(401).json({ error: 'Unauthorized' });

    const config = await RollNumberConfig.findOne({ schoolId }).lean();

    if (!config) {
      // Return defaults (not 404) per project convention
      return res.json({ ...DEFAULT_ROLL_NUMBER_CONFIG, _initialized: false });
    }

    res.json(config);
  } catch (error) {
    console.error('Error fetching roll number config:', error);
    res.status(500).json({ error: 'Failed to fetch roll number configuration' });
  }
});

// PUT /settings/roll-number-config
router.put(
  '/roll-number-config',
  authenticate,
  checkPermission('settings', 'edit'),
  async (req, res) => {
    try {
      const parsed = rollNumberConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
      }

      const schoolId = req.user?.schoolId;
      if (!schoolId) return res.status(401).json({ error: 'Unauthorized' });

      // Upsert: create if not exists, update if exists
      // Never allow schoolId from body -- always from req.user
      const config = await RollNumberConfig.findOneAndUpdate(
        { schoolId },
        { $set: { ...parsed.data, schoolId } },
        { new: true, upsert: true, runValidators: true }
      );

      res.json(config);
    } catch (error) {
      console.error('Error updating roll number config:', error);
      res.status(500).json({ error: 'Failed to update roll number configuration' });
    }
  }
);

export default router;
