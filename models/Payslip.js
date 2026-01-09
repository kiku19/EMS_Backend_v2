import mongoose from 'mongoose';

const payslipSchema = new mongoose.Schema({
  payrollRecordId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PayrollRecord',
    required: true,
    unique: true
  },
  employeeId: {
    type: String,
    required: true,
    index: true
  },
  month: {
    type: Number,
    required: true
  },
  year: {
    type: Number,
    required: true
  },
  payslipNumber: {
    type: String,
    required: true,
    unique: true
  },
  filePath: String,
  fileUrl: String,
  generatedAt: {
    type: Date,
    default: Date.now
  },
  downloadCount: {
    type: Number,
    default: 0
  },
  lastDownloadedAt: Date
}, {
  timestamps: true
});

payslipSchema.index({ employeeId: 1, month: 1, year: 1 });

export default mongoose.model('Payslip', payslipSchema);
