import mongoose from 'mongoose';

const WEBHOOK_EVENTS = [
  'student.created',
  'student.updated',
  'fee.paid',
  'attendance.marked',
  'exam.published',
  'result.entered',
  'staff.created',
  'announcement.sent',
];

const webhookSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    url: {
      type: String,
      required: true,
      trim: true,
    },
    secret: {
      type: String,
      required: true,
    },
    events: {
      type: [String],
      enum: WEBHOOK_EVENTS,
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'At least one event must be selected',
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    failureCount: {
      type: Number,
      default: 0,
    },
    lastTriggeredAt: Date,
    // Dead letter queue: webhooks that failed all retries
    deadLetterQueue: [
      {
        event: String,
        payload: mongoose.Schema.Types.Mixed,
        failedAt: Date,
        lastError: String,
        attemptCount: Number,
      },
    ],
  },
  {
    timestamps: true,
  }
);

webhookSchema.index({ schoolId: 1, isActive: 1 });
webhookSchema.index({ schoolId: 1, events: 1 });

export const WEBHOOK_EVENTS_LIST = WEBHOOK_EVENTS;
export default mongoose.model('Webhook', webhookSchema);
