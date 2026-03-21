import mongoose from 'mongoose';

const rowResultSchema = new mongoose.Schema(
  {
    row: Number,
    identifier: String, // admissionId, name, etc.
    status: { type: String, enum: ['imported', 'skipped', 'failed'] },
    error: String,
  },
  { _id: false }
);

const importJobSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    type: {
      type: String,
      required: true,
      enum: ['students', 'staff', 'fees', 'attendance', 'results'],
    },
    status: {
      type: String,
      required: true,
      enum: ['queued', 'running', 'completed', 'failed', 'rolled_back'],
      default: 'queued',
    },
    dryRun: { type: Boolean, default: false },
    fileName: String,
    totalRows: { type: Number, default: 0 },
    processedRows: { type: Number, default: 0 },
    importedCount: { type: Number, default: 0 },
    skippedCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    rows: [rowResultSchema],
    // Snapshot of created document IDs for rollback
    createdIds: [{ type: mongoose.Schema.Types.ObjectId }],
    rollbackData: { type: mongoose.Schema.Types.Mixed }, // Extra info for rollback
    errorMessage: String,
    initiatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    completedAt: Date,
  },
  { timestamps: true }
);

importJobSchema.index({ schoolId: 1, createdAt: -1 });

export default mongoose.model('ImportJob', importJobSchema);
