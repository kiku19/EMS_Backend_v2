import mongoose from 'mongoose';

const lateFeeRuleSchema = new mongoose.Schema({
  academicYear: { type: String, required: true, default: '2024-25' },
  enabled: { type: Boolean, default: false },
  gracePeriod: { type: Number, default: 0 },  // Days after due date
  
  fineType: { 
    type: String, 
    enum: ['per_day', 'slab', 'flat'],
    required: true,
    default: 'flat'
  },
  
  // For per_day type
  perDayAmount: { type: Number, default: 0 },
  
  // For slab type
  slabs: [{
    fromDay: { type: Number, required: true },
    toDay: { type: Number, required: true },
    amount: { type: Number, required: true }
  }],
  
  // For flat type
  flatAmount: { type: Number, default: 0 },
  
  maximumCap: { type: Number },  // Optional maximum late fee
  
  applicableFeeHeads: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'FeeHead' 
  }],  // Empty array means all fee heads
  
  description: String
}, { timestamps: true });

// Ensure only one rule per academic year
lateFeeRuleSchema.index({ academicYear: 1 }, { unique: true });

export default mongoose.model('LateFeeRule', lateFeeRuleSchema);
