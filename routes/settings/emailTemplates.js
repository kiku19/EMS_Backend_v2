import express from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import EmailTemplate from '../../models/EmailTemplate.js';

const router = express.Router();
router.use(authenticate);

const emailTemplateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  type: z.enum([
    'welcome',
    'fee_reminder',
    'attendance_alert',
    'announcement',
    'exam_result',
    'custom',
  ]),
  subject: z.string().trim().min(1, 'Subject is required').max(200),
  htmlBody: z.string().min(1, 'HTML body is required'),
  textBody: z.string().optional(),
  variables: z.array(z.string().trim()).optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

// Sample data used for template preview
const PREVIEW_SAMPLE_DATA = {
  student: 'John Smith',
  parent: 'Mr. Robert Smith',
  class: 'Grade 10-A',
  amount: '₹5,000',
  date: new Date().toLocaleDateString('en-IN'),
  time: '10:30 AM',
  teacher: 'Mrs. Priya Sharma',
  school: 'Greenwood International School',
};

// List email templates for school
router.get('/email-templates', authenticate, async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const { type, isActive } = req.query;

    const filter = { schoolId };
    if (type) filter.type = type;
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    const templates = await EmailTemplate.find(filter).sort({ createdAt: -1 }).lean();

    res.json(templates);
  } catch (error) {
    console.error('Error fetching email templates:', error);
    res.status(500).json({ error: 'Failed to fetch email templates' });
  }
});

// Get single email template
router.get('/email-templates/:id', authenticate, async (req, res) => {
  try {
    const template = await EmailTemplate.findOne({
      _id: req.params.id,
      schoolId: req.user?.schoolId,
    });

    if (!template) {
      return res.status(404).json({ error: 'Email template not found' });
    }

    res.json(template);
  } catch (error) {
    console.error('Error fetching email template:', error);
    res.status(500).json({ error: 'Failed to fetch email template' });
  }
});

// Create email template
router.post('/email-templates', authenticate, async (req, res) => {
  try {
    const parsed = emailTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
      });
    }

    const schoolId = req.user?.schoolId;
    const data = parsed.data;

    // Check for duplicate name within school
    const existing = await EmailTemplate.findOne({ schoolId, name: data.name });
    if (existing) {
      return res.status(409).json({ error: 'An email template with this name already exists' });
    }

    const template = await EmailTemplate.create({
      ...data,
      schoolId,
      createdBy: req.user?._id,
    });

    res.status(201).json(template);
  } catch (error) {
    console.error('Error creating email template:', error);
    res.status(500).json({ error: 'Failed to create email template' });
  }
});

// Update email template
router.put('/email-templates/:id', authenticate, async (req, res) => {
  try {
    const parsed = emailTemplateSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
      });
    }

    const schoolId = req.user?.schoolId;
    const data = parsed.data;

    const template = await EmailTemplate.findOne({ _id: req.params.id, schoolId });
    if (!template) {
      return res.status(404).json({ error: 'Email template not found' });
    }

    // Check duplicate name if name is being changed
    if (data.name && data.name !== template.name) {
      const duplicate = await EmailTemplate.findOne({
        schoolId,
        name: data.name,
        _id: { $ne: req.params.id },
      });
      if (duplicate) {
        return res.status(409).json({ error: 'An email template with this name already exists' });
      }
    }

    // Save current version before update (keep last 5)
    const versionEntry = {
      subject: template.subject,
      htmlBody: template.htmlBody,
      textBody: template.textBody,
      savedAt: new Date(),
      savedBy: req.user?._id,
    };
    template.versions = [...(template.versions || []), versionEntry].slice(-5);

    Object.assign(template, data);
    await template.save();

    res.json(template);
  } catch (error) {
    console.error('Error updating email template:', error);
    res.status(500).json({ error: 'Failed to update email template' });
  }
});

// Delete email template
router.delete('/email-templates/:id', authenticate, async (req, res) => {
  try {
    const template = await EmailTemplate.findOneAndDelete({
      _id: req.params.id,
      schoolId: req.user?.schoolId,
    });

    if (!template) {
      return res.status(404).json({ error: 'Email template not found' });
    }

    res.json({ success: true, message: 'Email template deleted' });
  } catch (error) {
    console.error('Error deleting email template:', error);
    res.status(500).json({ error: 'Failed to delete email template' });
  }
});

// Preview email template with sample data
router.post('/email-templates/:id/preview', authenticate, async (req, res) => {
  try {
    const template = await EmailTemplate.findOne({
      _id: req.params.id,
      schoolId: req.user?.schoolId,
    }).lean();

    if (!template) {
      return res.status(404).json({ error: 'Email template not found' });
    }

    const sampleData = { ...PREVIEW_SAMPLE_DATA, ...req.body.sampleData };
    let subject = template.subject;
    let htmlBody = template.htmlBody;

    Object.entries(sampleData).forEach(([key, val]) => {
      const regex = new RegExp(`\\{${key}\\}`, 'g');
      subject = subject.replace(regex, val);
      htmlBody = htmlBody.replace(regex, val);
    });

    res.json({ subject, htmlBody, sampleData });
  } catch (error) {
    console.error('Error previewing email template:', error);
    res.status(500).json({ error: 'Failed to preview email template' });
  }
});

// Rollback email template to a previous version
router.post('/email-templates/:id/rollback/:versionIndex', authenticate, async (req, res) => {
  try {
    const template = await EmailTemplate.findOne({
      _id: req.params.id,
      schoolId: req.user?.schoolId,
    });

    if (!template) {
      return res.status(404).json({ error: 'Email template not found' });
    }

    const idx = parseInt(req.params.versionIndex, 10);
    if (isNaN(idx) || !template.versions?.[idx]) {
      return res.status(404).json({ error: 'Version not found' });
    }

    const version = template.versions[idx];

    // Save current state before rollback
    const currentVersion = {
      subject: template.subject,
      htmlBody: template.htmlBody,
      textBody: template.textBody,
      savedAt: new Date(),
      savedBy: req.user?._id,
    };
    template.versions = [...(template.versions || []), currentVersion].slice(-5);

    template.subject = version.subject;
    template.htmlBody = version.htmlBody;
    template.textBody = version.textBody;
    await template.save();

    res.json(template);
  } catch (error) {
    console.error('Error rolling back email template:', error);
    res.status(500).json({ error: 'Failed to rollback email template' });
  }
});

export default router;
