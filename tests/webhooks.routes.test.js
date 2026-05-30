import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import Webhook from '../models/Webhook.js';
import WebhookDeliveryLog from '../models/WebhookDeliveryLog.js';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

vi.mock('../services/webhookService.js', () => ({
  sendTestWebhook: vi.fn().mockResolvedValue(true),
}));

const BASE = '/api/webhooks';

function buildPayload(overrides = {}) {
  return {
    name: 'Test Webhook',
    url: 'https://example.com/webhook',
    secret: 'my-super-secret-123',
    events: ['student.created'],
    isActive: true,
    ...overrides,
  };
}

describe('webhooks routes', () => {
  async function setup() {
    const school = await createSchoolRecord({ name: 'Webhook School', code: 'WHK' });
    const admin = await createStaffUser({
      name: 'WH Admin',
      email: 'wh.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    const { app } = createTestApp();
    const headers = authHeadersFor(admin, 'admin');
    return { school, admin, app, headers };
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('returns 401 without token', async () => {
      const { app } = createTestApp();
      await request(app).get(BASE).expect(401);
      await request(app).post(BASE).send(buildPayload()).expect(401);
    });
  });

  // ── GET /api/webhooks ─────────────────────────────────────────────────────
  describe('GET /api/webhooks', () => {
    it('returns all webhooks for the school', async () => {
      const { school, app, headers } = await setup();
      await Webhook.create([
        {
          schoolId: school._id,
          name: 'A',
          url: 'https://a.com',
          secret: 's1',
          events: ['student.created'],
        },
        {
          schoolId: school._id,
          name: 'B',
          url: 'https://b.com',
          secret: 's2',
          events: ['fee.paid'],
        },
      ]);

      const res = await request(app).get(BASE).set(headers).expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
      // secret should be excluded
      expect(res.body[0]).not.toHaveProperty('secret');
    });

    it('does not include deadLetterQueue in list', async () => {
      const { school, app, headers } = await setup();
      await Webhook.create({
        schoolId: school._id,
        name: 'A',
        url: 'https://a.com',
        secret: 's1',
        events: ['student.created'],
        deadLetterQueue: [{ event: 'test', failedAt: new Date() }],
      });

      const res = await request(app).get(BASE).set(headers).expect(200);
      expect(res.body[0]).not.toHaveProperty('deadLetterQueue');
    });
  });

  // ── POST /api/webhooks ────────────────────────────────────────────────────
  describe('POST /api/webhooks', () => {
    it('creates a webhook', async () => {
      const { school, app, headers } = await setup();
      const payload = buildPayload();

      const res = await request(app).post(BASE).set(headers).send(payload).expect(201);
      expect(res.body.name).toBe(payload.name);
      expect(res.body.url).toBe(payload.url);
      expect(res.body.secret).toBe(payload.secret); // returned once on create
      expect(res.body.events).toEqual(payload.events);
    });

    it('returns 400 for invalid URL', async () => {
      const { app, headers } = await setup();
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .send(buildPayload({ url: 'not-a-url' }))
        .expect(400);
      expect(res.body.error).toMatch(/validation failed/i);
    });

    it('returns 400 for empty events array', async () => {
      const { app, headers } = await setup();
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .send(buildPayload({ events: [] }))
        .expect(400);
      expect(res.body.error).toMatch(/validation failed/i);
    });

    it('auto-generates secret when omitted', async () => {
      const { app, headers } = await setup();
      const payload = buildPayload();
      delete payload.secret;

      const res = await request(app).post(BASE).set(headers).send(payload).expect(201);
      expect(res.body.secret).toBeTruthy();
      expect(res.body.secret.length).toBeGreaterThanOrEqual(8);
    });
  });

  // ── GET /api/webhooks/events ──────────────────────────────────────────────
  describe('GET /api/webhooks/events', () => {
    it('returns supported event types', async () => {
      const { app, headers } = await setup();
      const res = await request(app).get(`${BASE}/events`).set(headers).expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toContain('student.created');
      expect(res.body).toContain('fee.paid');
    });
  });

  // ── GET /api/webhooks/:id ─────────────────────────────────────────────────
  describe('GET /api/webhooks/:id', () => {
    it('returns a single webhook', async () => {
      const { school, app, headers } = await setup();
      const wh = await Webhook.create({
        schoolId: school._id,
        name: 'Detail',
        url: 'https://d.com',
        secret: 's1',
        events: ['student.created'],
      });

      const res = await request(app).get(`${BASE}/${wh._id}`).set(headers).expect(200);
      expect(res.body.name).toBe('Detail');
      expect(res.body).not.toHaveProperty('secret');
    });

    it('returns 404 for non-existent webhook', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).get(`${BASE}/${fakeId}`).set(headers).expect(404);
    });
  });

  // ── PUT /api/webhooks/:id ─────────────────────────────────────────────────
  describe('PUT /api/webhooks/:id', () => {
    it('updates a webhook', async () => {
      const { school, app, headers } = await setup();
      const wh = await Webhook.create({
        schoolId: school._id,
        name: 'Old',
        url: 'https://old.com',
        secret: 's1',
        events: ['student.created'],
      });

      const res = await request(app)
        .put(`${BASE}/${wh._id}`)
        .set(headers)
        .send({ name: 'New', url: 'https://new.com' })
        .expect(200);
      expect(res.body.name).toBe('New');
      expect(res.body.url).toBe('https://new.com');
    });

    it('returns 404 for non-existent webhook', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).put(`${BASE}/${fakeId}`).set(headers).send({ name: 'X' }).expect(404);
    });
  });

  // ── DELETE /api/webhooks/:id ──────────────────────────────────────────────
  describe('DELETE /api/webhooks/:id', () => {
    it('deletes a webhook and its delivery logs', async () => {
      const { school, app, headers } = await setup();
      const wh = await Webhook.create({
        schoolId: school._id,
        name: 'To Delete',
        url: 'https://del.com',
        secret: 's1',
        events: ['student.created'],
      });
      await WebhookDeliveryLog.create({
        webhookId: wh._id,
        schoolId: school._id,
        event: 'test',
        status: 'success',
      });

      const res = await request(app).delete(`${BASE}/${wh._id}`).set(headers).expect(200);
      expect(res.body.message).toMatch(/deleted/i);

      const remaining = await Webhook.findById(wh._id);
      expect(remaining).toBeNull();
      const logs = await WebhookDeliveryLog.find({ webhookId: wh._id });
      expect(logs).toHaveLength(0);
    });

    it('returns 404 for non-existent webhook', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).delete(`${BASE}/${fakeId}`).set(headers).expect(404);
    });
  });

  // ── POST /api/webhooks/:id/test ───────────────────────────────────────────
  describe('POST /api/webhooks/:id/test', () => {
    it('sends a test delivery', async () => {
      const { school, app, headers } = await setup();
      const wh = await Webhook.create({
        schoolId: school._id,
        name: 'Test',
        url: 'https://test.com',
        secret: 's1',
        events: ['student.created'],
      });

      const res = await request(app).post(`${BASE}/${wh._id}/test`).set(headers).expect(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 for non-existent webhook', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).post(`${BASE}/${fakeId}/test`).set(headers).expect(404);
    });
  });

  // ── GET /api/webhooks/:id/logs ────────────────────────────────────────────
  describe('GET /api/webhooks/:id/logs', () => {
    it('returns delivery logs', async () => {
      const { school, app, headers } = await setup();
      const wh = await Webhook.create({
        schoolId: school._id,
        name: 'Log',
        url: 'https://log.com',
        secret: 's1',
        events: ['student.created'],
      });
      await WebhookDeliveryLog.create([
        { webhookId: wh._id, schoolId: school._id, event: 'a', status: 'success' },
        { webhookId: wh._id, schoolId: school._id, event: 'b', status: 'failed' },
      ]);

      const res = await request(app).get(`${BASE}/${wh._id}/logs`).set(headers).expect(200);
      expect(res.body.logs).toHaveLength(2);
      expect(res.body.total).toBe(2);
    });

    it('returns 404 for webhook belonging to another school', async () => {
      const { app, headers } = await setup();
      const schoolB = await createSchoolRecord({ name: 'School B', code: 'WHB' });
      const whB = await Webhook.create({
        schoolId: schoolB._id,
        name: 'B',
        url: 'https://b.com',
        secret: 's1',
        events: ['student.created'],
      });
      await request(app).get(`${BASE}/${whB._id}/logs`).set(headers).expect(404);
    });
  });

  // ── GET /api/webhooks/:id/dead-letter ─────────────────────────────────────
  describe('GET /api/webhooks/:id/dead-letter', () => {
    it('returns dead letter queue', async () => {
      const { school, app, headers } = await setup();
      const wh = await Webhook.create({
        schoolId: school._id,
        name: 'DLQ',
        url: 'https://dlq.com',
        secret: 's1',
        events: ['student.created'],
        deadLetterQueue: [
          { event: 'fail', failedAt: new Date(), lastError: 'Timeout', attemptCount: 5 },
        ],
      });

      const res = await request(app).get(`${BASE}/${wh._id}/dead-letter`).set(headers).expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].event).toBe('fail');
    });
  });

  // ── DELETE /api/webhooks/:id/dead-letter ──────────────────────────────────
  describe('DELETE /api/webhooks/:id/dead-letter', () => {
    it('clears the dead letter queue', async () => {
      const { school, app, headers } = await setup();
      const wh = await Webhook.create({
        schoolId: school._id,
        name: 'DLQ',
        url: 'https://dlq.com',
        secret: 's1',
        events: ['student.created'],
        deadLetterQueue: [{ event: 'fail', failedAt: new Date() }],
      });

      const res = await request(app)
        .delete(`${BASE}/${wh._id}/dead-letter`)
        .set(headers)
        .expect(200);
      expect(res.body.message).toMatch(/cleared/i);

      const updated = await Webhook.findById(wh._id);
      expect(updated.deadLetterQueue).toHaveLength(0);
    });
  });
});
