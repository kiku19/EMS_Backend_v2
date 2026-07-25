import express from 'express';
import { z } from 'zod';
import { SchoolSettings } from '../../database.js';
import { authenticate } from '../../middleware/auth.js';
import { checkPermission } from '../../middleware/auth/permissions.js';
import { ensureSchoolSettings } from '../../utils/academicYear.js';
import { buildSchoolScopedQuery } from '../../utils/schoolContext.js';
import { validateZod } from '../../validators/zodHelpers.js';

const router = express.Router();
router.use(authenticate);

// ─── Defaults / Normalizers ──────────────────────────────────────
const PAYMENT_METHODS = ['bank_transfer', 'cheque', 'cash', 'upi'];

const normalizePayroll = (raw = {}) => ({
  disburseDate: typeof raw.disburseDate === 'number' ? raw.disburseDate : 1,
  payrollCycle: raw.payrollCycle || 'monthly',
  paymentMethod: PAYMENT_METHODS.includes(raw.paymentMethod) ? raw.paymentMethod : 'bank_transfer',
  autoReminder: typeof raw.autoReminder === 'boolean' ? raw.autoReminder : true,
  reminderDays:
    typeof raw.reminderDays === 'number' && raw.reminderDays >= 1 && raw.reminderDays <= 30
      ? raw.reminderDays
      : 3,
});

// ─── Zod Validation ──────────────────────────────────────────────
const updatePayrollSettingsSchema = z
  .object({
    disburseDate: z
      .number()
      .int()
      .min(1, 'Must be between 1 and 31')
      .max(31, 'Must be between 1 and 31')
      .optional(),
    payrollCycle: z
      .enum(['weekly', 'biweekly', 'monthly'], { message: 'Must be weekly, biweekly, or monthly' })
      .optional(),
    paymentMethod: z
      .enum(PAYMENT_METHODS, {
        message: 'Must be one of bank_transfer, cheque, cash, upi',
      })
      .optional(),
    autoReminder: z.boolean().optional(),
    reminderDays: z
      .number()
      .int()
      .min(1, 'Must be between 1 and 30')
      .max(30, 'Must be between 1 and 30')
      .optional(),
  })
  .strict();

// Shape the payroll block for responses (defaults applied for missing fields).
// `normalizePayroll` above is the single source of truth for defaults.

// GET /settings/payroll — fetch payroll settings from SchoolSettings
router.get('/payroll', authenticate, async (req, res) => {
  try {
    await ensureSchoolSettings(req.user?.schoolId);

    const settings = await SchoolSettings.findOne(
      buildSchoolScopedQuery(req.user?.schoolId)
    ).lean();

    res.json({
      data: normalizePayroll(settings?.payroll),
    });
  } catch (error) {
    console.error('Error fetching payroll settings:', error);
    res.status(500).json({ error: 'Failed to fetch payroll settings' });
  }
});

// PUT /settings/payroll — update payroll settings in SchoolSettings
router.put(
  '/payroll',
  authenticate,
  checkPermission('settings', 'edit'),
  validateZod(updatePayrollSettingsSchema),
  async (req, res) => {
    try {
      await ensureSchoolSettings(req.user?.schoolId);

      const { disburseDate, payrollCycle, paymentMethod, autoReminder, reminderDays } = req.body;

      const update = {};
      if (disburseDate !== undefined) {
        update['payroll.disburseDate'] = disburseDate;
      }
      if (payrollCycle !== undefined) {
        update['payroll.payrollCycle'] = payrollCycle;
      }
      if (paymentMethod !== undefined) {
        update['payroll.paymentMethod'] = paymentMethod;
      }
      if (autoReminder !== undefined) {
        update['payroll.autoReminder'] = autoReminder;
      }
      if (reminderDays !== undefined) {
        update['payroll.reminderDays'] = reminderDays;
      }

      const settings = await SchoolSettings.findOneAndUpdate(
        buildSchoolScopedQuery(req.user?.schoolId),
        { $set: update },
        { new: true }
      );

      res.json({
        data: normalizePayroll(settings?.payroll),
        message: 'Payroll settings updated successfully',
      });
    } catch (error) {
      console.error('Error updating payroll settings:', error);
      res.status(500).json({ error: 'Failed to update payroll settings' });
    }
  }
);

// ─── Salary Components ───────────────────────────────────────────

const componentItemSchema = z.object({
  id: z.string().trim().min(1, 'Component id is required'),
  name: z.string().trim().min(1, 'Component name is required').max(100),
});

const salaryComponentsSchema = z
  .object({
    earnings: z.array(componentItemSchema).optional(),
    deductions: z.array(componentItemSchema).optional(),
  })
  .strict();

// GET /settings/salary-components
router.get('/salary-components', authenticate, async (req, res) => {
  try {
    if (!req.user?.schoolId) {
      return res.status(400).json({ error: 'schoolId is required' });
    }
    await ensureSchoolSettings(req.user.schoolId);
    const settings = await SchoolSettings.findOne(buildSchoolScopedQuery(req.user.schoolId)).lean();

    const defaultComponents = {
      earnings: [
        { id: 'basic', name: 'Basic Salary' },
        { id: 'hra', name: 'HRA' },
        { id: 'transport', name: 'Transport Allowance' },
        { id: 'special', name: 'Special Allowance' },
      ],
      deductions: [
        { id: 'pf', name: 'Provident Fund' },
        { id: 'pt', name: 'Professional Tax' },
        { id: 'tds', name: 'TDS' },
      ],
    };

    const components = settings?.salaryComponents || defaultComponents;
    res.json({ data: components });
  } catch (error) {
    console.error('Error fetching salary components:', error);
    res.status(500).json({ error: 'Failed to fetch salary components' });
  }
});

// PUT /settings/salary-components
router.put(
  '/salary-components',
  authenticate,
  checkPermission('settings', 'edit'),
  validateZod(salaryComponentsSchema),
  async (req, res) => {
    try {
      await ensureSchoolSettings(req.user?.schoolId);

      const { earnings, deductions } = req.body;
      const update = {};
      if (earnings !== undefined) {
        update['salaryComponents.earnings'] = earnings;
      }
      if (deductions !== undefined) {
        update['salaryComponents.deductions'] = deductions;
      }

      const settings = await SchoolSettings.findOneAndUpdate(
        buildSchoolScopedQuery(req.user?.schoolId),
        { $set: update },
        { new: true }
      );

      res.json({
        data: settings?.salaryComponents || { earnings: [], deductions: [] },
        message: 'Salary components updated successfully',
      });
    } catch (error) {
      console.error('Error updating salary components:', error);
      res.status(500).json({ error: 'Failed to update salary components' });
    }
  }
);

export default router;
