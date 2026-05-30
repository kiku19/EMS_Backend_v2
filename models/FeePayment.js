import mongoose from 'mongoose';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

const feePaymentSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    academicYear: { type: String, default: CURRENT_ACADEMIC_YEAR },
    receiptNumber: { type: String, required: true },

    // Payment Details — stored as String YYYY-MM-DD (not Date). Routes
    // filter via string comparison because Mongoose would otherwise cast
    // the query operand to Date and `gte:"2026-04-01"` would end up
    // comparing a Date (00:00 UTC) against a YYYY-MM-DD string value.
    // Keep the schema type explicitly String so new records are stored
    // consistently regardless of what shape callers pass.
    paymentDate: { type: String, required: true },
    amount: { type: Number, required: true },
    paymentMode: { type: String, required: true }, // 'cash', 'cheque', 'online', 'card'

    // Fee Heads Breakdown
    feeHeads: [
      {
        feeHeadId: { type: mongoose.Schema.Types.ObjectId, ref: 'FeeHead' },
        name: String,
        amount: Number,
        month: String, // For monthly fees
        period: String, // For quarterly/annual fees
      },
    ],

    // Transaction Details
    transactionId: String, // For online/card payments (gateway payment ID)
    chequeNumber: String, // For cheque payments
    bankName: String,

    // Payment Gateway Verification
    gatewayOrderId: String, // Order ID from payment gateway (e.g. Razorpay order_id)
    gatewaySignature: String, // Signature from gateway callback (audit trail)
    gatewayVerified: { type: Boolean, default: false }, // True if gateway signature was verified

    // Late Fee
    lateFee: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },

    // Idempotency key to prevent duplicate payments
    idempotencyKey: { type: String, index: true },

    // Status
    status: { type: String, default: 'completed' }, // 'completed', 'pending', 'failed', 'cancelled'

    // Cancellation tracking
    cancelledAt: Date,
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },

    // Collected By
    collectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },

    // Notes
    remarks: String,
  },
  { timestamps: true }
);

feePaymentSchema.index({ studentId: 1, paymentDate: 1 });
feePaymentSchema.index({ studentId: 1, academicYear: 1 });
feePaymentSchema.index({ classId: 1, academicYear: 1 });
feePaymentSchema.index({ schoolId: 1, receiptNumber: 1 }, { unique: true });
feePaymentSchema.index(
  { schoolId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true, $ne: null } } }
);
feePaymentSchema.index({ schoolId: 1, paymentDate: -1 });

export default mongoose.model('FeePayment', feePaymentSchema);
