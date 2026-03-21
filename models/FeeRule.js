import mongoose from 'mongoose';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

const feeRuleSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    academicYear: { type: String, required: true, default: CURRENT_ACADEMIC_YEAR },

    newAdmission: {
      feeCalculation: {
        type: String,
        enum: ['total', 'prorated'],
        default: 'total',
      },
      prorateFrom: {
        type: String,
        enum: ['admission_date', 'month_start', 'quarter_start'],
        default: 'admission_date',
      },
      prorateMethod: {
        type: String,
        enum: ['monthly', 'daily'],
        default: 'monthly',
      },
    },

    validTill: {
      type: {
        type: String,
        enum: ['academic_year', 'specific_date', 'indefinite'],
        default: 'academic_year',
      },
      date: String, // If specific_date
    },

    editApprovalControls: {
      feeHeadEdit: {
        requiresApproval: { type: Boolean, default: true },
        approverRole: {
          type: String,
          enum: ['principal', 'admin', 'director'],
          default: 'principal',
        },
      },
      concessionApproval: {
        requiresApproval: { type: Boolean, default: true },
        approverRole: {
          type: String,
          enum: ['principal', 'admin', 'director'],
          default: 'principal',
        },
      },
      feeWaiver: {
        requiresApproval: { type: Boolean, default: true },
        approverRole: {
          type: String,
          enum: ['principal', 'director'],
          default: 'director',
        },
        maxAmountWithoutApproval: { type: Number, default: 0 },
      },
    },

    // Additional rules
    allowPartialPayment: { type: Boolean, default: true },
    minimumPartialPaymentPercent: { type: Number, default: 0 },

    refundPolicy: {
      enabled: { type: Boolean, default: false },
      refundableHeads: [{ type: mongoose.Schema.Types.ObjectId, ref: 'FeeHead' }],
      processingDays: { type: Number, default: 7 },
    },
  },
  { timestamps: true }
);

// Ensure only one rule per school per academic year
feeRuleSchema.index({ schoolId: 1, academicYear: 1 }, { unique: true });

export default mongoose.model('FeeRule', feeRuleSchema);
