import request from 'supertest';
import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import Parent from '../models/Parent.js';
import Conversation from '../models/Conversation.js';
import { Message } from '../database.js';
import { createSchoolRecord } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

let seq = 0;
function nextSeq() {
  return ++seq;
}

async function createParent(schoolId, overrides = {}) {
  const id = nextSeq();
  return Parent.create({
    name: `Parent ${id}`,
    phone: `8${String(id).padStart(9, '0')}`,
    email: `parent${id}@test.example.com`,
    schoolId,
    status: 'active',
    children: [],
    ...overrides,
  });
}

function parentToken(parent) {
  return jwt.sign({ userId: parent._id.toString() }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

function parentHeaders(parent) {
  return { Authorization: `Bearer ${parentToken(parent)}` };
}

async function setupTwoParents() {
  const school = await createSchoolRecord({
    name: `PMsg School ${nextSeq()}`,
    code: `PMSG-${nextSeq()}`,
  });
  const parent1 = await createParent(school._id);
  const parent2 = await createParent(school._id);
  const { app } = createTestApp();
  return { school, parent1, parent2, app };
}

async function createDirectConversation(parent1, parent2) {
  const conv = await Conversation.create({
    type: 'direct',
    participants: [
      { userId: parent1._id, userModel: 'Parent', unreadCount: 0 },
      { userId: parent2._id, userModel: 'Parent', unreadCount: 0 },
    ],
    lastMessage: {},
    createdBy: parent1._id,
  });
  return conv;
}

describe('parentMessaging routes', () => {
  // ── Auth ─────────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('returns 401 for GET /api/parent/messages/conversations without token', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/parent/messages/conversations').expect(401);
    });

    it('returns 401 for POST /api/parent/messages without token', async () => {
      const { app } = createTestApp();
      await request(app).post('/api/parent/messages').send({ content: 'hi' }).expect(401);
    });

    it('returns 401 for GET /api/parent/messages/:id/messages without token', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/parent/messages/000000000000000000000000/messages').expect(401);
    });

    it('returns 401 for PUT /api/parent/messages/:id/read without token', async () => {
      const { app } = createTestApp();
      await request(app).put('/api/parent/messages/000000000000000000000000/read').expect(401);
    });
  });

  // ── GET /conversations ───────────────────────────────────────────────────
  describe('GET /api/parent/messages/conversations', () => {
    it('returns empty list when parent has no conversations', async () => {
      const { parent1, app } = await setupTwoParents();
      const res = await request(app)
        .get('/api/parent/messages/conversations')
        .set(parentHeaders(parent1))
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it('returns conversations the parent is part of', async () => {
      const { parent1, parent2, app } = await setupTwoParents();
      const conv = await createDirectConversation(parent1, parent2);
      conv.lastMessage = {
        content: 'hello',
        senderId: parent1._id,
        timestamp: new Date(),
        type: 'text',
      };
      await conv.save();

      const res = await request(app)
        .get('/api/parent/messages/conversations')
        .set(parentHeaders(parent1))
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(conv._id.toString());
    });

    it('does not return archived conversations', async () => {
      const { parent1, parent2, app } = await setupTwoParents();
      const conv = await createDirectConversation(parent1, parent2);
      conv.isArchived = true;
      await conv.save();

      const res = await request(app)
        .get('/api/parent/messages/conversations')
        .set(parentHeaders(parent1))
        .expect(200);

      expect(res.body.data).toEqual([]);
    });
  });

  // ── GET /:id/messages ────────────────────────────────────────────────────
  describe('GET /api/parent/messages/:id/messages', () => {
    it('returns 404 for non-existent conversation', async () => {
      const { parent1, app } = await setupTwoParents();
      await request(app)
        .get('/api/parent/messages/000000000000000000000000/messages')
        .set(parentHeaders(parent1))
        .expect(404);
    });

    it('returns 403 when parent is not a participant', async () => {
      const { parent1, parent2, app } = await setupTwoParents();
      // conv created between parent2 and a third user — parent1 not involved
      const otherParent = await createParent(parent2.schoolId);
      const conv = await createDirectConversation(parent2, otherParent);

      await request(app)
        .get(`/api/parent/messages/${conv._id}/messages`)
        .set(parentHeaders(parent1))
        .expect(403);
    });

    it('returns messages in the conversation', async () => {
      const { parent1, parent2, app } = await setupTwoParents();
      const conv = await createDirectConversation(parent1, parent2);

      await Message.create({
        conversationId: conv._id,
        senderId: parent1._id,
        senderModel: 'Parent',
        receiverId: parent2._id,
        receiverModel: 'Parent',
        content: 'hello',
        type: 'text',
        status: 'sent',
      });

      const res = await request(app)
        .get(`/api/parent/messages/${conv._id}/messages`)
        .set(parentHeaders(parent1))
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].content).toBe('hello');
    });
  });

  // ── POST / (send message) ────────────────────────────────────────────────
  describe('POST /api/parent/messages', () => {
    it('returns 400 when content is missing', async () => {
      const { parent1, parent2, app } = await setupTwoParents();
      const conv = await createDirectConversation(parent1, parent2);

      await request(app)
        .post('/api/parent/messages')
        .set(parentHeaders(parent1))
        .send({ conversationId: conv._id.toString() })
        .expect(400);
    });

    it('returns 400 when creating new conversation without receiverId', async () => {
      const { parent1, app } = await setupTwoParents();

      await request(app)
        .post('/api/parent/messages')
        .set(parentHeaders(parent1))
        .send({ content: 'hello' })
        .expect(400);
    });

    it('sends a message to an existing conversation', async () => {
      const { parent1, parent2, app } = await setupTwoParents();
      const conv = await createDirectConversation(parent1, parent2);

      const res = await request(app)
        .post('/api/parent/messages')
        .set(parentHeaders(parent1))
        .send({ conversationId: conv._id.toString(), content: 'Hello!' })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.content).toBe('Hello!');
    });

    it('returns 404 when conversationId does not exist', async () => {
      const { parent1, app } = await setupTwoParents();

      await request(app)
        .post('/api/parent/messages')
        .set(parentHeaders(parent1))
        .send({ conversationId: '000000000000000000000000', content: 'Hello!' })
        .expect(404);
    });
  });

  // ── PUT /:id/read ────────────────────────────────────────────────────────
  describe('PUT /api/parent/messages/:id/read', () => {
    it('returns 404 for non-existent conversation', async () => {
      const { parent1, app } = await setupTwoParents();
      await request(app)
        .put('/api/parent/messages/000000000000000000000000/read')
        .set(parentHeaders(parent1))
        .expect(404);
    });

    it('returns 403 when parent is not a participant', async () => {
      const { parent1, parent2, app } = await setupTwoParents();
      const otherParent = await createParent(parent2.schoolId);
      const conv = await createDirectConversation(parent2, otherParent);

      await request(app)
        .put(`/api/parent/messages/${conv._id}/read`)
        .set(parentHeaders(parent1))
        .expect(403);
    });

    it('marks messages as read successfully', async () => {
      const { parent1, parent2, app } = await setupTwoParents();
      const conv = await createDirectConversation(parent1, parent2);

      await Message.create({
        conversationId: conv._id,
        senderId: parent2._id,
        senderModel: 'Parent',
        receiverId: parent1._id,
        receiverModel: 'Parent',
        content: 'are you there?',
        type: 'text',
        status: 'sent',
      });

      const res = await request(app)
        .put(`/api/parent/messages/${conv._id}/read`)
        .set(parentHeaders(parent1))
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });
});
