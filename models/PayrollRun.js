import mongoose from 'mongoose';

const payrollRunSchema = new mongoose.Schema({
  month: {
    type: Number,
    required: true,
    min: 1,
    max: 12
  },
  year: {
    type: Number,
    required: true
  },
  runDate: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'partial'],
    default: 'pending'
  },
  totalEmployees: {
    type: Number,
    default: 0
  },
  processedEmployees: {
    type: Number,
    default: 0
  },
  failedEmployees: {
    type: Number,
    default: 0
  },
  totalAmount: {
    type: Number,
    default: 0
  },
  totalPaid: {
    type: Number,
    default: 0
  },
  totalPending: {
    type: Number,
    default: 0
  },
  runBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  completedAt: Date,
  errorLog: [String],
  notes: String
}, {
  timestamps: true
});

// Compound index for unique month/year
payrollRunSchema.index({ month: 1, year: 1 }, { unique: true });

export default mongoose.model('PayrollRun', payrollRunSchema);
