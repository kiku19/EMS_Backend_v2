import mongoose from 'mongoose';

const announcementSchema = new mongoose.Schema({
  schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', index: true },
  title: {
    type: String,
    required: true,
    maxlength: 200,
    trim: true
  },
  content: {
    type: String,
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'creatorModel'
  },
  creatorModel: {
    type: String,
    enum: ['Staff', 'Student'],
    required: true
  },

  // Recipients configuration
  recipients: [{
    type: {
      type: String,
      enum: ['all', 'staff', 'students', 'parents', 'custom'],
      required: true
    },
    classIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Class'
    }],
    userIds: [{
      type: mongoose.Schema.Types.ObjectId
    }]
  }],

  // Channels to send through
  channels: [{
    type: {
      type: String,
      enum: ['email', 'sms', 'whatsapp', 'inapp'],
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'sent', 'failed'],
      default: 'pending'
    },
    sentAt: Date,
    error: String,
    // Analytics per channel
    stats: {
      totalRecipients: { type: Number, default: 0 },
      sentCount: { type: Number, default: 0 },
      deliveredCount: { type: Number, default: 0 },
      failedCount: { type: Number, default: 0 },
      readCount: { type: Number, default: 0 }
    }
  }],

  // Scheduling
  scheduledFor: Date,
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'sending', 'sent', 'failed', 'partial'],
    default: 'draft'
  },

  // Attachments
  attachments: [{
    url: String,
    name: String,
    type: String,
    size: Number
  }],

  // Overall analytics
  analytics: {
    totalRecipients: { type: Number, default: 0 },
    sentCount: { type: Number, default: 0 },
    deliveredCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    readCount: { type: Number, default: 0 },
    readRate: { type: Number, default: 0 } // percentage
  },

  // Sending timestamps
  sentAt: Date,
  completedAt: Date
}, {
  timestamps: true
});

// Indexes
announcementSchema.index({ schoolId: 1, status: 1, createdAt: -1 });
announcementSchema.index({ scheduledFor: 1, status: 1 });
announcementSchema.index({ createdBy: 1 });
// Note: status is already indexed in the compound index above
announcementSchema.index({ createdAt: -1 });

// Virtual for read rate calculation
announcementSchema.virtual('calculatedReadRate').get(function() {
  if (this.analytics.sentCount === 0) return 0;
  return Math.round((this.analytics.readCount / this.analytics.sentCount) * 100);
});

// Method to update read rate
announcementSchema.methods.updateReadRate = function() {
  this.analytics.readRate = this.calculatedReadRate;
  return this.save();
};

export default mongoose.model('Announcement', announcementSchema);
