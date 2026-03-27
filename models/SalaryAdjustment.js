import mongoose from 'mongoose';

const salaryAdjustmentSchema = new mongoose.Schema(
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
    type: {
      type: String,
      enum: ['allowance', 'deduction'],
      required: true,
    },
    category: {
      type: String,
      required: true, // e.g., 'HRA', 'Transport', 'Tax', 'PF'
    },
    amount: {
      type: Number,
      required: true,
    },
    description: String,
    effectiveMonth: {
      type: Number,
      required: true,
      min: 1,
      max: 12,
    },
    effectiveYear: {
      type: Number,
      required: true,
    },
    isRecurring: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
    },
  },
  {
    timestamps: true,
  }
);

salaryAdjustmentSchema.index({ employeeId: 1, effectiveMonth: 1, effectiveYear: 1 });
salaryAdjustmentSchema.index({ isActive: 1 });

export default mongoose.model('SalaryAdjustment', salaryAdjustmentSchema);
