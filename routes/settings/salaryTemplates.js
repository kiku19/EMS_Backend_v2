import express from 'express';
import { z } from 'zod';
import { SalaryTemplate } from '../../database.js';
import { authenticate } from '../../middleware/auth.js';
import { checkPermission } from '../../middleware/auth/permissions.js';
import { buildSchoolScopedQuery } from '../../utils/schoolContext.js';
import { validateZod } from '../../validators/zodHelpers.js';
import { objectId } from '../../validators/zodHelpers.js';

const router = express.Router();
router.use(authenticate);

// ─── Zod Validation ──────────────────────────────────────────────
const breakdownItemSchema = z.object({
  component: z.string().trim().min(1, 'Component name is required').max(100),
  amount: z.number().min(0, 'Amount must be non-negative'),
});

const salaryTemplateSchema = z
  .object({
    name: z.string().trim().min(1, 'Template name is required').max(100),
    breakdown: z.array(breakdownItemSchema).min(1, 'At least one salary component is required'),
  })
  .strict()
  .refine((data) => data.breakdown.reduce((sum, item) => sum + item.amount, 0) > 0, {
    message: 'Total salary must be greater than 0',
    path: ['breakdown'],
  });
const salaryTemplateParamsSchema = z.object({ id: objectId }).strip();

// GET /settings/salary-templates
router.get('/salary-templates', checkPermission('payroll', 'view'), async (req, res) => {
  try {
    const templates = await SalaryTemplate.find({
      ...buildSchoolScopedQuery(req.user?.schoolId),
      isDeleted: { $ne: true },
    })
      .sort({ createdAt: 1 })
      .lean();

    res.json({ data: templates });
  } catch (error) {
    console.error('Error fetching salary templates:', error);
    res.status(500).json({ error: 'Failed to fetch salary templates' });
  }
});

// POST /settings/salary-templates
router.post(
  '/salary-templates',
  checkPermission('payroll', 'create'),
  validateZod(salaryTemplateSchema),
  async (req, res) => {
    try {
      const { name, breakdown } = req.body;
      const schoolId = req.user?.schoolId;

      const existing = await SalaryTemplate.findOne({
        ...buildSchoolScopedQuery(schoolId),
        name,
        isDeleted: { $ne: true },
      });
      if (existing) {
        return res.status(409).json({ error: 'A template with this name already exists' });
      }

      const template = await SalaryTemplate.create({ schoolId, name, breakdown });
      res.status(201).json({ data: template });
    } catch (error) {
      console.error('Error creating salary template:', error);
      res.status(500).json({ error: 'Failed to create salary template' });
    }
  }
);

// PUT /settings/salary-templates/:id
router.put(
  '/salary-templates/:id',
  checkPermission('payroll', 'edit'),
  validateZod(salaryTemplateParamsSchema, 'params'),
  validateZod(salaryTemplateSchema),
  async (req, res) => {
    try {
      const { name, breakdown } = req.body;
      const schoolId = req.user?.schoolId;

      const duplicate = await SalaryTemplate.findOne({
        ...buildSchoolScopedQuery(schoolId),
        name,
        _id: { $ne: req.params.id },
        isDeleted: { $ne: true },
      });
      if (duplicate) {
        return res.status(409).json({ error: 'A template with this name already exists' });
      }

      const template = await SalaryTemplate.findOneAndUpdate(
        { _id: req.params.id, ...buildSchoolScopedQuery(schoolId), isDeleted: { $ne: true } },
        { $set: { name, breakdown } },
        { new: true }
      );

      if (!template) {
        return res.status(404).json({ error: 'Salary template not found' });
      }

      res.json({ data: template });
    } catch (error) {
      console.error('Error updating salary template:', error);
      res.status(500).json({ error: 'Failed to update salary template' });
    }
  }
);

// DELETE /settings/salary-templates/:id
router.delete(
  '/salary-templates/:id',
  checkPermission('payroll', 'delete'),
  validateZod(salaryTemplateParamsSchema, 'params'),
  async (req, res) => {
    try {
      const template = await SalaryTemplate.findOneAndUpdate(
        {
          _id: req.params.id,
          ...buildSchoolScopedQuery(req.user?.schoolId),
          isDeleted: { $ne: true },
        },
        { $set: { isDeleted: true } },
        { new: true }
      );

      if (!template) {
        return res.status(404).json({ error: 'Salary template not found' });
      }

      res.json({ message: 'Salary template deleted successfully' });
    } catch (error) {
      console.error('Error deleting salary template:', error);
      res.status(500).json({ error: 'Failed to delete salary template' });
    }
  }
);

export default router;
