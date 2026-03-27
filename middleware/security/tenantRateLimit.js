/**
 * Per-tenant Redis-backed rate limiter.
 *
 * Limits are keyed by schoolId (not IP), giving each school an independent
 * quota regardless of how many users or devices they have.  Limits are tiered
 * by subscription plan so higher-paying schools get proportionally more
 * headroom.
 *
 * Plan limits (requests / minute):
 *   starter  → 100   (free tier)
 *   growth   → 500   (paid mid-tier)
 *   scale    → 2000  (high-volume)
 *
 * Auth-endpoint limits (per IP, per minute): 20
 *   — applied on top of the tenant limiter to prevent credential-stuffing.
 *
 * Alerting: a Redis counter `rl:violations:{schoolId}` is incremented on
 * every 429 for authenticated requests.  A warning is logged when the count
 * crosses multiples of ALERT_THRESHOLD within the rolling 15-minute window.
 */

import { rateLimit } from 'express-rate-limit';
import RedisRateLimitStore from 'rate-limit-redis';
import { getRedisClient, isRedisReady } from '../../config/redis.js';
import SchoolSubscription from '../../models/SchoolSubscription.js';
import { extractTokenFromRequest, verifyToken } from '../auth/auth.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('TenantRateLimit');

/**
 * Requests per minute, per plan tier.
 *
 * A typical SPA dashboard page load fires 15-30+ API calls in the first
 * second (context data, settings, attendance snapshot, conversations, etc.).
 * The previous starter limit of 100/min was too aggressive and caused 429s
 * on normal page loads. 300/min gives ~5 req/s which handles burst loads
 * from navigation while still protecting against abuse.
 */
export const PLAN_RATE_LIMITS = {
  starter: 300,
  growth: 600,
  scale: 2000,
};

/** Requests per minute for auth endpoints (keyed by IP) */
const AUTH_LIMIT_PER_MIN = 20;

/** How many violations within the alert window trigger a log warning */
const ALERT_THRESHOLD = 5;

/** How long (seconds) to keep the violation counter alive */
const ALERT_WINDOW_SECS = 15 * 60;

/** How long (seconds) to cache a school's plan key in Redis */
const PLAN_CACHE_TTL_SECS = 5 * 60;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Return the plan key for the given schoolId.
 * Result is cached in Redis for PLAN_CACHE_TTL_SECS to avoid a DB hit on
 * every request.
 */
async function getSchoolPlanKey(schoolId) {
  const redis = getRedisClient();
  const cacheKey = `rl:plan_cache:${schoolId}`;

  if (isRedisReady() && redis) {
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) return cached;
  }

  const sub = await SchoolSubscription.findOne({ schoolId })
    .select('planKey')
    .lean()
    .catch(() => null);

  const planKey = sub?.planKey || 'starter';

  if (isRedisReady() && redis) {
    redis.setex(cacheKey, PLAN_CACHE_TTL_SECS, planKey).catch(() => {});
  }

  return planKey;
}

/**
 * Resolve the schoolId from the request without requiring auth middleware
 * to have already run.  Falls back to null if the token is absent/invalid.
 */
function extractSchoolIdFromRequest(req) {
  // Prefer already-authenticated user (set by authenticate middleware)
  if (req.user?.schoolId) return String(req.user.schoolId);

  try {
    const token = extractTokenFromRequest(req);
    if (!token) return null;
    const decoded = verifyToken(token);
    return decoded?.schoolId ? String(decoded.schoolId) : null;
  } catch {
    return null;
  }
}

/**
 * Increment the rate-limit violation counter for a school.
 * Logs a warning when the count crosses multiples of ALERT_THRESHOLD.
 */
async function trackViolation(schoolId) {
  const redis = getRedisClient();
  if (!isRedisReady() || !redis) return;

  const key = `rl:violations:${schoolId}`;

  try {
    const count = await redis.incr(key);

    // Only set expiry on the first increment to keep a rolling window
    if (count === 1) {
      await redis.expire(key, ALERT_WINDOW_SECS);
    }

    if (count % ALERT_THRESHOLD === 0) {
      logger.warn(
        { schoolId, violations: count, windowSecs: ALERT_WINDOW_SECS },
        'School is repeatedly hitting the rate limit — possible abuse or request loop'
      );
    }
  } catch (err) {
    logger.debug({ err: err.message }, 'trackViolation Redis error (non-fatal)');
  }
}

// ─── Shared store factory ─────────────────────────────────────────────────────

/**
 * Build a rate-limit-redis store using the shared Redis client.
 * Returns undefined (memory store) when Redis is not available.
 */
function buildRedisStore() {
  if (!isRedisReady()) return undefined;
  const redis = getRedisClient();
  if (!redis) return undefined;

  return new RedisRateLimitStore({
    sendCommand: (...args) => redis.call(...args),
  });
}

// ─── Middleware factories ─────────────────────────────────────────────────────

/**
 * Per-tenant rate limiter.
 *
 * Must be applied to any router that may receive authenticated requests
 * (i.e. the v1 router).  For unauthenticated requests the tenant limiter
 * falls back to the IP as key with the starter (lowest) limit.
 */
export function createTenantRateLimiter() {
  return rateLimit({
    windowMs: 60 * 1000, // 1 minute window

    /**
     * Dynamic limit: look up the school's plan and return the corresponding
     * max requests per minute.
     */
    limit: async (req) => {
      const schoolId = extractSchoolIdFromRequest(req);
      if (!schoolId) return PLAN_RATE_LIMITS.starter;

      const planKey = await getSchoolPlanKey(schoolId).catch(() => 'starter');
      return PLAN_RATE_LIMITS[planKey] ?? PLAN_RATE_LIMITS.starter;
    },

    /**
     * Key by schoolId for authenticated requests so all users of the same
     * school share one quota bucket.  Fall back to IP for unauthenticated
     * requests (e.g. public endpoints).
     */
    keyGenerator: (req) => {
      const schoolId = extractSchoolIdFromRequest(req);
      return schoolId ? `tenant:${schoolId}` : `ip:${req.ip}`;
    },

    standardHeaders: 'draft-7', // emit X-RateLimit-* headers
    legacyHeaders: false,

    store: buildRedisStore(),

    skip: (req) =>
      req.path === '/health' || req.path === '/api/health' || req.path.startsWith('/static'),

    handler: async (req, res, _next, options) => {
      const schoolId = extractSchoolIdFromRequest(req);
      if (schoolId) {
        trackViolation(schoolId).catch(() => {});
      }

      res
        .status(429)
        .set('Retry-After', String(Math.ceil(options.windowMs / 1000)))
        .json({
          error: req.t('common:errors.tooManyRequests'),
          message: req.t('common:errors.rateLimitExceeded'),
          retryAfter: Math.ceil(options.windowMs / 1000),
        });
    },
  });
}

/**
 * Endpoint-specific SMS rate limiter.
 *
 * Applied to routes that trigger outbound SMS sends (e.g. announcements/send,
 * announcements/resend).  Keyed by schoolId so the 100/day quota is shared
 * across all staff of the same school, not per-user.
 *
 * Limit: 100 requests per 24-hour rolling window, per school.
 */
export function createSmsRateLimiter() {
  return rateLimit({
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    limit: 100,

    keyGenerator: (req) => {
      const schoolId = extractSchoolIdFromRequest(req);
      return schoolId ? `sms:${schoolId}` : `sms_ip:${req.ip}`;
    },

    standardHeaders: 'draft-7',
    legacyHeaders: false,

    store: buildRedisStore(),

    handler: async (req, res, _next, options) => {
      const schoolId = extractSchoolIdFromRequest(req);
      if (schoolId) {
        trackViolation(schoolId).catch(() => {});
      }

      res
        .status(429)
        .set('Retry-After', String(Math.ceil(options.windowMs / 1000)))
        .json({
          error: req.t('common:errors.tooManyRequests'),
          message: req.t('common:errors.smsLimitExceeded'),
          retryAfter: Math.ceil(options.windowMs / 1000),
        });
    },
  });
}

/**
 * Stricter rate limiter for auth endpoints (login, signup, password reset).
 * Keyed by IP to defend against credential-stuffing before a session exists.
 */
export function createAuthRateLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: AUTH_LIMIT_PER_MIN,
    keyGenerator: (req) => `auth:${req.ip}`,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: buildRedisStore(),
    handler: (req, res, _next, options) => {
      res
        .status(429)
        .set('Retry-After', String(Math.ceil(options.windowMs / 1000)))
        .json({
          error: req.t('common:errors.tooManyRequests'),
          message: req.t('common:errors.tooManyAuthAttempts'),
          retryAfter: Math.ceil(options.windowMs / 1000),
        });
    },
  });
}

// ─── Admin visibility ─────────────────────────────────────────────────────────

/**
 * Return rate-limit violation counts for a list of schoolIds.
 * Used by the super-admin dashboard to surface misbehaving tenants.
 *
 * @param {string[]} schoolIds
 * @returns {Promise<Record<string, number>>}  schoolId → violation count
 */
export async function getRateLimitViolationStats(schoolIds) {
  const redis = getRedisClient();
  if (!isRedisReady() || !redis || schoolIds.length === 0) {
    return Object.fromEntries(schoolIds.map((id) => [id, 0]));
  }

  const keys = schoolIds.map((id) => `rl:violations:${id}`);
  const values = await redis.mget(...keys).catch(() => keys.map(() => null));

  return Object.fromEntries(
    schoolIds.map((id, i) => [id, values[i] ? parseInt(values[i], 10) : 0])
  );
}
