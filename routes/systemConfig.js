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
router.use(authenticate);

router.get('/staff-id-config', checkPermission('settings', 'view'), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    if (!schoolId) {
      return res.status(403).json({ error: req.t('common:errors.unauthorized') });
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
});

router.put(
  '/staff-id-config',
  checkPermission('settings', 'edit'),
  validateZod(updateStaffIdConfigSchema),
  async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      if (!schoolId) {
        return res.status(403).json({ error: req.t('common:errors.unauthorized') });
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

router.get('/school-settings', checkPermission('settings', 'view'), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    if (!schoolId) {
      return res.status(403).json({ error: req.t('common:errors.unauthorized') });
    }

    const settings = await ensureSchoolSettings(schoolId);

    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put(
  '/school-settings',
  checkPermission('settings', 'edit'),
  validateZod(updateSchoolSettingsSchema),
  async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      if (!schoolId) {
        return res.status(403).json({ error: req.t('common:errors.unauthorized') });
      }

      // Explicitly exclude schoolId from body to prevent tenant-scoping bypass
      const { schoolId: _ignored, confirm: _confirmFlag, ...updateData } = req.body;

      // Guard academic-year / session changes. Previously this endpoint silently
      // accepted an academicYear change with no preview or confirmation,
      // pivoting fee structures and attendance onto a new baseline by accident.
      // Prefer the dedicated PUT /academic-year route; here we at least require
      // an explicit confirm:true so a stray field can't trigger the pivot.
      const wantsYearChange =
        updateData.academicYear !== undefined || updateData.currentSession !== undefined;
      if (wantsYearChange && req.body.confirm !== true) {
        return res.status(400).json({
          error:
            'Academic-year / session change requires confirm:true — use PUT /settings/academic-year to review the transition preview first.',
        });
      }

      let settings = await SchoolSettings.findOne(buildSchoolScopedQuery(schoolId));

      // Flatten nested objects to dot-notation so $set MERGES into nested
      // subdocuments instead of REPLACING them. Object.assign(settings,
      // updateData) (the old behaviour) blew away whole subdocs: sending
      // { feeCollection: { collectionMode: 'term' } } erased numberOfTerms,
      // terms, customDurations, etc. Dot-notation preserves untouched keys.
      const setDoc = {};
      const flatten = (obj, prefix) => {
        for (const [key, value] of Object.entries(obj)) {
          if (
            value !== null &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            !(value instanceof Date)
          ) {
            flatten(value, `${prefix}.${key}`);
          } else {
            setDoc[`${prefix}.${key}`] = value;
          }
        }
      };
      // For a brand-new doc we can spread top-level fields; for updates we use
      // dot-notation $set on the existing document.
      if (!settings) {
        settings = new SchoolSettings({
          ...getDefaultSchoolSettings(schoolId),
          ...updateData,
        });
      } else {
        flatten(updateData, '');
        // Apply via $set on the existing document so nested subdocs merge.
        // Re-fetch to get the post-update doc with defaults applied.
        settings = await SchoolSettings.findOneAndUpdate(
          buildSchoolScopedQuery(schoolId),
          { $set: setDoc },
          { new: true, upsert: false, runValidators: true }
        );
        if (!settings) {
          return res.status(404).json({ error: 'School settings not found' });
        }
        // Skip the manual save below — findOneAndUpdate already persisted.
        res.json(settings);
        return;
      }

      await settings.save();
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

export default router;
