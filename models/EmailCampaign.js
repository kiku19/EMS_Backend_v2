import mongoose from 'mongoose';

const recipientSchema = new mongoose.Schema(
  {
    email: { type: String, required: true },
    parentName: String,
    studentName: String,
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Parent' },
    status: {
      type: String,
      enum: ['pending', 'sent', 'delivered', 'failed', 'bounced'],
      default: 'pending',
    },
    sentAt: Date,
    openedAt: Date,
    clickedAt: Date,
    bouncedAt: Date,
    openCount: { type: Number, default: 0 },
    clickCount: { type: Number, default: 0 },
    error: String,
  },
  { _id: false }
);

const emailCampaignSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    htmlBody: {
      type: String,
      required: true,
    },
    textBody: String,

    // Target group criteria
    targetCriteria: {
      groupType: {
        type: String,
        enum: ['all_parents', 'by_class', 'fee_defaulters', 'attendance_below'],
        required: true,
        default: 'all_parents',
      },
      // For by_class: filter parents of students in these classes
      classIds: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Class',
        },
      ],
      // For fee_defaulters: filter by fee overall status
      feeStatus: {
        type: String,
        enum: ['pending', 'partial'],
        default: 'pending',
      },
      // For attendance_below: attendance percentage threshold
      attendanceThreshold: {
        type: Number,
        min: 0,
        max: 100,
        default: 75,
      },
      // Academic year scoping
      academicYear: String,
    },

    status: {
      type: String,
      enum: ['draft', 'scheduled', 'sending', 'sent', 'failed', 'partial'],
      default: 'draft',
      index: true,
    },

    scheduledFor: Date,

    // Resolved recipients (populated at send time)
    recipients: [recipientSchema],

    // Analytics summary
    analytics: {
      totalRecipients: { type: Number, default: 0 },
      sentCount: { type: Number, default: 0 },
      deliveredCount: { type: Number, default: 0 },
      failedCount: { type: Number, default: 0 },
      openCount: { type: Number, default: 0 },
      clickCount: { type: Number, default: 0 },
      bounceCount: { type: Number, default: 0 },
      openRate: { type: Number, default: 0 },
      clickRate: { type: Number, default: 0 },
      bounceRate: { type: Number, default: 0 },
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: true,
    },

    sentAt: Date,
    completedAt: Date,
  },
  {
    timestamps: true,
  }
);

emailCampaignSchema.index({ schoolId: 1, status: 1, createdAt: -1 });
emailCampaignSchema.index({ schoolId: 1, scheduledFor: 1, status: 1 });
emailCampaignSchema.index({ createdBy: 1 });

export default mongoose.model('EmailCampaign', emailCampaignSchema);
