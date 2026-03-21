import mongoose from 'mongoose';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

// Student Fee Structure Schema - links students to their applicable fee heads
const studentFeeStructureSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
    },
    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Class',
      required: true,
    },
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      index: true,
    },
    academicYear: { type: String, default: CURRENT_ACADEMIC_YEAR },

    // Fee heads applicable to this student
    feeHeads: [
      {
        feeHeadId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'FeeHead',
          required: true,
        },
        name: String,
        category: String,
        amount: Number,
        mandatory: Boolean,
        frequency: String,

        // Payment tracking for this fee head
        paidAmount: { type: Number, default: 0 },
        balanceAmount: { type: Number, default: 0, min: 0 },
        status: {
          type: String,
          enum: ['pending', 'partial', 'paid', 'overdue'],
          default: 'pending',
        },
      },
    ],

    // Total calculations
    totalFee: { type: Number, default: 0 },
    totalPaid: { type: Number, default: 0 },
    totalBalance: { type: Number, default: 0, min: 0 },

    // Discount
    discountApplied: { type: Number, default: 0 },
    discountReason: String,

    // Status
    overallStatus: {
      type: String,
      enum: ['pending', 'partial', 'paid', 'overdue'],
      default: 'pending',
    },

    // Last updated
    lastPaymentDate: Date,

    // Reminder tracking — used by the daily fee reminder job to avoid duplicate notifications
    lastDueReminderSentAt: Date,
    lastOverdueReminderSentAt: Date,
  },
  { timestamps: true }
);

// Index for quick lookups — include schoolId to prevent cross-school collisions in multi-tenant setups
studentFeeStructureSchema.index({ studentId: 1, academicYear: 1, schoolId: 1 }, { unique: true });

export default mongoose.model('StudentFeeStructure', studentFeeStructureSchema);
