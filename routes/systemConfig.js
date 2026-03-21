import express from 'express';
import { SchoolSettings, StaffIdConfig } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { ensureSchoolSettings, getDefaultSchoolSettings } from '../utils/academicYear.js';
import { buildSchoolScopedQuery } from '../utils/schoolContext.js';
import { validateZod } from '../validators/zodHelpers.js';
import {
  updateStaffIdConfigSchema,
  updateSchoolSettingsSchema,
} from '../validators/systemConfigSchema.js';

const router = express.Router();

router.get(
  '/staff-id-config',
  authenticate,
  checkPermission('settings', 'view'),
  async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      if (!schoolId) {
        return res.status(403).json({ error: 'School context required' });
      }

      let staffIdConfig = await StaffIdConfig.findOne(buildSchoolScopedQuery(schoolId));

      if (!staffIdConfig) {
        staffIdConfig = new StaffIdConfig({
          schoolId,
          prefix: 'EMP',
          separator: '',
          includeYear: false,
          startingNumber: 1,
          digits: 3,
          currentNumber: 0,
        });
        await staffIdConfig.save();
      }

      res.json(staffIdConfig);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

router.put(
  '/staff-id-config',
  authenticate,
  checkPermission('settings', 'edit'),
  validateZod(updateStaffIdConfigSchema),
  async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      if (!schoolId) {
        return res.status(403).json({ error: 'School context required' });
      }

      const { prefix, separator, includeYear, startingNumber, digits } = req.body;

      let staffIdConfig = await StaffIdConfig.findOne(buildSchoolScopedQuery(schoolId));
      if (!staffIdConfig) {
        staffIdConfig = new StaffIdConfig({
          schoolId,
          prefix,
          separator,
          includeYear,
          startingNumber,
          digits,
          currentNumber: 0,
        });
      } else {
        staffIdConfig.prefix = prefix;
        staffIdConfig.separator = separator;
        staffIdConfig.includeYear = includeYear;
        staffIdConfig.startingNumber = startingNumber;
        staffIdConfig.digits = digits;
      }

      await staffIdConfig.save();
      res.json(staffIdConfig);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

router.get(
  '/school-settings',
  authenticate,
  checkPermission('settings', 'view'),
  async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      if (!schoolId) {
        return res.status(403).json({ error: 'School context required' });
      }

      const settings = await ensureSchoolSettings(schoolId);

      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

router.put(
  '/school-settings',
  authenticate,
  checkPermission('settings', 'edit'),
  validateZod(updateSchoolSettingsSchema),
  async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      if (!schoolId) {
        return res.status(403).json({ error: 'School context required' });
      }

      // Explicitly exclude schoolId from body to prevent tenant-scoping bypass
      const { schoolId: _ignored, ...updateData } = req.body;

      let settings = await SchoolSettings.findOne(buildSchoolScopedQuery(schoolId));

      if (!settings) {
        settings = new SchoolSettings({
          ...getDefaultSchoolSettings(schoolId),
          ...updateData,
        });
      } else {
        Object.assign(settings, updateData);
      }

      await settings.save();
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

export default router;
