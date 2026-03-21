/**
 * Cache Service — Redis-backed with in-memory fallback
 *
 * All read/write operations are async to support Redis.
 * Callers must await get() and set().
 * Invalidation methods (invalidatePattern, invalidateClassCache, etc.) return
 * Promises but callers may fire-and-forget; errors are caught internally.
 *
 * TTL values are in milliseconds (matching existing caller convention).
 * They are converted to seconds internally for Redis.
 */

import { getRedisClient, isRedisReady } from '../config/redis.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('CacheService');

// ── TTL constants (milliseconds, matching existing callers) ──────────────────
export const TTL = {
  TIMETABLE: 2 * 60 * 1000, // 2 minutes
  CONFLICT: 30 * 1000, // 30 seconds
  CLASS_LIST: 5 * 60 * 1000, // 5 minutes
  SCHOOL_SETTINGS: 10 * 60 * 1000, // 10 minutes
  FEE_HEADS: 5 * 60 * 1000, // 5 minutes
  DEFAULT: 5 * 60 * 1000, // 5 minutes
};

// ── Key prefix for Redis namespace ──────────────────────────────────────────
const KEY_PREFIX = 'ems:';

// ── In-memory fallback (same logic as the original Map-based cache) ──────────
class InMemoryCache {
  constructor() {
    this.cache = new Map();
    this.ttl = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return null;
    const expiry = this.ttl.get(key);
    if (expiry && Date.now() > expiry) {
      this.cache.delete(key);
      this.ttl.delete(key);
      return null;
    }
    return this.cache.get(key);
  }

  set(key, value, ttlMs = TTL.DEFAULT) {
    this.cache.set(key, value);
    if (ttlMs > 0) {
      this.ttl.set(key, Date.now() + ttlMs);
      setTimeout(() => this.delete(key), ttlMs);
    }
  }

  delete(key) {
    this.cache.delete(key);
    this.ttl.delete(key);
  }

  clear() {
    this.cache.clear();
    this.ttl.clear();
  }

  invalidatePattern(pattern) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    let count = 0;
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.delete(key);
        count++;
      }
    }
    return count;
  }

  size() {
    return this.cache.size;
  }

  keys() {
    return Array.from(this.cache.keys());
  }
}

const memCache = new InMemoryCache();

// ── Helpers ──────────────────────────────────────────────────────────────────

function redisKey(key) {
  return `${KEY_PREFIX}${key}`;
}

function msToSeconds(ms) {
  return Math.max(1, Math.ceil(ms / 1000));
}

// ── Redis operations with error-swallowing (fall back to memory on error) ───

async function redisGet(key) {
  try {
    const redis = getRedisClient();
    if (!redis || !isRedisReady()) return undefined; // signal: try memory
    const raw = await redis.get(redisKey(key));
    if (raw === null) return null; // cache miss
    return JSON.parse(raw);
  } catch (err) {
    logger.warn({ key, err: err.message }, 'Redis GET error — falling back to memory');
    return undefined; // undefined signals "try memory"
  }
}

async function redisSet(key, value, ttlMs) {
  try {
    const redis = getRedisClient();
    if (!redis || !isRedisReady()) return false;
    const ttlSec = msToSeconds(ttlMs);
    await redis.set(redisKey(key), JSON.stringify(value), 'EX', ttlSec);
    return true;
  } catch (err) {
    logger.warn({ key, err: err.message }, 'Redis SET error');
    return false;
  }
}

async function redisDel(key) {
  try {
    const redis = getRedisClient();
    if (!redis || !isRedisReady()) return;
    await redis.del(redisKey(key));
  } catch (err) {
    logger.warn({ key, err: err.message }, 'Redis DEL error');
  }
}

async function redisScanDel(pattern) {
  try {
    const redis = getRedisClient();
    if (!redis || !isRedisReady()) return 0;

    const fullPattern = redisKey(pattern);
    let cursor = '0';
    let deleted = 0;

    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', fullPattern, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
        deleted += keys.length;
      }
    } while (cursor !== '0');

    return deleted;
  } catch (err) {
    logger.warn({ pattern, err: err.message }, 'Redis SCAN/DEL error');
    return 0;
  }
}

// ── CacheService ─────────────────────────────────────────────────────────────

class CacheService {
  /**
   * Get a cached value.
   * Returns null on cache miss or error.
   * @param {string} key
   * @returns {Promise<*>}
   */
  async get(key) {
    if (isRedisReady()) {
      const redisResult = await redisGet(key);
      if (redisResult !== undefined) {
        // undefined means Redis error; null means genuine miss
        if (redisResult !== null) {
          logger.debug({ key }, 'Cache HIT (Redis)');
        } else {
          logger.debug({ key }, 'Cache MISS (Redis)');
        }
        return redisResult;
      }
    }

    // Fallback to in-memory
    const memResult = memCache.get(key);
    if (memResult !== null) {
      logger.debug({ key }, 'Cache HIT (memory)');
    } else {
      logger.debug({ key }, 'Cache MISS (memory)');
    }
    return memResult;
  }

  /**
   * Store a value in cache with TTL.
   * Writes to Redis (if available) and always writes to in-memory fallback.
   * @param {string} key
   * @param {*} value
   * @param {number} ttlMs - TTL in milliseconds (default 5 minutes)
   * @returns {Promise<void>}
   */
  async set(key, value, ttlMs = TTL.DEFAULT) {
    if (isRedisReady()) {
      const stored = await redisSet(key, value, ttlMs);
      if (stored) return;
    }
    // Write to memory (either Redis unavailable or Redis write failed)
    memCache.set(key, value, ttlMs);
  }

  /**
   * Delete a specific cache key.
   * @param {string} key
   * @returns {Promise<void>}
   */
  async delete(key) {
    await redisDel(key);
    memCache.delete(key);
  }

  /**
   * Clear all cache entries.
   * @returns {Promise<void>}
   */
  async clear() {
    await redisScanDel('*');
    memCache.clear();
  }

  /**
   * Invalidate cache keys matching a glob pattern.
   * @param {string} pattern - glob pattern (e.g. 'timetable:class:*')
   * @returns {Promise<number>} number of keys deleted
   */
  async invalidatePattern(pattern) {
    const [redisCount, memCount] = await Promise.all([
      redisScanDel(pattern),
      Promise.resolve(memCache.invalidatePattern(pattern)),
    ]);
    return redisCount || memCount;
  }

  /**
   * Get cache statistics.
   * @returns {Promise<Object>}
   */
  async getStats() {
    return {
      backend: isRedisReady() ? 'redis' : 'memory',
      memorySize: memCache.size(),
      memoryKeys: memCache.keys(),
    };
  }

  // ── Key generators (synchronous — no change from original) ────────────────

  getClassListKey(academicYear) {
    return `classes:${academicYear}`;
  }

  getTeacherListKey(academicYear) {
    return `teachers:${academicYear}`;
  }

  getClassTimetableKey(classId, academicYear) {
    return `timetable:class:${classId}:${academicYear}`;
  }

  getTeacherTimetableKey(teacherId, academicYear) {
    return `timetable:teacher:${teacherId}:${academicYear}`;
  }

  getAvailableTeachersKey(classId, subject, day, period) {
    return `available:${classId}:${subject}:${day}:${period}`;
  }

  getTeacherAssignmentsKey(teacherId) {
    return `assignments:${teacherId}`;
  }

  // ── Invalidation helpers ──────────────────────────────────────────────────

  invalidateTimetableCache(academicYear = '*') {
    return Promise.all([
      this.invalidatePattern(`timetable:*:${academicYear}`),
      this.invalidatePattern('available:*'),
    ]).catch((err) => logger.warn({ err: err.message }, 'invalidateTimetableCache error'));
  }

  invalidateClassCache(classId) {
    return Promise.all([
      this.invalidatePattern(`timetable:class:${classId}:*`),
      this.invalidatePattern(`available:${classId}:*`),
    ]).catch((err) => logger.warn({ err: err.message }, 'invalidateClassCache error'));
  }

  invalidateTeacherCache(teacherId) {
    return Promise.all([
      this.invalidatePattern(`timetable:teacher:${teacherId}:*`),
      this.invalidatePattern(`assignments:${teacherId}`),
      this.invalidatePattern(`conflict:${teacherId}:*`),
      this.invalidatePattern('available:*'),
    ]).catch((err) => logger.warn({ err: err.message }, 'invalidateTeacherCache error'));
  }
}

export default new CacheService();
