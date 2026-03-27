import mongoose from 'mongoose';

const pushTokenSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'userModel',
      required: true,
    },
    userModel: {
      type: String,
      enum: ['Staff', 'Student', 'Parent'],
      default: 'Staff',
    },
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
    },
    platform: {
      type: String,
      enum: ['ios', 'android', 'web'],
      required: true,
    },
    appVersion: String,
    osVersion: String,
    deviceId: String,
    isActive: {
      type: Boolean,
      default: true,
    },
    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

pushTokenSchema.index({ user: 1, schoolId: 1 });
// Note: token field already has unique: true which creates an index automatically

export default mongoose.model('PushToken', pushTokenSchema);
