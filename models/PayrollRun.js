import mongoose from 'mongoose';

const payrollRunSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },
    month: {
      type: Number,
      required: true,
      min: 1,
      max: 12,
    },
    year: {
      type: Number,
      required: true,
    },
    runDate: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'partial'],
      default: 'pending',
    },
    totalEmployees: {
      type: Number,
      default: 0,
    },
    processedEmployees: {
      type: Number,
      default: 0,
    },
    failedEmployees: {
      type: Number,
      default: 0,
    },
    totalAmount: {
      type: Number,
      default: 0,
    },
    totalPaid: {
      type: Number,
      default: 0,
    },
    totalPending: {
      type: Number,
      default: 0,
    },
    runBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
    },
    completedAt: Date,
    errorLog: [String],
    notes: String,
    // Concurrent run prevention
    isProcessing: {
      type: Boolean,
      default: false,
    },
    processingLockExpiresAt: Date,
    processingLockedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
    },
    // Opaque ownership token. User id alone is insufficient because the same
    // operator can double-submit from two tabs; only the request that acquired
    // this token may refresh or release the lock.
    processingLockToken: {
      type: String,
      select: false,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for unique month/year per school
payrollRunSchema.index({ schoolId: 1, month: 1, year: 1 }, { unique: true });

export default mongoose.model('PayrollRun', payrollRunSchema);
