import express from 'express';
import Message from '../models/Message.js';
import Conversation from '../models/Conversation.js';
import UserPresence from '../models/UserPresence.js';
import { Staff, Student } from '../database.js';
import { hasPermission, canMessageUser, getUserChatPermissions, CHAT_PERMISSIONS } from '../middleware/chatPermissions.js';

const router = express.Router();

// Get user's chat permissions
router.get('/permissions', async (req, res) => {
  try {
    const { userId, userType } = req.query;

    if (!userId || !userType) {
      return res.status(400).json({ error: 'userId and userType are required' });
    }

    const permissions = await getUserChatPermissions(userId, userType);

    if (!permissions) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(permissions);
  } catch (error) {
    console.error('❌ Get permissions error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all conversations for a user
router.get('/conversations', async (req, res) => {
  try {
    const { userId, userType } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // Check permission
    const hasAccess = await hasPermission(userId, userType, CHAT_PERMISSIONS.VIEW_CONVERSATIONS);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    const conversations = await Conversation.find({
      'participants.userId': userId,
      isArchived: false
    })
      .sort({ 'lastMessage.timestamp': -1 })
      .lean();

    // Populate participant details
    const enrichedConversations = await Promise.all(
      conversations.map(async (conv) => {
        const participants = await Promise.all(
          conv.participants.map(async (p) => {
            const UserModel = p.userModel === 'Staff' ? Staff : Student;
            const user = await UserModel.findById(p.userId).select('name photo role email');
            
            // Get presence
            const presence = await UserPresence.findOne({ userId: p.userId });

            return {
              userId: p.userId,
              userType: p.userModel.toLowerCase(),
              name: user?.name || 'Unknown',
              avatar: user?.photo || null,
              role: user?.role || null,
              unreadCount: p.unreadCount || 0,
              online: presence?.status === 'online',
              lastSeen: presence?.lastSeen
            };
          })
        );

        // Get the other participant (for direct chats)
        const otherParticipant = participants.find(
          p => p.userId.toString() !== userId
        );

        return {
          id: conv._id,
          type: conv.type,
          participants,
          otherParticipant,
          groupName: conv.groupName,
          groupAvatar: conv.groupAvatar,
          lastMessage: conv.lastMessage,
          unreadCount: conv.participants.find(p => p.userId.toString() === userId)?.unreadCount || 0,
          updatedAt: conv.updatedAt
        };
      })
    );

    res.json(enrichedConversations);
  } catch (error) {
    console.error('❌ Get conversations error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get messages for a conversation
router.get('/conversations/:conversationId/messages', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { limit = 50, before } = req.query;

    const query = {
      conversationId,
      isDeleted: false
    };

    if (before) {
      query.createdAt = { $lt: new Date(before) };
    }

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .populate('senderId', 'name photo')
      .populate('receiverId', 'name photo')
      .lean();

    // Reverse to get chronological order
    messages.reverse();

    const formattedMessages = messages.map(msg => ({
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
      status: msg.status,
      readAt: msg.readAt,
      createdAt: msg.createdAt,
      replyTo: msg.replyTo,
      pinned: msg.pinned || false,
      pinnedBy: msg.pinnedBy || [],
      reactions: msg.reactions || [],
      isEdited: msg.isEdited || false,
      forwardedFrom: msg.forwardedFrom || null
    }));

    res.json(formattedMessages);
  } catch (error) {
    console.error('❌ Get messages error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create or get conversation
router.post('/conversations', async (req, res) => {
  try {
    const { user1Id, user1Type, user2Id, user2Type, type = 'direct' } = req.body;

    if (!user1Id || !user2Id) {
      return res.status(400).json({ error: 'Both user IDs are required' });
    }

    // Check if user1 can message user2
    const canMessage = await canMessageUser(user1Id, user1Type, user2Id, user2Type);
    
    if (!canMessage) {
      return res.status(403).json({ 
        error: 'Permission denied',
        message: 'You do not have permission to message this user. Please contact your administrator.'
      });
    }

    const user1Model = user1Type === 'staff' ? 'Staff' : 'Student';
    const user2Model = user2Type === 'staff' ? 'Staff' : 'Student';

    const conversation = await Conversation.findOrCreate(
      user1Id,
      user1Model,
      user2Id,
      user2Model
    );

    // Populate participant details
    const participants = await Promise.all(
      conversation.participants.map(async (p) => {
        const UserModel = p.userModel === 'Staff' ? Staff : Student;
        const user = await UserModel.findById(p.userId).select('name photo role');
        
        return {
          userId: p.userId,
          userType: p.userModel.toLowerCase(),
          name: user?.name,
          avatar: user?.photo,
          role: user?.role
        };
      })
    );

    res.json({
      id: conversation._id,
      type: conversation.type,
      participants,
      lastMessage: conversation.lastMessage,
      createdAt: conversation.createdAt
    });
  } catch (error) {
    console.error('❌ Create conversation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Send message (REST fallback)
router.post('/', async (req, res) => {
  try {
    const {
      conversationId,
      senderId,
      senderModel,
      receiverId,
      receiverModel,
      content,
      type = 'text',
      fileUrl,
      fileName,
      fileSize,
      replyTo,
      forwardedFrom
    } = req.body;

    if (!conversationId || !senderId || !receiverId || !content) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Build message data
    const messageData = {
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
      status: 'sent'
    };

    // Handle replyTo - extract just the ID if it's an object
    if (replyTo) {
      if (typeof replyTo === 'object' && replyTo.messageId) {
        messageData.replyTo = replyTo.messageId;
      } else if (typeof replyTo === 'string') {
        messageData.replyTo = replyTo;
      }
    }

    // Handle forwardedFrom
    if (forwardedFrom) {
      messageData.forwardedFrom = forwardedFrom;
    }

    const message = await Message.create(messageData);

    await message.populate('senderId', 'name photo');
    if (message.replyTo) {
      await message.populate('replyTo');
    }

    // Update conversation
    const conversation = await Conversation.findById(conversationId);
    if (conversation) {
      conversation.lastMessage = {
        content,
        senderId,
        senderName: message.senderId.name,
        timestamp: new Date(),
        type
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
      status: message.status,
      createdAt: message.createdAt,
      replyTo: message.replyTo ? {
        messageId: message.replyTo._id,
        content: message.replyTo.content,
        senderId: message.replyTo.senderId,
        senderName: message.replyTo.senderId?.name || 'Unknown'
      } : null,
      forwardedFrom: message.forwardedFrom
    });
  } catch (error) {
    console.error('❌ Send message error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Mark messages as read
router.put('/read', async (req, res) => {
  try {
    const { conversationId, userId } = req.body;

    if (!conversationId || !userId) {
      return res.status(400).json({ error: 'conversationId and userId are required' });
    }

    await Message.updateMany(
      {
        conversationId,
        receiverId: userId,
        status: { $ne: 'read' }
      },
      {
        status: 'read',
        readAt: new Date()
      }
    );

    // Reset unread count
    const conversation = await Conversation.findById(conversationId);
    if (conversation) {
      await conversation.resetUnread(userId);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Mark read error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete message
router.delete('/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { userId } = req.query;

    const message = await Message.findById(messageId);
    
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Soft delete - add user to deletedFor array
    if (!message.deletedFor.includes(userId)) {
      message.deletedFor.push(userId);
    }

    // If both users deleted, mark as deleted
    const conversation = await Conversation.findById(message.conversationId);
    if (message.deletedFor.length >= conversation.participants.length) {
      message.isDeleted = true;
    }

    await message.save();

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Delete message error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Search messages
router.get('/search', async (req, res) => {
  try {
    const { userId, query, limit = 20 } = req.query;

    if (!userId || !query) {
      return res.status(400).json({ error: 'userId and query are required' });
    }

    // Find conversations where user is participant
    const conversations = await Conversation.find({
      'participants.userId': userId
    }).select('_id');

    const conversationIds = conversations.map(c => c._id);

    // Search messages
    const messages = await Message.find({
      conversationId: { $in: conversationIds },
      content: { $regex: query, $options: 'i' },
      isDeleted: false
    })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .populate('senderId', 'name photo')
      .populate('conversationId')
      .lean();

    res.json(messages);
  } catch (error) {
    console.error('❌ Search messages error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get user presence
router.get('/presence/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const presence = await UserPresence.findOne({ userId });

    if (!presence) {
      return res.json({ status: 'offline', lastSeen: null });
    }

    res.json({
      status: presence.status,
      lastSeen: presence.lastSeen
    });
  } catch (error) {
    console.error('❌ Get presence error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get online users
router.get('/presence/online', async (req, res) => {
  try {
    const onlineUsers = await UserPresence.find({ status: 'online' })
      .select('userId userModel lastSeen')
      .lean();

    res.json(onlineUsers);
  } catch (error) {
    console.error('❌ Get online users error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ ENHANCED MESSAGE ACTIONS ============

// Edit message
router.put('/:messageId/edit', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { content, userId } = req.body;

    if (!content || !userId) {
      return res.status(400).json({ error: 'content and userId are required' });
    }

    const message = await Message.findById(messageId);

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
      editedBy: userId
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
      editHistory: message.editHistory
    });

    res.json(message);
  } catch (error) {
    console.error('❌ Edit message error:', error);
    res.status(500).json({ error: error.message });
  }
});

// React to message
router.post('/:messageId/react', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { emoji, userId, userModel } = req.body;

    if (!emoji || !userId || !userModel) {
      return res.status(400).json({ error: 'emoji, userId, and userModel are required' });
    }

    const message = await Message.findById(messageId);

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Check if user already reacted with this emoji
    const existingReactionIndex = message.reactions.findIndex(
      r => r.userId.toString() === userId && r.emoji === emoji
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
        createdAt: new Date()
      });
    }

    await message.save();

    // Emit Socket.IO event
    const io = req.app.get('io');
    io.to(`conversation:${message.conversationId}`).emit('message_reacted', {
      messageId: message._id,
      reactions: message.reactions
    });

    res.json({ reactions: message.reactions });
  } catch (error) {
    console.error('❌ React to message error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Reply to message
router.post('/:messageId/reply', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { content, senderId, senderModel, receiverId, receiverModel } = req.body;

    if (!content || !senderId) {
      return res.status(400).json({ error: 'content and senderId are required' });
    }

    const originalMessage = await Message.findById(messageId);

    if (!originalMessage) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Create reply message
    const reply = new Message({
      conversationId: originalMessage.conversationId,
      senderId,
      senderModel,
      receiverId,
      receiverModel,
      content,
      type: 'text',
      replyTo: messageId
    });

    await reply.save();

    // Update conversation last message
    await Conversation.findByIdAndUpdate(originalMessage.conversationId, {
      lastMessage: {
        content: `↩️ ${content.substring(0, 50)}...`,
        senderId,
        timestamp: new Date()
      }
    });

    // Emit Socket.IO event
    const io = req.app.get('io');
    io.to(`conversation:${originalMessage.conversationId}`).emit('new_message', reply);

    res.json(reply);
  } catch (error) {
    console.error('❌ Reply to message error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Forward message
router.post('/:messageId/forward', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { conversationIds, senderId, senderModel } = req.body;

    if (!conversationIds || !Array.isArray(conversationIds) || conversationIds.length === 0) {
      return res.status(400).json({ error: 'conversationIds array is required' });
    }

    const originalMessage = await Message.findById(messageId);

    if (!originalMessage) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const forwardedMessages = [];

    for (const conversationId of conversationIds) {
      // Get conversation to find receiver
      const conversation = await Conversation.findById(conversationId);

      if (!conversation) continue;

      // Find other participant
      const otherParticipant = conversation.participants.find(
        p => p.userId.toString() !== senderId
      );

      if (!otherParticipant) continue;

      // Create forwarded message
      const forwarded = new Message({
        conversationId,
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
          originalSenderName: null // Will be populated
        }
      });

      await forwarded.save();

      // Update conversation last message
      await Conversation.findByIdAndUpdate(conversationId, {
        lastMessage: {
          content: `↪️ ${originalMessage.content.substring(0, 50)}...`,
          senderId,
          timestamp: new Date()
        }
      });

      // Emit Socket.IO event
      const io = req.app.get('io');
      io.to(`conversation:${conversationId}`).emit('new_message', forwarded);

      forwardedMessages.push(forwarded);
    }

    res.json(forwardedMessages);
  } catch (error) {
    console.error('❌ Forward message error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Pin/unpin message
router.post('/:messageId/pin', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { userId, pinned } = req.body;

    const message = await Message.findById(messageId);

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    message.pinned = pinned !== undefined ? pinned : true;

    if (pinned && !message.pinnedBy.includes(userId)) {
      message.pinnedBy.push(userId);
    } else if (!pinned) {
      message.pinnedBy = message.pinnedBy.filter(id => id.toString() !== userId);
    }

    await message.save();

    // Update conversation pinned messages
    const conversation = await Conversation.findById(message.conversationId);

    if (conversation) {
      const existingPinIndex = conversation.pinnedMessages.findIndex(
        pm => pm.messageId.toString() === messageId
      );

      if (pinned && existingPinIndex === -1) {
        conversation.pinnedMessages.push({
          messageId,
          pinnedBy: userId,
          pinnedAt: new Date()
        });
      } else if (!pinned && existingPinIndex >= 0) {
        conversation.pinnedMessages.splice(existingPinIndex, 1);
      }

      await conversation.save();
    }

    // Emit Socket.IO event
    const io = req.app.get('io');
    io.to(`conversation:${message.conversationId}`).emit('message_pinned', {
      messageId,
      pinned: message.pinned,
      pinnedBy: userId
    });

    res.json({ pinned: message.pinned });
  } catch (error) {
    console.error('❌ Pin message error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get pinned messages in conversation
router.get('/conversations/:conversationId/pinned-messages', async (req, res) => {
  try {
    const { conversationId } = req.params;

    const conversation = await Conversation.findById(conversationId)
      .populate('pinnedMessages.messageId')
      .lean();

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.json(conversation.pinnedMessages || []);
  } catch (error) {
    console.error('❌ Get pinned messages error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Pin/unpin conversation
router.post('/conversations/:conversationId/pin', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { userId, pinned } = req.body;

    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const existingPinIndex = conversation.pinnedBy.findIndex(
      p => p.userId.toString() === userId
    );

    if (pinned && existingPinIndex === -1) {
      conversation.pinnedBy.push({
        userId,
        pinnedAt: new Date()
      });
    } else if (!pinned && existingPinIndex >= 0) {
      conversation.pinnedBy.splice(existingPinIndex, 1);
    }

    await conversation.save();

    // Emit Socket.IO event
    const io = req.app.get('io');
    io.to(`user:${userId}`).emit('conversation_pinned', {
      conversationId,
      pinned: conversation.pinnedBy.some(p => p.userId.toString() === userId)
    });

    res.json({ pinned: conversation.pinnedBy.some(p => p.userId.toString() === userId) });
  } catch (error) {
    console.error('❌ Pin conversation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Mute/unmute conversation
router.post('/conversations/:conversationId/mute', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { userId, muted, mutedUntil } = req.body;

    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const existingMuteIndex = conversation.mutedBy.findIndex(
      m => m.userId.toString() === userId
    );

    if (muted && existingMuteIndex === -1) {
      conversation.mutedBy.push({
        userId,
        mutedUntil: mutedUntil ? new Date(mutedUntil) : null
      });
    } else if (!muted && existingMuteIndex >= 0) {
      conversation.mutedBy.splice(existingMuteIndex, 1);
    }

    await conversation.save();

    // Emit Socket.IO event
    const io = req.app.get('io');
    io.to(`user:${userId}`).emit('conversation_muted', {
      conversationId,
      muted: conversation.mutedBy.some(m => m.userId.toString() === userId)
    });

    res.json({ muted: conversation.mutedBy.some(m => m.userId.toString() === userId) });
  } catch (error) {
    console.error('❌ Mute conversation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete conversation
router.delete('/conversations/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { userId } = req.body;

    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Add to deletedBy
    if (!conversation.deletedBy) {
      conversation.deletedBy = [];
    }

    const alreadyDeleted = conversation.deletedBy.some(
      d => d.userId.toString() === userId
    );

    if (!alreadyDeleted) {
      conversation.deletedBy.push({
        userId,
        deletedAt: new Date()
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
    console.error('❌ Delete conversation error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
