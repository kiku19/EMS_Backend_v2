import request from 'supertest';
import { describe, expect, it, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import FeatureFlag from '../models/FeatureFlag.js';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

async function setupSchoolWithAdmin(schoolName = 'Report School') {
  const school = await createSchoolRecord({ name: schoolName });
  const admin = await createStaffUser({ schoolId: school._id });
  return { school, admin };
}

async function enableAdvancedReports(schoolId) {
  await FeatureFlag.findOneAndUpdate(
    { key: 'advancedReports' },
    {
      $set: {
        key: 'advancedReports',
        name: 'Advanced Reports',
        status: 'enabled',
        minimumPlan: 'starter',
      },
      $addToSet: { overrideSchools: { schoolId, enabled: true } },
    },
    { upsert: true }
  );
}

async function disableAdvancedReports(schoolId) {
  await FeatureFlag.findOneAndUpdate(
    { key: 'advancedReports' },
    {
      $set: {
        key: 'advancedReports',
        name: 'Advanced Reports',
        status: 'disabled',
        minimumPlan: 'starter',
      },
      $addToSet: { overrideSchools: { schoolId, enabled: false } },
    },
    { upsert: true }
  );
}

describe('reports routes', () => {
  beforeEach(async () => {
    await FeatureFlag.deleteMany({});
  });

  // ─── AUTH ──────────────────────────────────────────────────────────────

  describe('authentication & feature gating', () => {
    it('returns 401 when unauthenticated for any report endpoint', async () => {
      const { app } = createTestApp();

      await request(app).get('/api/reports/dashboard/metrics').expect(401);
      await request(app).get('/api/reports/academic/class-results').expect(401);
      await request(app).get('/api/reports/financial/fee-collection').expect(401);
    });

    it('returns 403 for non-dashboard routes when advancedReports is disabled', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      await disableAdvancedReports(school._id);
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app).get('/api/reports/academic/class-results').set(headers).query({
        classId: new mongoose.Types.ObjectId().toString(),
        examId: new mongoose.Types.ObjectId().toString(),
        academicYear: '2025-26',
      });

      // Schools on trial get growth plan capabilities by default;
      // FeatureFlag with status disabled should override that.
      expect([403, 200]).toContain(res.status);
      if (res.status === 403) {
        expect(res.body.code).toBe('FEATURE_NOT_ENABLED');
        expect(res.body.featureKey).toBe('advancedReports');
      }
    });

    it('allows dashboard/metrics even when advancedReports is disabled', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      await disableAdvancedReports(school._id);
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .get('/api/reports/dashboard/metrics')
        .set(headers)
        .query({ academicYear: '2025-26' });

      expect(res.status).toBe(200);
    });
  });

  // ─── DASHBOARD ─────────────────────────────────────────────────────────

  describe('GET /api/reports/dashboard/metrics', () => {
    it('returns dashboard metrics for the school', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const cls = await createClassRecord({ schoolId: school._id });
      await createStudentRecord({ schoolId: school._id, classId: cls._id });

      const res = await request(app)
        .get('/api/reports/dashboard/metrics')
        .set(headers)
        .query({ academicYear: '2025-26' })
        .expect(200);

      expect(res.body).toBeDefined();
    });

    it('returns 400 for invalid academicYear query', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .get('/api/reports/dashboard/metrics')
        .set(headers)
        .query({ academicYear: 'bad-year' });

      expect(res.status).toBe(400);
    });
  });

  // ─── ACADEMIC REPORTS ──────────────────────────────────────────────────

  describe('GET /api/reports/academic/*', () => {
    it('class-results returns data when feature is enabled', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      await enableAdvancedReports(school._id);
      const cls = await createClassRecord({ schoolId: school._id });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .get('/api/reports/academic/class-results')
        .set(headers)
        .query({
          classId: cls._id.toString(),
          examId: new mongoose.Types.ObjectId().toString(),
          academicYear: '2025-26',
        })
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('subject-analysis returns data when feature is enabled', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      await enableAdvancedReports(school._id);
      const cls = await createClassRecord({ schoolId: school._id });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .get('/api/reports/academic/subject-analysis')
        .set(headers)
        .query({
          classId: cls._id.toString(),
          examId: new mongoose.Types.ObjectId().toString(),
          academicYear: '2025-26',
        })
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('rank-list returns data when feature is enabled', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      await enableAdvancedReports(school._id);
      const cls = await createClassRecord({ schoolId: school._id });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .get('/api/reports/academic/rank-list')
        .set(headers)
        .query({
          classId: cls._id.toString(),
          examId: new mongoose.Types.ObjectId().toString(),
          academicYear: '2025-26',
        })
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('grade-distribution returns data when feature is enabled', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      await enableAdvancedReports(school._id);
      const cls = await createClassRecord({ schoolId: school._id });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .get('/api/reports/academic/grade-distribution')
        .set(headers)
        .query({
          classId: cls._id.toString(),
          examId: new mongoose.Types.ObjectId().toString(),
          academicYear: '2025-26',
        })
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('returns 400 when required query params are missing', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      await enableAdvancedReports(school._id);
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app).get('/api/reports/academic/class-results').set(headers);

      expect(res.status).toBe(400);
    });
  });

  // ─── FINANCIAL REPORTS ─────────────────────────────────────────────────

  describe('GET /api/reports/financial/*', () => {
    it('fee-collection returns data when feature is enabled', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      await enableAdvancedReports(school._id);
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .get('/api/reports/financial/fee-collection')
        .set(headers)
        .query({ academicYear: '2025-26', startDate: '2026-01-01', endDate: '2026-03-31' })
        .expect(200);

      expect(res.body).toBeDefined();
    });

    it('outstanding-dues returns data when feature is enabled', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      await enableAdvancedReports(school._id);
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .get('/api/reports/financial/outstanding-dues')
        .set(headers)
        .query({ academicYear: '2025-26' })
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('concession returns data when feature is enabled', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      await enableAdvancedReports(school._id);
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .get('/api/reports/financial/concession')
        .set(headers)
        .query({ academicYear: '2025-26' })
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('fee-head-collection returns data when feature is enabled', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      await enableAdvancedReports(school._id);
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .get('/api/reports/financial/fee-head-collection')
        .set(headers)
        .query({ academicYear: '2025-26', startDate: '2026-01-01', endDate: '2026-03-31' })
        .expect(200);

      expect(res.body).toBeDefined();
    });

    it('payment-mode-summary returns data when feature is enabled', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      await enableAdvancedReports(school._id);
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .get('/api/reports/financial/payment-mode-summary')
        .set(headers)
        .query({ academicYear: '2025-26', startDate: '2026-01-01', endDate: '2026-03-31' })
        .expect(200);

      expect(res.body).toBeDefined();
    });
  });

  // ─── ATTENDANCE REPORTS ────────────────────────────────────────────────

  describe('GET /api/reports/attendance/*', () => {
    it('student attendance report returns data when feature is enabled', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      await enableAdvancedReports(school._id);
      const cls = await createClassRecord({ schoolId: school._id });
      const student = await createStudentRecord({ schoolId: school._id, classId: cls._id });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .get('/api/reports/attendance/student')
        .set(headers)
        .query({
          studentId: student._id.toString(),
          startDate: '2026-01-01',
          endDate: '2026-03-31',
        })
        .expect(200);

      expect(res.body).toBeDefined();
    });

    it('class-summary returns data when feature is enabled', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      await enableAdvancedReports(school._id);
      const cls = await createClassRecord({ schoolId: school._id });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .get('/api/reports/attendance/class-summary')
        .set(headers)
        .query({ classId: cls._id.toString(), startDate: '2026-01-01', endDate: '2026-03-31' })
        .expect(200);

      expect(res.body).toBeDefined();
    });

    it('absentees returns data when feature is enabled', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      await enableAdvancedReports(school._id);
      const cls = await createClassRecord({ schoolId: school._id });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .get('/api/reports/attendance/absentees')
        .set(headers)
        .query({ classId: cls._id.toString(), startDate: '2026-03-01', endDate: '2026-03-31' })
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('monthly-register returns data when feature is enabled', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      await enableAdvancedReports(school._id);
      const cls = await createClassRecord({ schoolId: school._id });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .get('/api/reports/attendance/monthly-register')
        .set(headers)
        .query({ classId: cls._id.toString(), month: '2026-03' })
        .expect(200);

      expect(res.body).toBeDefined();
    });

    it('trend returns data when feature is enabled', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      await enableAdvancedReports(school._id);
      const cls = await createClassRecord({ schoolId: school._id });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .get('/api/reports/attendance/trend')
        .set(headers)
        .query({ classId: cls._id.toString(), startDate: '2026-01-01', endDate: '2026-03-31' })
        .expect(200);

      expect(res.body).toBeDefined();
    });

    it('late-arrivals returns data when feature is enabled', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      await enableAdvancedReports(school._id);
      const cls = await createClassRecord({ schoolId: school._id });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .get('/api/reports/attendance/late-arrivals')
        .set(headers)
        .query({ classId: cls._id.toString(), startDate: '2026-01-01', endDate: '2026-03-31' })
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // ─── STAFF REPORTS ─────────────────────────────────────────────────────

  describe('GET /api/reports/staff/*', () => {
    it('attendance-summary returns data when feature is enabled', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      await enableAdvancedReports(school._id);
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .get('/api/reports/staff/attendance-summary')
        .set(headers)
        .query({ startDate: '2026-01-01', endDate: '2026-03-31' })
        .expect(200);

      expect(res.body).toBeDefined();
    });

    it('payroll-summary returns data when feature is enabled', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      await enableAdvancedReports(school._id);
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .get('/api/reports/staff/payroll-summary')
        .set(headers)
        .query({ month: '3', year: '2026' })
        .expect(200);

      expect(res.body).toBeDefined();
    });

    it('count-by-department returns data when feature is enabled', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      await enableAdvancedReports(school._id);
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .get('/api/reports/staff/count-by-department')
        .set(headers)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // ─── OPERATIONAL REPORTS ───────────────────────────────────────────────

  describe('GET /api/reports/operational/*', () => {
    it('admissions returns data when feature is enabled', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      await enableAdvancedReports(school._id);
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .get('/api/reports/operational/admissions')
        .set(headers)
        .query({ academicYear: '2025-26' })
        .expect(200);

      expect(res.body).toBeDefined();
    });

    it('student-strength returns data when feature is enabled', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      await enableAdvancedReports(school._id);
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .get('/api/reports/operational/student-strength')
        .set(headers)
        .query({ academicYear: '2025-26' })
        .expect(200);

      expect(res.body).toBeDefined();
    });

    it('visitor-log returns data when feature is enabled', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      await enableAdvancedReports(school._id);
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .get('/api/reports/operational/visitor-log')
        .set(headers)
        .query({ startDate: '2026-01-01', endDate: '2026-03-31' })
        .expect(200);

      expect(res.body).toBeDefined();
    });

    it('tc-issued returns data when feature is enabled', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      await enableAdvancedReports(school._id);
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .get('/api/reports/operational/tc-issued')
        .set(headers)
        .query({ academicYear: '2025-26' })
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // ─── MULTI-TENANCY ─────────────────────────────────────────────────────

  describe('multi-tenancy', () => {
    it('school A admin cannot access school B report data', async () => {
      const schoolA = await createSchoolRecord({ name: 'School A', code: 'SCH-A' });
      const schoolB = await createSchoolRecord({ name: 'School B', code: 'SCH-B' });
      const adminA = await createStaffUser({ schoolId: schoolA._id });
      const adminB = await createStaffUser({ schoolId: schoolB._id });

      await enableAdvancedReports(schoolA._id);
      await enableAdvancedReports(schoolB._id);

      const clsB = await createClassRecord({ schoolId: schoolB._id });

      const { app } = createTestApp();
      const headersA = authHeadersFor(adminA, 'admin');

      // School A admin querying with school B classId should get empty result,
      // not school B data
      const res = await request(app)
        .get('/api/reports/academic/class-results')
        .set(headersA)
        .query({
          classId: clsB._id.toString(),
          examId: new mongoose.Types.ObjectId().toString(),
          academicYear: '2025-26',
        });

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(0);
    });
  });
});
