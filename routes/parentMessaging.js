import express from 'express';
import { z } from 'zod';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { rateLimit } from 'express-rate-limit';
import { Conversation, Message, Parent, Staff } from '../database.js';
import { authenticateParent } from '../middleware/parentAuth.js';
import UserPresence from '../models/UserPresence.js';

const editMessageSchema = z.object({
  content: z.string().min(1, 'Content is required').max(1000, 'Message too long'),
});

const sendMessageSchema = z
  .object({
    conversationId: z.string().optional(),
    receiverId: z.string().optional(),
    receiverModel: z.enum(['staff', 'parent']).optional(),
    content: z.string().max(1000, 'Message too long').default(''),
    type: z.enum(['text', 'image', 'file', 'audio', 'voice', 'video']).default('text'),
    fileUrl: z.string().url('Invalid file URL').optional(),
    fileName: z.string().max(255).optional(),
    fileSize: z.number().min(0).optional(),
    replyTo: z.union([z.string(), z.object({ messageId: z.string() })]).optional(),
    forwardedFrom: z.string().optional(),
  })
  .refine((data) => data.content || data.fileUrl, {
    message: 'Message must have content or a file attachment',
  });

const CHAT_ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

const chatUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (CHAT_ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type '${file.mimetype}' is not allowed`));
    }
  },
});

const chatUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: 'Too many uploads, please try again later.',
});

const router = express.Router();

/**
 * POST /api/parent/messages/upload
 * Upload a file attachment for chat (image or document)
 */
router.post(
  '/upload',
  authenticateParent,
  chatUploadLimiter,
  chatUpload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: { code: 'NO_FILE', message: 'No file uploaded' },
        });
      }

      const isCloudinaryConfigured = !!(
        process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET
      );

      if (!isCloudinaryConfigured) {
        return res.status(503).json({
          success: false,
          error: {
            code: 'STORAGE_NOT_CONFIGURED',
            message: 'File storage is not configured. Contact support.',
          },
        });
      }

      const resourceType = req.file.mimetype.startsWith('image/') ? 'image' : 'raw';
      const b64 = Buffer.from(req.file.buffer).toString('base64');
      const dataURI = `data:${req.file.mimetype};base64,${b64}`;

      const result = await cloudinary.uploader.upload(dataURI, {
        resource_type: resourceType,
        folder: 'chat_attachments',
        public_id: `chat_${Date.now()}_${req.file.originalname.replace(/[^a-zA-Z0-9]/g, '_')}`,
        timeout: 60000,
      });

      res.json({
        success: true,
        data: {
          url: result.secure_url,
          fileName: req.file.originalname,
          fileSize: req.file.size,
          mimeType: req.file.mimetype,
          resourceType: result.resource_type,
        },
      });
    } catch (error) {
      if (error.message?.includes('not allowed')) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_FILE_TYPE', message: error.message },
        });
      }
      console.error('❌ Parent chat upload error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Upload failed' },
      });
    }
  }
);

/**
 * GET /api/parent/messages/conversations
 * Get all conversations for the authenticated parent
 */
router.get('/conversations', authenticateParent, async (req, res) => {
  try {
    const parentId = req.parent._id;
    const skip = parseInt(req.query.skip) || 0;
    const limit = parseInt(req.query.limit) || 30;

    const baseQuery = {
      'participants.userId': parentId,
      isArchived: false,
      schoolId: req.schoolId,
    };
    const total = await Conversation.countDocuments(baseQuery);

    const conversations = await Conversation.find(baseQuery)
      .sort({ 'lastMessage.timestamp': -1 })
      .skip(skip)
      .limit(limit)
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
              lastSeen: presence?.lastSeen,
            };
          })
        );

        // Get the other participant (for direct chats)
        const otherParticipant = participants.find(
          (p) => p.userId.toString() !== parentId.toString()
        );

        return {
          id: conv._id,
          type: conv.type,
          participants,
          otherParticipant,
          groupName: conv.groupName,
          groupAvatar: conv.groupAvatar,
          lastMessage: conv.lastMessage,
          unreadCount:
            conv.participants.find((p) => p.userId.toString() === parentId.toString())
              ?.unreadCount || 0,
          updatedAt: conv.updatedAt,
        };
      })
    );

    const convsHasMore = skip + enrichedConversations.length < total;
    res.json({
      success: true,
      data: enrichedConversations,
      hasMore: convsHasMore,
      nextCursor: convsHasMore ? String(skip + limit) : undefined,
      total,
    });
  } catch (error) {
    console.error('❌ Get parent conversations error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to fetch conversations',
      },
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
    const conversation = await Conversation.findOne({
      _id: conversationId,
      schoolId: req.schoolId,
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'CONVERSATION_NOT_FOUND',
          message: 'Conversation not found',
        },
      });
    }

    const isParticipant = conversation.participants.some(
      (p) => p.userId.toString() === parentId.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'You do not have access to this conversation',
        },
      });
    }

    // Build query — include soft-deleted so clients can show "deleted" placeholder
    const query = { conversationId };

    if (before) {
      query.createdAt = { $lt: new Date(before) };
    }

    // Fetch one extra to detect if there are more pages
    const rawMessages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .populate('senderId', 'name photo')
      .populate('receiverId', 'name photo')
      .lean();

    const hasMore = rawMessages.length > limit;
    const messages = hasMore ? rawMessages.slice(0, limit) : rawMessages;

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
      status: msg.status,
      readAt: msg.readAt,
      createdAt: msg.createdAt,
      replyTo: msg.replyTo,
      pinned: msg.pinned || false,
      pinnedBy: msg.pinnedBy || [],
      reactions: msg.reactions || [],
      isEdited: msg.isEdited || false,
      isDeleted: msg.isDeleted || false,
      forwardedFrom: msg.forwardedFrom || null,
    }));

    // nextCursor is the createdAt of the oldest message (first after reverse = index 0)
    const nextCursor =
      hasMore && formattedMessages.length > 0
        ? formattedMessages[0].createdAt.toISOString()
        : undefined;

    res.json({
      success: true,
      data: formattedMessages,
      hasMore,
      nextCursor,
    });
  } catch (error) {
    console.error('❌ Get parent messages error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to fetch messages',
      },
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

    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      });
    }

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
    } = parsed.data;

    let conversation;

    // If conversationId provided, verify parent is participant
    if (conversationId) {
      conversation = await Conversation.findOne({ _id: conversationId, schoolId: req.schoolId });

      if (!conversation) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'CONVERSATION_NOT_FOUND',
            message: 'Conversation not found',
          },
        });
      }

      const isParticipant = conversation.participants.some(
        (p) => p.userId.toString() === parentId.toString()
      );

      if (!isParticipant) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'ACCESS_DENIED',
            message: 'You do not have access to this conversation',
          },
        });
      }
    } else {
      // Create new conversation
      if (!receiverId || !receiverModel) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_RECEIVER',
            message: 'Receiver information is required for new conversation',
          },
        });
      }

      // Determine receiver model
      const ReceiverModel = receiverModel === 'staff' ? Staff : Parent;

      // Check if receiver exists (scoped to same school)
      const receiver = await ReceiverModel.findOne({ _id: receiverId, schoolId: req.schoolId });
      if (!receiver) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'RECEIVER_NOT_FOUND',
            message: 'Receiver not found',
          },
        });
      }

      // Find or create conversation
      const existingConversation = await Conversation.findOne({
        type: 'direct',
        schoolId: req.schoolId,
        'participants.userId': { $all: [parentId, receiverId] },
      });

      if (existingConversation) {
        conversation = existingConversation;
      } else {
        // Create new conversation
        conversation = new Conversation({
          type: 'direct',
          schoolId: req.schoolId,
          participants: [
            {
              userId: parentId,
              userModel: 'Parent',
              unreadCount: 0,
            },
            {
              userId: receiverId,
              userModel: receiverModel === 'staff' ? 'Staff' : 'Parent',
              unreadCount: 0,
            },
          ],
          lastMessage: {},
          createdBy: parentId,
        });

        await conversation.save();
      }
    }

    // Get other participant for receiver info
    const otherParticipant = conversation.participants.find(
      (p) => p.userId.toString() !== parentId.toString()
    );

    if (!otherParticipant) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_CONVERSATION',
          message: 'Conversation must have at least 2 participants',
        },
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
      status: 'sent',
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
      type,
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
        fileUrl: message.fileUrl,
        fileName: message.fileName,
        fileSize: message.fileSize,
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
        forwardedFrom: message.forwardedFrom,
      },
    });
  } catch (error) {
    console.error('❌ Send parent message error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to send message',
      },
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
    const conversation = await Conversation.findOne({
      _id: conversationId,
      schoolId: req.schoolId,
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'CONVERSATION_NOT_FOUND',
          message: 'Conversation not found',
        },
      });
    }

    const isParticipant = conversation.participants.some(
      (p) => p.userId.toString() === parentId.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'You do not have access to this conversation',
        },
      });
    }

    // Mark messages as read
    await Message.updateMany(
      {
        conversationId,
        receiverId: parentId,
        status: { $ne: 'read' },
      },
      {
        status: 'read',
        readAt: new Date(),
      }
    );

    // Reset unread count
    await conversation.resetUnread(parentId);

    res.json({
      success: true,
      message: 'Messages marked as read',
    });
  } catch (error) {
    console.error('❌ Mark parent messages read error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to mark messages as read',
      },
    });
  }
});

/**
 * PUT /api/parent/messages/:messageId
 * Edit a sent message (sender only)
 */
router.put('/:messageId', authenticateParent, async (req, res) => {
  try {
    const { messageId } = req.params;
    const parentId = req.parent._id;

    const parsed = editMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      });
    }
    const { content } = parsed.data;

    const message = await Message.findOne({ _id: messageId, isDeleted: false });
    if (!message) {
      return res.status(404).json({
        success: false,
        error: { code: 'MESSAGE_NOT_FOUND', message: 'Message not found' },
      });
    }

    if (message.senderId.toString() !== parentId.toString()) {
      return res.status(403).json({
        success: false,
        error: { code: 'ACCESS_DENIED', message: 'You can only edit your own messages' },
      });
    }

    const conversation = await Conversation.findOne({
      _id: message.conversationId,
      schoolId: req.schoolId,
    });
    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: { code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found' },
      });
    }

    const isParticipant = conversation.participants.some(
      (p) => p.userId.toString() === parentId.toString()
    );
    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        error: { code: 'ACCESS_DENIED', message: 'You do not have access to this conversation' },
      });
    }

    message.editHistory.push({ content: message.content, editedBy: parentId });
    message.content = content;
    message.isEdited = true;
    await message.save();

    res.json({
      success: true,
      data: { id: message._id, content: message.content, isEdited: true },
    });
  } catch (error) {
    console.error('❌ Edit parent message error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to edit message' },
    });
  }
});

/**
 * DELETE /api/parent/messages/:messageId
 * Soft-delete a sent message (sender only)
 */
router.delete('/:messageId', authenticateParent, async (req, res) => {
  try {
    const { messageId } = req.params;
    const parentId = req.parent._id;

    const message = await Message.findOne({ _id: messageId, isDeleted: false });
    if (!message) {
      return res.status(404).json({
        success: false,
        error: { code: 'MESSAGE_NOT_FOUND', message: 'Message not found' },
      });
    }

    if (message.senderId.toString() !== parentId.toString()) {
      return res.status(403).json({
        success: false,
        error: { code: 'ACCESS_DENIED', message: 'You can only delete your own messages' },
      });
    }

    const conversation = await Conversation.findOne({
      _id: message.conversationId,
      schoolId: req.schoolId,
    });
    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: { code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found' },
      });
    }

    const isParticipant = conversation.participants.some(
      (p) => p.userId.toString() === parentId.toString()
    );
    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        error: { code: 'ACCESS_DENIED', message: 'You do not have access to this conversation' },
      });
    }

    message.isDeleted = true;
    message.content = '';
    await message.save();

    res.json({ success: true, message: 'Message deleted' });
  } catch (error) {
    console.error('❌ Delete parent message error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to delete message' },
    });
  }
});

export default router;
