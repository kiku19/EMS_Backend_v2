/**
 * OBS-02: APM & Request Tracing — Latency Metrics Service
 *
 * Tracks per-endpoint latency in a ring buffer and computes
 * p50/p95/p99 percentiles on demand. No external dependencies.
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('APM');

// ── Configuration ─────────────────────────────────────────────────────────────
const MAX_SAMPLES_PER_ENDPOINT = 500; // ring buffer size per endpoint
export const SLOW_REQUEST_MS = 2000; // individual request alert threshold (2 s)
// Mirrors SLOW_QUERY_THRESHOLD_MS in slowQueryMonitor.js — kept in sync via env var
const SLOW_QUERY_MS = parseInt(process.env.SLOW_QUERY_THRESHOLD_MS || '100', 10);

// PERF-06: SLA target — p99 latency must stay below this for all endpoints
export const SLA_P99_TARGET_MS = parseInt(process.env.SLA_P99_TARGET_MS || '500', 10);
// Min samples required before an endpoint is evaluated for SLA compliance
const SLA_MIN_SAMPLES = 10;
// How often to run the periodic SLA compliance check
const SLA_CHECK_INTERVAL_MS = 5 * 60_000; // 5 minutes
// Cooldown between repeat SLA breach alerts for the same endpoint
const SLA_ALERT_COOLDOWN_MS = 30 * 60_000; // 30 minutes

// ── Ring buffer ────────────────────────────────────────────────────────────────
class RingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.data = [];
    this.pointer = 0;
  }

  push(value) {
    if (this.data.length < this.capacity) {
      this.data.push(value);
    } else {
      this.data[this.pointer] = value;
      this.pointer = (this.pointer + 1) % this.capacity;
    }
  }

  toSortedArray() {
    return [...this.data].sort((a, b) => a - b);
  }

  get size() {
    return this.data.length;
  }
}

// ── Per-endpoint state ─────────────────────────────────────────────────────────
// Key: "METHOD /normalized/path"
// Value: { latencies: RingBuffer, count, errors, slowCount }
const endpointMetrics = new Map();

// ── Slow-request alerting via Slack / log ─────────────────────────────────────
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
    if (!res.ok) logger.warn({ status: res.status }, 'APM Slack webhook returned non-2xx');
  } catch (err) {
    logger.warn({ err }, 'APM Slack post failed');
  }
}

// Cooldown: avoid flooding Slack with repeated slow-request alerts
const slowAlertCooldown = new Map(); // endpointKey -> lastAlertTs
const SLOW_ALERT_COOLDOWN_MS = 5 * 60_000; // 5 minutes

// Cooldown: avoid flooding Slack with repeated SLA breach alerts (PERF-06)
const slaAlertCooldown = new Map(); // endpointKey -> lastAlertTs

function maybeSendSlowAlert(endpointKey, durationMs, traceId) {
  const now = Date.now();
  const last = slowAlertCooldown.get(endpointKey) || 0;
  if (now - last < SLOW_ALERT_COOLDOWN_MS) return;
  slowAlertCooldown.set(endpointKey, now);

  const env = process.env.NODE_ENV || 'development';
  const text = [
    `⚠️ *EMS Slow Request — ${env.toUpperCase()}*`,
    `Endpoint: \`${endpointKey}\``,
    `Duration: *${durationMs}ms* (threshold: ${SLOW_REQUEST_MS}ms)`,
    traceId ? `Trace ID: \`${traceId}\`` : null,
  ]
    .filter(Boolean)
    .join('\n');

  postToSlack(text).catch(() => {});
}

function maybeSendSlaBreachAlert(endpointKey, p99, sampleCount) {
  const now = Date.now();
  const last = slaAlertCooldown.get(endpointKey) || 0;
  if (now - last < SLA_ALERT_COOLDOWN_MS) return;
  slaAlertCooldown.set(endpointKey, now);

  const env = process.env.NODE_ENV || 'development';
  const text = [
    `🔴 *EMS SLA Breach — ${env.toUpperCase()}*`,
    `Endpoint: \`${endpointKey}\``,
    `p99: *${p99}ms* (SLA target: ${SLA_P99_TARGET_MS}ms)`,
    `Samples in buffer: ${sampleCount}`,
  ].join('\n');

  logger.warn(
    { endpoint: endpointKey, p99, slaTarget: SLA_P99_TARGET_MS, sampleCount },
    'SLA p99 breach'
  );
  postToSlack(text).catch(() => {});
}

// ── Path normalization ─────────────────────────────────────────────────────────
// Strips API prefix, ObjectIds, UUIDs, and numeric IDs so routes group correctly.
// e.g. /api/v1/students/507f1f77bcf86cd799439011/fees → /students/:id/fees
export function normalizePath(rawPath) {
  return (
    (rawPath || '/')
      .replace(/\?.*$/, '') // strip query string
      .replace(/^\/api\/v\d+/, '') // strip /api/v1
      .replace(/^\/api/, '') // strip /api
      .replace(/\/[a-f0-9]{24}(?=\/|$)/gi, '/:id') // MongoDB ObjectIds
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:id') // UUIDs
      .replace(/\/\d+(?=\/|$)/g, '/:id') || // numeric IDs
    '/'
  );
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Record a completed request.
 * Called by requestTracing middleware on response finish.
 */
export function recordLatency(method, path, durationMs, statusCode, traceId) {
  const key = `${method} ${normalizePath(path)}`;

  if (!endpointMetrics.has(key)) {
    endpointMetrics.set(key, {
      latencies: new RingBuffer(MAX_SAMPLES_PER_ENDPOINT),
      count: 0,
      errors: 0,
      slowCount: 0,
    });
  }

  const m = endpointMetrics.get(key);
  m.latencies.push(durationMs);
  m.count++;
  if (statusCode >= 500) m.errors++;
  if (durationMs >= SLOW_REQUEST_MS) {
    m.slowCount++;
    logger.warn({ endpoint: key, durationMs, statusCode, traceId }, 'Slow request detected');
    maybeSendSlowAlert(key, durationMs, traceId);
  }
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, idx)];
}

/**
 * Returns per-endpoint latency stats, sorted by p99 descending.
 */
export function getApmStats() {
  const endpoints = [];

  for (const [key, m] of endpointMetrics.entries()) {
    if (m.count === 0) continue;
    const sorted = m.latencies.toSortedArray();
    const p99 = percentile(sorted, 99);
    endpoints.push({
      endpoint: key,
      count: m.count,
      errors: m.errors,
      slowCount: m.slowCount,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99,
      max: sorted[sorted.length - 1] || 0,
      // PERF-06: SLA compliance flag (requires SLA_MIN_SAMPLES to be meaningful)
      slaBreach: m.count >= SLA_MIN_SAMPLES && p99 > SLA_P99_TARGET_MS,
    });
  }

  // Sort by p99 descending so worst offenders appear first
  endpoints.sort((a, b) => b.p99 - a.p99);

  const breachingCount = endpoints.filter((e) => e.slaBreach).length;

  return {
    thresholds: {
      slowRequestMs: SLOW_REQUEST_MS,
      slowQueryMs: SLOW_QUERY_MS,
      slaP99TargetMs: SLA_P99_TARGET_MS,
    },
    endpointCount: endpoints.length,
    slaBreachCount: breachingCount,
    slaCompliant: breachingCount === 0,
    endpoints,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * PERF-06: Returns endpoints currently breaching the p99 SLA target.
 * Requires at least SLA_MIN_SAMPLES before an endpoint is evaluated.
 */
export function getSlaViolations() {
  const violations = [];
  for (const [key, m] of endpointMetrics.entries()) {
    if (m.count < SLA_MIN_SAMPLES) continue;
    const sorted = m.latencies.toSortedArray();
    const p99 = percentile(sorted, 99);
    if (p99 > SLA_P99_TARGET_MS) {
      violations.push({ endpoint: key, p99, count: m.count, slaTarget: SLA_P99_TARGET_MS });
    }
  }
  violations.sort((a, b) => b.p99 - a.p99);
  return violations;
}

/**
 * PERF-06: Start the periodic SLA compliance monitor.
 * Runs every 5 minutes, logs a warning and posts a Slack alert for each
 * endpoint whose p99 latency exceeds the SLA_P99_TARGET_MS target.
 * Call once during server initialisation (after middleware is mounted).
 */
export function startSlaMonitor() {
  setInterval(() => {
    const violations = getSlaViolations();
    for (const v of violations) {
      maybeSendSlaBreachAlert(v.endpoint, v.p99, v.count);
    }
    if (violations.length === 0) {
      logger.debug(
        { slaP99TargetMs: SLA_P99_TARGET_MS },
        'SLA check passed — all endpoints within p99 target'
      );
    }
  }, SLA_CHECK_INTERVAL_MS);

  logger.info(
    { slaP99TargetMs: SLA_P99_TARGET_MS, checkIntervalMs: SLA_CHECK_INTERVAL_MS },
    'PERF-06: SLA monitor started'
  );
}
