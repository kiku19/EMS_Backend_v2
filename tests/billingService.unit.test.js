/**
 * Unit tests for services/billingService.js
 *
 * Covers:
 *  - Pure helpers: BILLING_PLANS, getEffectivePlan, summarizeSubscription
 *  - DB-backed functions: syncSubscriptionLifecycle, assertSchoolWithinLimit,
 *    cancelSubscription, scheduleDowngrade, provisionSchoolSubscription,
 *    incrementUsageMetric, updateAutoRenew
 *
 * Uses the in-memory MongoDB server from tests/setup.js.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import {
  BILLING_PLANS,
  getEffectivePlan,
  summarizeSubscription,
  provisionSchoolSubscription,
  ensureSchoolSubscription,
  syncSubscriptionLifecycle,
  assertSchoolWithinLimit,
  cancelSubscription,
  scheduleDowngrade,
  incrementUsageMetric,
  updateAutoRenew,
} from '../services/billingService.js';
import School from '../models/School.js';
import SchoolSubscription from '../models/SchoolSubscription.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTestSchool(overrides = {}) {
  return School.create({
    name: 'Billing Test School',
    code: `BILL-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    status: 'active',
    isDefault: false,
    ...overrides,
  });
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// ---------------------------------------------------------------------------
// BILLING_PLANS
// ---------------------------------------------------------------------------

describe('BILLING_PLANS', () => {
  it('contains starter, growth, and scale plans', () => {
    expect(BILLING_PLANS).toHaveProperty('starter');
    expect(BILLING_PLANS).toHaveProperty('growth');
    expect(BILLING_PLANS).toHaveProperty('scale');
  });

  it('starter plan has monthlyPrice of 0', () => {
    expect(BILLING_PLANS.starter.monthlyPrice).toBe(0);
    expect(BILLING_PLANS.starter.annualPrice).toBe(0);
  });

  it('growth plan has limits for students and staff', () => {
    expect(BILLING_PLANS.growth.limits.students).toBeGreaterThan(0);
    expect(BILLING_PLANS.growth.limits.staff).toBeGreaterThan(0);
  });

  it('scale plan has null apiCallsPerMonth (unlimited)', () => {
    expect(BILLING_PLANS.scale.limits.apiCallsPerMonth).toBeNull();
  });

  it('each plan has a capabilities object', () => {
    for (const plan of Object.values(BILLING_PLANS)) {
      expect(plan.capabilities).toBeDefined();
      expect(typeof plan.capabilities.parentApp).toBe('boolean');
    }
  });

  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(BILLING_PLANS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getEffectivePlan
// ---------------------------------------------------------------------------

describe('getEffectivePlan', () => {
  it('returns growth plan for a trialing subscription with trialPlanKey=growth and future trialEndsAt', () => {
    const sub = {
      status: 'trialing',
      planKey: 'starter',
      trialPlanKey: 'growth',
      trialEndsAt: addDays(new Date(), 7),
    };
    expect(getEffectivePlan(sub).key).toBe('growth');
  });

  it('returns starter plan when trialing but trialEndsAt is in the past', () => {
    const sub = {
      status: 'trialing',
      planKey: 'starter',
      trialPlanKey: 'growth',
      trialEndsAt: addDays(new Date(), -1),
    };
    expect(getEffectivePlan(sub).key).toBe('starter');
  });

  it('returns the planKey plan for an active subscription', () => {
    const sub = { status: 'active', planKey: 'growth', trialPlanKey: null };
    expect(getEffectivePlan(sub).key).toBe('growth');
  });

  it('returns starter plan for a cancelled subscription', () => {
    const sub = { status: 'cancelled', planKey: 'starter', trialPlanKey: null };
    expect(getEffectivePlan(sub).key).toBe('starter');
  });

  it('defaults to starter for null subscription', () => {
    expect(getEffectivePlan(null).key).toBe('starter');
  });

  it('defaults to starter for unknown planKey', () => {
    const sub = { status: 'active', planKey: 'nonexistent' };
    expect(getEffectivePlan(sub).key).toBe('starter');
  });
});

// ---------------------------------------------------------------------------
// summarizeSubscription
// ---------------------------------------------------------------------------

describe('summarizeSubscription', () => {
  it('returns null for null input', () => {
    expect(summarizeSubscription(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(summarizeSubscription(undefined)).toBeNull();
  });

  it('returns expected fields for a trialing subscription', () => {
    const sub = {
      status: 'trialing',
      planKey: 'starter',
      trialPlanKey: 'growth',
      billingCycle: 'monthly',
      autoRenew: true,
      provider: 'manual',
      trialEndsAt: addDays(new Date(), 10),
      currentPeriodEndsAt: null,
      nextBillingAt: null,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      scheduledDowngradePlanKey: null,
      scheduledDowngradeAt: null,
    };

    const result = summarizeSubscription(sub);

    expect(result.status).toBe('trialing');
    expect(result.planKey).toBe('growth'); // effective plan during trial
    expect(result.inTrial).toBe(true);
    expect(result.autoRenew).toBe(true);
  });

  it('returns inTrial=false when trial is expired', () => {
    const sub = {
      status: 'trialing',
      planKey: 'starter',
      trialPlanKey: 'growth',
      billingCycle: 'monthly',
      autoRenew: false,
      provider: 'manual',
      trialEndsAt: addDays(new Date(), -1),
      currentPeriodEndsAt: null,
      nextBillingAt: null,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      scheduledDowngradePlanKey: null,
      scheduledDowngradeAt: null,
    };

    const result = summarizeSubscription(sub);
    expect(result.inTrial).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// provisionSchoolSubscription (DB)
// ---------------------------------------------------------------------------

describe('provisionSchoolSubscription', () => {
  it('creates a new subscription with trialing status', async () => {
    const school = await createTestSchool();
    const sub = await provisionSchoolSubscription({ schoolId: school._id });

    expect(sub.status).toBe('trialing');
    expect(sub.planKey).toBe('starter');
    expect(sub.trialPlanKey).toBe('growth');
    expect(sub.schoolId.toString()).toBe(school._id.toString());
  });

  it('sets trialEndsAt in the future', async () => {
    const school = await createTestSchool();
    const sub = await provisionSchoolSubscription({ schoolId: school._id });

    expect(sub.trialEndsAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('initializes all usage metric fields', async () => {
    const school = await createTestSchool();
    const sub = await provisionSchoolSubscription({ schoolId: school._id });

    expect(sub.usageMetrics.students.current).toBe(0);
    expect(sub.usageMetrics.staff.current).toBe(0);
    expect(sub.usageMetrics.storageMb.current).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// syncSubscriptionLifecycle (DB)
// ---------------------------------------------------------------------------

describe('syncSubscriptionLifecycle', () => {
  it('returns null for null input', async () => {
    const result = await syncSubscriptionLifecycle(null);
    expect(result).toBeNull();
  });

  it('transitions trialing → active when trial has expired', async () => {
    const school = await createTestSchool();
    const sub = await SchoolSubscription.create({
      schoolId: school._id,
      planKey: 'starter',
      trialPlanKey: 'growth',
      status: 'trialing',
      billingCycle: 'monthly',
      provider: 'manual',
      trialStartsAt: addDays(new Date(), -20),
      trialEndsAt: addDays(new Date(), -1), // expired
      autoRenew: true,
      usageMetrics: {
        students: { current: 0 },
        staff: { current: 0 },
        storageMb: { current: 0 },
        smsCredits: { current: 0 },
        apiCalls: { current: 0 },
      },
    });

    const updated = await syncSubscriptionLifecycle(sub);

    expect(updated.status).toBe('active');
    expect(updated.trialPlanKey).toBeNull();
  });

  it('does not modify an active subscription that is not past due', async () => {
    const school = await createTestSchool();
    const sub = await SchoolSubscription.create({
      schoolId: school._id,
      planKey: 'starter',
      status: 'active',
      billingCycle: 'monthly',
      provider: 'manual',
      autoRenew: true,
      usageMetrics: {
        students: { current: 0 },
        staff: { current: 0 },
        storageMb: { current: 0 },
        smsCredits: { current: 0 },
        apiCalls: { current: 0 },
      },
    });

    const updated = await syncSubscriptionLifecycle(sub);
    expect(updated.status).toBe('active');
  });

  it('transitions past_due → cancelled when grace period expires', async () => {
    const school = await createTestSchool();
    const sub = await SchoolSubscription.create({
      schoolId: school._id,
      planKey: 'growth',
      status: 'past_due',
      billingCycle: 'monthly',
      provider: 'manual',
      autoRenew: false,
      gracePeriodEndsAt: addDays(new Date(), -1), // grace period expired
      usageMetrics: {
        students: { current: 0 },
        staff: { current: 0 },
        storageMb: { current: 0 },
        smsCredits: { current: 0 },
        apiCalls: { current: 0 },
      },
    });

    const updated = await syncSubscriptionLifecycle(sub);

    expect(updated.status).toBe('cancelled');
    expect(updated.planKey).toBe('starter');
  });
});

// ---------------------------------------------------------------------------
// assertSchoolWithinLimit (DB)
// ---------------------------------------------------------------------------

describe('assertSchoolWithinLimit', () => {
  it('does not throw when metric is within plan limits', async () => {
    const school = await createTestSchool();
    // starter plan has students limit of 200; current=0, delta=1 → OK
    await expect(
      assertSchoolWithinLimit({ schoolId: school._id, metric: 'students', delta: 1 })
    ).resolves.not.toThrow();
  });

  it('throws PLAN_LIMIT_REACHED when metric exceeds limit', async () => {
    const school = await createTestSchool();
    const sub = await ensureSchoolSubscription(school._id);

    // Force usage to exactly the limit
    const limit = BILLING_PLANS[getEffectivePlan(sub).key].limits.students;
    sub.usageMetrics.students = { current: limit, trackedAt: new Date() };
    await sub.save();

    await expect(
      assertSchoolWithinLimit({ schoolId: school._id, metric: 'students', delta: 1 })
    ).rejects.toThrow(/limit reached/i);
  });

  it('error has status 403 and code PLAN_LIMIT_REACHED', async () => {
    const school = await createTestSchool();
    const sub = await ensureSchoolSubscription(school._id);

    const effectivePlan = getEffectivePlan(sub);
    const limit = BILLING_PLANS[effectivePlan.key].limits.students;
    sub.usageMetrics.students = { current: limit, trackedAt: new Date() };
    await sub.save();

    let err;
    try {
      await assertSchoolWithinLimit({ schoolId: school._id, metric: 'students', delta: 1 });
    } catch (e) {
      err = e;
    }

    expect(err).toBeDefined();
    expect(err.status).toBe(403);
    expect(err.code).toBe('PLAN_LIMIT_REACHED');
  });
});

// ---------------------------------------------------------------------------
// cancelSubscription (DB)
// ---------------------------------------------------------------------------

describe('cancelSubscription', () => {
  it('cancels a trialing subscription immediately', async () => {
    const school = await createTestSchool();
    await provisionSchoolSubscription({ schoolId: school._id });

    const result = await cancelSubscription(school._id);

    expect(result.status).toBe('cancelled');
    expect(result.planKey).toBe('starter');
  });

  it('cancels an active subscription at period end when immediate=false', async () => {
    const school = await createTestSchool();
    const sub = await SchoolSubscription.create({
      schoolId: school._id,
      planKey: 'growth',
      status: 'active',
      billingCycle: 'monthly',
      provider: 'manual',
      autoRenew: true,
      currentPeriodEndsAt: addDays(new Date(), 30),
      usageMetrics: {
        students: { current: 0 },
        staff: { current: 0 },
        storageMb: { current: 0 },
        smsCredits: { current: 0 },
        apiCalls: { current: 0 },
      },
    });

    const result = await cancelSubscription(school._id, { immediate: false });

    expect(result.cancelAtPeriodEnd).toBe(true);
    expect(result.status).toBe('active'); // still active until period ends
  });

  it('cancels immediately when immediate=true', async () => {
    const school = await createTestSchool();
    await SchoolSubscription.create({
      schoolId: school._id,
      planKey: 'growth',
      status: 'active',
      billingCycle: 'monthly',
      provider: 'manual',
      autoRenew: true,
      currentPeriodEndsAt: addDays(new Date(), 30),
      usageMetrics: {
        students: { current: 0 },
        staff: { current: 0 },
        storageMb: { current: 0 },
        smsCredits: { current: 0 },
        apiCalls: { current: 0 },
      },
    });

    const result = await cancelSubscription(school._id, { immediate: true });

    expect(result.status).toBe('cancelled');
  });

  it('throws 409 when subscription is already cancelled', async () => {
    const school = await createTestSchool();
    await SchoolSubscription.create({
      schoolId: school._id,
      planKey: 'starter',
      status: 'cancelled',
      billingCycle: 'monthly',
      provider: 'manual',
      autoRenew: false,
      usageMetrics: {
        students: { current: 0 },
        staff: { current: 0 },
        storageMb: { current: 0 },
        smsCredits: { current: 0 },
        apiCalls: { current: 0 },
      },
    });

    await expect(cancelSubscription(school._id)).rejects.toMatchObject({ status: 409 });
  });
});

// ---------------------------------------------------------------------------
// scheduleDowngrade (DB)
// ---------------------------------------------------------------------------

describe('scheduleDowngrade', () => {
  it('throws 400 for an invalid plan key', async () => {
    const school = await createTestSchool();
    await provisionSchoolSubscription({ schoolId: school._id });

    await expect(scheduleDowngrade(school._id, { planKey: 'nonexistent' })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('throws 409 when subscription is not active', async () => {
    const school = await createTestSchool();
    // trialing is not active
    await provisionSchoolSubscription({ schoolId: school._id });

    await expect(scheduleDowngrade(school._id, { planKey: 'starter' })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('sets scheduledDowngradePlanKey for a valid downgrade', async () => {
    const school = await createTestSchool();
    await SchoolSubscription.create({
      schoolId: school._id,
      planKey: 'scale',
      status: 'active',
      billingCycle: 'monthly',
      provider: 'manual',
      autoRenew: true,
      currentPeriodEndsAt: addDays(new Date(), 30),
      usageMetrics: {
        students: { current: 0 },
        staff: { current: 0 },
        storageMb: { current: 0 },
        smsCredits: { current: 0 },
        apiCalls: { current: 0 },
      },
    });

    const result = await scheduleDowngrade(school._id, { planKey: 'starter' });

    expect(result.scheduledDowngradePlanKey).toBe('starter');
    expect(result.scheduledDowngradeAt).toBeDefined();
  });

  it('throws 400 when trying to downgrade to same or higher-priced plan', async () => {
    const school = await createTestSchool();
    await SchoolSubscription.create({
      schoolId: school._id,
      planKey: 'starter',
      status: 'active',
      billingCycle: 'monthly',
      provider: 'manual',
      autoRenew: true,
      currentPeriodEndsAt: addDays(new Date(), 30),
      usageMetrics: {
        students: { current: 0 },
        staff: { current: 0 },
        storageMb: { current: 0 },
        smsCredits: { current: 0 },
        apiCalls: { current: 0 },
      },
    });

    // starter → growth is an upgrade, not a downgrade
    await expect(scheduleDowngrade(school._id, { planKey: 'growth' })).rejects.toMatchObject({
      status: 400,
    });
  });
});

// ---------------------------------------------------------------------------
// incrementUsageMetric (DB)
// ---------------------------------------------------------------------------

describe('incrementUsageMetric', () => {
  it('increments a metric by the specified delta', async () => {
    const school = await createTestSchool();
    const sub = await provisionSchoolSubscription({ schoolId: school._id });
    const initialStudents = sub.usageMetrics.students.current;

    const updated = await incrementUsageMetric(school._id, 'students', 5);

    expect(updated.usageMetrics.students.current).toBe(initialStudents + 5);
  });

  it('clamps metric to 0 when delta makes it negative', async () => {
    const school = await createTestSchool();
    await provisionSchoolSubscription({ schoolId: school._id });

    const updated = await incrementUsageMetric(school._id, 'students', -100);

    expect(updated.usageMetrics.students.current).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// updateAutoRenew (DB)
// ---------------------------------------------------------------------------

describe('updateAutoRenew', () => {
  it('sets autoRenew to true', async () => {
    const school = await createTestSchool();
    await provisionSchoolSubscription({ schoolId: school._id });

    const result = await updateAutoRenew(school._id, true);
    expect(result.autoRenew).toBe(true);
  });

  it('sets autoRenew to false and clears nextBillingAt', async () => {
    const school = await createTestSchool();
    await provisionSchoolSubscription({ schoolId: school._id });

    const result = await updateAutoRenew(school._id, false);
    expect(result.autoRenew).toBe(false);
    expect(result.nextBillingAt).toBeNull();
  });
});
