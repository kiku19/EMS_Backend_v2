import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { School, SchoolSettings, Staff, UserPermission } from '../database.js';
import { createSchoolRecord } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

async function loginAsSuperAdmin(app) {
  const agent = request.agent(app);

  await agent
    .post('/api/auth/login')
    .set('X-Auth-Mode', 'cookie')
    .send({
      email: 'superid@test.com',
      password: 'super12345',
    })
    .expect(200);

  return agent;
}

describe('super admin routes', () => {
  it('onboards a school, assigns a plan, and provisions an admin with settings', async () => {
    const { app } = createTestApp();
    const agent = await loginAsSuperAdmin(app);

    const response = await agent
      .post('/api/super-admin/schools')
      .send({
        schoolName: 'Riverdale High',
        contactEmail: 'ops@riverdale.edu',
        contactPhone: '9876543210',
        plan: 'growth',
        planStatus: 'trialing',
        adminName: 'Rita Admin',
        adminEmail: 'rita@riverdale.edu',
        schoolSettings: {
          boardOfEducation: 'CBSE',
        },
      })
      .expect(201);

    expect(response.body).toMatchObject({
      school: expect.objectContaining({
        name: 'Riverdale High',
        code: 'RIVERDALE-HIGH',
        plan: 'growth',
        planStatus: 'trialing',
      }),
      admin: expect.objectContaining({
        name: 'Rita Admin',
        email: 'rita@riverdale.edu',
      }),
      adminCreated: true,
    });
    expect(response.body.temporaryPassword).toEqual(expect.any(String));

    const school = await School.findOne({ code: 'RIVERDALE-HIGH' });
    const admin = await Staff.findOne({ schoolId: school?._id, email: 'rita@riverdale.edu' });
    const permissions = await UserPermission.findOne({ schoolId: school?._id, userId: admin?._id });
    const settings = await SchoolSettings.findOne({ schoolId: school?._id });

    expect(admin).toBeTruthy();
    expect(permissions?.role).toBe('admin');
    expect(settings).toMatchObject({
      schoolId: school?._id,
      schoolName: 'Riverdale High',
      boardOfEducation: 'CBSE',
    });
  });

  it('lists schools with school-level counts and admin details', async () => {
    const school = await createSchoolRecord({
      name: 'Northview Academy',
      code: 'NORTHVIEW',
    });

    await Staff.create({
      schoolId: school._id,
      code: 'EMP9001',
      name: 'Northview Admin',
      email: 'admin@northview.edu',
      password: 'password123',
      role: ['Admin'],
      status: 'active',
    });

    const { app } = createTestApp();
    const agent = await loginAsSuperAdmin(app);

    const response = await agent.get('/api/super-admin/schools').expect(200);

    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Northview Academy',
          code: 'NORTHVIEW',
          counts: expect.objectContaining({
            staff: 1,
          }),
          admin: expect.objectContaining({
            email: 'admin@northview.edu',
          }),
        }),
      ])
    );
  });

  it('re-provisions an existing school by creating missing settings and an admin account', async () => {
    const school = await createSchoolRecord({
      name: 'Blue Ridge School',
      code: 'BLUE-RIDGE',
    });

    const { app } = createTestApp();
    const agent = await loginAsSuperAdmin(app);

    const response = await agent
      .post(`/api/super-admin/schools/${school._id}/provision`)
      .send({
        adminName: 'Blue Ridge Admin',
        adminEmail: 'principal@blueridge.edu',
      })
      .expect(200);

    expect(response.body).toMatchObject({
      school: expect.objectContaining({
        code: 'BLUE-RIDGE',
      }),
      admin: expect.objectContaining({
        email: 'principal@blueridge.edu',
      }),
      adminCreated: true,
    });
    expect(response.body.temporaryPassword).toEqual(expect.any(String));

    const settings = await SchoolSettings.findOne({ schoolId: school._id });
    const admin = await Staff.findOne({ schoolId: school._id, email: 'principal@blueridge.edu' });

    expect(settings).toBeTruthy();
    expect(admin).toBeTruthy();
  });
});
