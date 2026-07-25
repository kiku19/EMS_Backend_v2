import mongoose from 'mongoose';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

const feeStructureSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    academicYear: { type: String, required: true, default: CURRENT_ACADEMIC_YEAR },
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'FeeTemplate' },

    feeHeads: [
      {
        // Opaque identifier: custom class heads are not catalogue documents.
        feeHeadId: { type: mongoose.Schema.Types.ObjectId },
        name: String,
        category: String,
        amount: { type: Number, min: 0 },
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
          amount: { type: Number, min: 0 },
          status: {
            type: String,
            enum: ['pending', 'partial', 'paid', 'overdue'],
            default: 'pending',
          },
        },
      ],
    },

    totalAnnualFee: { type: Number, min: 0 },
    isCustomized: { type: Boolean, default: false },
    appliedDate: Date,
    appliedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student' }],
  },
  { timestamps: true }
);

feeStructureSchema.index({ schoolId: 1, classId: 1, academicYear: 1 }, { unique: true });

export default mongoose.model('FeeStructure', feeStructureSchema);
