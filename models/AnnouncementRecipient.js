import mongoose from 'mongoose';

const announcementRecipientSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
    },
    announcementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Announcement',
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    userType: {
      type: String,
      enum: ['Staff', 'Student', 'Parent'],
      required: true,
    },

    // Delivery status per channel
    deliveryStatus: [
      {
        channel: {
          type: String,
          enum: ['email', 'sms', 'whatsapp', 'inapp'],
        },
        status: {
          type: String,
          enum: ['pending', 'sent', 'delivered', 'read', 'failed'],
          default: 'pending',
        },
        sentAt: Date,
        deliveredAt: Date,
        readAt: Date,
        error: String,
        messageId: String, // External service message ID (MSG91 requestId / nodemailer messageId)
        // Email open/click tracking
        trackingToken: String, // Unique token for email pixel/click tracking
        openedAt: Date,
        openCount: { type: Number, default: 0 },
        clickCount: { type: Number, default: 0 },
        // Bounce tracking
        bounceReason: String,
        bouncedAt: Date,
      },
    ],

    // Overall status
    status: {
      type: String,
      enum: ['pending', 'sent', 'failed'],
      default: 'pending',
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
announcementRecipientSchema.index({ schoolId: 1, announcementId: 1 });
announcementRecipientSchema.index({ schoolId: 1, userId: 1 });
announcementRecipientSchema.index({ status: 1 });
announcementRecipientSchema.index({ 'deliveryStatus.trackingToken': 1 });
announcementRecipientSchema.index({ 'deliveryStatus.messageId': 1 });

// Method to mark as delivered
announcementRecipientSchema.methods.markDelivered = function (channel) {
  const channelStatus = this.deliveryStatus.find((ds) => ds.channel === channel);
  if (channelStatus) {
    channelStatus.status = 'delivered';
    channelStatus.deliveredAt = new Date();
  }
  return this.save();
};

// Method to mark as read
announcementRecipientSchema.methods.markRead = function (channel) {
  const channelStatus = this.deliveryStatus.find((ds) => ds.channel === channel);
  if (channelStatus) {
    channelStatus.status = 'read';
    channelStatus.readAt = new Date();
  }
  return this.save();
};

// Method to mark as failed
announcementRecipientSchema.methods.markFailed = function (channel, error) {
  const channelStatus = this.deliveryStatus.find((ds) => ds.channel === channel);
  if (channelStatus) {
    channelStatus.status = 'failed';
    channelStatus.error = error;
  }
  return this.save();
};

export default mongoose.model('AnnouncementRecipient', announcementRecipientSchema);
