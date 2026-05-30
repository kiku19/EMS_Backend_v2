import request from 'supertest';
import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import ErasureRequest from '../models/ErasureRequest.js';
import ConsentRecord from '../models/ConsentRecord.js';
import RetentionPolicy from '../models/RetentionPolicy.js';
import DPARecord from '../models/DPARecord.js';
import { Student } from '../database.js';
import {
  authHeadersFor,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
  createClassRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const BASE = '/api/gdpr';

describe('gdpr routes', () => {
  async function setup() {
    const school = await createSchoolRecord({ name: 'GDPR School', code: 'GDPR' });
    const cls = await createClassRecord({ schoolId: school._id, name: 'Class 1', section: 'A' });
    const admin = await createStaffUser({
      name: 'GDPR Admin',
      email: 'gdpr.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    const { app } = createTestApp();
    const headers = authHeadersFor(admin, 'admin');
    return { school, cls, admin, app, headers };
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('returns 401 without token', async () => {
      const { app } = createTestApp();
      await request(app).get(`${BASE}/erasure-requests`).expect(401);
      await request(app).post(`${BASE}/consent`).send({}).expect(401);
    });
  });

  // ── POST /gdpr/erasure-requests ───────────────────────────────────────────
  describe('POST /gdpr/erasure-requests', () => {
    it('creates an erasure request', async () => {
      const { school, cls, admin, app, headers } = await setup();
      const student = await createStudentRecord({
        schoolId: school._id,
        classId: cls._id,
        name: 'Erase Me',
      });

      const res = await request(app)
        .post(`${BASE}/erasure-requests`)
        .set(headers)
        .send({
          entityType: 'Student',
          entityId: student._id.toString(),
          reason: 'Please delete my data per GDPR',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.request.entityType).toBe('Student');
      expect(res.body.request.status).toBe('pending');
    });

    it('returns 409 for duplicate pending request', async () => {
      const { school, cls, admin, app, headers } = await setup();
      const student = await createStudentRecord({ schoolId: school._id, classId: cls._id });
      await ErasureRequest.create({
        schoolId: school._id,
        entityType: 'Student',
        entityId: student._id,
        entityName: student.name,
        reason: 'First request',
        status: 'pending',
        requestedBy: admin._id,
      });

      const res = await request(app)
        .post(`${BASE}/erasure-requests`)
        .set(headers)
        .send({ entityType: 'Student', entityId: student._id.toString(), reason: 'Second request' })
        .expect(409);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 for invalid entityType', async () => {
      const { app, headers } = await setup();
      const res = await request(app)
        .post(`${BASE}/erasure-requests`)
        .set(headers)
        .send({ entityType: 'Invalid', entityId: '665000000000000000000000', reason: 'Short' })
        .expect(400);
      expect(res.body.error).toBeTruthy();
    });
  });

  // ── GET /gdpr/erasure-requests ────────────────────────────────────────────
  describe('GET /gdpr/erasure-requests', () => {
    it('lists erasure requests for the school', async () => {
      const { school, admin, app, headers } = await setup();
      await ErasureRequest.create([
        {
          schoolId: school._id,
          entityType: 'Student',
          entityId: new mongoose.Types.ObjectId(),
          entityName: 'A',
          reason: 'R1',
          status: 'pending',
          requestedBy: admin._id,
        },
        {
          schoolId: school._id,
          entityType: 'Staff',
          entityId: new mongoose.Types.ObjectId(),
          entityName: 'B',
          reason: 'R2',
          status: 'approved',
          requestedBy: admin._id,
        },
      ]);

      const res = await request(app).get(`${BASE}/erasure-requests`).set(headers).expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.requests.length).toBe(2);
    });

    it('filters by status', async () => {
      const { school, admin, app, headers } = await setup();
      await ErasureRequest.create([
        {
          schoolId: school._id,
          entityType: 'Student',
          entityId: new mongoose.Types.ObjectId(),
          entityName: 'A',
          reason: 'R1',
          status: 'pending',
          requestedBy: admin._id,
        },
        {
          schoolId: school._id,
          entityType: 'Staff',
          entityId: new mongoose.Types.ObjectId(),
          entityName: 'B',
          reason: 'R2',
          status: 'approved',
          requestedBy: admin._id,
        },
      ]);

      const res = await request(app)
        .get(`${BASE}/erasure-requests?status=pending`)
        .set(headers)
        .expect(200);
      expect(res.body.requests).toHaveLength(1);
      expect(res.body.requests[0].status).toBe('pending');
    });
  });

  // ── GET /gdpr/erasure-requests/:id ────────────────────────────────────────
  describe('GET /gdpr/erasure-requests/:id', () => {
    it('returns a single request', async () => {
      const { school, admin, app, headers } = await setup();
      const reqDoc = await ErasureRequest.create({
        schoolId: school._id,
        entityType: 'Student',
        entityId: new mongoose.Types.ObjectId(),
        entityName: 'A',
        reason: 'R1',
        status: 'pending',
        requestedBy: admin._id,
      });

      const res = await request(app)
        .get(`${BASE}/erasure-requests/${reqDoc._id}`)
        .set(headers)
        .expect(200);
      expect(res.body.request._id.toString()).toBe(reqDoc._id.toString());
    });

    it('returns 404 for non-existent request', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).get(`${BASE}/erasure-requests/${fakeId}`).set(headers).expect(404);
    });
  });

  // ── PUT /gdpr/erasure-requests/:id/review ─────────────────────────────────
  describe('PUT /gdpr/erasure-requests/:id/review', () => {
    it('approves a pending request', async () => {
      const { school, admin, app, headers } = await setup();
      const reqDoc = await ErasureRequest.create({
        schoolId: school._id,
        entityType: 'Student',
        entityId: new mongoose.Types.ObjectId(),
        entityName: 'A',
        reason: 'R1',
        status: 'pending',
        requestedBy: admin._id,
      });

      const res = await request(app)
        .put(`${BASE}/erasure-requests/${reqDoc._id}/review`)
        .set(headers)
        .send({ action: 'approve' })
        .expect(200);
      expect(res.body.request.status).toBe('approved');
    });

    it('rejects a pending request', async () => {
      const { school, admin, app, headers } = await setup();
      const reqDoc = await ErasureRequest.create({
        schoolId: school._id,
        entityType: 'Student',
        entityId: new mongoose.Types.ObjectId(),
        entityName: 'A',
        reason: 'R1',
        status: 'pending',
        requestedBy: admin._id,
      });

      const res = await request(app)
        .put(`${BASE}/erasure-requests/${reqDoc._id}/review`)
        .set(headers)
        .send({ action: 'reject', reviewNote: 'Cannot verify identity' })
        .expect(200);
      expect(res.body.request.status).toBe('rejected');
      expect(res.body.request.reviewNote).toBe('Cannot verify identity');
    });

    it('returns 404 for non-pending request', async () => {
      const { school, admin, app, headers } = await setup();
      const reqDoc = await ErasureRequest.create({
        schoolId: school._id,
        entityType: 'Student',
        entityId: new mongoose.Types.ObjectId(),
        entityName: 'A',
        reason: 'R1',
        status: 'executed',
        requestedBy: admin._id,
      });

      await request(app)
        .put(`${BASE}/erasure-requests/${reqDoc._id}/review`)
        .set(headers)
        .send({ action: 'approve' })
        .expect(404);
    });
  });

  // ── POST /gdpr/erasure-requests/:id/execute ───────────────────────────────
  describe('POST /gdpr/erasure-requests/:id/execute', () => {
    it('returns 404 for non-approved request', async () => {
      const { school, admin, app, headers } = await setup();
      const reqDoc = await ErasureRequest.create({
        schoolId: school._id,
        entityType: 'Student',
        entityId: new mongoose.Types.ObjectId(),
        entityName: 'A',
        reason: 'R1',
        status: 'pending',
        requestedBy: admin._id,
      });

      await request(app)
        .post(`${BASE}/erasure-requests/${reqDoc._id}/execute`)
        .set(headers)
        .expect(404);
    });
  });

  // ── GET /gdpr/consent/:entityType/:entityId ───────────────────────────────
  describe('GET /gdpr/consent/:entityType/:entityId', () => {
    it('returns consent records for an entity', async () => {
      const { school, cls, app, headers } = await setup();
      const student = await createStudentRecord({ schoolId: school._id, classId: cls._id });
      await ConsentRecord.create({
        schoolId: school._id,
        entityType: 'Student',
        entityId: student._id,
        consentType: 'data_collection',
        granted: true,
        source: 'online_form',
      });

      const res = await request(app)
        .get(`${BASE}/consent/Student/${student._id}`)
        .set(headers)
        .expect(200);
      expect(res.body.records).toHaveLength(1);
      expect(res.body.records[0].consentType).toBe('data_collection');
    });
  });

  // ── POST /gdpr/consent ────────────────────────────────────────────────────
  describe('POST /gdpr/consent', () => {
    it('records a new consent', async () => {
      const { school, cls, app, headers } = await setup();
      const student = await createStudentRecord({ schoolId: school._id, classId: cls._id });

      const res = await request(app)
        .post(`${BASE}/consent`)
        .set(headers)
        .send({
          entityType: 'Student',
          entityId: student._id.toString(),
          consentType: 'photo_usage',
          granted: true,
        })
        .expect(201);
      expect(res.body.record.granted).toBe(true);
      expect(res.body.record.consentType).toBe('photo_usage');
    });

    it('updates an existing consent (upsert)', async () => {
      const { school, cls, admin, app, headers } = await setup();
      const student = await createStudentRecord({ schoolId: school._id, classId: cls._id });
      await ConsentRecord.create({
        schoolId: school._id,
        entityType: 'Student',
        entityId: student._id,
        consentType: 'data_collection',
        granted: true,
      });

      const res = await request(app)
        .post(`${BASE}/consent`)
        .set(headers)
        .send({
          entityType: 'Student',
          entityId: student._id.toString(),
          consentType: 'data_collection',
          granted: false,
        })
        .expect(201);
      expect(res.body.record.granted).toBe(false);
      expect(res.body.record.revokedAt).toBeTruthy();
    });
  });

  // ── GET /gdpr/retention-policies ──────────────────────────────────────────
  describe('GET /gdpr/retention-policies', () => {
    it('returns default policies when none are saved', async () => {
      const { app, headers } = await setup();
      const res = await request(app).get(`${BASE}/retention-policies`).set(headers).expect(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.policies)).toBe(true);
      expect(res.body.policies.length).toBeGreaterThan(0);
      expect(res.body.policies[0]).toHaveProperty('isDefault');
    });

    it('returns saved custom policies', async () => {
      const { school, app, headers } = await setup();
      await RetentionPolicy.create({
        schoolId: school._id,
        entityType: 'students',
        retentionMonths: 120,
      });

      const res = await request(app).get(`${BASE}/retention-policies`).set(headers).expect(200);
      const studentsPolicy = res.body.policies.find((p) => p.entityType === 'students');
      expect(studentsPolicy.retentionMonths).toBe(120);
      expect(studentsPolicy.isDefault).toBe(false);
    });
  });

  // ── PUT /gdpr/retention-policies ──────────────────────────────────────────
  describe('PUT /gdpr/retention-policies', () => {
    it('upserts retention policies', async () => {
      const { app, headers } = await setup();
      const res = await request(app)
        .put(`${BASE}/retention-policies`)
        .set(headers)
        .send({
          policies: [{ entityType: 'students', retentionMonths: 60, description: 'Updated' }],
        })
        .expect(200);
      expect(res.body.updated).toBe(1);
    });

    it('returns 400 for invalid entityType', async () => {
      const { app, headers } = await setup();
      const res = await request(app)
        .put(`${BASE}/retention-policies`)
        .set(headers)
        .send({
          policies: [{ entityType: 'invalid', retentionMonths: 60 }],
        })
        .expect(400);
      expect(res.body.error).toBeTruthy();
    });
  });

  // ── GET /gdpr/dashboard ───────────────────────────────────────────────────
  describe('GET /gdpr/dashboard', () => {
    it('returns dashboard summary', async () => {
      const { app, headers } = await setup();
      const res = await request(app).get(`${BASE}/dashboard`).set(headers).expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.dashboard).toHaveProperty('retentionPolicies');
      expect(res.body.dashboard).toHaveProperty('erasureRequests');
      expect(res.body.dashboard).toHaveProperty('consent');
    });
  });

  // ── GET /gdpr/dpa ─────────────────────────────────────────────────────────
  describe('GET /gdpr/dpa', () => {
    it('returns DPA info with acceptance status', async () => {
      const { app, headers } = await setup();
      const res = await request(app).get(`${BASE}/dpa`).set(headers).expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.dpa).toHaveProperty('version');
      expect(res.body.acceptance.accepted).toBe(false);
    });
  });

  // ── POST /gdpr/dpa/accept ─────────────────────────────────────────────────
  describe('POST /gdpr/dpa/accept', () => {
    it('records DPA acceptance', async () => {
      const { app, headers } = await setup();
      const res = await request(app)
        .post(`${BASE}/dpa/accept`)
        .set(headers)
        .send({ legalEntityName: 'Test School Ltd' })
        .expect(201);
      expect(res.body.success).toBe(true);
      expect(res.body.record.acceptedAt).toBeTruthy();
    });
  });

  // ── GET /gdpr/coppa/report ────────────────────────────────────────────────
  describe('GET /gdpr/coppa/report', () => {
    it('returns empty when no under-13 students', async () => {
      const { app, headers } = await setup();
      const res = await request(app).get(`${BASE}/coppa/report`).set(headers).expect(200);
      expect(res.body.total).toBe(0);
    });

    it('flags under-13 students without parental consent', async () => {
      const { school, cls, app, headers } = await setup();
      const dob = new Date();
      dob.setFullYear(dob.getFullYear() - 10); // 10 years old
      await createStudentRecord({
        schoolId: school._id,
        classId: cls._id,
        name: 'Young One',
        dateOfBirth: dob.toISOString().split('T')[0],
      });

      const res = await request(app).get(`${BASE}/coppa/report`).set(headers).expect(200);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
      expect(res.body.students[0].parentalConsentGranted).toBe(false);
    });
  });
});
