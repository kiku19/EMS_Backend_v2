/**
 * Phase 4 — Unified per-school feature control plane.
 *
 * GET /api/v1/super-admin/schools/:id/features  → modules + plan + flags
 * PATCH /api/v1/super-admin/schools/:id/modules → toggle modules on/off
 */

import request from 'supertest';
import { describe, expect, it, beforeEach } from 'vitest';
import { generateToken } from '../middleware/auth.js';
import { createSchoolRecord, createStaffUser, resetDefaultSchool } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';
import FeatureFlag from '../models/FeatureFlag.js';

const { app } = createTestApp();

const SUPER_ADMIN_HEADERS = {
  Authorization: `Bearer ${generateToken('super-admin', ['Super Admin'], {
    userType: 'super-admin',
  })}`,
};

function staffHeaders(staff) {
  return {
    Authorization: `Bearer ${generateToken(staff._id.toString(), 'Admin', {
      schoolId: staff.schoolId,
      userType: 'staff',
    })}`,
  };
}

describe('Phase 4 — school feature control plane', () => {
  let school, admin;

  beforeEach(async () => {
    resetDefaultSchool();
    school = await createSchoolRecord({ name: 'Feature School', code: 'FEAT' });
    admin = await createStaffUser({
      name: 'Feat Admin',
      email: 'feat@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
  });

  it('rejects non-super-admin staff with 403', async () => {
    const res = await request(app)
      .get(`/api/v1/super-admin/schools/${school._id}/features`)
      .set(staffHeaders(admin));
    expect(res.status).toBe(403);
  });

  it('returns the unified posture: modules, plan, and flags', async () => {
    await FeatureFlag.create({
      key: 'advancedReports',
      name: 'Advanced reports',
      status: 'enabled',
      minimumPlan: 'growth',
    });

    const res = await request(app)
      .get(`/api/v1/super-admin/schools/${school._id}/features`)
      .set(SUPER_ADMIN_HEADERS);
    expect(res.status).toBe(200);

    // Modules: brand-new school → core only, all toggleable off, managed=true.
    expect(res.body.managed).toBe(true);
    const fees = res.body.modules.find((m) => m.key === 'fees');
    expect(fees.enabled).toBe(false);
    expect(res.body.modules.length).toBeGreaterThan(10);

    // A freshly provisioned school is on a Growth trial → effective plan is growth.
    expect(res.body.plan.key).toBe('growth');
    expect(res.body.plan.capabilities).toHaveProperty('parentApp');

    // Flag present with effective state + no override yet.
    const flag = res.body.flags.find((f) => f.key === 'advancedReports');
    expect(flag).toBeDefined();
    expect(flag.hasOverride).toBe(false);
    expect(typeof flag.effectiveEnabled).toBe('boolean');
  });

  it('toggles modules on and reflects the new effective set', async () => {
    // Start: nothing toggleable enabled.
    const before = await request(app)
      .get(`/api/v1/super-admin/schools/${school._id}/features`)
      .set(SUPER_ADMIN_HEADERS);
    expect(before.body.modules.find((m) => m.key === 'fees').enabled).toBe(false);

    const res = await request(app)
      .patch(`/api/v1/super-admin/schools/${school._id}/modules`)
      .send({ enabledModules: ['fees', 'hostel'] })
      .set(SUPER_ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.enabledModules.sort()).toEqual(['fees', 'hostel']);
    expect(res.body.modules.find((m) => m.key === 'fees').enabled).toBe(true);
    expect(res.body.modules.find((m) => m.key === 'hostel').enabled).toBe(true);
    expect(res.body.modules.find((m) => m.key === 'transport').enabled).toBe(false);

    // Persists on re-read.
    const after = await request(app)
      .get(`/api/v1/super-admin/schools/${school._id}/features`)
      .set(SUPER_ADMIN_HEADERS);
    expect(after.body.modules.find((m) => m.key === 'fees').enabled).toBe(true);
  });

  it('rejects an invalid module key with 400', async () => {
    const res = await request(app)
      .patch(`/api/v1/super-admin/schools/${school._id}/modules`)
      .send({ enabledModules: ['fees', 'not-a-real-module'] })
      .set(SUPER_ADMIN_HEADERS);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 404 for an unknown school', async () => {
    const fake = 'aaaaaaaaaaaaaaaaaaaaaaaa';
    const [getRes, patchRes] = await Promise.all([
      request(app).get(`/api/v1/super-admin/schools/${fake}/features`).set(SUPER_ADMIN_HEADERS),
      request(app)
        .patch(`/api/v1/super-admin/schools/${fake}/modules`)
        .send({ enabledModules: [] })
        .set(SUPER_ADMIN_HEADERS),
    ]);
    expect(getRes.status).toBe(404);
    expect(patchRes.status).toBe(404);
  });
});
