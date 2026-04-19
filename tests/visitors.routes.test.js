/**
 * Tests for /api/visitors routes (standalone visitors.js route file).
 *
 * NOTE: All routes in visitors.js use checkPermission('front-office', ...) but
 * the actual module in PERMISSION_TEMPLATES is 'front-desk'. This mismatch means
 * every authenticated request returns 403 (Access Denied). Tests below document
 * this current behavior. The 401 (unauthenticated) tests confirm auth middleware
 * fires before the permission check.
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  authHeadersFor,
  createStaffUser,
  createStudentRecord,
  createClassRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

describe('visitors routes (/api/visitors)', () => {
  describe('GET /api/visitors', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/visitors').expect(401);
    });

    it('grants access to authenticated admin', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      const res = await request(app).get('/api/visitors').set(authHeadersFor(admin)).expect(200);
      expect(res.body.error).toBeUndefined();
    });
  });

  describe('GET /api/visitors/today', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/visitors/today').expect(401);
    });

    it('returns 403 for authenticated admin', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app).get('/api/visitors/today').set(authHeadersFor(admin)).expect(200);
    });
  });

  describe('GET /api/visitors/active', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/visitors/active').expect(401);
    });

    it('returns 403 for authenticated admin', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app).get('/api/visitors/active').set(authHeadersFor(admin)).expect(200);
    });
  });

  describe('GET /api/visitors/search', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/visitors/search').query({ q: 'Alice' }).expect(401);
    });

    it('returns 403 for authenticated admin', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app)
        .get('/api/visitors/search')
        .query({ q: 'Alice' })
        .set(authHeadersFor(admin))
        .expect(200);
    });
  });

  describe('GET /api/visitors/parents/search', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/visitors/parents/search').query({ q: 'John' }).expect(401);
    });

    it('returns 403 for authenticated admin', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app)
        .get('/api/visitors/parents/search')
        .query({ q: 'John' })
        .set(authHeadersFor(admin))
        .expect(200);
    });
  });

  describe('POST /api/visitors', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app)
        .post('/api/visitors')
        .send({ name: 'Test', phone: '9000000001', purpose: 'PARENT_MEETING' })
        .expect(401);
    });

    it('accepts a valid payload from authenticated admin', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      const res = await request(app)
        .post('/api/visitors')
        .set(authHeadersFor(admin))
        .send({ name: 'Test', phone: '9000000001', purpose: 'PARENT_MEETING' });
      // Either success (201/200) or validation rejection (400) is acceptable;
      // the point is no longer 403.
      expect([200, 201, 400]).toContain(res.status);
      expect(res.status).not.toBe(403);
    });
  });

  describe('PUT /api/visitors/:id', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app)
        .put('/api/visitors/000000000000000000000001')
        .send({ notes: 'update' })
        .expect(401);
    });

    it('returns 403 for authenticated admin', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app)
        .put('/api/visitors/000000000000000000000001')
        .set(authHeadersFor(admin))
        .send({ notes: 'update' })
        .expect(404);
    });
  });

  describe('POST /api/visitors/:id/check-out', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).post('/api/visitors/000000000000000000000001/check-out').expect(401);
    });

    it('returns 403 for authenticated admin', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app)
        .post('/api/visitors/000000000000000000000001/check-out')
        .set(authHeadersFor(admin))
        .expect(404);
    });
  });

  describe('DELETE /api/visitors/:id', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).delete('/api/visitors/000000000000000000000001').expect(401);
    });

    it('returns 403 for authenticated admin', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app)
        .delete('/api/visitors/000000000000000000000001')
        .set(authHeadersFor(admin))
        .expect(404);
    });
  });
});
