import mongoose from 'mongoose';

// Tracks which changelog entries a user has read
const changelogReadSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: 'userModel',
      index: true,
    },
    userModel: {
      type: String,
      enum: ['Staff'],
      required: true,
    },
    changelogId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Changelog',
      required: true,
      index: true,
    },
    readAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
  }
);

changelogReadSchema.index({ userId: 1, changelogId: 1 }, { unique: true });

export default mongoose.model('ChangelogRead', changelogReadSchema);
