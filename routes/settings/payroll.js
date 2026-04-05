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
  })
  .strict();

// GET /settings/payroll — fetch payroll settings from SchoolSettings
router.get('/payroll', authenticate, async (req, res) => {
  try {
    await ensureSchoolSettings(req.user?.schoolId);

    const settings = await SchoolSettings.findOne(
      buildSchoolScopedQuery(req.user?.schoolId)
    ).lean();

    res.json({
      data: {
        disburseDate: settings?.payroll?.disburseDate || 1,
        payrollCycle: settings?.payroll?.payrollCycle || 'monthly',
      },
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

      const { disburseDate, payrollCycle } = req.body;

      const update = {};
      if (disburseDate !== undefined) {
        update['payroll.disburseDate'] = disburseDate;
      }
      if (payrollCycle !== undefined) {
        update['payroll.payrollCycle'] = payrollCycle;
      }

      const settings = await SchoolSettings.findOneAndUpdate(
        buildSchoolScopedQuery(req.user?.schoolId),
        { $set: update },
        { new: true }
      );

      res.json({
        data: {
          disburseDate: settings?.payroll?.disburseDate || 1,
          payrollCycle: settings?.payroll?.payrollCycle || 'monthly',
        },
        message: 'Payroll settings updated successfully',
      });
    } catch (error) {
      console.error('Error updating payroll settings:', error);
      res.status(500).json({ error: 'Failed to update payroll settings' });
    }
  }
);

export default router;
