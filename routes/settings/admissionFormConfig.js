import express from 'express';
import { z } from 'zod';
import { AdmissionFormConfig } from '../../database.js';
import { authenticate } from '../../middleware/auth.js';
import { buildSchoolScopedQuery } from '../../utils/schoolContext.js';

const router = express.Router();
router.use(authenticate);

const schoolQuery = (req, extra = {}) => buildSchoolScopedQuery(req.user?.schoolId, extra);

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const admissionFormConfigSchema = z.object({
  fieldName: z.string().min(1).max(200),
  fieldType: z.enum(['student', 'staff']).optional().default('student'),
  isVisible: z.boolean().optional().default(true),
  isMandatory: z.boolean().optional().default(false),
  autoGenerate: z.boolean().optional().default(false),
  defaultValue: z.string().max(500).optional(),
  fieldOrder: z.number().int().min(0).optional().default(0),
});

const bulkUpdateSchema = z.object({
  configs: z
    .array(
      z.object({
        _id: z.string().length(24, 'Invalid config id'),
        isVisible: z.boolean().optional(),
        isMandatory: z.boolean().optional(),
        autoGenerate: z.boolean().optional(),
        defaultValue: z.string().max(500).optional(),
        fieldOrder: z.number().int().min(0).optional(),
      })
    )
    .min(1),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /settings/admission-form-config
router.get('/admission-form-config', authenticate, async (req, res) => {
  try {
    const { fieldType } = req.query;
    const query = schoolQuery(req);
    if (fieldType) query.fieldType = fieldType;

    const configs = await AdmissionFormConfig.find(query).sort({ fieldOrder: 1, fieldName: 1 });
    res.json(configs);
  } catch (error) {
    console.error('Error fetching admission form configs:', error);
    res.status(500).json({ error: 'Failed to fetch admission form configurations' });
  }
});

// POST /settings/admission-form-config
router.post('/admission-form-config', authenticate, async (req, res) => {
  try {
    const parsed = admissionFormConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }

    const schoolId = req.user?.schoolId;
    if (!schoolId) return res.status(401).json({ error: 'Unauthorized' });

    // Check for duplicate fieldName within same school + fieldType
    const existing = await AdmissionFormConfig.findOne(
      schoolQuery(req, { fieldName: parsed.data.fieldName, fieldType: parsed.data.fieldType })
    );
    if (existing) {
      return res
        .status(409)
        .json({
          error: `Field "${parsed.data.fieldName}" already exists for ${parsed.data.fieldType} forms`,
        });
    }

    const config = await AdmissionFormConfig.create({ ...parsed.data, schoolId });
    res.status(201).json(config);
  } catch (error) {
    console.error('Error creating admission form config:', error);
    res.status(500).json({ error: 'Failed to create admission form configuration' });
  }
});

// PUT /settings/admission-form-config/bulk
router.put('/admission-form-config/bulk', authenticate, async (req, res) => {
  try {
    const parsed = bulkUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }

    const schoolId = req.user?.schoolId;
    if (!schoolId) return res.status(401).json({ error: 'Unauthorized' });

    const results = [];
    for (const item of parsed.data.configs) {
      const { _id, ...updateFields } = item;
      const updated = await AdmissionFormConfig.findOneAndUpdate(
        schoolQuery(req, { _id }),
        { $set: updateFields },
        { new: true }
      );
      if (updated) results.push(updated);
    }

    res.json({ success: true, updated: results.length, data: results });
  } catch (error) {
    console.error('Error bulk updating admission form configs:', error);
    res.status(500).json({ error: 'Failed to bulk update admission form configurations' });
  }
});

// DELETE /settings/admission-form-config/:id
router.delete('/admission-form-config/:id', authenticate, async (req, res) => {
  try {
    const deleted = await AdmissionFormConfig.findOneAndDelete(
      schoolQuery(req, { _id: req.params.id })
    );
    if (!deleted) {
      return res.status(404).json({ error: 'Admission form config not found' });
    }
    res.json({ success: true, message: 'Configuration deleted' });
  } catch (error) {
    console.error('Error deleting admission form config:', error);
    res.status(500).json({ error: 'Failed to delete admission form configuration' });
  }
});

export default router;
