/**
 * API Key Authentication Middleware
 *
 * Allows third-party integrations to authenticate via the X-API-Key header.
 * The raw key is never stored — only its SHA-256 hash.
 * Supports key rotation with a 24-hour grace period on the old key.
 */
import ApiKey, { hashApiKey } from '../../models/ApiKey.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('ApiKeyAuth');

// In-memory rate limit tracker: keyId → { count, windowStart }
// For multi-instance deployments, replace with Redis-backed counters.
const rateLimitWindows = new Map();

function checkRateLimit(keyId, limitPerHour) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour

  const entry = rateLimitWindows.get(keyId);
  if (!entry || now - entry.windowStart > windowMs) {
    rateLimitWindows.set(keyId, { count: 1, windowStart: now });
    return { allowed: true, remaining: limitPerHour - 1 };
  }

  if (entry.count >= limitPerHour) {
    return { allowed: false, remaining: 0, resetAt: new Date(entry.windowStart + windowMs) };
  }

  entry.count += 1;
  return { allowed: true, remaining: limitPerHour - entry.count };
}

/**
 * Look up an API key document by raw key value.
 * Checks both current key and previous key (within grace period).
 */
async function resolveApiKey(rawKey) {
  const hash = hashApiKey(rawKey);

  // Try current key first
  let doc = await ApiKey.findOne({ keyHash: hash });
  if (doc) return { doc, isGracePeriodKey: false };

  // Try previous key (rotation grace period)
  doc = await ApiKey.findOne({
    previousKeyHash: hash,
    previousKeyExpiresAt: { $gt: new Date() },
  });
  if (doc) return { doc, isGracePeriodKey: true };

  return null;
}

/**
 * Express middleware: authenticate requests using X-API-Key header.
 *
 * On success sets:
 *   req.user = { schoolId, userType: 'api-key', userId: null }
 *   req.apiKey = { id, name, scopes, isGracePeriodKey }
 */
export async function authenticateApiKey(req, res, next) {
  const rawKey = req.headers['x-api-key'];
  if (!rawKey) {
    return res.status(401).json({
      error: req.t('auth:errors.authRequired'),
      message: req.t('auth:errors.apiKeyRequired'),
    });
  }

  try {
    const result = await resolveApiKey(rawKey);

    if (!result) {
      return res.status(401).json({ error: req.t('auth:errors.apiKeyInvalid') });
    }

    const { doc, isGracePeriodKey } = result;

    // Must be active and not revoked
    if (!doc.isActive || doc.revokedAt) {
      return res.status(401).json({ error: req.t('auth:errors.apiKeyRevoked') });
    }

    // Hard expiry check
    if (doc.expiresAt && doc.expiresAt < new Date()) {
      return res.status(401).json({ error: req.t('auth:errors.apiKeyExpired') });
    }

    // Rate limit
    const { allowed, remaining, resetAt } = checkRateLimit(
      doc._id.toString(),
      doc.rateLimitPerHour
    );
    if (!allowed) {
      res.set('X-RateLimit-Limit', doc.rateLimitPerHour);
      res.set('X-RateLimit-Remaining', 0);
      res.set('X-RateLimit-Reset', resetAt.toISOString());
      return res.status(429).json({
        error: req.t('common:errors.tooManyRequests'),
        message: `Limit: ${doc.rateLimitPerHour} requests/hour. Resets at ${resetAt.toISOString()}`,
      });
    }

    // Set rate limit headers
    res.set('X-RateLimit-Limit', doc.rateLimitPerHour);
    res.set('X-RateLimit-Remaining', remaining);

    // Attach auth context
    req.user = {
      schoolId: doc.schoolId,
      userType: 'api-key',
      userId: null,
      role: null,
    };
    req.apiKey = {
      id: doc._id,
      name: doc.name,
      scopes: doc.scopes,
      isGracePeriodKey,
    };

    // Fire-and-forget usage update
    ApiKey.findByIdAndUpdate(doc._id, {
      $inc: { usageCount: 1 },
      $set: {
        lastUsedAt: new Date(),
        lastUsedEndpoint: `${req.method} ${req.path}`.slice(0, 200),
      },
    }).catch(() => {});

    next();
  } catch (err) {
    logger.error({ err }, 'API key authentication failed');
    res.status(500).json({ error: req.t('auth:errors.authFailed') });
  }
}

/**
 * Middleware factory: require a specific scope on the API key.
 * Call after authenticateApiKey.
 *
 * Usage: router.get('/students', authenticateApiKey, requireApiKeyScope('read:students'), handler)
 */
export function requireApiKeyScope(scope) {
  return (req, res, next) => {
    if (!req.apiKey) {
      return res.status(403).json({ error: req.t('auth:errors.apiKeyScopeMissing') });
    }
    const { scopes } = req.apiKey;
    if (!scopes.includes(scope) && !scopes.includes('read:all')) {
      return res.status(403).json({
        error: req.t('common:errors.forbidden'),
        message: req.t('auth:errors.insufficientScope', { scope }),
        requiredScope: scope,
        grantedScopes: scopes,
      });
    }
    next();
  };
}
