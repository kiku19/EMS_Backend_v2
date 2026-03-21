/**
 * OBS-06: Uptime Monitoring & Incident Alerting
 *
 * Tracks service availability via periodic internal health checks, detects
 * downtime incidents, computes SLA percentages, checks SSL certificate expiry,
 * and alerts via Slack/email when the service is down or a cert is about to expire.
 *
 * External monitoring setup (recommended):
 *   - UptimeRobot / Pingdom: ping GET /healthz every 60 s
 *   - Alert destination: SLACK_ALERT_WEBHOOK_URL (shared with OBS-07)
 *
 * Env vars:
 *   SLACK_ALERT_WEBHOOK_URL  — Slack incoming webhook (shared with OBS-07)
 *   ALERT_EMAIL_TO           — alert recipient email (shared with OBS-07)
 *   PUBLIC_HOSTNAME          — public hostname for SSL checks (e.g. api.myems.com)
 *   PUBLIC_PORT              — HTTPS port for SSL check (default: 443)
 *   SSL_EXPIRY_WARNING_DAYS  — days before cert expiry to warn (default: 30)
 */

import tls from 'tls';
import mongoose from 'mongoose';
import { sendEmail } from '../config/email.js';
import { isRedisReady } from '../config/redis.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('UptimeMonitor');

// ── Configuration ─────────────────────────────────────────────────────────────
const CHECK_INTERVAL_MS = 60_000; // Internal health check every 60 s
const MINUTE_BUCKET_RETENTION = 1440; // 24 h of per-minute data points
const HOURLY_BUCKET_RETENTION = 720; // 30 days of per-hour summaries
const ALERT_COOLDOWN_MS = 5 * 60_000; // Min 5 min between repeat down-alerts
const SSL_CHECK_INTERVAL_MS = 6 * 60 * 60_000; // Re-check SSL cert every 6 h
const SSL_WARN_DAYS = parseInt(process.env.SSL_EXPIRY_WARNING_DAYS || '30', 10);
const MAX_INCIDENTS = 50; // Keep the 50 most recent incidents

// ── In-memory state ───────────────────────────────────────────────────────────
const minuteBuckets = []; // { ts: number, up: boolean }
const hourlyBuckets = []; // { ts: number, upCount: number, total: number }
const incidents = []; // { id, startedAt, resolvedAt, durationMs, trigger }

let currentIncident = null; // { id, startedAt, trigger } while service is down
let incidentCounter = 0;
let lastDownAlertAt = null;
const serverStartAt = Date.now();

let sslExpiry = null; // { expiresAt, daysLeft, domain } | null
let sslAlertSent = false;

let monitorInterval = null;
let sslInterval = null;

// ── Bucket helpers ────────────────────────────────────────────────────────────
function minuteTs() {
  return Math.floor(Date.now() / 60_000) * 60_000;
}

function hourTs() {
  return Math.floor(Date.now() / 3_600_000) * 3_600_000;
}

function recordMinuteBucket(up) {
  const ts = minuteTs();
  const last = minuteBuckets[minuteBuckets.length - 1];
  if (!last || last.ts !== ts) {
    minuteBuckets.push({ ts, up });
    if (minuteBuckets.length > MINUTE_BUCKET_RETENTION) {
      minuteBuckets.splice(0, minuteBuckets.length - MINUTE_BUCKET_RETENTION);
    }
  } else if (!up) {
    // Within same minute: any down check marks the bucket down
    last.up = false;
  }
}

function rollupToHourly() {
  const ts = hourTs();
  const buckets = minuteBuckets.filter((b) => b.ts >= ts && b.ts < ts + 3_600_000);
  if (buckets.length === 0) return;
  const upCount = buckets.filter((b) => b.up).length;
  const last = hourlyBuckets[hourlyBuckets.length - 1];
  if (!last || last.ts !== ts) {
    hourlyBuckets.push({ ts, upCount, total: buckets.length });
    if (hourlyBuckets.length > HOURLY_BUCKET_RETENTION) {
      hourlyBuckets.splice(0, hourlyBuckets.length - HOURLY_BUCKET_RETENTION);
    }
  } else {
    last.upCount = upCount;
    last.total = buckets.length;
  }
}

// ── SLA calculation ───────────────────────────────────────────────────────────
function calcUptime(windowMs) {
  const since = Date.now() - windowMs;
  const relevant = minuteBuckets.filter((b) => b.ts >= since);
  if (relevant.length === 0) return 100;
  const upCount = relevant.filter((b) => b.up).length;
  return parseFloat(((upCount / relevant.length) * 100).toFixed(3));
}

// ── Incident management ───────────────────────────────────────────────────────
function openIncident(trigger) {
  if (currentIncident) return;
  currentIncident = {
    id: ++incidentCounter,
    startedAt: new Date().toISOString(),
    trigger,
  };
  logger.error({ incident: currentIncident }, 'Uptime incident opened');
}

function closeIncident() {
  if (!currentIncident) return;
  const resolvedAt = new Date().toISOString();
  const durationMs = Date.now() - new Date(currentIncident.startedAt).getTime();
  incidents.unshift({ ...currentIncident, resolvedAt, durationMs });
  if (incidents.length > MAX_INCIDENTS) incidents.length = MAX_INCIDENTS;
  logger.info({ incident: incidents[0] }, 'Uptime incident resolved');
  currentIncident = null;
}

// ── Health check ──────────────────────────────────────────────────────────────
function checkHealth() {
  const dbReady = mongoose.connection.readyState === 1;
  const redisConfigured = !!process.env.REDIS_URL;
  // Redis is optional; DB is the required dependency
  const redisUp = redisConfigured ? isRedisReady() : true;
  const up = dbReady;
  const trigger = !dbReady ? 'database' : !redisUp ? 'redis' : null;

  recordMinuteBucket(up);
  rollupToHourly();

  if (!up) {
    openIncident(trigger);
    const now = Date.now();
    if (!lastDownAlertAt || now - lastDownAlertAt > ALERT_COOLDOWN_MS) {
      lastDownAlertAt = now;
      sendDownAlert({ trigger, dbReady, redisUp }).catch((err) =>
        logger.error({ err }, 'Failed to send downtime alert')
      );
    }
  } else if (currentIncident) {
    closeIncident();
    sendUpAlert().catch((err) => logger.error({ err }, 'Failed to send recovery alert'));
  }
}

// ── SSL certificate expiry check ──────────────────────────────────────────────
function checkSslExpiry() {
  const hostname = process.env.PUBLIC_HOSTNAME;
  if (!hostname) return;

  const port = parseInt(process.env.PUBLIC_PORT || '443', 10);
  const socket = tls.connect({ host: hostname, port, servername: hostname }, () => {
    try {
      const cert = socket.getPeerCertificate();
      if (!cert || !cert.valid_to) {
        socket.destroy();
        return;
      }
      const expiresAt = new Date(cert.valid_to);
      const daysLeft = Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000);
      sslExpiry = { expiresAt: expiresAt.toISOString(), daysLeft, domain: hostname };
      logger.info({ sslExpiry }, 'SSL cert expiry checked');

      if (daysLeft <= SSL_WARN_DAYS && !sslAlertSent) {
        sslAlertSent = true;
        sendSslExpiryAlert(sslExpiry).catch((err) =>
          logger.error({ err }, 'Failed to send SSL expiry alert')
        );
      } else if (daysLeft > SSL_WARN_DAYS) {
        sslAlertSent = false; // Reset after cert is renewed
      }
    } finally {
      socket.destroy();
    }
  });

  socket.on('error', (err) => {
    logger.warn({ err: err.message, hostname }, 'SSL cert check failed');
    socket.destroy();
  });

  socket.setTimeout(10_000, () => {
    logger.warn({ hostname }, 'SSL cert check timed out');
    socket.destroy();
  });
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
    if (!res.ok) logger.warn({ status: res.status }, 'Slack webhook returned non-2xx');
  } catch (err) {
    logger.warn({ err }, 'Slack post failed');
  }
}

async function sendAlertEmail({ subject, body }) {
  const to = process.env.ALERT_EMAIL_TO;
  if (!to) return;
  const html = `<pre style="font-family:monospace;white-space:pre-wrap">${body}</pre>`;
  await sendEmail({ to, subject, html });
}

async function sendDownAlert({ trigger, dbReady, redisUp }) {
  const env = process.env.NODE_ENV || 'development';
  const uptime24h = calcUptime(24 * 60 * 60_000);
  const text = [
    `🔴 *EMS Service DOWN — ${env.toUpperCase()}*`,
    `Trigger: *${trigger}*`,
    `DB: ${dbReady ? '✅ connected' : '❌ disconnected'} | Redis: ${redisUp ? '✅ ready' : '❌ unavailable'}`,
    `24h uptime before incident: ${uptime24h}%`,
    `Incident started: ${currentIncident?.startedAt || new Date().toISOString()}`,
  ].join('\n');

  logger.error({ trigger, dbReady, redisUp }, 'Downtime alert sent');
  await Promise.allSettled([
    postToSlack(text),
    sendAlertEmail({ subject: `[ALERT] EMS Service Down (${env})`, body: text.replace(/\*/g, '') }),
  ]);
}

async function sendUpAlert() {
  const env = process.env.NODE_ENV || 'development';
  const incident = incidents[0];
  const durationMin = incident ? Math.round(incident.durationMs / 60_000) : 0;
  const text = [
    `✅ *EMS Service Recovered — ${env.toUpperCase()}*`,
    `Incident duration: ~${durationMin} minute(s)`,
    `Uptime (last 24h): ${calcUptime(24 * 60 * 60_000)}%`,
  ].join('\n');

  await Promise.allSettled([
    postToSlack(text),
    sendAlertEmail({
      subject: `[RESOLVED] EMS Service Recovered (${env})`,
      body: text.replace(/\*/g, ''),
    }),
  ]);
}

async function sendSslExpiryAlert({ domain, daysLeft, expiresAt }) {
  const env = process.env.NODE_ENV || 'development';
  const text = [
    `⚠️ *EMS SSL Certificate Expiring Soon — ${env.toUpperCase()}*`,
    `Domain: *${domain}*`,
    `Expires: *${expiresAt}* (${daysLeft} days remaining)`,
    `Action required: renew the certificate before it expires.`,
  ].join('\n');

  logger.warn({ domain, daysLeft, expiresAt }, 'SSL cert expiry warning');
  await Promise.allSettled([
    postToSlack(text),
    sendAlertEmail({
      subject: `[WARNING] SSL Certificate Expiring in ${daysLeft} days (${env})`,
      body: text.replace(/\*/g, ''),
    }),
  ]);
}

// ── Weekly SLA report ─────────────────────────────────────────────────────────
export async function sendWeeklySlaReport() {
  const to = process.env.ALERT_EMAIL_TO;
  if (!to) {
    logger.warn('ALERT_EMAIL_TO not set — skipping weekly SLA report');
    return;
  }

  const uptime7d = calcUptime(7 * 24 * 60 * 60_000);
  const uptime30d = calcUptime(30 * 24 * 60 * 60_000);
  const recentIncidents = incidents.slice(0, 10);

  // PERF-06: Include p99 SLA compliance data in weekly report
  const { getSlaViolations, SLA_P99_TARGET_MS } = await import('./apmService.js');
  const slaViolations = getSlaViolations();

  const incidentRows = recentIncidents
    .map((i) => {
      const dur = i.resolvedAt ? `${Math.round(i.durationMs / 60_000)}m` : 'ongoing';
      return `<tr><td>${i.startedAt}</td><td>${i.trigger || 'unknown'}</td><td>${dur}</td><td>${i.resolvedAt || 'ongoing'}</td></tr>`;
    })
    .join('');

  const slaViolationRows = slaViolations
    .slice(0, 10)
    .map(
      (v) =>
        `<tr><td><code>${v.endpoint}</code></td><td style="color:red">${v.p99}ms</td><td>${SLA_P99_TARGET_MS}ms</td><td>${v.count}</td></tr>`
    )
    .join('');

  const html = `
    <h2>EMS Weekly SLA Report</h2>
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
      <tr><th>Metric</th><th>Value</th></tr>
      <tr><td>7-day uptime</td><td>${uptime7d}%</td></tr>
      <tr><td>30-day uptime</td><td>${uptime30d}%</td></tr>
      <tr><td>Active incident</td><td>${currentIncident ? 'Yes (ongoing)' : 'None'}</td></tr>
      <tr><td>SSL expiry</td><td>${sslExpiry ? `${sslExpiry.daysLeft} days (${sslExpiry.domain})` : 'Not monitored'}</td></tr>
      <tr><td>p99 SLA target</td><td>${SLA_P99_TARGET_MS}ms</td></tr>
      <tr><td>Endpoints breaching p99 SLA</td><td${slaViolations.length > 0 ? ' style="color:red;font-weight:bold"' : ''}>${slaViolations.length}</td></tr>
    </table>
    ${
      slaViolations.length > 0
        ? `<h3>p99 SLA Breaches (top 10 worst offenders)</h3>
         <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
           <tr><th>Endpoint</th><th>p99</th><th>Target</th><th>Samples</th></tr>
           ${slaViolationRows}
         </table>`
        : '<p>✅ All endpoints are within the p99 SLA target.</p>'
    }
    ${
      recentIncidents.length > 0
        ? `<h3>Recent Incidents</h3>
         <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
           <tr><th>Started</th><th>Trigger</th><th>Duration</th><th>Resolved</th></tr>
           ${incidentRows}
         </table>`
        : '<p>No incidents recorded this period.</p>'
    }
    <p style="color:#888;font-size:12px">Generated by EMS OBS-06 Uptime Monitor</p>
  `;

  try {
    await sendEmail({ to, subject: 'EMS Weekly SLA Report', html });
    logger.info({ to, uptime7d, uptime30d }, 'Weekly SLA report sent');
  } catch (err) {
    logger.error({ err }, 'Failed to send weekly SLA report');
  }

  const slaStatus =
    slaViolations.length === 0
      ? '✅ All endpoints within p99 target'
      : `🔴 ${slaViolations.length} endpoint(s) breaching p99 ${SLA_P99_TARGET_MS}ms target`;
  const slackText = `📊 *EMS Weekly SLA* | 7d: ${uptime7d}% | 30d: ${uptime30d}% | Incidents: ${incidents.length} | p99: ${slaStatus}`;
  await postToSlack(slackText).catch(() => {});
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns current uptime stats for the public /api/status endpoint.
 */
export function getUptimeStats() {
  return {
    status: currentIncident ? 'outage' : 'operational',
    uptime: {
      last1h: calcUptime(60 * 60_000),
      last24h: calcUptime(24 * 60 * 60_000),
      last7d: calcUptime(7 * 24 * 60 * 60_000),
      last30d: calcUptime(30 * 24 * 60 * 60_000),
    },
    currentIncident: currentIncident || null,
    recentIncidents: incidents.slice(0, 10),
    ssl: sslExpiry,
    serverStartAt: new Date(serverStartAt).toISOString(),
    checkedAt: new Date().toISOString(),
  };
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

/**
 * Start the uptime monitor. Call once after DB connection is established.
 */
export function startUptimeMonitor() {
  if (monitorInterval) return;

  // First check after 5 s to allow DB to finish connecting
  setTimeout(() => {
    checkHealth();
    monitorInterval = setInterval(checkHealth, CHECK_INTERVAL_MS);
  }, 5_000);

  // SSL check — only if PUBLIC_HOSTNAME is configured
  if (process.env.PUBLIC_HOSTNAME) {
    setTimeout(() => {
      checkSslExpiry();
      sslInterval = setInterval(checkSslExpiry, SSL_CHECK_INTERVAL_MS);
    }, 15_000);
  }

  logger.info('Uptime monitor started (OBS-06)');
}

/**
 * Stop the monitoring loop (graceful shutdown / tests).
 */
export function stopUptimeMonitor() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
  if (sslInterval) {
    clearInterval(sslInterval);
    sslInterval = null;
  }
}
