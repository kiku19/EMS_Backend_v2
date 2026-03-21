import mongoose from 'mongoose';

const activityLogSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School' },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
    activityType: {
      type: String,
      required: true,
      enum: [
        'student_added',
        'student_removed',
        'student_deleted',
        'student_transferred',
        'attendance_marked',
        'remark_added',
        'fee_paid',
        'fee_pending',
        'timetable_changed',
        'subject_assigned',
        'teacher_changed',
        'announcement_sent',
        'class_promoted',
        'concession_applied',
        'concession_approved',
        'concession_rejected',
        'strength_changed',
        'substitution_assigned',
        'other',
      ],
    },
    description: { type: String, required: true },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient queries
activityLogSchema.index({ schoolId: 1, classId: 1, createdAt: -1 });
activityLogSchema.index({ activityType: 1, createdAt: -1 });
activityLogSchema.index({ performedBy: 1, createdAt: -1 });

export default mongoose.model('ActivityLog', activityLogSchema);
