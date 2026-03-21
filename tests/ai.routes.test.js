import request from 'supertest';
import { describe, expect, it, beforeEach } from 'vitest';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const BASE = '/api/ai';

describe('ai routes', () => {
  let app, school, admin, headers;

  beforeEach(async () => {
    school = await createSchoolRecord({ name: 'AI School', code: 'AIS' });
    admin = await createStaffUser({
      name: 'AI Admin',
      email: 'ai.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    headers = authHeadersFor(admin, 'admin');
    ({ app } = createTestApp());
  });

  // ───────────────────────────────────────────────────────────────
  // Auth
  // ───────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('GET /models returns 401 without token', async () => {
      await request(app).get(`${BASE}/models`).expect(401);
    });

    it('POST /chat returns 401 without token', async () => {
      await request(app)
        .post(`${BASE}/chat`)
        .send({ messages: [{ role: 'user', content: 'Hello' }] })
        .expect(401);
    });

    it('POST /transcribe returns 401 without token', async () => {
      await request(app).post(`${BASE}/transcribe`).expect(401);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /models
  // ───────────────────────────────────────────────────────────────
  describe('GET /models', () => {
    it('returns model list with defaultModelId and models array', async () => {
      const res = await request(app).get(`${BASE}/models`).set(headers).expect(200);

      expect(res.body).toHaveProperty('defaultModelId');
      expect(Array.isArray(res.body.models)).toBe(true);
      expect(res.body.models.length).toBeGreaterThan(0);

      const model = res.body.models[0];
      expect(model).toHaveProperty('id');
      expect(model).toHaveProperty('name');
      expect(model).toHaveProperty('provider');
      expect(model).toHaveProperty('available');
    });
  });

  // ───────────────────────────────────────────────────────────────
  // POST /chat
  // ───────────────────────────────────────────────────────────────
  describe('POST /chat', () => {
    it('returns 400 when messages is empty array', async () => {
      const res = await request(app)
        .post(`${BASE}/chat`)
        .set(headers)
        .send({ messages: [] })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });

    it('returns 400 when messages is missing', async () => {
      const res = await request(app).post(`${BASE}/chat`).set(headers).send({}).expect(400);

      expect(res.body).toHaveProperty('error');
    });

    it('returns 400 when messages have invalid roles', async () => {
      const res = await request(app)
        .post(`${BASE}/chat`)
        .set(headers)
        .send({ messages: [{ role: 'system', content: 'do stuff' }] })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });

    it('returns scope-rejection response (200) for clearly non-school messages', async () => {
      // Off-topic messages are rejected at scope-check level before calling AI,
      // so they return 200 with a scope reason rather than an error.
      const res = await request(app)
        .post(`${BASE}/chat`)
        .set(headers)
        .send({ messages: [{ role: 'user', content: 'Tell me a recipe for pasta' }] })
        .expect(200);

      expect(res.body).toHaveProperty('content');
      expect(typeof res.body.content).toBe('string');
      expect(res.body.content.length).toBeGreaterThan(0);
      expect(res.body.toolCalls).toEqual([]);
    });

    it('returns 503 for school-related message when AI backend is not configured', async () => {
      // School-related messages pass scope check but hit the unconfigured AI model.
      const res = await request(app)
        .post(`${BASE}/chat`)
        .set(headers)
        .send({ messages: [{ role: 'user', content: 'How many students are in Class 10?' }] })
        .expect(503);

      expect(res.body).toHaveProperty('error');
    });
  });

  // ───────────────────────────────────────────────────────────────
  // POST /transcribe
  // ───────────────────────────────────────────────────────────────
  describe('POST /transcribe', () => {
    it('returns 400 when no audio file is uploaded', async () => {
      const res = await request(app).post(`${BASE}/transcribe`).set(headers).expect(400);

      expect(res.body).toHaveProperty('error');
    });

    it('returns 503 when transcription backend is not configured', async () => {
      // Upload a tiny dummy audio buffer; the route will fail at the API call
      // level because no GROQ_API_KEY is configured in the test environment.
      const res = await request(app)
        .post(`${BASE}/transcribe`)
        .set(headers)
        .attach('audio', Buffer.from('dummy-audio-data'), {
          filename: 'test.webm',
          contentType: 'audio/webm',
        })
        .expect(503);

      expect(res.body).toHaveProperty('error');
    });
  });
});
