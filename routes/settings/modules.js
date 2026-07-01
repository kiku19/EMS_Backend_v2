/**
 * Settings → Modules
 *
 * GET  /settings/modules  — current module enablement + the full registry the
 *                           dashboard renders as toggles.
 * PUT  /settings/modules  — admin saves which toggleable modules are ON.
 *
 * CORE modules are always enabled and are returned with `core: true` so the UI
 * can lock their switches. The stored value (School.enabledModules) holds ONLY
 * the toggleable keys that are ON.
 */
import express from 'express';
import { z } from 'zod';
import School from '../../models/School.js';
import { authenticate } from '../../middleware/auth.js';
import { checkPermission } from '../../middleware/auth/permissions.js';
import { csrfProtect } from '../../middleware/security/csrfProtect.js';
import {
  CORE_MODULES,
  TOGGLEABLE_MODULES,
  TOGGLEABLE_MODULE_KEYS,
  resolveEnabledModules,
  normalizeToggleableSelection,
} from '../../config/moduleRegistry.js';
import { invalidateModuleCache } from '../../services/moduleAccessService.js';

const router = express.Router();

router.use(authenticate);

const updateModulesSchema = z
  .object({
    enabledModules: z
      .array(z.enum(TOGGLEABLE_MODULE_KEYS))
      .max(TOGGLEABLE_MODULE_KEYS.length, 'Too many modules'),
  })
  .strict();

/** Build the response payload shared by GET and PUT. */
function buildPayload(enabledModulesField) {
  const { managed, enabled } = resolveEnabledModules(enabledModulesField);
  return {
    managed,
    coreModules: CORE_MODULES,
    // Effective enabled keys (core + toggled-on), for gating on the client.
    enabledModules: [...enabled],
    // The full catalogue the Settings page renders as switches.
    modules: [
      ...CORE_MODULES.map((key) => ({ key, core: true, enabled: true })),
      ...TOGGLEABLE_MODULES.map((m) => ({
        ...m,
        core: false,
        enabled: enabled.has(m.key),
      })),
    ],
  };
}

// GET current module enablement
router.get('/modules', async (req, res) => {
  try {
    const school = await School.findById(req.user?.schoolId).select('enabledModules').lean();
    res.json(buildPayload(school?.enabledModules));
  } catch (error) {
    console.error('Error fetching module settings:', error);
    res.status(500).json({ error: 'Failed to fetch module settings' });
  }
});

// UPDATE module enablement (settings-edit / admin only)
router.put('/modules', csrfProtect, checkPermission('settings', 'edit'), async (req, res) => {
  try {
    const parsed = updateModulesSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const toStore = normalizeToggleableSelection(parsed.data.enabledModules);

    const school = await School.findByIdAndUpdate(
      req.user?.schoolId,
      { $set: { enabledModules: toStore } },
      { new: true, select: 'enabledModules' }
    ).lean();

    if (!school) {
      return res.status(404).json({ error: 'School not found' });
    }

    invalidateModuleCache(req.user?.schoolId);
    res.json(buildPayload(school.enabledModules));
  } catch (error) {
    console.error('Error updating module settings:', error);
    res.status(500).json({ error: 'Failed to update module settings' });
  }
});

export default router;
