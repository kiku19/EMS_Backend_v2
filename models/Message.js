import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true
  },
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'senderModel'
  },
  senderModel: {
    type: String,
    required: true,
    enum: ['Staff', 'Student']
  },
  receiverId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'receiverModel'
  },
  receiverModel: {
    type: String,
    required: true,
    enum: ['Staff', 'Student']
  },
  content: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['text', 'image', 'file', 'audio', 'video'],
    default: 'text'
  },
  fileUrl: String,
  fileName: String,
  fileSize: Number,
  status: {
    type: String,
    enum: ['sent', 'delivered', 'read'],
    default: 'sent'
  },
  readAt: Date,
  deliveredAt: Date,
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedFor: [{
    type: mongoose.Schema.Types.ObjectId
  }],
  replyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },

  // NEW: Message editing
  isEdited: {
    type: Boolean,
    default: false
  },
  editHistory: [{
    content: String,
    editedAt: {
      type: Date,
      default: Date.now
    },
    editedBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    }
  }],

  // NEW: Message reactions
  reactions: [{
    emoji: {
      type: String,
      required: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    userModel: {
      type: String,
      enum: ['Staff', 'Student'],
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],

  // NEW: Forward message support
  forwardedFrom: {
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message'
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation'
    },
    forwardedBy: {
      type: mongoose.Schema.Types.ObjectId
    },
    originalSenderName: String
  },

  // NEW: Pinned messages
  pinned: {
    type: Boolean,
    default: false
  },
  pinnedBy: [{
    type: mongoose.Schema.Types.ObjectId
  }],

  // NEW: Voice message support
  duration: {
    type: Number,
    default: 0 // in seconds
  },
  waveform: {
    type: [Number], // Array of numbers for visualization
    default: []
  }
}, {
  timestamps: true
});

// Indexes for performance
messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ senderId: 1, receiverId: 1 });
messageSchema.index({ status: 1 });

export default mongoose.model('Message', messageSchema);
