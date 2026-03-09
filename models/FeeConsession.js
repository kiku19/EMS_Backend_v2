import mongoose from 'mongoose';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

const feeConcessionSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  
  discountType: { 
    type: String, 
    enum: ['percentage', 'flat'],
    required: true 
  },
  discountValue: { type: Number, required: true },
  
  applicableOn: { 
    type: String, 
    enum: ['selected_heads', 'entire_fee'],
    default: 'entire_fee'
  },
  applicableFeeHeads: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'FeeHead' 
  }],
  
  approvalRequired: { type: Boolean, default: false },
  approverRole: { 
    type: String,
    enum: ['principal', 'admin', 'accountant', 'director'],
    default: 'principal'
  },
  
  eligibilityCriteria: {
    type: { 
      type: String, 
      enum: ['sibling', 'merit', 'financial', 'staff_ward', 'sports', 'custom'],
      default: 'custom'
    },
    conditions: [{ type: String }]
  },
  
  academicYear: { type: String, required: true, default: CURRENT_ACADEMIC_YEAR },
  isActive: { type: Boolean, default: true },
  
  // Usage tracking
  appliedCount: { type: Number, default: 0 },
  totalDiscountGiven: { type: Number, default: 0 }
}, { timestamps: true });

feeConcessionSchema.index({ academicYear: 1, isActive: 1 });

export default mongoose.model('FeeConsession', feeConcessionSchema);

