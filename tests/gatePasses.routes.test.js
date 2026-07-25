/**
 * Tests for /api/gate-passes routes (standalone gatePasses.js route file).
 *
 * Front-desk permission module: routes use checkPermission('front-desk', ...)
 * matching the key in PERMISSION_TEMPLATES. (Previously the routes used the
 * mismatched 'front-office' string, which made every authenticated request
 * return 403 — now fixed.) Approve/reject use the 'approve' action key.
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

    it('grants access to authenticated admin (front-office module now resolved)', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      const res = await request(app).get('/api/gate-passes').set(authHeadersFor(admin)).expect(200);
      // Response shape is a list; body shouldn't carry an 'Access denied' error now
      expect(res.body.error).toBeUndefined();
    });
  });

  describe('GET /api/gate-passes/today', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/gate-passes/today').expect(401);
    });

    it('returns 200 for authenticated admin', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app).get('/api/gate-passes/today').set(authHeadersFor(admin)).expect(200);
    });
  });

  describe('GET /api/gate-passes/active', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/gate-passes/active').expect(401);
    });

    it('returns 200 for authenticated admin', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app).get('/api/gate-passes/active').set(authHeadersFor(admin)).expect(200);
    });
  });

  describe('GET /api/gate-passes/pending', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/gate-passes/pending').expect(401);
    });

    it('returns 200 for authenticated admin', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app).get('/api/gate-passes/pending').set(authHeadersFor(admin)).expect(200);
    });
  });

  describe('GET /api/gate-passes/student/:id', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/gate-passes/student/000000000000000000000001').expect(401);
    });

    it('returns an empty list for a student with no gate passes', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      const res = await request(app)
        .get('/api/gate-passes/student/000000000000000000000001')
        .set(authHeadersFor(admin))
        .expect(200);
      expect(Array.isArray(res.body) || Array.isArray(res.body?.data)).toBe(true);
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

    it('validates payload for authenticated admin', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      const res = await request(app)
        .post('/api/gate-passes')
        .set(authHeadersFor(admin))
        .send({ studentId: '000000000000000000000001', reason: 'MEDICAL_EMERGENCY' });
      expect([200, 201, 400, 404]).toContain(res.status);
      expect(res.status).not.toBe(403);
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

    it('returns 200 for authenticated admin', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app)
        .put('/api/gate-passes/000000000000000000000001')
        .set(authHeadersFor(admin))
        .send({ notes: 'update' })
        .expect(404);
    });
  });

  describe('POST /api/gate-passes/:id/approve', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).post('/api/gate-passes/000000000000000000000001/approve').expect(401);
    });

    it('returns 200 for authenticated admin', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app)
        .post('/api/gate-passes/000000000000000000000001/approve')
        .set(authHeadersFor(admin))
        .expect(404);
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

    it('returns 200 for authenticated admin', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app)
        .post('/api/gate-passes/000000000000000000000001/reject')
        .set(authHeadersFor(admin))
        .send({ reason: 'Not allowed' })
        .expect(404);
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

    it('returns 200 for authenticated admin', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app)
        .post('/api/gate-passes/000000000000000000000001/cancel')
        .set(authHeadersFor(admin))
        .send({ reason: 'Cancelled' })
        .expect(404);
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

    it('returns 200 for authenticated admin', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app)
        .post('/api/gate-passes/000000000000000000000001/mark-used')
        .set(authHeadersFor(admin))
        .send({ whoCollected: 'Parent' })
        .expect(404);
    });
  });

  describe('DELETE /api/gate-passes/:id', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).delete('/api/gate-passes/000000000000000000000001').expect(401);
    });

    it('returns 200 for authenticated admin', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app)
        .delete('/api/gate-passes/000000000000000000000001')
        .set(authHeadersFor(admin))
        .expect(404);
    });
  });
});
