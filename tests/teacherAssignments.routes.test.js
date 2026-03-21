import request from 'supertest';
import { describe, expect, it, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import {
  authHeadersFor,
  createSchoolRecord,
  createStaffUser,
  createClassRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const BASE = '/api/teacher-assignments';

describe('teacherAssignments routes', () => {
  let app, school, admin, teacher, headers, cls;

  beforeEach(async () => {
    school = await createSchoolRecord({ name: 'Assignment School', code: 'ASN' });
    admin = await createStaffUser({
      name: 'Assignment Admin',
      email: 'assignment.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    teacher = await createStaffUser({
      name: 'Assignment Teacher',
      email: 'assignment.teacher@example.com',
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });
    cls = await createClassRecord({ name: 'Class 10', section: 'A', schoolId: school._id });
    headers = authHeadersFor(admin, 'admin');
    ({ app } = createTestApp());
  });

  // ───────────────────────────────────────────────────────────────
  // Auth
  // ───────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('GET /available-teachers returns 401 without token', async () => {
      await request(app).get(`${BASE}/available-teachers`).expect(401);
    });

    it('GET /:teacherId returns 401 without token', async () => {
      await request(app).get(`${BASE}/${new mongoose.Types.ObjectId()}`).expect(401);
    });

    it('POST / returns 401 without token', async () => {
      await request(app).post(BASE).send({}).expect(401);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /available-teachers
  // ───────────────────────────────────────────────────────────────
  describe('GET /available-teachers', () => {
    it('returns 400 when classId is missing', async () => {
      const res = await request(app)
        .get(`${BASE}/available-teachers?subject=Math`)
        .set(headers)
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it('returns 400 when subject is missing', async () => {
      const res = await request(app)
        .get(`${BASE}/available-teachers?classId=${cls._id}`)
        .set(headers)
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it('returns 404 when class does not exist', async () => {
      const res = await request(app)
        .get(`${BASE}/available-teachers?classId=${new mongoose.Types.ObjectId()}&subject=Math`)
        .set(headers)
        .expect(404);

      expect(res.body.error).toBeDefined();
    });

    it('returns available teachers for valid classId and subject', async () => {
      const res = await request(app)
        .get(`${BASE}/available-teachers?classId=${cls._id}&subject=Math`)
        .set(headers)
        .expect(200);

      expect(res.body).toHaveProperty('available');
      expect(Array.isArray(res.body.available)).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /:teacherId
  // ───────────────────────────────────────────────────────────────
  describe('GET /:teacherId', () => {
    it('returns 404 when teacher does not exist', async () => {
      const res = await request(app)
        .get(`${BASE}/${new mongoose.Types.ObjectId()}`)
        .set(headers)
        .expect(404);

      expect(res.body.error).toBeDefined();
    });

    it('returns teacher assignments (empty initially)', async () => {
      const res = await request(app).get(`${BASE}/${teacher._id}`).set(headers).expect(200);

      expect(res.body.teacherId).toBe(teacher._id.toString());
      expect(Array.isArray(res.body.assignments)).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // POST / — create assignment
  // ───────────────────────────────────────────────────────────────
  describe('POST /', () => {
    it('returns 400 when required fields are missing', async () => {
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .send({ teacherId: teacher._id.toString() })
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it('returns 404 when teacher does not exist', async () => {
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .send({
          teacherId: new mongoose.Types.ObjectId().toString(),
          subject: 'Math',
          classIds: [cls._id.toString()],
        })
        .expect(404);

      expect(res.body.error).toBeDefined();
    });

    it('returns 400 when one or more classIds do not exist', async () => {
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .send({
          teacherId: teacher._id.toString(),
          subject: 'Science',
          classIds: [new mongoose.Types.ObjectId().toString()],
        })
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it('creates a new assignment and returns 201', async () => {
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .send({
          teacherId: teacher._id.toString(),
          subject: 'Math',
          classIds: [cls._id.toString()],
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.assignment).toBeDefined();
      expect(res.body.assignment.subject).toBe('Math');
    });

    it('adds classes to an existing assignment without duplicates', async () => {
      // Create the assignment first
      await request(app)
        .post(BASE)
        .set(headers)
        .send({
          teacherId: teacher._id.toString(),
          subject: 'Math',
          classIds: [cls._id.toString()],
        })
        .expect(201);

      // Add same class again — should not duplicate
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .send({
          teacherId: teacher._id.toString(),
          subject: 'Math',
          classIds: [cls._id.toString()],
        })
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // DELETE /:id — delete assignment
  // ───────────────────────────────────────────────────────────────
  describe('DELETE /:id', () => {
    it('returns 400 when teacherId query param is missing', async () => {
      const res = await request(app)
        .delete(`${BASE}/${new mongoose.Types.ObjectId()}`)
        .set(headers)
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it('returns 404 when teacher does not exist', async () => {
      const res = await request(app)
        .delete(
          `${BASE}/${new mongoose.Types.ObjectId()}?teacherId=${new mongoose.Types.ObjectId()}`
        )
        .set(headers)
        .expect(404);

      expect(res.body.error).toBeDefined();
    });

    it('returns 404 when assignment subdocument does not exist', async () => {
      const res = await request(app)
        .delete(`${BASE}/${new mongoose.Types.ObjectId()}?teacherId=${teacher._id}`)
        .set(headers)
        .expect(404);

      expect(res.body.error).toBeDefined();
    });

    it('deletes an existing assignment', async () => {
      // Create first
      const createRes = await request(app)
        .post(BASE)
        .set(headers)
        .send({
          teacherId: teacher._id.toString(),
          subject: 'History',
          classIds: [cls._id.toString()],
        })
        .expect(201);

      const assignmentId = createRes.body.assignment._id;

      const res = await request(app)
        .delete(`${BASE}/${assignmentId}?teacherId=${teacher._id}`)
        .set(headers)
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });
});
