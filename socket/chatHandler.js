import Message from '../models/Message.js';
import Conversation from '../models/Conversation.js';
import UserPresence from '../models/UserPresence.js';
import { Staff, Student, Parent } from '../database.js';
import { hasPermission, canMessageUser, CHAT_PERMISSIONS } from '../middleware/chatPermissions.js';
import { verifyToken, extractTokenFromRequest } from '../middleware/auth.js';

// Store active users: userId -> socketId
const activeUsers = new Map();

// Store typing users: conversationId -> Set of userIds
const typingUsers = new Map();

export function initializeChatHandlers(io) {
  // Connection-level auth middleware: validate JWT from cookie before the socket is accepted.
  // Clients that pass a token via the 'authenticate' event are also supported (mobile/legacy).
  io.use((socket, next) => {
    try {
      const fakeReq = { headers: { cookie: socket.handshake?.headers?.cookie || '' } };
      const cookieToken = extractTokenFromRequest(fakeReq);
      const handshakeToken = socket.handshake?.auth?.token;

      const token = cookieToken || handshakeToken;

      if (!token) {
        // Allow connection without cookie token — mobile clients authenticate via event
        return next();
      }

      const decoded = verifyToken(token);
      if (decoded?.userId) {
        // Pre-populate userId so cookie-based clients skip the 'authenticate' event
        socket._preAuthUserId = decoded.userId;
        socket._preAuthUserType = decoded.userType || 'staff';
      }
      next();
    } catch {
      next(); // Allow connection — event-level auth will still validate
    }
  });

  io.on('connection', (socket) => {
    // Authentication
    socket.on('authenticate', async (data) => {
      try {
        // Accept token from event data (legacy/mobile) or from httpOnly cookie in handshake
        let token = data?.token;
        if (!token) {
          const fakeReq = { headers: { cookie: socket.handshake?.headers?.cookie || '' } };
          token = extractTokenFromRequest(fakeReq);
        }

        if (!token) {
          console.error('❌ Invalid authentication data: missing token');
          socket.emit('error', { message: 'Authentication token required' });
          return;
        }

        // Verify JWT token — identity comes from the signed token, not client data
        const decoded = verifyToken(token);
        if (!decoded) {
          console.error('❌ Invalid or expired JWT token');
          socket.emit('error', { message: 'Invalid or expired token' });
          return;
        }

        const userId = decoded.userId;
        const userType = decoded.userType || 'staff';

        if (!userId || !['staff', 'student', 'parent'].includes(userType)) {
          console.error('❌ Invalid token payload: missing userId or invalid userType');
          socket.emit('error', { message: 'Invalid token payload' });
          return;
        }

        // Verify user exists
        const getUserModel = (userType) => {
          switch (userType) {
            case 'staff':
              return Staff;
            case 'student':
              return Student;
            case 'parent':
              return Parent;
            default:
              throw new Error(`Invalid user type: ${userType}`);
          }
        };

        const UserModel = getUserModel(userType);
        const user = await UserModel.findById(userId);

        if (!user) {
          console.error('❌ User not found:', userId);
          socket.emit('error', { message: 'User not found' });
          return;
        }

        // Store user info in socket (including schoolId for multi-tenancy)
        socket.userId = userId;
        socket.userType = userType;
        socket.userModel =
          userType === 'staff' ? 'Staff' : userType === 'parent' ? 'Parent' : 'Student';
        socket.schoolId = user.schoolId ? user.schoolId.toString() : decoded.schoolId || null;

        // Add to active users
        activeUsers.set(userId, socket.id);

        // Update presence
        await UserPresence.setOnline(userId, socket.userModel, socket.id, {
          platform: 'web',
          userAgent: socket.handshake.headers['user-agent'],
        });

        // Join user's personal room
        socket.join(`user:${userId}`);

        // If parent, also join student rooms for their children
        if (userType === 'parent' && user.children) {
          for (const child of user.children) {
            const childStudentId = (child.studentId || child).toString();
            socket.join(`student:${childStudentId}`);
          }
        }

        // Emit authentication success IMMEDIATELY
        socket.emit('authenticated', {
          userId,
          userType,
          message: 'Successfully authenticated',
        });

        // Broadcast user online status - FIXED: Only to relevant users (do this AFTER emitting authenticated)
        const userConversations = await Conversation.find({
          participants: { $elemMatch: { userId: userId } },
        }).populate('participants.userId', '_id');

        const relevantUserIds = new Set();
        userConversations.forEach((conv) => {
          conv.participants.forEach((p) => {
            if (p.userId && p.userId._id && p.userId._id.toString() !== userId) {
              relevantUserIds.add(p.userId._id.toString());
            }
          });
        });

        // Emit to relevant users only
        Array.from(relevantUserIds).forEach((relevantUserId) => {
          const userSocketId = activeUsers.get(relevantUserId);
          if (userSocketId) {
            io.to(userSocketId).emit('user_status', {
              userId: userId,
              status: 'online',
              timestamp: new Date(),
            });
          }
        });
      } catch (error) {
        console.error('❌ Authentication error:', error);
        socket.emit('error', { message: 'Authentication failed', details: error.message });
      }
    });

    // Join conversation room
    socket.on('join_conversation', async (data) => {
      try {
        const { conversationId } = data;

        if (!socket.userId) {
          socket.emit('error', { message: 'Not authenticated' });
          return;
        }

        // Verify conversation exists and user is participant
        const conversation = await Conversation.findById(conversationId);

        if (!conversation) {
          socket.emit('error', { message: 'Conversation not found' });
          return;
        }

        const isParticipant = conversation.participants.some(
          (p) => p.userId.toString() === socket.userId
        );

        if (!isParticipant) {
          socket.emit('error', { message: 'Not a participant' });
          return;
        }

        // Join conversation room
        socket.join(`conversation:${conversationId}`);

        // Reset unread count
        await conversation.resetUnread(socket.userId);

        socket.emit('joined_conversation', { conversationId });
      } catch (error) {
        console.error('❌ Join conversation error:', error);
        socket.emit('error', { message: 'Failed to join conversation' });
      }
    });

    // Send message
    socket.on('send_message', async (data) => {
      try {
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
          forwardedFrom,
          duration,
          waveform,
          clientMessageId,
        } = data;

        if (!socket.userId) {
          console.error('❌ Socket not authenticated');
          socket.emit('error', { message: 'Not authenticated' });
          return;
        }

        // Idempotency check: if client sent a clientMessageId, check for existing message
        if (clientMessageId) {
          const existingMessage = await Message.findOne({
            clientMessageId,
            senderId: socket.userId,
          }).populate('senderId', 'name photo');
          if (existingMessage) {
            const socketMessage = {
              id: existingMessage._id,
              clientMessageId: existingMessage.clientMessageId,
              conversationId: existingMessage.conversationId,
              senderId: existingMessage.senderId._id,
              senderName: existingMessage.senderId.name,
              senderAvatar: existingMessage.senderId.photo,
              content: existingMessage.content,
              type: existingMessage.type,
              fileUrl: existingMessage.fileUrl,
              fileName: existingMessage.fileName,
              fileSize: existingMessage.fileSize,
              duration: existingMessage.duration || 0,
              waveform: existingMessage.waveform || [],
              status: existingMessage.status,
              createdAt: existingMessage.createdAt,
              replyTo: null,
              forwardedFrom: existingMessage.forwardedFrom?.messageId
                ? existingMessage.forwardedFrom
                : null,
              pinned: existingMessage.pinned || false,
              pinnedBy: existingMessage.pinnedBy || [],
              reactions: existingMessage.reactions || [],
              isEdited: existingMessage.isEdited || false,
            };
            // Re-emit to sender only so they get confirmation without creating duplicates for others
            socket.emit('new_message', { message: socketMessage });
            return;
          }
        }

        // Check if user has permission to send messages
        const canSend = await hasPermission(
          socket.userId,
          socket.userType,
          CHAT_PERMISSIONS.SEND_MESSAGE
        );
        if (!canSend) {
          socket.emit('error', { message: 'You do not have permission to send messages' });
          return;
        }

        // NOTE: We don't check canMessageUser here anymore since we gave basic permissions to all staff
        // They can message anyone as long as they have SEND_MESSAGE permission

        // Find or create conversation (scoped by schoolId for multi-tenancy)
        let conversation;
        if (conversationId) {
          const convQuery = { _id: conversationId };
          if (socket.schoolId) convQuery.schoolId = socket.schoolId;
          conversation = await Conversation.findOne(convQuery);
        } else if (receiverId) {
          conversation = await Conversation.findOrCreate(
            socket.userId,
            socket.userModel,
            receiverId,
            receiverModel,
            socket.schoolId
          );
        }

        if (!conversation) {
          socket.emit('error', { message: 'Invalid conversation' });
          return;
        }

        // Participant check: when the client supplied an existing
        // conversationId, the socket user MUST be a participant of that
        // conversation. Without this any authed socket in the same school
        // could inject messages into arbitrary conversations. (The
        // join_conversation handler at line 174 already enforces this for
        // reading — same rule should apply on write.)
        if (conversationId) {
          const isParticipant = conversation.participants.some(
            (p) => p.userId.toString() === socket.userId.toString()
          );
          if (!isParticipant) {
            socket.emit('error', { message: 'Not a participant of this conversation' });
            return;
          }
        }

        // Provide default content for non-text messages if not provided
        let messageContent = content;
        if (!messageContent || messageContent.trim() === '') {
          if (type === 'audio' || type === 'voice') {
            messageContent = '🎤 Voice message';
          } else if (type === 'image') {
            messageContent = '📷 Image';
          } else if (type === 'file') {
            messageContent = '📎 File';
          } else if (type === 'video') {
            messageContent = '🎬 Video';
          } else {
            messageContent = '';
          }
        }

        // Create message (always include schoolId for multi-tenancy)
        const messageData = {
          conversationId: conversation._id,
          senderId: socket.userId,
          senderModel: socket.userModel,
          receiverId:
            receiverId ||
            conversation.participants.find((p) => p.userId.toString() !== socket.userId).userId,
          receiverModel:
            receiverModel ||
            conversation.participants.find((p) => p.userId.toString() !== socket.userId).userModel,
          content: messageContent,
          type,
          fileUrl,
          fileName,
          fileSize,
          duration: duration || 0,
          waveform: waveform || [],
          status: 'sent',
          ...(socket.schoolId && { schoolId: socket.schoolId }),
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

        // Populate sender info and replyTo
        await message.populate('senderId', 'name photo');
        if (message.replyTo) {
          await message.populate('replyTo');
        }

        // Update conversation last message
        conversation.lastMessage = {
          content: messageContent,
          senderId: socket.userId,
          senderName: message.senderId.name,
          timestamp: new Date(),
          type,
        };
        await conversation.save();

        // Increment unread for other participants
        for (const participant of conversation.participants) {
          if (participant.userId.toString() !== socket.userId) {
            await conversation.incrementUnread(participant.userId);
          }
        }

        // Emit to conversation room (including sender so they get the confirmed message)
        const socketMessage = {
          id: message._id,
          clientMessageId: message.clientMessageId || null,
          conversationId: conversation._id,
          senderId: message.senderId._id,
          senderName: message.senderId.name,
          senderAvatar: message.senderId.photo,
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
          pinned: message.pinned || false,
          pinnedBy: message.pinnedBy || [],
          reactions: message.reactions || [],
          isEdited: message.isEdited || false,
        };

        // Emit to entire conversation room (includes sender)
        io.to(`conversation:${conversation._id}`).emit('new_message', { message: socketMessage });

        // Emit to receiver's personal room (for notification)
        const receiverUserId = conversation.participants.find(
          (p) => p.userId.toString() !== socket.userId
        )?.userId;

        if (receiverUserId) {
          io.to(`user:${receiverUserId}`).emit('message_notification', {
            conversationId: conversation._id,
            message: {
              id: message._id,
              senderName: message.senderId.name,
              content: message.content,
              type: message.type,
            },
          });
        }
      } catch (error) {
        console.error('❌ Send message error:', error);
        console.error('❌ Error stack:', error.stack);
        console.error('❌ Error details:', {
          name: error.name,
          message: error.message,
          code: error.code,
        });
        socket.emit('error', { message: 'Failed to send message', error: error.message });
      }
    });

    // Typing indicator - FIXED: Add auto-clear timeout
    socket.on('typing', async (data) => {
      try {
        const { conversationId, isTyping } = data;

        if (!socket.userId) return;

        if (isTyping) {
          if (!typingUsers.has(conversationId)) {
            typingUsers.set(conversationId, new Set());
          }
          typingUsers.get(conversationId).add(socket.userId);

          // Auto-clear typing after 3 seconds - NEW
          if (socket.typingTimeout) {
            clearTimeout(socket.typingTimeout);
          }
          socket.typingTimeout = setTimeout(() => {
            if (typingUsers.has(conversationId)) {
              typingUsers.get(conversationId).delete(socket.userId);
              if (typingUsers.get(conversationId).size === 0) {
                typingUsers.delete(conversationId);
              }
            }
            socket.to(`conversation:${conversationId}`).emit('user_typing', {
              conversationId,
              userId: socket.userId,
              isTyping: false,
            });
          }, 3000);
        } else {
          if (typingUsers.has(conversationId)) {
            typingUsers.get(conversationId).delete(socket.userId);
            if (typingUsers.get(conversationId).size === 0) {
              typingUsers.delete(conversationId);
            }
          }
          if (socket.typingTimeout) {
            clearTimeout(socket.typingTimeout);
            socket.typingTimeout = null;
          }
        }

        // Broadcast to conversation room (except sender)
        socket.to(`conversation:${conversationId}`).emit('user_typing', {
          conversationId,
          userId: socket.userId,
          isTyping,
        });
      } catch (error) {
        console.error('❌ Typing indicator error:', error);
      }
    });

    // Mark message as read
    socket.on('mark_read', async (data) => {
      try {
        const { messageId, conversationId } = data;

        if (!socket.userId) return;

        if (messageId) {
          // Mark single message as read
          const message = await Message.findByIdAndUpdate(
            messageId,
            {
              status: 'read',
              readAt: new Date(),
            },
            { new: true }
          );

          if (message) {
            // Notify sender
            io.to(`user:${message.senderId}`).emit('message_read', {
              messageId: message._id,
              conversationId: message.conversationId,
              readBy: socket.userId,
              readAt: message.readAt,
            });
          }
        } else if (conversationId) {
          // Mark all messages in conversation as read
          await Message.updateMany(
            {
              conversationId,
              receiverId: socket.userId,
              status: { $ne: 'read' },
            },
            {
              status: 'read',
              readAt: new Date(),
            }
          );

          // Reset unread count
          const conversation = await Conversation.findById(conversationId);
          if (conversation) {
            await conversation.resetUnread(socket.userId);
          }

          // Notify other participants
          socket.to(`conversation:${conversationId}`).emit('messages_read', {
            conversationId,
            readBy: socket.userId,
          });
        }
      } catch (error) {
        console.error('❌ Mark read error:', error);
      }
    });

    // Disconnect - FIXED: Clean up typing users and ensure cleanup always happens
    socket.on('disconnect', async () => {
      try {
        if (socket.userId) {
          // Remove from active users
          activeUsers.delete(socket.userId);

          // Clean up typing indicators for this user
          typingUsers.forEach((typingSet, conversationId) => {
            if (typingSet.has(socket.userId)) {
              typingSet.delete(socket.userId);
              // If set is empty, remove it
              if (typingSet.size === 0) {
                typingUsers.delete(conversationId);
              }
            }
          });

          // Update presence
          await UserPresence.setOffline(socket.userId);

          // Broadcast user offline status - FIXED: Only to relevant users
          const userConversations = await Conversation.find({
            'participants.userId': socket.userId,
          }).populate('participants.userId', '_id');

          const relevantUserIds = new Set();
          userConversations.forEach((conv) => {
            conv.participants.forEach((p) => {
              if (p.userId && p.userId._id && p.userId._id.toString() !== socket.userId) {
                relevantUserIds.add(p.userId._id.toString());
              }
            });
          });

          // Emit to relevant users only
          Array.from(relevantUserIds).forEach((userId) => {
            const userSocketId = activeUsers.get(userId);
            if (userSocketId) {
              io.to(userSocketId).emit('user_status', {
                userId: socket.userId,
                status: 'offline',
                lastSeen: new Date(),
              });
            }
          });
        }
      } catch (error) {
        console.error('❌ Disconnect error:', error);
      }
    });

    // Handle socket errors to ensure cleanup
    socket.on('error', (error) => {
      console.error('❌ Socket error for user:', socket.userId, error);
      // Trigger disconnect cleanup
      socket.disconnect(true);
    });
  });

  // Handle io-level errors
  io.on('error', (error) => {
    console.error('❌ Socket.IO server error:', error);
  });

  // Periodic cleanup of stale data (every 5 minutes)
  setInterval(
    () => {
      try {
        // Clean up empty typing user sets
        typingUsers.forEach((typingSet, conversationId) => {
          if (typingSet.size === 0) {
            typingUsers.delete(conversationId);
          }
        });
      } catch (error) {
        console.error('❌ Cleanup error:', error);
      }
    },
    5 * 60 * 1000
  ); // 5 minutes
}

export { activeUsers, typingUsers };
