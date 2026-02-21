import mongoose from 'mongoose';

const userPresenceSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    unique: true,
    refPath: 'userModel'
  },
  userModel: {
    type: String,
    required: true,
    enum: ['Staff', 'Student']
  },
  status: {
    type: String,
    enum: ['online', 'offline', 'away'],
    default: 'offline'
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },
  socketId: String,
  deviceInfo: {
    platform: {
      type: String,
      enum: ['web', 'ios', 'android', 'desktop'],
      default: 'web'
    },
    deviceId: String,
    userAgent: String
  }
}, {
  timestamps: true
});

// Indexes
// Note: userId already has unique: true which creates an index
userPresenceSchema.index({ status: 1 });
userPresenceSchema.index({ lastSeen: -1 });

// Method to set user online
userPresenceSchema.statics.setOnline = async function(userId, userModel, socketId, deviceInfo = {}) {
  return await this.findOneAndUpdate(
    { userId },
    {
      userId,
      userModel,
      status: 'online',
      lastSeen: new Date(),
      socketId,
      deviceInfo
    },
    { upsert: true, new: true }
  );
};

// Method to set user offline
userPresenceSchema.statics.setOffline = async function(userId) {
  return await this.findOneAndUpdate(
    { userId },
    {
      status: 'offline',
      lastSeen: new Date(),
      socketId: null
    },
    { new: true }
  );
};

// Method to get online users
userPresenceSchema.statics.getOnlineUsers = async function() {
  return await this.find({ status: 'online' });
};

export default mongoose.model('UserPresence', userPresenceSchema);
