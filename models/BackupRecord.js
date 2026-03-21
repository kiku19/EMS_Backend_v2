import mongoose from 'mongoose';

const backupRecordSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: true,
    },
    label: {
      type: String,
      default: '',
      maxlength: 100,
    },
    status: {
      type: String,
      enum: ['completed', 'failed'],
      default: 'completed',
      index: true,
    },
    collections: [String],
    recordCounts: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    sizeBytes: {
      type: Number,
      default: 0,
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

backupRecordSchema.index({ schoolId: 1, createdAt: -1 });

export default mongoose.model('BackupRecord', backupRecordSchema);
