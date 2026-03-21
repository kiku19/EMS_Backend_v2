import request from 'supertest';
import { describe, expect, it, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Substitution, Staff } from '../database.js';
import {
  authHeadersFor,
  createSchoolRecord,
  createStaffUser,
  createClassRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const BASE = '/api/substitution-alerts';

/**
 * Create a substitution record for alert tests.
 * substituteTeacherId is required by the schema so must always be provided.
 */
async function createSubstitutionRecord({
  schoolId,
  classId,
  substituteTeacherId,
  absentTeacherId = null,
  date = '2025-03-10',
  period = '1',
}) {
  return Substitution.create({
    schoolId,
    date,
    classId,
    period,
    absentTeacherId,
    substituteTeacherId,
    reason: 'Teacher absent',
    type: 'auto',
    status: 'confirmed',
  });
}

describe('substitutionAlerts routes', () => {
  let app, school, admin, teacher, substitute, cls, headers;

  beforeEach(async () => {
    school = await createSchoolRecord({ name: 'Alert School', code: 'ALT' });
    admin = await createStaffUser({
      name: 'Alert Admin',
      email: 'alert.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    teacher = await createStaffUser({
      name: 'Alert Teacher',
      email: 'alert.teacher@example.com',
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });
    substitute = await createStaffUser({
      name: 'Alert Substitute',
      email: 'alert.sub@example.com',
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });
    await Staff.findByIdAndUpdate(substitute._id, { status: 'active' });
    cls = await createClassRecord({ name: 'Class 8', section: 'C', schoolId: school._id });
    headers = authHeadersFor(admin, 'admin');
    ({ app } = createTestApp());
  });

  // ───────────────────────────────────────────────────────────────
  // Auth
  // ───────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('GET / returns 401 without token', async () => {
      await request(app).get(BASE).expect(401);
    });

    it('GET /available-teachers returns 401 without token', async () => {
      await request(app).get(`${BASE}/available-teachers`).expect(401);
    });

    it('POST /from-absence returns 401 without token', async () => {
      await request(app).post(`${BASE}/from-absence`).send({}).expect(401);
    });

    it('POST /bulk-assign returns 401 without token', async () => {
      await request(app).post(`${BASE}/bulk-assign`).send({}).expect(401);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET / — get alerts for a date
  // ───────────────────────────────────────────────────────────────
  describe('GET /', () => {
    it('returns 200 with alerts and summary for today', async () => {
      const res = await request(app).get(BASE).set(headers).expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.alerts)).toBe(true);
      expect(res.body.summary).toHaveProperty('totalAlerts');
      expect(res.body.summary).toHaveProperty('unassigned');
      expect(res.body.summary).toHaveProperty('assigned');
    });

    it('returns 200 for a specific date query param', async () => {
      const res = await request(app).get(`${BASE}?date=2025-03-10`).set(headers).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.date).toBe('2025-03-10');
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /available-teachers
  // ───────────────────────────────────────────────────────────────
  describe('GET /available-teachers', () => {
    it('returns 400 when subject is missing', async () => {
      const res = await request(app)
        .get(`${BASE}/available-teachers?classId=${cls._id}&day=Monday&period=1`)
        .set(headers)
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it('returns 400 when classId is missing', async () => {
      const res = await request(app)
        .get(`${BASE}/available-teachers?subject=Math&day=Monday&period=1`)
        .set(headers)
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // POST /from-absence
  // ───────────────────────────────────────────────────────────────
  describe('POST /from-absence', () => {
    it('returns 400 when teacherId is missing', async () => {
      const res = await request(app)
        .post(`${BASE}/from-absence`)
        .set(headers)
        .send({ date: '2025-03-10' })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it('returns 400 when date is missing', async () => {
      const res = await request(app)
        .post(`${BASE}/from-absence`)
        .set(headers)
        .send({ teacherId: teacher._id.toString() })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it('returns 404 when teacher does not exist', async () => {
      const res = await request(app)
        .post(`${BASE}/from-absence`)
        .set(headers)
        .send({
          teacherId: new mongoose.Types.ObjectId().toString(),
          date: '2025-03-10',
        })
        .expect(404);

      expect(res.body.success).toBe(false);
    });

    it('creates substitution alerts from absence', async () => {
      const res = await request(app)
        .post(`${BASE}/from-absence`)
        .set(headers)
        .send({
          teacherId: teacher._id.toString(),
          date: '2025-03-10',
          reason: 'Sick leave',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.substitutions)).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // POST /:id/assign — assign a substitute
  // ───────────────────────────────────────────────────────────────
  describe('POST /:id/assign', () => {
    it('returns 400 when substituteTeacherId is missing', async () => {
      const sub = await createSubstitutionRecord({
        schoolId: school._id,
        classId: cls._id,
        substituteTeacherId: teacher._id,
        absentTeacherId: teacher._id,
      });

      const res = await request(app)
        .post(`${BASE}/${sub._id}/assign`)
        .set(headers)
        .send({})
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it('returns 404 when substitution does not exist', async () => {
      const res = await request(app)
        .post(`${BASE}/${new mongoose.Types.ObjectId()}/assign`)
        .set(headers)
        .send({ substituteTeacherId: substitute._id.toString() })
        .expect(404);

      expect(res.body.success).toBe(false);
    });

    it('returns 400 when substitute teacher is inactive', async () => {
      const inactiveStaff = await createStaffUser({
        name: 'Inactive Sub',
        email: 'inactive.sub@example.com',
        schoolId: school._id,
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
      });
      await Staff.findByIdAndUpdate(inactiveStaff._id, { status: 'inactive' });

      const sub = await createSubstitutionRecord({
        schoolId: school._id,
        classId: cls._id,
        substituteTeacherId: teacher._id,
      });

      const res = await request(app)
        .post(`${BASE}/${sub._id}/assign`)
        .set(headers)
        .send({ substituteTeacherId: inactiveStaff._id.toString() })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it('assigns substitute teacher and confirms the substitution', async () => {
      const sub = await createSubstitutionRecord({
        schoolId: school._id,
        classId: cls._id,
        substituteTeacherId: teacher._id,
        absentTeacherId: teacher._id,
      });

      const res = await request(app)
        .post(`${BASE}/${sub._id}/assign`)
        .set(headers)
        .send({ substituteTeacherId: substitute._id.toString() })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.substitution.status).toBe('confirmed');
    });
  });

  // ───────────────────────────────────────────────────────────────
  // POST /:id/notify
  // ───────────────────────────────────────────────────────────────
  describe('POST /:id/notify', () => {
    it('returns 404 when substitution does not exist', async () => {
      const res = await request(app)
        .post(`${BASE}/${new mongoose.Types.ObjectId()}/notify`)
        .set(headers)
        .send({ method: 'push' })
        .expect(404);

      expect(res.body.success).toBe(false);
    });

    it('sends notification when substitute is assigned', async () => {
      const sub = await createSubstitutionRecord({
        schoolId: school._id,
        classId: cls._id,
        absentTeacherId: teacher._id,
        substituteTeacherId: substitute._id,
      });

      const res = await request(app)
        .post(`${BASE}/${sub._id}/notify`)
        .set(headers)
        .send({ method: 'push' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.notification).toHaveProperty('method', 'push');
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /stats
  // ───────────────────────────────────────────────────────────────
  describe('GET /stats', () => {
    it('returns substitution statistics', async () => {
      const res = await request(app).get(`${BASE}/stats`).set(headers).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.stats).toHaveProperty('total');
      expect(res.body.stats).toHaveProperty('confirmed');
      expect(res.body.stats).toHaveProperty('pending');
    });
  });

  // ───────────────────────────────────────────────────────────────
  // POST /bulk-assign
  // ───────────────────────────────────────────────────────────────
  describe('POST /bulk-assign', () => {
    it('returns 400 when assignments array is empty or missing', async () => {
      const res = await request(app)
        .post(`${BASE}/bulk-assign`)
        .set(headers)
        .send({ assignments: [] })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it('processes bulk assignments and returns results', async () => {
      const sub = await createSubstitutionRecord({
        schoolId: school._id,
        classId: cls._id,
        substituteTeacherId: teacher._id,
        absentTeacherId: teacher._id,
      });

      const res = await request(app)
        .post(`${BASE}/bulk-assign`)
        .set(headers)
        .send({
          assignments: [
            {
              substitutionId: sub._id.toString(),
              substituteTeacherId: substitute._id.toString(),
            },
          ],
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.results).toHaveProperty('success');
      expect(res.body.results).toHaveProperty('failed');
    });
  });
});
