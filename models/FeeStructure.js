import mongoose from 'mongoose';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

const feeStructureSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School' },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    academicYear: { type: String, default: CURRENT_ACADEMIC_YEAR },
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'FeeTemplate' },

    feeHeads: [
      {
        name: String,
        category: String,
        amount: Number,
        frequency: String,
        mandatory: { type: Boolean, default: true },
        applicableTerms: [Number],
        dueDay: Number,
        refundable: Boolean,
      },
    ],

    collectionSchedule: {
      mode: {
        type: String,
        enum: ['term', 'monthly', 'quarterly', 'yearly', 'custom'],
        default: 'term',
      },
      installments: [
        {
          name: String,
          dueDate: String,
          amount: Number,
          status: {
            type: String,
            enum: ['pending', 'partial', 'paid', 'overdue'],
            default: 'pending',
          },
        },
      ],
    },

    totalAnnualFee: Number,
    isCustomized: { type: Boolean, default: false },
    appliedDate: Date,
    appliedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student' }],
  },
  { timestamps: true }
);

feeStructureSchema.index({ schoolId: 1, classId: 1, academicYear: 1 }, { unique: true });

export default mongoose.model('FeeStructure', feeStructureSchema);
