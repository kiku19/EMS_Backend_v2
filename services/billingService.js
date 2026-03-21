import crypto from 'crypto';
import PDFDocument from 'pdfkit';
import SchoolInvoice from '../models/SchoolInvoice.js';
import SchoolSubscription from '../models/SchoolSubscription.js';
import { Counter, School, Staff } from '../database.js';
import { getBillingGateway } from './paymentGateway/index.js';
import { sendEmail } from '../config/email.js';
import { redeemCoupon, calculateDiscount, validateCoupon } from './couponService.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('BillingService');

const DEFAULT_TRIAL_DAYS = Number.parseInt(process.env.SCHOOL_TRIAL_DAYS || '14', 10);
const DEFAULT_GRACE_DAYS = Number.parseInt(process.env.BILLING_GRACE_DAYS || '7', 10);
const DEFAULT_CURRENCY = (process.env.BILLING_CURRENCY || 'INR').toUpperCase();
const DEFAULT_BILLING_PROVIDER = process.env.BILLING_PROVIDER?.trim()?.toLowerCase() || 'manual';

export const BILLING_PLANS = Object.freeze({
  starter: {
    key: 'starter',
    name: 'Starter',
    description: 'Free plan for smaller schools validating the product before rollout.',
    monthlyPrice: 0,
    annualPrice: 0,
    limits: {
      students: 200,
      staff: 25,
      storageMb: 5 * 1024,
      smsCredits: 2000,
      apiCallsPerMonth: 10000,
    },
    capabilities: {
      parentApp: true,
      advancedReports: false,
      aiAssistant: false,
      customBranding: false,
      prioritySupport: false,
      apiAccess: false,
      multiBranch: false,
    },
  },
  growth: {
    key: 'growth',
    name: 'Growth',
    description: 'Full operating plan for schools that need broader usage and premium workflows.',
    monthlyPrice: 2499,
    annualPrice: 24990,
    limits: {
      students: 1000,
      staff: 120,
      storageMb: 25 * 1024,
      smsCredits: 10000,
      apiCallsPerMonth: 100000,
    },
    capabilities: {
      parentApp: true,
      advancedReports: true,
      aiAssistant: true,
      customBranding: false,
      prioritySupport: true,
      apiAccess: false,
      multiBranch: false,
    },
  },
  scale: {
    key: 'scale',
    name: 'Scale',
    description: 'High-volume plan with multi-branch operations and deeper platform access.',
    monthlyPrice: 6999,
    annualPrice: 69990,
    limits: {
      students: 5000,
      staff: 500,
      storageMb: 100 * 1024,
      smsCredits: 50000,
      apiCallsPerMonth: null, // unlimited
    },
    capabilities: {
      parentApp: true,
      advancedReports: true,
      aiAssistant: true,
      customBranding: true,
      prioritySupport: true,
      apiAccess: true,
      multiBranch: true,
    },
  },
});

function getPlan(planKey = 'starter') {
  return BILLING_PLANS[planKey] || BILLING_PLANS.starter;
}

function hasPlan(planKey) {
  return Boolean(planKey) && Object.prototype.hasOwnProperty.call(BILLING_PLANS, planKey);
}

function addDays(date, days) {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
}

function addBillingPeriod(date, billingCycle) {
  const value = new Date(date);
  if (billingCycle === 'annual') {
    value.setFullYear(value.getFullYear() + 1);
    return value;
  }

  value.setMonth(value.getMonth() + 1);
  return value;
}

function getPriceForCycle(plan, billingCycle = 'monthly') {
  return billingCycle === 'annual' ? plan.annualPrice : plan.monthlyPrice;
}

function formatLimit(limit) {
  return Number.isFinite(limit) ? limit : null;
}

function buildUsageEntry(current, limit) {
  const normalizedLimit = formatLimit(limit);
  const percentage =
    normalizedLimit && normalizedLimit > 0
      ? Math.min(100, Math.round((current / normalizedLimit) * 100))
      : 0;

  return {
    current,
    limit: normalizedLimit,
    remaining: normalizedLimit === null ? null : Math.max(normalizedLimit - current, 0),
    percentage,
    isNearLimit: normalizedLimit !== null && percentage >= 80,
    isExceeded: normalizedLimit !== null && current > normalizedLimit,
  };
}

function serializePlan(plan, billingCycle = 'monthly') {
  return {
    key: plan.key,
    name: plan.name,
    description: plan.description,
    price: getPriceForCycle(plan, billingCycle),
    monthlyPrice: plan.monthlyPrice,
    annualPrice: plan.annualPrice,
    limits: plan.limits,
    capabilities: plan.capabilities,
  };
}

function normalizeMetricValue(metric) {
  if (!metric || typeof metric.current !== 'number') {
    return 0;
  }

  return Math.max(metric.current, 0);
}

export function summarizeSubscription(subscription) {
  if (!subscription) {
    return null;
  }

  const now = new Date();
  const effectivePlan = getEffectivePlan(subscription);
  const inTrial =
    subscription.status === 'trialing' &&
    subscription.trialEndsAt &&
    subscription.trialEndsAt > now;

  return {
    planKey: effectivePlan.key,
    planName: effectivePlan.name,
    status: subscription.status,
    billingCycle: subscription.billingCycle,
    autoRenew: Boolean(subscription.autoRenew),
    provider: subscription.provider,
    trialEndsAt: subscription.trialEndsAt,
    currentPeriodEndsAt: subscription.currentPeriodEndsAt,
    nextBillingAt: subscription.nextBillingAt,
    inTrial,
    gracePeriodEndsAt: subscription.gracePeriodEndsAt || null,
    cancelAtPeriodEnd: Boolean(subscription.cancelAtPeriodEnd),
    cancelledAt: subscription.cancelledAt || null,
    scheduledDowngradePlanKey: subscription.scheduledDowngradePlanKey || null,
    scheduledDowngradeAt: subscription.scheduledDowngradeAt || null,
  };
}

function buildWarnings(subscription, usage) {
  const warnings = [];
  const now = new Date();

  if (subscription.status === 'trialing' && subscription.trialEndsAt) {
    const millisRemaining = subscription.trialEndsAt.getTime() - now.getTime();
    const daysRemaining = Math.ceil(millisRemaining / (24 * 60 * 60 * 1000));
    if (daysRemaining <= 7) {
      warnings.push({
        type: 'trial',
        severity: daysRemaining <= 3 ? 'high' : 'medium',
        message: `Trial ends in ${Math.max(daysRemaining, 0)} day${daysRemaining === 1 ? '' : 's'}.`,
      });
    }
  }

  if (subscription.status === 'past_due' && subscription.gracePeriodEndsAt) {
    const millisRemaining = subscription.gracePeriodEndsAt.getTime() - now.getTime();
    const daysRemaining = Math.ceil(millisRemaining / (24 * 60 * 60 * 1000));
    warnings.push({
      type: 'past_due',
      severity: 'high',
      message: `Subscription payment overdue. Access will be restricted in ${Math.max(daysRemaining, 0)} day${daysRemaining === 1 ? '' : 's'}.`,
    });
  }

  if (
    subscription.status === 'active' &&
    subscription.cancelAtPeriodEnd &&
    subscription.currentPeriodEndsAt
  ) {
    const millisRemaining = subscription.currentPeriodEndsAt.getTime() - now.getTime();
    const daysRemaining = Math.ceil(millisRemaining / (24 * 60 * 60 * 1000));
    warnings.push({
      type: 'cancellation',
      severity: 'medium',
      message: `Subscription will be cancelled in ${Math.max(daysRemaining, 0)} day${daysRemaining === 1 ? '' : 's'}.`,
    });
  }

  if (subscription.scheduledDowngradePlanKey && subscription.scheduledDowngradeAt) {
    warnings.push({
      type: 'downgrade',
      severity: 'medium',
      message: `Plan will downgrade to ${getPlan(subscription.scheduledDowngradePlanKey).name} at the end of the current billing period.`,
    });
  }

  Object.entries(usage).forEach(([resource, value]) => {
    if (value.isExceeded) {
      warnings.push({
        type: 'limit',
        severity: 'high',
        message: `${resource} usage has exceeded the current plan limit.`,
      });
    } else if (value.isNearLimit) {
      warnings.push({
        type: 'limit',
        severity: 'medium',
        message: `${resource} usage is above 80% of the current plan limit.`,
      });
    }
  });

  return warnings;
}

export async function provisionSchoolSubscription({
  schoolId,
  billingContactName = null,
  billingEmail = null,
  billingPhone = null,
} = {}) {
  const now = new Date();
  const subscription = await SchoolSubscription.create({
    schoolId,
    planKey: 'starter',
    trialPlanKey: 'growth',
    status: 'trialing',
    billingCycle: 'monthly',
    provider: DEFAULT_BILLING_PROVIDER === 'razorpay' ? 'razorpay' : 'manual',
    trialStartsAt: now,
    trialEndsAt: addDays(now, DEFAULT_TRIAL_DAYS),
    autoRenew: true,
    billingContactName,
    billingEmail,
    billingPhone,
    usageMetrics: {
      students: { current: 0, trackedAt: now },
      staff: { current: 0, trackedAt: now },
      storageMb: { current: 0, trackedAt: now },
      smsCredits: { current: 0, trackedAt: now },
      apiCalls: { current: 0, trackedAt: now, periodStart: now },
    },
  });

  return subscription;
}

export async function ensureSchoolSubscription(schoolId, defaults = {}) {
  let subscription = await SchoolSubscription.findOne({ schoolId });

  if (!subscription) {
    try {
      subscription = await provisionSchoolSubscription({
        schoolId,
        billingContactName: defaults.billingContactName || null,
        billingEmail: defaults.billingEmail || null,
        billingPhone: defaults.billingPhone || null,
      });
    } catch (err) {
      // Under concurrent load two requests can both see no subscription and both
      // attempt to insert — the second one hits the unique index (E11000).
      // Re-fetch the document that the winning request just created.
      if (err.code === 11000) {
        subscription = await SchoolSubscription.findOne({ schoolId });
      } else {
        throw err;
      }
    }
  }

  return syncSubscriptionLifecycle(subscription);
}

export async function syncSubscriptionLifecycle(subscription) {
  if (!subscription) {
    return null;
  }

  const now = new Date();
  let changed = false;

  // 1. Trial expiry → active (on free starter plan after trial)
  if (
    subscription.status === 'trialing' &&
    subscription.trialEndsAt &&
    subscription.trialEndsAt <= now
  ) {
    subscription.status = 'active';
    subscription.trialPlanKey = null;
    changed = true;
  }

  // 2. Active paid subscription: set period dates on first activation
  if (
    subscription.status === 'active' &&
    getPriceForCycle(getPlan(subscription.planKey), subscription.billingCycle) > 0 &&
    !subscription.currentPeriodStartsAt
  ) {
    subscription.currentPeriodStartsAt = now;
    subscription.currentPeriodEndsAt = addBillingPeriod(now, subscription.billingCycle);
    subscription.nextBillingAt = subscription.autoRenew ? subscription.currentPeriodEndsAt : null;
    changed = true;
  }

  // 3. Period ended: apply cancelAtPeriodEnd or enter grace period (paid plans only)
  if (
    subscription.status === 'active' &&
    subscription.currentPeriodEndsAt &&
    subscription.currentPeriodEndsAt <= now
  ) {
    if (subscription.cancelAtPeriodEnd) {
      subscription.status = 'cancelled';
      subscription.cancelledAt = now;
      subscription.planKey = 'starter';
      subscription.trialPlanKey = null;
      subscription.nextBillingAt = null;
      subscription.cancelAtPeriodEnd = false;
      changed = true;
    } else if (getPriceForCycle(getPlan(subscription.planKey), subscription.billingCycle) > 0) {
      // Paid plan expired without renewal → enter grace period
      subscription.status = 'past_due';
      subscription.gracePeriodEndsAt = addDays(
        subscription.currentPeriodEndsAt,
        DEFAULT_GRACE_DAYS
      );
      subscription.nextBillingAt = null;
      changed = true;

      // Send dunning email (fire-and-forget)
      SchoolInvoice.findOne({
        schoolId: subscription.schoolId,
        status: { $in: ['issued', 'failed'] },
      })
        .sort({ createdAt: -1 })
        .lean()
        .then(async (latestInvoice) => {
          if (!latestInvoice) return;
          const school = await School.findById(subscription.schoolId).lean();
          if (school)
            await sendDunningEmail(latestInvoice, subscription, school).catch((err) =>
              logger.warn({ err, schoolId: subscription.schoolId }, 'Dunning email failed')
            );
        })
        .catch((err) =>
          logger.warn({ err, schoolId: subscription.schoolId }, 'Dunning invoice lookup failed')
        );
    }
  }

  // 4. Apply scheduled downgrade when its date arrives
  if (
    subscription.scheduledDowngradePlanKey &&
    subscription.scheduledDowngradeAt &&
    subscription.scheduledDowngradeAt <= now &&
    subscription.status === 'active'
  ) {
    subscription.planKey = subscription.scheduledDowngradePlanKey;
    subscription.scheduledDowngradePlanKey = null;
    subscription.scheduledDowngradeAt = null;
    changed = true;
  }

  // 5. Grace period expired → cancel and downgrade to starter
  if (
    subscription.status === 'past_due' &&
    subscription.gracePeriodEndsAt &&
    subscription.gracePeriodEndsAt <= now
  ) {
    subscription.status = 'cancelled';
    subscription.cancelledAt = now;
    subscription.planKey = 'starter';
    subscription.trialPlanKey = null;
    subscription.scheduledDowngradePlanKey = null;
    subscription.scheduledDowngradeAt = null;
    subscription.gracePeriodEndsAt = null;
    changed = true;
  }

  if (changed) {
    await subscription.save();
  }

  return subscription;
}

export function getEffectivePlan(subscription) {
  const now = new Date();
  if (
    subscription?.status === 'trialing' &&
    subscription?.trialPlanKey &&
    subscription?.trialEndsAt &&
    subscription.trialEndsAt > now
  ) {
    return getPlan(subscription.trialPlanKey);
  }

  return getPlan(subscription?.planKey);
}

export async function syncUsageMetrics(schoolId) {
  const subscription = await ensureSchoolSubscription(schoolId);
  const now = new Date();
  const staffCount = await Staff.countDocuments({
    schoolId,
    status: 'active',
  });

  subscription.usageMetrics.staff = {
    current: staffCount,
    trackedAt: now,
  };

  if (!subscription.usageMetrics.students) {
    subscription.usageMetrics.students = {
      current: 0,
      trackedAt: now,
    };
  }

  if (!subscription.usageMetrics.storageMb) {
    subscription.usageMetrics.storageMb = {
      current: 0,
      trackedAt: now,
    };
  }

  if (!subscription.usageMetrics.smsCredits) {
    subscription.usageMetrics.smsCredits = {
      current: 0,
      trackedAt: now,
    };
  }

  if (!subscription.usageMetrics.apiCalls) {
    subscription.usageMetrics.apiCalls = {
      current: 0,
      trackedAt: now,
      periodStart: now,
    };
  }

  await subscription.save();
  return subscription;
}

export async function incrementUsageMetric(schoolId, metric, delta = 1) {
  const subscription = await ensureSchoolSubscription(schoolId);
  const current = normalizeMetricValue(subscription.usageMetrics?.[metric]);

  subscription.usageMetrics[metric] = {
    current: Math.max(current + delta, 0),
    trackedAt: new Date(),
  };

  await subscription.save();
  return subscription;
}

export async function trackApiCall(schoolId) {
  const now = new Date();
  const subscription = await SchoolSubscription.findOne({ schoolId });
  if (!subscription) return;

  const apiCalls = subscription.usageMetrics?.apiCalls;
  const isNewPeriod =
    !apiCalls?.periodStart ||
    new Date(apiCalls.periodStart).getMonth() !== now.getMonth() ||
    new Date(apiCalls.periodStart).getFullYear() !== now.getFullYear();

  if (isNewPeriod) {
    await SchoolSubscription.updateOne(
      { schoolId },
      { $set: { 'usageMetrics.apiCalls': { current: 1, trackedAt: now, periodStart: now } } }
    );
  } else {
    await SchoolSubscription.updateOne(
      { schoolId },
      {
        $inc: { 'usageMetrics.apiCalls.current': 1 },
        $set: { 'usageMetrics.apiCalls.trackedAt': now },
      }
    );
  }
}

export async function assertSchoolWithinLimit({ schoolId, metric, delta = 1 }) {
  const subscription =
    metric === 'staff'
      ? await syncUsageMetrics(schoolId)
      : await ensureSchoolSubscription(schoolId);
  const effectivePlan = getEffectivePlan(subscription);
  const limit = effectivePlan.limits?.[metric];

  if (!Number.isFinite(limit)) {
    return subscription;
  }

  const current = normalizeMetricValue(subscription.usageMetrics?.[metric]);
  if (current + delta > limit) {
    const error = new Error(`${metric} limit reached for the ${effectivePlan.name} plan`);
    error.status = 403;
    error.code = 'PLAN_LIMIT_REACHED';
    error.details = {
      metric,
      current,
      limit,
      planKey: effectivePlan.key,
      planName: effectivePlan.name,
    };
    throw error;
  }

  return subscription;
}

export async function getAllSchoolsUsage() {
  const subscriptions = await SchoolSubscription.find({})
    .select('schoolId planKey trialPlanKey status trialEndsAt usageMetrics')
    .lean();

  const schoolIds = subscriptions.map((s) => s.schoolId);
  const schools = await School.find({ _id: { $in: schoolIds } })
    .select('_id name code status')
    .lean();

  const schoolMap = new Map(schools.map((s) => [String(s._id), s]));

  return subscriptions.map((sub) => {
    const school = schoolMap.get(String(sub.schoolId)) || {};
    const effectivePlan = getEffectivePlan(sub);
    const metrics = sub.usageMetrics || {};

    return {
      schoolId: sub.schoolId,
      schoolName: school.name || null,
      schoolCode: school.code || null,
      schoolStatus: school.status || null,
      planKey: sub.planKey,
      effectivePlanKey: effectivePlan.key,
      subscriptionStatus: sub.status,
      usage: {
        students: buildUsageEntry(
          normalizeMetricValue(metrics.students),
          effectivePlan.limits.students
        ),
        staff: buildUsageEntry(normalizeMetricValue(metrics.staff), effectivePlan.limits.staff),
        storageMb: buildUsageEntry(
          normalizeMetricValue(metrics.storageMb),
          effectivePlan.limits.storageMb
        ),
        smsCredits: buildUsageEntry(
          normalizeMetricValue(metrics.smsCredits),
          effectivePlan.limits.smsCredits
        ),
        apiCalls: buildUsageEntry(
          normalizeMetricValue(metrics.apiCalls),
          effectivePlan.limits.apiCallsPerMonth
        ),
      },
    };
  });
}

async function getNextInvoiceNumber() {
  const counter = await Counter.findByIdAndUpdate(
    'billingInvoice',
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  const year = new Date().getFullYear();
  return `INV-${year}-${String(counter.seq).padStart(5, '0')}`;
}

async function createDraftInvoice({
  schoolId,
  subscriptionId,
  plan,
  billingCycle,
  couponCode = null,
  discountAmount = 0,
}) {
  const now = new Date();
  const startsAt = now;
  const endsAt = addBillingPeriod(now, billingCycle);
  const subtotal = getPriceForCycle(plan, billingCycle);
  const amount = Math.max(0, subtotal - discountAmount);

  return SchoolInvoice.create({
    schoolId,
    subscriptionId,
    invoiceNumber: await getNextInvoiceNumber(),
    planKey: plan.key,
    billingCycle,
    subtotal,
    amount,
    couponCode: couponCode || null,
    discountAmount: discountAmount || 0,
    currency: DEFAULT_CURRENCY,
    status: 'draft',
    description: `${plan.name} plan (${billingCycle})${couponCode ? ` — coupon ${couponCode}` : ''}`,
    provider: DEFAULT_BILLING_PROVIDER === 'razorpay' ? 'razorpay' : 'manual',
    dueAt: now,
    periodStartsAt: startsAt,
    periodEndsAt: endsAt,
  });
}

async function activatePlan({
  subscription,
  invoice = null,
  planKey,
  billingCycle,
  provider = 'manual',
  checkoutStatus = 'active',
  checkoutUrl = null,
}) {
  const now = new Date();

  subscription.planKey = planKey;
  subscription.trialPlanKey = null;
  subscription.status = 'active';
  subscription.billingCycle = billingCycle;
  subscription.provider = provider;
  subscription.currentPeriodStartsAt = now;
  subscription.currentPeriodEndsAt = addBillingPeriod(now, billingCycle);
  subscription.nextBillingAt = subscription.autoRenew ? subscription.currentPeriodEndsAt : null;
  subscription.lastCheckoutAt = now;
  subscription.lastCheckoutStatus = checkoutStatus;
  subscription.lastCheckoutUrl = checkoutUrl;

  if (invoice) {
    invoice.status = 'paid';
    invoice.provider = provider;
    invoice.hostedUrl = checkoutUrl;
    invoice.paidAt = now;
    await invoice.save();
  }

  await subscription.save();
  return subscription;
}

async function createGatewayPaymentLink({ invoice, school, subscription, plan, billingCycle }) {
  const gateway = getBillingGateway();
  if (!gateway.isConfigured || gateway.name === 'manual') return null;

  const result = await gateway.createSubscriptionPaymentLink({
    amount: invoice.amount,
    currency: invoice.currency,
    description: invoice.description,
    customer: {
      name: subscription.billingContactName || school.name,
      email: subscription.billingEmail || school.contactEmail || undefined,
      phone: subscription.billingPhone || school.contactPhone || undefined,
    },
    referenceId: invoice.invoiceNumber,
    notes: {
      schoolId: school._id.toString(),
      subscriptionId: subscription._id.toString(),
      planKey: plan.key,
      billingCycle,
    },
  });

  if (!result) return null;

  invoice.status = 'issued';
  invoice.provider = result.provider;
  invoice.providerInvoiceId = result.paymentLinkId;
  invoice.providerPaymentLinkId = result.paymentLinkId;
  invoice.hostedUrl = result.hostedUrl;
  await invoice.save();

  subscription.provider = result.provider;
  subscription.providerPaymentLinkId = result.paymentLinkId;
  subscription.lastCheckoutAt = new Date();
  subscription.lastCheckoutStatus = 'payment_link_created';
  subscription.lastCheckoutUrl = result.hostedUrl;
  await subscription.save();

  return result.hostedUrl;
}

export async function createPlanCheckout({
  schoolId,
  planKey,
  billingCycle = 'monthly',
  couponCode = null,
}) {
  const school = await School.findById(schoolId);
  if (!school) {
    const error = new Error('School not found');
    error.status = 404;
    throw error;
  }

  const subscription = await ensureSchoolSubscription(schoolId, {
    billingContactName: school.name,
    billingEmail: school.contactEmail,
    billingPhone: school.contactPhone,
  });
  if (!hasPlan(planKey)) {
    const error = new Error('Invalid plan');
    error.status = 400;
    throw error;
  }

  const plan = getPlan(planKey);

  if (subscription.planKey === plan.key && subscription.status === 'active') {
    const error = new Error('School is already on this plan');
    error.status = 409;
    throw error;
  }

  if (getPriceForCycle(plan, billingCycle) === 0) {
    await activatePlan({
      subscription,
      planKey: plan.key,
      billingCycle,
      provider: 'manual',
      checkoutStatus: 'free_plan_activated',
      checkoutUrl: null,
    });

    return {
      mode: 'free',
      checkoutUrl: null,
      message: `${plan.name} plan activated.`,
    };
  }

  // Validate and calculate coupon discount
  let discountAmount = 0;
  let couponResult = null;
  if (couponCode) {
    couponResult = await validateCoupon({
      code: couponCode,
      planKey,
      billingCycle,
      schoolId,
    });
    discountAmount = couponResult.discountAmount;
  }

  const invoice = await createDraftInvoice({
    schoolId,
    subscriptionId: subscription._id,
    plan,
    billingCycle,
    couponCode: couponCode || null,
    discountAmount,
  });

  // Redeem the coupon (increment usage, create redemption record)
  if (couponCode && discountAmount > 0) {
    await redeemCoupon({
      code: couponCode,
      planKey,
      billingCycle,
      schoolId,
      invoiceId: invoice._id,
    });
  }

  // If coupon covers full amount, activate immediately like a free plan
  if (invoice.amount === 0) {
    await activatePlan({
      subscription,
      invoice,
      planKey: plan.key,
      billingCycle,
      provider: 'manual',
      checkoutStatus: 'coupon_fully_covered',
      checkoutUrl: null,
    });

    return {
      mode: 'free',
      checkoutUrl: null,
      message: `${plan.name} plan activated with 100% discount.`,
      invoiceNumber: invoice.invoiceNumber,
      discount: couponResult ? { code: couponCode, discountAmount, finalAmount: 0 } : null,
    };
  }

  const gateway = getBillingGateway();

  if (process.env.NODE_ENV !== 'production' && gateway.name === 'manual') {
    await activatePlan({
      subscription,
      invoice,
      planKey: plan.key,
      billingCycle,
      provider: 'manual',
      checkoutStatus: 'sandbox_paid',
      checkoutUrl: null,
    });

    return {
      mode: 'sandbox',
      checkoutUrl: null,
      message: `${plan.name} plan activated in development mode.`,
      invoiceNumber: invoice.invoiceNumber,
      discount: couponResult
        ? { code: couponCode, discountAmount, finalAmount: invoice.amount }
        : null,
    };
  }

  const checkoutUrl = await createGatewayPaymentLink({
    invoice,
    school,
    subscription,
    plan,
    billingCycle,
  });

  if (checkoutUrl) {
    return {
      mode: gateway.name,
      checkoutUrl,
      message: 'Payment link created successfully.',
      invoiceNumber: invoice.invoiceNumber,
    };
  }

  subscription.lastCheckoutAt = new Date();
  subscription.lastCheckoutStatus = 'pending_provider_setup';
  subscription.lastCheckoutUrl = null;
  await subscription.save();

  return {
    mode: 'manual',
    checkoutUrl: null,
    message:
      'Billing request recorded. Configure payment gateway credentials to generate a live payment link.',
    invoiceNumber: invoice.invoiceNumber,
  };
}

export async function updateBillingAccount(schoolId, payload = {}) {
  const subscription = await ensureSchoolSubscription(schoolId);
  const school = await School.findById(schoolId);

  if (!school) {
    const error = new Error('School not found');
    error.status = 404;
    throw error;
  }

  if (payload.contactEmail !== undefined) {
    school.contactEmail = payload.contactEmail || null;
  }

  if (payload.contactPhone !== undefined) {
    school.contactPhone = payload.contactPhone || null;
  }

  if (payload.billingContactName !== undefined) {
    subscription.billingContactName = payload.billingContactName || null;
  }

  if (payload.billingEmail !== undefined) {
    subscription.billingEmail = payload.billingEmail || null;
  }

  if (payload.billingPhone !== undefined) {
    subscription.billingPhone = payload.billingPhone || null;
  }

  if (payload.taxId !== undefined) {
    subscription.taxId = payload.taxId || null;
  }

  if (payload.notes !== undefined) {
    subscription.notes = payload.notes || null;
  }

  if (payload.billingAddress) {
    subscription.billingAddress = {
      line1: payload.billingAddress.line1 || null,
      line2: payload.billingAddress.line2 || null,
      city: payload.billingAddress.city || null,
      state: payload.billingAddress.state || null,
      postalCode: payload.billingAddress.postalCode || null,
      country: payload.billingAddress.country || 'India',
    };
  }

  await Promise.all([school.save(), subscription.save()]);
  return getBillingSummary(schoolId);
}

export async function updateAutoRenew(schoolId, autoRenew) {
  const subscription = await ensureSchoolSubscription(schoolId);
  subscription.autoRenew = Boolean(autoRenew);
  subscription.nextBillingAt = subscription.autoRenew ? subscription.currentPeriodEndsAt : null;
  await subscription.save();
  return subscription;
}

export async function cancelSubscription(schoolId, { immediate = false, reason = null } = {}) {
  const subscription = await ensureSchoolSubscription(schoolId);

  const cancellableStatuses = ['trialing', 'active', 'past_due'];
  if (!cancellableStatuses.includes(subscription.status)) {
    const error = new Error(
      `Subscription is already ${subscription.status} and cannot be cancelled`
    );
    error.status = 409;
    throw error;
  }

  const now = new Date();

  if (
    immediate ||
    subscription.status === 'trialing' ||
    subscription.status === 'past_due' ||
    !subscription.currentPeriodEndsAt
  ) {
    subscription.status = 'cancelled';
    subscription.cancelledAt = now;
    subscription.planKey = 'starter';
    subscription.trialPlanKey = null;
    subscription.scheduledDowngradePlanKey = null;
    subscription.scheduledDowngradeAt = null;
    subscription.cancelAtPeriodEnd = false;
    subscription.nextBillingAt = null;
    if (reason) subscription.cancellationReason = reason;
  } else {
    // Cancel at period end
    subscription.cancelAtPeriodEnd = true;
    subscription.autoRenew = false;
    subscription.nextBillingAt = null;
    if (reason) subscription.cancellationReason = reason;
  }

  await subscription.save();
  return subscription;
}

export async function scheduleDowngrade(schoolId, { planKey }) {
  if (!hasPlan(planKey)) {
    const error = new Error('Invalid plan');
    error.status = 400;
    throw error;
  }

  const subscription = await ensureSchoolSubscription(schoolId);

  if (subscription.status !== 'active') {
    const error = new Error('Downgrade can only be scheduled for active subscriptions');
    error.status = 409;
    throw error;
  }

  const currentPlan = getPlan(subscription.planKey);
  const targetPlan = getPlan(planKey);

  const currentPrice = getPriceForCycle(currentPlan, subscription.billingCycle);
  const targetPrice = getPriceForCycle(targetPlan, subscription.billingCycle);

  if (targetPrice >= currentPrice) {
    const error = new Error(
      'Scheduled plan change must be to a lower-priced plan. Use checkout for upgrades'
    );
    error.status = 400;
    throw error;
  }

  subscription.scheduledDowngradePlanKey = planKey;
  subscription.scheduledDowngradeAt = subscription.currentPeriodEndsAt || new Date();
  await subscription.save();
  return subscription;
}

export async function getBillingSummary(schoolId) {
  const school = await School.findById(schoolId);
  if (!school) {
    const error = new Error('School not found');
    error.status = 404;
    throw error;
  }

  const subscription = await syncUsageMetrics(schoolId);
  const effectivePlan = getEffectivePlan(subscription);
  const invoices = await SchoolInvoice.find({ schoolId }).sort({ createdAt: -1 }).limit(12).lean();

  const usage = {
    students: buildUsageEntry(
      normalizeMetricValue(subscription.usageMetrics.students),
      effectivePlan.limits.students
    ),
    staff: buildUsageEntry(
      normalizeMetricValue(subscription.usageMetrics.staff),
      effectivePlan.limits.staff
    ),
    storageMb: buildUsageEntry(
      normalizeMetricValue(subscription.usageMetrics.storageMb),
      effectivePlan.limits.storageMb
    ),
    smsCredits: buildUsageEntry(
      normalizeMetricValue(subscription.usageMetrics.smsCredits),
      effectivePlan.limits.smsCredits
    ),
    apiCalls: buildUsageEntry(
      normalizeMetricValue(subscription.usageMetrics.apiCalls),
      effectivePlan.limits.apiCallsPerMonth
    ),
  };

  return {
    school: {
      id: school._id.toString(),
      name: school.name,
      code: school.code,
      contactEmail: school.contactEmail || null,
      contactPhone: school.contactPhone || null,
    },
    subscription: {
      id: subscription._id.toString(),
      planKey: subscription.planKey,
      planName: getPlan(subscription.planKey).name,
      effectivePlanKey: effectivePlan.key,
      effectivePlanName: effectivePlan.name,
      status: subscription.status,
      billingCycle: subscription.billingCycle,
      autoRenew: Boolean(subscription.autoRenew),
      provider: subscription.provider,
      trialStartsAt: subscription.trialStartsAt,
      trialEndsAt: subscription.trialEndsAt,
      currentPeriodStartsAt: subscription.currentPeriodStartsAt,
      currentPeriodEndsAt: subscription.currentPeriodEndsAt,
      nextBillingAt: subscription.nextBillingAt,
      billingContactName: subscription.billingContactName || null,
      billingEmail: subscription.billingEmail || null,
      billingPhone: subscription.billingPhone || null,
      billingAddress: subscription.billingAddress || {},
      taxId: subscription.taxId || null,
      notes: subscription.notes || null,
      lastCheckoutStatus: subscription.lastCheckoutStatus || null,
      lastCheckoutUrl: subscription.lastCheckoutUrl || null,
      gracePeriodEndsAt: subscription.gracePeriodEndsAt || null,
      cancelAtPeriodEnd: Boolean(subscription.cancelAtPeriodEnd),
      cancelledAt: subscription.cancelledAt || null,
      cancellationReason: subscription.cancellationReason || null,
      scheduledDowngradePlanKey: subscription.scheduledDowngradePlanKey || null,
      scheduledDowngradeAt: subscription.scheduledDowngradeAt || null,
      capabilities: effectivePlan.capabilities,
      limits: effectivePlan.limits,
    },
    usage,
    warnings: buildWarnings(subscription, usage),
    plans: Object.values(BILLING_PLANS).map((plan) =>
      serializePlan(plan, subscription.billingCycle)
    ),
    invoices: invoices.map((invoice) => ({
      id: invoice._id.toString(),
      invoiceNumber: invoice.invoiceNumber,
      planKey: invoice.planKey,
      billingCycle: invoice.billingCycle,
      amount: invoice.amount,
      currency: invoice.currency,
      status: invoice.status,
      description: invoice.description,
      createdAt: invoice.createdAt,
      dueAt: invoice.dueAt,
      paidAt: invoice.paidAt,
      hostedUrl: invoice.hostedUrl || null,
    })),
  };
}

function serializeInvoice(invoice) {
  return {
    id: invoice._id.toString(),
    invoiceNumber: invoice.invoiceNumber,
    planKey: invoice.planKey,
    billingCycle: invoice.billingCycle,
    amount: invoice.amount,
    currency: invoice.currency,
    status: invoice.status,
    description: invoice.description,
    provider: invoice.provider,
    hostedUrl: invoice.hostedUrl || null,
    dueAt: invoice.dueAt || null,
    paidAt: invoice.paidAt || null,
    periodStartsAt: invoice.periodStartsAt || null,
    periodEndsAt: invoice.periodEndsAt || null,
    createdAt: invoice.createdAt,
  };
}

export async function getInvoiceList(schoolId, { page = 1, limit = 20, status } = {}) {
  const query = { schoolId };
  if (status) query.status = status;

  const skip = (page - 1) * limit;
  const [invoices, total] = await Promise.all([
    SchoolInvoice.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    SchoolInvoice.countDocuments(query),
  ]);

  return {
    invoices: invoices.map(serializeInvoice),
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  };
}

export async function markInvoicePaid(invoiceNumber, schoolId, { notes } = {}) {
  const invoice = await SchoolInvoice.findOne({ invoiceNumber, schoolId });
  if (!invoice) {
    const error = new Error('Invoice not found');
    error.status = 404;
    throw error;
  }

  if (invoice.status === 'paid') {
    const error = new Error('Invoice is already paid');
    error.status = 409;
    throw error;
  }

  if (invoice.status === 'void') {
    const error = new Error('Invoice has been voided');
    error.status = 409;
    throw error;
  }

  invoice.status = 'paid';
  invoice.paidAt = new Date();
  if (notes) {
    invoice.metadata = { ...(invoice.metadata || {}), notes };
  }
  await invoice.save();

  const subscription = await SchoolSubscription.findById(invoice.subscriptionId);
  if (subscription && subscription.status !== 'active') {
    await activatePlan({
      subscription,
      invoice: null,
      planKey: invoice.planKey,
      billingCycle: invoice.billingCycle,
      provider: invoice.provider || 'manual',
      checkoutStatus: 'manual_payment_marked',
    });
  }

  return serializeInvoice(invoice.toObject());
}

export async function handleRazorpayBillingWebhook(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    const error = new Error('Webhook secret not configured');
    error.status = 500;
    throw error;
  }

  const expectedSignature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  if (expectedSignature !== signature) {
    const error = new Error('Invalid webhook signature');
    error.status = 400;
    throw error;
  }

  const event = JSON.parse(rawBody.toString());
  const entity = event.payload?.payment_link?.entity || event.payload?.payment?.entity;

  if (!entity) {
    return { received: true };
  }

  const referenceId = entity.reference_id;
  if (!referenceId) {
    return { received: true };
  }

  const invoice = await SchoolInvoice.findOne({ invoiceNumber: referenceId });
  if (!invoice) {
    return { received: true };
  }

  if (event.event === 'payment_link.paid' || event.event === 'payment.captured') {
    if (invoice.status !== 'paid') {
      invoice.status = 'paid';
      invoice.paidAt = new Date();
      invoice.metadata = {
        ...(invoice.metadata || {}),
        razorpayPaymentId: entity.id,
        razorpayEvent: event.event,
      };
      await invoice.save();

      const subscription = await SchoolSubscription.findById(invoice.subscriptionId);
      if (subscription) {
        await activatePlan({
          subscription,
          invoice: null,
          planKey: invoice.planKey,
          billingCycle: invoice.billingCycle,
          provider: 'razorpay',
          checkoutStatus: 'webhook_paid',
        });

        const school = await School.findById(invoice.schoolId).lean();
        await sendInvoicePaidEmail(invoice, subscription, school).catch((err) =>
          logger.warn({ err, invoiceId: invoice._id }, 'Invoice paid email failed')
        );
      }
    }
  } else if (event.event === 'payment_link.expired' || event.event === 'payment.failed') {
    if (invoice.status !== 'paid' && invoice.status !== 'void') {
      invoice.status = 'failed';
      invoice.metadata = {
        ...(invoice.metadata || {}),
        razorpayEvent: event.event,
      };
      await invoice.save();

      const subscription = await SchoolSubscription.findById(invoice.subscriptionId);
      const school = await School.findById(invoice.schoolId).lean();
      if (subscription && school) {
        await sendDunningEmail(invoice, subscription, school).catch((err) =>
          logger.warn({ err, invoiceId: invoice._id }, 'Dunning email failed')
        );
      }
    }
  }

  return { received: true };
}

export async function generateInvoicePdf(invoiceNumber, schoolId) {
  const invoice = await SchoolInvoice.findOne({ invoiceNumber, schoolId }).lean();
  if (!invoice) {
    const error = new Error('Invoice not found');
    error.status = 404;
    throw error;
  }

  const school = await School.findById(schoolId).lean();
  const subscription = await SchoolSubscription.findById(invoice.subscriptionId).lean();

  // 18% GST for software services (IGST)
  const GST_RATE = 0.18;
  const taxableAmount = Math.round((invoice.amount / (1 + GST_RATE)) * 100) / 100;
  const gstAmount = Math.round((invoice.amount - taxableAmount) * 100) / 100;

  const companyName = process.env.COMPANY_NAME || 'EduManage Technologies Pvt. Ltd.';
  const companyGst = process.env.COMPANY_GST || '';
  const companyAddress = process.env.COMPANY_ADDRESS || '';

  const doc = new PDFDocument({ size: 'A4', margin: 50 });

  // Title
  doc.fontSize(20).font('Helvetica-Bold').text('TAX INVOICE', { align: 'center' });
  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').stroke();
  doc.moveDown(0.5);

  // Seller info (left) and invoice details (right)
  const startY = doc.y;
  doc.fontSize(13).font('Helvetica-Bold').text(companyName, 50, startY);
  doc.fontSize(9).font('Helvetica').fillColor('#555555');
  if (companyAddress) doc.text(companyAddress, 50);
  if (companyGst) doc.text(`GSTIN: ${companyGst}`, 50);
  doc.fillColor('#000000');

  doc.fontSize(9).font('Helvetica').text(`Invoice No: ${invoice.invoiceNumber}`, 350, startY);
  doc.text(`Date: ${new Date(invoice.createdAt).toLocaleDateString('en-IN')}`, 350);
  if (invoice.dueAt) doc.text(`Due: ${new Date(invoice.dueAt).toLocaleDateString('en-IN')}`, 350);
  if (invoice.paidAt)
    doc.text(`Paid: ${new Date(invoice.paidAt).toLocaleDateString('en-IN')}`, 350);

  doc.moveDown(2);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').stroke();
  doc.moveDown(0.5);

  // Bill To
  doc.fontSize(10).font('Helvetica-Bold').text('Bill To:');
  doc.fontSize(9).font('Helvetica');
  doc.text(subscription?.billingContactName || school?.name || '');
  if (school?.name) doc.text(`${school.name}${school.code ? ` (${school.code})` : ''}`);
  if (subscription?.billingEmail) doc.text(subscription.billingEmail);
  if (subscription?.billingPhone) doc.text(subscription.billingPhone);
  if (subscription?.taxId) doc.text(`GSTIN: ${subscription.taxId}`);
  if (subscription?.billingAddress?.line1) {
    const a = subscription.billingAddress;
    doc.text(
      [a.line1, a.line2, a.city, a.state, a.postalCode, a.country].filter(Boolean).join(', ')
    );
  }

  doc.moveDown();
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').stroke();
  doc.moveDown(0.5);

  // Table header
  const col1 = 50,
    col2 = 300,
    col3 = 420;
  doc.fontSize(9).font('Helvetica-Bold');
  doc.text('Description', col1, doc.y);
  doc.text('Period', col2, doc.y - doc.currentLineHeight());
  doc.text('Amount (INR)', col3, doc.y - doc.currentLineHeight(), { width: 120, align: 'right' });
  doc.moveDown(0.3);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').stroke();
  doc.moveDown(0.3);

  // Item row
  const rowY = doc.y;
  doc.fontSize(9).font('Helvetica');
  doc.text(invoice.description || `${getPlan(invoice.planKey).name} Plan`, col1, rowY, {
    width: 240,
  });
  const periodText =
    invoice.periodStartsAt && invoice.periodEndsAt
      ? `${new Date(invoice.periodStartsAt).toLocaleDateString('en-IN')} –\n${new Date(invoice.periodEndsAt).toLocaleDateString('en-IN')}`
      : invoice.billingCycle === 'annual'
        ? 'Annual'
        : 'Monthly';
  doc.text(periodText, col2, rowY, { width: 110 });
  doc.text(taxableAmount.toFixed(2), col3, rowY, { width: 120, align: 'right' });

  doc.moveDown(2);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').stroke();
  doc.moveDown(0.5);

  // Totals
  const totY = doc.y;
  doc.fontSize(9).font('Helvetica').text('Subtotal (excl. GST)', col2, totY, { width: 110 });
  doc.text(`INR ${taxableAmount.toFixed(2)}`, col3, totY, { width: 120, align: 'right' });
  doc.moveDown(0.3);

  doc.text('IGST @ 18%', col2, doc.y, { width: 110 });
  doc.text(`INR ${gstAmount.toFixed(2)}`, col3, doc.y - doc.currentLineHeight(), {
    width: 120,
    align: 'right',
  });
  doc.moveDown(0.3);

  doc.moveTo(col2, doc.y).lineTo(545, doc.y).strokeColor('#999999').stroke();
  doc.moveDown(0.3);

  doc.fontSize(10).font('Helvetica-Bold').text('Total', col2, doc.y, { width: 110 });
  doc.text(`INR ${invoice.amount.toFixed(2)}`, col3, doc.y - doc.currentLineHeight(), {
    width: 120,
    align: 'right',
  });

  doc.moveDown(2);
  const statusColor =
    invoice.status === 'paid' ? '#16a34a' : invoice.status === 'failed' ? '#dc2626' : '#2563eb';
  doc
    .fontSize(14)
    .font('Helvetica-Bold')
    .fillColor(statusColor)
    .text(invoice.status.toUpperCase(), { align: 'center' });
  doc.fillColor('#000000');

  doc.moveDown(2);
  doc
    .fontSize(7)
    .font('Helvetica')
    .fillColor('#999999')
    .text('This is a computer-generated invoice and does not require a signature.', {
      align: 'center',
    })
    .text(`Generated: ${new Date().toLocaleString('en-IN')}`, { align: 'center' });

  doc.end();
  return doc;
}

async function sendInvoicePaidEmail(invoice, subscription, school) {
  const to = subscription?.billingEmail || school?.contactEmail;
  if (!to) return;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <h2 style="color:#16a34a">Payment Received — Invoice ${invoice.invoiceNumber}</h2>
      <p>Dear ${subscription?.billingContactName || school?.name || 'Subscriber'},</p>
      <p>We have received your payment for invoice <strong>${invoice.invoiceNumber}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:6px 0;color:#555">Plan:</td><td>${getPlan(invoice.planKey).name} (${invoice.billingCycle})</td></tr>
        <tr><td style="padding:6px 0;color:#555">Amount:</td><td>${invoice.currency} ${invoice.amount.toFixed(2)}</td></tr>
        <tr><td style="padding:6px 0;color:#555">Paid on:</td><td>${new Date(invoice.paidAt).toLocaleDateString('en-IN')}</td></tr>
      </table>
      <p>Your subscription is now active. Log in to the dashboard to get started.</p>
      <p style="font-size:12px;color:#888;margin-top:24px">This is an automated email. Please do not reply.</p>
    </div>`;

  await sendEmail({ to, subject: `Payment Confirmed — ${invoice.invoiceNumber}`, html });
}

export async function sendDunningEmail(invoice, subscription, school) {
  const to = subscription?.billingEmail || school?.contactEmail;
  if (!to) return;

  const isOverdue = subscription?.status === 'past_due';
  const subject = isOverdue
    ? `Action Required: Payment Overdue — ${invoice.invoiceNumber}`
    : `Payment Failed — ${invoice.invoiceNumber}`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <h2 style="color:#dc2626">${subject}</h2>
      <p>Dear ${subscription?.billingContactName || school?.name || 'Subscriber'},</p>
      <p>We were unable to process your payment for invoice <strong>${invoice.invoiceNumber}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:6px 0;color:#555">Plan:</td><td>${getPlan(invoice.planKey).name} (${invoice.billingCycle})</td></tr>
        <tr><td style="padding:6px 0;color:#555">Amount Due:</td><td>${invoice.currency} ${invoice.amount.toFixed(2)}</td></tr>
        ${invoice.dueAt ? `<tr><td style="padding:6px 0;color:#555">Due Date:</td><td>${new Date(invoice.dueAt).toLocaleDateString('en-IN')}</td></tr>` : ''}
        ${isOverdue && subscription.gracePeriodEndsAt ? `<tr><td style="padding:6px 0;color:#dc2626">Access Expires:</td><td>${new Date(subscription.gracePeriodEndsAt).toLocaleDateString('en-IN')}</td></tr>` : ''}
      </table>
      ${invoice.hostedUrl ? `<p><a href="${invoice.hostedUrl}" style="background:#2563eb;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;display:inline-block">Pay Now</a></p>` : ''}
      <p>Please update your payment details or contact support to avoid service interruption.</p>
      <p style="font-size:12px;color:#888;margin-top:24px">This is an automated email. Please do not reply.</p>
    </div>`;

  await sendEmail({ to, subject, html });
}
