import express from 'express';
import Message from '../models/Message.js';
import Conversation from '../models/Conversation.js';
import UserPresence from '../models/UserPresence.js';
import Parent from '../models/Parent.js';
import { Staff, Student } from '../database.js';
import {
  hasPermission,
  canMessageUser,
  getUserChatPermissions,
  CHAT_PERMISSIONS,
} from '../middleware/chatPermissions.js';
import { authenticate } from '../middleware/auth.js';
import { createLogger } from '../utils/logger.js';
import { sendMessageSchema, editMessageSchema } from '../validators/messagingSchema.js';

const router = express.Router();
router.use(authenticate);
const logger = createLogger('Messages');

// Get unread count for a user — derived from session
router.get('/unread-count', async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    const schoolId = req.user.schoolId;

    // Find all conversations for this user (exclude deleted)
    const conversations = await Conversation.find({
      schoolId,
      'participants.userId': userId,
      isArchived: false,
      isDeleted: { $ne: true },
      'deletedBy.userId': { $ne: userId },
    }).lean();

    // Calculate total unread count
    let totalUnread = 0;
    conversations.forEach((conv) => {
      const participant = conv.participants.find((p) => p.userId.toString() === userId);
      if (participant && participant.unreadCount) {
        totalUnread += participant.unreadCount;
      }
    });

    res.json({ count: totalUnread });
  } catch (error) {
    logger.error({ err: error }, 'Get unread count error');
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// Get user's chat permissions — derived from session
router.get('/permissions', async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    const userType = req.user.userType || 'staff';

    const permissions = await getUserChatPermissions(userId, userType);

    if (!permissions) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(permissions);
  } catch (error) {
    logger.error({ err: error }, 'Get permissions error');
    res.status(500).json({ error: 'Failed to get permissions' });
  }
});

// Get all conversations for a user — derived from session
// Supports offset-based pagination via `limit` (default 50, capped at 200) and
// `skip` (default 0), plus cursor-based pagination via `cursor` (the
// ISO-8601 timestamp of the last conversation's lastMessage from the previous
// page). For the staff/dashboard surface the response body is still a plain
// array — pagination metadata is exposed on the standard headers so the
// existing dashboard destructuring of the body is unaffected.
router.get('/conversations', async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    const userType = req.user.userType || 'staff';
    const schoolId = req.user.schoolId;

    // Check permission
    const hasAccess = await hasPermission(userId, userType, CHAT_PERMISSIONS.VIEW_CONVERSATIONS);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    // [PAG-29] Bound the result set. For admins messaging hundreds of parents
    // the un-paginated fetch-all would balloon both the wire payload and the
    // server-side per-conversation enrichment (Staff/Student/UserPresence
    // batch lookups scale linearly with returned docs).
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);
    // Cursor takes precedence over skip: callers paginating by timestamp
    // (newest-first) get stable positions even when conversations shift.
    let cursorFilter = null;
    if (req.query.cursor) {
      const cursorDate = new Date(req.query.cursor);
      if (Number.isFinite(cursorDate.getTime())) {
        cursorFilter = { 'lastMessage.timestamp': { $lt: cursorDate } };
      }
    }

    const baseFilter = {
      schoolId,
      'participants.userId': userId,
      isArchived: false,
      isDeleted: { $ne: true },
      'deletedBy.userId': { $ne: userId },
    };
    const filter = cursorFilter ? { ...baseFilter, ...cursorFilter } : baseFilter;

    // Count under the unscoped base filter so X-Total-Count is the global
    // total visible to this user. `X-Has-More` is computed locally from
    // the page size and is the right "are there more in this direction"
    // signal for both offset- and cursor-based callers.
    const total = await Conversation.countDocuments(baseFilter);

    const conversations = await Conversation.find(filter)
      .sort({ 'lastMessage.timestamp': -1 })
      .skip(cursorFilter ? 0 : skip)
      .limit(limit)
      .lean();

    // Collect all unique participant user IDs grouped by model type to avoid N+1
    const staffIds = [];
    const studentIds = [];
    const presenceUserIds = [];

    for (const conv of conversations) {
      for (const p of conv.participants) {
        presenceUserIds.push(p.userId.toString());
        if (p.userModel === 'Staff') {
          staffIds.push(p.userId);
        } else {
          studentIds.push(p.userId);
        }
      }
    }

    // Batch fetch all participants at once
    const [staffList, studentList, presenceList] = await Promise.all([
      staffIds.length
        ? Staff.find({ _id: { $in: staffIds }, schoolId: req.user?.schoolId })
            .select('name photo role')
            .lean()
        : Promise.resolve([]),
      studentIds.length
        ? Student.find({ _id: { $in: studentIds }, schoolId: req.user?.schoolId })
            .select('name photo role')
            .lean()
        : Promise.resolve([]),
      presenceUserIds.length
        ? UserPresence.find({ userId: { $in: presenceUserIds } }).lean()
        : Promise.resolve([]),
    ]);

    // Build lookup maps
    const staffMap = new Map(staffList.map((s) => [s._id.toString(), s]));
    const studentMap = new Map(studentList.map((s) => [s._id.toString(), s]));
    const presenceMap = new Map(presenceList.map((p) => [p.userId.toString(), p]));

    const enrichedConversations = conversations.map((conv) => {
      const participants = conv.participants.map((p) => {
        const uid = p.userId.toString();
        const user = p.userModel === 'Staff' ? staffMap.get(uid) : studentMap.get(uid);
        const presence = presenceMap.get(uid);

        return {
          userId: p.userId,
          userType: p.userModel.toLowerCase(),
          name: user?.name || 'Unknown',
          avatar: user?.photo || null,
          role: user?.role || null,
          unreadCount: p.unreadCount || 0,
          online: presence?.status === 'online',
          lastSeen: presence?.lastSeen,
        };
      });

      const otherParticipant = participants.find((p) => p.userId.toString() !== userId);

      return {
        id: conv._id,
        type: conv.type,
        participants,
        otherParticipant,
        groupName: conv.groupName,
        groupAvatar: conv.groupAvatar,
        lastMessage: conv.lastMessage,
        unreadCount:
          conv.participants.find((p) => p.userId.toString() === userId)?.unreadCount || 0,
        updatedAt: conv.updatedAt,
      };
    });

    // [PAG-29] Pagination metadata on standard response headers. The body
    // shape stays a plain array so the existing dashboard destructuring
    // (`const conversations = await chatService.getConversations()`) keeps
    // working without a coordinated frontend change.
    const hasMore = enrichedConversations.length === limit;
    const lastConv = enrichedConversations[enrichedConversations.length - 1];
    const nextCursor =
      hasMore && lastConv?.lastMessage?.timestamp
        ? new Date(lastConv.lastMessage.timestamp).toISOString()
        : undefined;

    res.set('X-Total-Count', String(total));
    res.set('X-Limit', String(limit));
    res.set('X-Has-More', String(hasMore));
    if (nextCursor) res.set('X-Next-Cursor', nextCursor);

    res.json(enrichedConversations);
  } catch (error) {
    logger.error({ err: error }, 'Get conversations error');
    res.status(500).json({ error: 'Failed to get conversations' });
  }
});

// Get messages for a conversation
router.get('/conversations/:conversationId/messages', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { limit = 50, before } = req.query;

    const userId = req.user.id || req.user.userId;
    const schoolId = req.user.schoolId;

    // Verify the authenticated user is a participant in this conversation (scoped by school)
    const conversation = await Conversation.findOne({ _id: conversationId, schoolId }).lean();
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    const isParticipant = conversation.participants.some((p) => p.userId.toString() === userId);
    if (!isParticipant) {
      return res.status(403).json({ error: 'You are not a participant in this conversation' });
    }

    const query = {
      schoolId,
      conversationId,
      isDeleted: false,
      deletedFor: { $ne: userId },
    };

    if (before) {
      query.createdAt = { $lt: new Date(before) };
    }

    const messages = await Message.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(parseInt(limit))
      .populate('senderId', 'name photo')
      .populate('receiverId', 'name photo')
      .lean();

    // Reverse to get chronological order
    messages.reverse();

    const formattedMessages = messages.map((msg) => ({
      id: msg._id,
      conversationId: msg.conversationId,
      senderId: msg.senderId._id,
      senderName: msg.senderId.name,
      senderAvatar: msg.senderId.photo,
      receiverId: msg.receiverId._id,
      receiverName: msg.receiverId.name,
      content: msg.content,
      type: msg.type,
      fileUrl: msg.fileUrl,
      fileName: msg.fileName,
      fileSize: msg.fileSize,
      duration: msg.duration || 0,
      waveform: msg.waveform || [],
      status: msg.status,
      readAt: msg.readAt,
      createdAt: msg.createdAt,
      replyTo: msg.replyTo,
      pinned: msg.pinned || false,
      pinnedBy: msg.pinnedBy || [],
      reactions: msg.reactions || [],
      isEdited: msg.isEdited || false,
      forwardedFrom: msg.forwardedFrom?.messageId ? msg.forwardedFrom : null,
    }));

    res.json(formattedMessages);
  } catch (error) {
    logger.error({ err: error }, 'Get messages error');
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

// Create or get conversation — caller identity derived from session
router.post('/conversations', async (req, res) => {
  try {
    const user1Id = req.user.id || req.user.userId;
    const user1Type = req.user.userType || 'staff';
    const schoolId = req.user.schoolId;
    const { user2Id, user2Type, type = 'direct' } = req.body;

    if (!user2Id) {
      return res.status(400).json({ error: 'user2Id is required' });
    }

    // Check if user1 can message user2
    const canMessage = await canMessageUser(user1Id, user1Type, user2Id, user2Type);

    if (!canMessage) {
      return res.status(403).json({
        error: 'Permission denied',
        message:
          'You do not have permission to message this user. Please contact your administrator.',
      });
    }

    // Parent → 'Parent' (NOT 'Student') — ternary fall-through silently
    // persisted parent participants as Student, breaking refPath populate
    // and every downstream avatar/name lookup.
    const typeToModel = (t) => (t === 'parent' ? 'Parent' : t === 'student' ? 'Student' : 'Staff');
    const user1Model = typeToModel(user1Type);
    const user2Model = typeToModel(user2Type);

    const conversation = await Conversation.findOrCreate(
      user1Id,
      user1Model,
      user2Id,
      user2Model,
      schoolId
    );

    // Batch fetch both participants
    const participantIds = conversation.participants.map((p) => p.userId);
    const staffIds = conversation.participants
      .filter((p) => p.userModel === 'Staff')
      .map((p) => p.userId);
    const studentIds = conversation.participants
      .filter((p) => p.userModel === 'Student')
      .map((p) => p.userId);

    const [staffList, studentList] = await Promise.all([
      staffIds.length
        ? Staff.find({ _id: { $in: staffIds } })
            .select('name photo role')
            .lean()
        : [],
      studentIds.length
        ? Student.find({ _id: { $in: studentIds } })
            .select('name photo role')
            .lean()
        : [],
    ]);

    const staffMap = new Map(staffList.map((s) => [s._id.toString(), s]));
    const studentMap = new Map(studentList.map((s) => [s._id.toString(), s]));

    const participants = conversation.participants.map((p) => {
      const uid = p.userId.toString();
      const user = p.userModel === 'Staff' ? staffMap.get(uid) : studentMap.get(uid);
      return {
        userId: p.userId,
        userType: p.userModel.toLowerCase(),
        name: user?.name,
        avatar: user?.photo,
        role: user?.role,
      };
    });

    res.json({
      id: conversation._id,
      type: conversation.type,
      participants,
      lastMessage: conversation.lastMessage,
      createdAt: conversation.createdAt,
    });
  } catch (error) {
    logger.error({ err: error }, 'Create conversation error');
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

// Send message (REST fallback) — sender identity derived from session
router.post('/', async (req, res) => {
  try {
    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }

    const senderId = req.user.id || req.user.userId;
    // Map req.user.userType ('staff' | 'student' | 'parent') to the Message
    // senderModel enum ('Staff' | 'Student' | 'Parent'). The previous binary
    // (staff ? 'Staff' : 'Student') silently mis-tagged parent messages as
    // Student, causing wrong ref-model populate and broken participant lookup.
    const senderModel =
      req.user.userType === 'parent'
        ? 'Parent'
        : req.user.userType === 'student'
          ? 'Student'
          : 'Staff';
    const schoolId = req.user.schoolId;
    const {
      conversationId,
      receiverId,
      receiverModel,
      content,
      type,
      fileUrl,
      fileName,
      fileSize,
      replyTo,
      forwardedFrom,
      duration,
      waveform,
      clientMessageId,
    } = parsed.data;

    // Authorization: the sender MUST be a participant in the conversation
    // being written to. Without this, any authenticated user within the same
    // school could inject messages into arbitrary conversations and spoof
    // unread counts via conversation.incrementUnread below.
    const conversationForAuth = await Conversation.findOne({
      _id: conversationId,
      schoolId,
      'participants.userId': senderId,
    }).lean();
    if (!conversationForAuth) {
      return res.status(403).json({ error: 'Not a participant of this conversation' });
    }

    // Authorization: the sender's role must allow messaging a user of the
    // receiver's type (teachers → students/parents/staff, students → staff,
    // etc.). canMessageUser encapsulates the CHAT_PERMISSIONS matrix.
    if (receiverId && receiverModel) {
      const senderType = req.user.userType === 'staff' ? 'staff' : req.user.userType;
      const receiverType = receiverModel.toLowerCase();
      const allowed = await canMessageUser(senderId, senderType, receiverId, receiverType);
      if (!allowed) {
        return res.status(403).json({ error: 'Not allowed to message this recipient' });
      }
    }

    // Idempotency check: return existing message if clientMessageId already exists
    if (clientMessageId) {
      const existingMessage = await Message.findOne({
        schoolId,
        clientMessageId,
        senderId,
      }).populate('senderId', 'name photo');
      if (existingMessage) {
        return res.status(200).json({
          success: true,
          data: {
            id: existingMessage._id,
            clientMessageId: existingMessage.clientMessageId,
            conversationId: existingMessage.conversationId,
            senderId: existingMessage.senderId._id,
            senderName: existingMessage.senderId.name,
            content: existingMessage.content,
            type: existingMessage.type,
            fileUrl: existingMessage.fileUrl,
            fileName: existingMessage.fileName,
            status: existingMessage.status,
            createdAt: existingMessage.createdAt,
          },
        });
      }
    }

    // Build message data
    const messageData = {
      schoolId,
      conversationId,
      senderId,
      senderModel,
      receiverId,
      receiverModel,
      content,
      type,
      fileUrl,
      fileName,
      fileSize,
      duration: duration || 0,
      waveform: waveform || [],
      status: 'sent',
      ...(clientMessageId && { clientMessageId }),
    };

    // Handle replyTo - extract just the ID if it's an object
    if (replyTo) {
      if (typeof replyTo === 'object' && replyTo.messageId) {
        messageData.replyTo = replyTo.messageId;
      } else if (typeof replyTo === 'string') {
        messageData.replyTo = replyTo;
      }
    }

    // Handle forwardedFrom - only add if it has valid data
    if (forwardedFrom && forwardedFrom.messageId) {
      messageData.forwardedFrom = forwardedFrom;
    }

    const message = await Message.create(messageData);

    await message.populate('senderId', 'name photo');
    if (message.replyTo) {
      await message.populate('replyTo');
    }

    // Update conversation
    const conversation = await Conversation.findOne({ _id: conversationId, schoolId });
    if (conversation) {
      conversation.lastMessage = {
        content,
        senderId,
        senderName: message.senderId.name,
        timestamp: new Date(),
        type,
      };
      await conversation.save();

      // Increment unread for receiver
      await conversation.incrementUnread(receiverId);
    }

    res.status(201).json({
      id: message._id,
      conversationId: message.conversationId,
      senderId: message.senderId._id,
      senderName: message.senderId.name,
      content: message.content,
      type: message.type,
      fileUrl: message.fileUrl,
      fileName: message.fileName,
      fileSize: message.fileSize,
      duration: message.duration || 0,
      waveform: message.waveform || [],
      status: message.status,
      createdAt: message.createdAt,
      replyTo: message.replyTo
        ? {
            messageId: message.replyTo._id,
            content: message.replyTo.content,
            senderId: message.replyTo.senderId,
            senderName: message.replyTo.senderId?.name || 'Unknown',
          }
        : null,
      forwardedFrom: message.forwardedFrom?.messageId ? message.forwardedFrom : null,
    });
  } catch (error) {
    logger.error({ err: error }, 'Send message error');
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Mark messages as read
router.put('/read', async (req, res) => {
  try {
    const { conversationId } = req.body;
    const userId = req.user.id || req.user.userId;
    const schoolId = req.user.schoolId;

    if (!conversationId) {
      return res.status(400).json({ error: 'conversationId is required' });
    }

    await Message.updateMany(
      {
        schoolId,
        conversationId,
        receiverId: userId,
        status: { $ne: 'read' },
      },
      {
        status: 'read',
        readAt: new Date(),
      }
    );

    // Reset unread count
    const conversation = await Conversation.findOne({ _id: conversationId, schoolId });
    if (conversation) {
      await conversation.resetUnread(userId);
    }

    res.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'Mark read error');
    res.status(500).json({ error: 'Failed to mark messages as read' });
  }
});

// Delete message
router.delete('/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id || req.user.userId;
    const schoolId = req.user.schoolId;

    const message = await Message.findOne({ _id: messageId, schoolId });

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Soft-delete-for-me: add user to deletedFor so the message is hidden
    // from that user's view only. The previous behaviour flipped
    // message.isDeleted=true (erasing it for EVERYONE retroactively) once
    // deletedFor reached participants.length — the last participant to
    // "hide" it silently wiped the record for all prior viewers. That's
    // not hide-for-me semantics; keep the message persistent regardless of
    // how many users have hidden it from their own view.
    if (!message.deletedFor.includes(userId)) {
      message.deletedFor.push(userId);
    }
    await message.save();

    res.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'Delete message error');
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// Search messages — requires auth
router.get('/search', async (req, res) => {
  try {
    const { query, limit = 20 } = req.query;
    const userId = req.user.id || req.user.userId;
    const schoolId = req.user.schoolId;

    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }

    // Find conversations where user is participant (exclude deleted)
    const conversations = await Conversation.find({
      schoolId,
      'participants.userId': userId,
      isDeleted: { $ne: true },
      'deletedBy.userId': { $ne: userId },
    })
      .select('_id participants')
      .lean();

    const conversationIds = conversations.map((c) => c._id);

    // Build map of conversationId -> other participant's cached name
    const convNameMap = new Map();
    for (const conv of conversations) {
      const other = conv.participants.find((p) => p.userId.toString() !== userId);
      convNameMap.set(conv._id.toString(), other?.name || 'Unknown');
    }

    // Escape special regex chars to prevent ReDoS
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Search messages (exclude deleted for this user)
    const messages = await Message.find({
      conversationId: { $in: conversationIds },
      content: { $regex: escapedQuery, $options: 'i' },
      isDeleted: false,
      deletedFor: { $ne: userId },
    })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .populate('senderId', 'name photo')
      .lean();

    const formatted = messages.map((msg) => ({
      id: msg._id,
      conversationId: msg.conversationId,
      conversationName: convNameMap.get(msg.conversationId.toString()) || 'Unknown',
      senderId: msg.senderId?._id,
      senderName: msg.senderId?.name || 'Unknown',
      senderAvatar: msg.senderId?.photo || null,
      content: msg.content,
      type: msg.type,
      createdAt: msg.createdAt,
    }));

    res.json(formatted);
  } catch (error) {
    logger.error({ err: error }, 'Search messages error');
    res.status(500).json({ error: 'Failed to search messages' });
  }
});

// Get online users — requires auth (MUST be before /presence/:userId to avoid route shadowing)
router.get('/presence/online', async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const onlineUsers = await UserPresence.find({ status: 'online', schoolId })
      .select('userId userModel lastSeen')
      .lean();

    res.json(onlineUsers);
  } catch (error) {
    logger.error({ err: error }, 'Get online users error');
    res.status(500).json({ error: 'Failed to get online users' });
  }
});

// Get user presence — requires auth; only for users sharing a conversation
router.get('/presence/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.id || req.user.userId;
    const schoolId = req.user.schoolId;

    // Allow querying own presence
    if (userId !== currentUserId) {
      // Verify the authenticated user shares at least one conversation with the target user (scoped by school)
      const sharedConversation = await Conversation.findOne({
        schoolId,
        'participants.userId': { $all: [currentUserId, userId] },
      }).lean();

      if (!sharedConversation) {
        return res.status(403).json({ error: req.t('common:errors.forbidden') });
      }
    }

    const presence = await UserPresence.findOne({ userId, schoolId });

    if (!presence) {
      return res.json({ status: 'offline', lastSeen: null });
    }

    res.json({
      status: presence.status,
      lastSeen: presence.lastSeen,
    });
  } catch (error) {
    logger.error({ err: error }, 'Get presence error');
    res.status(500).json({ error: 'Failed to get presence' });
  }
});

// ============ ENHANCED MESSAGE ACTIONS ============

// Edit message — requires auth
router.put('/:messageId/edit', async (req, res) => {
  try {
    const parsed = editMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }

    const { messageId } = req.params;
    const userId = req.user.id || req.user.userId;
    const schoolId = req.user.schoolId;
    const { content } = parsed.data;

    const message = await Message.findOne({ _id: messageId, schoolId });

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Check if sender is editing
    if (message.senderId.toString() !== userId) {
      return res.status(403).json({ error: 'Only sender can edit message' });
    }

    // Save edit history
    message.editHistory.push({
      content: message.content,
      editedAt: new Date(),
      editedBy: userId,
    });

    // Update content
    message.content = content;
    message.isEdited = true;

    await message.save();

    // Emit Socket.IO event
    const io = req.app.get('io');
    io.to(`conversation:${message.conversationId}`).emit('message_edited', {
      messageId: message._id,
      content: message.content,
      isEdited: message.isEdited,
      editHistory: message.editHistory,
    });

    res.json(message);
  } catch (error) {
    logger.error({ err: error }, 'Edit message error');
    res.status(500).json({ error: 'Failed to edit message' });
  }
});

// React to message — requires auth
router.post('/:messageId/react', async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id || req.user.userId;
    const schoolId = req.user.schoolId;
    const userModel = (req.user.userType || 'staff') === 'staff' ? 'Staff' : 'Student';
    const { emoji } = req.body;

    if (!emoji) {
      return res.status(400).json({ error: 'emoji is required' });
    }

    const message = await Message.findOne({ _id: messageId, schoolId });

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Check if user already reacted with this emoji
    const existingReactionIndex = message.reactions.findIndex(
      (r) => r.userId.toString() === userId && r.emoji === emoji
    );

    if (existingReactionIndex >= 0) {
      // Remove reaction
      message.reactions.splice(existingReactionIndex, 1);
    } else {
      // Add reaction
      message.reactions.push({
        emoji,
        userId,
        userModel,
        createdAt: new Date(),
      });
    }

    await message.save();

    // Emit Socket.IO event
    const io = req.app.get('io');
    io.to(`conversation:${message.conversationId}`).emit('message_reacted', {
      messageId: message._id,
      reactions: message.reactions,
    });

    res.json({ reactions: message.reactions });
  } catch (error) {
    logger.error({ err: error }, 'React to message error');
    res.status(500).json({ error: 'Failed to react to message' });
  }
});

// Reply to message — requires auth
router.post('/:messageId/reply', async (req, res) => {
  try {
    const { messageId } = req.params;
    const senderId = req.user.id || req.user.userId;
    const senderModel = (req.user.userType || 'staff') === 'staff' ? 'Staff' : 'Student';
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }

    const schoolId = req.user.schoolId;
    const originalMessage = await Message.findOne({ _id: messageId, schoolId });

    if (!originalMessage) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Derive receiverId from original message — the other party in the conversation
    const receiverId =
      originalMessage.senderId.toString() === senderId
        ? originalMessage.receiverId
        : originalMessage.senderId;
    const receiverModel =
      originalMessage.senderId.toString() === senderId
        ? originalMessage.receiverModel
        : originalMessage.senderModel;

    // Create reply message
    const reply = new Message({
      conversationId: originalMessage.conversationId,
      schoolId,
      senderId,
      senderModel,
      receiverId,
      receiverModel,
      content,
      type: 'text',
      replyTo: messageId,
    });

    await reply.save();

    // Update conversation last message
    await Conversation.findByIdAndUpdate(originalMessage.conversationId, {
      lastMessage: {
        content: `↩️ ${content.substring(0, 50)}...`,
        senderId,
        timestamp: new Date(),
      },
    });

    // Emit Socket.IO event
    const io = req.app.get('io');
    io.to(`conversation:${originalMessage.conversationId}`).emit('new_message', reply);

    res.json(reply);
  } catch (error) {
    logger.error({ err: error }, 'Reply to message error');
    res.status(500).json({ error: 'Failed to reply to message' });
  }
});

// Forward message — requires auth
router.post('/:messageId/forward', async (req, res) => {
  try {
    const { messageId } = req.params;
    const senderId = req.user.id || req.user.userId;
    const senderModel = (req.user.userType || 'staff') === 'staff' ? 'Staff' : 'Student';
    const { conversationIds } = req.body;

    if (!conversationIds || !Array.isArray(conversationIds) || conversationIds.length === 0) {
      return res.status(400).json({ error: 'conversationIds array is required' });
    }

    const schoolId = req.user.schoolId;
    const originalMessage = await Message.findOne({ _id: messageId, schoolId });

    if (!originalMessage) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const forwardedMessages = [];

    for (const conversationId of conversationIds) {
      // Get conversation to find receiver — scope by schoolId
      const conversation = await Conversation.findOne({ _id: conversationId, schoolId });

      if (!conversation) continue;

      // Find other participant
      const otherParticipant = conversation.participants.find(
        (p) => p.userId.toString() !== senderId
      );

      if (!otherParticipant) continue;

      // Create forwarded message
      const forwarded = new Message({
        conversationId,
        schoolId,
        senderId,
        senderModel,
        receiverId: otherParticipant.userId,
        receiverModel: otherParticipant.userModel,
        content: originalMessage.content,
        type: originalMessage.type,
        fileUrl: originalMessage.fileUrl,
        fileName: originalMessage.fileName,
        fileSize: originalMessage.fileSize,
        forwardedFrom: {
          messageId: originalMessage._id,
          conversationId: originalMessage.conversationId,
          forwardedBy: senderId,
          originalSenderName: null,
        },
      });

      await forwarded.save();

      // Update conversation last message
      await Conversation.findByIdAndUpdate(conversationId, {
        lastMessage: {
          content: `↪️ ${originalMessage.content.substring(0, 50)}...`,
          senderId,
          timestamp: new Date(),
        },
      });

      // Emit Socket.IO event
      const io = req.app.get('io');
      io.to(`conversation:${conversationId}`).emit('new_message', forwarded);

      forwardedMessages.push(forwarded);
    }

    res.json(forwardedMessages);
  } catch (error) {
    logger.error({ err: error }, 'Forward message error');
    res.status(500).json({ error: 'Failed to forward message' });
  }
});

// Pin/unpin message — requires auth
router.post('/:messageId/pin', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { pinned } = req.body;
    const userId = req.user.id || req.user.userId;

    const schoolId = req.user.schoolId;
    const message = await Message.findOne({ _id: messageId, schoolId });

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Verify the authenticated user is a participant in this conversation
    const conversation = await Conversation.findOne({ _id: message.conversationId, schoolId });
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    const isParticipant = conversation.participants.some((p) => p.userId.toString() === userId);
    if (!isParticipant) {
      return res.status(403).json({ error: 'You are not a participant in this conversation' });
    }

    message.pinned = pinned !== undefined ? pinned : true;

    if (pinned && !message.pinnedBy.includes(userId)) {
      message.pinnedBy.push(userId);
    } else if (!pinned) {
      message.pinnedBy = message.pinnedBy.filter((id) => id.toString() !== userId);
    }

    await message.save();

    // Update conversation pinned messages
    const existingPinIndex = conversation.pinnedMessages.findIndex(
      (pm) => pm.messageId.toString() === messageId
    );

    if (pinned && existingPinIndex === -1) {
      conversation.pinnedMessages.push({
        messageId,
        pinnedBy: userId,
        pinnedAt: new Date(),
      });
    } else if (!pinned && existingPinIndex >= 0) {
      conversation.pinnedMessages.splice(existingPinIndex, 1);
    }

    await conversation.save();

    // Emit Socket.IO event
    const io = req.app.get('io');
    io.to(`conversation:${message.conversationId}`).emit('message_pinned', {
      messageId,
      pinned: message.pinned,
      pinnedBy: userId,
    });

    res.json({ pinned: message.pinned });
  } catch (error) {
    logger.error({ err: error }, 'Pin message error');
    res.status(500).json({ error: 'Failed to pin message' });
  }
});

// Get pinned messages in conversation — requires auth
router.get('/conversations/:conversationId/pinned-messages', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id || req.user.userId;
    const schoolId = req.user.schoolId;

    const conversation = await Conversation.findOne({ _id: conversationId, schoolId })
      .populate('pinnedMessages.messageId')
      .lean();

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Verify the authenticated user is a participant
    const isParticipant = conversation.participants.some((p) => p.userId.toString() === userId);
    if (!isParticipant) {
      return res.status(403).json({ error: 'You are not a participant in this conversation' });
    }

    res.json(conversation.pinnedMessages || []);
  } catch (error) {
    logger.error({ err: error }, 'Get pinned messages error');
    res.status(500).json({ error: 'Failed to get pinned messages' });
  }
});

// Pin/unpin conversation — requires auth
router.post('/conversations/:conversationId/pin', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id || req.user.userId;
    const schoolId = req.user.schoolId;
    const { pinned } = req.body;

    const conversation = await Conversation.findOne({ _id: conversationId, schoolId });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const existingPinIndex = conversation.pinnedBy.findIndex((p) => p.userId.toString() === userId);

    if (pinned && existingPinIndex === -1) {
      conversation.pinnedBy.push({
        userId,
        pinnedAt: new Date(),
      });
    } else if (!pinned && existingPinIndex >= 0) {
      conversation.pinnedBy.splice(existingPinIndex, 1);
    }

    await conversation.save();

    // Emit Socket.IO event
    const io = req.app.get('io');
    io.to(`user:${userId}`).emit('conversation_pinned', {
      conversationId,
      pinned: conversation.pinnedBy.some((p) => p.userId.toString() === userId),
    });

    res.json({ pinned: conversation.pinnedBy.some((p) => p.userId.toString() === userId) });
  } catch (error) {
    logger.error({ err: error }, 'Pin conversation error');
    res.status(500).json({ error: 'Failed to pin conversation' });
  }
});

// Mute/unmute conversation — requires auth
router.post('/conversations/:conversationId/mute', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id || req.user.userId;
    const schoolId = req.user.schoolId;
    const { muted, mutedUntil } = req.body;

    const conversation = await Conversation.findOne({ _id: conversationId, schoolId });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const existingMuteIndex = conversation.mutedBy.findIndex((m) => m.userId.toString() === userId);

    if (muted && existingMuteIndex === -1) {
      conversation.mutedBy.push({
        userId,
        mutedUntil: mutedUntil ? new Date(mutedUntil) : null,
      });
    } else if (!muted && existingMuteIndex >= 0) {
      conversation.mutedBy.splice(existingMuteIndex, 1);
    }

    await conversation.save();

    // Emit Socket.IO event
    const io = req.app.get('io');
    io.to(`user:${userId}`).emit('conversation_muted', {
      conversationId,
      muted: conversation.mutedBy.some((m) => m.userId.toString() === userId),
    });

    res.json({ muted: conversation.mutedBy.some((m) => m.userId.toString() === userId) });
  } catch (error) {
    logger.error({ err: error }, 'Mute conversation error');
    res.status(500).json({ error: 'Failed to mute conversation' });
  }
});

// Delete conversation — requires auth
router.delete('/conversations/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id || req.user.userId;
    const schoolId = req.user.schoolId;

    const conversation = await Conversation.findOne({ _id: conversationId, schoolId });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Add to deletedBy
    if (!conversation.deletedBy) {
      conversation.deletedBy = [];
    }

    const alreadyDeleted = conversation.deletedBy.some((d) => d.userId.toString() === userId);

    if (!alreadyDeleted) {
      conversation.deletedBy.push({
        userId,
        deletedAt: new Date(),
      });

      // If all participants deleted, mark as deleted
      if (conversation.deletedBy.length >= conversation.participants.length) {
        conversation.isDeleted = true;
      }

      await conversation.save();
    }

    // Emit Socket.IO event
    const io = req.app.get('io');
    io.to(`user:${userId}`).emit('conversation_deleted', { conversationId });

    res.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'Delete conversation error');
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

// Get available contacts — requires auth
router.get('/contacts', async (req, res) => {
  try {
    const { userType } = req.query;
    const schoolId = req.user.schoolId;

    if (!userType || !['staff', 'student'].includes(userType)) {
      return res.status(400).json({ error: 'Valid userType (staff/student) is required' });
    }

    if (!schoolId) {
      return res.status(400).json({ error: 'School context is required' });
    }

    // Get all active staff members scoped by school
    const staff = await Staff.find({ isActive: true, schoolId })
      .select('_id name role picture')
      .sort({ name: 1 })
      .lean();

    // Get all active students scoped by school
    const students = await Student.find({ isActive: true, schoolId })
      .select('_id name rollNo picture')
      .sort({ name: 1 })
      .lean();

    // Format response
    const formattedStaff = staff.map((s) => ({
      id: s._id.toString(),
      name: s.name,
      role: s.role,
      avatar: s.picture,
    }));

    const formattedStudents = students.map((s) => ({
      id: s._id.toString(),
      name: s.name,
      rollNo: s.rollNo,
      avatar: s.picture,
    }));

    res.json({
      staff: formattedStaff,
      students: formattedStudents,
    });
  } catch (error) {
    logger.error({ err: error }, 'Get contacts error');
    res.status(500).json({ error: 'Failed to get contacts' });
  }
});

// GET /api/v1/messages/parent-contacts
// Returns the school's parents as chat contacts. The conversation participant
// model already supports userModel 'Parent', but the dashboard's contact list
// was built only from staff + students — so an admin could never start a chat
// with a parent. This endpoint closes that gap.
//
// Each parent is de-duplicated by id and returned with a primary-child label
// (class + relationship) so the contact list reads like "Asha (Class 5 A · mother)".
router.get('/parent-contacts', async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID is required' });
    }

    // Active parents with at least one child link. Populate the child's class
    // so we can show "Class X · relationship" as the contact subtitle.
    const parents = await Parent.find({
      schoolId,
      status: 'active',
      'children.0': { $exists: true },
    })
      .populate({
        path: 'children.studentId',
        select: 'name classId',
        populate: { path: 'classId', select: 'name section' },
      })
      .select('name avatar email children')
      .lean();

    const contacts = parents.map((p) => {
      // Pick the primary child (isPrimary) or the first linked child.
      const kids = Array.isArray(p.children) ? p.children : [];
      const primary = kids.find((c) => c.isPrimary && c.studentId) || kids.find((c) => c.studentId);
      const child = primary?.studentId;
      let role = 'Parent';
      if (child) {
        const cls = child.classId;
        const classLabel = cls
          ? `${cls.name || ''}${cls.section ? ' ' + cls.section : ''}`.trim()
          : '';
        const rel = primary?.relationship || 'parent';
        role = [classLabel, rel].filter(Boolean).join(' · ') || 'Parent';
      }
      return {
        id: String(p._id),
        name: p.name,
        role,
        avatar: p.avatar || null,
        type: 'parent',
      };
    });

    return res.json({ contacts });
  } catch (error) {
    logger.error({ err: error }, 'Get parent contacts error');
    res.status(500).json({ error: 'Failed to get parent contacts' });
  }
});

export default router;
