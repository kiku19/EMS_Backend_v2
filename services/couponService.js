import { Coupon, CouponRedemption } from '../models/Coupon.js';
import { BILLING_PLANS } from './billingService.js';

function getPriceForCycle(plan, billingCycle = 'monthly') {
  return billingCycle === 'annual' ? plan.annualPrice : plan.monthlyPrice;
}

function throwError(message, status) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

export async function createCoupon(data) {
  const existing = await Coupon.findOne({ code: data.code });
  if (existing) {
    throwError('A coupon with this code already exists', 409);
  }
  return Coupon.create(data);
}

export async function updateCoupon(couponId, data) {
  const coupon = await Coupon.findById(couponId);
  if (!coupon) {
    throwError('Coupon not found', 404);
  }
  Object.assign(coupon, data);
  await coupon.save();
  return coupon;
}

export async function deleteCoupon(couponId) {
  const coupon = await Coupon.findById(couponId);
  if (!coupon) {
    throwError('Coupon not found', 404);
  }
  await coupon.deleteOne();
  return { deleted: true };
}

export async function listCoupons({ page = 1, limit = 20, isActive } = {}) {
  const query = {};
  if (isActive !== undefined) query.isActive = isActive;

  const skip = (page - 1) * limit;
  const [coupons, total] = await Promise.all([
    Coupon.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Coupon.countDocuments(query),
  ]);

  return {
    coupons: coupons.map(serializeCoupon),
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  };
}

export async function validateCoupon({ code, planKey, billingCycle, schoolId }) {
  const coupon = await Coupon.findOne({ code: code.toUpperCase() });
  if (!coupon) {
    throwError('Invalid coupon code', 404);
  }

  assertCouponValid(coupon, planKey, billingCycle);

  if (schoolId) {
    await assertSchoolCanRedeem(coupon, schoolId);
  }

  const plan = BILLING_PLANS[planKey];
  if (!plan) {
    throwError('Invalid plan', 400);
  }

  const originalAmount = getPriceForCycle(plan, billingCycle);
  const { discountAmount, finalAmount } = calculateDiscount(coupon, originalAmount);

  return {
    valid: true,
    code: coupon.code,
    description: coupon.description,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    discountAmount,
    originalAmount,
    finalAmount,
  };
}

export async function redeemCoupon({ code, planKey, billingCycle, schoolId, invoiceId }) {
  const coupon = await Coupon.findOne({ code: code.toUpperCase() });
  if (!coupon) {
    throwError('Invalid coupon code', 404);
  }

  assertCouponValid(coupon, planKey, billingCycle);
  await assertSchoolCanRedeem(coupon, schoolId);

  const plan = BILLING_PLANS[planKey];
  const originalAmount = getPriceForCycle(plan, billingCycle);
  const { discountAmount, finalAmount } = calculateDiscount(coupon, originalAmount);

  coupon.usedCount += 1;
  await coupon.save();

  const redemption = await CouponRedemption.create({
    couponId: coupon._id,
    schoolId,
    invoiceId,
    couponCode: coupon.code,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    discountAmount,
    originalAmount,
    finalAmount,
    planKey,
    billingCycle,
  });

  return { redemption, discountAmount, finalAmount };
}

function assertCouponValid(coupon, planKey, billingCycle) {
  if (!coupon.isActive) {
    throwError('This coupon is no longer active', 400);
  }

  const now = new Date();
  if (coupon.startsAt && coupon.startsAt > now) {
    throwError('This coupon is not yet active', 400);
  }
  if (coupon.expiresAt && coupon.expiresAt <= now) {
    throwError('This coupon has expired', 400);
  }

  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
    throwError('This coupon has reached its maximum number of uses', 400);
  }

  if (coupon.applicablePlans.length > 0 && !coupon.applicablePlans.includes(planKey)) {
    throwError(`This coupon is not applicable to the ${planKey} plan`, 400);
  }

  if (coupon.applicableCycles.length > 0 && !coupon.applicableCycles.includes(billingCycle)) {
    throwError(`This coupon is not applicable to ${billingCycle} billing`, 400);
  }
}

async function assertSchoolCanRedeem(coupon, schoolId) {
  const schoolUses = await CouponRedemption.countDocuments({
    couponId: coupon._id,
    schoolId,
  });

  if (schoolUses >= coupon.maxUsesPerSchool) {
    throwError('This coupon has already been used for your school', 400);
  }
}

export function calculateDiscount(coupon, originalAmount) {
  let discountAmount;
  if (coupon.discountType === 'percentage') {
    discountAmount = Math.round((originalAmount * coupon.discountValue) / 100);
  } else {
    discountAmount = Math.min(coupon.discountValue, originalAmount);
  }
  discountAmount = Math.max(0, discountAmount);
  const finalAmount = Math.max(0, originalAmount - discountAmount);
  return { discountAmount, finalAmount };
}

function serializeCoupon(coupon) {
  return {
    id: coupon._id.toString(),
    code: coupon.code,
    description: coupon.description,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    applicablePlans: coupon.applicablePlans,
    applicableCycles: coupon.applicableCycles,
    maxUses: coupon.maxUses,
    usedCount: coupon.usedCount,
    maxUsesPerSchool: coupon.maxUsesPerSchool,
    startsAt: coupon.startsAt,
    expiresAt: coupon.expiresAt,
    isActive: coupon.isActive,
    createdBy: coupon.createdBy,
    createdAt: coupon.createdAt,
    updatedAt: coupon.updatedAt,
  };
}
