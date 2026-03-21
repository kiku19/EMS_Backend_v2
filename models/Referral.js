import mongoose from 'mongoose';

const referralSchema = new mongoose.Schema(
  {
    // The school that owns/shared the referral code
    referrerSchoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },
    // The unique referral code generated for the referrer school
    referralCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    // The school that used the referral code (null = code not yet used / master record)
    referredSchoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      default: null,
      index: true,
    },
    // active = code available for use (master record)
    // pending_credit = referred school signed up, credit not yet applied
    // credited = referrer received the 1-month free credit
    status: {
      type: String,
      enum: ['active', 'pending_credit', 'credited'],
      default: 'active',
      index: true,
    },
    // When the referred school applied the code
    appliedAt: {
      type: Date,
      default: null,
    },
    // When the credit was applied to the referrer
    creditedAt: {
      type: Date,
      default: null,
    },
    // Number of free months to credit to the referrer
    creditMonths: {
      type: Number,
      default: 1,
    },
  },
  {
    timestamps: true,
  }
);

// Find all referrals by a referrer school
referralSchema.index({ referrerSchoolId: 1, status: 1 });

// Find a referral by referred school + status (for credit application)
referralSchema.index({ referredSchoolId: 1, status: 1 });

export default mongoose.models.Referral || mongoose.model('Referral', referralSchema);
