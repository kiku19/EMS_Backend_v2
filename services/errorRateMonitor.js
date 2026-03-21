/**
 * OBS-07: Real-Time Error Rate Spike Alerting
 *
 * Tracks error rates in rolling time buckets and alerts via Slack/email
 * when the rate spikes >5x the baseline within a 5-minute window.
 * Auto-resolves when the rate returns to normal. Supports deployment
 * correlation (flags errors that started after a known deploy).
 */

import { sendEmail } from '../config/email.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ErrorRateMonitor');

// ── Configuration ─────────────────────────────────────────────────────────────
const BUCKET_DURATION_MS = 60_000; // 1-minute buckets
const SPIKE_WINDOW_BUCKETS = 5; // 5-minute spike detection window
const BASELINE_WINDOW_BUCKETS = 60; // 1-hour rolling baseline
const SPIKE_MULTIPLIER = 5; // alert when current rate > 5x baseline
const RESOLVE_MULTIPLIER = 2; // auto-resolve when rate < 2x baseline
const MIN_BASELINE_REQUESTS = 10; // ignore low-traffic periods
const ALERT_COOLDOWN_MS = 10 * 60_000; // minimum 10 min between repeat alerts

// ── In-memory rolling buckets ─────────────────────────────────────────────────
// Each bucket: { errors: number, requests: number, ts: number }
const buckets = [];

// ── Alert state ───────────────────────────────────────────────────────────────
let alertState = {
  active: false,
  alertedAt: null,
  triggerRate: null,
  baselineRate: null,
};

// ── Last known deployment ─────────────────────────────────────────────────────
let lastDeployment = null; // { version, deployedAt, commitSha }

// ── Weekly summary counters ───────────────────────────────────────────────────
let weeklySummary = {
  totalRequests: 0,
  totalErrors: 0,
  spikeCount: 0,
  weekStart: Date.now(),
};

// ─────────────────────────────────────────────────────────────────────────────

function currentBucketTs() {
  return Math.floor(Date.now() / BUCKET_DURATION_MS) * BUCKET_DURATION_MS;
}

function getOrCreateCurrentBucket() {
  const ts = currentBucketTs();
  let bucket = buckets[buckets.length - 1];
  if (!bucket || bucket.ts !== ts) {
    bucket = { errors: 0, requests: 0, ts };
    buckets.push(bucket);
    // Trim to baseline window + a bit of headroom
    if (buckets.length > BASELINE_WINDOW_BUCKETS + 10) {
      buckets.splice(0, buckets.length - (BASELINE_WINDOW_BUCKETS + 10));
    }
  }
  return bucket;
}

/**
 * Record an incoming request. Call once per request with isError=true for 5xx.
 */
export function recordRequest(isError = false) {
  const bucket = getOrCreateCurrentBucket();
  bucket.requests++;
  if (isError) {
    bucket.errors++;
    weeklySummary.totalErrors++;
  }
  weeklySummary.totalRequests++;
  checkForSpike();
}

/**
 * Register a deployment event for correlation analysis.
 */
export function registerDeployment({ version, commitSha } = {}) {
  lastDeployment = {
    version: version || process.env.npm_package_version || 'unknown',
    commitSha: commitSha || process.env.RENDER_GIT_COMMIT || null,
    deployedAt: new Date().toISOString(),
  };
  logger.info({ deployment: lastDeployment }, 'Deployment registered for error correlation');
}

/**
 * Return current error rate stats (used by health/ops endpoints).
 */
export function getErrorRateStats() {
  const now = Date.now();
  const spikeWindowStart = now - SPIKE_WINDOW_BUCKETS * BUCKET_DURATION_MS;
  const baselineWindowStart = now - BASELINE_WINDOW_BUCKETS * BUCKET_DURATION_MS;

  const spikeBuckets = buckets.filter((b) => b.ts >= spikeWindowStart);
  const baselineBuckets = buckets.filter(
    (b) => b.ts >= baselineWindowStart && b.ts < spikeWindowStart
  );

  const spikeErrors = spikeBuckets.reduce((s, b) => s + b.errors, 0);
  const spikeRequests = spikeBuckets.reduce((s, b) => s + b.requests, 0);
  const baselineErrors = baselineBuckets.reduce((s, b) => s + b.errors, 0);
  const baselineRequests = baselineBuckets.reduce((s, b) => s + b.requests, 0);

  return {
    spike: {
      errors: spikeErrors,
      requests: spikeRequests,
      rate: spikeRequests > 0 ? spikeErrors / spikeRequests : 0,
    },
    baseline: {
      errors: baselineErrors,
      requests: baselineRequests,
      rate: baselineRequests > 0 ? baselineErrors / baselineRequests : 0,
    },
    alertActive: alertState.active,
    lastDeployment,
  };
}

/**
 * Return and reset the weekly summary counters.
 */
export function flushWeeklySummary() {
  const summary = {
    ...weeklySummary,
    weekEnd: Date.now(),
    errorRate:
      weeklySummary.totalRequests > 0
        ? (weeklySummary.totalErrors / weeklySummary.totalRequests).toFixed(4)
        : '0.0000',
  };
  weeklySummary = {
    totalRequests: 0,
    totalErrors: 0,
    spikeCount: 0,
    weekStart: Date.now(),
  };
  return summary;
}

// ── Spike detection ───────────────────────────────────────────────────────────

function checkForSpike() {
  const stats = getErrorRateStats();
  const { spike, baseline } = stats;

  // Need enough baseline traffic to calculate a meaningful ratio
  if (baseline.requests < MIN_BASELINE_REQUESTS) return;

  const currentRate = spike.rate;
  const baselineRate = baseline.rate;

  if (baselineRate === 0) return; // No baseline errors → no meaningful comparison

  const ratio = currentRate / baselineRate;

  if (!alertState.active) {
    if (ratio >= SPIKE_MULTIPLIER) {
      const now = Date.now();
      if (!alertState.alertedAt || now - alertState.alertedAt > ALERT_COOLDOWN_MS) {
        alertState = { active: true, alertedAt: now, triggerRate: currentRate, baselineRate };
        weeklySummary.spikeCount++;
        sendSpikeAlert({ currentRate, baselineRate, ratio, spike, baseline }).catch((err) =>
          logger.error({ err }, 'Failed to send spike alert')
        );
      }
    }
  } else {
    // Auto-resolve when rate falls back below RESOLVE_MULTIPLIER * baseline
    if (ratio < RESOLVE_MULTIPLIER) {
      const wasActive = alertState;
      alertState = { active: false, alertedAt: null, triggerRate: null, baselineRate: null };
      sendResolveAlert({ currentRate, baselineRate, wasActive }).catch((err) =>
        logger.error({ err }, 'Failed to send resolve alert')
      );
    }
  }
}

// ── Notification helpers ──────────────────────────────────────────────────────

function deploymentContext() {
  if (!lastDeployment) return '';
  const deployedAt = new Date(lastDeployment.deployedAt);
  const minutesAgo = Math.round((Date.now() - deployedAt.getTime()) / 60_000);
  if (minutesAgo < 60) {
    return `\n*Deployment correlation:* v${lastDeployment.version} deployed ${minutesAgo}m ago${lastDeployment.commitSha ? ` (${lastDeployment.commitSha.slice(0, 7)})` : ''}`;
  }
  return '';
}

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
      logger.warn({ status: res.status }, 'Slack alert webhook returned non-2xx');
    }
  } catch (err) {
    logger.warn({ err }, 'Slack alert post failed');
  }
}

async function sendSpikeAlert({ currentRate, baselineRate, ratio, spike, baseline }) {
  const env = process.env.NODE_ENV || 'development';
  const pct = (rate) => `${(rate * 100).toFixed(1)}%`;
  const deployCtx = deploymentContext();

  const message = [
    `🚨 *EMS Error Rate Spike — ${env.toUpperCase()}*`,
    `Current error rate: *${pct(currentRate)}* (${spike.errors} errors / ${spike.requests} requests in last 5 min)`,
    `Baseline error rate: *${pct(baselineRate)}* (last hour)`,
    `Ratio: *${ratio.toFixed(1)}x baseline* (threshold: ${SPIKE_MULTIPLIER}x)`,
    deployCtx,
  ]
    .filter(Boolean)
    .join('\n');

  logger.error(
    { currentRate, baselineRate, ratio, spikeErrors: spike.errors, deployment: lastDeployment },
    'Error rate spike detected'
  );

  await Promise.allSettled([
    postToSlack(message),
    sendErrorAlertEmail({
      subject: `[ALERT] Error rate spike on EMS (${env})`,
      body: message.replace(/\*/g, ''),
    }),
  ]);
}

async function sendResolveAlert({ currentRate, baselineRate, wasActive }) {
  const env = process.env.NODE_ENV || 'development';
  const pct = (rate) => `${(rate * 100).toFixed(1)}%`;
  const duration = wasActive.alertedAt
    ? `${Math.round((Date.now() - wasActive.alertedAt) / 60_000)}m`
    : 'unknown';

  const message = [
    `✅ *EMS Error Rate Recovered — ${env.toUpperCase()}*`,
    `Error rate back to normal: *${pct(currentRate)}* (was ${pct(wasActive.triggerRate || 0)} at spike)`,
    `Baseline: *${pct(baselineRate)}*`,
    `Incident duration: ~${duration}`,
  ].join('\n');

  logger.info({ currentRate, baselineRate }, 'Error rate spike resolved');

  await Promise.allSettled([
    postToSlack(message),
    sendErrorAlertEmail({
      subject: `[RESOLVED] Error rate spike on EMS (${env})`,
      body: message.replace(/\*/g, ''),
    }),
  ]);
}

async function sendErrorAlertEmail({ subject, body }) {
  const to = process.env.ALERT_EMAIL_TO;
  if (!to) return;

  const html = `<pre style="font-family:monospace;white-space:pre-wrap">${body}</pre>`;
  await sendEmail({ to, subject, html });
}

/**
 * Send the weekly error summary report to the engineering team.
 * Called by the Agenda scheduled job every Monday at 9 AM.
 */
export async function sendWeeklySummaryReport() {
  const to = process.env.ALERT_EMAIL_TO;
  if (!to) {
    logger.warn('ALERT_EMAIL_TO not set — skipping weekly error summary');
    return;
  }

  const summary = flushWeeklySummary();
  const weekStartStr = new Date(summary.weekStart).toDateString();
  const weekEndStr = new Date(summary.weekEnd).toDateString();
  const errorPct = `${(Number(summary.errorRate) * 100).toFixed(2)}%`;

  const html = `
    <h2>EMS Weekly Error Summary</h2>
    <p><strong>Period:</strong> ${weekStartStr} – ${weekEndStr}</p>
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
      <tr><th>Metric</th><th>Value</th></tr>
      <tr><td>Total Requests</td><td>${summary.totalRequests.toLocaleString()}</td></tr>
      <tr><td>Total Errors (5xx)</td><td>${summary.totalErrors.toLocaleString()}</td></tr>
      <tr><td>Overall Error Rate</td><td>${errorPct}</td></tr>
      <tr><td>Spike Incidents</td><td>${summary.spikeCount}</td></tr>
    </table>
    <p style="color:#888;font-size:12px">Generated by EMS OBS-07 Error Rate Monitor</p>
  `;

  try {
    await sendEmail({
      to,
      subject: `EMS Weekly Error Summary — ${weekStartStr}`,
      html,
    });
    logger.info({ to, summary }, 'Weekly error summary sent');
  } catch (err) {
    logger.error({ err }, 'Failed to send weekly error summary email');
  }

  // Also post to Slack
  const slackText = [
    `📊 *EMS Weekly Error Summary (${weekStartStr} – ${weekEndStr})*`,
    `Requests: ${summary.totalRequests.toLocaleString()} | Errors: ${summary.totalErrors.toLocaleString()} | Rate: ${errorPct} | Spikes: ${summary.spikeCount}`,
  ].join('\n');
  await postToSlack(slackText).catch(() => {});
}
