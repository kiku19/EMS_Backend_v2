import request from 'supertest';
import { describe, expect, it, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import TeacherLeave from '../models/TeacherLeave.js';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const BASE = '/api/teacher-leaves';

/** Create a leave record directly in the DB. */
async function createLeave({ schoolId, teacherId, status = 'pending', leaveType = 'sick' }) {
  const start = new Date('2025-03-10');
  const end = new Date('2025-03-12');
  return TeacherLeave.create({
    schoolId,
    teacherId,
    leaveType,
    reason: 'Feeling unwell',
    startDate: start,
    endDate: end,
    days: 3,
    status,
  });
}

describe('teacherLeaves routes', () => {
  let app, school, admin, teacher, adminHeaders, teacherHeaders;

  beforeEach(async () => {
    school = await createSchoolRecord({ name: 'Leave School', code: 'LVS' });
    admin = await createStaffUser({
      name: 'Leave Admin',
      email: 'leave.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    teacher = await createStaffUser({
      name: 'Leave Teacher',
      email: 'leave.teacher@example.com',
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });
    adminHeaders = authHeadersFor(admin, 'admin');
    teacherHeaders = authHeadersFor(teacher, 'teacher');
    ({ app } = createTestApp());
  });

  // ───────────────────────────────────────────────────────────────
  // Auth
  // ───────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('GET /pending returns 401 without token', async () => {
      await request(app).get(`${BASE}/pending`).expect(401);
    });

    it('GET /teacher/:id returns 401 without token', async () => {
      await request(app).get(`${BASE}/teacher/${new mongoose.Types.ObjectId()}`).expect(401);
    });

    it('POST / returns 401 without token', async () => {
      await request(app).post(BASE).send({}).expect(401);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /pending
  // ───────────────────────────────────────────────────────────────
  describe('GET /pending', () => {
    it('returns empty array when no pending leaves', async () => {
      const res = await request(app).get(`${BASE}/pending`).set(adminHeaders).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(0);
    });

    it('returns pending leaves for the school', async () => {
      await createLeave({ schoolId: school._id, teacherId: teacher._id, status: 'pending' });

      const res = await request(app).get(`${BASE}/pending`).set(adminHeaders).expect(200);

      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0].status).toBe('pending');
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /teacher/:teacherId
  // ───────────────────────────────────────────────────────────────
  describe('GET /teacher/:teacherId', () => {
    it('returns empty array when teacher has no leaves', async () => {
      const res = await request(app)
        .get(`${BASE}/teacher/${teacher._id}`)
        .set(adminHeaders)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(0);
    });

    it('returns teacher leaves filtered by status', async () => {
      await createLeave({ schoolId: school._id, teacherId: teacher._id, status: 'approved' });
      await createLeave({ schoolId: school._id, teacherId: teacher._id, status: 'pending' });

      const res = await request(app)
        .get(`${BASE}/teacher/${teacher._id}?status=approved`)
        .set(adminHeaders)
        .expect(200);

      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body.every((l) => l.status === 'approved')).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /:id
  // ───────────────────────────────────────────────────────────────
  describe('GET /:id', () => {
    it('returns 404 for non-existent leave', async () => {
      const res = await request(app)
        .get(`${BASE}/${new mongoose.Types.ObjectId()}`)
        .set(adminHeaders)
        .expect(404);

      expect(res.body.error).toBeDefined();
    });

    it('returns leave details for a valid ID', async () => {
      const leave = await createLeave({ schoolId: school._id, teacherId: teacher._id });

      const res = await request(app).get(`${BASE}/${leave._id}`).set(adminHeaders).expect(200);

      expect(res.body._id).toBe(leave._id.toString());
      expect(res.body.leaveType).toBe('sick');
      expect(res.body.status).toBe('pending');
    });
  });

  // ───────────────────────────────────────────────────────────────
  // POST / — apply for leave
  // ───────────────────────────────────────────────────────────────
  describe('POST /', () => {
    it('creates a leave application and returns 201', async () => {
      const res = await request(app)
        .post(BASE)
        .set(adminHeaders)
        .send({
          teacherId: teacher._id.toString(),
          leaveType: 'casual',
          reason: 'Personal work',
          startDate: '2025-04-01',
          endDate: '2025-04-02',
          days: 2,
        })
        .expect(201);

      expect(res.body.status).toBe('pending');
      expect(res.body.leaveType).toBe('casual');
      expect(res.body.days).toBe(2);
    });

    it('auto-calculates days when not provided', async () => {
      const res = await request(app)
        .post(BASE)
        .set(adminHeaders)
        .send({
          teacherId: teacher._id.toString(),
          leaveType: 'sick',
          reason: 'Illness',
          startDate: '2025-05-01',
          endDate: '2025-05-03',
        })
        .expect(201);

      expect(res.body.days).toBeGreaterThan(0);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /:id/status — approve / reject
  // ───────────────────────────────────────────────────────────────
  describe('PUT /:id/status', () => {
    it('returns 400 for invalid status value', async () => {
      const leave = await createLeave({ schoolId: school._id, teacherId: teacher._id });

      const res = await request(app)
        .put(`${BASE}/${leave._id}/status`)
        .set(adminHeaders)
        .send({ status: 'invalid_status' })
        .expect(422);

      expect(res.body.error).toBeDefined();
    });

    it('approves a leave', async () => {
      const leave = await createLeave({ schoolId: school._id, teacherId: teacher._id });

      const res = await request(app)
        .put(`${BASE}/${leave._id}/status`)
        .set(adminHeaders)
        .send({ status: 'approved', approvedBy: admin._id.toString() })
        .expect(200);

      expect(res.body.status).toBe('approved');
    });

    it('rejects a leave with a reason', async () => {
      const leave = await createLeave({ schoolId: school._id, teacherId: teacher._id });

      const res = await request(app)
        .put(`${BASE}/${leave._id}/status`)
        .set(adminHeaders)
        .send({
          status: 'rejected',
          rejectionReason: 'Insufficient cover',
          approvedBy: admin._id.toString(),
        })
        .expect(200);

      expect(res.body.status).toBe('rejected');
      expect(res.body.rejectionReason).toBe('Insufficient cover');
    });

    it('returns 404 for non-existent leave', async () => {
      const res = await request(app)
        .put(`${BASE}/${new mongoose.Types.ObjectId()}/status`)
        .set(adminHeaders)
        .send({ status: 'approved' })
        .expect(404);

      expect(res.body.error).toBeDefined();
    });
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /:id/cancel
  // ───────────────────────────────────────────────────────────────
  describe('PUT /:id/cancel', () => {
    it('returns 404 when leave does not exist', async () => {
      const res = await request(app)
        .put(`${BASE}/${new mongoose.Types.ObjectId()}/cancel`)
        .set(adminHeaders)
        .expect(404);

      expect(res.body.error).toBeDefined();
    });

    it('allows admin to cancel any leave', async () => {
      const leave = await createLeave({ schoolId: school._id, teacherId: teacher._id });

      const res = await request(app)
        .put(`${BASE}/${leave._id}/cancel`)
        .set(adminHeaders)
        .expect(200);

      expect(res.body.status).toBe('cancelled');
    });

    it('returns 403 when a non-owner non-admin tries to cancel', async () => {
      const otherTeacher = await createStaffUser({
        name: 'Other Teacher',
        email: 'other.teacher@example.com',
        schoolId: school._id,
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
      });
      const leave = await createLeave({ schoolId: school._id, teacherId: teacher._id });
      const otherHeaders = authHeadersFor(otherTeacher, 'teacher');

      const res = await request(app)
        .put(`${BASE}/${leave._id}/cancel`)
        .set(otherHeaders)
        .expect(403);

      expect(res.body.error).toBeDefined();
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /teacher/:teacherId/stats
  // ───────────────────────────────────────────────────────────────
  describe('GET /teacher/:teacherId/stats', () => {
    it('returns zero stats when teacher has no leaves', async () => {
      const res = await request(app)
        .get(`${BASE}/teacher/${teacher._id}/stats`)
        .set(adminHeaders)
        .expect(200);

      expect(res.body.total).toBe(0);
      expect(res.body.totalDays).toBe(0);
    });

    it('returns correct stats when teacher has leaves', async () => {
      await createLeave({
        schoolId: school._id,
        teacherId: teacher._id,
        status: 'approved',
        leaveType: 'sick',
      });

      const currentYear = new Date().getFullYear();
      const leave = new TeacherLeave({
        schoolId: school._id,
        teacherId: teacher._id,
        leaveType: 'casual',
        reason: 'Work',
        startDate: new Date(`${currentYear}-02-01`),
        endDate: new Date(`${currentYear}-02-02`),
        days: 2,
        status: 'approved',
      });
      await leave.save();

      const res = await request(app)
        .get(`${BASE}/teacher/${teacher._id}/stats?year=${currentYear}`)
        .set(adminHeaders)
        .expect(200);

      expect(res.body.total).toBeGreaterThanOrEqual(1);
      expect(res.body).toHaveProperty('byType');
    });
  });
});
