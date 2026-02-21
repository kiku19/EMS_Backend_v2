import express from 'express';
import { Conversation, Message, Parent, Staff } from '../database.js';
import { authenticateParent } from '../middleware/parentAuth.js';
import UserPresence from '../models/UserPresence.js';

const router = express.Router();

/**
 * GET /api/parent/messages/conversations
 * Get all conversations for the authenticated parent
 */
router.get('/conversations', authenticateParent, async (req, res) => {
  try {
    const parentId = req.parent._id;

    const conversations = await Conversation.find({
      'participants.userId': parentId,
      isArchived: false
    })
      .sort({ 'lastMessage.timestamp': -1 })
      .lean();

    // Populate participant details
    const enrichedConversations = await Promise.all(
      conversations.map(async (conv) => {
        const participants = await Promise.all(
          conv.participants.map(async (p) => {
            let user;

            // Determine model based on userModel field
            if (p.userModel === 'Parent') {
              user = await Parent.findById(p.userId).select('name phone email');
            } else if (p.userModel === 'Staff') {
              user = await Staff.findById(p.userId).select('name photo role email phone');
            } else {
              user = null;
            }

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
          p => p.userId.toString() !== parentId.toString()
        );

        return {
          id: conv._id,
          type: conv.type,
          participants,
          otherParticipant,
          groupName: conv.groupName,
          groupAvatar: conv.groupAvatar,
          lastMessage: conv.lastMessage,
          unreadCount: conv.participants.find(p => p.userId.toString() === parentId.toString())?.unreadCount || 0,
          updatedAt: conv.updatedAt
        };
      })
    );

    res.json({
      success: true,
      data: enrichedConversations
    });
  } catch (error) {
    console.error('❌ Get parent conversations error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to fetch conversations'
      }
    });
  }
});

/**
 * GET /api/parent/messages/:id/messages
 * Get messages for a specific conversation (with pagination)
 */
router.get('/:id/messages', authenticateParent, async (req, res) => {
  try {
    const { id: conversationId } = req.params;
    const parentId = req.parent._id;
    const limit = parseInt(req.query.limit) || 50;
    const before = req.query.before;

    // Verify parent is part of this conversation
    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'CONVERSATION_NOT_FOUND',
          message: 'Conversation not found'
        }
      });
    }

    const isParticipant = conversation.participants.some(
      p => p.userId.toString() === parentId.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'You do not have access to this conversation'
        }
      });
    }

    // Build query
    const query = {
      conversationId,
      isDeleted: false
    };

    if (before) {
      query.createdAt = { $lt: new Date(before) };
    }

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
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

    res.json({
      success: true,
      data: formattedMessages
    });
  } catch (error) {
    console.error('❌ Get parent messages error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to fetch messages'
      }
    });
  }
});

/**
 * POST /api/parent/messages
 * Send a message (creates conversation if needed)
 */
router.post('/', authenticateParent, async (req, res) => {
  try {
    const parentId = req.parent._id;
    const {
      conversationId,
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

    if (!content) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_CONTENT',
          message: 'Message content is required'
        }
      });
    }

    let conversation;

    // If conversationId provided, verify parent is participant
    if (conversationId) {
      conversation = await Conversation.findById(conversationId);

      if (!conversation) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'CONVERSATION_NOT_FOUND',
            message: 'Conversation not found'
          }
        });
      }

      const isParticipant = conversation.participants.some(
        p => p.userId.toString() === parentId.toString()
      );

      if (!isParticipant) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'ACCESS_DENIED',
            message: 'You do not have access to this conversation'
          }
        });
      }
    } else {
      // Create new conversation
      if (!receiverId || !receiverModel) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_RECEIVER',
            message: 'Receiver information is required for new conversation'
          }
        });
      }

      // Determine receiver model
      const ReceiverModel = receiverModel === 'staff' ? Staff : Parent;

      // Check if receiver exists
      const receiver = await ReceiverModel.findById(receiverId);
      if (!receiver) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'RECEIVER_NOT_FOUND',
            message: 'Receiver not found'
          }
        });
      }

      // Find or create conversation
      const existingConversation = await Conversation.findOne({
        type: 'direct',
        'participants.userId': { $all: [parentId, receiverId] }
      });

      if (existingConversation) {
        conversation = existingConversation;
      } else {
        // Create new conversation
        conversation = new Conversation({
          type: 'direct',
          participants: [
            {
              userId: parentId,
              userModel: 'Parent',
              unreadCount: 0
            },
            {
              userId: receiverId,
              userModel: receiverModel === 'staff' ? 'Staff' : 'Parent',
              unreadCount: 0
            }
          ],
          lastMessage: {},
          createdBy: parentId
        });

        await conversation.save();
      }
    }

    // Get other participant for receiver info
    const otherParticipant = conversation.participants.find(
      p => p.userId.toString() !== parentId.toString()
    );

    if (!otherParticipant) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_CONVERSATION',
          message: 'Conversation must have at least 2 participants'
        }
      });
    }

    // Build message data
    const messageData = {
      conversationId: conversation._id,
      senderId: parentId,
      senderModel: 'Parent',
      receiverId: otherParticipant.userId,
      receiverModel: otherParticipant.userModel,
      content,
      type,
      fileUrl,
      fileName,
      fileSize,
      status: 'sent'
    };

    // Handle replyTo
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
    conversation.lastMessage = {
      content,
      senderId: parentId,
      senderName: req.parent.name,
      timestamp: new Date(),
      type
    };
    await conversation.save();

    // Increment unread for receiver
    await conversation.incrementUnread(otherParticipant.userId);

    res.status(201).json({
      success: true,
      data: {
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
      }
    });
  } catch (error) {
    console.error('❌ Send parent message error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to send message'
      }
    });
  }
});

/**
 * PUT /api/parent/messages/:id/read
 * Mark messages in a conversation as read
 */
router.put('/:id/read', authenticateParent, async (req, res) => {
  try {
    const { id: conversationId } = req.params;
    const parentId = req.parent._id;

    // Verify parent is part of this conversation
    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'CONVERSATION_NOT_FOUND',
          message: 'Conversation not found'
        }
      });
    }

    const isParticipant = conversation.participants.some(
      p => p.userId.toString() === parentId.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'You do not have access to this conversation'
        }
      });
    }

    // Mark messages as read
    await Message.updateMany(
      {
        conversationId,
        receiverId: parentId,
        status: { $ne: 'read' }
      },
      {
        status: 'read',
        readAt: new Date()
      }
    );

    // Reset unread count
    await conversation.resetUnread(parentId);

    res.json({
      success: true,
      message: 'Messages marked as read'
    });
  } catch (error) {
    console.error('❌ Mark parent messages read error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to mark messages as read'
      }
    });
  }
});

export default router;
