import mongoose from 'mongoose';

const salaryTemplateSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    name: { type: String, required: true, trim: true },
    breakdown: [
      {
        component: { type: String, required: true, trim: true },
        amount: { type: Number, required: true, min: 0 },
      },
    ],
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

salaryTemplateSchema.index({ schoolId: 1, name: 1, isDeleted: 1 }, { unique: true });

export default mongoose.model('SalaryTemplate', salaryTemplateSchema);
