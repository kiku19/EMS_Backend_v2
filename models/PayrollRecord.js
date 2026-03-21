import mongoose from 'mongoose';

const payrollRecordSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: true,
      index: true,
    },
    payrollRunId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PayrollRun',
      required: true,
    },
    month: {
      type: Number,
      required: true,
    },
    year: {
      type: Number,
      required: true,
    },
    employmentType: {
      type: String,
      enum: ['full_time', 'part_time', 'contractor'],
      required: true,
    },
    baseSalary: {
      type: Number,
      required: true,
      min: 0,
    },
    allowances: [
      {
        type: {
          type: String,
          required: true,
        },
        amount: {
          type: Number,
          required: true,
        },
        description: String,
      },
    ],
    deductions: [
      {
        type: {
          type: String,
          required: true,
        },
        amount: {
          type: Number,
          required: true,
        },
        description: String,
      },
    ],
    totalAllowances: {
      type: Number,
      default: 0,
    },
    totalDeductions: {
      type: Number,
      default: 0,
    },
    grossPay: {
      type: Number,
      required: true,
    },
    netPay: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ['not_generated', 'generated', 'paid', 'on_hold', 'failed'],
      default: 'generated',
    },
    paymentDate: Date,
    paymentMethod: {
      type: String,
      enum: ['bank_transfer', 'cash', 'cheque', 'online', 'upi', 'neft', 'rtgs'],
      default: 'bank_transfer',
    },
    paymentReference: String,
    isLocked: {
      type: Boolean,
      default: false,
    },
    lockedAt: Date,
    lockedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
    },
    paidBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
    },
    failureReason: String,
    notes: String,
    // Payment reversal tracking
    reversalHistory: [
      {
        reversedAt: Date,
        reversedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Staff',
        },
        reason: String,
        previousStatus: String,
        previousPaymentDate: Date,
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Compound index for unique employee per month/year per school
payrollRecordSchema.index({ schoolId: 1, employeeId: 1, month: 1, year: 1 }, { unique: true });
payrollRecordSchema.index({ payrollRunId: 1 });
payrollRecordSchema.index({ status: 1 });

// Calculate totals before saving
payrollRecordSchema.pre('save', function (next) {
  this.totalAllowances = this.allowances.reduce((sum, a) => sum + a.amount, 0);
  this.totalDeductions = this.deductions.reduce((sum, d) => sum + d.amount, 0);
  this.grossPay = this.baseSalary + this.totalAllowances;
  this.netPay = this.grossPay - this.totalDeductions;
  next();
});

export default mongoose.model('PayrollRecord', payrollRecordSchema);
