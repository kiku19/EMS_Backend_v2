import mongoose from 'mongoose';

// Student Fee Structure Schema - links students to their applicable fee heads
const studentFeeStructureSchema = new mongoose.Schema({
  studentId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Student', 
    required: true 
  },
  classId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Class', 
    required: true 
  },
  academicYear: { type: String, default: '2024-25' },
  
  // Fee heads applicable to this student
  feeHeads: [{
    feeHeadId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'FeeHead', 
      required: true 
    },
    name: String,
    category: String,
    amount: Number,
    mandatory: Boolean,
    frequency: String,
    
    // Payment tracking for this fee head
    paidAmount: { type: Number, default: 0 },
    balanceAmount: { type: Number, default: 0 },
    status: { 
      type: String, 
      enum: ['pending', 'partial', 'paid'], 
      default: 'pending' 
    },
  }],
  
  // Total calculations
  totalFee: { type: Number, default: 0 },
  totalPaid: { type: Number, default: 0 },
  totalBalance: { type: Number, default: 0 },
  
  // Discount
  discountApplied: { type: Number, default: 0 },
  discountReason: String,
  
  // Status
  overallStatus: { 
    type: String, 
    enum: ['pending', 'partial', 'paid'], 
    default: 'pending' 
  },
  
  // Last updated
  lastPaymentDate: Date,
}, { timestamps: true });

// Index for quick lookups
studentFeeStructureSchema.index({ studentId: 1, academicYear: 1 }, { unique: true });

export default mongoose.model('StudentFeeStructure', studentFeeStructureSchema);
