import mongoose from 'mongoose';

const feedbackSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    phoneNumber: String,
    date: { type: String, default: () => new Date().toISOString().split('T')[0] },
    category: {
      type: String,
      enum: [
        'STAFF',
        'FACILITIES',
        'MANAGEMENT',
        'ACADEMIC',
        'ADMINISTRATIVE',
        'FACILITY',
        'SUGGESTION',
        'COMPLAINT',
        'OTHER',
      ],
      required: true,
    },
    assignedStaff: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    notifyStaff: { type: Boolean, default: false },
    status: { type: String, default: 'open', enum: ['open', 'in_progress', 'resolved', 'closed'] },
    notes: String,
  },
  { timestamps: true }
);

export default mongoose.model('Feedback', feedbackSchema);
