import request from 'supertest';
import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import PTMSession from '../models/PTMSession.js';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

async function setupSchoolWithAdmin(schoolName = 'PTM School') {
  const school = await createSchoolRecord({ name: schoolName });
  const admin = await createStaffUser({ schoolId: school._id });
  return { school, admin };
}

async function createTeacher(schoolId, name = 'PTM Teacher') {
  return createStaffUser({
    name,
    staffRole: ['Teacher'],
    permissionRole: 'teacher',
    schoolId,
  });
}

function sessionPayload(classId, staffId, overrides = {}) {
  return {
    title: 'Test PTM',
    description: 'Unit test session',
    sessionDate: '2026-04-15',
    startTime: '09:00',
    endTime: '13:00',
    slotDuration: 15,
    classId: classId.toString(),
    staffId: staffId.toString(),
    venue: 'Room 101',
    ...overrides,
  };
}

describe('ptm routes', () => {
  // ─── AUTH ──────────────────────────────────────────────────────────────

  describe('authentication', () => {
    it('returns 401 when no token is provided', async () => {
      const { app } = createTestApp();
      const fakeId = new mongoose.Types.ObjectId().toString();

      await request(app).get('/api/ptm').expect(401);
      await request(app).get(`/api/ptm/${fakeId}`).expect(401);
      await request(app).post('/api/ptm').send({}).expect(401);
      await request(app).put(`/api/ptm/${fakeId}`).send({}).expect(401);
      await request(app).delete(`/api/ptm/${fakeId}`).expect(401);
      await request(app).post(`/api/ptm/${fakeId}/slots`).send({}).expect(401);
    });
  });

  // ─── GET LIST ──────────────────────────────────────────────────────────

  describe('GET /api/ptm — List sessions', () => {
    it('returns all PTM sessions for the school', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacher(school._id);
      const cls = await createClassRecord({ schoolId: school._id });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      await PTMSession.create({
        schoolId: school._id,
        title: 'Session 1',
        sessionDate: new Date('2026-04-15'),
        startTime: '09:00',
        endTime: '11:00',
        classId: cls._id,
        staffId: teacher._id,
      });

      const res = await request(app).get('/api/ptm').set(headers).expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0]).toHaveProperty('title');
    });

    it('filters by classId query param', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacher(school._id);
      const clsA = await createClassRecord({ name: 'Class A', schoolId: school._id });
      const clsB = await createClassRecord({ name: 'Class B', schoolId: school._id });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      await PTMSession.create({
        schoolId: school._id,
        title: 'Session A',
        sessionDate: new Date('2026-04-15'),
        startTime: '09:00',
        endTime: '11:00',
        classId: clsA._id,
        staffId: teacher._id,
      });
      await PTMSession.create({
        schoolId: school._id,
        title: 'Session B',
        sessionDate: new Date('2026-04-16'),
        startTime: '09:00',
        endTime: '11:00',
        classId: clsB._id,
        staffId: teacher._id,
      });

      const res = await request(app)
        .get('/api/ptm')
        .set(headers)
        .query({ classId: clsA._id.toString() })
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].title).toBe('Session A');
    });

    it('filters by status query param', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacher(school._id);
      const cls = await createClassRecord({ schoolId: school._id });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      await PTMSession.create({
        schoolId: school._id,
        title: 'Scheduled Session',
        sessionDate: new Date('2026-04-15'),
        startTime: '09:00',
        endTime: '11:00',
        classId: cls._id,
        staffId: teacher._id,
        status: 'scheduled',
      });
      await PTMSession.create({
        schoolId: school._id,
        title: 'Cancelled Session',
        sessionDate: new Date('2026-04-16'),
        startTime: '09:00',
        endTime: '11:00',
        classId: cls._id,
        staffId: teacher._id,
        status: 'cancelled',
      });

      const res = await request(app)
        .get('/api/ptm')
        .set(headers)
        .query({ status: 'scheduled' })
        .expect(200);

      expect(res.body.data.every((s) => s.status === 'scheduled')).toBe(true);
    });

    it('filters by date range', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacher(school._id);
      const cls = await createClassRecord({ schoolId: school._id });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      await PTMSession.create({
        schoolId: school._id,
        title: 'April Session',
        sessionDate: new Date('2026-04-15'),
        startTime: '09:00',
        endTime: '11:00',
        classId: cls._id,
        staffId: teacher._id,
      });
      await PTMSession.create({
        schoolId: school._id,
        title: 'May Session',
        sessionDate: new Date('2026-05-15'),
        startTime: '09:00',
        endTime: '11:00',
        classId: cls._id,
        staffId: teacher._id,
      });

      const res = await request(app)
        .get('/api/ptm')
        .set(headers)
        .query({ from: '2026-04-01', to: '2026-04-30' })
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].title).toBe('April Session');
    });
  });

  // ─── GET BY ID ─────────────────────────────────────────────────────────

  describe('GET /api/ptm/:id — Get single session', () => {
    it('returns a session with populated slots', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacher(school._id);
      const cls = await createClassRecord({ schoolId: school._id });
      const student = await createStudentRecord({ schoolId: school._id, classId: cls._id });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const session = await PTMSession.create({
        schoolId: school._id,
        title: 'Detail Session',
        sessionDate: new Date('2026-04-15'),
        startTime: '09:00',
        endTime: '11:00',
        classId: cls._id,
        staffId: teacher._id,
        slots: [
          {
            studentId: student._id,
            parentName: 'Parent One',
            scheduledTime: '09:00',
            status: 'booked',
          },
        ],
      });

      const res = await request(app).get(`/api/ptm/${session._id}`).set(headers).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toBe('Detail Session');
      expect(Array.isArray(res.body.data.slots)).toBe(true);
      expect(res.body.data.slots).toHaveLength(1);
    });

    it('returns 404 for non-existent session', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');
      const fakeId = new mongoose.Types.ObjectId().toString();

      const res = await request(app).get(`/api/ptm/${fakeId}`).set(headers).expect(404);

      expect(res.body.success).toBe(false);
    });
  });

  // ─── POST CREATE ───────────────────────────────────────────────────────

  describe('POST /api/ptm — Create session', () => {
    it('creates a PTM session and returns populated document', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacher(school._id);
      const cls = await createClassRecord({ schoolId: school._id });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .post('/api/ptm')
        .set(headers)
        .send(sessionPayload(cls._id, teacher._id))
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toBe('Test PTM');
      expect(res.body.data.status).toBe('scheduled');
      expect(res.body.data.classId._id.toString()).toBe(cls._id.toString());
    });

    it('returns 400 for invalid body (missing title)', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacher(school._id);
      const cls = await createClassRecord({ schoolId: school._id });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const payload = sessionPayload(cls._id, teacher._id);
      delete payload.title;

      const res = await request(app).post('/api/ptm').set(headers).send(payload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when startTime is after endTime', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacher(school._id);
      const cls = await createClassRecord({ schoolId: school._id });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .post('/api/ptm')
        .set(headers)
        .send(sessionPayload(cls._id, teacher._id, { startTime: '14:00', endTime: '09:00' }));

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 409 when teacher has overlapping session on same date', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacher(school._id);
      const cls = await createClassRecord({ schoolId: school._id });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      await request(app)
        .post('/api/ptm')
        .set(headers)
        .send(sessionPayload(cls._id, teacher._id, { startTime: '09:00', endTime: '11:00' }))
        .expect(201);

      const res = await request(app)
        .post('/api/ptm')
        .set(headers)
        .send(sessionPayload(cls._id, teacher._id, { startTime: '10:00', endTime: '12:00' }));

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already has a PTM session/i);
    });
  });

  // ─── PUT UPDATE ────────────────────────────────────────────────────────

  describe('PUT /api/ptm/:id — Update session', () => {
    it('updates session fields', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacher(school._id);
      const cls = await createClassRecord({ schoolId: school._id });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const createRes = await request(app)
        .post('/api/ptm')
        .set(headers)
        .send(sessionPayload(cls._id, teacher._id))
        .expect(201);

      const sessionId = createRes.body.data._id;

      const res = await request(app)
        .put(`/api/ptm/${sessionId}`)
        .set(headers)
        .send({ title: 'Updated Title', venue: 'Room 202' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toBe('Updated Title');
      expect(res.body.data.venue).toBe('Room 202');
    });

    it('returns 404 for non-existent session', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');
      const fakeId = new mongoose.Types.ObjectId().toString();

      const res = await request(app).put(`/api/ptm/${fakeId}`).set(headers).send({ title: 'Nope' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 for invalid status transition', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacher(school._id);
      const cls = await createClassRecord({ schoolId: school._id });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const createRes = await request(app)
        .post('/api/ptm')
        .set(headers)
        .send(sessionPayload(cls._id, teacher._id))
        .expect(201);

      const sessionId = createRes.body.data._id;

      // Try to transition from scheduled → completed (must go through ongoing)
      const res = await request(app)
        .put(`/api/ptm/${sessionId}`)
        .set(headers)
        .send({ status: 'completed' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Cannot transition/i);
    });
  });

  // ─── DELETE / SOFT-DELETE ──────────────────────────────────────────────

  describe('DELETE /api/ptm/:id — Cancel session', () => {
    it('soft-deletes a session and sets status to cancelled', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacher(school._id);
      const cls = await createClassRecord({ schoolId: school._id });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const createRes = await request(app)
        .post('/api/ptm')
        .set(headers)
        .send(sessionPayload(cls._id, teacher._id))
        .expect(201);

      const sessionId = createRes.body.data._id;

      const res = await request(app).delete(`/api/ptm/${sessionId}`).set(headers).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/cancelled/i);

      const deleted = await PTMSession.findById(sessionId);
      expect(deleted.isDeleted).toBe(true);
      expect(deleted.status).toBe('cancelled');
    });

    it('returns 404 for non-existent session', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');
      const fakeId = new mongoose.Types.ObjectId().toString();

      const res = await request(app).delete(`/api/ptm/${fakeId}`).set(headers);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ─── SLOTS ─────────────────────────────────────────────────────────────

  describe('POST /api/ptm/:id/slots — Add slot', () => {
    it('adds a slot to a session', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacher(school._id);
      const cls = await createClassRecord({ schoolId: school._id });
      const student = await createStudentRecord({ schoolId: school._id, classId: cls._id });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const createRes = await request(app)
        .post('/api/ptm')
        .set(headers)
        .send(sessionPayload(cls._id, teacher._id))
        .expect(201);

      const sessionId = createRes.body.data._id;

      const res = await request(app)
        .post(`/api/ptm/${sessionId}/slots`)
        .set(headers)
        .send({
          studentId: student._id.toString(),
          parentName: 'Parent One',
          parentPhone: '9876543210',
          scheduledTime: '09:00',
          notes: 'First slot',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.studentId._id.toString()).toBe(student._id.toString());
      expect(res.body.data.scheduledTime).toBe('09:00');
    });

    it('returns 409 for duplicate student booking in same session', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacher(school._id);
      const cls = await createClassRecord({ schoolId: school._id });
      const student = await createStudentRecord({ schoolId: school._id, classId: cls._id });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const createRes = await request(app)
        .post('/api/ptm')
        .set(headers)
        .send(sessionPayload(cls._id, teacher._id))
        .expect(201);

      const sessionId = createRes.body.data._id;

      await request(app)
        .post(`/api/ptm/${sessionId}/slots`)
        .set(headers)
        .send({
          studentId: student._id.toString(),
          parentName: 'Parent One',
          scheduledTime: '09:00',
        })
        .expect(201);

      const res = await request(app).post(`/api/ptm/${sessionId}/slots`).set(headers).send({
        studentId: student._id.toString(),
        parentName: 'Parent One',
        scheduledTime: '09:30',
      });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/already has a booking/i);
    });

    it('returns 409 for overlapping time slots', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacher(school._id);
      const cls = await createClassRecord({ schoolId: school._id });
      const studentA = await createStudentRecord({ schoolId: school._id, classId: cls._id });
      const studentB = await createStudentRecord({ schoolId: school._id, classId: cls._id });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const createRes = await request(app)
        .post('/api/ptm')
        .set(headers)
        .send(sessionPayload(cls._id, teacher._id))
        .expect(201);

      const sessionId = createRes.body.data._id;

      await request(app)
        .post(`/api/ptm/${sessionId}/slots`)
        .set(headers)
        .send({
          studentId: studentA._id.toString(),
          parentName: 'Parent A',
          scheduledTime: '09:00',
        })
        .expect(201);

      const res = await request(app).post(`/api/ptm/${sessionId}/slots`).set(headers).send({
        studentId: studentB._id.toString(),
        parentName: 'Parent B',
        scheduledTime: '09:10',
      });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/overlaps/i);
    });

    it('returns 400 when slot time is outside session hours', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacher(school._id);
      const cls = await createClassRecord({ schoolId: school._id });
      const student = await createStudentRecord({ schoolId: school._id, classId: cls._id });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const createRes = await request(app)
        .post('/api/ptm')
        .set(headers)
        .send(sessionPayload(cls._id, teacher._id))
        .expect(201);

      const sessionId = createRes.body.data._id;

      const res = await request(app).post(`/api/ptm/${sessionId}/slots`).set(headers).send({
        studentId: student._id.toString(),
        parentName: 'Parent One',
        scheduledTime: '14:00',
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/within session hours/i);
    });
  });

  describe('PUT /api/ptm/:sessionId/slots/:slotId — Update slot', () => {
    it('updates slot status and notes', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacher(school._id);
      const cls = await createClassRecord({ schoolId: school._id });
      const student = await createStudentRecord({ schoolId: school._id, classId: cls._id });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const createRes = await request(app)
        .post('/api/ptm')
        .set(headers)
        .send(sessionPayload(cls._id, teacher._id))
        .expect(201);

      const sessionId = createRes.body.data._id;

      const slotRes = await request(app)
        .post(`/api/ptm/${sessionId}/slots`)
        .set(headers)
        .send({
          studentId: student._id.toString(),
          parentName: 'Parent One',
          scheduledTime: '09:00',
        })
        .expect(201);

      const slotId = slotRes.body.data._id;

      const res = await request(app)
        .put(`/api/ptm/${sessionId}/slots/${slotId}`)
        .set(headers)
        .send({ status: 'completed', notes: 'Meeting done' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('completed');
      expect(res.body.data.notes).toBe('Meeting done');
    });

    it('returns 404 for non-existent slot', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacher(school._id);
      const cls = await createClassRecord({ schoolId: school._id });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const createRes = await request(app)
        .post('/api/ptm')
        .set(headers)
        .send(sessionPayload(cls._id, teacher._id))
        .expect(201);

      const sessionId = createRes.body.data._id;
      const fakeSlotId = new mongoose.Types.ObjectId().toString();

      const res = await request(app)
        .put(`/api/ptm/${sessionId}/slots/${fakeSlotId}`)
        .set(headers)
        .send({ status: 'completed' });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/ptm/:sessionId/slots/:slotId — Cancel slot', () => {
    it('cancels a slot by setting status to cancelled', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacher(school._id);
      const cls = await createClassRecord({ schoolId: school._id });
      const student = await createStudentRecord({ schoolId: school._id, classId: cls._id });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const createRes = await request(app)
        .post('/api/ptm')
        .set(headers)
        .send(sessionPayload(cls._id, teacher._id))
        .expect(201);

      const sessionId = createRes.body.data._id;

      const slotRes = await request(app)
        .post(`/api/ptm/${sessionId}/slots`)
        .set(headers)
        .send({
          studentId: student._id.toString(),
          parentName: 'Parent One',
          scheduledTime: '09:00',
        })
        .expect(201);

      const slotId = slotRes.body.data._id;

      const res = await request(app)
        .delete(`/api/ptm/${sessionId}/slots/${slotId}`)
        .set(headers)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/cancelled/i);

      const session = await PTMSession.findById(sessionId);
      const slot = session.slots.id(slotId);
      expect(slot.status).toBe('cancelled');
    });

    it('returns 404 for non-existent slot', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacher(school._id);
      const cls = await createClassRecord({ schoolId: school._id });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const createRes = await request(app)
        .post('/api/ptm')
        .set(headers)
        .send(sessionPayload(cls._id, teacher._id))
        .expect(201);

      const sessionId = createRes.body.data._id;
      const fakeSlotId = new mongoose.Types.ObjectId().toString();

      const res = await request(app)
        .delete(`/api/ptm/${sessionId}/slots/${fakeSlotId}`)
        .set(headers);

      expect(res.status).toBe(404);
    });
  });

  // ─── MULTI-TENANCY ─────────────────────────────────────────────────────

  describe('multi-tenancy', () => {
    it('school A admin cannot see school B PTM sessions', async () => {
      const schoolA = await createSchoolRecord({ name: 'PTM School A', code: 'PTM-A' });
      const schoolB = await createSchoolRecord({ name: 'PTM School B', code: 'PTM-B' });
      const adminA = await createStaffUser({ schoolId: schoolA._id });
      const teacherB = await createStaffUser({
        schoolId: schoolB._id,
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
      });
      const clsB = await createClassRecord({ schoolId: schoolB._id });

      await PTMSession.create({
        schoolId: schoolB._id,
        title: 'School B Session',
        sessionDate: new Date('2026-04-15'),
        startTime: '09:00',
        endTime: '11:00',
        classId: clsB._id,
        staffId: teacherB._id,
      });

      const { app } = createTestApp();
      const headersA = authHeadersFor(adminA, 'admin');

      const res = await request(app).get('/api/ptm').set(headersA).expect(200);

      expect(res.body.data).toHaveLength(0);
    });

    it('school A admin cannot update school B session', async () => {
      const schoolA = await createSchoolRecord({ name: 'PTM School A2', code: 'PTM-A2' });
      const schoolB = await createSchoolRecord({ name: 'PTM School B2', code: 'PTM-B2' });
      const adminA = await createStaffUser({ schoolId: schoolA._id });
      const teacherB = await createStaffUser({
        schoolId: schoolB._id,
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
      });
      const clsB = await createClassRecord({ schoolId: schoolB._id });

      const session = await PTMSession.create({
        schoolId: schoolB._id,
        title: 'School B Session',
        sessionDate: new Date('2026-04-15'),
        startTime: '09:00',
        endTime: '11:00',
        classId: clsB._id,
        staffId: teacherB._id,
      });

      const { app } = createTestApp();
      const headersA = authHeadersFor(adminA, 'admin');

      const res = await request(app)
        .put(`/api/ptm/${session._id}`)
        .set(headersA)
        .send({ title: 'Hacked' });

      expect(res.status).toBe(404);
    });
  });
});
