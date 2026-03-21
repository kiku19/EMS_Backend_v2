import request from 'supertest';
import { describe, expect, it } from 'vitest';
import Parent from '../models/Parent.js';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

let seq = 0;
function nextSeq() {
  return ++seq;
}

async function createParent(schoolId, overrides = {}) {
  const id = nextSeq();
  return Parent.create({
    name: `Parent ${id}`,
    phone: `7${String(id).padStart(9, '0')}`,
    email: `pm-parent${id}@test.example.com`,
    schoolId,
    status: 'active',
    children: [],
    ...overrides,
  });
}

async function setup() {
  const school = await createSchoolRecord({
    name: `PMan School ${nextSeq()}`,
    code: `PMAN-${nextSeq()}`,
  });
  const admin = await createStaffUser({ schoolId: school._id });
  const { app } = createTestApp();
  const headers = authHeadersFor(admin, 'admin');
  return { school, admin, app, headers };
}

describe('parentManagement routes', () => {
  // ── Auth ─────────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('returns 401 for GET /api/parents without auth', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/parents').expect(401);
    });

    it('returns 401 for GET /api/parents/:id without auth', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/parents/000000000000000000000000').expect(401);
    });

    it('returns 401 for PUT /api/parents/:id/status without auth', async () => {
      const { app } = createTestApp();
      await request(app)
        .put('/api/parents/000000000000000000000000/status')
        .send({ status: 'inactive' })
        .expect(401);
    });
  });

  // ── GET / ────────────────────────────────────────────────────────────────
  describe('GET /api/parents', () => {
    it('returns empty list when no parents exist for school', async () => {
      const { app, headers } = await setup();
      const res = await request(app).get('/api/parents').set(headers).expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.parents).toEqual([]);
    });

    it('returns parents scoped to the authenticated user school', async () => {
      const { school, app, headers } = await setup();
      await createParent(school._id);
      await createParent(school._id);

      const res = await request(app).get('/api/parents').set(headers).expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.parents).toHaveLength(2);
      expect(res.body.data.pagination.total).toBe(2);
    });

    it('does not return parents from other schools', async () => {
      const { app, headers } = await setup();
      const otherSchool = await createSchoolRecord({ name: 'Other', code: `OTHER-${nextSeq()}` });
      await createParent(otherSchool._id);

      const res = await request(app).get('/api/parents').set(headers).expect(200);
      expect(res.body.data.parents).toHaveLength(0);
    });

    it('filters parents by status', async () => {
      const { school, app, headers } = await setup();
      await createParent(school._id, { status: 'active' });
      await createParent(school._id, { status: 'inactive' });

      const res = await request(app)
        .get('/api/parents')
        .query({ status: 'inactive' })
        .set(headers)
        .expect(200);

      expect(res.body.data.parents).toHaveLength(1);
      expect(res.body.data.parents[0].status).toBe('inactive');
    });

    it('supports search by name', async () => {
      const { school, app, headers } = await setup();
      await createParent(school._id, { name: 'Alice Wonder' });
      await createParent(school._id, { name: 'Bob Builder' });

      const res = await request(app)
        .get('/api/parents')
        .query({ search: 'Alice' })
        .set(headers)
        .expect(200);

      expect(res.body.data.parents).toHaveLength(1);
      expect(res.body.data.parents[0].name).toBe('Alice Wonder');
    });
  });

  // ── GET /:id ─────────────────────────────────────────────────────────────
  describe('GET /api/parents/:id', () => {
    it('returns 404 for non-existent parent', async () => {
      const { app, headers } = await setup();
      await request(app).get('/api/parents/000000000000000000000000').set(headers).expect(404);
    });

    it('returns parent details', async () => {
      const { school, app, headers } = await setup();
      const parent = await createParent(school._id);

      const res = await request(app).get(`/api/parents/${parent._id}`).set(headers).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe(parent.name);
      expect(res.body.data.password).toBeUndefined();
    });

    it('returns 404 for parent in different school', async () => {
      const { app, headers } = await setup();
      const otherSchool = await createSchoolRecord({ name: 'X', code: `XSCHOOL-${nextSeq()}` });
      const parent = await createParent(otherSchool._id);

      await request(app).get(`/api/parents/${parent._id}`).set(headers).expect(404);
    });
  });

  // ── PUT /:id/status ──────────────────────────────────────────────────────
  describe('PUT /api/parents/:id/status', () => {
    it('returns 400 for invalid status value', async () => {
      const { school, app, headers } = await setup();
      const parent = await createParent(school._id);

      await request(app)
        .put(`/api/parents/${parent._id}/status`)
        .set(headers)
        .send({ status: 'banned' })
        .expect(400);
    });

    it('updates parent status to inactive', async () => {
      const { school, app, headers } = await setup();
      const parent = await createParent(school._id);

      const res = await request(app)
        .put(`/api/parents/${parent._id}/status`)
        .set(headers)
        .send({ status: 'inactive' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('inactive');
    });

    it('returns 404 for non-existent parent', async () => {
      const { app, headers } = await setup();
      await request(app)
        .put('/api/parents/000000000000000000000000/status')
        .set(headers)
        .send({ status: 'active' })
        .expect(404);
    });
  });

  // ── POST /:id/reset-password ─────────────────────────────────────────────
  describe('POST /api/parents/:id/reset-password', () => {
    it('returns 404 for non-existent parent', async () => {
      const { app, headers } = await setup();
      await request(app)
        .post('/api/parents/000000000000000000000000/reset-password')
        .set(headers)
        .expect(404);
    });

    it('returns 400 when parent has no children', async () => {
      const { school, app, headers } = await setup();
      const parent = await createParent(school._id, { children: [] });

      await request(app).post(`/api/parents/${parent._id}/reset-password`).set(headers).expect(400);
    });

    it('resets password when parent has a linked student with DOB and admissionId', async () => {
      const { school, app, headers } = await setup();
      const cls = await createClassRecord({ schoolId: school._id });
      const student = await createStudentRecord({
        schoolId: school._id,
        classId: cls._id,
        admissionId: `ADM-RPW-${nextSeq()}`,
        dateOfBirth: '2010-05-15',
      });
      const parent = await createParent(school._id, {
        children: [{ studentId: student._id, relationship: 'mother' }],
      });

      const res = await request(app)
        .post(`/api/parents/${parent._id}/reset-password`)
        .set(headers)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.generatedPassword).toBeDefined();
    });
  });
});
