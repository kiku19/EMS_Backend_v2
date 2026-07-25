import mongoose from 'mongoose';
import School from './School.js';

const usageMetricSchema = new mongoose.Schema(
  {
    current: { type: Number, default: 0 },
    trackedAt: { type: Date, default: Date.now },
    periodStart: { type: Date, default: null }, // for monthly-reset metrics (e.g. apiCalls)
  },
  { _id: false }
);

const schoolSubscriptionSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      unique: true,
      index: true,
    },
    planKey: {
      type: String,
      required: true,
      default: 'starter',
      trim: true,
      lowercase: true,
    },
    trialPlanKey: {
      type: String,
      default: null,
      trim: true,
      lowercase: true,
    },
    status: {
      type: String,
      enum: ['trialing', 'active', 'past_due', 'cancelled', 'paused'],
      default: 'trialing',
      index: true,
    },
    billingCycle: {
      type: String,
      enum: ['monthly', 'annual'],
      default: 'monthly',
    },
    provider: {
      type: String,
      enum: ['none', 'manual', 'razorpay'],
      default: 'none',
    },
    providerCustomerId: {
      type: String,
      default: null,
      trim: true,
    },
    providerSubscriptionId: {
      type: String,
      default: null,
      trim: true,
    },
    providerPaymentLinkId: {
      type: String,
      default: null,
      trim: true,
    },
    trialStartsAt: {
      type: Date,
      default: null,
    },
    trialEndsAt: {
      type: Date,
      default: null,
      index: true,
    },
    currentPeriodStartsAt: {
      type: Date,
      default: null,
    },
    currentPeriodEndsAt: {
      type: Date,
      default: null,
    },
    nextBillingAt: {
      type: Date,
      default: null,
    },
    autoRenew: {
      type: Boolean,
      default: true,
    },
    usageMetrics: {
      students: { type: usageMetricSchema, default: () => ({}) },
      staff: { type: usageMetricSchema, default: () => ({}) },
      storageMb: { type: usageMetricSchema, default: () => ({}) },
      smsCredits: { type: usageMetricSchema, default: () => ({}) },
      apiCalls: { type: usageMetricSchema, default: () => ({}) },
    },
    lastCheckoutAt: {
      type: Date,
      default: null,
    },
    lastCheckoutStatus: {
      type: String,
      default: null,
      trim: true,
    },
    lastCheckoutUrl: {
      type: String,
      default: null,
      trim: true,
    },
    billingContactName: {
      type: String,
      default: null,
      trim: true,
    },
    billingEmail: {
      type: String,
      default: null,
      trim: true,
      lowercase: true,
    },
    billingPhone: {
      type: String,
      default: null,
      trim: true,
    },
    billingAddress: {
      line1: { type: String, default: null, trim: true },
      line2: { type: String, default: null, trim: true },
      city: { type: String, default: null, trim: true },
      state: { type: String, default: null, trim: true },
      postalCode: { type: String, default: null, trim: true },
      country: { type: String, default: 'India', trim: true },
    },
    taxId: {
      type: String,
      default: null,
      trim: true,
    },
    notes: {
      type: String,
      default: null,
      trim: true,
    },
    gracePeriodEndsAt: {
      type: Date,
      default: null,
      index: true,
    },
    scheduledDowngradePlanKey: {
      type: String,
      default: null,
      trim: true,
      lowercase: true,
    },
    scheduledDowngradeAt: {
      type: Date,
      default: null,
    },
    cancelAtPeriodEnd: {
      type: Boolean,
      default: false,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    cancellationReason: {
      type: String,
      default: null,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

schoolSubscriptionSchema.index({ schoolId: 1, updatedAt: -1 });

// --- Plan source-of-truth reconciliation (Phase 1b) -------------------------
// SchoolSubscription is the authoritative record for plan/billing state. The
// matching School.{plan, planStatus, trialEndsAt} fields are a denormalized
// cache for fast queries/indexes. This hook keeps them in sync whenever a
// subscription is saved, eliminating the drift that previously occurred when
// the two collections were written independently.
//
// PLAN_KEYS mirrors School.plan's enum. planKey on the subscription is
// intentionally unconstrained (group/enterprise plans may exist), so we only
// cache values that School.plan can legally hold.
const SCHOOL_PLAN_KEYS = new Set(['starter', 'growth', 'scale']);

async function syncSchoolPlanCache(subscription, session) {
  if (!subscription?.schoolId) return null;
  const $set = {};
  if (SCHOOL_PLAN_KEYS.has(subscription.planKey)) {
    $set.plan = subscription.planKey;
  }
  if (subscription.status) {
    $set.planStatus = subscription.status;
  }
  if (subscription.trialEndsAt !== undefined) {
    $set.trialEndsAt = subscription.trialEndsAt;
  }
  if (Object.keys($set).length === 0) return null;
  return School.updateOne({ _id: subscription.schoolId }, { $set }, { session });
}

// save hook: fires on `.save()` and `new Model().save()`, which is how every
// plan/status/trial mutation in billingService is persisted. Within a
// transaction we reuse the session so a rollback unwinds the cache too.
schoolSubscriptionSchema.post('save', async function () {
  const session = this.$session();
  try {
    await syncSchoolPlanCache(this, session);
  } catch (err) {
    if (session) throw err; // transactional consistency — let it roll back
    // Outside a transaction, a cache miss must not break the subscription write.
    // The next lifecycle sync will re-converge.
  }
});

// findOneAndUpdate / findByIdAndUpdate insurance: re-sync from the updated doc
// so future code paths that bypass `.save()` still converge. `res` is the doc.
schoolSubscriptionSchema.post(['findOneAndUpdate', 'findByIdAndUpdate'], async function (res) {
  if (!res) return;
  try {
    await syncSchoolPlanCache(res, null);
  } catch {
    // best-effort — see note above
  }
});

export default mongoose.models.SchoolSubscription ||
  mongoose.model('SchoolSubscription', schoolSubscriptionSchema);
