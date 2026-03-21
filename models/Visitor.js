import mongoose from 'mongoose';

const visitorSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', index: true },
    // Basic Information
    // Support both old (name, phone) and new (visitorName, phoneNumber) field names
    name: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    visitorName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    phone: {
      type: String,
      trim: true,
    },
    phoneNumber: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    photoUrl: {
      type: String,
    },

    // Visit Details
    // Support both old (purpose) and new (reasonForVisit) field names
    purpose: {
      type: String,
      trim: true,
      enum: [
        'PARENT_MEETING',
        'STUDENT_PICKUP_DROP_OFF',
        'SCHOOL_VISIT_INQUIRY',
        'DELIVERY_VENDOR',
        'OFFICIAL_BUSINESS',
        'VOLUNTEER_EVENT',
        'OTHER',
      ],
    },
    reasonForVisit: {
      type: String,
      required: true,
      trim: true,
      enum: [
        'PARENT_MEETING',
        'STUDENT_PICKUP_DROP_OFF',
        'SCHOOL_VISIT_INQUIRY',
        'DELIVERY_VENDOR',
        'OFFICIAL_BUSINESS',
        'VOLUNTEER_EVENT',
        'OTHER',
      ],
    },

    // Check-in/Check-out Times
    checkInTime: {
      type: Date,
      required: true,
      default: Date.now,
    },
    checkOutTime: {
      type: Date,
    },

    // Status
    status: {
      type: String,
      enum: ['ACTIVE', 'CHECKED_OUT'],
      default: 'ACTIVE',
    },

    // Purpose-specific Fields
    // For Parent Meeting or Pickup/Drop-off
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
    },
    studentName: {
      type: String,
    },
    // For mapped parent visits
    parentMapping: {
      type: Boolean,
      default: false,
    },

    // For Pickup/Drop-off
    gatePassRequired: {
      type: Boolean,
      default: false,
    },
    gatePassId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GatePass',
    },

    // For Official Business/Volunteer/Event
    appointmentRequired: {
      type: Boolean,
      default: false,
    },
    appointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Appointment',
    },

    // For School Visit/Inquiry
    admissionInquiry: {
      type: Boolean,
      default: false,
    },
    admissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admission',
    },

    // Additional Information
    whomToMeet: {
      type: String,
      trim: true,
    },
    department: {
      type: String,
      trim: true,
    },

    // For Delivery/Vendor
    companyName: {
      type: String,
      trim: true,
    },
    deliveryPerson: {
      type: String,
      trim: true,
    },

    // For Other purpose
    otherPurpose: {
      type: String,
      trim: true,
    },

    // Items/Baggage declaration
    itemsDeclared: {
      type: String,
    },

    // Notes
    notes: {
      type: String,
      trim: true,
    },

    // Audit
    checkedInBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: true,
    },
    checkedOutBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
    },
  },
  {
    timestamps: true,
  }
);

// Pre-save hook to normalize field names (support both old and new naming)
visitorSchema.pre('save', function (next) {
  // If new fields are provided, use them; otherwise fall back to old fields
  if (this.visitorName) {
    this.name = this.visitorName;
  } else if (this.name) {
    this.visitorName = this.name;
  }

  if (this.phoneNumber) {
    this.phone = this.phoneNumber;
  } else if (this.phone) {
    this.phoneNumber = this.phone;
  }

  if (this.reasonForVisit) {
    this.purpose = this.reasonForVisit;
  } else if (this.purpose) {
    this.reasonForVisit = this.purpose;
  }

  next();
});

// Indexes for efficient queries - support both old and new field names
visitorSchema.index({ checkInTime: -1 });
visitorSchema.index({ studentId: 1 });
visitorSchema.index({ createdAt: -1 });

// Compound index for common queries
visitorSchema.index({ status: 1, checkInTime: -1 });
visitorSchema.index({ phone: 1, status: 1 });
visitorSchema.index({ phoneNumber: 1, status: 1 });

// Virtual for visit duration
visitorSchema.virtual('duration').get(function () {
  if (this.checkOutTime) {
    return Math.floor((this.checkOutTime - this.checkInTime) / 1000 / 60); // in minutes
  }
  return Math.floor((Date.now() - this.checkInTime) / 1000 / 60); // in minutes
});

// Method to check out visitor
visitorSchema.methods.checkOut = function (checkedOutBy, notes = '') {
  this.status = 'CHECKED_OUT';
  this.checkOutTime = new Date();
  this.checkedOutBy = checkedOutBy;
  if (notes) {
    this.notes = this.notes ? `${this.notes}\n\nCheck-out: ${notes}` : `Check-out: ${notes}`;
  }
  return this.save();
};

// Static method to get active visitors
visitorSchema.statics.getActiveVisitors = function () {
  return this.find({ status: 'ACTIVE' })
    .sort({ checkInTime: -1 })
    .populate('checkedInBy', 'name code')
    .populate('studentId', 'name admissionId rollNo classId')
    .populate('gatePassId');
};

// Static method to get today's visitors
visitorSchema.statics.getTodaysVisitors = function () {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  return this.find({
    checkInTime: { $gte: startOfDay, $lte: endOfDay },
  })
    .sort({ checkInTime: -1 })
    .populate('checkedInBy', 'name code')
    .populate('studentId', 'name admissionId rollNo classId');
};

// Static method to search visitors - supports both old and new field names
visitorSchema.statics.searchVisitors = function (searchTerm, schoolId) {
  const regex = new RegExp(searchTerm, 'i');
  const query = {
    $or: [
      { name: regex },
      { visitorName: regex },
      { phone: regex },
      { phoneNumber: regex },
      { email: regex },
      { whomToMeet: regex },
    ],
  };
  if (schoolId) {
    query.schoolId = schoolId;
  }
  return this.find(query).sort({ checkInTime: -1 }).limit(50);
};

const Visitor = mongoose.model('Visitor', visitorSchema);

export default Visitor;
