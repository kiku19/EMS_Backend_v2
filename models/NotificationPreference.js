import mongoose from 'mongoose';

const notificationPreferenceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: 'userModel',
    },
    userModel: {
      type: String,
      enum: ['Staff', 'Student', 'Parent'],
      required: true,
    },
    role: {
      type: String,
      enum: ['parent', 'staff', 'student', 'admin'],
      required: true,
    },

    // Category preferences
    preferences: [
      {
        category: {
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
          ],
        },
        notifications: [
          {
            type: {
              type: String,
              // Examples: "payment_successful", "student_absent", "homework_assigned", etc.
            },
            channels: {
              email: { type: Boolean, default: false },
              sms: { type: Boolean, default: false },
              whatsapp: { type: Boolean, default: false },
              inapp: { type: Boolean, default: true },
            },
            enabled: { type: Boolean, default: true },
          },
        ],
      },
    ],

    // Global settings
    quietHours: {
      enabled: { type: Boolean, default: false },
      startTime: String, // HH:mm format, e.g., "22:00"
      endTime: String, // HH:mm format, e.g., "08:00"
      timezone: { type: String, default: 'Asia/Kolkata' },
    },
    digestFrequency: {
      type: String,
      enum: ['instant', 'hourly', 'daily', 'weekly'],
      default: 'instant',
    },

    // Email digest settings
    emailDigest: {
      enabled: { type: Boolean, default: false },
      frequency: {
        type: String,
        enum: ['daily', 'weekly'],
        default: 'daily',
      },
      time: String, // HH:mm format
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
notificationPreferenceSchema.index({ userId: 1, userModel: 1 }, { unique: true });
notificationPreferenceSchema.index({ role: 1 });

// Method to get channel preferences for a notification type
notificationPreferenceSchema.methods.getChannelPreferences = function (category, notificationType) {
  const categoryPref = this.preferences.find((p) => p.category === category);
  if (!categoryPref) {
    // Return default preferences
    return { email: false, sms: false, whatsapp: false, inapp: true };
  }

  const notification = categoryPref.notifications.find((n) => n.type === notificationType);
  if (!notification || !notification.enabled) {
    return { email: false, sms: false, whatsapp: false, inapp: false };
  }

  return notification.channels;
};

// Method to check if quiet hours are active
notificationPreferenceSchema.methods.isQuietHours = function () {
  if (!this.quietHours.enabled) return false;

  const now = new Date();
  const currentTime = now.toTimeString().slice(0, 5); // HH:mm format

  // Handle case where quiet hours span midnight (e.g., 22:00 to 08:00)
  if (this.quietHours.startTime > this.quietHours.endTime) {
    return currentTime >= this.quietHours.startTime || currentTime <= this.quietHours.endTime;
  } else {
    return currentTime >= this.quietHours.startTime && currentTime <= this.quietHours.endTime;
  }
};

export default mongoose.model('NotificationPreference', notificationPreferenceSchema);
