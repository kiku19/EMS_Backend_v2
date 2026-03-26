import mongoose from 'mongoose';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

const feeRefundSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    academicYear: { type: String, default: CURRENT_ACADEMIC_YEAR },
    refundNumber: { type: String, required: true },

    // Refund Details
    refundDate: { type: String, required: true },
    amount: { type: Number, required: true },
    reason: { type: String, required: true },

    // Original Payment Reference
    originalPaymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'FeePayment' },

    // Refund Method
    refundMode: { type: String, required: true, enum: ['cash', 'cheque', 'bank_transfer'] },
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
    status: { type: String, default: 'pending' }, // 'pending', 'approved', 'processed', 'rejected'

    // Notes
    remarks: String,
    rejectionReason: String,
  },
  { timestamps: true }
);

feeRefundSchema.index({ studentId: 1, refundDate: 1 });
feeRefundSchema.index({ schoolId: 1, refundNumber: 1 }, { unique: true });

export default mongoose.model('FeeRefund', feeRefundSchema);
