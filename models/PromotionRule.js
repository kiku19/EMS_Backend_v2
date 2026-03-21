import mongoose from 'mongoose';

/**
 * PromotionRule — stores a school's auto-promotion criteria.
 * One document per school; upserted via PUT /promotions/rules.
 *
 * Fields:
 *   minAttendancePercent  — student must meet this % to be auto-suggested "promoted"
 *   feeRequirement        — 'none' (ignore fees) | 'partial' (not fully unpaid) | 'full' (must be paid)
 */
const PromotionRuleSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      unique: true,
    },
    minAttendancePercent: {
      type: Number,
      default: 75,
      min: 0,
      max: 100,
    },
    feeRequirement: {
      type: String,
      enum: ['none', 'partial', 'full'],
      default: 'none',
      // none    = fee status is ignored when computing suggested decision
      // partial = student must have feeStatus !== 'pending' (at least some payment)
      // full    = student must have feeStatus === 'paid'
    },
  },
  { timestamps: true }
);

export default mongoose.model('PromotionRule', PromotionRuleSchema);
