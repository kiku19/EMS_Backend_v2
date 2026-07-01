import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';
import { CORE_MODULES } from '../config/moduleRegistry.js';

async function adminFor(schoolId, email) {
  return createStaffUser({
    name: 'Module Admin',
    email,
    schoolId,
    staffRole: ['Admin'],
    permissionRole: 'admin',
  });
}

describe('settings/modules routes', () => {
  describe('authentication & authorization', () => {
    it('returns 401 for GET /api/settings/modules without auth', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/settings/modules').expect(401);
    });

    it('returns 401 for PUT /api/settings/modules without auth', async () => {
      const { app } = createTestApp();
      await request(app)
        .put('/api/settings/modules')
        .send({ enabledModules: ['fees'] })
        .expect(401);
    });

    it('returns 403 when a non-admin tries to PUT modules', async () => {
      const school = await createSchoolRecord({ name: 'Mod School T', code: 'MODT1' });
      const teacher = await createStaffUser({
        name: 'Mod Teacher',
        email: 'mod.teacher@example.com',
        schoolId: school._id,
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
      });
      const { app } = createTestApp();
      await request(app)
        .put('/api/settings/modules')
        .set(authHeadersFor(teacher, 'teacher'))
        .send({ enabledModules: ['fees'] })
        .expect(403);
    });
  });

  describe('GET /api/settings/modules', () => {
    it('a new school is core-only: all toggleable modules disabled', async () => {
      const school = await createSchoolRecord({ name: 'Mod School G', code: 'MODG1' });
      const admin = await adminFor(school._id, 'mod.admin.g@example.com');

      const { app } = createTestApp();
      const res = await request(app)
        .get('/api/settings/modules')
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);

      expect(res.body.managed).toBe(true);
      expect(res.body.coreModules).toEqual(CORE_MODULES);
      // Effective enabled set equals the core modules only.
      expect([...res.body.enabledModules].sort()).toEqual([...CORE_MODULES].sort());

      const fees = res.body.modules.find((m) => m.key === 'fees');
      expect(fees).toMatchObject({ core: false, enabled: false });
      const students = res.body.modules.find((m) => m.key === 'students');
      expect(students).toMatchObject({ core: true, enabled: true });
    });
  });

  describe('PUT /api/settings/modules', () => {
    it('enables the selected toggleable modules and persists', async () => {
      const school = await createSchoolRecord({ name: 'Mod School P', code: 'MODP1' });
      const admin = await adminFor(school._id, 'mod.admin.p@example.com');
      const { app } = createTestApp();

      const res = await request(app)
        .put('/api/settings/modules')
        .set(authHeadersFor(admin, 'admin'))
        .send({ enabledModules: ['fees', 'library'] })
        .expect(200);

      expect(res.body.modules.find((m) => m.key === 'fees').enabled).toBe(true);
      expect(res.body.modules.find((m) => m.key === 'library').enabled).toBe(true);
      expect(res.body.modules.find((m) => m.key === 'academics').enabled).toBe(false);
      expect(res.body.enabledModules).toEqual(expect.arrayContaining(['fees', 'library', ...CORE_MODULES]));

      // Re-fetch confirms persistence.
      const after = await request(app)
        .get('/api/settings/modules')
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);
      expect(after.body.modules.find((m) => m.key === 'fees').enabled).toBe(true);
    });

    it('rejects unknown module keys with 400', async () => {
      const school = await createSchoolRecord({ name: 'Mod School V', code: 'MODV1' });
      const admin = await adminFor(school._id, 'mod.admin.v@example.com');
      const { app } = createTestApp();

      const res = await request(app)
        .put('/api/settings/modules')
        .set(authHeadersFor(admin, 'admin'))
        .send({ enabledModules: ['fees', 'not-a-real-module'] })
        .expect(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('rejects a non-array payload with 400', async () => {
      const school = await createSchoolRecord({ name: 'Mod School V2', code: 'MODV2' });
      const admin = await adminFor(school._id, 'mod.admin.v2@example.com');
      const { app } = createTestApp();

      await request(app)
        .put('/api/settings/modules')
        .set(authHeadersFor(admin, 'admin'))
        .send({ enabledModules: 'fees' })
        .expect(400);
    });
  });
});
