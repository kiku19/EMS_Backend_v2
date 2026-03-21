import mongoose from 'mongoose';

const intakeFormSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    formName: { type: String, required: true },
    formType: { type: String, default: 'staff' }, // 'staff', 'student', 'parent'
    fields: { type: mongoose.Schema.Types.Mixed, default: [] }, // Store as flexible array of objects
    status: { type: String, default: 'active' }, // 'active', 'inactive', 'archived'
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  },
  { timestamps: true, strict: false }
);

intakeFormSchema.index({ schoolId: 1, status: 1, createdAt: -1 });

export default mongoose.model('IntakeForm', intakeFormSchema);
