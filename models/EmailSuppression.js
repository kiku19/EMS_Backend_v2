import mongoose from 'mongoose';

/**
 * Tracks email addresses that should not receive emails.
 * schoolId = null means a global/platform-level suppression (applies to all schools).
 * schoolId = ObjectId means school-specific suppression (unsubscribes, soft bounces).
 */
const emailSuppressionSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    // null = global (hard bounces); ObjectId = school-specific
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      default: null,
    },
    reason: {
      type: String,
      enum: ['hard_bounce', 'soft_bounce', 'complaint', 'unsubscribe', 'manual'],
      required: true,
    },
    // SMTP response code (e.g. '550', '421') or provider error code
    bounceCode: {
      type: String,
      trim: true,
      default: null,
    },
    // Raw error message from the mail server / ESP
    providerMessage: {
      type: String,
      trim: true,
      default: null,
    },
    // Which system reported this bounce
    provider: {
      type: String,
      enum: ['smtp', 'sendgrid', 'ses', 'mailgun', 'postmark', 'manual'],
      default: 'smtp',
    },
    suppressedAt: {
      type: Date,
      default: Date.now,
    },
    // Staff member who manually suppressed this address
    suppressedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      default: null,
    },
    // Number of failed send attempts contributing to this suppression
    attemptCount: {
      type: Number,
      default: 1,
      min: 1,
    },
    lastAttemptAt: {
      type: Date,
      default: Date.now,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Set when an admin releases the suppression
    releasedAt: {
      type: Date,
      default: null,
    },
    releasedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// One suppression record per email per school (null school = global)
emailSuppressionSchema.index({ email: 1, schoolId: 1 }, { unique: true });
emailSuppressionSchema.index({ schoolId: 1, isActive: 1, reason: 1 });
emailSuppressionSchema.index({ isActive: 1, email: 1 });

export default mongoose.model('EmailSuppression', emailSuppressionSchema);
