import mongoose from 'mongoose';

const reminderSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['fee', 'attendance', 'academic', 'events', 'payroll', 'custom'],
      required: true,
    },

    // Trigger conditions
    triggers: [
      {
        condition: {
          type: String,
          required: true,
          // Examples: "days_before_due", "days_after_overdue", "attendance_below",
          // "exam_days_before", "event_days_before"
        },
        value: mongoose.Schema.Types.Mixed, // e.g., 7 (days), 75 (percentage)
        field: String, // e.g., "feeDueDate", "attendancePercentage"
      },
    ],

    // Message content
    message: {
      type: String,
      required: true,
    },

    // Template reference (if using template)
    templateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ReminderTemplate',
    },

    // Recipients
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
        type: String,
        enum: ['email', 'sms', 'whatsapp', 'inapp'],
      },
    ],

    // Schedule
    startDate: {
      type: Date,
      required: true,
    },
    endDate: Date,
    frequency: {
      type: String,
      enum: ['once', 'daily', 'weekly'],
      default: 'once',
    },

    // Status
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: true,
    },

    // Execution tracking
    lastExecutedAt: Date,
    nextExecutionAt: {
      type: Date,
      index: true,
    },
    executionCount: {
      type: Number,
      default: 0,
    },

    // Statistics
    stats: {
      totalSent: { type: Number, default: 0 },
      totalDelivered: { type: Number, default: 0 },
      totalFailed: { type: Number, default: 0 },
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
reminderSchema.index({ isActive: 1, nextExecutionAt: 1 });
reminderSchema.index({ type: 1 });
reminderSchema.index({ createdBy: 1 });
reminderSchema.index({ createdAt: -1 });

// Method to calculate next execution time
reminderSchema.methods.calculateNextExecution = function () {
  const now = new Date();

  if (this.frequency === 'once') {
    this.nextExecutionAt = this.startDate;
    if (this.nextExecutionAt <= now) {
      this.isActive = false; // One-time reminder executed
    }
  } else if (this.frequency === 'daily') {
    // Calculate next day at same time as startDate
    const next = new Date(this.lastExecutedAt || this.startDate);
    next.setDate(next.getDate() + 1);
    this.nextExecutionAt = next;

    // Check if past endDate
    if (this.endDate && this.nextExecutionAt > this.endDate) {
      this.isActive = false;
    }
  } else if (this.frequency === 'weekly') {
    // Calculate next week at same time as startDate
    const next = new Date(this.lastExecutedAt || this.startDate);
    next.setDate(next.getDate() + 7);
    this.nextExecutionAt = next;

    // Check if past endDate
    if (this.endDate && this.nextExecutionAt > this.endDate) {
      this.isActive = false;
    }
  }

  return this.save();
};

// Method to mark as executed
reminderSchema.methods.markExecuted = function () {
  this.lastExecutedAt = new Date();
  this.executionCount += 1;
  return this.calculateNextExecution();
};

export default mongoose.model('Reminder', reminderSchema);
