import mongoose from 'mongoose';

const payrollAuditLogSchema = new mongoose.Schema(
  {
    // School scoping (multi-tenancy)
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },

    // Target entity
    entityType: {
      type: String,
      enum: ['PayrollRun', 'PayrollRecord', 'SalaryAdjustment', 'Payslip'],
      required: true,
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },

    // Action performed
    action: {
      type: String,
      required: true,
      enum: [
        'payroll_run_started',
        'payroll_run_completed',
        'payroll_run_failed',
        'record_created',
        'record_updated',
        'record_locked',
        'record_unlocked',
        'payment_logged',
        'payment_reversed',
        'bulk_payment_logged',
        'adjustment_created',
        'adjustment_deleted',
        'payslip_downloaded',
        'payroll_exported',
      ],
    },

    // Who performed the action
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: true,
    },

    // Change details
    changes: {
      before: mongoose.Schema.Types.Mixed,
      after: mongoose.Schema.Types.Mixed,
    },

    // Additional context
    context: {
      month: Number,
      year: Number,
      employeeId: String,
      employeeName: String,
      reason: String,
      paymentMethod: String,
      paymentReference: String,
      affectedRecords: [mongoose.Schema.Types.ObjectId],
    },

    // Metadata
    ipAddress: String,
    userAgent: String,

    // Result
    status: {
      type: String,
      enum: ['success', 'failure', 'partial'],
      default: 'success',
    },
    errorMessage: String,
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient queries
payrollAuditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
payrollAuditLogSchema.index({ performedBy: 1, createdAt: -1 });
payrollAuditLogSchema.index({ action: 1, createdAt: -1 });
payrollAuditLogSchema.index({ context: 1 });

export default mongoose.model('PayrollAuditLog', payrollAuditLogSchema);
