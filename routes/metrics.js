/**
 * OBS-04: Prometheus Metrics Endpoint
 *
 * GET /api/metrics
 *
 * Exposes key EMS metrics in Prometheus text exposition format so they
 * can be scraped by a Prometheus server and visualized in Grafana.
 *
 * No external dependency — outputs the plain text format directly.
 * https://prometheus.io/docs/instrumenting/exposition_formats/
 *
 * Metrics exposed:
 *   ems_http_requests_total        — request count per endpoint/method/status class
 *   ems_http_duration_p50_ms       — p50 latency per endpoint/method
 *   ems_http_duration_p95_ms       — p95 latency per endpoint/method
 *   ems_http_duration_p99_ms       — p99 latency per endpoint/method
 *   ems_http_slow_requests_total   — slow requests (>2s) per endpoint/method
 *   ems_http_errors_total          — 5xx count per endpoint/method
 *   ems_error_rate_current         — 5-min rolling error rate (ratio)
 *   ems_slow_queries_total         — slow DB queries in the last hour
 *   ems_uptime_seconds             — process uptime
 *   ems_memory_heap_used_bytes     — Node.js heap used
 *   ems_memory_rss_bytes           — Resident set size
 *   ems_cpu_user_seconds_total     — CPU user time
 *   ems_cpu_system_seconds_total   — CPU system time
 *
 * Protect this endpoint if needed with OPS_METRICS_SECRET env var.
 */

import express from 'express';
import { getApmStats, SLA_P99_TARGET_MS } from '../services/apmService.js';
import { getErrorRateStats } from '../services/errorRateMonitor.js';
import { getSlowQueryStats } from '../services/slowQueryMonitor.js';

const router = express.Router();

function label(key, value) {
  // Escape label values per Prometheus spec
  return `${key}="${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function labels(...pairs) {
  if (pairs.length === 0) return '';
  return `{${pairs.map(([k, v]) => label(k, v)).join(',')}}`;
}

function line(name, labelsStr, value, help, type) {
  const lines = [];
  if (help) lines.push(`# HELP ${name} ${help}`);
  if (type) lines.push(`# TYPE ${name} ${type}`);
  lines.push(`${name}${labelsStr} ${value}`);
  return lines.join('\n');
}

/**
 * GET /api/metrics
 * Returns Prometheus text format metrics.
 */
router.get('/', (req, res) => {
  // Optional secret protection
  const secret = process.env.OPS_METRICS_SECRET;
  if (secret && req.headers['x-ops-secret'] !== secret) {
    return res.status(401).type('text/plain').send(req.t('common:errors.unauthorized'));
  }

  try {
    const apm = getApmStats();
    const errorRate = getErrorRateStats();
    const slowQuery = getSlowQueryStats();
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    const uptimeSec = process.uptime();

    const output = [];

    // ── HTTP latency percentiles and counts ───────────────────────────────────
    output.push('# HELP ems_http_requests_total Total HTTP requests handled');
    output.push('# TYPE ems_http_requests_total counter');
    output.push('# HELP ems_http_errors_total Total 5xx responses');
    output.push('# TYPE ems_http_errors_total counter');
    output.push('# HELP ems_http_slow_requests_total Requests exceeding the slow threshold (>2s)');
    output.push('# TYPE ems_http_slow_requests_total counter');
    output.push('# HELP ems_http_duration_p50_ms p50 response time per endpoint (ms)');
    output.push('# TYPE ems_http_duration_p50_ms gauge');
    output.push('# HELP ems_http_duration_p95_ms p95 response time per endpoint (ms)');
    output.push('# TYPE ems_http_duration_p95_ms gauge');
    output.push('# HELP ems_http_duration_p99_ms p99 response time per endpoint (ms)');
    output.push('# TYPE ems_http_duration_p99_ms gauge');

    for (const ep of apm.endpoints) {
      // Split "METHOD /path" → method + path labels
      const spaceIdx = ep.endpoint.indexOf(' ');
      const method = spaceIdx >= 0 ? ep.endpoint.slice(0, spaceIdx) : ep.endpoint;
      const path = spaceIdx >= 0 ? ep.endpoint.slice(spaceIdx + 1) : '/';
      const lbl = labels(['method', method], ['endpoint', path]);

      output.push(`ems_http_requests_total${lbl} ${ep.count}`);
      output.push(`ems_http_errors_total${lbl} ${ep.errors}`);
      output.push(`ems_http_slow_requests_total${lbl} ${ep.slowCount}`);
      output.push(`ems_http_duration_p50_ms${lbl} ${ep.p50}`);
      output.push(`ems_http_duration_p95_ms${lbl} ${ep.p95}`);
      output.push(`ems_http_duration_p99_ms${lbl} ${ep.p99}`);
    }

    // ── SLA compliance (PERF-06) ──────────────────────────────────────────────
    output.push('');
    output.push(
      '# HELP ems_http_sla_p99_target_ms SLA target for p99 response time in milliseconds'
    );
    output.push('# TYPE ems_http_sla_p99_target_ms gauge');
    output.push(`ems_http_sla_p99_target_ms ${SLA_P99_TARGET_MS}`);

    output.push(
      '# HELP ems_http_p99_sla_breach 1 if endpoint p99 latency exceeds the SLA target, 0 if compliant'
    );
    output.push('# TYPE ems_http_p99_sla_breach gauge');
    for (const ep of apm.endpoints) {
      const spaceIdx = ep.endpoint.indexOf(' ');
      const method = spaceIdx >= 0 ? ep.endpoint.slice(0, spaceIdx) : ep.endpoint;
      const path = spaceIdx >= 0 ? ep.endpoint.slice(spaceIdx + 1) : '/';
      const lbl = labels(['method', method], ['endpoint', path]);
      output.push(`ems_http_p99_sla_breach${lbl} ${ep.slaBreach ? 1 : 0}`);
    }

    // ── Error rate ────────────────────────────────────────────────────────────
    output.push('');
    output.push('# HELP ems_error_rate_current 5-minute rolling error rate (0–1)');
    output.push('# TYPE ems_error_rate_current gauge');
    output.push(`ems_error_rate_current ${errorRate.spike.rate.toFixed(6)}`);

    output.push('# HELP ems_error_rate_baseline 1-hour baseline error rate (0–1)');
    output.push('# TYPE ems_error_rate_baseline gauge');
    output.push(`ems_error_rate_baseline ${errorRate.baseline.rate.toFixed(6)}`);

    // ── Slow queries ──────────────────────────────────────────────────────────
    output.push('');
    output.push(
      '# HELP ems_slow_queries_last_hour Slow MongoDB queries (above threshold) in the last hour'
    );
    output.push('# TYPE ems_slow_queries_last_hour gauge');
    output.push(`ems_slow_queries_last_hour ${slowQuery.lastHour.count}`);

    output.push('# HELP ems_slow_queries_last_5m Slow MongoDB queries in the last 5 minutes');
    output.push('# TYPE ems_slow_queries_last_5m gauge');
    output.push(`ems_slow_queries_last_5m ${slowQuery.last5Minutes.count}`);

    // ── Process / system ──────────────────────────────────────────────────────
    output.push('');
    output.push('# HELP ems_uptime_seconds Process uptime in seconds');
    output.push('# TYPE ems_uptime_seconds counter');
    output.push(`ems_uptime_seconds ${uptimeSec.toFixed(3)}`);

    output.push('# HELP ems_memory_heap_used_bytes Node.js V8 heap used');
    output.push('# TYPE ems_memory_heap_used_bytes gauge');
    output.push(`ems_memory_heap_used_bytes ${mem.heapUsed}`);

    output.push('# HELP ems_memory_heap_total_bytes Node.js V8 heap total allocated');
    output.push('# TYPE ems_memory_heap_total_bytes gauge');
    output.push(`ems_memory_heap_total_bytes ${mem.heapTotal}`);

    output.push('# HELP ems_memory_rss_bytes Resident set size (total process memory)');
    output.push('# TYPE ems_memory_rss_bytes gauge');
    output.push(`ems_memory_rss_bytes ${mem.rss}`);

    output.push('# HELP ems_memory_external_bytes V8 external memory (Buffers)');
    output.push('# TYPE ems_memory_external_bytes gauge');
    output.push(`ems_memory_external_bytes ${mem.external}`);

    // cpu.user / cpu.system are in microseconds — convert to seconds
    output.push('# HELP ems_cpu_user_seconds_total Total CPU time spent in user mode');
    output.push('# TYPE ems_cpu_user_seconds_total counter');
    output.push(`ems_cpu_user_seconds_total ${(cpu.user / 1e6).toFixed(6)}`);

    output.push('# HELP ems_cpu_system_seconds_total Total CPU time spent in system/kernel mode');
    output.push('# TYPE ems_cpu_system_seconds_total counter');
    output.push(`ems_cpu_system_seconds_total ${(cpu.system / 1e6).toFixed(6)}`);

    // Final newline required by Prometheus spec
    output.push('');

    res.type('text/plain; version=0.0.4; charset=utf-8').send(output.join('\n'));
  } catch (err) {
    res.status(500).type('text/plain').send(`# ERROR: ${err.message}\n`);
  }
});

export default router;
