import mongoose from 'mongoose';

const reminderTemplateSchema = new mongoose.Schema(
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
    },
    type: {
      type: String,
      enum: ['fee', 'attendance', 'academic', 'events', 'custom'],
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    // Available variables in template (e.g., {student_name}, {fee_amount})
    variables: [
      {
        type: String,
      },
    ],
    defaultChannels: [
      {
        type: String,
        enum: ['email', 'sms', 'whatsapp', 'inapp'],
      },
    ],
    isDefault: {
      type: Boolean,
      default: false,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
    },

    // For organization
    category: String,
    description: String,
  },
  {
    timestamps: true,
  }
);

// Indexes
reminderTemplateSchema.index({ schoolId: 1, name: 1 }, { unique: true });
reminderTemplateSchema.index({ type: 1 });
reminderTemplateSchema.index({ isDefault: 1 });
reminderTemplateSchema.index({ createdBy: 1 });

export default mongoose.model('ReminderTemplate', reminderTemplateSchema);
