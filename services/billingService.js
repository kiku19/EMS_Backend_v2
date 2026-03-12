import SchoolInvoice from '../models/SchoolInvoice.js';
import SchoolSubscription from '../models/SchoolSubscription.js';
import { Counter, School, Staff } from '../database.js';

const DEFAULT_TRIAL_DAYS = Number.parseInt(process.env.SCHOOL_TRIAL_DAYS || '14', 10);
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
    },
    capabilities: {
      parentApp: true,
      advancedReports: false,
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
    },
    capabilities: {
      parentApp: true,
      advancedReports: true,
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
    },
    capabilities: {
      parentApp: true,
      advancedReports: true,
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
  const percentage = normalizedLimit && normalizedLimit > 0
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
  const inTrial = subscription.status === 'trialing' && subscription.trialEndsAt && subscription.trialEndsAt > now;

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
    },
  });

  return subscription;
}

export async function ensureSchoolSubscription(schoolId, defaults = {}) {
  let subscription = await SchoolSubscription.findOne({ schoolId });

  if (!subscription) {
    subscription = await provisionSchoolSubscription({
      schoolId,
      billingContactName: defaults.billingContactName || null,
      billingEmail: defaults.billingEmail || null,
      billingPhone: defaults.billingPhone || null,
    });
  }

  return syncSubscriptionLifecycle(subscription);
}

export async function syncSubscriptionLifecycle(subscription) {
  if (!subscription) {
    return null;
  }

  const now = new Date();
  let changed = false;

  if (
    subscription.status === 'trialing' &&
    subscription.trialEndsAt &&
    subscription.trialEndsAt <= now
  ) {
    subscription.status = 'active';
    subscription.trialPlanKey = null;
    changed = true;
  }

  if (
    subscription.status === 'active' &&
    getPriceForCycle(getPlan(subscription.planKey), subscription.billingCycle) > 0 &&
    !subscription.currentPeriodStartsAt
  ) {
    subscription.currentPeriodStartsAt = now;
    subscription.currentPeriodEndsAt = addBillingPeriod(now, subscription.billingCycle);
    subscription.nextBillingAt = subscription.currentPeriodEndsAt;
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

export async function assertSchoolWithinLimit({
  schoolId,
  metric,
  delta = 1,
}) {
  const subscription = metric === 'staff'
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
}) {
  const now = new Date();
  const startsAt = now;
  const endsAt = addBillingPeriod(now, billingCycle);

  return SchoolInvoice.create({
    schoolId,
    subscriptionId,
    invoiceNumber: await getNextInvoiceNumber(),
    planKey: plan.key,
    billingCycle,
    amount: getPriceForCycle(plan, billingCycle),
    currency: DEFAULT_CURRENCY,
    status: 'draft',
    description: `${plan.name} plan (${billingCycle})`,
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

async function createRazorpayPaymentLink({ invoice, school, subscription, plan, billingCycle }) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    return null;
  }

  const Razorpay = (await import('razorpay')).default;
  const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });

  const paymentLink = await razorpay.paymentLink.create({
    amount: Math.round(invoice.amount * 100),
    currency: invoice.currency,
    description: invoice.description,
    customer: {
      name: subscription.billingContactName || school.name,
      email: subscription.billingEmail || school.contactEmail || undefined,
      contact: subscription.billingPhone || school.contactPhone || undefined,
    },
    notify: {
      email: Boolean(subscription.billingEmail || school.contactEmail),
      sms: Boolean(subscription.billingPhone || school.contactPhone),
    },
    reference_id: invoice.invoiceNumber,
    notes: {
      schoolId: school._id.toString(),
      subscriptionId: subscription._id.toString(),
      planKey: plan.key,
      billingCycle,
    },
  });

  invoice.status = 'issued';
  invoice.provider = 'razorpay';
  invoice.providerInvoiceId = paymentLink.id;
  invoice.providerPaymentLinkId = paymentLink.id;
  invoice.hostedUrl = paymentLink.short_url || paymentLink.url || null;
  await invoice.save();

  subscription.provider = 'razorpay';
  subscription.providerPaymentLinkId = paymentLink.id;
  subscription.lastCheckoutAt = new Date();
  subscription.lastCheckoutStatus = 'payment_link_created';
  subscription.lastCheckoutUrl = invoice.hostedUrl;
  await subscription.save();

  return invoice.hostedUrl;
}

export async function createPlanCheckout({
  schoolId,
  planKey,
  billingCycle = 'monthly',
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

  const invoice = await createDraftInvoice({
    schoolId,
    subscriptionId: subscription._id,
    plan,
    billingCycle,
  });

  if (process.env.NODE_ENV !== 'production' && DEFAULT_BILLING_PROVIDER !== 'razorpay') {
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
    };
  }

  const checkoutUrl = await createRazorpayPaymentLink({
    invoice,
    school,
    subscription,
    plan,
    billingCycle,
  });

  if (checkoutUrl) {
    return {
      mode: 'razorpay',
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
    message: 'Billing request recorded. Configure Razorpay credentials to generate a live payment link.',
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

export async function getBillingSummary(schoolId) {
  const school = await School.findById(schoolId);
  if (!school) {
    const error = new Error('School not found');
    error.status = 404;
    throw error;
  }

  const subscription = await syncUsageMetrics(schoolId);
  const effectivePlan = getEffectivePlan(subscription);
  const invoices = await SchoolInvoice.find({ schoolId })
    .sort({ createdAt: -1 })
    .limit(12)
    .lean();

  const usage = {
    students: buildUsageEntry(normalizeMetricValue(subscription.usageMetrics.students), effectivePlan.limits.students),
    staff: buildUsageEntry(normalizeMetricValue(subscription.usageMetrics.staff), effectivePlan.limits.staff),
    storageMb: buildUsageEntry(normalizeMetricValue(subscription.usageMetrics.storageMb), effectivePlan.limits.storageMb),
    smsCredits: buildUsageEntry(normalizeMetricValue(subscription.usageMetrics.smsCredits), effectivePlan.limits.smsCredits),
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
      capabilities: effectivePlan.capabilities,
      limits: effectivePlan.limits,
    },
    usage,
    warnings: buildWarnings(subscription, usage),
    plans: Object.values(BILLING_PLANS).map((plan) => serializePlan(plan, subscription.billingCycle)),
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
