import mongoose from 'mongoose';

const teacherLeaveSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true },

    // Leave details
    leaveType: {
      type: String,
      required: true,
    },
    reason: { type: String, required: true },

    // Date range
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    days: { type: Number, required: true }, // Number of days

    // Leave status workflow
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'cancelled'],
      default: 'pending',
    },

    // Approval workflow
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    approvedAt: Date,
    rejectionReason: String,

    // Substitution assignments (if any)
    substitutions: [
      {
        date: String,
        classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
        period: String,
        substituteTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
      },
    ],

    // Attachments (medical certificates, etc.)
    attachments: [
      {
        name: String,
        url: String,
      },
    ],

    // Remarks
    adminRemarks: String,

    // Application timestamp (distinct from createdAt — when the leave was formally applied)
    appliedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Indexes for efficient queries
teacherLeaveSchema.index({ schoolId: 1, teacherId: 1, status: 1, appliedAt: -1 });
teacherLeaveSchema.index({ schoolId: 1, status: 1, appliedAt: -1 });

export default mongoose.model('TeacherLeave', teacherLeaveSchema);
