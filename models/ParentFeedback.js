import mongoose from 'mongoose';

const parentFeedbackSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Parent', required: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', default: null },
    category: {
      type: String,
      enum: ['general', 'academic', 'facilities', 'staff', 'transport', 'fees', 'other'],
      required: true,
    },
    subject: { type: String, required: true, trim: true, maxlength: 200 },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    status: {
      type: String,
      enum: ['pending', 'in-review', 'resolved', 'closed'],
      default: 'pending',
    },
    response: { type: String, trim: true, maxlength: 2000, default: null },
  },
  { timestamps: true }
);

parentFeedbackSchema.index({ schoolId: 1, parentId: 1, createdAt: -1 });

export default mongoose.model('ParentFeedback', parentFeedbackSchema);
