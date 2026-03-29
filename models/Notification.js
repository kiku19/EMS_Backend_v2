import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: 'userModel',
      index: true,
    },
    userModel: {
      type: String,
      enum: ['Staff', 'Student', 'Parent'],
      required: true,
    },

    type: {
      type: String,
      enum: [
        'payment',
        'attendance',
        'academic',
        'event',
        'emergency',
        'transport',
        'salary',
        'work',
        'chat',
        'announcement',
        'remarks',
        'class_teacher',
        'intake_form',
      ],
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },

    // Action to take on click
    actionUrl: String,
    actionType: {
      type: String,
      enum: ['link', 'navigate', 'modal'],
    },

    // Related data
    relatedId: mongoose.Schema.Types.ObjectId,
    relatedType: String,

    // Priority
    priority: {
      type: String,
      enum: ['low', 'normal', 'high', 'urgent'],
      default: 'normal',
    },

    // Status
    read: {
      type: Boolean,
      default: false,
      index: true,
    },
    readAt: Date,

    // Quiet hours queuing — when set, channel delivery is deferred until this time
    scheduledFor: {
      type: Date,
      default: null,
      index: true,
    },

    // Delivery channels
    channels: [
      {
        type: {
          type: String,
          enum: ['email', 'sms', 'whatsapp', 'inapp'],
        },
        status: {
          type: String,
          enum: ['pending', 'sent', 'delivered', 'read', 'failed'],
          default: 'pending',
        },
        sentAt: Date,
        error: String,
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Indexes
notificationSchema.index({ userId: 1, read: 1 });
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ type: 1 });

// Method to mark as read
notificationSchema.methods.markAsRead = function () {
  if (!this.read) {
    this.read = true;
    this.readAt = new Date();
    return this.save();
  }
  return Promise.resolve(this);
};

// Static method to mark all notifications for a user as read
notificationSchema.statics.markAllAsReadForUser = function (userId, userModel) {
  return this.updateMany({ userId, userModel, read: false }, { read: true, readAt: new Date() });
};

// Static method to get unread count
notificationSchema.statics.getUnreadCount = function (userId, userModel) {
  return this.countDocuments({ userId, userModel, read: false });
};

export default mongoose.model('Notification', notificationSchema);
