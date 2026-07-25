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
    // Stable dedup key for direct (2-participant) conversations within a
    // school: `${schoolId}:${min(userId)}:${max(userId)}`. Backs the unique
    // partial index below so concurrent findOrCreate calls that both miss the
    // existing row produce exactly one document instead of duplicates.
    // NOTE: no field-level `index: true` here — the authoritative index is the
    // compound partial unique index declared via schema.index() below. Declaring
    // both produces a redundant non-unique index (Mongoose "duplicate index" warning).
    participantKey: {
      type: String,
    },
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
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          required: true,
        },
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
// Backing unique index for the findOrCreate dedup race. Only applies to
// direct, two-participant conversations (the only ones participantKey is set
// on), so group conversations are unaffected.
conversationSchema.index(
  { participantKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      type: 'direct',
      participantKey: { $type: 'string', $nin: [null, ''] },
    },
  }
);

// Method to find or create conversation between two users.
// Handles the race where two concurrent callers both miss the existing
// conversation and both try to insert: the second insert is caught and
// we re-read the winning row. Previously this created duplicate direct
// conversations between the same pair.
conversationSchema.statics.findOrCreate = async function (
  user1Id,
  user1Model,
  user2Id,
  user2Model,
  schoolId
) {
  // Order-independent key so (A,B) and (B,A) resolve to the same conversation.
  // schoolId is included because the same user pair in two different tenants
  // must keep separate conversations.
  const sortedIds = [String(user1Id), String(user2Id)].sort();
  const participantKey = `${String(schoolId)}:${sortedIds[0]}:${sortedIds[1]}`;

  const findFilter = {
    schoolId,
    type: 'direct',
    participantKey,
  };

  let conversation = await this.findOne(findFilter);
  if (conversation) return conversation;

  try {
    conversation = await this.create({
      schoolId,
      type: 'direct',
      participantKey,
      participants: [
        { userId: user1Id, userModel: user1Model },
        { userId: user2Id, userModel: user2Model },
      ],
    });
    return conversation;
  } catch (err) {
    // Concurrent creator won — re-read to return their doc.
    if (err?.code === 11000) {
      const winner = await this.findOne(findFilter);
      if (winner) return winner;
    }
    throw err;
  }
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
