import request from 'supertest';
import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import School from '../models/School.js';
import { Staff } from '../database.js';
import { createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const BASE = '/api/auth/sso';

describe('sso routes', () => {
  async function setup() {
    const school = await createSchoolRecord({ name: 'SSO School', code: 'SSO' });
    const admin = await createStaffUser({
      name: 'SSO Admin',
      email: 'sso.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    const { app } = createTestApp();
    return { school, admin, app };
  }

  // ── GET /auth/sso/check ───────────────────────────────────────────────────
  describe('GET /auth/sso/check', () => {
    it('returns ssoEnabled false for unknown domain', async () => {
      const { app } = await setup();
      const res = await request(app).get(`${BASE}/check?email=user@unknown.com`).expect(200);
      expect(res.body.ssoEnabled).toBe(false);
    });

    it('returns ssoEnabled true for configured domain', async () => {
      const { school, app } = await setup();
      await School.findByIdAndUpdate(school._id, {
        ssoConfig: {
          allowedDomains: ['example.com'],
          google: { enabled: true, clientId: 'client123' },
        },
      });

      const res = await request(app).get(`${BASE}/check?email=user@example.com`).expect(200);
      expect(res.body.ssoEnabled).toBe(true);
      expect(res.body.providers).toContain('google');
      expect(res.body.schoolCode).toBe(school.code);
    });

    it('returns false for malformed email', async () => {
      const { app } = await setup();
      const res = await request(app).get(`${BASE}/check?email=notanemail`).expect(200);
      expect(res.body.ssoEnabled).toBe(false);
    });
  });

  // ── GET /auth/sso/saml/metadata ───────────────────────────────────────────
  describe('GET /auth/sso/saml/metadata', () => {
    it('returns 404 for unknown school code', async () => {
      const { app } = await setup();
      await request(app).get(`${BASE}/saml/metadata?schoolCode=UNKNOWN`).expect(404);
    });

    it('returns 400 when SAML is not configured', async () => {
      const { school, app } = await setup();
      const res = await request(app)
        .get(`${BASE}/saml/metadata?schoolCode=${school.code}`)
        .expect(400);
      expect(res.body.error).toMatch(/SAML is not configured/i);
    });

    it('returns XML metadata when SAML is configured', async () => {
      const { school, app } = await setup();
      await School.findByIdAndUpdate(school._id, {
        ssoConfig: {
          saml: { enabled: true, entryPoint: 'https://idp.example.com/sso', issuer: 'ems-app' },
        },
      });

      const res = await request(app)
        .get(`${BASE}/saml/metadata?schoolCode=${school.code}`)
        .expect(200);
      expect(res.headers['content-type']).toMatch(/application\/xml/);
      expect(res.text).toContain('EntityDescriptor');
    });
  });

  // ── GET /auth/sso/:provider/initiate ──────────────────────────────────────
  describe('GET /auth/sso/:provider/initiate', () => {
    it('returns 400 for invalid provider', async () => {
      const { app } = await setup();
      const res = await request(app).get(`${BASE}/invalid/initiate?schoolCode=SSO`).expect(400);
      expect(res.body.error).toMatch(/invalid SSO provider/i);
    });

    it('returns 404 for unknown school', async () => {
      const { app } = await setup();
      await request(app).get(`${BASE}/google/initiate?schoolCode=UNKNOWN`).expect(404);
    });

    it('returns 400 when provider is not configured', async () => {
      const { school, app } = await setup();
      const res = await request(app)
        .get(`${BASE}/google/initiate?schoolCode=${school.code}`)
        .expect(400);
      expect(res.body.error).toMatch(/not configured/i);
    });

    it('redirects to Google when configured', async () => {
      const { school, app } = await setup();
      await School.findByIdAndUpdate(school._id, {
        ssoConfig: {
          google: { enabled: true, clientId: 'client123' },
        },
      });

      const res = await request(app)
        .get(`${BASE}/google/initiate?schoolCode=${school.code}`)
        .expect(302);
      expect(res.headers.location).toContain('accounts.google.com');
    });

    it('redirects to Microsoft when configured', async () => {
      const { school, app } = await setup();
      await School.findByIdAndUpdate(school._id, {
        ssoConfig: {
          microsoft: { enabled: true, clientId: 'client123', tenantId: 'common' },
        },
      });

      const res = await request(app)
        .get(`${BASE}/microsoft/initiate?schoolCode=${school.code}`)
        .expect(302);
      expect(res.headers.location).toContain('login.microsoftonline.com');
    });
  });

  // ── SCIM Routes ───────────────────────────────────────────────────────────
  describe('SCIM routes', () => {
    async function setupScim() {
      const { school, app } = await setup();
      const scimToken = 'test-scim-token-123';
      await School.findByIdAndUpdate(school._id, {
        ssoConfig: {
          scim: { enabled: true, token: scimToken },
        },
      });
      return { school, app, scimToken };
    }

    it('GET /scim/v2/Users returns 401 without token', async () => {
      const { app } = await setup();
      await request(app).get(`${BASE}/scim/v2/Users`).expect(401);
    });

    it('GET /scim/v2/Users returns 400 without school code', async () => {
      const { app, scimToken } = await setupScim();
      const res = await request(app)
        .get(`${BASE}/scim/v2/Users`)
        .set('Authorization', `Bearer ${scimToken}`)
        .expect(400);
      expect(res.body.detail).toMatch(/Missing x-school-code/i);
    });

    it('GET /scim/v2/Users returns 403 when SCIM is disabled', async () => {
      const { school, app } = await setup();
      const res = await request(app)
        .get(`${BASE}/scim/v2/Users?schoolCode=${school.code}`)
        .set('Authorization', 'Bearer wrong-token')
        .expect(403);
      expect(res.body.detail).toMatch(/SCIM is not enabled/i);
    });

    it('GET /scim/v2/Users lists users with valid token', async () => {
      const { school, app, scimToken } = await setupScim();
      await Staff.create({
        schoolId: school._id,
        name: 'Scim User',
        email: 'scim@example.com',
        code: 'SCIM001',
        role: ['Teacher'],
        status: 'active',
        password: 'Password123',
      });

      const res = await request(app)
        .get(`${BASE}/scim/v2/Users?schoolCode=${school.code}`)
        .set('Authorization', `Bearer ${scimToken}`)
        .expect(200);
      expect(res.body.Resources).toBeDefined();
      expect(res.body.Resources.length).toBeGreaterThanOrEqual(1);
    });

    it('POST /scim/v2/Users provisions a new user', async () => {
      const { school, app, scimToken } = await setupScim();
      const res = await request(app)
        .post(`${BASE}/scim/v2/Users?schoolCode=${school.code}`)
        .set('Authorization', `Bearer ${scimToken}`)
        .send({
          userName: 'newuser@example.com',
          name: { formatted: 'New User' },
          emails: [{ value: 'newuser@example.com', primary: true }],
          active: true,
        })
        .expect(201);
      expect(res.body.userName).toBe('newuser@example.com');
      expect(res.body.name.formatted).toBe('New User');
    });

    it('GET /scim/v2/Users/:id returns a single user', async () => {
      const { school, app, scimToken } = await setupScim();
      const staff = await Staff.create({
        schoolId: school._id,
        name: 'Get Me',
        email: 'getme@example.com',
        code: 'SCIM003',
        role: ['Teacher'],
        status: 'active',
        password: 'Password123',
      });

      const res = await request(app)
        .get(`${BASE}/scim/v2/Users/${staff._id}?schoolCode=${school.code}`)
        .set('Authorization', `Bearer ${scimToken}`)
        .expect(200);
      expect(res.body.id).toBe(staff._id.toString());
    });

    it('PUT /scim/v2/Users/:id replaces a user', async () => {
      const { school, app, scimToken } = await setupScim();
      const staff = await Staff.create({
        schoolId: school._id,
        name: 'Old Name',
        email: 'old@example.com',
        code: 'SCIM004',
        role: ['Teacher'],
        status: 'active',
        password: 'Password123',
      });

      const res = await request(app)
        .put(`${BASE}/scim/v2/Users/${staff._id}?schoolCode=${school.code}`)
        .set('Authorization', `Bearer ${scimToken}`)
        .send({
          name: { formatted: 'New Name' },
          emails: [{ value: 'new@example.com', primary: true }],
          active: true,
        })
        .expect(200);
      expect(res.body.name.formatted).toBe('New Name');
    });

    it('PATCH /scim/v2/Users/:id updates active status', async () => {
      const { school, app, scimToken } = await setupScim();
      const staff = await Staff.create({
        schoolId: school._id,
        name: 'Patch Me',
        email: 'patch@example.com',
        code: 'SCIM005',
        role: ['Teacher'],
        status: 'active',
        password: 'Password123',
      });

      const res = await request(app)
        .patch(`${BASE}/scim/v2/Users/${staff._id}?schoolCode=${school.code}`)
        .set('Authorization', `Bearer ${scimToken}`)
        .send({ Operations: [{ op: 'replace', value: { active: false } }] })
        .expect(200);
      expect(res.body.active).toBe(false);
    });

    it('DELETE /scim/v2/Users/:id soft-deletes a user', async () => {
      const { school, app, scimToken } = await setupScim();
      const staff = await Staff.create({
        schoolId: school._id,
        name: 'Delete Me',
        email: 'del@example.com',
        code: 'SCIM006',
        role: ['Teacher'],
        status: 'active',
        password: 'Password123',
      });

      await request(app)
        .delete(`${BASE}/scim/v2/Users/${staff._id}?schoolCode=${school.code}`)
        .set('Authorization', `Bearer ${scimToken}`)
        .expect(204);

      const deleted = await Staff.findById(staff._id);
      expect(deleted.isDeleted).toBe(true);
      expect(deleted.status).toBe('terminated');
    });
  });
});
