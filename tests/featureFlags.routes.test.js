import request from 'supertest';
import { describe, expect, it } from 'vitest';
import FeatureFlag from '../models/FeatureFlag.js';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const BASE = '/api/feature-flags';

describe('featureFlags routes', () => {
  async function setup() {
    const school = await createSchoolRecord({ name: 'FF School', code: 'FF' });
    const admin = await createStaffUser({
      name: 'FF Admin',
      email: 'ff.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    const superAdmin = await createStaffUser({
      name: 'Super Admin',
      email: 'super@example.com',
      schoolId: school._id,
      staffRole: ['Super Admin'],
      permissionRole: 'admin',
    });
    const { app } = createTestApp();
    return { school, admin, superAdmin, app };
  }

  function adminHeaders(admin) {
    return authHeadersFor(admin, 'admin');
  }

  function superHeaders(superAdmin) {
    return authHeadersFor(superAdmin, 'super admin');
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('returns 401 without token', async () => {
      const { app } = createTestApp();
      await request(app).get(BASE).expect(401);
    });
  });

  // ── GET /api/feature-flags ────────────────────────────────────────────────
  describe('GET /api/feature-flags', () => {
    it('returns merged feature map for the school', async () => {
      const { school, admin, app } = await setup();
      const res = await request(app).get(BASE).set(adminHeaders(admin)).expect(200);
      expect(res.body).toHaveProperty('features');
      expect(res.body).toHaveProperty('planKey');
      expect(typeof res.body.features).toBe('object');
    });
  });

  // ── GET /api/feature-flags/admin/all ──────────────────────────────────────
  describe('GET /api/feature-flags/admin/all', () => {
    it('returns 403 for non-super-admin', async () => {
      const { admin, app } = await setup();
      await request(app).get(`${BASE}/admin/all`).set(adminHeaders(admin)).expect(403);
    });

    it('lists all feature flags for super admin', async () => {
      const { superAdmin, app } = await setup();
      await FeatureFlag.create({ key: 'testFlag', name: 'Test Flag', status: 'enabled' });

      const res = await request(app)
        .get(`${BASE}/admin/all`)
        .set(superHeaders(superAdmin))
        .expect(200);
      expect(Array.isArray(res.body.flags)).toBe(true);
      expect(res.body.flags.some((f) => f.key === 'testFlag')).toBe(true);
    });
  });

  // ── GET /api/feature-flags/admin/audit-logs ───────────────────────────────
  describe('GET /api/feature-flags/admin/audit-logs', () => {
    it('returns 403 for non-super-admin', async () => {
      const { admin, app } = await setup();
      await request(app).get(`${BASE}/admin/audit-logs`).set(adminHeaders(admin)).expect(403);
    });

    it('returns audit logs for super admin', async () => {
      const { superAdmin, app } = await setup();
      const res = await request(app)
        .get(`${BASE}/admin/audit-logs`)
        .set(superHeaders(superAdmin))
        .expect(200);
      expect(Array.isArray(res.body.logs)).toBe(true);
    });
  });

  // ── POST /api/feature-flags/admin ─────────────────────────────────────────
  describe('POST /api/feature-flags/admin', () => {
    it('returns 403 for non-super-admin', async () => {
      const { admin, app } = await setup();
      await request(app)
        .post(`${BASE}/admin`)
        .set(adminHeaders(admin))
        .send({ key: 'x', name: 'X' })
        .expect(403);
    });

    it('creates a feature flag', async () => {
      const { superAdmin, app } = await setup();
      const res = await request(app)
        .post(`${BASE}/admin`)
        .set(superHeaders(superAdmin))
        .send({ key: 'newFeature', name: 'New Feature', status: 'enabled', minimumPlan: 'starter' })
        .expect(201);
      expect(res.body.key).toBe('newFeature');
      expect(res.body.name).toBe('New Feature');
    });

    it('returns 409 for duplicate key', async () => {
      const { superAdmin, app } = await setup();
      await FeatureFlag.create({ key: 'dupKey', name: 'Dup', status: 'enabled' });

      const res = await request(app)
        .post(`${BASE}/admin`)
        .set(superHeaders(superAdmin))
        .send({ key: 'dupKey', name: 'Dup2', status: 'enabled' })
        .expect(409);
      expect(res.body.error).toMatch(/already exists/i);
    });

    it('returns 400 for invalid key format', async () => {
      const { superAdmin, app } = await setup();
      const res = await request(app)
        .post(`${BASE}/admin`)
        .set(superHeaders(superAdmin))
        .send({ key: '123invalid', name: 'Bad', status: 'enabled' })
        .expect(400);
      expect(res.body.error).toBeTruthy();
    });
  });

  // ── PUT /api/feature-flags/admin/:key ─────────────────────────────────────
  describe('PUT /api/feature-flags/admin/:key', () => {
    it('returns 403 for non-super-admin', async () => {
      const { admin, app } = await setup();
      await request(app)
        .put(`${BASE}/admin/x`)
        .set(adminHeaders(admin))
        .send({ name: 'Y' })
        .expect(403);
    });

    it('updates a feature flag', async () => {
      const { superAdmin, app } = await setup();
      await FeatureFlag.create({ key: 'updFlag', name: 'Old', status: 'disabled' });

      const res = await request(app)
        .put(`${BASE}/admin/updFlag`)
        .set(superHeaders(superAdmin))
        .send({ name: 'New', status: 'enabled' })
        .expect(200);
      expect(res.body.name).toBe('New');
      expect(res.body.status).toBe('enabled');
    });
  });

  // ── DELETE /api/feature-flags/admin/:key ──────────────────────────────────
  describe('DELETE /api/feature-flags/admin/:key', () => {
    it('returns 403 for non-super-admin', async () => {
      const { admin, app } = await setup();
      await request(app).delete(`${BASE}/admin/x`).set(adminHeaders(admin)).expect(403);
    });

    it('deletes a feature flag', async () => {
      const { superAdmin, app } = await setup();
      await FeatureFlag.create({ key: 'delFlag', name: 'To Delete', status: 'enabled' });

      const res = await request(app)
        .delete(`${BASE}/admin/delFlag`)
        .set(superHeaders(superAdmin))
        .expect(200);
      expect(res.body.success).toBe(true);

      const remaining = await FeatureFlag.findOne({ key: 'delFlag' });
      expect(remaining).toBeNull();
    });
  });

  // ── POST /api/feature-flags/admin/:key/override ───────────────────────────
  describe('POST /api/feature-flags/admin/:key/override', () => {
    it('returns 403 for non-super-admin', async () => {
      const { admin, app } = await setup();
      await request(app)
        .post(`${BASE}/admin/x/override`)
        .set(adminHeaders(admin))
        .send({ schoolId: '665000000000000000000000', enabled: true })
        .expect(403);
    });

    it('sets a per-school override', async () => {
      const { school, superAdmin, app } = await setup();
      await FeatureFlag.create({ key: 'ovrFlag', name: 'Override', status: 'disabled' });

      const res = await request(app)
        .post(`${BASE}/admin/ovrFlag/override`)
        .set(superHeaders(superAdmin))
        .send({ schoolId: school._id.toString(), enabled: true })
        .expect(200);
      expect(res.body.overrideSchools).toBeDefined();
      const override = res.body.overrideSchools.find(
        (o) => String(o.schoolId) === String(school._id)
      );
      expect(override.enabled).toBe(true);
    });
  });

  // ── DELETE /api/feature-flags/admin/:key/override/:schoolId ───────────────
  describe('DELETE /api/feature-flags/admin/:key/override/:schoolId', () => {
    it('returns 403 for non-super-admin', async () => {
      const { admin, app } = await setup();
      await request(app)
        .delete(`${BASE}/admin/x/override/665000000000000000000000`)
        .set(adminHeaders(admin))
        .expect(403);
    });

    it('removes a per-school override', async () => {
      const { school, superAdmin, app } = await setup();
      await FeatureFlag.create({
        key: 'rmOvr',
        name: 'Remove Override',
        status: 'disabled',
        overrideSchools: [{ schoolId: school._id, enabled: true }],
      });

      const res = await request(app)
        .delete(`${BASE}/admin/rmOvr/override/${school._id}`)
        .set(superHeaders(superAdmin))
        .expect(200);
      const override = res.body.overrideSchools?.find(
        (o) => String(o.schoolId) === String(school._id)
      );
      expect(override).toBeUndefined();
    });
  });
});
