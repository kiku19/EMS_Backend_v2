import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import GoogleClassroomSync from '../models/GoogleClassroomSync.js';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

vi.mock('../services/googleClassroomService.js', () => ({
  buildAuthUrl: vi.fn().mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?mock=true'),
  exchangeCodeForTokens: vi.fn().mockResolvedValue({
    accessToken: 'mock-access',
    refreshToken: 'mock-refresh',
    expiresAt: new Date(Date.now() + 3600 * 1000),
    scopes: ['classroom.courses.readonly'],
    email: 'teacher@example.com',
  }),
  listCourses: vi
    .fn()
    .mockResolvedValue([{ id: 'c1', name: 'Math 101', section: 'A', courseState: 'ACTIVE' }]),
  runSync: vi.fn().mockResolvedValue(undefined),
}));

const BASE = '/api/google-classroom';

describe('googleClassroom routes', () => {
  async function setup() {
    const school = await createSchoolRecord({ name: 'GC School', code: 'GC' });
    const admin = await createStaffUser({
      name: 'GC Admin',
      email: 'gc.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    const teacher = await createStaffUser({
      name: 'GC Teacher',
      email: 'gc.teacher@example.com',
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });
    const { app } = createTestApp();
    return { school, admin, teacher, app };
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('returns 401 without token', async () => {
      const { app } = createTestApp();
      await request(app).get(`${BASE}/status`).expect(401);
    });
  });

  // ── GET /google-classroom/status ──────────────────────────────────────────
  describe('GET /google-classroom/status', () => {
    it('returns disconnected when no record exists', async () => {
      const { admin, app } = await setup();
      const res = await request(app)
        .get(`${BASE}/status`)
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);
      expect(res.body.data.isConnected).toBe(false);
      expect(res.body.data.connectedEmail).toBeNull();
    });

    it('returns connected status', async () => {
      const { school, admin, app } = await setup();
      await GoogleClassroomSync.create({
        schoolId: school._id,
        isConnected: true,
        oauth: { connectedEmail: 'admin@example.com' },
      });

      const res = await request(app)
        .get(`${BASE}/status`)
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);
      expect(res.body.data.isConnected).toBe(true);
      expect(res.body.data.connectedEmail).toBe('admin@example.com');
    });
  });

  // ── GET /google-classroom/auth-url ────────────────────────────────────────
  describe('GET /google-classroom/auth-url', () => {
    it('returns 403 for non-admin', async () => {
      const { teacher, app } = await setup();
      await request(app)
        .get(`${BASE}/auth-url`)
        .set(authHeadersFor(teacher, 'teacher'))
        .expect(403);
    });

    it('returns auth URL for admin', async () => {
      const { admin, app } = await setup();
      const res = await request(app)
        .get(`${BASE}/auth-url`)
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);
      expect(res.body.data.authUrl).toContain('accounts.google.com');
    });
  });

  // ── POST /google-classroom/callback ───────────────────────────────────────
  describe('POST /google-classroom/callback', () => {
    it('returns 403 for non-admin', async () => {
      const { teacher, app } = await setup();
      await request(app)
        .post(`${BASE}/callback`)
        .set(authHeadersFor(teacher, 'teacher'))
        .send({})
        .expect(403);
    });

    it('returns 400 when code or state is missing', async () => {
      const { admin, app } = await setup();
      const res = await request(app)
        .post(`${BASE}/callback`)
        .set(authHeadersFor(admin, 'admin'))
        .send({ code: 'abc' })
        .expect(400);
      expect(res.body.error).toMatch(/required/i);
    });

    it('exchanges code and stores tokens', async () => {
      const { school, admin, app } = await setup();
      const jwt = await import('jsonwebtoken');
      const state = jwt.default.sign(
        { schoolId: school._id.toString(), purpose: 'gc-oauth' },
        process.env.JWT_SECRET,
        { expiresIn: '15m' }
      );

      const res = await request(app)
        .post(`${BASE}/callback`)
        .set(authHeadersFor(admin, 'admin'))
        .send({ code: 'authcode', state })
        .expect(200);
      expect(res.body.data.isConnected).toBe(true);
      expect(res.body.data.connectedEmail).toBe('teacher@example.com');
    });
  });

  // ── DELETE /google-classroom/disconnect ───────────────────────────────────
  describe('DELETE /google-classroom/disconnect', () => {
    it('returns 403 for non-admin', async () => {
      const { teacher, app } = await setup();
      await request(app)
        .delete(`${BASE}/disconnect`)
        .set(authHeadersFor(teacher, 'teacher'))
        .expect(403);
    });

    it('disconnects the integration', async () => {
      const { school, admin, app } = await setup();
      await GoogleClassroomSync.create({
        schoolId: school._id,
        isConnected: true,
        oauth: { accessToken: 'tok', refreshToken: 'ref', connectedEmail: 'a@b.com' },
      });

      const res = await request(app)
        .delete(`${BASE}/disconnect`)
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);
      expect(res.body.success).toBe(true);

      const record = await GoogleClassroomSync.findOne({ schoolId: school._id });
      expect(record.isConnected).toBe(false);
      expect(record.oauth.accessToken).toBeNull();
    });
  });

  // ── GET /google-classroom/courses ─────────────────────────────────────────
  describe('GET /google-classroom/courses', () => {
    it('returns 400 when not connected', async () => {
      const { admin, app } = await setup();
      const res = await request(app)
        .get(`${BASE}/courses`)
        .set(authHeadersFor(admin, 'admin'))
        .expect(400);
      expect(res.body.error).toMatch(/not connected/i);
    });

    it('returns courses when connected', async () => {
      const { school, admin, app } = await setup();
      await GoogleClassroomSync.create({
        schoolId: school._id,
        isConnected: true,
        oauth: { accessToken: 'tok' },
      });

      const res = await request(app)
        .get(`${BASE}/courses`)
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data[0].name).toBe('Math 101');
    });
  });

  // ── GET /google-classroom/config ──────────────────────────────────────────
  describe('GET /google-classroom/config', () => {
    it('returns default config when none exists', async () => {
      const { admin, app } = await setup();
      const res = await request(app)
        .get(`${BASE}/config`)
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);
      expect(res.body.data.syncFrequency).toBe('daily');
    });
  });

  // ── PUT /google-classroom/config ──────────────────────────────────────────
  describe('PUT /google-classroom/config', () => {
    it('returns 403 for non-admin', async () => {
      const { teacher, app } = await setup();
      await request(app)
        .put(`${BASE}/config`)
        .set(authHeadersFor(teacher, 'teacher'))
        .send({})
        .expect(403);
    });

    it('updates config', async () => {
      const { admin, app } = await setup();
      const res = await request(app)
        .put(`${BASE}/config`)
        .set(authHeadersFor(admin, 'admin'))
        .send({ syncFrequency: 'weekly', syncStudents: false })
        .expect(200);
      expect(res.body.data.syncFrequency).toBe('weekly');
      expect(res.body.data.syncStudents).toBe(false);
    });
  });

  // ── GET /google-classroom/mappings ────────────────────────────────────────
  describe('GET /google-classroom/mappings', () => {
    it('returns empty array when no mappings', async () => {
      const { admin, app } = await setup();
      const res = await request(app)
        .get(`${BASE}/mappings`)
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);
      expect(res.body.data).toEqual([]);
    });
  });

  // ── POST /google-classroom/mappings ───────────────────────────────────────
  describe('POST /google-classroom/mappings', () => {
    it('returns 403 for non-admin', async () => {
      const { teacher, app } = await setup();
      await request(app)
        .post(`${BASE}/mappings`)
        .set(authHeadersFor(teacher, 'teacher'))
        .send({})
        .expect(403);
    });

    it('creates a class mapping', async () => {
      const { school, admin, app } = await setup();
      await GoogleClassroomSync.create({ schoolId: school._id, classMappings: [] });

      const res = await request(app)
        .post(`${BASE}/mappings`)
        .set(authHeadersFor(admin, 'admin'))
        .send({
          emsClassId: new mongoose.Types.ObjectId().toString(),
          googleCourseId: 'course1',
          googleCourseName: 'Math',
          syncStudents: true,
          syncAssignments: true,
          syncGrades: true,
        })
        .expect(201);
      expect(res.body.data.googleCourseId).toBe('course1');
    });

    it('returns 409 for duplicate mapping', async () => {
      const { school, admin, app } = await setup();
      const classId = new mongoose.Types.ObjectId();
      await GoogleClassroomSync.create({
        schoolId: school._id,
        classMappings: [{ emsClassId: classId, googleCourseId: 'c1', googleCourseName: 'Math' }],
      });

      const res = await request(app)
        .post(`${BASE}/mappings`)
        .set(authHeadersFor(admin, 'admin'))
        .send({
          emsClassId: classId.toString(),
          googleCourseId: 'course2',
          googleCourseName: 'Science',
          syncStudents: true,
          syncAssignments: true,
          syncGrades: true,
        })
        .expect(409);
      expect(res.body.error).toMatch(/already exists/i);
    });
  });

  // ── DELETE /google-classroom/mappings/:mappingId ──────────────────────────
  describe('DELETE /google-classroom/mappings/:mappingId', () => {
    it('removes a mapping', async () => {
      const { school, admin, app } = await setup();
      const mappingId = new mongoose.Types.ObjectId();
      await GoogleClassroomSync.create({
        schoolId: school._id,
        classMappings: [
          { _id: mappingId, emsClassId: new mongoose.Types.ObjectId(), googleCourseId: 'c1' },
        ],
      });

      const res = await request(app)
        .delete(`${BASE}/mappings/${mappingId}`)
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);
      expect(res.body.message).toMatch(/removed/i);
    });

    it('returns 404 for non-existent mapping', async () => {
      const { admin, app } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app)
        .delete(`${BASE}/mappings/${fakeId}`)
        .set(authHeadersFor(admin, 'admin'))
        .expect(404);
    });
  });

  // ── POST /google-classroom/sync ───────────────────────────────────────────
  describe('POST /google-classroom/sync', () => {
    it('returns 400 when not connected', async () => {
      const { admin, app } = await setup();
      const res = await request(app)
        .post(`${BASE}/sync`)
        .set(authHeadersFor(admin, 'admin'))
        .expect(400);
      expect(res.body.error).toMatch(/not connected/i);
    });

    it('returns 400 when no mappings exist', async () => {
      const { school, admin, app } = await setup();
      await GoogleClassroomSync.create({
        schoolId: school._id,
        isConnected: true,
        classMappings: [],
      });

      const res = await request(app)
        .post(`${BASE}/sync`)
        .set(authHeadersFor(admin, 'admin'))
        .expect(400);
      expect(res.body.error).toMatch(/no class mappings/i);
    });

    it('accepts sync request when connected and mapped', async () => {
      const { school, admin, app } = await setup();
      await GoogleClassroomSync.create({
        schoolId: school._id,
        isConnected: true,
        classMappings: [{ emsClassId: new mongoose.Types.ObjectId(), googleCourseId: 'c1' }],
      });

      const res = await request(app)
        .post(`${BASE}/sync`)
        .set(authHeadersFor(admin, 'admin'))
        .expect(202);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/sync started/i);
    });
  });

  // ── GET /google-classroom/sync/history ────────────────────────────────────
  describe('GET /google-classroom/sync/history', () => {
    it('returns sync history', async () => {
      const { school, admin, app } = await setup();
      await GoogleClassroomSync.create({
        schoolId: school._id,
        syncHistory: [{ triggeredBy: 'manual', status: 'completed' }],
      });

      const res = await request(app)
        .get(`${BASE}/sync/history`)
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
});
