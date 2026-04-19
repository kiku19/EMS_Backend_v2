/**
 * E2E-04: Exam creation → results entry → publish → parent sees report card
 *
 * Tests the full admin→parent exam lifecycle:
 *   1. Admin creates an exam for a class
 *   2. Admin enters marks for students (bulk results entry)
 *   3. Admin publishes the exam (results become visible to parents)
 *   4. Parent authenticates via phone+password login
 *   5. Parent views the published result for their child
 *   6. Parent downloads the report card PDF
 */

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import express from 'express';
import Parent from '../models/Parent.js';
import { Staff } from '../database.js';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
} from './helpers/factories.js';
import { i18nMiddleware } from '../middleware/i18n.js';
import academicsRoutes from '../routes/academics.js';
import parentAuthRoutes from '../routes/parentAuth.js';
import parentDataRoutes from '../routes/parentData.js';
import { initializeSocket } from '../utils/socketEmitter.js';

function createTestIo() {
  return {
    emit() {},
    to() {
      return { emit() {} };
    },
  };
}

/**
 * Minimal app mounting only the routes required for this E2E flow:
 *   /api              — academics (exam creation, results, publish)
 *   /api/parent/auth  — parent login
 *   /api/parent       — parent data (results, report card)
 */
function createE2EApp() {
  const app = express();
  const io = createTestIo();

  app.use(i18nMiddleware);
  app.use(express.json());
  app.set('io', io);
  app.locals.Staff = Staff;

  initializeSocket(io);

  // Parent routes must mount BEFORE the wildcard `/api` academics router —
  // academics applies router.use(authenticate) to every matching path, so
  // otherwise /api/parent/auth/login would be intercepted and return 401.
  app.use('/api/parent/auth', parentAuthRoutes);
  app.use('/api/parent', parentDataRoutes);
  app.use('/api', academicsRoutes);

  return { app };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('E2E-04: Exam creation → results entry → publish → parent sees report card', () => {
  it('completes the full exam lifecycle from admin creation to parent report card', async () => {
    // ── Seed data ────────────────────────────────────────────────────────────
    const school = await createSchoolRecord({ name: 'E2E-04 School' });
    const classRecord = await createClassRecord({
      schoolId: school._id,
      name: 'Class 10',
      section: 'A',
    });

    const admin = await createStaffUser({
      schoolId: school._id,
      staffRole: ['Admin'],
      name: 'E2E-04 Admin',
    });

    const student = await createStudentRecord({
      name: 'E2E Student',
      rollNo: 1,
      classId: classRecord._id,
      schoolId: school._id,
    });

    // Parent linked to student
    await Parent.create({
      phone: '9876540001',
      name: 'E2E Parent',
      schoolId: school._id,
      status: 'active',
      password: 'TestPass@123',
      children: [{ studentId: student._id, relationship: 'father', isPrimary: true }],
    });

    const { app } = createE2EApp();
    const adminHeaders = authHeadersFor(admin, 'admin');

    // ── STEP 1: Admin creates an exam ─────────────────────────────────────────
    const examRes = await request(app)
      .post('/api/exams')
      .set(adminHeaders)
      .send({
        name: 'E2E Final Exam',
        classId: classRecord._id.toString(),
        maxMarks: 100,
        passingMarks: 35,
        startDate: '2026-05-01',
        academicYear: '2025-26',
      })
      .expect(201);

    expect(examRes.body.name).toBe('E2E Final Exam');
    expect(examRes.body.isPublished).toBe(false);
    expect(examRes.body.status).toBe('scheduled');

    const examId = examRes.body._id;

    // ── STEP 2: Admin enters marks for the student ────────────────────────────
    const bulkRes = await request(app)
      .post('/api/results/bulk')
      .set(adminHeaders)
      .send({
        examId,
        classId: classRecord._id.toString(),
        results: [{ studentId: student._id.toString(), marksObtained: 82 }],
      })
      .expect(200);

    expect(bulkRes.body.count).toBe(1);

    // ── STEP 3: Admin publishes the exam ──────────────────────────────────────
    const publishRes = await request(app)
      .post(`/api/exams/${examId}/publish`)
      .set(adminHeaders)
      .expect(200);

    expect(publishRes.body.isPublished).toBe(true);
    expect(publishRes.body.status).toBe('results_published');

    // ── STEP 4: Parent logs in ────────────────────────────────────────────────
    const loginRes = await request(app)
      .post('/api/parent/auth/login')
      .send({ identifier: '9876540001', password: 'TestPass@123' })
      .expect(200);

    expect(loginRes.body.success).toBe(true);
    expect(loginRes.body.data.parent.name).toBe('E2E Parent');

    const { accessToken } = loginRes.body.data;
    expect(accessToken).toBeTruthy();

    const parentHeader = { Authorization: `Bearer ${accessToken}` };

    // ── STEP 5: Parent views published results for child ──────────────────────
    const resultsRes = await request(app)
      .get(`/api/parent/students/${student._id}/results`)
      .set(parentHeader)
      .expect(200);

    expect(resultsRes.body.success).toBe(true);

    const { results } = resultsRes.body.data;
    expect(results).toHaveLength(1);

    const result = results[0];
    expect(result.marksObtained).toBe(82);
    expect(result.percentage).toBe(82);
    expect(result.grade).toBe('A');
    expect(result.status).toBe('passed');
    expect(result.isPublished).toBe(true);

    // ── STEP 6: Parent downloads report card PDF ──────────────────────────────
    const pdfRes = await request(app)
      .get(`/api/parent/students/${student._id}/results/${examId}/report-card`)
      .set(parentHeader)
      .expect(200);

    expect(pdfRes.headers['content-type']).toMatch(/application\/pdf/);
    expect(pdfRes.headers['content-disposition']).toMatch(/attachment/);
    expect(pdfRes.headers['content-disposition']).toMatch(/report-card/);
  });

  // ── Auth & access boundary tests ─────────────────────────────────────────

  it('parent sees no results before exam is published', async () => {
    const school = await createSchoolRecord({ name: 'E2E-04 Unpublished School' });
    const classRecord = await createClassRecord({ schoolId: school._id });
    const admin = await createStaffUser({ schoolId: school._id, staffRole: ['Admin'] });

    const student = await createStudentRecord({
      name: 'Unpublished Student',
      classId: classRecord._id,
      schoolId: school._id,
    });

    await Parent.create({
      phone: '9876540002',
      name: 'Unpublished Parent',
      schoolId: school._id,
      status: 'active',
      password: 'TestPass@123',
      children: [{ studentId: student._id, relationship: 'mother', isPrimary: true }],
    });

    const { app } = createE2EApp();
    const adminHeaders = authHeadersFor(admin, 'admin');

    // Admin creates exam and enters results but does NOT publish
    const examRes = await request(app)
      .post('/api/exams')
      .set(adminHeaders)
      .send({
        name: 'Unpublished Exam',
        classId: classRecord._id.toString(),
        maxMarks: 100,
        passingMarks: 35,
        startDate: '2026-05-10',
        academicYear: '2025-26',
      })
      .expect(201);

    await request(app)
      .post('/api/results/bulk')
      .set(adminHeaders)
      .send({
        examId: examRes.body._id,
        classId: classRecord._id.toString(),
        results: [{ studentId: student._id.toString(), marksObtained: 70 }],
      })
      .expect(200);

    // Parent logs in
    const loginRes = await request(app)
      .post('/api/parent/auth/login')
      .send({ identifier: '9876540002', password: 'TestPass@123' })
      .expect(200);

    const { accessToken } = loginRes.body.data;

    // Parent sees empty results (exam not published)
    const resultsRes = await request(app)
      .get(`/api/parent/students/${student._id}/results`)
      .set({ Authorization: `Bearer ${accessToken}` })
      .expect(200);

    expect(resultsRes.body.success).toBe(true);
    expect(resultsRes.body.data.results).toHaveLength(0);
  });

  it('parent gets 404 when requesting report card for unpublished exam', async () => {
    const school = await createSchoolRecord({ name: 'E2E-04 PDF Guard School' });
    const classRecord = await createClassRecord({ schoolId: school._id });
    const admin = await createStaffUser({ schoolId: school._id, staffRole: ['Admin'] });

    const student = await createStudentRecord({
      name: 'PDF Guard Student',
      classId: classRecord._id,
      schoolId: school._id,
    });

    await Parent.create({
      phone: '9876540003',
      name: 'PDF Guard Parent',
      schoolId: school._id,
      status: 'active',
      password: 'TestPass@123',
      children: [{ studentId: student._id, relationship: 'father', isPrimary: true }],
    });

    const { app } = createE2EApp();
    const adminHeaders = authHeadersFor(admin, 'admin');

    // Create exam with results but do NOT publish
    const examRes = await request(app)
      .post('/api/exams')
      .set(adminHeaders)
      .send({
        name: 'PDF Guard Exam',
        classId: classRecord._id.toString(),
        maxMarks: 100,
        passingMarks: 35,
        startDate: '2026-05-15',
        academicYear: '2025-26',
      })
      .expect(201);

    await request(app)
      .post('/api/results/bulk')
      .set(adminHeaders)
      .send({
        examId: examRes.body._id,
        classId: classRecord._id.toString(),
        results: [{ studentId: student._id.toString(), marksObtained: 60 }],
      })
      .expect(200);

    const loginRes = await request(app)
      .post('/api/parent/auth/login')
      .send({ identifier: '9876540003', password: 'TestPass@123' })
      .expect(200);

    const { accessToken } = loginRes.body.data;

    // Parent tries to get report card for unpublished exam → 404
    await request(app)
      .get(`/api/parent/students/${student._id}/results/${examRes.body._id}/report-card`)
      .set({ Authorization: `Bearer ${accessToken}` })
      .expect(404);
  });

  it("parent cannot access another child's results (403)", async () => {
    const school = await createSchoolRecord({ name: 'E2E-04 Access Control School' });
    const classRecord = await createClassRecord({ schoolId: school._id });
    const admin = await createStaffUser({ schoolId: school._id, staffRole: ['Admin'] });

    const ownChild = await createStudentRecord({
      name: 'Own Child',
      rollNo: 1,
      classId: classRecord._id,
      schoolId: school._id,
    });

    const otherChild = await createStudentRecord({
      name: 'Other Child',
      rollNo: 2,
      classId: classRecord._id,
      schoolId: school._id,
      parentPhone: '9800000099',
    });

    await Parent.create({
      phone: '9876540004',
      name: 'Access Control Parent',
      schoolId: school._id,
      status: 'active',
      password: 'TestPass@123',
      // Only linked to ownChild
      children: [{ studentId: ownChild._id, relationship: 'father', isPrimary: true }],
    });

    const { app } = createE2EApp();
    const adminHeaders = authHeadersFor(admin, 'admin');

    // Create, enter results, and publish exam for both students
    const examRes = await request(app)
      .post('/api/exams')
      .set(adminHeaders)
      .send({
        name: 'Access Control Exam',
        classId: classRecord._id.toString(),
        maxMarks: 100,
        passingMarks: 35,
        startDate: '2026-05-20',
        academicYear: '2025-26',
      })
      .expect(201);

    await request(app)
      .post('/api/results/bulk')
      .set(adminHeaders)
      .send({
        examId: examRes.body._id,
        classId: classRecord._id.toString(),
        results: [
          { studentId: ownChild._id.toString(), marksObtained: 75 },
          { studentId: otherChild._id.toString(), marksObtained: 80 },
        ],
      })
      .expect(200);

    await request(app).post(`/api/exams/${examRes.body._id}/publish`).set(adminHeaders).expect(200);

    const loginRes = await request(app)
      .post('/api/parent/auth/login')
      .send({ identifier: '9876540004', password: 'TestPass@123' })
      .expect(200);

    const { accessToken } = loginRes.body.data;

    // Parent tries to access other child's results → 403
    await request(app)
      .get(`/api/parent/students/${otherChild._id}/results`)
      .set({ Authorization: `Bearer ${accessToken}` })
      .expect(403);
  });

  it('returns 401 for unauthenticated access to parent results', async () => {
    const classRecord = await createClassRecord();
    const student = await createStudentRecord({ classId: classRecord._id });

    const { app } = createE2EApp();

    await request(app).get(`/api/parent/students/${student._id}/results`).expect(401);
  });
});
