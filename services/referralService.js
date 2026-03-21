import mongoose from 'mongoose';
import Referral from '../models/Referral.js';
import SchoolSubscription from '../models/SchoolSubscription.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ReferralService');

/**
 * Generate a unique referral code from a schoolId.
 * Format: EMS + 4 chars from schoolId + 2 random alphanumeric chars = ~9 chars
 */
function generateReferralCode(schoolId) {
  const idSuffix = schoolId.toString().slice(-4).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 4).toUpperCase();
  return `EMS${idSuffix}${rand}`;
}

/**
 * Get the referral code for a school. Creates one if it doesn't exist yet.
 * Returns the master Referral document (referredSchoolId = null).
 */
export async function getOrCreateReferralCode(schoolId) {
  const existing = await Referral.findOne({
    referrerSchoolId: schoolId,
    referredSchoolId: null,
    status: 'active',
  });

  if (existing) return existing;

  // Generate a unique code (retry up to 5 times on collision)
  let code;
  for (let i = 0; i < 5; i++) {
    const candidate = generateReferralCode(schoolId);
    const collision = await Referral.findOne({ referralCode: candidate });
    if (!collision) {
      code = candidate;
      break;
    }
  }

  if (!code) {
    // Very unlikely fallback: use ObjectId-based code
    code = `EMS${new mongoose.Types.ObjectId().toString().slice(-6).toUpperCase()}`;
  }

  return Referral.create({
    referrerSchoolId: schoolId,
    referralCode: code,
    referredSchoolId: null,
    status: 'active',
  });
}

/**
 * Apply a referral code.
 * Called by the referred school when they want to claim a referral.
 * Creates a new Referral record linking referred → referrer.
 */
export async function applyReferralCode(referredSchoolId, rawCode) {
  const code = rawCode.trim().toUpperCase();

  // Find the master record for this code (the referrer's code)
  const masterRecord = await Referral.findOne({
    referralCode: code,
    referredSchoolId: null,
    status: 'active',
  });

  if (!masterRecord) {
    const err = new Error('Invalid referral code');
    err.status = 400;
    throw err;
  }

  // Prevent self-referral
  if (masterRecord.referrerSchoolId.equals(referredSchoolId)) {
    const err = new Error('You cannot use your own referral code');
    err.status = 400;
    throw err;
  }

  // Check if this school already used any referral code
  const alreadyUsed = await Referral.findOne({
    referredSchoolId,
    status: { $in: ['pending_credit', 'credited'] },
  });

  if (alreadyUsed) {
    const err = new Error('Your school has already used a referral code');
    err.status = 400;
    throw err;
  }

  // Create the usage record
  const referral = await Referral.create({
    referrerSchoolId: masterRecord.referrerSchoolId,
    referralCode: code,
    referredSchoolId,
    status: 'pending_credit',
    appliedAt: new Date(),
  });

  return referral;
}

/**
 * Apply referral credit to the referrer when the referred school activates a paid plan.
 * Extends the referrer's subscription period by creditMonths * 30 days.
 * Safe to call multiple times — idempotent due to status check.
 */
export async function applyReferralCreditIfEligible(referredSchoolId) {
  try {
    const referral = await Referral.findOne({
      referredSchoolId,
      status: 'pending_credit',
    });

    if (!referral) return null;

    const sub = await SchoolSubscription.findOne({ schoolId: referral.referrerSchoolId });
    if (!sub) {
      logger.warn(
        { referrerSchoolId: referral.referrerSchoolId },
        'Referral credit skipped: referrer subscription not found'
      );
      return null;
    }

    const creditMs = referral.creditMonths * 30 * 24 * 60 * 60 * 1000;

    // Extend whichever period is active
    if (sub.status === 'trialing' && sub.trialEndsAt) {
      sub.trialEndsAt = new Date(sub.trialEndsAt.getTime() + creditMs);
    } else if (sub.currentPeriodEndsAt) {
      sub.currentPeriodEndsAt = new Date(sub.currentPeriodEndsAt.getTime() + creditMs);
      if (sub.nextBillingAt) {
        sub.nextBillingAt = new Date(sub.nextBillingAt.getTime() + creditMs);
      }
    } else {
      // No period set yet — store credit in notes for manual application
      sub.notes = [
        sub.notes,
        `Referral credit: ${referral.creditMonths} month(s) pending (referral ${referral._id})`,
      ]
        .filter(Boolean)
        .join('; ');
    }

    await sub.save();

    referral.status = 'credited';
    referral.creditedAt = new Date();
    await referral.save();

    logger.info(
      { referrerSchoolId: referral.referrerSchoolId, referredSchoolId, creditMs },
      'Referral credit applied'
    );

    return referral;
  } catch (err) {
    // Non-blocking: credit failure should not break the checkout flow
    logger.error({ err, referredSchoolId }, 'Failed to apply referral credit');
    return null;
  }
}

/**
 * Get referral stats for a school (as referrer).
 */
export async function getReferralStats(schoolId) {
  const [masterRecord, usages] = await Promise.all([
    Referral.findOne({ referrerSchoolId: schoolId, referredSchoolId: null, status: 'active' }),
    Referral.find(
      { referrerSchoolId: schoolId, referredSchoolId: { $ne: null } },
      'status appliedAt creditedAt creditMonths'
    ).lean(),
  ]);

  const credited = usages.filter((r) => r.status === 'credited');
  const pending = usages.filter((r) => r.status === 'pending_credit');

  return {
    referralCode: masterRecord?.referralCode || null,
    totalReferred: usages.length,
    totalCredited: credited.length,
    pendingCredit: pending.length,
    totalMonthsEarned: credited.reduce((sum, r) => sum + (r.creditMonths || 1), 0),
    referrals: usages.map((r) => ({
      status: r.status,
      appliedAt: r.appliedAt,
      creditedAt: r.creditedAt,
      creditMonths: r.creditMonths,
    })),
  };
}
