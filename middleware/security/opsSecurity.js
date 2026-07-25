import { timingSafeEqual } from 'crypto';
import { rateLimit } from 'express-rate-limit';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('OpsSecurity');
const MIN_OPS_SECRET_LENGTH = 64;

function secretsMatch(provided, configured) {
  const providedBuffer = Buffer.from(provided);
  const configuredBuffer = Buffer.from(configured);
  return (
    providedBuffer.length === configuredBuffer.length &&
    timingSafeEqual(providedBuffer, configuredBuffer)
  );
}

export function requireOpsSecret(req, res, next) {
  const configuredSecret = process.env.OPS_SECRET?.trim() ?? '';
  if (configuredSecret.length < MIN_OPS_SECRET_LENGTH) {
    logger.error('OPS_SECRET is missing or too short; internal operations endpoints are disabled');
    return res.status(503).json({
      error: 'Operations endpoints are not configured',
    });
  }

  const providedSecret = String(req.get('x-ops-secret') ?? '');
  if (!secretsMatch(providedSecret, configuredSecret)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.setHeader('Cache-Control', 'no-store');
  next();
}

export function createOpsRateLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    keyGenerator: (req) => `ops:${req.ip}`,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    handler: (_req, res) => {
      res.status(429).json({
        error: 'Too many operations requests',
        retryAfter: 60,
      });
    },
  });
}
