import mongoose from 'mongoose';

const couponSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    description: {
      type: String,
      default: null,
      trim: true,
    },
    discountType: {
      type: String,
      enum: ['percentage', 'fixed'],
      required: true,
    },
    discountValue: {
      type: Number,
      required: true,
      min: 0,
    },
    applicablePlans: {
      type: [String],
      default: [],
      // Empty array = applies to all plans
    },
    applicableCycles: {
      type: [String],
      enum: ['monthly', 'annual'],
      default: [],
      // Empty array = applies to all cycles
    },
    maxUses: {
      type: Number,
      default: null,
      // null = unlimited
    },
    usedCount: {
      type: Number,
      default: 0,
    },
    maxUsesPerSchool: {
      type: Number,
      default: 1,
    },
    startsAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: String,
      default: 'system',
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

couponSchema.index({ code: 1 }, { unique: true });
couponSchema.index({ isActive: 1, expiresAt: 1 });

const couponRedemptionSchema = new mongoose.Schema(
  {
    couponId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Coupon',
      required: true,
    },
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
    },
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SchoolInvoice',
      default: null,
    },
    couponCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    discountType: {
      type: String,
      enum: ['percentage', 'fixed'],
      required: true,
    },
    discountValue: {
      type: Number,
      required: true,
    },
    discountAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    originalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    finalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    planKey: {
      type: String,
      required: true,
    },
    billingCycle: {
      type: String,
      enum: ['monthly', 'annual'],
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

couponRedemptionSchema.index({ couponId: 1, schoolId: 1 });
couponRedemptionSchema.index({ schoolId: 1, createdAt: -1 });

export const Coupon = mongoose.models.Coupon || mongoose.model('Coupon', couponSchema);
export const CouponRedemption =
  mongoose.models.CouponRedemption || mongoose.model('CouponRedemption', couponRedemptionSchema);
