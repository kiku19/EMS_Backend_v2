import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { SchoolInvoice, SchoolSubscription } from '../database.js';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

describe('billing routes', () => {
  it('returns billing summary with effective trial plan and tracked usage', async () => {
    const school = await createSchoolRecord({
      name: 'Orbit School',
      code: 'ORBIT',
    });
    const admin = await createStaffUser({
      name: 'Orbit Admin',
      email: 'orbit.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/billing/summary')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body).toMatchObject({
      school: expect.objectContaining({
        code: 'ORBIT',
      }),
      subscription: expect.objectContaining({
        planKey: 'starter',
        effectivePlanKey: 'growth',
        status: 'trialing',
      }),
      usage: {
        students: expect.objectContaining({ current: 0 }),
        staff: expect.objectContaining({ current: 1 }),
        storageMb: expect.any(Object),
        smsCredits: expect.any(Object),
      },
    });
  });

  it('creates a checkout and activates a paid plan in development mode', async () => {
    const school = await createSchoolRecord({
      name: 'Pioneer School',
      code: 'PIONEER',
    });
    const admin = await createStaffUser({
      name: 'Pioneer Admin',
      email: 'pioneer.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(admin, 'admin');

    const checkoutResponse = await request(app)
      .post('/api/billing/checkout')
      .set(authHeaders)
      .send({
        planKey: 'scale',
        billingCycle: 'annual',
      })
      .expect(201);

    expect(checkoutResponse.body).toMatchObject({
      success: true,
      mode: 'sandbox',
      invoiceNumber: expect.any(String),
    });

    const subscription = await SchoolSubscription.findOne({ schoolId: school._id });
    const invoice = await SchoolInvoice.findOne({ schoolId: school._id }).sort({ createdAt: -1 });

    expect(subscription).toMatchObject({
      planKey: 'scale',
      status: 'active',
      billingCycle: 'annual',
    });
    expect(invoice).toMatchObject({
      planKey: 'scale',
      billingCycle: 'annual',
      status: 'paid',
    });
  });

  it('blocks staff creation once the active plan limit is reached', async () => {
    const school = await createSchoolRecord({
      name: 'Limit School',
      code: 'LIMIT',
    });

    const admin = await createStaffUser({
      name: 'Limit Admin',
      email: 'limit.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });

    await SchoolSubscription.create({
      schoolId: school._id,
      planKey: 'starter',
      trialPlanKey: null,
      status: 'active',
      billingCycle: 'monthly',
      provider: 'manual',
    });

    await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        createStaffUser({
          name: `Staff ${index + 1}`,
          email: `limit.staff.${index + 1}@example.com`,
          schoolId: school._id,
          staffRole: ['Teacher'],
          permissionRole: 'teacher',
        })
      )
    );

    const { app } = createTestApp();
    const response = await request(app)
      .post('/api/staff')
      .set(authHeadersFor(admin, 'admin'))
      .send({
        name: 'Overflow Staff',
        role: ['Teacher'],
        email: 'overflow.staff@example.com',
      })
      .expect(403);

    expect(response.body).toMatchObject({
      error: 'staff limit reached for the Starter plan',
      details: expect.objectContaining({
        metric: 'staff',
        current: 25,
        limit: 25,
        planKey: 'starter',
      }),
    });
  });
});
