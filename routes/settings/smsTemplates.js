import express from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import SmsTemplate from '../../models/SmsTemplate.js';

const router = express.Router();

const smsTemplateZodSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  type: z.enum([
    'fee_reminder',
    'attendance_alert',
    'announcement',
    'exam_result',
    'welcome',
    'otp',
    'custom',
  ]),
  body: z
    .string()
    .min(1, 'SMS body is required')
    .max(1600, 'SMS body cannot exceed 1600 characters'),
  variables: z.array(z.string().trim()).optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

// List SMS templates
router.get('/sms-templates', authenticate, async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const { type, isActive } = req.query;

    const filter = { schoolId };
    if (type) filter.type = type;
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    const templates = await SmsTemplate.find(filter).sort({ createdAt: -1 }).lean();
    res.json(templates);
  } catch (error) {
    console.error('Error fetching SMS templates:', error);
    res.status(500).json({ error: 'Failed to fetch SMS templates' });
  }
});

// Get single SMS template
router.get('/sms-templates/:id', authenticate, async (req, res) => {
  try {
    const template = await SmsTemplate.findOne({
      _id: req.params.id,
      schoolId: req.user?.schoolId,
    });
    if (!template) return res.status(404).json({ error: 'SMS template not found' });
    res.json(template);
  } catch (error) {
    console.error('Error fetching SMS template:', error);
    res.status(500).json({ error: 'Failed to fetch SMS template' });
  }
});

// Create SMS template
router.post('/sms-templates', authenticate, async (req, res) => {
  try {
    const parsed = smsTemplateZodSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
      });
    }

    const schoolId = req.user?.schoolId;
    const data = parsed.data;

    const existing = await SmsTemplate.findOne({ schoolId, name: data.name });
    if (existing) {
      return res.status(409).json({ error: 'An SMS template with this name already exists' });
    }

    const template = await SmsTemplate.create({ ...data, schoolId, createdBy: req.user?._id });
    res.status(201).json(template);
  } catch (error) {
    console.error('Error creating SMS template:', error);
    res.status(500).json({ error: 'Failed to create SMS template' });
  }
});

// Update SMS template
router.put('/sms-templates/:id', authenticate, async (req, res) => {
  try {
    const parsed = smsTemplateZodSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
      });
    }

    const schoolId = req.user?.schoolId;
    const data = parsed.data;

    if (data.name) {
      const duplicate = await SmsTemplate.findOne({
        schoolId,
        name: data.name,
        _id: { $ne: req.params.id },
      });
      if (duplicate) {
        return res.status(409).json({ error: 'An SMS template with this name already exists' });
      }
    }

    const template = await SmsTemplate.findOneAndUpdate(
      { _id: req.params.id, schoolId },
      { $set: data },
      { new: true, runValidators: true }
    );

    if (!template) return res.status(404).json({ error: 'SMS template not found' });
    res.json(template);
  } catch (error) {
    console.error('Error updating SMS template:', error);
    res.status(500).json({ error: 'Failed to update SMS template' });
  }
});

// Delete SMS template
router.delete('/sms-templates/:id', authenticate, async (req, res) => {
  try {
    const template = await SmsTemplate.findOneAndDelete({
      _id: req.params.id,
      schoolId: req.user?.schoolId,
    });
    if (!template) return res.status(404).json({ error: 'SMS template not found' });
    res.json({ success: true, message: 'SMS template deleted' });
  } catch (error) {
    console.error('Error deleting SMS template:', error);
    res.status(500).json({ error: 'Failed to delete SMS template' });
  }
});

export default router;
