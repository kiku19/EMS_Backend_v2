import mongoose from 'mongoose';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

const feePaymentSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    academicYear: { type: String, required: true, default: CURRENT_ACADEMIC_YEAR },
    receiptNumber: { type: String, required: true },

    // Payment Details — stored as String YYYY-MM-DD (not Date). Routes
    // filter via string comparison because Mongoose would otherwise cast
    // the query operand to Date and `gte:"2026-04-01"` would end up
    // comparing a Date (00:00 UTC) against a YYYY-MM-DD string value.
    // Keep the schema type explicitly String so new records are stored
    // consistently regardless of what shape callers pass.
    paymentDate: { type: String, required: true },
    amount: { type: Number, required: true, min: 0.01 },
    paymentMode: {
      type: String,
      required: true,
      enum: ['cash', 'cheque', 'dd', 'online', 'card', 'upi', 'bank_transfer'],
    },

    // Fee Heads Breakdown
    feeHeads: [
      {
        // Opaque ledger-head identifier. Class-level custom heads use their
        // embedded subdocument id and therefore do not always reference the
        // global FeeHead catalogue.
        feeHeadId: { type: mongoose.Schema.Types.ObjectId },
        name: String,
        amount: { type: Number, min: 0 },
        month: String, // For monthly fees
        period: String, // For quarterly/annual fees
      },
    ],
    installmentIndex: { type: Number, min: 0 },
    installmentName: String,

    // Transaction Details
    transactionId: String, // For online/card payments (gateway payment ID)
    chequeNumber: String, // For cheque payments
    bankName: String,

    // Payment Gateway Verification
    gatewayOrderId: String, // Order ID from payment gateway (e.g. Razorpay order_id)
    gatewaySignature: String, // Signature from gateway callback (audit trail)
    gatewayVerified: { type: Boolean, default: false }, // True if gateway signature was verified

    // Late Fee
    lateFee: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },

    // Idempotency key to prevent duplicate payments
    idempotencyKey: { type: String, index: true },

    // Status
    status: {
      type: String,
      enum: ['completed', 'pending', 'failed', 'cancelled'],
      default: 'completed',
    },

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

feePaymentSchema.index({ schoolId: 1, studentId: 1, paymentDate: -1 });
feePaymentSchema.index({ schoolId: 1, studentId: 1, academicYear: 1 });
feePaymentSchema.index({ schoolId: 1, classId: 1, academicYear: 1 });
feePaymentSchema.index({ schoolId: 1, receiptNumber: 1 }, { unique: true });
// Partial unique index: only documents with a real string idempotencyKey
// participate, so payments made without a key (null/missing) never collide.
// NOTE: MongoDB partial indexes reject `$ne` (compiles to `$not: {$eq}`), so
// we filter with `$type: 'string'` instead — `$exists: true` alone would still
// include nulls and re-introduce a null-collision. See SCH-210.
feePaymentSchema.index(
  { schoolId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);
feePaymentSchema.index({ schoolId: 1, paymentDate: -1 });
feePaymentSchema.index({ schoolId: 1, academicYear: 1, status: 1, paymentDate: -1 });

export default mongoose.model('FeePayment', feePaymentSchema);
