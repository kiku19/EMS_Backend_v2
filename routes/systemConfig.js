import express from 'express';
import { SchoolSettings, StaffIdConfig } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { ensureSchoolSettings, getDefaultSchoolSettings } from '../utils/academicYear.js';
import { buildSchoolScopedQuery } from '../utils/schoolContext.js';

const router = express.Router();

router.get('/staff-id-config', authenticate, checkPermission('settings', 'view'), async (req, res) => {
  try {
    let staffIdConfig = await StaffIdConfig.findOne();

    if (!staffIdConfig) {
      staffIdConfig = new StaffIdConfig({
        prefix: 'EMP',
        separator: '',
        includeYear: false,
        startingNumber: 1,
        digits: 3,
        currentNumber: 0
      });
      await staffIdConfig.save();
    }

    res.json(staffIdConfig);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/staff-id-config', authenticate, checkPermission('settings', 'edit'), async (req, res) => {
  try {
    const { prefix, separator, includeYear, startingNumber, digits } = req.body;

    let staffIdConfig = await StaffIdConfig.findOne();
    if (!staffIdConfig) {
      staffIdConfig = new StaffIdConfig({
        prefix,
        separator,
        includeYear,
        startingNumber,
        digits,
        currentNumber: 0
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
});

router.get('/school-settings', authenticate, checkPermission('settings', 'view'), async (req, res) => {
  try {
    const settings = await ensureSchoolSettings(req.user?.schoolId);

    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/school-settings', authenticate, checkPermission('settings', 'edit'), async (req, res) => {
  try {
    let settings = await SchoolSettings.findOne(buildSchoolScopedQuery(req.user?.schoolId));

    if (!settings) {
      settings = new SchoolSettings({
        ...getDefaultSchoolSettings(req.user?.schoolId),
        ...req.body,
      });
    } else {
      Object.assign(settings, req.body);
    }

    await settings.save();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

