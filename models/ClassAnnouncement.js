import mongoose from 'mongoose';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

const classAnnouncementSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },

    // Target audience
    targetAudience: {
      type: String,
      enum: ['students', 'parents', 'both'],
      default: 'both',
    },

    // Priority
    priority: {
      type: String,
      enum: ['normal', 'urgent', 'critical'],
      default: 'normal',
    },

    // Attachments
    attachments: [
      {
        name: String,
        url: String,
        type: String,
      },
    ],

    // Scheduling
    scheduledFor: Date,
    sentAt: Date,

    // Sender
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true },

    // Delivery tracking
    deliveryStatus: {
      total: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      delivered: { type: Number, default: 0 },
      read: { type: Number, default: 0 },
    },

    // Recipients tracking
    recipients: [
      {
        studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
        status: {
          type: String,
          enum: ['pending', 'sent', 'delivered', 'read', 'failed'],
          default: 'pending',
        },
        sentAt: Date,
        readAt: Date,
      },
    ],

    // Academic year
    academicYear: { type: String, default: CURRENT_ACADEMIC_YEAR },
  },
  {
    timestamps: true,
  }
);

// Indexes
classAnnouncementSchema.index({ classId: 1, createdAt: -1 });
classAnnouncementSchema.index({ sentBy: 1, createdAt: -1 });
classAnnouncementSchema.index({ scheduledFor: 1 });

export default mongoose.model('ClassAnnouncement', classAnnouncementSchema);
