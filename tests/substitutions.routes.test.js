import request from 'supertest';
import { describe, expect, it, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Substitution } from '../database.js';
import {
  authHeadersFor,
  createSchoolRecord,
  createStaffUser,
  createClassRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const BASE = '/api/substitutions';

/** Create a substitution record directly in the DB. */
async function createSubstitution({
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
    type: 'manual',
    status: 'confirmed',
  });
}

describe('substitutions routes', () => {
  let app, school, admin, teacher1, teacher2, cls, headers;

  beforeEach(async () => {
    school = await createSchoolRecord({ name: 'Substitution School', code: 'SUB' });
    admin = await createStaffUser({
      name: 'Sub Admin',
      email: 'sub.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    teacher1 = await createStaffUser({
      name: 'Absent Teacher',
      email: 'absent.teacher@example.com',
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });
    teacher2 = await createStaffUser({
      name: 'Substitute Teacher',
      email: 'sub.teacher@example.com',
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });
    cls = await createClassRecord({ name: 'Class 9', section: 'B', schoolId: school._id });
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

    it('POST / returns 401 without token', async () => {
      await request(app).post(BASE).send({}).expect(401);
    });

    it('GET /:id returns 401 without token', async () => {
      await request(app).get(`${BASE}/${new mongoose.Types.ObjectId()}`).expect(401);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /
  // ───────────────────────────────────────────────────────────────
  describe('GET /', () => {
    it('returns empty array when no substitutions exist', async () => {
      const res = await request(app).get(BASE).set(headers).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(0);
    });

    it('returns substitutions scoped to the school', async () => {
      await createSubstitution({
        schoolId: school._id,
        classId: cls._id,
        substituteTeacherId: teacher2._id,
        absentTeacherId: teacher1._id,
      });

      const res = await request(app).get(BASE).set(headers).expect(200);

      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('filters substitutions by date', async () => {
      await createSubstitution({
        schoolId: school._id,
        classId: cls._id,
        substituteTeacherId: teacher2._id,
        date: '2025-03-10',
      });

      const res = await request(app).get(`${BASE}?date=2025-03-10`).set(headers).expect(200);

      expect(res.body.every((s) => s.date === '2025-03-10')).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /:id
  // ───────────────────────────────────────────────────────────────
  describe('GET /:id', () => {
    it('returns 404 for a non-existent substitution', async () => {
      const res = await request(app)
        .get(`${BASE}/${new mongoose.Types.ObjectId()}`)
        .set(headers)
        .expect(404);

      expect(res.body.error).toBeDefined();
    });

    it('returns the substitution by ID', async () => {
      const sub = await createSubstitution({
        schoolId: school._id,
        classId: cls._id,
        substituteTeacherId: teacher2._id,
        absentTeacherId: teacher1._id,
        date: '2025-03-11',
        period: '2',
      });

      const res = await request(app).get(`${BASE}/${sub._id}`).set(headers).expect(200);

      expect(res.body._id).toBe(sub._id.toString());
      expect(res.body.period).toBe('2');
    });
  });

  // ───────────────────────────────────────────────────────────────
  // POST / — create substitution
  // ───────────────────────────────────────────────────────────────
  describe('POST /', () => {
    it('returns 400 when required fields are missing', async () => {
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .send({ date: '2025-04-01' })
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it('returns 404 when class does not exist', async () => {
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .send({
          date: '2025-04-02',
          classId: new mongoose.Types.ObjectId().toString(),
          period: '1',
          substituteTeacherId: teacher2._id.toString(),
        })
        .expect(404);

      expect(res.body.error).toBeDefined();
    });

    it('returns 404 when substitute teacher does not exist', async () => {
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .send({
          date: '2025-04-03',
          classId: cls._id.toString(),
          period: '1',
          substituteTeacherId: new mongoose.Types.ObjectId().toString(),
        })
        .expect(404);

      expect(res.body.error).toBeDefined();
    });

    it('creates a substitution and returns 201', async () => {
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .send({
          date: '2025-04-04',
          classId: cls._id.toString(),
          period: '3',
          absentTeacherId: teacher1._id.toString(),
          substituteTeacherId: teacher2._id.toString(),
          reason: 'Sick leave',
          type: 'manual',
        })
        .expect(201);

      expect(res.body.period).toBe('3');
      expect(res.body.status).toBe('confirmed');
    });

    it('returns 400 when substitution already exists for same date/class/period', async () => {
      await createSubstitution({
        schoolId: school._id,
        classId: cls._id,
        substituteTeacherId: teacher2._id,
        date: '2025-04-05',
        period: '1',
      });

      const res = await request(app)
        .post(BASE)
        .set(headers)
        .send({
          date: '2025-04-05',
          classId: cls._id.toString(),
          period: '1',
          substituteTeacherId: teacher2._id.toString(),
        })
        .expect(400);

      expect(res.body.error).toBeDefined();
    });
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /:id — update substitution
  // ───────────────────────────────────────────────────────────────
  describe('PUT /:id', () => {
    it('returns 404 for non-existent substitution', async () => {
      const res = await request(app)
        .put(`${BASE}/${new mongoose.Types.ObjectId()}`)
        .set(headers)
        .send({ notes: 'Updated' })
        .expect(404);

      expect(res.body.error).toBeDefined();
    });

    it('updates notes and status on an existing substitution', async () => {
      const sub = await createSubstitution({
        schoolId: school._id,
        classId: cls._id,
        substituteTeacherId: teacher2._id,
        date: '2025-05-01',
        period: '4',
      });

      const res = await request(app)
        .put(`${BASE}/${sub._id}`)
        .set(headers)
        .send({ notes: 'Updated notes', status: 'completed' })
        .expect(200);

      expect(res.body.notes).toBe('Updated notes');
      expect(res.body.status).toBe('completed');
    });
  });

  // ───────────────────────────────────────────────────────────────
  // DELETE /:id
  // ───────────────────────────────────────────────────────────────
  describe('DELETE /:id', () => {
    it('returns 404 for non-existent substitution', async () => {
      const res = await request(app)
        .delete(`${BASE}/${new mongoose.Types.ObjectId()}`)
        .set(headers)
        .expect(404);

      expect(res.body.error).toBeDefined();
    });

    it('deletes a substitution', async () => {
      const sub = await createSubstitution({
        schoolId: school._id,
        classId: cls._id,
        substituteTeacherId: teacher2._id,
        date: '2025-06-01',
        period: '5',
      });

      const res = await request(app).delete(`${BASE}/${sub._id}`).set(headers).expect(200);

      expect(res.body.success).toBe(true);

      const deleted = await Substitution.findById(sub._id);
      expect(deleted).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /date/:date
  // ───────────────────────────────────────────────────────────────
  describe('GET /date/:date', () => {
    it('returns substitutions for a specific date', async () => {
      await createSubstitution({
        schoolId: school._id,
        classId: cls._id,
        substituteTeacherId: teacher2._id,
        date: '2025-07-01',
        period: '1',
      });

      const res = await request(app).get(`${BASE}/date/2025-07-01`).set(headers).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('returns empty array for a date with no substitutions', async () => {
      const res = await request(app).get(`${BASE}/date/2099-01-01`).set(headers).expect(200);

      expect(res.body).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /teacher/:teacherId
  // ───────────────────────────────────────────────────────────────
  describe('GET /teacher/:teacherId', () => {
    it('returns substitutions where teacher is absent or substitute', async () => {
      await createSubstitution({
        schoolId: school._id,
        classId: cls._id,
        substituteTeacherId: teacher2._id,
        absentTeacherId: teacher1._id,
        date: '2025-08-01',
        period: '2',
      });

      const res = await request(app)
        .get(`${BASE}/teacher/${teacher2._id}`)
        .set(headers)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('returns empty array for teacher with no substitutions', async () => {
      const newTeacher = await createStaffUser({
        name: 'No Sub Teacher',
        email: 'nosub.teacher@example.com',
        schoolId: school._id,
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
      });

      const res = await request(app)
        .get(`${BASE}/teacher/${newTeacher._id}`)
        .set(headers)
        .expect(200);

      expect(res.body).toHaveLength(0);
    });
  });
});
