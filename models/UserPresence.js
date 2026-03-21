import mongoose from 'mongoose';

const userPresenceSchema = new mongoose.Schema(
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
      required: true,
      enum: ['Staff', 'Student'],
    },
    status: {
      type: String,
      enum: ['online', 'offline', 'away'],
      default: 'offline',
    },
    lastSeen: {
      type: Date,
      default: Date.now,
    },
    socketId: String,
    deviceInfo: {
      platform: {
        type: String,
        enum: ['web', 'ios', 'android', 'desktop'],
        default: 'web',
      },
      deviceId: String,
      userAgent: String,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
userPresenceSchema.index({ schoolId: 1, userId: 1 }, { unique: true });
userPresenceSchema.index({ schoolId: 1, status: 1 });
userPresenceSchema.index({ lastSeen: -1 });

// Method to set user online
userPresenceSchema.statics.setOnline = async function (
  userId,
  userModel,
  socketId,
  deviceInfo = {},
  schoolId
) {
  return await this.findOneAndUpdate(
    { userId, schoolId },
    {
      userId,
      userModel,
      schoolId,
      status: 'online',
      lastSeen: new Date(),
      socketId,
      deviceInfo,
    },
    { upsert: true, new: true }
  );
};

// Method to set user offline
userPresenceSchema.statics.setOffline = async function (userId) {
  return await this.findOneAndUpdate(
    { userId },
    {
      status: 'offline',
      lastSeen: new Date(),
      socketId: null,
    },
    { new: true }
  );
};

// Method to get online users scoped by school
userPresenceSchema.statics.getOnlineUsers = async function (schoolId) {
  const query = { status: 'online' };
  if (schoolId) query.schoolId = schoolId;
  return await this.find(query);
};

export default mongoose.model('UserPresence', userPresenceSchema);
