import request from 'supertest';
import { describe, expect, it, beforeEach } from 'vitest';
import { Staff } from '../database.js';
import Message from '../models/Message.js';
import Conversation from '../models/Conversation.js';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

/**
 * Helper: creates two admin staff users within the same school and returns
 * them along with pre-built auth headers and the shared app instance.
 */
let setupSeq = 0;
async function setupTwoStaffUsers() {
  setupSeq += 1;
  const school = await createSchoolRecord({
    name: `Chat School ${setupSeq}`,
    code: `CHAT-${setupSeq}`,
  });

  const admin1 = await createStaffUser({
    name: 'Admin Alice',
    email: `alice.${setupSeq}@chat.example.com`,
    schoolId: school._id,
    staffRole: ['Admin'],
    permissionRole: 'admin',
  });
  // Set unique username to avoid compound unique index conflict (schoolId + username)
  await Staff.findByIdAndUpdate(admin1._id, { username: `alice_${setupSeq}` });

  const admin2 = await createStaffUser({
    name: 'Admin Bob',
    email: `bob.${setupSeq}@chat.example.com`,
    schoolId: school._id,
    staffRole: ['Admin'],
    permissionRole: 'admin',
  });
  await Staff.findByIdAndUpdate(admin2._id, { username: `bob_${setupSeq}` });

  const { app } = createTestApp();
  const headers1 = authHeadersFor(admin1, 'admin');
  const headers2 = authHeadersFor(admin2, 'admin');

  return { school, admin1, admin2, app, headers1, headers2 };
}

/**
 * Helper: creates a direct conversation between two staff users and
 * returns the conversation document.
 */
async function createDirectConversation(admin1, admin2) {
  return Conversation.findOrCreate(admin1._id, 'Staff', admin2._id, 'Staff', admin1.schoolId);
}

/**
 * Helper: creates a message inside a conversation.
 */
async function createMessage(conversation, sender, receiver, content = 'hello') {
  return Message.create({
    schoolId: conversation.schoolId,
    conversationId: conversation._id,
    senderId: sender._id,
    senderModel: 'Staff',
    receiverId: receiver._id,
    receiverModel: 'Staff',
    content,
    type: 'text',
    status: 'sent',
  });
}

// ---------------------------------------------------------------------------

describe('messages routes', () => {
  // -----------------------------------------------------------------------
  // AUTH: 401 without token
  // -----------------------------------------------------------------------
  describe('authentication', () => {
    it('returns 401 for GET /api/messages/conversations without auth', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/messages/conversations').expect(401);
    });

    it('returns 401 for POST /api/messages/ without auth', async () => {
      const { app } = createTestApp();
      await request(app).post('/api/messages/').send({ content: 'hi' }).expect(401);
    });

    it('returns 401 for GET /api/messages/unread-count without auth', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/messages/unread-count').expect(401);
    });

    it('returns 401 for PUT /api/messages/read without auth', async () => {
      const { app } = createTestApp();
      await request(app).put('/api/messages/read').send({}).expect(401);
    });

    it('returns 401 for GET /api/messages/search without auth', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/messages/search').expect(401);
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/messages/conversations
  // -----------------------------------------------------------------------
  describe('GET /api/messages/conversations', () => {
    it('returns 200 with empty list when no query params (userId derived from session)', async () => {
      const { app, headers1 } = await setupTwoStaffUsers();

      const res = await request(app).get('/api/messages/conversations').set(headers1).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('returns empty list when user has no conversations', async () => {
      const { app, admin1, headers1 } = await setupTwoStaffUsers();

      const res = await request(app)
        .get('/api/messages/conversations')
        .query({ userId: admin1._id.toString(), userType: 'staff' })
        .set(headers1)
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('returns conversations the user is part of', async () => {
      const { app, admin1, admin2, headers1 } = await setupTwoStaffUsers();

      const conversation = await createDirectConversation(admin1, admin2);

      // Add a last message so sorting works
      conversation.lastMessage = {
        content: 'hey',
        senderId: admin1._id,
        senderName: 'Admin Alice',
        timestamp: new Date(),
        type: 'text',
      };
      await conversation.save();

      const res = await request(app)
        .get('/api/messages/conversations')
        .query({ userId: admin1._id.toString(), userType: 'staff' })
        .set(headers1)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        id: conversation._id.toString(),
        type: 'direct',
      });
      expect(res.body[0].participants).toHaveLength(2);
    });

    it('does not return deleted conversations', async () => {
      const { app, admin1, admin2, headers1 } = await setupTwoStaffUsers();

      const conversation = await createDirectConversation(admin1, admin2);
      conversation.isDeleted = true;
      await conversation.save();

      const res = await request(app)
        .get('/api/messages/conversations')
        .query({ userId: admin1._id.toString(), userType: 'staff' })
        .set(headers1)
        .expect(200);

      expect(res.body).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // POST /api/messages/conversations
  // -----------------------------------------------------------------------
  describe('POST /api/messages/conversations', () => {
    it('returns 400 when user IDs are missing', async () => {
      const { app, headers1 } = await setupTwoStaffUsers();

      await request(app).post('/api/messages/conversations').set(headers1).send({}).expect(400);
    });

    it('creates a new direct conversation between two staff users', async () => {
      const { app, admin1, admin2, headers1 } = await setupTwoStaffUsers();

      const res = await request(app)
        .post('/api/messages/conversations')
        .set(headers1)
        .send({
          user1Id: admin1._id.toString(),
          user1Type: 'staff',
          user2Id: admin2._id.toString(),
          user2Type: 'staff',
          type: 'direct',
        })
        .expect(200);

      expect(res.body).toMatchObject({
        type: 'direct',
      });
      expect(res.body.participants).toHaveLength(2);
      expect(res.body.id).toBeDefined();
    });

    it('returns the same conversation on duplicate request (idempotent)', async () => {
      const { app, admin1, admin2, headers1 } = await setupTwoStaffUsers();

      const payload = {
        user1Id: admin1._id.toString(),
        user1Type: 'staff',
        user2Id: admin2._id.toString(),
        user2Type: 'staff',
      };

      const res1 = await request(app)
        .post('/api/messages/conversations')
        .set(headers1)
        .send(payload)
        .expect(200);

      const res2 = await request(app)
        .post('/api/messages/conversations')
        .set(headers1)
        .send(payload)
        .expect(200);

      expect(res1.body.id).toBe(res2.body.id);
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/messages/conversations/:conversationId/messages
  // -----------------------------------------------------------------------
  describe('GET /api/messages/conversations/:id/messages', () => {
    it('returns messages for a conversation in chronological order', async () => {
      const { app, admin1, admin2, headers1 } = await setupTwoStaffUsers();
      const conversation = await createDirectConversation(admin1, admin2);

      await createMessage(conversation, admin1, admin2, 'first');
      await createMessage(conversation, admin2, admin1, 'second');

      const res = await request(app)
        .get(`/api/messages/conversations/${conversation._id}/messages`)
        .set(headers1)
        .expect(200);

      expect(res.body).toHaveLength(2);
      // Messages should be in chronological order (first before second)
      expect(res.body[0].content).toBe('first');
      expect(res.body[1].content).toBe('second');
    });

    it('respects the limit query parameter', async () => {
      const { app, admin1, admin2, headers1 } = await setupTwoStaffUsers();
      const conversation = await createDirectConversation(admin1, admin2);

      await createMessage(conversation, admin1, admin2, 'msg1');
      await createMessage(conversation, admin1, admin2, 'msg2');
      await createMessage(conversation, admin1, admin2, 'msg3');

      const res = await request(app)
        .get(`/api/messages/conversations/${conversation._id}/messages`)
        .query({ limit: 2 })
        .set(headers1)
        .expect(200);

      expect(res.body).toHaveLength(2);
    });

    it('does not return soft-deleted messages', async () => {
      const { app, admin1, admin2, headers1 } = await setupTwoStaffUsers();
      const conversation = await createDirectConversation(admin1, admin2);

      const msg = await createMessage(conversation, admin1, admin2, 'deleted msg');
      msg.isDeleted = true;
      await msg.save();

      await createMessage(conversation, admin1, admin2, 'visible msg');

      const res = await request(app)
        .get(`/api/messages/conversations/${conversation._id}/messages`)
        .set(headers1)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].content).toBe('visible msg');
    });
  });

  // -----------------------------------------------------------------------
  // POST /api/messages/ (send message)
  // -----------------------------------------------------------------------
  describe('POST /api/messages/', () => {
    it('returns 400 when required fields are missing', async () => {
      const { app, headers1 } = await setupTwoStaffUsers();

      await request(app).post('/api/messages/').set(headers1).send({ content: 'hi' }).expect(400);
    });

    it('creates a new text message and updates conversation lastMessage', async () => {
      const { app, admin1, admin2, headers1 } = await setupTwoStaffUsers();
      const conversation = await createDirectConversation(admin1, admin2);

      const res = await request(app)
        .post('/api/messages/')
        .set(headers1)
        .send({
          conversationId: conversation._id.toString(),
          senderId: admin1._id.toString(),
          senderModel: 'Staff',
          receiverId: admin2._id.toString(),
          receiverModel: 'Staff',
          content: 'Hello Bob!',
          type: 'text',
        })
        .expect(201);

      expect(res.body).toMatchObject({
        content: 'Hello Bob!',
        type: 'text',
        status: 'sent',
      });
      expect(res.body.id).toBeDefined();
      expect(res.body.senderName).toBe('Admin Alice');

      // Verify conversation lastMessage was updated
      const updatedConv = await Conversation.findById(conversation._id).lean();
      expect(updatedConv.lastMessage.content).toBe('Hello Bob!');
    });

    it('increments unread count for receiver after sending a message', async () => {
      const { app, admin1, admin2, headers1 } = await setupTwoStaffUsers();
      const conversation = await createDirectConversation(admin1, admin2);

      await request(app)
        .post('/api/messages/')
        .set(headers1)
        .send({
          conversationId: conversation._id.toString(),
          senderId: admin1._id.toString(),
          senderModel: 'Staff',
          receiverId: admin2._id.toString(),
          receiverModel: 'Staff',
          content: 'Ping!',
          type: 'text',
        })
        .expect(201);

      const updatedConv = await Conversation.findById(conversation._id).lean();
      const receiverParticipant = updatedConv.participants.find(
        (p) => p.userId.toString() === admin2._id.toString()
      );
      expect(receiverParticipant.unreadCount).toBe(1);
    });

    it('rejects sending a message into a conversation the user is not a participant of', async () => {
      // Set up: admin1 + admin2 are participants of a direct conversation.
      // admin3 (same school) is NOT a participant. Before the fix, admin3
      // could POST /messages with that conversationId and the message would
      // be persisted + receiver unread counts bumped.
      setupSeq += 1;
      const school = await createSchoolRecord({
        name: `Inject School ${setupSeq}`,
        code: `INJ-${setupSeq}`,
      });
      const admin1 = await createStaffUser({
        name: 'Inject A',
        email: `inj.a.${setupSeq}@chat.example.com`,
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });
      await Staff.findByIdAndUpdate(admin1._id, { username: `injA_${setupSeq}` });
      const admin2 = await createStaffUser({
        name: 'Inject B',
        email: `inj.b.${setupSeq}@chat.example.com`,
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });
      await Staff.findByIdAndUpdate(admin2._id, { username: `injB_${setupSeq}` });
      const outsider = await createStaffUser({
        name: 'Inject C',
        email: `inj.c.${setupSeq}@chat.example.com`,
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });
      await Staff.findByIdAndUpdate(outsider._id, { username: `injC_${setupSeq}` });

      const conversation = await createDirectConversation(admin1, admin2);
      const { app } = createTestApp();

      const res = await request(app)
        .post('/api/messages/')
        .set(authHeadersFor(outsider, 'admin'))
        .send({
          conversationId: conversation._id.toString(),
          receiverId: admin2._id.toString(),
          receiverModel: 'Staff',
          content: 'I should never land in this conversation',
          type: 'text',
        })
        .expect(403);

      expect(res.body.error).toMatch(/participant/i);

      // No message should have been persisted
      const injected = await Message.findOne({
        conversationId: conversation._id,
        senderId: outsider._id,
      });
      expect(injected).toBeNull();
    });

    it('allows sending a voice message with empty content', async () => {
      const { app, admin1, admin2, headers1 } = await setupTwoStaffUsers();
      const conversation = await createDirectConversation(admin1, admin2);

      const res = await request(app)
        .post('/api/messages/')
        .set(headers1)
        .send({
          conversationId: conversation._id.toString(),
          senderId: admin1._id.toString(),
          senderModel: 'Staff',
          receiverId: admin2._id.toString(),
          receiverModel: 'Staff',
          content: '',
          type: 'voice',
          fileUrl: 'https://example.com/audio.ogg',
          duration: 15,
        })
        .expect(201);

      expect(res.body).toMatchObject({
        type: 'voice',
        content: '',
        duration: 15,
      });
    });
  });

  // -----------------------------------------------------------------------
  // PUT /api/messages/read
  // -----------------------------------------------------------------------
  describe('PUT /api/messages/read', () => {
    it('returns 400 when conversationId or userId is missing', async () => {
      const { app, headers1 } = await setupTwoStaffUsers();

      await request(app).put('/api/messages/read').set(headers1).send({}).expect(400);
    });

    it('marks all unread messages as read and resets unread count', async () => {
      const { app, admin1, admin2, headers2 } = await setupTwoStaffUsers();
      const conversation = await createDirectConversation(admin1, admin2);

      // Send two messages from admin1 to admin2
      await createMessage(conversation, admin1, admin2, 'msg1');
      await createMessage(conversation, admin1, admin2, 'msg2');

      // Set unread count manually for admin2
      const participant = conversation.participants.find(
        (p) => p.userId.toString() === admin2._id.toString()
      );
      participant.unreadCount = 2;
      await conversation.save();

      // admin2 marks as read
      const res = await request(app)
        .put('/api/messages/read')
        .set(headers2)
        .send({
          conversationId: conversation._id.toString(),
          userId: admin2._id.toString(),
        })
        .expect(200);

      expect(res.body).toMatchObject({ success: true });

      // Verify messages are marked read
      const messages = await Message.find({
        conversationId: conversation._id,
        receiverId: admin2._id,
      }).lean();
      messages.forEach((m) => {
        expect(m.status).toBe('read');
        expect(m.readAt).toBeDefined();
      });

      // Verify unread count is reset
      const updatedConv = await Conversation.findById(conversation._id).lean();
      const updatedParticipant = updatedConv.participants.find(
        (p) => p.userId.toString() === admin2._id.toString()
      );
      expect(updatedParticipant.unreadCount).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/messages/unread-count
  // -----------------------------------------------------------------------
  describe('GET /api/messages/unread-count', () => {
    it('returns 200 with zero count when no query params (userId derived from session)', async () => {
      const { app, headers1 } = await setupTwoStaffUsers();

      const res = await request(app).get('/api/messages/unread-count').set(headers1).expect(200);

      expect(res.body).toMatchObject({ count: 0 });
    });

    it('returns own unread count even when querying with another userId (session-scoped)', async () => {
      const { app, admin2, headers1 } = await setupTwoStaffUsers();

      const res = await request(app)
        .get('/api/messages/unread-count')
        .query({ userId: admin2._id.toString(), userType: 'staff' })
        .set(headers1)
        .expect(200);

      expect(res.body).toMatchObject({ count: 0 });
    });

    it('returns zero when there are no unread messages', async () => {
      const { app, admin1, headers1 } = await setupTwoStaffUsers();

      const res = await request(app)
        .get('/api/messages/unread-count')
        .query({ userId: admin1._id.toString(), userType: 'staff' })
        .set(headers1)
        .expect(200);

      expect(res.body).toMatchObject({ count: 0 });
    });

    it('returns correct total unread count across conversations', async () => {
      const { app, admin1, admin2, headers2 } = await setupTwoStaffUsers();
      const conversation = await createDirectConversation(admin1, admin2);

      // Set unread count for admin2
      const participant = conversation.participants.find(
        (p) => p.userId.toString() === admin2._id.toString()
      );
      participant.unreadCount = 5;
      await conversation.save();

      const res = await request(app)
        .get('/api/messages/unread-count')
        .query({ userId: admin2._id.toString(), userType: 'staff' })
        .set(headers2)
        .expect(200);

      expect(res.body).toMatchObject({ count: 5 });
    });
  });

  // -----------------------------------------------------------------------
  // DELETE /api/messages/:messageId
  // -----------------------------------------------------------------------
  describe('DELETE /api/messages/:messageId', () => {
    it('returns 404 for a non-existent message', async () => {
      const { app, admin1, headers1 } = await setupTwoStaffUsers();
      const fakeId = '000000000000000000000000';

      await request(app)
        .delete(`/api/messages/${fakeId}`)
        .query({ userId: admin1._id.toString() })
        .set(headers1)
        .expect(404);
    });

    it('soft-deletes a message for the requesting user', async () => {
      const { app, admin1, admin2, headers1 } = await setupTwoStaffUsers();
      const conversation = await createDirectConversation(admin1, admin2);
      const msg = await createMessage(conversation, admin1, admin2, 'to be deleted');

      const res = await request(app)
        .delete(`/api/messages/${msg._id}`)
        .query({ userId: admin1._id.toString() })
        .set(headers1)
        .expect(200);

      expect(res.body).toMatchObject({ success: true });

      // Message should still exist but have admin1 in deletedFor
      const updated = await Message.findById(msg._id).lean();
      expect(updated.deletedFor.map((id) => id.toString())).toContain(admin1._id.toString());
      // Not fully deleted yet (only one participant deleted)
      expect(updated.isDeleted).toBe(false);
    });

    it('marks message as fully deleted when all participants delete it', async () => {
      const { app, admin1, admin2, headers1, headers2 } = await setupTwoStaffUsers();
      const conversation = await createDirectConversation(admin1, admin2);
      const msg = await createMessage(conversation, admin1, admin2, 'double delete');

      // First user deletes
      await request(app)
        .delete(`/api/messages/${msg._id}`)
        .query({ userId: admin1._id.toString() })
        .set(headers1)
        .expect(200);

      // Second user deletes
      await request(app)
        .delete(`/api/messages/${msg._id}`)
        .query({ userId: admin2._id.toString() })
        .set(headers2)
        .expect(200);

      const updated = await Message.findById(msg._id).lean();
      expect(updated.isDeleted).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/messages/search
  // -----------------------------------------------------------------------
  describe('GET /api/messages/search', () => {
    it('returns 400 when userId or query is missing', async () => {
      const { app, headers1 } = await setupTwoStaffUsers();

      await request(app).get('/api/messages/search').set(headers1).expect(400);
    });

    it('returns matching messages from user conversations', async () => {
      const { app, admin1, admin2, headers1 } = await setupTwoStaffUsers();
      const conversation = await createDirectConversation(admin1, admin2);

      await createMessage(conversation, admin1, admin2, 'hello world');
      await createMessage(conversation, admin1, admin2, 'goodbye planet');
      await createMessage(conversation, admin2, admin1, 'hello again');

      const res = await request(app)
        .get('/api/messages/search')
        .query({ userId: admin1._id.toString(), query: 'hello' })
        .set(headers1)
        .expect(200);

      expect(res.body).toHaveLength(2);
      res.body.forEach((msg) => {
        expect(msg.content.toLowerCase()).toContain('hello');
      });
    });

    it('does not return deleted messages in search results', async () => {
      const { app, admin1, admin2, headers1 } = await setupTwoStaffUsers();
      const conversation = await createDirectConversation(admin1, admin2);

      const msg = await createMessage(conversation, admin1, admin2, 'secret hello');
      msg.isDeleted = true;
      await msg.save();

      await createMessage(conversation, admin1, admin2, 'visible hello');

      const res = await request(app)
        .get('/api/messages/search')
        .query({ userId: admin1._id.toString(), query: 'hello' })
        .set(headers1)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].content).toBe('visible hello');
    });

    it('respects the limit parameter', async () => {
      const { app, admin1, admin2, headers1 } = await setupTwoStaffUsers();
      const conversation = await createDirectConversation(admin1, admin2);

      for (let i = 0; i < 5; i++) {
        await createMessage(conversation, admin1, admin2, `test message ${i}`);
      }

      const res = await request(app)
        .get('/api/messages/search')
        .query({ userId: admin1._id.toString(), query: 'test', limit: 3 })
        .set(headers1)
        .expect(200);

      expect(res.body).toHaveLength(3);
    });
  });
});
