import mongoose from 'mongoose';

const webhookDeliveryLogSchema = new mongoose.Schema(
  {
    webhookId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Webhook',
      required: true,
      index: true,
    },
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    event: {
      type: String,
      required: true,
    },
    // Request details
    requestUrl: String,
    requestHeaders: mongoose.Schema.Types.Mixed,
    requestPayload: mongoose.Schema.Types.Mixed,
    // Response details
    responseStatus: Number,
    responseBody: String,
    responseHeaders: mongoose.Schema.Types.Mixed,
    // Delivery outcome
    status: {
      type: String,
      enum: ['success', 'failed', 'pending'],
      default: 'pending',
    },
    latencyMs: Number,
    attemptNumber: {
      type: Number,
      default: 1,
    },
    errorMessage: String,
    // For retry tracking
    nextRetryAt: Date,
  },
  {
    timestamps: true,
  }
);

webhookDeliveryLogSchema.index({ webhookId: 1, createdAt: -1 });
webhookDeliveryLogSchema.index({ schoolId: 1, createdAt: -1 });
// Auto-expire logs after 30 days
webhookDeliveryLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export default mongoose.model('WebhookDeliveryLog', webhookDeliveryLogSchema);
