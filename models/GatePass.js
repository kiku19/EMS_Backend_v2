import mongoose from 'mongoose';

const gatePassSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School' },
    // Student Information
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
    },
    studentName: {
      type: String,
      required: true,
    },
    class: {
      type: String,
      required: true,
    },
    section: {
      type: String,
      required: true,
    },

    // Leave Details
    reason: {
      type: String,
      required: true,
      enum: [
        'MEDICAL_EMERGENCY',
        'FAMILY_EMERGENCY',
        'SPECIAL_EVENT',
        'EARLY_DISMISSAL',
        'SUSPENSION_EXPULSION',
        'OTHER',
      ],
    },
    otherReason: {
      type: String,
      trim: true,
    },
    leavingDate: {
      type: Date,
      required: true,
    },
    leavingTime: {
      type: String,
      required: true,
    },
    expectedReturnDate: {
      type: Date,
    },
    expectedReturnTime: {
      type: String,
    },

    // Escort Information
    leavingWith: {
      type: String,
      required: true,
      enum: ['PARENTS', 'OTHERS'],
    },

    // If leaving with Parents
    parentType: {
      type: String,
      enum: ['FATHER', 'MOTHER', 'GUARDIAN'],
    },

    // If leaving with Others
    escortName: {
      type: String,
    },
    escortRelation: {
      type: String,
    },
    escortPhone: {
      type: String,
    },
    escortIdProof: {
      type: String,
    },

    // Approval Information
    approvedBy: {
      type: String,
      required: true,
      enum: ['CLASS_TEACHER', 'FRONT_OFFICE', 'PRINCIPAL', 'OTHER'],
    },
    approvedByStaffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: true,
    },
    approvedByName: {
      type: String,
      required: true,
    },
    approvalStatus: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'],
      default: 'PENDING',
    },
    rejectionReason: {
      type: String,
    },

    // Status Tracking
    status: {
      type: String,
      enum: ['ACTIVE', 'USED', 'EXPIRED', 'CANCELLED'],
      default: 'ACTIVE',
    },

    // Exit Record (when gate pass is used)
    actualExitTime: {
      type: Date,
    },
    actualReturnTime: {
      type: Date,
    },
    whoCollected: {
      type: String,
    },
    guardianSignatureUrl: {
      type: String,
    },

    // Notifications
    notifiedParents: {
      type: Boolean,
      default: false,
    },
    notifiedTeacher: {
      type: Boolean,
      default: false,
    },
    notifiedFrontOffice: {
      type: Boolean,
      default: false,
    },
    notifiedSecurity: {
      type: Boolean,
      default: false,
    },

    // Request Information
    requestedById: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: true,
    },
    requestedByName: {
      type: String,
      required: true,
    },

    // Notes
    notes: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient queries
gatePassSchema.index({ leavingDate: -1 });
gatePassSchema.index({ approvedByStaffId: 1 });
gatePassSchema.index({ createdAt: -1 });

// Compound indexes for common queries
gatePassSchema.index({ schoolId: 1, status: 1, leavingDate: -1 });
gatePassSchema.index({ status: 1, leavingDate: -1 });
gatePassSchema.index({ approvalStatus: 1, status: 1 });
gatePassSchema.index({ studentId: 1, createdAt: -1 });

// Virtual for full leaving datetime
gatePassSchema.virtual('fullLeavingDateTime').get(function () {
  const dateTime = new Date(this.leavingDate);
  const [hours, minutes] = this.leavingTime.split(':');
  dateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
  return dateTime;
});

// Virtual for full expected return datetime
gatePassSchema.virtual('fullExpectedReturnDateTime').get(function () {
  if (!this.expectedReturnDate || !this.expectedReturnTime) return null;
  const dateTime = new Date(this.expectedReturnDate);
  const [hours, minutes] = this.expectedReturnTime.split(':');
  dateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
  return dateTime;
});

// Method to approve gate pass
gatePassSchema.methods.approve = function (approvedByStaff) {
  this.approvalStatus = 'APPROVED';
  this.approvedByStaffId = approvedByStaff._id;
  this.approvedByName = approvedByStaff.name;
  return this.save();
};

// Method to reject gate pass
gatePassSchema.methods.reject = function (reason) {
  this.approvalStatus = 'REJECTED';
  this.status = 'CANCELLED';
  this.rejectionReason = reason;
  return this.save();
};

// Method to mark as used
gatePassSchema.methods.markAsUsed = function (whoCollected, signatureUrl) {
  this.status = 'USED';
  this.actualExitTime = new Date();
  this.whoCollected = whoCollected;
  if (signatureUrl) {
    this.guardianSignatureUrl = signatureUrl;
  }
  return this.save();
};

// Method to cancel gate pass
gatePassSchema.methods.cancel = function (reason) {
  this.approvalStatus = 'CANCELLED';
  this.status = 'CANCELLED';
  this.rejectionReason = reason;
  return this.save();
};

// Static method to get active gate passes
gatePassSchema.statics.getActivePasses = function () {
  return this.find({ status: 'ACTIVE', approvalStatus: 'APPROVED' })
    .sort({ leavingDate: 1, leavingTime: 1 })
    .populate('studentId', 'name admissionId photo rollNo')
    .populate('approvedByStaffId', 'name code')
    .populate('requestedById', 'name code');
};

// Static method to get today's gate passes
gatePassSchema.statics.getTodaysPasses = function () {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  return this.find({
    leavingDate: { $gte: startOfDay, $lte: endOfDay },
  })
    .sort({ leavingDate: 1, leavingTime: 1 })
    .populate('studentId', 'name admissionId photo rollNo')
    .populate('approvedByStaffId', 'name code')
    .populate('requestedById', 'name code');
};

// Static method to get pending approvals
gatePassSchema.statics.getPendingApprovals = function (staffId) {
  const query = { approvalStatus: 'PENDING' };

  // If staffId is provided, filter by their approval type
  if (staffId) {
    query.$or = [
      { approvedBy: 'CLASS_TEACHER' },
      { approvedBy: 'FRONT_OFFICE' },
      { approvedBy: 'PRINCIPAL' },
    ];
  }

  return this.find(query)
    .sort({ leavingDate: 1, leavingTime: 1 })
    .populate('studentId', 'name admissionId photo classId')
    .populate('requestedById', 'name code');
};

// Static method to get gate passes by student
gatePassSchema.statics.getByStudent = function (studentId) {
  return this.find({ studentId })
    .sort({ createdAt: -1 })
    .populate('approvedByStaffId', 'name code')
    .populate('requestedById', 'name code');
};

const GatePass = mongoose.model('GatePass', gatePassSchema);

export default GatePass;
