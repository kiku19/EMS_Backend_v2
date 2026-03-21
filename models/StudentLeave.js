import mongoose from 'mongoose';

const studentLeaveSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    appliedByParentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Parent', required: true },

    leaveType: {
      type: String,
      enum: ['sick', 'personal', 'family', 'other'],
      required: true,
    },
    reason: { type: String, required: true },

    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    days: { type: Number, required: true },

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'cancelled'],
      default: 'pending',
    },

    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    reviewedAt: Date,
    rejectionReason: String,
    adminRemarks: String,

    appliedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

studentLeaveSchema.index({ schoolId: 1, studentId: 1, status: 1, appliedAt: -1 });
studentLeaveSchema.index({ schoolId: 1, appliedByParentId: 1, appliedAt: -1 });

export default mongoose.model('StudentLeave', studentLeaveSchema);
