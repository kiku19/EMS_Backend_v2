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
    // P11: free-text vendor name kept for backward compatibility (legacy rows
    // and quick ad-hoc entries). New expenses should link to a Vendor record
    // via vendorId. The list/summary routes still text-match on `vendor` so
    // existing data keeps working; populate vendorId where present.
    vendor: { type: String, trim: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', default: null, index: true },
    // P10: approver. Previously a free String; left as String here so the
    // approve/reject endpoints' assignment of req.user._id (cast to string)
    // round-trips without a data migration. A future migration can turn this
    // into a Staff ref.
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
