import mongoose from 'mongoose';

const expenseSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    title: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    category: {
      type: String,
      enum: [
        'salaries',
        'utilities',
        'maintenance',
        'supplies',
        'equipment',
        'events',
        'transport',
        'marketing',
        'other',
      ],
      required: true,
    },
    paymentMode: {
      type: String,
      enum: ['cash', 'cheque', 'bank_transfer', 'upi', 'other'],
      default: 'cash',
    },
    expenseDate: { type: Date, required: true },
    description: { type: String, trim: true },
    receiptUrl: { type: String },
    vendor: { type: String, trim: true },
    approvedBy: { type: String },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    academicYear: { type: String },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

expenseSchema.index({ schoolId: 1, expenseDate: -1 });
expenseSchema.index({ schoolId: 1, category: 1 });

export default mongoose.model('Expense', expenseSchema);
