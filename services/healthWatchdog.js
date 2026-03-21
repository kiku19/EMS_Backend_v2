/**
 * DR-04: Internal Health Watchdog — auto-restart on sustained dependency failure.
 *
 * Rationale:
 *   Mongoose will reconnect on its own after transient DB blips, but if the
 *   database is permanently unreachable (wrong URI, network partition, DB
 *   server replaced) the process stays alive in a "disconnected" state, silently
 *   failing every request. In that case the best recovery action is to exit(1)
 *   so Docker / Render / PM2 can start a fresh process that will either:
 *     a) Connect to the now-recovered database, or
 *     b) Fail fast at startup and trigger an alert.
 *
 * Behaviour:
 *   - Checks DB (and optionally Redis) every WATCHDOG_INTERVAL_MS.
 *   - Counts consecutive failures on each component independently.
 *   - In production: calls process.exit(1) after RESTART_THRESHOLD consecutive
 *     DB failures, giving the orchestrator (Docker/Render/PM2) the signal to
 *     restart with a clean slate.
 *   - In development/test: logs a warning but never exits.
 *   - Redis failures are logged but never trigger a restart — the app degrades
 *     gracefully without Redis (caching / pub-sub optional).
 *
 * Env vars (all optional):
 *   WATCHDOG_INTERVAL_MS       — check interval in ms (default: 30 000)
 *   WATCHDOG_DB_THRESHOLD      — consecutive DB-down checks before exit (default: 10 = 5 min)
 *   WATCHDOG_REDIS_THRESHOLD   — consecutive Redis-down checks logged as critical (default: 20 = 10 min)
 */

import mongoose from 'mongoose';
import { isRedisReady } from '../config/redis.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('HealthWatchdog');

const INTERVAL_MS = parseInt(process.env.WATCHDOG_INTERVAL_MS || '30000', 10);
const DB_THRESHOLD = parseInt(process.env.WATCHDOG_DB_THRESHOLD || '10', 10);
const REDIS_THRESHOLD = parseInt(process.env.WATCHDOG_REDIS_THRESHOLD || '20', 10);

let dbFailCount = 0;
let redisFailCount = 0;
let watchdogInterval = null;

function checkDependencies() {
  // ── Database ───────────────────────────────────────────────────────────────
  const dbReady = mongoose.connection.readyState === 1;

  if (dbReady) {
    if (dbFailCount > 0) {
      logger.info(
        { previousFailCount: dbFailCount },
        'DB connection restored — resetting watchdog counter'
      );
    }
    dbFailCount = 0;
  } else {
    dbFailCount += 1;
    logger.warn(
      {
        dbState: mongoose.connection.readyState,
        consecutiveFails: dbFailCount,
        threshold: DB_THRESHOLD,
      },
      'Watchdog: DB not connected'
    );

    if (dbFailCount >= DB_THRESHOLD) {
      const msg = `Watchdog: DB unreachable for ${dbFailCount} consecutive checks (${Math.round((dbFailCount * INTERVAL_MS) / 60_000)} min). Triggering restart.`;
      logger.fatal({ dbFailCount, thresholdMs: dbFailCount * INTERVAL_MS }, msg);

      if (process.env.NODE_ENV === 'production') {
        // Allow a final log flush before exiting
        setTimeout(() => process.exit(1), 500);
      } else {
        logger.warn('Non-production environment — skipping process.exit(1). Fix DB connection.');
        dbFailCount = 0; // Reset to avoid log spam in dev
      }
    }
  }

  // ── Redis (optional) ───────────────────────────────────────────────────────
  const redisConfigured = !!process.env.REDIS_URL;
  if (redisConfigured) {
    const redisReady = isRedisReady();

    if (redisReady) {
      if (redisFailCount > 0) {
        logger.info(
          { previousFailCount: redisFailCount },
          'Redis connection restored — resetting watchdog counter'
        );
      }
      redisFailCount = 0;
    } else {
      redisFailCount += 1;

      if (redisFailCount >= REDIS_THRESHOLD) {
        // Redis failure is non-fatal — log critical but do NOT restart.
        // The app degrades gracefully: rate limiting falls back to in-memory,
        // Socket.IO pub-sub is limited to single-instance, session cache misses.
        logger.error(
          { redisFailCount, thresholdMs: redisFailCount * INTERVAL_MS },
          'Watchdog: Redis unreachable for extended period — operating in degraded mode'
        );
        redisFailCount = 0; // Reset after logging to avoid log flood
      } else {
        logger.warn({ redisFailCount, threshold: REDIS_THRESHOLD }, 'Watchdog: Redis not ready');
      }
    }
  }
}

/**
 * Start the health watchdog. Call once after the DB connection is established.
 */
export function startHealthWatchdog() {
  if (watchdogInterval) return;

  // First check after 60 s to allow slow DB connections / replica set elections
  const initialDelay = Math.max(INTERVAL_MS * 2, 60_000);
  setTimeout(() => {
    checkDependencies();
    watchdogInterval = setInterval(checkDependencies, INTERVAL_MS);
    logger.info(
      {
        intervalMs: INTERVAL_MS,
        dbThreshold: DB_THRESHOLD,
        restartEnabled: process.env.NODE_ENV === 'production',
      },
      'Health watchdog started (DR-04)'
    );
  }, initialDelay);
}

/**
 * Stop the watchdog (graceful shutdown / tests).
 */
export function stopHealthWatchdog() {
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }
}
