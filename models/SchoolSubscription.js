import mongoose from 'mongoose';

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

export default mongoose.models.SchoolSubscription ||
  mongoose.model('SchoolSubscription', schoolSubscriptionSchema);
