import mongoose from 'mongoose';

const payslipSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },
    payrollRecordId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PayrollRecord',
      required: true,
      unique: true,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: true,
      index: true,
    },
    month: {
      type: Number,
      required: true,
    },
    year: {
      type: Number,
      required: true,
    },
    payslipNumber: {
      type: String,
      required: true,
    },
    filePath: String,
    fileUrl: String,
    generatedAt: {
      type: Date,
      default: Date.now,
    },
    downloadCount: {
      type: Number,
      default: 0,
    },
    lastDownloadedAt: Date,
  },
  {
    timestamps: true,
  }
);

payslipSchema.index({ employeeId: 1, month: 1, year: 1 });
payslipSchema.index({ schoolId: 1, payslipNumber: 1 }, { unique: true });

export default mongoose.model('Payslip', payslipSchema);
