import mongoose from 'mongoose';

const staffAttendanceSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: true,
    },
    date: {
      type: String,
      required: true,
    }, // Format: YYYY-MM-DD
    status: {
      type: String,
      enum: ['present', 'absent', 'leave', 'halfday', 'unmarked'],
      default: 'unmarked',
    },
    checkInTime: String,
    checkOutTime: String,
    reason: String, // For absent, leave, halfday

    // Mobile app integration fields
    checkInLocation: {
      latitude: Number,
      longitude: Number,
      address: String,
    },
    checkOutLocation: {
      latitude: Number,
      longitude: Number,
      address: String,
    },
    checkInMethod: {
      type: String,
      enum: ['manual', 'mobile', 'biometric', 'admin'],
      default: 'manual',
    },
    checkOutMethod: {
      type: String,
      enum: ['manual', 'mobile', 'biometric', 'admin'],
      default: 'manual',
    },

    // Leave application (from mobile app)
    leaveApplication: {
      appliedAt: Date,
      leaveType: {
        type: String,
        enum: ['sick', 'casual', 'earned', 'maternity', 'paternity', 'unpaid', 'other'],
      },
      startDate: String,
      endDate: String,
      numberOfDays: Number,
      approvalStatus: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending',
      },
      approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
      approvedAt: Date,
      rejectionReason: String,
    },

    // Regularization (from admin dashboard)
    regularization: {
      regularizedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
      regularizedAt: Date,
      previousStatus: String,
      regularizationReason: String,
    },

    // Metadata
    markedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  },
  { timestamps: true }
);

// Compound index for efficient queries
staffAttendanceSchema.index({ schoolId: 1, staffId: 1, date: 1 }, { unique: true });
staffAttendanceSchema.index({ date: 1 });
staffAttendanceSchema.index({ status: 1 });

export default mongoose.model('StaffAttendance', staffAttendanceSchema);
