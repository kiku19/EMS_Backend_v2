/**
 * PERF-03: Load test – 50 schools × 2000 students database query performance
 *
 * Seeds 50 schools × 2000 students (100 000 total) directly via MongoDB
 * insertMany (bypassing Mongoose middleware for speed) and benchmarks the key
 * query patterns exercised by the students API.
 *
 * Run in isolation to avoid interfering with other test suites:
 *   npx vitest run tests/perf.load.test.js
 */

import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { Class, School, Student } from '../database.js';

// ── Dataset constants ────────────────────────────────────────────────────────
const SCHOOLS = 50;
const STUDENTS_PER_SCHOOL = 2000;
const CLASSES_PER_SCHOOL = 10; // 200 students per class
const ACADEMIC_YEAR = '2025-26';
const BENCH_ITERATIONS = 10;
const INSERT_BATCH_SIZE = 5000;

// ── P95 thresholds (ms) — tuned for MongoDB Memory Server ───────────────────
// Real MongoDB on a network will be faster per-query but has latency overhead;
// these values give a reasonable safety net in CI without being too tight.
// Relaxed slightly to account for CPU contention when the full suite runs in
// parallel workers against a shared in-memory MongoDB instance.
const P95_THRESHOLDS_MS = {
  list_paginated: 800, // find + sort + skip/limit (50 docs)
  filter_by_class: 300, // find by classId (≈200 docs)
  filter_by_status: 300, // find active students (≈1700 docs)
  count_by_school: 250, // countDocuments
  get_by_id: 200, // findById (single doc)
  search_by_name: 700, // regex on name field
  compound_filter: 700, // school + class + status
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Run `fn` `n` times and return timing statistics (ms). */
async function benchmark(fn, n = BENCH_ITERATIONS) {
  const times = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return {
    min: times[0],
    avg: times.reduce((s, t) => s + t, 0) / n,
    p50: times[Math.floor(n * 0.5)],
    p95: times[Math.min(Math.ceil(n * 0.95), n - 1)],
    max: times[n - 1],
  };
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Test ─────────────────────────────────────────────────────────────────────

describe('PERF-03: 50 schools × 2000 students load test', () => {
  it(
    'seeds dataset and benchmarks key query patterns',
    { timeout: 300_000 }, // 5 min — seeding 100 k docs can take time in CI
    async () => {
      // ── PHASE 1: SEED ───────────────────────────────────────────────────
      const seedStart = performance.now();

      // Schools
      const schoolDocs = Array.from({ length: SCHOOLS }, (_, i) => ({
        _id: new mongoose.Types.ObjectId(),
        name: `Perf School ${i + 1}`,
        code: `PERF-${String(i + 1).padStart(3, '0')}`,
        status: 'active',
        isDefault: false,
      }));
      await School.collection.insertMany(schoolDocs, { ordered: false });

      // Classes (10 per school)
      const classDocs = [];
      for (const school of schoolDocs) {
        for (let c = 0; c < CLASSES_PER_SCHOOL; c++) {
          classDocs.push({
            _id: new mongoose.Types.ObjectId(),
            schoolId: school._id,
            name: `Grade ${c + 1}`,
            section: 'A',
            academicYear: ACADEMIC_YEAR,
            subjects: ['Math', 'Science'],
          });
        }
      }
      await Class.collection.insertMany(classDocs, { ordered: false });

      // Build schoolId → classIds map
      const classMap = new Map();
      for (const cls of classDocs) {
        const sid = cls.schoolId.toString();
        if (!classMap.has(sid)) classMap.set(sid, []);
        classMap.get(sid).push(cls._id);
      }

      // Students — inserted in batches to keep memory reasonable
      const STATUSES = ['active', 'inactive', 'transferred'];
      const FEE_STATUSES = ['pending', 'partial', 'paid', 'overdue'];

      let batch = [];
      let globalIdx = 0;

      // Capture refs for targeted queries (school[0])
      const targetSchoolId = schoolDocs[0]._id;
      let targetStudentId = null;
      let targetClassId = null;

      for (const school of schoolDocs) {
        const classIds = classMap.get(school._id.toString());

        for (let s = 0; s < STUDENTS_PER_SCHOOL; s++) {
          globalIdx++;
          const classId = classIds[s % CLASSES_PER_SCHOOL];
          const studentId = new mongoose.Types.ObjectId();

          if (school._id.equals(targetSchoolId) && s === 0) {
            targetStudentId = studentId;
            targetClassId = classId;
          }

          batch.push({
            _id: studentId,
            schoolId: school._id,
            classId,
            name: `Student ${globalIdx}`,
            admissionId: `ADM${String(globalIdx).padStart(6, '0')}`,
            academicYear: ACADEMIC_YEAR,
            rollNo: s + 1,
            // 85% active, 15% other statuses — mirrors realistic distributions
            status: s < STUDENTS_PER_SCHOOL * 0.85 ? 'active' : pick(STATUSES),
            feeStatus: pick(FEE_STATUSES),
            isDeleted: false,
            parents: [
              {
                name: `Parent ${globalIdx}`,
                relationship: 'father',
                phone: `9${String(globalIdx).padStart(9, '0')}`,
                isWhatsapp: true,
              },
            ],
            dateOfBirth: '2010-05-15',
          });

          if (batch.length >= INSERT_BATCH_SIZE) {
            await Student.collection.insertMany(batch, { ordered: false });
            batch = [];
          }
        }
      }

      if (batch.length > 0) {
        await Student.collection.insertMany(batch, { ordered: false });
      }

      const seedMs = performance.now() - seedStart;
      const total = SCHOOLS * STUDENTS_PER_SCHOOL;
      console.log(
        `\n  Seeded: ${SCHOOLS} schools × ${STUDENTS_PER_SCHOOL} students` +
          ` = ${total.toLocaleString()} documents in ${seedMs.toFixed(0)} ms`
      );

      // Sanity-check total
      const actualCount = await Student.countDocuments();
      expect(actualCount).toBe(total);

      // Ensure indexes are fully built before benchmarking (perf-03: list_paginated
      // relies on the schoolId + isDeleted + name compound index).
      // syncIndexes() is required because the test connection uses autoIndex: false.
      await Student.syncIndexes();

      // ── PHASE 2: BENCHMARK ──────────────────────────────────────────────
      const results = {};

      // Q1 – Paginated list for one school (most frequent API call)
      results.list_paginated = await benchmark(() =>
        Student.find({ schoolId: targetSchoolId, isDeleted: false })
          .sort({ name: 1 })
          .skip(0)
          .limit(50)
          .lean()
      );

      // Q2 – Filter by class within a school
      results.filter_by_class = await benchmark(() =>
        Student.find({
          schoolId: targetSchoolId,
          classId: targetClassId,
          isDeleted: false,
        }).lean()
      );

      // Q3 – Filter active students in a school
      results.filter_by_status = await benchmark(() =>
        Student.find({
          schoolId: targetSchoolId,
          status: 'active',
          isDeleted: false,
        })
          .limit(200)
          .lean()
      );

      // Q4 – Count documents for a school
      results.count_by_school = await benchmark(() =>
        Student.countDocuments({ schoolId: targetSchoolId, isDeleted: false })
      );

      // Q5 – Single document lookup by _id
      results.get_by_id = await benchmark(() => Student.findById(targetStudentId).lean());

      // Q6 – Regex name search (common in list search bar)
      results.search_by_name = await benchmark(() =>
        Student.find({
          schoolId: targetSchoolId,
          isDeleted: false,
          name: { $regex: 'Student 1', $options: 'i' },
        })
          .limit(50)
          .lean()
      );

      // Q7 – Compound filter: school + class + status
      results.compound_filter = await benchmark(() =>
        Student.find({
          schoolId: targetSchoolId,
          classId: targetClassId,
          status: 'active',
          isDeleted: false,
        })
          .sort({ name: 1 })
          .lean()
      );

      // ── PHASE 3: REPORT ─────────────────────────────────────────────────
      const cols = ['min', 'avg', 'p50', 'p95', 'max'];
      const sep = '-'.repeat(74);
      console.log(`\n  Query Performance Report (ms, ${BENCH_ITERATIONS} iterations each):`);
      console.log(`  ${sep}`);
      console.log(
        `  ${'Query'.padEnd(22)} | ${'min'.padStart(6)} | ${'avg'.padStart(6)} | ${'p50'.padStart(6)} | ${'p95'.padStart(6)} | ${'max'.padStart(6)} | threshold`
      );
      console.log(`  ${sep}`);

      for (const [name, stats] of Object.entries(results)) {
        const threshold = P95_THRESHOLDS_MS[name];
        const over = stats.p95 > threshold ? ' ← OVER' : '';
        const row = cols.map((c) => stats[c].toFixed(1).padStart(6)).join(' | ');
        console.log(`  ${name.padEnd(22)} | ${row} | ${threshold} ms${over}`);
      }
      console.log(`  ${sep}\n`);

      // ── PHASE 4: ASSERT P95 THRESHOLDS ─────────────────────────────────
      for (const [queryName, threshold] of Object.entries(P95_THRESHOLDS_MS)) {
        const stats = results[queryName];
        if (!stats) continue;
        expect(
          stats.p95,
          `"${queryName}" P95 ${stats.p95.toFixed(1)} ms exceeds threshold of ${threshold} ms`
        ).toBeLessThanOrEqual(threshold);
      }
    }
  );
});
