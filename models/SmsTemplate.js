import mongoose from 'mongoose';

const smsTemplateSchema = new mongoose.Schema(
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
        'fee_reminder',
        'attendance_alert',
        'announcement',
        'exam_result',
        'welcome',
        'otp',
        'custom',
      ],
      required: true,
    },
    body: {
      type: String,
      required: true,
      maxlength: 1600,
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
  },
  {
    timestamps: true,
  }
);

smsTemplateSchema.index({ schoolId: 1, type: 1 });
smsTemplateSchema.index({ schoolId: 1, name: 1 }, { unique: true });

export default mongoose.model('SmsTemplate', smsTemplateSchema);
