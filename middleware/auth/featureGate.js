import { isFeatureEnabled } from '../../services/featureFlagsService.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('FeatureGate');

/**
 * Express middleware that blocks access to a route unless the authenticated
 * school has the given feature enabled (plan gate + dynamic flags).
 *
 * Usage:
 *   router.get('/reports/advanced', authenticate, featureGate('advancedReports'), handler);
 *
 * On denial the response is:
 *   403 { error: 'Feature Not Available', code: 'FEATURE_NOT_ENABLED', featureKey }
 */
export const featureGate = (featureKey) => {
  return async (req, res, next) => {
    try {
      const schoolId = req.user?.schoolId;

      if (!schoolId) {
        return res.status(401).json({
          error: req.t('common:errors.unauthorized'),
          message: req.t('auth:errors.authRequired'),
        });
      }

      const enabled = await isFeatureEnabled(featureKey, schoolId);

      if (!enabled) {
        return res.status(403).json({
          error: req.t('common:errors.forbidden'),
          message: req.t('auth:errors.featureNotEnabled', { featureKey }),
          featureKey,
          code: 'FEATURE_NOT_ENABLED',
        });
      }

      next();
    } catch (error) {
      logger.error({ err: error, featureKey }, 'Feature gate check failed');
      res.status(500).json({
        error: req.t('common:errors.serverError'),
        message: req.t('auth:errors.featureCheckFailed'),
      });
    }
  };
};
