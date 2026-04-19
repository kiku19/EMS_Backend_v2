import mongoose from 'mongoose';

const announcementSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    title: {
      type: String,
      required: true,
      maxlength: 200,
      trim: true,
    },
    content: {
      type: String,
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: 'creatorModel',
    },
    creatorModel: {
      type: String,
      enum: ['Staff', 'Student'],
      required: true,
    },

    // Recipients configuration
    recipients: [
      {
        type: {
          type: String,
          enum: ['all', 'staff', 'students', 'parents', 'custom'],
          required: true,
        },
        classIds: [
          {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Class',
          },
        ],
        userIds: [
          {
            type: mongoose.Schema.Types.ObjectId,
          },
        ],
      },
    ],

    // Channels to send through
    channels: [
      {
        type: {
          type: String,
          enum: ['email', 'sms', 'whatsapp', 'inapp'],
          required: true,
        },
        status: {
          type: String,
          enum: ['pending', 'sent', 'delivered', 'failed'],
          default: 'pending',
        },
        sentAt: Date,
        error: String,
        // Analytics per channel
        stats: {
          totalRecipients: { type: Number, default: 0 },
          sentCount: { type: Number, default: 0 },
          deliveredCount: { type: Number, default: 0 },
          failedCount: { type: Number, default: 0 },
          readCount: { type: Number, default: 0 },
          openCount: { type: Number, default: 0 },
          clickCount: { type: Number, default: 0 },
          bounceCount: { type: Number, default: 0 },
        },
      },
    ],

    // Scheduling
    scheduledFor: Date,
    status: {
      type: String,
      enum: ['draft', 'scheduled', 'sending', 'sent', 'failed', 'partial'],
      default: 'draft',
    },

    // Attachments
    attachments: [
      {
        url: String,
        name: String,
        type: String,
        size: Number,
      },
    ],

    // Overall analytics
    analytics: {
      totalRecipients: { type: Number, default: 0 },
      sentCount: { type: Number, default: 0 },
      deliveredCount: { type: Number, default: 0 },
      failedCount: { type: Number, default: 0 },
      readCount: { type: Number, default: 0 },
      readRate: { type: Number, default: 0 }, // percentage
      openCount: { type: Number, default: 0 },
      openRate: { type: Number, default: 0 }, // percentage of sent
      clickCount: { type: Number, default: 0 },
      clickRate: { type: Number, default: 0 }, // percentage of opens
      bounceCount: { type: Number, default: 0 },
      bounceRate: { type: Number, default: 0 }, // percentage of sent
    },

    // Sending timestamps
    sentAt: Date,
    completedAt: Date,

    // Soft-delete: DELETE /:id flips these rather than removing the doc so
    // trash-restore can revive it with its analytics intact.
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: Date,
    deletedBy: { type: mongoose.Schema.Types.ObjectId, refPath: 'creatorModel' },
  },
  {
    timestamps: true,
  }
);

// Indexes
announcementSchema.index({ schoolId: 1, status: 1, createdAt: -1 });
announcementSchema.index({ scheduledFor: 1, status: 1 });
announcementSchema.index({ createdBy: 1 });
// Note: status is already indexed in the compound index above
announcementSchema.index({ createdAt: -1 });

// Virtual for read rate calculation
announcementSchema.virtual('calculatedReadRate').get(function () {
  if (this.analytics.sentCount === 0) return 0;
  return Math.round((this.analytics.readCount / this.analytics.sentCount) * 100);
});

// Method to update read rate and delivery analytics rates
announcementSchema.methods.updateReadRate = function () {
  const sent = this.analytics.sentCount || 0;
  const opens = this.analytics.openCount || 0;
  this.analytics.readRate = sent > 0 ? Math.round((this.analytics.readCount / sent) * 100) : 0;
  this.analytics.openRate = sent > 0 ? Math.round((opens / sent) * 100) : 0;
  this.analytics.clickRate = opens > 0 ? Math.round((this.analytics.clickCount / opens) * 100) : 0;
  this.analytics.bounceRate = sent > 0 ? Math.round((this.analytics.bounceCount / sent) * 100) : 0;
  return this.save();
};

export default mongoose.model('Announcement', announcementSchema);
