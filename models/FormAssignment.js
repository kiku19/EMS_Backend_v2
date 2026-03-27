import mongoose from 'mongoose';

const formAssignmentSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    formId: { type: mongoose.Schema.Types.ObjectId, ref: 'IntakeForm', required: true },
    assignedToEmail: String,
    assignedToPhone: String,
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    status: { type: String, default: 'pending' }, // 'pending', 'in_progress', 'submitted', 'approved', 'rejected'
    accessToken: { type: String, unique: true, required: true },
    expiresAt: Date,
    assignedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

formAssignmentSchema.index({ schoolId: 1, status: 1, assignedAt: -1 });

export default mongoose.model('FormAssignment', formAssignmentSchema);
