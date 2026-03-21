import mongoose from 'mongoose';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

const feeTemplateSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', index: true },
    name: { type: String, required: true },
    description: String,
    section: { type: String, required: true },
    applicableFor: [
      {
        classGrade: String,
        applicable: Boolean,
      },
    ],

    feeHeads: [
      {
        name: { type: String, required: true },
        category: {
          type: String,
          enum: ['Academic', 'Transport', 'Extra-curricular', 'Hostel', 'Other'],
          default: 'Academic',
        },
        amount: { type: Number, required: true },
        frequency: {
          type: String,
          enum: ['monthly', 'quarterly', 'term', 'yearly', 'one-time'],
          default: 'yearly',
        },
        mandatory: { type: Boolean, default: true },
        applicableTerms: [Number],
        dueDay: { type: Number, default: 10 },
        refundable: { type: Boolean, default: false },
      },
    ],

    totalAnnualFee: { type: Number, required: true },
    discounts: [
      {
        name: String,
        percentage: Number,
        conditions: String,
      },
    ],
    isActive: { type: Boolean, default: true },
    academicYear: { type: String, default: CURRENT_ACADEMIC_YEAR },
    // Multi-branch: group-level template shared across branches (set when isGroupTemplate=true)
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SchoolGroup',
      default: null,
      index: true,
    },
    isGroupTemplate: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model('FeeTemplate', feeTemplateSchema);
