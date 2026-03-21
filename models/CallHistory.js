import mongoose from 'mongoose';

const callHistorySchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },
    participants: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          required: true,
        },
        userModel: {
          type: String,
          enum: ['Staff', 'Student'],
          required: true,
        },
        userName: String,
        joinedAt: Date,
        leftAt: Date,
      },
    ],

    callType: {
      type: String,
      enum: ['audio', 'video'],
      required: true,
    },

    initiatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    initiatorModel: {
      type: String,
      enum: ['Staff', 'Student'],
      required: true,
    },

    status: {
      type: String,
      enum: ['initiated', 'ringing', 'connected', 'ended', 'missed', 'rejected', 'failed'],
      required: true,
    },

    startTime: Date,
    endTime: Date,
    duration: {
      type: Number,
      default: 0, // in seconds
    },

    // Missed call info
    missedBy: {
      type: mongoose.Schema.Types.ObjectId,
    },
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
    },

    // End reason
    endReason: {
      type: String,
      enum: ['user_ended', 'timeout', 'failed', 'network_error', 'unknown'],
    },

    // Quality metrics
    qualityMetrics: {
      audioEnabled: { type: Boolean, default: true },
      videoEnabled: { type: Boolean, default: true },
      connectionQuality: {
        type: String,
        enum: ['excellent', 'good', 'fair', 'poor'],
      },
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
callHistorySchema.index({ 'participants.userId': 1 });
callHistorySchema.index({ initiatedBy: 1 });
callHistorySchema.index({ status: 1 });
callHistorySchema.index({ startTime: -1 });

// Method to calculate duration
callHistorySchema.methods.calculateDuration = function () {
  if (this.startTime && this.endTime) {
    this.duration = Math.floor((this.endTime - this.startTime) / 1000);
  }
  return this.save();
};

// Static method to get call history for a user
callHistorySchema.statics.getUserCallHistory = function (userId, limit = 50) {
  return this.find({
    'participants.userId': userId,
  })
    .sort({ startTime: -1 })
    .limit(limit)
    .populate('participants.userId', 'name profileImage')
    .populate('initiatedBy', 'name profileImage');
};

// Static method to get missed calls
callHistorySchema.statics.getMissedCalls = function (userId) {
  return this.find({
    'participants.userId': userId,
    status: 'missed',
    initiatedBy: { $ne: userId }, // Not initiated by the user
  })
    .sort({ startTime: -1 })
    .populate('initiatedBy', 'name profileImage');
};

export default mongoose.model('CallHistory', callHistorySchema);
