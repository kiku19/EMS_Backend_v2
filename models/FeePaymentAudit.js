import mongoose from 'mongoose';

const feePaymentAuditSchema = new mongoose.Schema(
  {
    // School scoping (multi-tenancy)
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },

    // Target entity — the FeePayment or StudentFeeStructure being changed
    entityType: {
      type: String,
      enum: ['FeePayment', 'StudentFeeStructure'],
      required: true,
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },

    // Related student (denormalized for fast queries)
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      index: true,
    },

    // Action performed
    action: {
      type: String,
      required: true,
      enum: [
        'payment_recorded',
        'payment_cancelled',
        'payment_updated',
        'discount_applied',
        'discount_updated',
        'structure_reconciled',
        'structure_initialized',
        'refund_created',
        'refund_approved',
        'refund_processed',
        'refund_rejected',
        'refund_updated',
        'refund_deleted',
      ],
    },

    // Who performed the action
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: true,
    },
    performedByName: {
      type: String,
    },

    // Change details
    changes: {
      before: mongoose.Schema.Types.Mixed,
      after: mongoose.Schema.Types.Mixed,
    },

    // Context specific to fee payments
    context: {
      receiptNumber: String,
      amount: Number,
      academicYear: String,
      reason: String,
      paymentMode: String,
      refundNumber: String,
    },

    // Metadata
    ipAddress: String,
    userAgent: String,

    // Result
    status: {
      type: String,
      enum: ['success', 'failure'],
      default: 'success',
    },
    errorMessage: String,
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient queries
feePaymentAuditSchema.index({ schoolId: 1, studentId: 1, createdAt: -1 });
feePaymentAuditSchema.index({ schoolId: 1, entityType: 1, entityId: 1, createdAt: -1 });
feePaymentAuditSchema.index({ schoolId: 1, action: 1, createdAt: -1 });
feePaymentAuditSchema.index({ schoolId: 1, performedBy: 1, createdAt: -1 });
feePaymentAuditSchema.index({ schoolId: 1, 'context.receiptNumber': 1 });

export default mongoose.model('FeePaymentAudit', feePaymentAuditSchema);
