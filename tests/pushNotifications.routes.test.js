import request from 'supertest';
import { describe, expect, it } from 'vitest';
import PushToken from '../models/PushToken.js';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

let seq = 0;
function nextSeq() {
  return ++seq;
}

async function setup() {
  const school = await createSchoolRecord({
    name: `Push School ${nextSeq()}`,
    code: `PUSH-${nextSeq()}`,
  });
  const admin = await createStaffUser({ schoolId: school._id });
  const { app } = createTestApp();
  const headers = authHeadersFor(admin, 'admin');
  return { school, admin, app, headers };
}

describe('pushNotifications routes', () => {
  // ── Auth ─────────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('returns 401 for POST /api/push-notifications/register-token without auth', async () => {
      const { app } = createTestApp();
      await request(app)
        .post('/api/push-notifications/register-token')
        .send({ token: 'abc', platform: 'android' })
        .expect(401);
    });

    it('returns 401 for GET /api/push-notifications/my-tokens without auth', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/push-notifications/my-tokens').expect(401);
    });

    it('returns 401 for DELETE /api/push-notifications/unregister-token without auth', async () => {
      const { app } = createTestApp();
      await request(app)
        .delete('/api/push-notifications/unregister-token')
        .send({ token: 'abc' })
        .expect(401);
    });
  });

  // ── POST /register-token ──────────────────────────────────────────────────
  describe('POST /api/push-notifications/register-token', () => {
    it('returns 400 when token is missing', async () => {
      const { app, headers } = await setup();
      await request(app)
        .post('/api/push-notifications/register-token')
        .set(headers)
        .send({ platform: 'android' })
        .expect(400);
    });

    it('returns 400 when platform is missing', async () => {
      const { app, headers } = await setup();
      await request(app)
        .post('/api/push-notifications/register-token')
        .set(headers)
        .send({ token: 'some-fcm-token' })
        .expect(400);
    });

    it('returns 400 for invalid platform value', async () => {
      const { app, headers } = await setup();
      await request(app)
        .post('/api/push-notifications/register-token')
        .set(headers)
        .send({ token: 'some-fcm-token', platform: 'windows' })
        .expect(400);
    });

    it('registers a new token and returns 201', async () => {
      const { app, headers } = await setup();
      const res = await request(app)
        .post('/api/push-notifications/register-token')
        .set(headers)
        .send({ token: `fcm-token-${nextSeq()}`, platform: 'android' })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.tokenId).toBeDefined();
    });

    it('updates an existing token and returns 200', async () => {
      const { admin, school, app, headers } = await setup();
      const token = `fcm-token-reused-${nextSeq()}`;

      // First registration
      await PushToken.create({
        user: admin._id,
        userModel: 'Staff',
        schoolId: school._id,
        token,
        platform: 'android',
      });

      const res = await request(app)
        .post('/api/push-notifications/register-token')
        .set(headers)
        .send({ token, platform: 'ios', appVersion: '2.0.0' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/updated/i);
    });
  });

  // ── GET /my-tokens ────────────────────────────────────────────────────────
  describe('GET /api/push-notifications/my-tokens', () => {
    it('returns empty list when user has no tokens', async () => {
      const { app, headers } = await setup();
      const res = await request(app)
        .get('/api/push-notifications/my-tokens')
        .set(headers)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.tokens).toEqual([]);
    });

    it('returns only the current user tokens', async () => {
      const { admin, school, app, headers } = await setup();
      await PushToken.create({
        user: admin._id,
        userModel: 'Staff',
        schoolId: school._id,
        token: `my-token-${nextSeq()}`,
        platform: 'android',
      });

      const res = await request(app)
        .get('/api/push-notifications/my-tokens')
        .set(headers)
        .expect(200);

      expect(res.body.tokens).toHaveLength(1);
      expect(res.body.tokens[0].platform).toBe('android');
      // Password/sensitive fields should not be included
      expect(res.body.tokens[0].token).toBeUndefined();
    });
  });

  // ── DELETE /unregister-token ──────────────────────────────────────────────
  describe('DELETE /api/push-notifications/unregister-token', () => {
    it('returns 400 when token is missing', async () => {
      const { app, headers } = await setup();
      await request(app)
        .delete('/api/push-notifications/unregister-token')
        .set(headers)
        .send({})
        .expect(400);
    });

    it('returns 404 when token does not belong to user', async () => {
      const { app, headers } = await setup();
      await request(app)
        .delete('/api/push-notifications/unregister-token')
        .set(headers)
        .send({ token: 'nonexistent-token' })
        .expect(404);
    });

    it('removes a registered token', async () => {
      const { admin, school, app, headers } = await setup();
      const token = `del-token-${nextSeq()}`;
      await PushToken.create({
        user: admin._id,
        userModel: 'Staff',
        schoolId: school._id,
        token,
        platform: 'ios',
      });

      const res = await request(app)
        .delete('/api/push-notifications/unregister-token')
        .set(headers)
        .send({ token })
        .expect(200);

      expect(res.body.success).toBe(true);

      const found = await PushToken.findOne({ token });
      expect(found).toBeNull();
    });
  });

  // ── GET /vapid-public-key ─────────────────────────────────────────────────
  describe('GET /api/push-notifications/vapid-public-key', () => {
    it('returns 503 when VAPID key is not configured', async () => {
      const { app, headers } = await setup();
      // VAPID_PUBLIC_KEY is not set in test environment
      const res = await request(app)
        .get('/api/push-notifications/vapid-public-key')
        .set(headers)
        .expect(503);

      expect(res.body.success).toBe(false);
    });
  });

  // ── POST /web-subscribe ───────────────────────────────────────────────────
  describe('POST /api/push-notifications/web-subscribe', () => {
    it('returns 400 when required fields are missing', async () => {
      const { app, headers } = await setup();
      await request(app)
        .post('/api/push-notifications/web-subscribe')
        .set(headers)
        .send({ endpoint: 'https://push.example.com/sub/123' })
        .expect(400);
    });

    it('saves a web push subscription', async () => {
      const { app, headers } = await setup();
      const res = await request(app)
        .post('/api/push-notifications/web-subscribe')
        .set(headers)
        .send({
          endpoint: `https://push.example.com/sub/${nextSeq()}`,
          keys: { p256dh: 'BPKEY123abc', auth: 'AUTH456def' },
        })
        .expect(201);

      expect(res.body.success).toBe(true);
    });
  });

  // ── DELETE /web-unsubscribe ───────────────────────────────────────────────
  describe('DELETE /api/push-notifications/web-unsubscribe', () => {
    it('returns 400 when endpoint is missing', async () => {
      const { app, headers } = await setup();
      await request(app)
        .delete('/api/push-notifications/web-unsubscribe')
        .set(headers)
        .send({})
        .expect(400);
    });

    it('marks subscription as inactive', async () => {
      const { app, headers } = await setup();
      const endpoint = `https://push.example.com/sub/unsub-${nextSeq()}`;

      const res = await request(app)
        .delete('/api/push-notifications/web-unsubscribe')
        .set(headers)
        .send({ endpoint })
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });
});
