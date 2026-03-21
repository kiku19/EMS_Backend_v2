import Redis from 'ioredis';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Redis');

let _client = null;
let _isReady = false;

/**
 * Build ioredis connection options tuned for production resilience.
 *
 *  - TLS auto-enabled when REDIS_URL starts with rediss:// (Upstash, Redis Cloud, etc.)
 *  - Hard timeouts prevent connection hangs from silently blocking the event loop
 *  - TCP keepalive detects half-open / zombie connections
 *  - Offline queue disabled: commands issued while Redis is down throw immediately
 *    so callers (cache service, rate limiter) fall back to in-memory without delay
 *  - Named connection makes Redis CLIENT LIST / MONITOR logs readable
 *
 * @param {string} connectionName  Logical name shown in Redis CLIENT LIST
 * @param {object} overrides       Any ioredis option overrides (e.g. { lazyConnect: true })
 */
export function createRedisOptions(connectionName = 'ems', overrides = {}) {
  const isTLS = process.env.REDIS_URL?.startsWith('rediss://');

  const base = {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,

    // Hard connection timeout — fail fast if the Redis host is unreachable
    connectTimeout: 10_000,

    // Per-command timeout — prevents a single slow command from blocking the event loop
    commandTimeout: 5_000,

    // TCP keepalive — probes the connection every 30 s to detect zombie sockets
    keepAlive: 30_000,

    // Fail fast when Redis is offline; the cache layer already falls back to
    // in-memory, so queuing commands only adds memory pressure with no benefit.
    enableOfflineQueue: false,

    // Identifies this client in Redis logs (CLIENT LIST, CLIENT GETNAME)
    connectionName,

    retryStrategy(times) {
      if (times > 5) {
        logger.error({ connectionName }, 'Redis: max reconnection attempts reached. Giving up.');
        return null; // stop retrying
      }
      return Math.min(times * 200, 2_000);
    },
  };

  if (isTLS) {
    // TLS is required for rediss:// endpoints.
    // Set REDIS_TLS_REJECT_UNAUTHORIZED=false only in staging with self-signed certs.
    base.tls = {
      rejectUnauthorized: process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== 'false',
    };
  }

  return { ...base, ...overrides };
}

function createRedisClient() {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'REDIS_URL is required in production. In-memory cache is not safe for multi-instance deployments.'
      );
    }
    logger.warn('REDIS_URL not set — Redis disabled. Using in-memory cache fallback (dev only).');
    return null;
  }

  const client = new Redis(redisUrl, createRedisOptions('ems-cache', { lazyConnect: true }));

  client.on('ready', () => {
    _isReady = true;
    logger.info('Redis ready');
  });

  client.on('error', (err) => {
    _isReady = false;
    logger.error({ err: err.message }, 'Redis error');
  });

  client.on('close', () => {
    _isReady = false;
    logger.warn('Redis connection closed');
  });

  client.on('reconnecting', () => {
    logger.info('Redis reconnecting...');
  });

  // Connect in the background; errors are handled by the event listener above
  client.connect().catch((err) => {
    logger.error(
      { err: err.message },
      'Redis initial connect failed — falling back to in-memory cache'
    );
  });

  return client;
}

_client = createRedisClient();

export function getRedisClient() {
  return _client;
}

export function isRedisReady() {
  return _isReady && _client !== null;
}

export default _client;
