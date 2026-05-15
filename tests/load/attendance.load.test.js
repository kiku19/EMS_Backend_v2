/**
 * PERF-02: Load test — 500 concurrent attendance submissions at peak hour
 *
 * Simulates the peak-hour scenario where many teachers submit class attendance
 * simultaneously (e.g., 9 am roll call). Tests two realistic request patterns:
 *
 * Scenario A — 500 concurrent single-record submissions (POST /api/attendance)
 *   One record per student, all fired at once.
 *
 * Scenario B — 50 concurrent bulk submissions × 10 students (POST /api/attendance/bulk)
 *   50 teachers each submitting their class roster simultaneously (500 total records).
 *
 * Thresholds (in-process / mongodb-memory-server):
 *   - Error rate  : 0 %
 *   - P95 latency : < 2 000 ms
 *   - P99 latency : < 4 000 ms
 */

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
} from '../helpers/factories.js';
import { createTestApp } from '../helpers/testApp.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sortedLatencies(latencies) {
  return [...latencies].sort((a, b) => a - b);
}

function percentile(sorted, p) {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function reportMetrics(label, latencies, totalMs) {
  const sorted = sortedLatencies(latencies);
  const avg = latencies.reduce((s, v) => s + v, 0) / latencies.length;

  console.log(`\n  ┌─ ${label}`);
  console.log(`  │  Requests : ${latencies.length}`);
  console.log(`  │  Wall time: ${totalMs.toFixed(0)} ms (total concurrent run)`);
  console.log(`  │  Throughput: ${((latencies.length / totalMs) * 1000).toFixed(1)} req/s`);
  console.log(`  │  Min      : ${sorted[0].toFixed(1)} ms`);
  console.log(`  │  Avg      : ${avg.toFixed(1)} ms`);
  console.log(`  │  P50      : ${percentile(sorted, 50).toFixed(1)} ms`);
  console.log(`  │  P95      : ${percentile(sorted, 95).toFixed(1)} ms`);
  console.log(`  │  P99      : ${percentile(sorted, 99).toFixed(1)} ms`);
  console.log(`  └─ Max      : ${sorted[sorted.length - 1].toFixed(1)} ms`);
}

// ---------------------------------------------------------------------------
// Scenario A — 500 concurrent single-record submissions
// ---------------------------------------------------------------------------

describe('PERF-02: 500 concurrent attendance submissions at peak hour', () => {
  it('Scenario A — 500 concurrent POST /api/attendance: zero errors, P95 < 2000 ms', async () => {
    const CONCURRENT = 500;

    const teacher = await createStaffUser({
      name: 'Load Teacher A',
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });
    const classRecord = await createClassRecord({
      classTeacherId: teacher._id,
      name: 'Load Class A',
      section: 'A',
    });

    // Create all 500 students up-front in parallel
    const students = await Promise.all(
      Array.from({ length: CONCURRENT }, (_, i) =>
        createStudentRecord({
          name: `Load Student A-${i + 1}`,
          rollNo: i + 1,
          classId: classRecord._id,
          parents: [{ name: 'Parent', relationship: 'Parent', phone: `8${String(i).padStart(9, '0')}`, isWhatsapp: true }],
        })
      )
    );

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(teacher, 'teacher');
    const date = '2026-03-01';

    // ── Fire all 500 requests concurrently ──────────────────────────────
    const latencies = [];
    const wallStart = performance.now();

    const results = await Promise.all(
      students.map(async (student) => {
        const t0 = performance.now();
        const res = await request(app).post('/api/attendance').set(authHeaders).send({
          studentId: student._id.toString(),
          classId: classRecord._id.toString(),
          date,
          status: 'present',
        });
        latencies.push(performance.now() - t0);
        return res;
      })
    );

    const totalMs = performance.now() - wallStart;

    reportMetrics('500 concurrent single-record submissions', latencies, totalMs);

    // ── Assertions ───────────────────────────────────────────────────────
    const errors = results.filter((r) => r.status !== 200);
    const sorted = sortedLatencies(latencies);
    const p95 = percentile(sorted, 95);
    const p99 = percentile(sorted, 99);

    expect(errors.length, `${errors.length} requests failed`).toBe(0);
    expect(p95, `P95 latency ${p95.toFixed(0)} ms exceeded 2000 ms`).toBeLessThan(2000);
    expect(p99, `P99 latency ${p99.toFixed(0)} ms exceeded 4000 ms`).toBeLessThan(4000);
  }, 90_000);

  // ---------------------------------------------------------------------------
  // Scenario B — 50 concurrent bulk submissions (10 students each = 500 total)
  // ---------------------------------------------------------------------------

  it('Scenario B — 50 concurrent POST /api/attendance/bulk (10 students each): zero errors, P95 < 2000 ms', async () => {
    const BULK_REQUESTS = 50;
    const STUDENTS_PER_CLASS = 10;

    // Create the school first to avoid a race condition when 50 createStaffUser
    // calls fire in parallel — each would otherwise try to insert the default school.
    const school = await createSchoolRecord({ name: 'Load School B', code: 'LOAD-SCH-B' });

    // Create 50 teachers + 50 classes in parallel (school is already created)
    const teachers = await Promise.all(
      Array.from({ length: BULK_REQUESTS }, (_, i) =>
        createStaffUser({
          name: `Load Teacher B-${i + 1}`,
          staffRole: ['Teacher'],
          permissionRole: 'teacher',
          schoolId: school._id,
        })
      )
    );

    const classes = await Promise.all(
      teachers.map((teacher, i) =>
        createClassRecord({
          classTeacherId: teacher._id,
          name: `Load Class B-${i + 1}`,
          section: 'A',
          schoolId: school._id,
        })
      )
    );

    // Create 10 students per class in parallel
    const studentGroups = await Promise.all(
      classes.map((cls, classIdx) =>
        Promise.all(
          Array.from({ length: STUDENTS_PER_CLASS }, (_, studentIdx) =>
            createStudentRecord({
              name: `Load Student B-${classIdx * STUDENTS_PER_CLASS + studentIdx + 1}`,
              rollNo: studentIdx + 1,
              classId: cls._id,
              schoolId: school._id,
              parents: [{ name: 'Parent', relationship: 'Parent', phone: `7${String(classIdx * 100 + studentIdx).padStart(9, '0')}`, isWhatsapp: true }],
            })
          )
        )
      )
    );

    const { app } = createTestApp();
    const date = '2026-03-02';

    // ── Fire all 50 bulk requests concurrently ───────────────────────────
    const latencies = [];
    const wallStart = performance.now();

    const results = await Promise.all(
      classes.map(async (cls, i) => {
        const authHeaders = authHeadersFor(teachers[i], 'teacher');
        const attendance = studentGroups[i].map((student) => ({
          studentId: student._id.toString(),
          status: 'present',
        }));

        const t0 = performance.now();
        const res = await request(app)
          .post('/api/attendance/bulk')
          .set(authHeaders)
          .send({ classId: cls._id.toString(), date, attendance });
        latencies.push(performance.now() - t0);
        return res;
      })
    );

    const totalMs = performance.now() - wallStart;

    reportMetrics(
      `${BULK_REQUESTS} concurrent bulk submissions (${STUDENTS_PER_CLASS} students each)`,
      latencies,
      totalMs
    );

    // ── Assertions ───────────────────────────────────────────────────────
    const errors = results.filter((r) => r.status !== 200);
    const sorted = sortedLatencies(latencies);
    const p95 = percentile(sorted, 95);
    const p99 = percentile(sorted, 99);

    expect(errors.length, `${errors.length} bulk requests failed`).toBe(0);
    expect(p95, `P95 latency ${p95.toFixed(0)} ms exceeded 2000 ms`).toBeLessThan(2000);
    expect(p99, `P99 latency ${p99.toFixed(0)} ms exceeded 4000 ms`).toBeLessThan(4000);

    // Each bulk result should confirm 10 records saved
    results.forEach((res, i) => {
      expect(res.body.results, `Class ${i + 1} should save 10 records`).toHaveLength(
        STUDENTS_PER_CLASS
      );
    });
  }, 90_000);

  // ---------------------------------------------------------------------------
  // Scenario C — Concurrent re-submissions (upsert under load)
  // Tests the most common race condition: teachers re-submitting corrections
  // ---------------------------------------------------------------------------

  it('Scenario C — 200 concurrent re-submissions (upsert correctness under load): no duplicates', async () => {
    const CONCURRENT = 200;

    const teacher = await createStaffUser({
      name: 'Load Teacher C',
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });
    const classRecord = await createClassRecord({
      classTeacherId: teacher._id,
      name: 'Load Class C',
      section: 'A',
    });

    const students = await Promise.all(
      Array.from({ length: CONCURRENT }, (_, i) =>
        createStudentRecord({
          name: `Load Student C-${i + 1}`,
          rollNo: i + 1,
          classId: classRecord._id,
          parents: [{ name: 'Parent', relationship: 'Parent', phone: `6${String(i).padStart(9, '0')}`, isWhatsapp: true }],
        })
      )
    );

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(teacher, 'teacher');
    const date = '2026-03-03';

    // First wave: mark all present
    await Promise.all(
      students.map((student) =>
        request(app).post('/api/attendance').set(authHeaders).send({
          studentId: student._id.toString(),
          classId: classRecord._id.toString(),
          date,
          status: 'present',
        })
      )
    );

    // Second wave: re-submit corrections (absent for half, late for rest)
    const latencies = [];
    const wallStart = performance.now();

    const results = await Promise.all(
      students.map(async (student, i) => {
        const correctedStatus = i % 2 === 0 ? 'absent' : 'late';
        const t0 = performance.now();
        const res = await request(app).post('/api/attendance').set(authHeaders).send({
          studentId: student._id.toString(),
          classId: classRecord._id.toString(),
          date,
          status: correctedStatus,
        });
        latencies.push(performance.now() - t0);
        return { res, studentId: student._id.toString(), expected: correctedStatus };
      })
    );

    const totalMs = performance.now() - wallStart;

    reportMetrics('200 concurrent re-submissions (upsert wave)', latencies, totalMs);

    // ── Assertions ───────────────────────────────────────────────────────
    const errors = results.filter(({ res }) => res.status !== 200);
    expect(errors.length, `${errors.length} re-submissions failed`).toBe(0);

    // Verify each record was updated to the corrected status (no stale data)
    results.forEach(({ res, expected }) => {
      expect(res.body.status).toBe(expected);
    });
  }, 90_000);
});
