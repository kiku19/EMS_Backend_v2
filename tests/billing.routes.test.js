import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { SchoolInvoice, SchoolSubscription } from '../database.js';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

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

  it('transitions trialing subscription to active when trial has expired', async () => {
    const school = await createSchoolRecord({ name: 'Expired Trial School', code: 'EXPTRIAL' });
    const admin = await createStaffUser({
      name: 'Trial Admin',
      email: 'trial.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    await SchoolSubscription.create({
      schoolId: school._id,
      planKey: 'starter',
      trialPlanKey: 'growth',
      status: 'trialing',
      billingCycle: 'monthly',
      provider: 'manual',
      trialStartsAt: daysAgo(20),
      trialEndsAt: daysAgo(6),
    });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/billing/summary')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.subscription).toMatchObject({
      status: 'active',
      planKey: 'starter',
      effectivePlanKey: 'starter',
    });
  });

  it('enters past_due when an active paid subscription period expires', async () => {
    const school = await createSchoolRecord({ name: 'Past Due School', code: 'PASTDUE' });
    const admin = await createStaffUser({
      name: 'PastDue Admin',
      email: 'pastdue.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    await SchoolSubscription.create({
      schoolId: school._id,
      planKey: 'growth',
      trialPlanKey: null,
      status: 'active',
      billingCycle: 'monthly',
      provider: 'manual',
      currentPeriodStartsAt: daysAgo(35),
      currentPeriodEndsAt: daysAgo(5),
      autoRenew: false,
    });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/billing/summary')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.subscription).toMatchObject({
      status: 'past_due',
      planKey: 'growth',
    });
    expect(response.body.subscription.gracePeriodEndsAt).toBeTruthy();
    const warningTypes = response.body.warnings.map((w) => w.type);
    expect(warningTypes).toContain('past_due');
  });

  it('cancels to starter after grace period expires', async () => {
    const school = await createSchoolRecord({ name: 'Grace Expired School', code: 'GRACEEXP' });
    const admin = await createStaffUser({
      name: 'Grace Admin',
      email: 'grace.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    await SchoolSubscription.create({
      schoolId: school._id,
      planKey: 'growth',
      trialPlanKey: null,
      status: 'past_due',
      billingCycle: 'monthly',
      provider: 'manual',
      currentPeriodStartsAt: daysAgo(42),
      currentPeriodEndsAt: daysAgo(12),
      gracePeriodEndsAt: daysAgo(5),
      autoRenew: false,
    });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/billing/summary')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.subscription).toMatchObject({
      status: 'cancelled',
      planKey: 'starter',
    });
    expect(response.body.subscription.cancelledAt).toBeTruthy();
  });

  it('cancels subscription immediately via POST /cancel', async () => {
    const school = await createSchoolRecord({ name: 'Cancel School', code: 'CXLNOW' });
    const admin = await createStaffUser({
      name: 'Cancel Admin',
      email: 'cancel.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    await SchoolSubscription.create({
      schoolId: school._id,
      planKey: 'growth',
      trialPlanKey: null,
      status: 'active',
      billingCycle: 'monthly',
      provider: 'manual',
      currentPeriodStartsAt: daysAgo(5),
      currentPeriodEndsAt: daysFromNow(25),
    });

    const { app } = createTestApp();
    const response = await request(app)
      .post('/api/billing/cancel')
      .set(authHeadersFor(admin, 'admin'))
      .send({ immediate: true, reason: 'Testing cancellation' })
      .expect(200);

    expect(response.body).toMatchObject({
      success: true,
      status: 'cancelled',
    });
    expect(response.body.cancelledAt).toBeTruthy();

    const sub = await SchoolSubscription.findOne({ schoolId: school._id });
    expect(sub.planKey).toBe('starter');
    expect(sub.status).toBe('cancelled');
  });

  it('schedules cancel at period end via POST /cancel with immediate=false', async () => {
    const school = await createSchoolRecord({ name: 'Cancel EOT School', code: 'CXLEOT' });
    const admin = await createStaffUser({
      name: 'CancelEOT Admin',
      email: 'cancel.eot.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    await SchoolSubscription.create({
      schoolId: school._id,
      planKey: 'growth',
      trialPlanKey: null,
      status: 'active',
      billingCycle: 'monthly',
      provider: 'manual',
      currentPeriodStartsAt: daysAgo(5),
      currentPeriodEndsAt: daysFromNow(25),
    });

    const { app } = createTestApp();
    const response = await request(app)
      .post('/api/billing/cancel')
      .set(authHeadersFor(admin, 'admin'))
      .send({ immediate: false })
      .expect(200);

    expect(response.body).toMatchObject({
      success: true,
      cancelAtPeriodEnd: true,
    });
    expect(response.body.status).toBe('active');

    // Verify warning appears in summary
    const summaryResponse = await request(app)
      .get('/api/billing/summary')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);
    const warningTypes = summaryResponse.body.warnings.map((w) => w.type);
    expect(warningTypes).toContain('cancellation');
  });

  it('schedules a plan downgrade via POST /downgrade', async () => {
    const school = await createSchoolRecord({ name: 'Downgrade School', code: 'DWNGRADE' });
    const admin = await createStaffUser({
      name: 'Downgrade Admin',
      email: 'downgrade.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    await SchoolSubscription.create({
      schoolId: school._id,
      planKey: 'scale',
      trialPlanKey: null,
      status: 'active',
      billingCycle: 'monthly',
      provider: 'manual',
      currentPeriodStartsAt: daysAgo(5),
      currentPeriodEndsAt: daysFromNow(25),
    });

    const { app } = createTestApp();
    const response = await request(app)
      .post('/api/billing/downgrade')
      .set(authHeadersFor(admin, 'admin'))
      .send({ planKey: 'growth' })
      .expect(200);

    expect(response.body).toMatchObject({
      success: true,
      scheduledDowngradePlanKey: 'growth',
    });
    expect(response.body.scheduledDowngradeAt).toBeTruthy();

    const summaryResponse = await request(app)
      .get('/api/billing/summary')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);
    const warningTypes = summaryResponse.body.warnings.map((w) => w.type);
    expect(warningTypes).toContain('downgrade');
  });

  it('rejects downgrade to a higher-priced plan', async () => {
    const school = await createSchoolRecord({ name: 'Upgrade Reject School', code: 'UPREJCT' });
    const admin = await createStaffUser({
      name: 'UpReject Admin',
      email: 'upreject.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    await SchoolSubscription.create({
      schoolId: school._id,
      planKey: 'growth',
      trialPlanKey: null,
      status: 'active',
      billingCycle: 'monthly',
      provider: 'manual',
      currentPeriodStartsAt: daysAgo(5),
      currentPeriodEndsAt: daysFromNow(25),
    });

    const { app } = createTestApp();
    const response = await request(app)
      .post('/api/billing/downgrade')
      .set(authHeadersFor(admin, 'admin'))
      .send({ planKey: 'scale' })
      .expect(400);

    expect(response.body.error).toMatch(/lower-priced plan/i);
  });

  it('applies scheduled downgrade when period ends', async () => {
    const school = await createSchoolRecord({ name: 'Apply Downgrade School', code: 'APPDGRD' });
    const admin = await createStaffUser({
      name: 'ApplyDgrd Admin',
      email: 'applydgrd.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    await SchoolSubscription.create({
      schoolId: school._id,
      planKey: 'scale',
      trialPlanKey: null,
      status: 'active',
      billingCycle: 'monthly',
      provider: 'manual',
      currentPeriodStartsAt: daysAgo(35),
      currentPeriodEndsAt: daysFromNow(2),
      scheduledDowngradePlanKey: 'growth',
      scheduledDowngradeAt: daysAgo(1),
    });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/billing/summary')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.subscription).toMatchObject({
      planKey: 'growth',
      scheduledDowngradePlanKey: null,
    });
  });

  it('rejects cancel on already-cancelled subscription', async () => {
    const school = await createSchoolRecord({ name: 'Already Cancelled School', code: 'ALRDCXL' });
    const admin = await createStaffUser({
      name: 'AlrdCxl Admin',
      email: 'alrdcxl.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    await SchoolSubscription.create({
      schoolId: school._id,
      planKey: 'starter',
      trialPlanKey: null,
      status: 'cancelled',
      billingCycle: 'monthly',
      provider: 'manual',
      cancelledAt: daysAgo(2),
    });

    const { app } = createTestApp();
    const response = await request(app)
      .post('/api/billing/cancel')
      .set(authHeadersFor(admin, 'admin'))
      .send({ immediate: true })
      .expect(409);

    expect(response.body.error).toMatch(/cancelled/i);
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
