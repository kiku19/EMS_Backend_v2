import request from 'supertest';
import { describe, expect, it } from 'vitest';
import CallHistory from '../models/CallHistory.js';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

let seq = 0;
function nextSeq() {
  return ++seq;
}

async function setup() {
  const school = await createSchoolRecord({
    name: `Calls School ${nextSeq()}`,
    code: `CALLS-${nextSeq()}`,
  });
  const caller = await createStaffUser({ schoolId: school._id, name: 'Caller User' });
  const callee = await createStaffUser({ schoolId: school._id, name: 'Callee User' });
  const { app } = createTestApp();
  const callerHeaders = authHeadersFor(caller, 'admin');
  const calleeHeaders = authHeadersFor(callee, 'admin');
  return { school, caller, callee, app, callerHeaders, calleeHeaders };
}

async function createCall(schoolId, callerId, calleeId, status = 'initiated') {
  return CallHistory.create({
    schoolId,
    participants: [
      { userId: callerId, userModel: 'Staff', joinedAt: new Date() },
      { userId: calleeId, userModel: 'Staff' },
    ],
    callType: 'audio',
    initiatedBy: callerId,
    initiatorModel: 'Staff',
    status,
    startTime: new Date(),
  });
}

describe('calls routes', () => {
  // ── Auth ─────────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('returns 401 for POST /api/calls/initiate without auth', async () => {
      const { app } = createTestApp();
      await request(app)
        .post('/api/calls/initiate')
        .send({ to: { userId: '123', userModel: 'Staff' }, callType: 'audio' })
        .expect(401);
    });

    it('returns 401 for GET /api/calls/history/me without auth', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/calls/history/me').expect(401);
    });

    it('returns 401 for GET /api/calls/missed/me without auth', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/calls/missed/me').expect(401);
    });
  });

  // ── POST /initiate ────────────────────────────────────────────────────────
  describe('POST /api/calls/initiate', () => {
    it('returns 400 when to or callType is missing', async () => {
      const { app, callerHeaders } = await setup();

      await request(app)
        .post('/api/calls/initiate')
        .set(callerHeaders)
        .send({ callType: 'audio' })
        .expect(400);
    });

    it('creates a call record and returns it', async () => {
      const { callee, app, callerHeaders } = await setup();

      const res = await request(app)
        .post('/api/calls/initiate')
        .set(callerHeaders)
        .send({
          to: { userId: callee._id.toString(), userModel: 'Staff' },
          callType: 'video',
        })
        .expect(200);

      expect(res.body._id).toBeDefined();
      expect(res.body.callType).toBe('video');
      expect(res.body.status).toBe('initiated');
    });
  });

  // ── POST /:id/accept ──────────────────────────────────────────────────────
  describe('POST /api/calls/:id/accept', () => {
    it('returns 404 for non-existent call', async () => {
      const { app, calleeHeaders } = await setup();
      await request(app)
        .post('/api/calls/000000000000000000000000/accept')
        .set(calleeHeaders)
        .expect(404);
    });

    it('updates call status to connected', async () => {
      const { school, caller, callee, app, calleeHeaders } = await setup();
      const call = await createCall(school._id, caller._id, callee._id);

      const res = await request(app)
        .post(`/api/calls/${call._id}/accept`)
        .set(calleeHeaders)
        .expect(200);

      expect(res.body.status).toBe('connected');
    });
  });

  // ── POST /:id/reject ──────────────────────────────────────────────────────
  describe('POST /api/calls/:id/reject', () => {
    it('returns 404 for non-existent call', async () => {
      const { app, calleeHeaders } = await setup();
      await request(app)
        .post('/api/calls/000000000000000000000000/reject')
        .set(calleeHeaders)
        .expect(404);
    });

    it('updates call status to rejected', async () => {
      const { school, caller, callee, app, calleeHeaders } = await setup();
      const call = await createCall(school._id, caller._id, callee._id);

      const res = await request(app)
        .post(`/api/calls/${call._id}/reject`)
        .set(calleeHeaders)
        .expect(200);

      expect(res.body.status).toBe('rejected');
    });
  });

  // ── POST /:id/end ─────────────────────────────────────────────────────────
  describe('POST /api/calls/:id/end', () => {
    it('returns 404 for non-existent call', async () => {
      const { app, callerHeaders } = await setup();
      await request(app)
        .post('/api/calls/000000000000000000000000/end')
        .set(callerHeaders)
        .expect(404);
    });

    it('marks call as ended with reason', async () => {
      const { school, caller, callee, app, callerHeaders } = await setup();
      const call = await createCall(school._id, caller._id, callee._id, 'connected');

      const res = await request(app)
        .post(`/api/calls/${call._id}/end`)
        .set(callerHeaders)
        .send({ reason: 'user_ended' })
        .expect(200);

      expect(res.body.status).toBe('ended');
      expect(res.body.endReason).toBe('user_ended');
    });
  });

  // ── GET /history/me ───────────────────────────────────────────────────────
  describe('GET /api/calls/history/me', () => {
    it('returns empty array when user has no call history', async () => {
      const { app, callerHeaders } = await setup();
      const res = await request(app).get('/api/calls/history/me').set(callerHeaders).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(0);
    });

    it('returns calls the user participated in', async () => {
      const { school, caller, callee, app, callerHeaders } = await setup();
      await createCall(school._id, caller._id, callee._id);

      const res = await request(app).get('/api/calls/history/me').set(callerHeaders).expect(200);

      expect(res.body).toHaveLength(1);
    });

    it('does not return calls from other schools', async () => {
      const { app, callerHeaders } = await setup();
      const otherSchool = await createSchoolRecord({ name: 'Other', code: `COTHER-${nextSeq()}` });
      const otherUser = await createStaffUser({ schoolId: otherSchool._id });
      await createCall(otherSchool._id, otherUser._id, otherUser._id);

      const res = await request(app).get('/api/calls/history/me').set(callerHeaders).expect(200);

      expect(res.body).toHaveLength(0);
    });
  });

  // ── GET /missed/me ────────────────────────────────────────────────────────
  describe('GET /api/calls/missed/me', () => {
    it('returns empty array when user has no missed calls', async () => {
      const { app, callerHeaders } = await setup();
      const res = await request(app).get('/api/calls/missed/me').set(callerHeaders).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(0);
    });

    it('returns only missed calls for the user', async () => {
      const { school, caller, callee, app, calleeHeaders } = await setup();
      await createCall(school._id, caller._id, callee._id, 'missed');
      await createCall(school._id, caller._id, callee._id, 'ended');

      const res = await request(app).get('/api/calls/missed/me').set(calleeHeaders).expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].status).toBe('missed');
    });
  });
});
