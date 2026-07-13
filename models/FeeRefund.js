import mongoose from 'mongoose';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

const feeRefundSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    academicYear: { type: String, required: true, default: CURRENT_ACADEMIC_YEAR },
    refundNumber: { type: String, required: true },

    // Refund Details
    refundDate: { type: String, required: true },
    amount: { type: Number, required: true, min: 0.01 },
    reason: { type: String, required: true },

    // Original Payment Reference
    originalPaymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'FeePayment' },

    // Refund Method. Kept in sync with the Zod paymentModeEnum
    // (validators/feeSchema.js): online refunds (parent-app Razorpay flow)
    // legitimately use online/card/upi, so all payment modes are accepted.
    refundMode: {
      type: String,
      required: true,
      enum: ['cash', 'cheque', 'dd', 'bank_transfer', 'online', 'card', 'upi'],
    },
    transactionId: String,
    chequeNumber: String,
    bankName: String,
    accountNumber: String,

    // Approval Workflow
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    requestedAt: { type: Date, default: Date.now },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    approvedAt: Date,
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    processedAt: Date,

    // Status
    status: {
      type: String,
      enum: ['pending', 'approved', 'processed', 'rejected'],
      default: 'pending',
    },

    // Notes
    remarks: String,
    rejectionReason: String,
  },
  { timestamps: true }
);

feeRefundSchema.index({ schoolId: 1, studentId: 1, academicYear: 1, refundDate: -1 });
feeRefundSchema.index({ schoolId: 1, academicYear: 1, status: 1, refundDate: -1 });
feeRefundSchema.index({ schoolId: 1, refundNumber: 1 }, { unique: true });
feeRefundSchema.index({ schoolId: 1, originalPaymentId: 1, status: 1 });

export default mongoose.model('FeeRefund', feeRefundSchema);
