import request from 'supertest';
import { describe, it, expect, beforeEach } from 'vitest';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

describe('systemConfig routes', () => {
  let app, school, admin, headers;

  beforeEach(async () => {
    school = await createSchoolRecord({ name: 'Config School', code: 'CFG' });
    admin = await createStaffUser({
      name: 'Config Admin',
      email: 'config.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    headers = authHeadersFor(admin, 'admin');
    ({ app } = createTestApp());
  });

  // ───────────────────────────────────────────────────────────────
  // Auth
  // ───────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('GET /api/staff-id-config returns 401 without token', async () => {
      await request(app).get('/api/staff-id-config').expect(401);
    });

    it('PUT /api/staff-id-config returns 401 without token', async () => {
      await request(app).put('/api/staff-id-config').send({}).expect(401);
    });

    it('GET /api/school-settings returns 401 without token', async () => {
      await request(app).get('/api/school-settings').expect(401);
    });

    it('PUT /api/school-settings returns 401 without token', async () => {
      await request(app).put('/api/school-settings').send({}).expect(401);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /api/staff-id-config
  // ───────────────────────────────────────────────────────────────
  describe('GET /api/staff-id-config', () => {
    it('returns default config when none exists', async () => {
      const res = await request(app).get('/api/staff-id-config').set(headers).expect(200);

      expect(res.body).toHaveProperty('prefix');
      expect(res.body).toHaveProperty('digits');
    });

    it('returns existing config on subsequent calls', async () => {
      await request(app).get('/api/staff-id-config').set(headers).expect(200);
      const res = await request(app).get('/api/staff-id-config').set(headers).expect(200);

      expect(res.body).toHaveProperty('prefix');
    });
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /api/staff-id-config
  // ───────────────────────────────────────────────────────────────
  describe('PUT /api/staff-id-config', () => {
    it('updates staff ID config', async () => {
      const payload = {
        prefix: 'STAFF',
        separator: '-',
        includeYear: true,
        startingNumber: 100,
        digits: 4,
      };

      const res = await request(app)
        .put('/api/staff-id-config')
        .set(headers)
        .send(payload)
        .expect(200);

      expect(res.body.prefix).toBe('STAFF');
      expect(res.body.digits).toBe(4);
      expect(res.body.startingNumber).toBe(100);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /api/school-settings
  // ───────────────────────────────────────────────────────────────
  describe('GET /api/school-settings', () => {
    it('returns (or auto-creates) school settings', async () => {
      const res = await request(app).get('/api/school-settings').set(headers).expect(200);

      // Should contain schoolId from auth context
      expect(res.body).toBeDefined();
    });
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /api/school-settings
  // ───────────────────────────────────────────────────────────────
  describe('PUT /api/school-settings', () => {
    it('creates or updates school settings', async () => {
      const payload = { timezone: 'Asia/Kolkata', currency: 'INR' };

      const res = await request(app)
        .put('/api/school-settings')
        .set(headers)
        .send(payload)
        .expect(200);

      expect(res.body).toBeDefined();
    });
  });
});
