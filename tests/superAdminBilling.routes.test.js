/**
 * Phase 5 — Super-admin billing management.
 *
 * Cross-school revenue overview + subscription/invoice lists + override + invoice actions.
 */

import request from 'supertest';
import { describe, expect, it, beforeEach } from 'vitest';
import { generateToken } from '../middleware/auth.js';
import { resetDefaultSchool, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';
import { School } from '../database.js';
import SchoolSubscription from '../models/SchoolSubscription.js';
import SchoolInvoice from '../models/SchoolInvoice.js';

const BASE = '/api/v1/super-admin/billing';
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

async function makeActiveSubscription(
  schoolId,
  { planKey = 'growth', billingCycle = 'monthly' } = {}
) {
  return SchoolSubscription.findOneAndUpdate(
    { schoolId },
    {
      schoolId,
      planKey,
      status: 'active',
      billingCycle,
      provider: 'manual',
      currentPeriodStartsAt: new Date(),
      currentPeriodEndsAt: new Date(Date.now() + 30 * 86400000),
    },
    { upsert: true, new: true }
  );
}

async function makeInvoice(
  schoolId,
  subscriptionId,
  { amount = 2499, status = 'issued', invoiceNumber, paidAt = null } = {}
) {
  return SchoolInvoice.create({
    schoolId,
    subscriptionId,
    invoiceNumber: invoiceNumber || `INV-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    planKey: 'growth',
    billingCycle: 'monthly',
    amount,
    currency: 'INR',
    status,
    provider: 'manual',
    paidAt,
  });
}

describe('super-admin billing', () => {
  let schoolA, schoolB, adminA;

  beforeEach(async () => {
    resetDefaultSchool();
    schoolA = await createSchoolRecord({ name: 'Bill School A', code: 'BLA' });
    schoolB = await createSchoolRecord({ name: 'Bill School B', code: 'BLB' });
    adminA = await createStaffUser({
      name: 'Bill Admin',
      email: 'bill@example.com',
      schoolId: schoolA._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
  });

  it('rejects non-super-admin staff with 403', async () => {
    const res = await request(app).get(BASE).set(staffHeaders(adminA));
    expect(res.status).toBe(403);
  });

  it('returns MRR/ARR overview aggregating active subscriptions', async () => {
    await makeActiveSubscription(schoolA._id, { planKey: 'growth', billingCycle: 'monthly' }); // 2499/mo
    await makeActiveSubscription(schoolB._id, { planKey: 'scale', billingCycle: 'annual' }); // 69990/12 = 5832.5/mo

    const res = await request(app).get(BASE).set(SUPER_ADMIN_HEADERS);
    expect(res.status).toBe(200);
    // 2499 + 5832.5 = 8331.5 → rounded 8332
    expect(res.body.mrr).toBeGreaterThanOrEqual(8000);
    expect(res.body.arr).toBe(res.body.mrr * 12);
    expect(res.body.currency).toBe('INR');
    expect(Array.isArray(res.body.counts.byPlan)).toBe(true);
  });

  it('lists subscriptions across schools with school populated', async () => {
    await makeActiveSubscription(schoolA._id, { planKey: 'growth' });
    await makeActiveSubscription(schoolB._id, { planKey: 'scale' });

    const res = await request(app).get(`${BASE}/subscriptions`).set(SUPER_ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const names = res.body.data.map((r) => r.schoolName).sort();
    expect(names).toEqual(['Bill School A', 'Bill School B'].sort());
  });

  it('filters subscriptions by status', async () => {
    await makeActiveSubscription(schoolA._id, { planKey: 'growth' });
    // schoolB stays on the default trialing subscription created by ensureSchoolSubscription elsewhere;
    // create an explicit active one then query only active.
    const res = await request(app)
      .get(`${BASE}/subscriptions`)
      .query({ status: 'active' })
      .set(SUPER_ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.data.every((r) => r.status === 'active')).toBe(true);
  });

  it('lists invoices across schools', async () => {
    const subA = await makeActiveSubscription(schoolA._id);
    const subB = await makeActiveSubscription(schoolB._id);
    await makeInvoice(schoolA._id, subA._id, { invoiceNumber: 'INV-A1' });
    await makeInvoice(schoolB._id, subB._id, {
      invoiceNumber: 'INV-B1',
      status: 'paid',
      paidAt: new Date(),
    });

    const res = await request(app).get(`${BASE}/invoices`).set(SUPER_ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it('overrides a subscription plan and syncs the School cache (Phase 1b)', async () => {
    await makeActiveSubscription(schoolA._id, { planKey: 'growth' });
    const res = await request(app)
      .patch(`${BASE}/subscriptions/${schoolA._id}`)
      .send({ planKey: 'scale', status: 'active' })
      .set(SUPER_ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.summary.planKey).toBe('scale');

    // Phase 1b hook should have synced School.plan too.
    const school = await School.findById(schoolA._id).lean();
    expect(school.plan).toBe('scale');
    expect(school.planStatus).toBe('active');
  });

  it('extends a trial via override (trialEndsAt)', async () => {
    await makeActiveSubscription(schoolA._id);
    const future = new Date(Date.now() + 20 * 86400000);
    const res = await request(app)
      .patch(`${BASE}/subscriptions/${schoolA._id}`)
      .send({ trialEndsAt: future.toISOString() })
      .set(SUPER_ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(new Date(res.body.summary.trialEndsAt).getDate()).toBe(future.getDate());
  });

  it('marks an invoice paid, then refuses to void it (use refund)', async () => {
    const sub = await makeActiveSubscription(schoolA._id);
    await makeInvoice(schoolA._id, sub._id, { invoiceNumber: 'INV-PAY', status: 'issued' });

    const paid = await request(app)
      .post(`${BASE}/invoices/INV-PAY/mark-paid`)
      .set(SUPER_ADMIN_HEADERS);
    expect(paid.status).toBe(200);

    // Now voiding a paid invoice must 409.
    const voidRes = await request(app)
      .post(`${BASE}/invoices/INV-PAY/void`)
      .set(SUPER_ADMIN_HEADERS);
    expect(voidRes.status).toBe(409);
  });

  it('refunds a paid invoice', async () => {
    const sub = await makeActiveSubscription(schoolA._id);
    await makeInvoice(schoolA._id, sub._id, {
      invoiceNumber: 'INV-REF',
      status: 'paid',
      paidAt: new Date(),
    });

    const res = await request(app)
      .post(`${BASE}/invoices/INV-REF/refund`)
      .send({ reason: 'Customer complaint' })
      .set(SUPER_ADMIN_HEADERS);
    expect(res.status).toBe(200);

    const inv = await SchoolInvoice.findOne({ invoiceNumber: 'INV-REF' });
    expect(inv.status).toBe('refunded');
    expect(inv.metadata.refundReason).toBe('Customer complaint');
  });

  it('rejects an override with no fields with 400', async () => {
    const res = await request(app)
      .patch(`${BASE}/subscriptions/${schoolA._id}`)
      .send({})
      .set(SUPER_ADMIN_HEADERS);
    expect(res.status).toBe(400);
  });
});
