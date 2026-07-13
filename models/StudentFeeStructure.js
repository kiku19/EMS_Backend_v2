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
      required: true,
      index: true,
    },
    academicYear: { type: String, required: true, default: CURRENT_ACADEMIC_YEAR },

    // Fee heads applicable to this student
    feeHeads: [
      {
        feeHeadId: {
          type: mongoose.Schema.Types.ObjectId,
          required: true,
        },
        name: String,
        category: String,
        baseAmount: { type: Number, min: 0 },
        amount: { type: Number, min: 0 },
        mandatory: Boolean,
        frequency: String,
        applicableTerms: [{ type: Number }],
        dueDay: { type: Number, min: 1, max: 31 },
        refundable: { type: Boolean, default: false },

        // Payment tracking for this fee head
        paidAmount: { type: Number, default: 0, min: 0 },
        balanceAmount: { type: Number, default: 0, min: 0 },
        status: {
          type: String,
          enum: ['pending', 'partial', 'paid', 'overdue'],
          default: 'pending',
        },
      },
    ],

    installments: [
      {
        name: { type: String, required: true },
        dueDate: Date,
        amount: { type: Number, required: true, min: 0 },
        paidAmount: { type: Number, default: 0, min: 0 },
        balanceAmount: { type: Number, default: 0, min: 0 },
        status: {
          type: String,
          enum: ['pending', 'partial', 'paid', 'overdue'],
          default: 'pending',
        },
      },
    ],

    // Total calculations
    totalFee: { type: Number, default: 0, min: 0 },
    totalPaid: { type: Number, default: 0, min: 0 },
    totalBalance: { type: Number, default: 0, min: 0 },

    // Discount
    discountApplied: { type: Number, default: 0, min: 0 },
    discountReason: String,

    // Status
    overallStatus: {
      type: String,
      enum: ['pending', 'partial', 'paid', 'overdue'],
      default: 'pending',
    },

    // Overall due date used by the shared status calculator to distinguish
    // pending balances from genuinely overdue balances.
    dueDate: Date,

    // Last updated
    lastPaymentDate: Date,

    // Reminder tracking — used by the daily fee reminder job to avoid duplicate notifications
    lastDueReminderSentAt: Date,
    lastOverdueReminderSentAt: Date,
    // How many overdue reminders have been sent (capped by FeeReminderConfig.overdueReminder.maxReminders)
    overdueReminderCount: { type: Number, default: 0 },
    // Incremented when refund approval acquires the per-student reservation
    // lock. The value itself is not business data; it creates a write conflict
    // so concurrent approvals re-run their refundable-balance check.
    refundReservationVersion: { type: Number, default: 0 },
  },
  { timestamps: true, optimisticConcurrency: true }
);

// Index for quick lookups — include schoolId to prevent cross-school collisions in multi-tenant setups
studentFeeStructureSchema.index({ schoolId: 1, studentId: 1, academicYear: 1 }, { unique: true });

export default mongoose.model('StudentFeeStructure', studentFeeStructureSchema);
