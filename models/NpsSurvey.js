import mongoose from 'mongoose';

const npsSurveySchema = new mongoose.Schema(
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
      enum: ['Staff'],
      required: true,
      default: 'Staff',
    },
    score: {
      type: Number,
      min: 0,
      max: 10,
    },
    comment: {
      type: String,
      maxlength: 500,
    },
    category: {
      type: String,
      enum: ['detractor', 'passive', 'promoter'],
    },
    dismissed: {
      type: Boolean,
      default: false,
    },
    source: {
      type: String,
      enum: ['dashboard', 'mobile'],
      default: 'dashboard',
    },
  },
  {
    timestamps: true,
  }
);

npsSurveySchema.index({ schoolId: 1, createdAt: -1 });
npsSurveySchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('NpsSurvey', npsSurveySchema);
