import mongoose from 'mongoose';

const emailTemplateSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: [
        'welcome',
        'fee_reminder',
        'attendance_alert',
        'announcement',
        'exam_result',
        'custom',
      ],
      required: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    htmlBody: {
      type: String,
      required: true,
    },
    textBody: {
      type: String,
      default: '',
    },
    variables: [
      {
        type: String,
        trim: true,
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
    },
    versions: [
      {
        subject: { type: String },
        htmlBody: { type: String },
        textBody: { type: String },
        savedAt: { type: Date, default: Date.now },
        savedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
      },
    ],
  },
  {
    timestamps: true,
  }
);

emailTemplateSchema.index({ schoolId: 1, type: 1 });
emailTemplateSchema.index({ schoolId: 1, name: 1 }, { unique: true });
emailTemplateSchema.index({ schoolId: 1, isDefault: 1 });

export default mongoose.model('EmailTemplate', emailTemplateSchema);
