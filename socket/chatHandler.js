import Message from '../models/Message.js';
import Conversation from '../models/Conversation.js';
import UserPresence from '../models/UserPresence.js';
import { Staff, Student, Parent } from '../database.js';
import { hasPermission, canMessageUser, CHAT_PERMISSIONS } from '../middleware/chatPermissions.js';

// Store active users: userId -> socketId
const activeUsers = new Map();

// Store typing users: conversationId -> Set of userIds
const typingUsers = new Map();

export function initializeChatHandlers(io) {
  io.on('connection', (socket) => {
    console.log('🔌 New socket connection:', socket.id);
    
    // Authentication
    socket.on('authenticate', async (data) => {
      console.log('🔐 Authentication attempt:', { userId: data?.userId, userType: data?.userType });
      
      try {
        const { userId, userType } = data;
        
        if (!userId || !userType) {
          console.error('❌ Invalid authentication data:', data);
          socket.emit('error', { message: 'Invalid authentication data' });
          return;
        }

        // Verify user exists
        const getUserModel = (userType) => {
          switch (userType) {
            case 'staff': return Staff;
            case 'student': return Student;
            case 'parent': return Parent;
            default: throw new Error(`Invalid user type: ${userType}`);
          }
        };

        const UserModel = getUserModel(userType);
        const user = await UserModel.findById(userId);

        if (!user) {
          console.error('❌ User not found:', userId);
          socket.emit('error', { message: 'User not found' });
          return;
        }

        // Store user info in socket
        socket.userId = userId;
        socket.userType = userType;
        socket.userModel = userType === 'staff' ? 'Staff' : userType === 'parent' ? 'Parent' : 'Student';

        // Add to active users
        activeUsers.set(userId, socket.id);

        // Update presence
        await UserPresence.setOnline(userId, socket.userModel, socket.id, {
          platform: 'web',
          userAgent: socket.handshake.headers['user-agent']
        });

        // Join user's personal room
        socket.join(`user:${userId}`);

        // If parent, also join student rooms for their children
        if (userType === 'parent' && user.children) {
          for (const child of user.children) {
            const childStudentId = (child.studentId || child).toString();
            socket.join(`student:${childStudentId}`);
            console.log(`👨‍👩‍👧 Parent ${userId} joined student room: student:${childStudentId}`);
          }
        }

        // Emit authentication success IMMEDIATELY
        console.log('✅ Authentication successful, emitting authenticated event for:', userId);
        socket.emit('authenticated', {
          userId,
          userType,
          message: 'Successfully authenticated'
        });

        // Broadcast user online status - FIXED: Only to relevant users (do this AFTER emitting authenticated)
        const userConversations = await Conversation.find({
          participants: { $elemMatch: { userId: userId } }
        }).populate('participants.userId', '_id');
        
        const relevantUserIds = new Set();
        userConversations.forEach(conv => {
          conv.participants.forEach(p => {
            if (p.userId && p.userId._id && p.userId._id.toString() !== userId) {
              relevantUserIds.add(p.userId._id.toString());
            }
          });
        });
        
        // Emit to relevant users only
        Array.from(relevantUserIds).forEach(relevantUserId => {
          const userSocketId = activeUsers.get(relevantUserId);
          if (userSocketId) {
            io.to(userSocketId).emit('user_status', {
              userId: userId,
              status: 'online',
              timestamp: new Date()
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
          p => p.userId.toString() === socket.userId
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
        console.log('📨 Received send_message event:', JSON.stringify(data, null, 2));

        const { conversationId, receiverId, receiverModel, content, type = 'text', fileUrl, fileName, fileSize, replyTo, forwardedFrom, duration, waveform } = data;

        if (!socket.userId) {
          console.error('❌ Socket not authenticated');
          socket.emit('error', { message: 'Not authenticated' });
          return;
        }

        console.log('📨 Processing message from:', socket.userId, 'type:', type, 'fileUrl:', fileUrl ? 'present' : 'missing');

        // Check if user has permission to send messages
        const canSend = await hasPermission(socket.userId, socket.userType, CHAT_PERMISSIONS.SEND_MESSAGE);
        if (!canSend) {
          socket.emit('error', { message: 'You do not have permission to send messages' });
          return;
        }

        // NOTE: We don't check canMessageUser here anymore since we gave basic permissions to all staff
        // They can message anyone as long as they have SEND_MESSAGE permission

        // Find or create conversation
        let conversation;
        if (conversationId) {
          conversation = await Conversation.findById(conversationId);
        } else if (receiverId) {
          conversation = await Conversation.findOrCreate(
            socket.userId,
            socket.userModel,
            receiverId,
            receiverModel
          );
        }

        if (!conversation) {
          socket.emit('error', { message: 'Invalid conversation' });
          return;
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

        // Create message
        const messageData = {
          conversationId: conversation._id,
          senderId: socket.userId,
          senderModel: socket.userModel,
          receiverId: receiverId || conversation.participants.find(p => p.userId.toString() !== socket.userId).userId,
          receiverModel: receiverModel || conversation.participants.find(p => p.userId.toString() !== socket.userId).userModel,
          content: messageContent,
          type,
          fileUrl,
          fileName,
          fileSize,
          duration: duration || 0,
          waveform: waveform || [],
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

        // Handle forwardedFrom - only add if it has valid data
        if (forwardedFrom && forwardedFrom.messageId) {
          messageData.forwardedFrom = forwardedFrom;
        }

        // Debug: Log message data for voice/audio messages
        if (type === 'audio' || type === 'voice') {
          console.log('🎤 Creating voice/audio message:', {
            fileUrl: messageData.fileUrl,
            duration: messageData.duration,
            waveformLength: messageData.waveform?.length,
            content: messageData.content
          });
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
          type
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
          replyTo: message.replyTo ? {
            messageId: message.replyTo._id,
            content: message.replyTo.content,
            senderId: message.replyTo.senderId,
            senderName: message.replyTo.senderId?.name || 'Unknown'
          } : null,
          forwardedFrom: message.forwardedFrom?.messageId ? message.forwardedFrom : null,
          pinned: message.pinned || false,
          pinnedBy: message.pinnedBy || [],
          reactions: message.reactions || [],
          isEdited: message.isEdited || false
        };

        // Debug: Log voice/audio message emission
        if (type === 'audio' || type === 'voice') {
          console.log('🎤 Emitting voice/audio message:', {
            id: socketMessage.id,
            type: socketMessage.type,
            fileUrl: socketMessage.fileUrl,
            duration: socketMessage.duration,
            waveformLength: socketMessage.waveform?.length
          });
        }

        // Emit to entire conversation room (includes sender)
        io.to(`conversation:${conversation._id}`).emit('new_message', { message: socketMessage });

        // Emit to receiver's personal room (for notification)
        const receiverUserId = conversation.participants.find(
          p => p.userId.toString() !== socket.userId
        )?.userId;

        if (receiverUserId) {
          io.to(`user:${receiverUserId}`).emit('message_notification', {
            conversationId: conversation._id,
            message: {
              id: message._id,
              senderName: message.senderId.name,
              content: message.content,
              type: message.type
            }
          });
        }
      } catch (error) {
        console.error('❌ Send message error:', error);
        console.error('❌ Error stack:', error.stack);
        console.error('❌ Error details:', {
          name: error.name,
          message: error.message,
          code: error.code
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
              isTyping: false
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
          isTyping
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
              readAt: new Date()
            },
            { new: true }
          );

          if (message) {
            // Notify sender
            io.to(`user:${message.senderId}`).emit('message_read', {
              messageId: message._id,
              conversationId: message.conversationId,
              readBy: socket.userId,
              readAt: message.readAt
            });
          }
        } else if (conversationId) {
          // Mark all messages in conversation as read
          await Message.updateMany(
            {
              conversationId,
              receiverId: socket.userId,
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
            await conversation.resetUnread(socket.userId);
          }

          // Notify other participants
          socket.to(`conversation:${conversationId}`).emit('messages_read', {
            conversationId,
            readBy: socket.userId
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
            'participants.userId': socket.userId
          }).populate('participants.userId', '_id');
          
          const relevantUserIds = new Set();
          userConversations.forEach(conv => {
            conv.participants.forEach(p => {
              if (p.userId && p.userId._id && p.userId._id.toString() !== socket.userId) {
                relevantUserIds.add(p.userId._id.toString());
              }
            });
          });
          
          // Emit to relevant users only
          Array.from(relevantUserIds).forEach(userId => {
            const userSocketId = activeUsers.get(userId);
            if (userSocketId) {
              io.to(userSocketId).emit('user_status', {
                userId: socket.userId,
                status: 'offline',
                lastSeen: new Date()
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
  setInterval(() => {
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
  }, 5 * 60 * 1000); // 5 minutes
}

export { activeUsers, typingUsers };
