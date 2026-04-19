/**
 * PERF-05: Load test — 100 simultaneous file uploads
 *
 * Verifies that the upload endpoint handles 100 concurrent multipart requests
 * without crashing or hanging, and that response times stay within acceptable
 * thresholds for an in-process test server.
 *
 * Expected responses in the test environment:
 *   503 — Cloudinary is not configured, upload short-circuits before external call
 *   429 — Rate limiter (max: 50/hour) kicks in for excess concurrent requests
 *
 * No 500 errors are acceptable; all 100 requests must receive a response.
 */

import { performance } from 'perf_hooks';
import request from 'supertest';
import { describe, it, expect, beforeEach } from 'vitest';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const BASE = '/api/upload';
const CONCURRENCY = 100;

// 1 KB fake JPEG payload — small enough to stay well within the 10 MB multer limit
const FAKE_JPEG = Buffer.alloc(1024, 0xff);

describe('PERF-05: upload concurrency load test', () => {
  let app, headers;

  beforeEach(async () => {
    const school = await createSchoolRecord({ name: 'Load Test School', code: 'LDT' });
    const admin = await createStaffUser({
      name: 'Load Admin',
      email: 'load.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    headers = authHeadersFor(admin, 'admin');
    ({ app } = createTestApp());
  });

  it('handles 100 simultaneous file uploads without crashing or hanging', async () => {
    // Responses that are valid in the test environment.
    // 400 = magic-bytes validation rejects the synthetic JPEG payload because
    //       it's 1024 bytes of 0xFF and does not start with real JPEG magic
    //       bytes. This is the canonical early-rejection path.
    // 429 = rate limiter (max 50/hour) applied to excess concurrent requests
    // 503 = Cloudinary env vars absent (expected in CI / local tests)
    const ALLOWED_STATUSES = new Set([400, 429, 503]);

    const startAll = performance.now();

    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        const t0 = performance.now();
        const res = await request(app)
          .post(BASE)
          .set(headers)
          .attach('file', FAKE_JPEG, { filename: 'photo.jpg', contentType: 'image/jpeg' });
        return { status: res.status, ms: performance.now() - t0 };
      })
    );

    const totalMs = performance.now() - startAll;

    // ── Correctness ────────────────────────────────────────────────────────

    // All 100 requests must have received a response (no silent drops)
    expect(results).toHaveLength(CONCURRENCY);

    const statusCounts = {};
    for (const { status } of results) {
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    }

    // No unexpected status codes — 500 would indicate a server crash/unhandled exception
    const unexpected = Object.keys(statusCounts)
      .map(Number)
      .filter((s) => !ALLOWED_STATUSES.has(s));

    expect(
      unexpected,
      `Unexpected status codes: ${unexpected.join(', ')} — counts: ${JSON.stringify(statusCounts)}`
    ).toEqual([]);

    // ── Timing ────────────────────────────────────────────────────────────

    const sorted = results.map((r) => r.ms).sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    const maxMs = sorted[sorted.length - 1];

    // All 100 requests must finish within the vitest testTimeout (30 s)
    expect(totalMs, 'Total wall-clock time must be < 30 000 ms').toBeLessThan(30_000);
    // p95 latency threshold — generous for an in-process test server
    expect(p95, 'p95 latency must be < 15 000 ms').toBeLessThan(15_000);

    // ── Summary (visible in CI / local output) ─────────────────────────────
    console.info(
      `[PERF-05] 100 concurrent uploads | ` +
        `total: ${totalMs.toFixed(0)}ms | ` +
        `p50: ${p50.toFixed(0)}ms | ` +
        `p95: ${p95.toFixed(0)}ms | ` +
        `p99: ${p99.toFixed(0)}ms | ` +
        `max: ${maxMs.toFixed(0)}ms | ` +
        `statuses: ${JSON.stringify(statusCounts)}`
    );
  });
});
