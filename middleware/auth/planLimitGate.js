import { assertSchoolWithinLimit } from '../../services/billingService.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('PlanLimitGate');

/**
 * Express middleware that enforces billing plan limits before a route handler runs.
 *
 * Usage (fixed delta of 1):
 *   router.post('/students', authenticate, planLimitGate('students'), handler);
 *
 * Usage (dynamic delta derived from the request, e.g. file size in MB):
 *   router.post('/upload', authenticate, upload.single('file'), planLimitGate('storageMb', req => req.file.size / (1024 * 1024)), handler);
 *
 * On limit exceeded the response is:
 *   403 { error: '...', code: 'PLAN_LIMIT_REACHED', details: { metric, current, limit, planKey, planName } }
 *
 * @param {string} metric - The billing metric to check ('students' | 'staff' | 'storageMb' | 'smsCredits' | 'apiCallsPerMonth')
 * @param {(req: import('express').Request) => number} [getDelta] - Optional function to derive the delta from the request. Defaults to 1.
 */
export const planLimitGate = (metric, getDelta = () => 1) => {
  return async (req, res, next) => {
    try {
      const schoolId = req.user?.schoolId;

      if (!schoolId) {
        return res.status(401).json({
          error: req.t?.('common:errors.unauthorized') ?? 'Unauthorized',
          message: req.t?.('auth:errors.authRequired') ?? 'Authentication required',
        });
      }

      const delta = getDelta(req);

      await assertSchoolWithinLimit({ schoolId, metric, delta });

      next();
    } catch (error) {
      if (error.code === 'PLAN_LIMIT_REACHED') {
        return res.status(403).json({
          error: error.message,
          code: 'PLAN_LIMIT_REACHED',
          details: error.details,
        });
      }

      logger.error({ err: error, metric }, 'Plan limit gate check failed');
      res.status(500).json({
        error: req.t?.('common:errors.serverError') ?? 'Internal server error',
      });
    }
  };
};
