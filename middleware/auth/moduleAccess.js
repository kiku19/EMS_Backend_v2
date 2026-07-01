/**
 * moduleAccess — central gateway that blocks API access to modules a school has
 * switched OFF in Settings → Modules.
 *
 * Mounted once on the authenticated v1Router (after `authenticate`, before the
 * module route groups). It maps the first path segment of the request to a
 * module key via PATH_SEGMENT_TO_MODULE; if that module is disabled for the
 * caller's school it returns 403 MODULE_DISABLED. Segments not in the map
 * (core modules + system endpoints) always pass through, so this can never lock
 * a tenant out of the spine of the product.
 *
 * Super-admins bypass entirely. Schools that predate the feature (no
 * enabledModules field) are treated as fully-enabled until an admin saves an
 * explicit list.
 */
import { PATH_SEGMENT_TO_MODULE } from '../../config/moduleRegistry.js';
import { getEnabledModules } from '../../services/moduleAccessService.js';
import { isSuperAdminUser } from '../../utils/superAdmin.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('ModuleAccess');

const firstSegment = (path) => {
  // req.path here is relative to the router mount (e.g. "/fees/123" → "fees").
  const clean = path.split('?')[0];
  const parts = clean.split('/').filter(Boolean);
  return parts[0] || '';
};

export const moduleAccessGuard = async (req, res, next) => {
  try {
    if (isSuperAdminUser(req.user)) return next();

    const segment = firstSegment(req.path);
    const moduleKey = PATH_SEGMENT_TO_MODULE[segment];

    // Not a gated module (core or system endpoint) → always allow.
    if (!moduleKey) return next();

    const { managed, enabled } = await getEnabledModules(req.user?.schoolId);

    // Unmanaged school (pre-feature) or no tenant context → fail open.
    if (!managed || !enabled) return next();

    if (enabled.has(moduleKey)) return next();

    return res.status(403).json({
      error: req.t ? req.t('common:errors.forbidden') : 'Forbidden',
      code: 'MODULE_DISABLED',
      module: moduleKey,
      message: `The "${moduleKey}" module is not enabled for this school. An administrator can enable it in Settings → Modules.`,
    });
  } catch (error) {
    // Fail open on infra errors — a transient DB hiccup shouldn't take down the
    // whole API. The error is logged for visibility.
    logger.error({ err: error, path: req.path }, 'moduleAccess check failed; allowing request');
    return next();
  }
};

export default moduleAccessGuard;
