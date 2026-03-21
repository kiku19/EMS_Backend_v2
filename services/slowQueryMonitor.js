/**
 * OBS-05: Database Query Performance Monitoring — Slow Query Alerts
 *
 * Hooks into MongoDB's native APM (Application Performance Monitoring) via
 * the `commandSucceeded` event to capture queries exceeding the threshold,
 * alert via Slack/email, track daily top-10 slowest queries, and surface
 * index usage statistics with automated suggestions.
 *
 * Requires `monitorCommands: true` in the Mongoose connection options (set
 * in database.js). Call `initializeSlowQueryMonitor()` after connectDB().
 */

import mongoose from 'mongoose';
import { sendEmail } from '../config/email.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('SlowQueryMonitor');

// ── Configuration ─────────────────────────────────────────────────────────────
// Queries above this duration (ms) are recorded as slow
const SLOW_QUERY_THRESHOLD_MS = parseInt(process.env.SLOW_QUERY_THRESHOLD_MS || '100', 10);
// Queries above this duration trigger an immediate Slack/email alert
const ALERT_THRESHOLD_MS = parseInt(process.env.SLOW_QUERY_ALERT_THRESHOLD_MS || '1000', 10);
// Maximum entries kept in the in-memory ring buffer
const MAX_BUFFER_SIZE = 500;
// Top-N slowest queries tracked per day
const TOP_N_PER_DAY = 10;
// Minimum 15 minutes between repeat very-slow-query alerts
const ALERT_COOLDOWN_MS = 15 * 60_000;

// Commands that are infrastructure noise — never interesting as slow queries
const SKIP_COMMANDS = new Set([
  'ping',
  'hello',
  'isMaster',
  'ismaster',
  'buildInfo',
  'buildinfo',
  'listDatabases',
  'listCollections',
  'createIndexes',
  'dropIndexes',
  'endSessions',
  'saslStart',
  'saslContinue',
  'logout',
  'whatsmyuri',
  'getLastError',
  'serverStatus',
  'currentOp',
  'killOp',
]);

// ── In-memory state ───────────────────────────────────────────────────────────
// Each entry: { ts: Date, durationMs: number, collection: string,
//               operation: string, dbName: string, fingerprint: string }
const slowQueryBuffer = [];

// Top-N slowest for today (reset each day by flushDailyStats())
let dailyTopQueries = [];

const alertState = { alertedAt: null };
let initialized = false;

// ── Query fingerprinting ──────────────────────────────────────────────────────

/**
 * Normalize an object into a stable type-shape fingerprint.
 * Replaces concrete values with type placeholders so structurally
 * identical queries (different filter values) map to the same key.
 */
function fingerprint(obj, depth = 0) {
  if (depth > 4) return '...';
  if (obj === null || obj === undefined) return 'null';
  if (Array.isArray(obj)) {
    return `[${obj
      .slice(0, 3)
      .map((v) => fingerprint(v, depth + 1))
      .join(',')}]`;
  }
  const t = typeof obj;
  if (t === 'number') return '#';
  if (t === 'boolean') return 'bool';
  // Preserve MongoDB operators ($eq, $gt, $in, …) — they define the query shape
  if (t === 'string') return obj.startsWith('$') ? obj : 'str';
  if (obj instanceof Date) return 'Date';
  // ObjectId-like
  if (obj._bsontype === 'ObjectId' || obj?.constructor?.name === 'ObjectId') return 'ObjId';
  if (t === 'object') {
    const keys = Object.keys(obj).sort();
    const pairs = keys.slice(0, 8).map((k) => `${k}:${fingerprint(obj[k], depth + 1)}`);
    return `{${pairs.join(',')}}`;
  }
  return 'val';
}

// ── APM event parser ──────────────────────────────────────────────────────────

/**
 * Convert a raw MongoDB `commandSucceeded` APM event into a structured record.
 */
function parseCommandEvent(event) {
  const cmd = event.command || {};
  const commandName = event.commandName;

  let collection;
  let filter = null;

  switch (commandName) {
    case 'find':
      collection = cmd.find;
      filter = cmd.filter;
      break;
    case 'aggregate':
      collection = cmd.aggregate;
      filter = (cmd.pipeline || []).find((s) => s.$match)?.$match;
      break;
    case 'update':
      collection = cmd.update;
      filter = cmd.updates?.[0]?.q;
      break;
    case 'delete':
      collection = cmd.delete;
      filter = cmd.deletes?.[0]?.q;
      break;
    case 'findAndModify':
      collection = cmd.findAndModify;
      filter = cmd.query;
      break;
    case 'count':
      collection = cmd.count;
      filter = cmd.query;
      break;
    case 'distinct':
      collection = cmd.distinct;
      filter = cmd.query;
      break;
    default:
      collection = cmd[commandName] || commandName;
  }

  return {
    ts: new Date(),
    durationMs: event.duration,
    collection: String(collection),
    operation: commandName,
    dbName: event.databaseName,
    fingerprint: fingerprint({ op: commandName, filter: filter || {} }),
  };
}

// ── Core recording logic ──────────────────────────────────────────────────────

function recordSlowQuery(record) {
  // Ring buffer — drop oldest entry when full
  slowQueryBuffer.push(record);
  if (slowQueryBuffer.length > MAX_BUFFER_SIZE) {
    slowQueryBuffer.shift();
  }

  // Maintain daily top-N (sorted by duration desc)
  dailyTopQueries.push(record);
  dailyTopQueries.sort((a, b) => b.durationMs - a.durationMs);
  if (dailyTopQueries.length > TOP_N_PER_DAY) {
    dailyTopQueries.length = TOP_N_PER_DAY;
  }

  // Immediate alert for very slow queries
  if (record.durationMs >= ALERT_THRESHOLD_MS) {
    const now = Date.now();
    if (!alertState.alertedAt || now - alertState.alertedAt > ALERT_COOLDOWN_MS) {
      alertState.alertedAt = now;
      sendVerySlowQueryAlert(record).catch((err) =>
        logger.error({ err }, 'Failed to send very slow query alert')
      );
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Attach MongoDB APM listeners to the Mongoose client.
 * Call this after `connectDB()` resolves.
 */
export function initializeSlowQueryMonitor() {
  if (initialized) return;

  try {
    const client = mongoose.connection.getClient?.();
    if (!client) {
      logger.warn('MongoDB client not available — slow query monitor not initialized');
      return;
    }

    client.on('commandSucceeded', (event) => {
      if (SKIP_COMMANDS.has(event.commandName)) return;

      // MongoDB driver v6 uses `event.duration` (milliseconds)
      const durationMs = event.duration ?? 0;
      if (durationMs < SLOW_QUERY_THRESHOLD_MS) return;

      const record = parseCommandEvent(event);
      recordSlowQuery(record);
      logger.warn(
        { collection: record.collection, operation: record.operation, durationMs },
        'Slow query detected'
      );
    });

    initialized = true;
    logger.info(
      { thresholdMs: SLOW_QUERY_THRESHOLD_MS, alertThresholdMs: ALERT_THRESHOLD_MS },
      'Slow query monitor initialized'
    );
  } catch (err) {
    logger.error({ err }, 'Failed to initialize slow query monitor');
  }
}

/**
 * Return dashboard statistics for the ops endpoint.
 */
export function getSlowQueryStats() {
  const now = Date.now();
  const last5MinCutoff = now - 5 * 60_000;
  const last1HourCutoff = now - 60 * 60_000;

  const last5MinQueries = slowQueryBuffer.filter((q) => q.ts.getTime() >= last5MinCutoff);
  const lastHourQueries = slowQueryBuffer.filter((q) => q.ts.getTime() >= last1HourCutoff);

  // Group queries by collection+operation to find patterns
  const patternMap = new Map();
  for (const q of lastHourQueries) {
    const key = `${q.collection}::${q.operation}`;
    const entry = patternMap.get(key) ?? {
      collection: q.collection,
      operation: q.operation,
      count: 0,
      totalMs: 0,
      maxMs: 0,
      minMs: Infinity,
    };
    entry.count++;
    entry.totalMs += q.durationMs;
    entry.maxMs = Math.max(entry.maxMs, q.durationMs);
    entry.minMs = Math.min(entry.minMs, q.durationMs);
    patternMap.set(key, entry);
  }

  const queryPatterns = Array.from(patternMap.values())
    .map((p) => ({
      ...p,
      avgMs: Math.round(p.totalMs / p.count),
      minMs: p.minMs === Infinity ? 0 : p.minMs,
    }))
    .sort((a, b) => b.avgMs - a.avgMs)
    .slice(0, 20);

  return {
    threshold: {
      recordMs: SLOW_QUERY_THRESHOLD_MS,
      alertMs: ALERT_THRESHOLD_MS,
    },
    last5Minutes: { count: last5MinQueries.length },
    lastHour: { count: lastHourQueries.length },
    topSlowestToday: dailyTopQueries,
    queryPatterns,
    totalBuffered: slowQueryBuffer.length,
  };
}

/**
 * Return today's stats and reset daily tracking.
 * Called by the Agenda daily report job.
 */
export function flushDailyStats() {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);

  const todayCount = slowQueryBuffer.filter((q) => q.ts >= midnight).length;

  const stats = {
    date: new Date().toDateString(),
    topSlowest: [...dailyTopQueries],
    totalSlowQueriesRecorded: todayCount,
  };
  dailyTopQueries = [];
  return stats;
}

// ── Index Statistics ──────────────────────────────────────────────────────────

/**
 * Fetch $indexStats for every user collection and return:
 *  - Full stats sorted by least used (potential candidates for removal)
 *  - Automated suggestions for unused indexes
 */
export async function getIndexStats() {
  try {
    const db = mongoose.connection.db;
    const collectionInfos = await db.listCollections().toArray();

    const results = [];
    for (const info of collectionInfos) {
      if (info.name.startsWith('system.') || info.name === 'jobs') continue;

      try {
        const stats = await db
          .collection(info.name)
          .aggregate([{ $indexStats: {} }])
          .toArray();

        for (const stat of stats) {
          results.push({
            collection: info.name,
            index: stat.name,
            keyPattern: stat.key,
            ops: stat.accesses?.ops ?? 0,
            since: stat.accesses?.since,
          });
        }
      } catch {
        // Some views or capped collections may not support $indexStats — skip them
      }
    }

    // Sort by fewest accesses first (most likely unused)
    results.sort((a, b) => a.ops - b.ops);

    const unusedIndexes = results.filter((i) => i.ops === 0 && i.index !== '_id_');
    const suggestions = unusedIndexes.slice(0, 10).map((i) => ({
      suggestion: `Consider removing unused index '${i.index}' on '${i.collection}'`,
      collection: i.collection,
      index: i.index,
      keyPattern: i.keyPattern,
    }));

    return {
      allIndexStats: results.slice(0, 100),
      unusedCount: unusedIndexes.length,
      suggestions,
    };
  } catch (err) {
    logger.error({ err }, 'Failed to fetch index stats');
    return { allIndexStats: [], unusedCount: 0, suggestions: [] };
  }
}

// ── Alert helpers ─────────────────────────────────────────────────────────────

async function postToSlack(text) {
  const webhookUrl = process.env.SLACK_ALERT_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    const { default: fetch } = await import('node-fetch');
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'Slack slow query webhook returned non-2xx');
    }
  } catch (err) {
    logger.warn({ err }, 'Slack slow query post failed');
  }
}

async function sendVerySlowQueryAlert(record) {
  const env = process.env.NODE_ENV || 'development';
  const message = [
    `🐢 *EMS Very Slow Query — ${env.toUpperCase()}*`,
    `Collection: *${record.collection}* | Operation: *${record.operation}*`,
    `Duration: *${record.durationMs}ms* (alert threshold: ${ALERT_THRESHOLD_MS}ms)`,
    `DB: ${record.dbName} | Time: ${record.ts.toISOString()}`,
  ].join('\n');

  logger.error(
    { collection: record.collection, operation: record.operation, durationMs: record.durationMs },
    'Very slow query alert triggered'
  );

  const to = process.env.ALERT_EMAIL_TO;
  const emailPromise = to
    ? sendEmail({
        to,
        subject: `[ALERT] Very slow query on ${record.collection} (${record.durationMs}ms)`,
        html: `<pre style="font-family:monospace;white-space:pre-wrap">${message.replace(/\*/g, '')}</pre>`,
      })
    : Promise.resolve();

  await Promise.allSettled([postToSlack(message), emailPromise]);
}

/**
 * Send the daily slow-query digest.
 * Called by the Agenda scheduled job every day at 8 AM.
 */
export async function sendDailySlowQueryReport() {
  const to = process.env.ALERT_EMAIL_TO;
  if (!to) {
    logger.warn('ALERT_EMAIL_TO not set — skipping daily slow query report');
    return;
  }

  const stats = flushDailyStats();

  if (stats.topSlowest.length === 0) {
    logger.info('No slow queries recorded today — skipping daily report');
    return;
  }

  const rows = stats.topSlowest
    .map(
      (q, i) =>
        `<tr><td>${i + 1}</td><td>${q.collection}</td><td>${q.operation}</td>` +
        `<td>${q.durationMs}ms</td><td>${new Date(q.ts).toTimeString().slice(0, 8)}</td></tr>`
    )
    .join('');

  const html = `
    <h2>EMS Daily Slow Query Report</h2>
    <p><strong>Date:</strong> ${stats.date}</p>
    <p><strong>Total slow queries recorded (>${SLOW_QUERY_THRESHOLD_MS}ms):</strong> ${stats.totalSlowQueriesRecorded}</p>
    <h3>Top ${stats.topSlowest.length} Slowest Queries Today</h3>
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
      <tr><th>#</th><th>Collection</th><th>Operation</th><th>Duration</th><th>Time</th></tr>
      ${rows}
    </table>
    <p style="color:#888;font-size:12px">Generated by EMS OBS-05 Slow Query Monitor</p>
  `;

  try {
    await sendEmail({
      to,
      subject: `EMS Daily Slow Query Report — ${stats.date} (${stats.totalSlowQueriesRecorded} slow queries)`,
      html,
    });
    logger.info(
      { to, totalSlowQueries: stats.totalSlowQueriesRecorded },
      'Daily slow query report sent'
    );
  } catch (err) {
    logger.error({ err }, 'Failed to send daily slow query report email');
  }

  const slackText = [
    `📊 *EMS Daily Slow Query Report (${stats.date})*`,
    `Slow queries today (>${SLOW_QUERY_THRESHOLD_MS}ms): *${stats.totalSlowQueriesRecorded}*`,
    stats.topSlowest.length > 0
      ? `Slowest: *${stats.topSlowest[0].collection}* .${stats.topSlowest[0].operation} at *${stats.topSlowest[0].durationMs}ms*`
      : null,
  ]
    .filter(Boolean)
    .join('\n');

  await postToSlack(slackText).catch(() => {});
}
