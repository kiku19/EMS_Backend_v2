import mongoose from 'mongoose';
import SchoolSubscription from '../models/SchoolSubscription.js';
import SchoolInvoice from '../models/SchoolInvoice.js';
import School from '../models/School.js';
import {
  BILLING_PLANS,
  getEffectivePlan,
  summarizeSubscription,
  markInvoicePaid,
} from './billingService.js';

// Super-admin billing — cross-school views + overrides.
//
// The school-scoped billingService handles self-service (checkout, cancel, etc).
// These functions give the operator platform-wide visibility (MRR/ARR, every
// subscription, every invoice) and override power (change a plan, extend a
// trial, mark an invoice paid, void or refund). Plan mutations land on
// SchoolSubscription (authoritative) and the Phase 1b hook re-syncs the
// School cache automatically.

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function monthlyEquivalent(planKey, billingCycle) {
  const plan = BILLING_PLANS[planKey];
  if (!plan) return 0;
  if (billingCycle === 'annual') {
    return (plan.annualPrice || 0) / 12;
  }
  return plan.monthlyPrice || 0;
}

// ─── Overview: MRR/ARR/counts/collected/outstanding ────────────────────────
export async function getBillingOverview() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    activeSubs,
    byPlan,
    byStatus,
    collectedThisMonth,
    outstanding,
    totalSchools,
    totalInvoices,
  ] = await Promise.all([
    // active subscriptions drive MRR (trials are $0)
    SchoolSubscription.find({ status: 'active' }).select('planKey billingCycle').lean(),
    SchoolSubscription.aggregate([{ $group: { _id: '$planKey', count: { $sum: 1 } } }]),
    SchoolSubscription.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    SchoolInvoice.aggregate([
      { $match: { status: 'paid', paidAt: { $gte: monthStart } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    SchoolInvoice.aggregate([
      { $match: { status: { $in: ['issued', 'failed'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    SchoolSubscription.countDocuments({}),
    SchoolInvoice.countDocuments({}),
  ]);

  const mrr = Math.round(
    activeSubs.reduce((sum, sub) => sum + monthlyEquivalent(sub.planKey, sub.billingCycle), 0)
  );

  return {
    mrr,
    // Derive ARR from the rounded MRR so the two never disagree by a rounding gap.
    arr: mrr * 12,
    currency: 'INR',
    counts: {
      totalSubscriptions: totalSchools,
      totalInvoices,
      byPlan: byPlan.map((b) => ({ plan: b._id, count: b.count })),
      byStatus: byStatus.map((b) => ({ status: b._id, count: b.count })),
    },
    collectedThisMonth: collectedThisMonth[0]?.total || 0,
    outstanding: outstanding[0]?.total || 0,
  };
}

// ─── Subscriptions list (cross-school) ─────────────────────────────────────
export async function listSubscriptions(rawFilters) {
  const limit = Math.min(Math.max(Number(rawFilters.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const page = Math.max(Number(rawFilters.page) || 1, 1);
  const skip = (page - 1) * limit;

  const query = {};
  if (rawFilters.planKey) query.planKey = rawFilters.planKey;
  if (rawFilters.status) query.status = rawFilters.status;
  if (rawFilters.schoolId) {
    try {
      query.schoolId = new mongoose.Types.ObjectId(rawFilters.schoolId);
    } catch {
      /* ignore invalid id */
    }
  }

  const [rows, total] = await Promise.all([
    SchoolSubscription.find(query)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('schoolId', 'name code status plan planStatus')
      .lean(),
    SchoolSubscription.countDocuments(query),
  ]);

  const data = rows.map((sub) => ({
    schoolId: sub.schoolId?._id || sub.schoolId,
    schoolName: sub.schoolId?.name || null,
    schoolCode: sub.schoolId?.code || null,
    schoolStatus: sub.schoolId?.status || null,
    planKey: sub.planKey,
    status: sub.status,
    billingCycle: sub.billingCycle,
    provider: sub.provider,
    trialEndsAt: sub.trialEndsAt,
    currentPeriodEndsAt: sub.currentPeriodEndsAt,
    nextBillingAt: sub.nextBillingAt,
    autoRenew: sub.autoRenew,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    cancelledAt: sub.cancelledAt,
    monthlyEquivalent: monthlyEquivalent(sub.planKey, sub.billingCycle),
    summary: summarizeSubscription(sub),
    updatedAt: sub.updatedAt,
  }));

  return { data, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
}

// ─── Invoices list (cross-school) ──────────────────────────────────────────
export async function listInvoices(rawFilters) {
  const limit = Math.min(Math.max(Number(rawFilters.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const page = Math.max(Number(rawFilters.page) || 1, 1);
  const skip = (page - 1) * limit;

  const query = {};
  if (rawFilters.status) query.status = rawFilters.status;
  if (rawFilters.schoolId) {
    try {
      query.schoolId = new mongoose.Types.ObjectId(rawFilters.schoolId);
    } catch {
      /* ignore invalid id */
    }
  }

  const [rows, total] = await Promise.all([
    SchoolInvoice.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('schoolId', 'name code')
      .lean(),
    SchoolInvoice.countDocuments(query),
  ]);

  const data = rows.map((inv) => ({
    _id: inv._id,
    invoiceNumber: inv.invoiceNumber,
    schoolId: inv.schoolId?._id || inv.schoolId,
    schoolName: inv.schoolId?.name || null,
    planKey: inv.planKey,
    billingCycle: inv.billingCycle,
    amount: inv.amount,
    currency: inv.currency,
    status: inv.status,
    provider: inv.provider,
    paidAt: inv.paidAt,
    dueAt: inv.dueAt,
    createdAt: inv.createdAt,
  }));

  return { data, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
}

// ─── Override a subscription (operator override) ───────────────────────────
// Sets requested fields directly on the authoritative SchoolSubscription doc.
// The Phase 1b post-save hook then re-syncs the School.{plan,planStatus}
// cache. Period dates are NOT recomputed — this is an explicit override.
const OVERRIDE_ALLOWED_FIELDS = new Set([
  'planKey',
  'status',
  'billingCycle',
  'trialEndsAt',
  'autoRenew',
  'cancelAtPeriodEnd',
  'gracePeriodEndsAt',
]);

export async function overrideSubscription(schoolId, updates) {
  const subscription = await SchoolSubscription.findOne({ schoolId });
  if (!subscription) {
    const error = new Error('Subscription not found');
    error.status = 404;
    throw error;
  }

  for (const key of OVERRIDE_ALLOWED_FIELDS) {
    if (updates[key] !== undefined) {
      subscription.set(key, updates[key] === '' ? null : updates[key]);
    }
  }

  await subscription.save(); // triggers Phase 1b School cache sync

  const school = await School.findById(schoolId).select('name code').lean();
  return {
    schoolId,
    schoolName: school?.name || null,
    schoolCode: school?.code || null,
    summary: summarizeSubscription(subscription),
    effectivePlan: getEffectivePlan(subscription).key,
  };
}

// ─── Invoice actions (cross-school) ────────────────────────────────────────
export async function markInvoicePaidCrossSchool(invoiceNumber, { notes } = {}) {
  const invoice = await SchoolInvoice.findOne({ invoiceNumber });
  if (!invoice) {
    const error = new Error('Invoice not found');
    error.status = 404;
    throw error;
  }
  // Delegate to the existing (school-scoped) handler now that we know the school.
  return markInvoicePaid(invoiceNumber, invoice.schoolId, { notes });
}

export async function voidInvoice(invoiceNumber) {
  const invoice = await SchoolInvoice.findOne({ invoiceNumber });
  if (!invoice) {
    const error = new Error('Invoice not found');
    error.status = 404;
    throw error;
  }
  if (invoice.status === 'void') return invoice;
  if (invoice.status === 'paid') {
    const error = new Error('Cannot void a paid invoice — refund it instead');
    error.status = 409;
    throw error;
  }
  invoice.status = 'void';
  await invoice.save();
  return invoice;
}

// Refund: records a refund against a paid invoice. Actual money-back at the
// payment gateway (Razorpay) must be performed by the operator; this records
// the refund for accurate financials + audit. Requires the 'refunded' status.
export async function refundInvoice(invoiceNumber, { reason } = {}) {
  const invoice = await SchoolInvoice.findOne({ invoiceNumber });
  if (!invoice) {
    const error = new Error('Invoice not found');
    error.status = 404;
    throw error;
  }
  if (invoice.status !== 'paid') {
    const error = new Error('Only paid invoices can be refunded');
    error.status = 409;
    throw error;
  }
  invoice.status = 'refunded';
  invoice.metadata = {
    ...(invoice.metadata || {}),
    refundedAt: new Date().toISOString(),
    refundReason: reason || null,
  };
  await invoice.save();
  return invoice;
}
