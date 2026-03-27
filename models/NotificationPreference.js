import mongoose from 'mongoose';

const notificationPreferenceSchema = new mongoose.Schema(
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

  // Try exact notificationType match first
  if (notificationType) {
    const notification = categoryPref.notifications.find((n) => n.type === notificationType);
    if (notification) {
      if (!notification.enabled) {
        return { email: false, sms: false, whatsapp: false, inapp: false };
      }
      return notification.channels;
    }
  }

  // Fallback: if no specific notificationType match, check if any notification
  // in this category is enabled and merge their channel preferences
  const enabledNotifications = categoryPref.notifications.filter((n) => n.enabled);
  if (enabledNotifications.length === 0) {
    // Category exists but all notifications disabled — still allow inapp
    return { email: false, sms: false, whatsapp: false, inapp: true };
  }

  // Use channels from the first enabled notification as a reasonable default
  return enabledNotifications[0].channels;
};

// Method to check if quiet hours are active
notificationPreferenceSchema.methods.isQuietHours = function () {
  if (!this.quietHours.enabled) return false;

  // Use the user's configured timezone (falls back to Asia/Kolkata)
  const tz = this.quietHours.timezone || 'Asia/Kolkata';
  let currentTime;
  try {
    currentTime = new Date().toLocaleTimeString('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }); // HH:mm format
  } catch {
    // If timezone is invalid, fall back to server time
    currentTime = new Date().toTimeString().slice(0, 5);
  }

  // Handle case where quiet hours span midnight (e.g., 22:00 to 08:00)
  if (this.quietHours.startTime > this.quietHours.endTime) {
    return currentTime >= this.quietHours.startTime || currentTime <= this.quietHours.endTime;
  } else {
    return currentTime >= this.quietHours.startTime && currentTime <= this.quietHours.endTime;
  }
};

export default mongoose.model('NotificationPreference', notificationPreferenceSchema);
