import request from 'supertest';
import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Class, TeacherTimetable } from '../database.js';
import {
  authHeadersFor,
  createSchoolRecord,
  createStaffUser,
  createClassRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const BASE = '/api/mobile';

describe('mobile routes', () => {
  let app, school, teacher, teacherHeaders, admin, adminHeaders;

  beforeEach(async () => {
    school = await createSchoolRecord({ name: 'Mobile School', code: 'MOB' });
    teacher = await createStaffUser({
      name: 'Mobile Teacher',
      email: 'mobile.teacher@example.com',
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });
    admin = await createStaffUser({
      name: 'Mobile Admin',
      email: 'mobile.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    teacherHeaders = authHeadersFor(teacher, 'teacher');
    adminHeaders = authHeadersFor(admin, 'admin');
    ({ app } = createTestApp());
  });

  // ───────────────────────────────────────────────────────────────
  // Auth — all teacher routes require authentication
  // ───────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('GET /teacher/:id/dashboard returns 401 without token', async () => {
      await request(app)
        .get(`${BASE}/teacher/${new mongoose.Types.ObjectId()}/dashboard`)
        .expect(401);
    });

    it('GET /teacher/:id/timetable returns 401 without token', async () => {
      await request(app)
        .get(`${BASE}/teacher/${new mongoose.Types.ObjectId()}/timetable`)
        .expect(401);
    });

    it('GET /teacher/:id/class-students returns 401 without token', async () => {
      await request(app)
        .get(`${BASE}/teacher/${new mongoose.Types.ObjectId()}/class-students`)
        .expect(401);
    });

    it('GET /staff/:id/profile returns 401 without token', async () => {
      await request(app).get(`${BASE}/staff/${new mongoose.Types.ObjectId()}/profile`).expect(401);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // Access control — teachers can only access their own data
  // ───────────────────────────────────────────────────────────────
  describe('access control', () => {
    it('teacher cannot access another teacher dashboard (403)', async () => {
      const otherId = new mongoose.Types.ObjectId().toString();

      const res = await request(app)
        .get(`${BASE}/teacher/${otherId}/dashboard`)
        .set(teacherHeaders)
        .expect(403);

      expect(res.body.error).toMatch(/forbidden/i);
    });

    it('admin can access any teacher dashboard (no 403)', async () => {
      // Admin tries to access a non-existent teacher → 404, not 403
      const fakeId = new mongoose.Types.ObjectId().toString();

      const res = await request(app).get(`${BASE}/teacher/${fakeId}/dashboard`).set(adminHeaders);

      expect(res.status).not.toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /teacher/:teacherId/dashboard
  // ───────────────────────────────────────────────────────────────
  describe('GET /teacher/:teacherId/dashboard', () => {
    it('returns 404 when teacher does not exist in school', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();

      const res = await request(app)
        .get(`${BASE}/teacher/${fakeId}/dashboard`)
        .set(adminHeaders)
        .expect(404);

      expect(res.body.error).toMatch(/not found/i);
    });

    it('returns dashboard data for existing teacher', async () => {
      const res = await request(app)
        .get(`${BASE}/teacher/${teacher._id}/dashboard`)
        .set(teacherHeaders)
        .expect(200);

      expect(res.body.teacher).toBeDefined();
      expect(res.body.teacher.id).toBe(teacher._id.toString());
      expect(res.body.attendance).toBeDefined();
      expect(res.body.timetable).toBeDefined();
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /teacher/:teacherId/timetable
  // ───────────────────────────────────────────────────────────────
  describe('GET /teacher/:teacherId/timetable', () => {
    it('returns empty schedule when no timetable exists', async () => {
      const res = await request(app)
        .get(`${BASE}/teacher/${teacher._id}/timetable`)
        .set(teacherHeaders)
        .expect(200);

      expect(res.body).toHaveProperty('schedule');
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /teacher/:teacherId/class-students
  // ───────────────────────────────────────────────────────────────
  describe('GET /teacher/:teacherId/class-students', () => {
    it('returns 404 when teacher is not a class teacher', async () => {
      await request(app)
        .get(`${BASE}/teacher/${teacher._id}/class-students`)
        .set(teacherHeaders)
        .expect(404);
    });

    it('returns students when teacher is a class teacher', async () => {
      await createClassRecord({
        name: 'Class 5',
        section: 'A',
        classTeacherId: teacher._id,
        schoolId: school._id,
      });

      const res = await request(app)
        .get(`${BASE}/teacher/${teacher._id}/class-students`)
        .set(teacherHeaders)
        .expect(200);

      expect(res.body.class).toBeDefined();
      expect(Array.isArray(res.body.students)).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /staff/:staffId/profile
  // ───────────────────────────────────────────────────────────────
  describe('GET /staff/:staffId/profile', () => {
    it('returns 404 for non-existent staff', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();

      await request(app).get(`${BASE}/staff/${fakeId}/profile`).set(adminHeaders).expect(404);
    });

    it('returns profile data for existing staff', async () => {
      const res = await request(app)
        .get(`${BASE}/staff/${teacher._id}/profile`)
        .set(teacherHeaders)
        .expect(200);

      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('Mobile Teacher');
      expect(res.body.email).toBe('mobile.teacher@example.com');
    });
  });

  // ───────────────────────────────────────────────────────────────
  // POST /teacher/:teacherId/attendance
  // ───────────────────────────────────────────────────────────────
  describe('POST /teacher/:teacherId/attendance', () => {
    it('marks teacher attendance for today', async () => {
      const res = await request(app)
        .post(`${BASE}/teacher/${teacher._id}/attendance`)
        .set(teacherHeaders)
        .send({ status: 'present', inTime: '09:00', outTime: '' })
        .expect(200);

      expect(res.body.status).toBe('present');
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /teacher/:teacherId/announcements
  // ───────────────────────────────────────────────────────────────
  describe('GET /teacher/:teacherId/announcements', () => {
    it('returns announcements list', async () => {
      const res = await request(app)
        .get(`${BASE}/teacher/${teacher._id}/announcements`)
        .set(teacherHeaders)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });
});
