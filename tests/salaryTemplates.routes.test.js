import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const BASE = '/api/settings/salary-templates';

describe('salary template release flows', () => {
  let app;
  let school;
  let adminHeaders;

  beforeEach(async () => {
    school = await createSchoolRecord({ name: 'Salary Template School' });
    const admin = await createStaffUser({
      schoolId: school._id,
      name: 'Salary Template Admin',
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    adminHeaders = authHeadersFor(admin, 'admin');
    ({ app } = createTestApp());
  });

  it('allows the same name to be reused after repeated soft deletes', async () => {
    const payload = {
      name: 'Standard Teacher',
      breakdown: [{ component: 'Basic', amount: 30000 }],
    };

    for (let cycle = 0; cycle < 2; cycle += 1) {
      const created = await request(app).post(BASE).set(adminHeaders).send(payload).expect(201);
      await request(app).delete(`${BASE}/${created.body.data._id}`).set(adminHeaders).expect(200);
    }

    const third = await request(app).post(BASE).set(adminHeaders).send(payload).expect(201);
    expect(third.body.data.name).toBe(payload.name);
  });

  it('uses declared payroll permissions for Accountant access', async () => {
    const accountant = await createStaffUser({
      schoolId: school._id,
      name: 'Template Accountant',
      staffRole: ['Accountant'],
      permissionRole: 'accountant',
    });
    const accountantHeaders = authHeadersFor(accountant, 'accountant');
    const created = await request(app)
      .post(BASE)
      .set(accountantHeaders)
      .send({
        name: 'Accountant Template',
        breakdown: [{ component: 'Basic', amount: 20000 }],
      })
      .expect(201);

    await request(app).get(BASE).set(accountantHeaders).expect(200);
    await request(app)
      .put(`${BASE}/${created.body.data._id}`)
      .set(accountantHeaders)
      .send({
        name: 'Accountant Template Updated',
        breakdown: [{ component: 'Basic', amount: 21000 }],
      })
      .expect(200);
    await request(app)
      .delete(`${BASE}/${created.body.data._id}`)
      .set(accountantHeaders)
      .expect(403);
  });
});
