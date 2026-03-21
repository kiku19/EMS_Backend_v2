import mongoose from 'mongoose';

const webPushSubscriptionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'userModel',
      required: true,
    },
    userModel: {
      type: String,
      enum: ['Staff', 'Parent'],
      default: 'Staff',
    },
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },
    endpoint: {
      type: String,
      required: true,
    },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    expirationTime: {
      type: Date,
      default: null,
    },
    userAgent: String,
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// One subscription per endpoint
webPushSubscriptionSchema.index({ endpoint: 1 }, { unique: true });
webPushSubscriptionSchema.index({ user: 1, schoolId: 1 });

export default mongoose.model('WebPushSubscription', webPushSubscriptionSchema);
