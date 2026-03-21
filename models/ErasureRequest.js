import mongoose from 'mongoose';
import crypto from 'crypto';

const erasureRequestSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },
    referenceNumber: {
      type: String,
      unique: true,
      index: true,
    },
    entityType: {
      type: String,
      enum: ['Student', 'Staff', 'Parent'],
      required: true,
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    // Denormalized for audit trail — survives after entity is deleted
    entityName: {
      type: String,
      required: true,
      maxlength: 200,
    },
    reason: {
      type: String,
      required: true,
      maxlength: 1000,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'executed', 'failed'],
      default: 'pending',
      index: true,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: true,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
    },
    reviewNote: {
      type: String,
      maxlength: 1000,
    },
    reviewedAt: { type: Date },
    executedAt: { type: Date },
    // Summary of records deleted, populated after execution
    deletedRecords: { type: mongoose.Schema.Types.Mixed },
    executionError: { type: String, maxlength: 500 },
  },
  {
    timestamps: true,
  }
);

// Auto-generate a human-readable reference number before save
erasureRequestSchema.pre('validate', function (next) {
  if (!this.referenceNumber) {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
    this.referenceNumber = `ERA-${date}-${rand}`;
  }
  next();
});

erasureRequestSchema.index({ schoolId: 1, status: 1, createdAt: -1 });
erasureRequestSchema.index({ schoolId: 1, entityType: 1, entityId: 1 });

export default mongoose.model('ErasureRequest', erasureRequestSchema);
