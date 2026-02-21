import mongoose from 'mongoose';

const reminderLogSchema = new mongoose.Schema({
  reminderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Reminder',
    required: true
  },
  recipientId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  recipientType: {
    type: String,
    enum: ['Staff', 'Student', 'Parent'],
    required: true
  },

  // Delivery status per channel
  channels: [{
    channel: {
      type: String,
      enum: ['email', 'sms', 'whatsapp', 'inapp']
    },
    status: {
      type: String,
      enum: ['sent', 'delivered', 'read', 'failed'],
      default: 'sent'
    },
    sentAt: {
      type: Date,
      default: Date.now
    },
    error: String,
    messageId: String
  }],

  // Trigger data that caused this reminder
  triggerData: mongoose.Schema.Types.Mixed,

  // Overall status
  status: {
    type: String,
    enum: ['sent', 'delivered', 'read', 'failed'],
    default: 'sent'
  }
}, {
  timestamps: true
});

// Indexes
reminderLogSchema.index({ reminderId: 1 });
reminderLogSchema.index({ recipientId: 1 });
reminderLogSchema.index({ createdAt: -1 });

export default mongoose.model('ReminderLog', reminderLogSchema);
