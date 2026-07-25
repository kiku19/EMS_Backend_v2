/**
 * Phase 1b — Plan source-of-truth reconciliation.
 *
 * SchoolSubscription is authoritative for plan/billing state; the matching
 * School.{plan, planStatus, trialEndsAt} fields are a denormalized cache kept
 * in sync by a post-save hook on SchoolSubscription. These tests prove that
 * convergence and guard the drift-prevention guarantee.
 *
 * Subscriptions are created directly (rather than via provisionSchoolSubscription,
 * which hardcodes starter/trialing) so the hook itself is what's under test.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import School from '../models/School.js';
import SchoolSubscription from '../models/SchoolSubscription.js';

async function createTestSchool(overrides = {}) {
  return School.create({
    name: 'Plan Cache School',
    code: `PCS-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    status: 'active',
    isDefault: false,
    ...overrides,
  });
}

function makeSubscription(schoolId, over = {}) {
  return SchoolSubscription.create({
    schoolId,
    planKey: 'growth',
    status: 'active',
    billingCycle: 'monthly',
    provider: 'manual',
    ...over,
  });
}

describe('Plan cache reconciliation (SchoolSubscription → School)', () => {
  let school;

  beforeEach(async () => {
    school = await createTestSchool({ plan: 'starter', planStatus: 'trialing' });
  });

  it('syncs plan, planStatus, and trialEndsAt onto School when a subscription is created', async () => {
    const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await makeSubscription(school._id, { trialEndsAt: trialEnd });

    const refreshed = await School.findById(school._id).lean();
    expect(refreshed.plan).toBe('growth');
    expect(refreshed.planStatus).toBe('active');
    expect(refreshed.trialEndsAt).toEqual(trialEnd);
  });

  it('converges when the subscription status later changes via save()', async () => {
    const subscription = await makeSubscription(school._id);

    subscription.status = 'cancelled';
    await subscription.save();

    const refreshed = await School.findById(school._id).lean();
    expect(refreshed.planStatus).toBe('cancelled');
  });

  it('mirrors the "paused" subscription status without validation drift', async () => {
    const subscription = await makeSubscription(school._id);

    subscription.status = 'paused';
    await subscription.save();

    const refreshed = await School.findById(school._id).lean();
    expect(refreshed.planStatus).toBe('paused');
  });

  it('does NOT overwrite School.plan when the subscription planKey is outside School.plan enum (e.g. enterprise)', async () => {
    const subscription = await makeSubscription(school._id, { planKey: 'growth' });
    // confirm the cache first converged to growth
    expect((await School.findById(school._id).lean()).plan).toBe('growth');

    subscription.planKey = 'enterprise'; // valid on subscription, not cacheable on School
    await subscription.save();

    const refreshed = await School.findById(school._id).lean();
    expect(refreshed.plan).toBe('growth'); // unchanged — no invalid value written
  });
});
