import mongoose from 'mongoose';

const changelogSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    body: {
      type: String,
      required: true,
      maxlength: 5000,
    },
    version: {
      type: String,
      required: true,
      trim: true,
      maxlength: 20,
    },
    category: {
      type: String,
      enum: ['new_feature', 'improvement', 'bug_fix', 'announcement'],
      required: true,
    },
    publishedAt: {
      type: Date,
      default: null,
    },
    isPublished: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

changelogSchema.index({ isPublished: 1, publishedAt: -1 });

export default mongoose.model('Changelog', changelogSchema);
