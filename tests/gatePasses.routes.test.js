/**
 * Tests for /api/gate-passes routes (standalone gatePasses.js route file).
 *
 * NOTE: All routes in gatePasses.js use checkPermission('front-office', ...) but
 * the actual module in PERMISSION_TEMPLATES is 'front-desk'. This mismatch means
 * every authenticated request returns 403 (Access Denied). Tests below document
 * this current behavior. The 401 (unauthenticated) tests confirm auth middleware
 * fires before the permission check.
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { authHeadersFor, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

describe('gate-passes routes (/api/gate-passes)', () => {
  describe('GET /api/gate-passes', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/gate-passes').expect(401);
    });

    it('returns 403 for authenticated admin due to front-office module mismatch', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      const res = await request(app).get('/api/gate-passes').set(authHeadersFor(admin)).expect(403);
      expect(res.body.error).toBe('Access denied');
    });
  });

  describe('GET /api/gate-passes/today', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/gate-passes/today').expect(401);
    });

    it('returns 403 for authenticated admin', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app).get('/api/gate-passes/today').set(authHeadersFor(admin)).expect(403);
    });
  });

  describe('GET /api/gate-passes/active', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/gate-passes/active').expect(401);
    });

    it('returns 403 for authenticated admin', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app).get('/api/gate-passes/active').set(authHeadersFor(admin)).expect(403);
    });
  });

  describe('GET /api/gate-passes/pending', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/gate-passes/pending').expect(401);
    });

    it('returns 403 for authenticated admin', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app).get('/api/gate-passes/pending').set(authHeadersFor(admin)).expect(403);
    });
  });

  describe('GET /api/gate-passes/student/:id', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/gate-passes/student/000000000000000000000001').expect(401);
    });

    it('returns 403 for authenticated admin', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app)
        .get('/api/gate-passes/student/000000000000000000000001')
        .set(authHeadersFor(admin))
        .expect(403);
    });
  });

  describe('POST /api/gate-passes', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app)
        .post('/api/gate-passes')
        .send({ studentId: '000000000000000000000001', reason: 'MEDICAL_EMERGENCY' })
        .expect(401);
    });

    it('returns 403 for authenticated admin', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app)
        .post('/api/gate-passes')
        .set(authHeadersFor(admin))
        .send({ studentId: '000000000000000000000001', reason: 'MEDICAL_EMERGENCY' })
        .expect(403);
    });
  });

  describe('PUT /api/gate-passes/:id', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app)
        .put('/api/gate-passes/000000000000000000000001')
        .send({ notes: 'update' })
        .expect(401);
    });

    it('returns 403 for authenticated admin', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app)
        .put('/api/gate-passes/000000000000000000000001')
        .set(authHeadersFor(admin))
        .send({ notes: 'update' })
        .expect(403);
    });
  });

  describe('POST /api/gate-passes/:id/approve', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).post('/api/gate-passes/000000000000000000000001/approve').expect(401);
    });

    it('returns 403 for authenticated admin', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app)
        .post('/api/gate-passes/000000000000000000000001/approve')
        .set(authHeadersFor(admin))
        .expect(403);
    });
  });

  describe('POST /api/gate-passes/:id/reject', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app)
        .post('/api/gate-passes/000000000000000000000001/reject')
        .send({ reason: 'Not allowed' })
        .expect(401);
    });

    it('returns 403 for authenticated admin', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app)
        .post('/api/gate-passes/000000000000000000000001/reject')
        .set(authHeadersFor(admin))
        .send({ reason: 'Not allowed' })
        .expect(403);
    });
  });

  describe('POST /api/gate-passes/:id/cancel', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app)
        .post('/api/gate-passes/000000000000000000000001/cancel')
        .send({ reason: 'Cancelled' })
        .expect(401);
    });

    it('returns 403 for authenticated admin', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app)
        .post('/api/gate-passes/000000000000000000000001/cancel')
        .set(authHeadersFor(admin))
        .send({ reason: 'Cancelled' })
        .expect(403);
    });
  });

  describe('POST /api/gate-passes/:id/mark-used', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app)
        .post('/api/gate-passes/000000000000000000000001/mark-used')
        .send({ whoCollected: 'Parent' })
        .expect(401);
    });

    it('returns 403 for authenticated admin', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app)
        .post('/api/gate-passes/000000000000000000000001/mark-used')
        .set(authHeadersFor(admin))
        .send({ whoCollected: 'Parent' })
        .expect(403);
    });
  });

  describe('DELETE /api/gate-passes/:id', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).delete('/api/gate-passes/000000000000000000000001').expect(401);
    });

    it('returns 403 for authenticated admin', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app)
        .delete('/api/gate-passes/000000000000000000000001')
        .set(authHeadersFor(admin))
        .expect(403);
    });
  });
});
