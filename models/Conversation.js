import mongoose from 'mongoose';

const participantSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: 'participants.userModel',
    },
    userModel: {
      type: String,
      required: true,
      enum: ['Staff', 'Student', 'Parent'],
    },
    name: String,
    avatar: String,
    role: String,
    unreadCount: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const conversationSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },
    participants: [participantSchema],
    type: {
      type: String,
      enum: ['direct', 'group'],
      default: 'direct',
    },
    groupName: String,
    groupAvatar: String,
    groupAdmins: [
      {
        type: mongoose.Schema.Types.ObjectId,
      },
    ],
    lastMessage: mongoose.Schema.Types.Mixed,
    isArchived: {
      type: Boolean,
      default: false,
    },
    archivedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
      },
    ],
    mutedBy: [
      {
        userId: mongoose.Schema.Types.ObjectId,
        mutedUntil: Date,
      },
    ],

    // NEW: Pinned conversations
    pinnedBy: [
      {
        userId: mongoose.Schema.Types.ObjectId,
        pinnedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // NEW: Pinned messages in this conversation
    pinnedMessages: [
      {
        messageId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Message',
        },
        pinnedBy: mongoose.Schema.Types.ObjectId,
        pinnedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // NEW: Deleted conversations
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        deletedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Indexes
conversationSchema.index({ schoolId: 1, 'participants.userId': 1 });
conversationSchema.index({ schoolId: 1, 'lastMessage.timestamp': -1 });
conversationSchema.index({ schoolId: 1, type: 1 });

// Method to find or create conversation between two users
conversationSchema.statics.findOrCreate = async function (
  user1Id,
  user1Model,
  user2Id,
  user2Model,
  schoolId
) {
  // Check if conversation exists within the same school
  let conversation = await this.findOne({
    schoolId,
    type: 'direct',
    'participants.userId': { $all: [user1Id, user2Id] },
    participants: { $size: 2 },
  });

  if (!conversation) {
    // Create new conversation
    conversation = await this.create({
      schoolId,
      type: 'direct',
      participants: [
        { userId: user1Id, userModel: user1Model },
        { userId: user2Id, userModel: user2Model },
      ],
    });
  }

  return conversation;
};

// Method to increment unread count for a user
conversationSchema.methods.incrementUnread = async function (userId) {
  const participant = this.participants.find((p) => p.userId.toString() === userId.toString());
  if (participant) {
    participant.unreadCount += 1;
    await this.save();
  }
};

// Method to reset unread count for a user
conversationSchema.methods.resetUnread = async function (userId) {
  const participant = this.participants.find((p) => p.userId.toString() === userId.toString());
  if (participant) {
    participant.unreadCount = 0;
    await this.save();
  }
};

export default mongoose.model('Conversation', conversationSchema);
