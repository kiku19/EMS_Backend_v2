import request from 'supertest';
import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import ApiKey from '../models/ApiKey.js';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const BASE = '/api/api-keys';

function buildPayload(overrides = {}) {
  return {
    name: 'Test Key',
    scopes: ['read:all'],
    rateLimitPerHour: 1000,
    ...overrides,
  };
}

describe('apiKeys routes', () => {
  async function setup() {
    const school = await createSchoolRecord({ name: 'API Key School', code: 'KEYS' });
    const admin = await createStaffUser({
      name: 'Key Admin',
      email: 'key.admin@example.com',
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

  // ── GET /api/api-keys ─────────────────────────────────────────────────────
  describe('GET /api/api-keys', () => {
    it('returns all API keys for the school', async () => {
      const { school, app, headers } = await setup();
      await ApiKey.create([
        { schoolId: school._id, name: 'A', keyHash: 'h1', keyPrefix: 'p1', scopes: ['read:all'] },
        {
          schoolId: school._id,
          name: 'B',
          keyHash: 'h2',
          keyPrefix: 'p2',
          scopes: ['read:students'],
        },
      ]);

      const res = await request(app).get(BASE).set(headers).expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
      expect(res.body[0]).not.toHaveProperty('keyHash');
      expect(res.body[0]).not.toHaveProperty('previousKeyHash');
    });
  });

  // ── GET /api/api-keys/scopes ──────────────────────────────────────────────
  describe('GET /api/api-keys/scopes', () => {
    it('returns available scopes', async () => {
      const { app, headers } = await setup();
      const res = await request(app).get(`${BASE}/scopes`).set(headers).expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toContain('read:all');
      expect(res.body).toContain('read:students');
    });
  });

  // ── GET /api/api-keys/:id ─────────────────────────────────────────────────
  describe('GET /api/api-keys/:id', () => {
    it('returns a single API key', async () => {
      const { school, app, headers } = await setup();
      const key = await ApiKey.create({
        schoolId: school._id,
        name: 'Detail',
        keyHash: 'hash123',
        keyPrefix: 'pref',
        scopes: ['read:all'],
      });

      const res = await request(app).get(`${BASE}/${key._id}`).set(headers).expect(200);
      expect(res.body.name).toBe('Detail');
      expect(res.body).not.toHaveProperty('keyHash');
    });

    it('returns 404 for non-existent key', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).get(`${BASE}/${fakeId}`).set(headers).expect(404);
    });
  });

  // ── POST /api/api-keys ────────────────────────────────────────────────────
  describe('POST /api/api-keys', () => {
    it('creates an API key and returns raw key once', async () => {
      const { school, app, headers } = await setup();
      const payload = buildPayload();

      const res = await request(app).post(BASE).set(headers).send(payload).expect(201);
      expect(res.body.name).toBe(payload.name);
      expect(res.body.scopes).toEqual(payload.scopes);
      expect(res.body.rawKey).toBeTruthy();
      expect(res.body.rawKey.startsWith('ems_')).toBe(true);
      expect(res.body._warning).toBeTruthy();
    });

    it('returns 400 when name is missing', async () => {
      const { app, headers } = await setup();
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .send(buildPayload({ name: '' }))
        .expect(400);
      expect(res.body.error).toMatch(/validation failed/i);
    });

    it('returns 400 for invalid scope', async () => {
      const { app, headers } = await setup();
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .send(buildPayload({ scopes: ['invalid:scope'] }))
        .expect(400);
      expect(res.body.error).toMatch(/validation failed/i);
    });

    it('returns 400 for empty scopes', async () => {
      const { app, headers } = await setup();
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .send(buildPayload({ scopes: [] }))
        .expect(400);
      expect(res.body.error).toMatch(/validation failed/i);
    });
  });

  // ── PUT /api/api-keys/:id ─────────────────────────────────────────────────
  describe('PUT /api/api-keys/:id', () => {
    it('updates an API key', async () => {
      const { school, app, headers } = await setup();
      const key = await ApiKey.create({
        schoolId: school._id,
        name: 'Old',
        keyHash: 'hash123',
        keyPrefix: 'pref',
        scopes: ['read:all'],
      });

      const res = await request(app)
        .put(`${BASE}/${key._id}`)
        .set(headers)
        .send({ name: 'New', scopes: ['read:students'] })
        .expect(200);
      expect(res.body.name).toBe('New');
      expect(res.body.scopes).toEqual(['read:students']);
    });

    it('returns 404 for non-existent key', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).put(`${BASE}/${fakeId}`).set(headers).send({ name: 'X' }).expect(404);
    });
  });

  // ── POST /api/api-keys/:id/rotate ─────────────────────────────────────────
  describe('POST /api/api-keys/:id/rotate', () => {
    it('rotates an API key', async () => {
      const { school, app, headers } = await setup();
      const key = await ApiKey.create({
        schoolId: school._id,
        name: 'Rotate',
        keyHash: 'hash123',
        keyPrefix: 'pref',
        scopes: ['read:all'],
      });

      const res = await request(app).post(`${BASE}/${key._id}/rotate`).set(headers).expect(200);
      expect(res.body.rawKey).toBeTruthy();
      expect(res.body.keyPrefix).toBeTruthy();
      expect(res.body.previousKeyExpiresAt).toBeTruthy();
      expect(res.body._warning).toBeTruthy();
    });

    it('returns 404 for non-existent key', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).post(`${BASE}/${fakeId}/rotate`).set(headers).expect(404);
    });
  });

  // ── POST /api/api-keys/:id/revoke ─────────────────────────────────────────
  describe('POST /api/api-keys/:id/revoke', () => {
    it('revokes an API key', async () => {
      const { school, app, headers } = await setup();
      const key = await ApiKey.create({
        schoolId: school._id,
        name: 'Revoke',
        keyHash: 'hash123',
        keyPrefix: 'pref',
        scopes: ['read:all'],
        isActive: true,
      });

      const res = await request(app).post(`${BASE}/${key._id}/revoke`).set(headers).expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.revokedAt).toBeTruthy();

      const updated = await ApiKey.findById(key._id);
      expect(updated.isActive).toBe(false);
    });

    it('returns 404 for non-existent key', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).post(`${BASE}/${fakeId}/revoke`).set(headers).expect(404);
    });
  });

  // ── DELETE /api/api-keys/:id ──────────────────────────────────────────────
  describe('DELETE /api/api-keys/:id', () => {
    it('permanently deletes an API key', async () => {
      const { school, app, headers } = await setup();
      const key = await ApiKey.create({
        schoolId: school._id,
        name: 'Delete',
        keyHash: 'hash123',
        keyPrefix: 'pref',
        scopes: ['read:all'],
      });

      const res = await request(app).delete(`${BASE}/${key._id}`).set(headers).expect(200);
      expect(res.body.message).toMatch(/deleted/i);

      const remaining = await ApiKey.findById(key._id);
      expect(remaining).toBeNull();
    });

    it('returns 404 for non-existent key', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).delete(`${BASE}/${fakeId}`).set(headers).expect(404);
    });
  });

  // ── Multi-tenancy ─────────────────────────────────────────────────────────
  describe('multi-tenancy', () => {
    it('does not return keys from another school', async () => {
      const schoolA = await createSchoolRecord({ name: 'School A', code: 'KEYA' });
      const schoolB = await createSchoolRecord({ name: 'School B', code: 'KEYB' });
      const adminA = await createStaffUser({
        name: 'Admin A',
        email: 'a@example.com',
        schoolId: schoolA._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      await ApiKey.create({
        schoolId: schoolA._id,
        name: 'A-only',
        keyHash: 'h1',
        keyPrefix: 'p1',
        scopes: ['read:all'],
      });
      await ApiKey.create({
        schoolId: schoolB._id,
        name: 'B-only',
        keyHash: 'h2',
        keyPrefix: 'p2',
        scopes: ['read:all'],
      });

      const { app } = createTestApp();
      const res = await request(app).get(BASE).set(authHeadersFor(adminA, 'admin')).expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe('A-only');
    });
  });
});
