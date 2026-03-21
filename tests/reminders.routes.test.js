import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import Reminder from '../models/Reminder.js';
import ReminderTemplate from '../models/ReminderTemplate.js';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

// Mock the Agenda scheduler so tests don't require a real job scheduler.
vi.mock('../config/agenda.js', () => ({
  scheduleJob: vi.fn().mockResolvedValue(undefined),
  cancelJobs: vi.fn().mockResolvedValue(undefined),
}));

let seq = 0;
function nextSeq() {
  return ++seq;
}

async function setup() {
  const school = await createSchoolRecord({
    name: `Reminders School ${nextSeq()}`,
    code: `REM-${nextSeq()}`,
  });
  const admin = await createStaffUser({ schoolId: school._id });
  const { app } = createTestApp();
  const headers = authHeadersFor(admin, 'admin');
  return { school, admin, app, headers };
}

function buildReminderPayload(overrides = {}) {
  return {
    title: 'Fee Due Reminder',
    type: 'fee',
    message: 'Your fee is due soon.',
    triggers: [{ condition: 'days_before_due', value: 7 }],
    recipients: [{ type: 'parents' }],
    channels: ['inapp'],
    startDate: new Date(Date.now() + 86400000).toISOString(),
    ...overrides,
  };
}

async function createReminderDirect(adminId) {
  return Reminder.create({
    title: 'Test Reminder',
    type: 'fee',
    message: 'Test message',
    triggers: [{ condition: 'days_before_due', value: 3 }],
    recipients: [{ type: 'all' }],
    channels: ['inapp'],
    startDate: new Date(),
    isActive: true,
    createdBy: adminId,
    nextExecutionAt: new Date(),
  });
}

describe('reminders routes', () => {
  // ── Auth ─────────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('returns 401 for GET /api/reminders without auth', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/reminders').expect(401);
    });

    it('returns 401 for POST /api/reminders without auth', async () => {
      const { app } = createTestApp();
      await request(app).post('/api/reminders').send(buildReminderPayload()).expect(401);
    });
  });

  // ── GET / ────────────────────────────────────────────────────────────────
  describe('GET /api/reminders', () => {
    it('returns empty list when no reminders exist', async () => {
      const { app, headers } = await setup();
      const res = await request(app).get('/api/reminders').set(headers).expect(200);
      expect(res.body.reminders).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it('returns existing reminders with pagination info', async () => {
      const { admin, app, headers } = await setup();
      await createReminderDirect(admin._id);
      await createReminderDirect(admin._id);

      const res = await request(app).get('/api/reminders').set(headers).expect(200);
      expect(res.body.reminders).toHaveLength(2);
      expect(res.body.total).toBe(2);
    });

    it('filters reminders by type', async () => {
      const { admin, app, headers } = await setup();
      await Reminder.create({
        title: 'Fee',
        type: 'fee',
        message: 'msg',
        triggers: [],
        recipients: [],
        channels: [],
        startDate: new Date(),
        isActive: true,
        createdBy: admin._id,
        nextExecutionAt: new Date(),
      });
      await Reminder.create({
        title: 'Attendance',
        type: 'attendance',
        message: 'msg',
        triggers: [],
        recipients: [],
        channels: [],
        startDate: new Date(),
        isActive: true,
        createdBy: admin._id,
        nextExecutionAt: new Date(),
      });

      const res = await request(app)
        .get('/api/reminders')
        .query({ type: 'attendance' })
        .set(headers)
        .expect(200);

      expect(res.body.reminders).toHaveLength(1);
      expect(res.body.reminders[0].type).toBe('attendance');
    });

    it('filters reminders by isActive', async () => {
      const { admin, app, headers } = await setup();
      await Reminder.create({
        title: 'Active',
        type: 'fee',
        message: 'msg',
        triggers: [],
        recipients: [],
        channels: [],
        startDate: new Date(),
        isActive: true,
        createdBy: admin._id,
        nextExecutionAt: new Date(),
      });
      await Reminder.create({
        title: 'Inactive',
        type: 'fee',
        message: 'msg',
        triggers: [],
        recipients: [],
        channels: [],
        startDate: new Date(),
        isActive: false,
        createdBy: admin._id,
        nextExecutionAt: null,
      });

      const res = await request(app)
        .get('/api/reminders')
        .query({ isActive: 'false' })
        .set(headers)
        .expect(200);

      expect(res.body.reminders).toHaveLength(1);
      expect(res.body.reminders[0].title).toBe('Inactive');
    });
  });

  // ── POST / ───────────────────────────────────────────────────────────────
  describe('POST /api/reminders', () => {
    it('creates a reminder and schedules it', async () => {
      const { app, headers } = await setup();
      const res = await request(app)
        .post('/api/reminders')
        .set(headers)
        .send(buildReminderPayload())
        .expect(201);

      expect(res.body._id).toBeDefined();
      expect(res.body.title).toBe('Fee Due Reminder');
      expect(res.body.isActive).toBe(true);
    });
  });

  // ── GET /:id ─────────────────────────────────────────────────────────────
  describe('GET /api/reminders/:id', () => {
    it('returns 404 for non-existent reminder', async () => {
      const { app, headers } = await setup();
      await request(app).get('/api/reminders/000000000000000000000000').set(headers).expect(404);
    });

    it('returns reminder details with empty logs', async () => {
      const { admin, app, headers } = await setup();
      const reminder = await createReminderDirect(admin._id);

      const res = await request(app).get(`/api/reminders/${reminder._id}`).set(headers).expect(200);

      expect(res.body._id).toBe(reminder._id.toString());
      expect(res.body.title).toBe('Test Reminder');
      expect(Array.isArray(res.body.logs)).toBe(true);
    });
  });

  // ── PUT /:id ─────────────────────────────────────────────────────────────
  describe('PUT /api/reminders/:id', () => {
    it('returns 404 for non-existent reminder', async () => {
      const { app, headers } = await setup();
      await request(app)
        .put('/api/reminders/000000000000000000000000')
        .set(headers)
        .send({ title: 'New Title' })
        .expect(404);
    });

    it('updates reminder fields', async () => {
      const { admin, app, headers } = await setup();
      const reminder = await createReminderDirect(admin._id);

      const res = await request(app)
        .put(`/api/reminders/${reminder._id}`)
        .set(headers)
        .send({ title: 'Updated Title', message: 'Updated message' })
        .expect(200);

      expect(res.body.title).toBe('Updated Title');
      expect(res.body.message).toBe('Updated message');
    });
  });

  // ── DELETE /:id ───────────────────────────────────────────────────────────
  describe('DELETE /api/reminders/:id', () => {
    it('returns 404 for non-existent reminder', async () => {
      const { app, headers } = await setup();
      await request(app).delete('/api/reminders/000000000000000000000000').set(headers).expect(404);
    });

    it('deletes reminder successfully', async () => {
      const { admin, app, headers } = await setup();
      const reminder = await createReminderDirect(admin._id);

      const res = await request(app)
        .delete(`/api/reminders/${reminder._id}`)
        .set(headers)
        .expect(200);

      expect(res.body.message).toMatch(/deleted/i);

      const found = await Reminder.findById(reminder._id);
      expect(found).toBeNull();
    });
  });

  // ── POST /:id/toggle ──────────────────────────────────────────────────────
  describe('POST /api/reminders/:id/toggle', () => {
    it('returns 404 for non-existent reminder', async () => {
      const { app, headers } = await setup();
      await request(app)
        .post('/api/reminders/000000000000000000000000/toggle')
        .set(headers)
        .expect(404);
    });

    it('deactivates an active reminder', async () => {
      const { admin, app, headers } = await setup();
      const reminder = await createReminderDirect(admin._id);

      const res = await request(app)
        .post(`/api/reminders/${reminder._id}/toggle`)
        .set(headers)
        .send({ active: false })
        .expect(200);

      expect(res.body.isActive).toBe(false);
    });

    it('activates an inactive reminder', async () => {
      const { admin, app, headers } = await setup();
      const reminder = await Reminder.create({
        title: 'Inactive',
        type: 'fee',
        message: 'msg',
        triggers: [],
        recipients: [],
        channels: [],
        startDate: new Date(),
        isActive: false,
        createdBy: admin._id,
        nextExecutionAt: null,
      });

      const res = await request(app)
        .post(`/api/reminders/${reminder._id}/toggle`)
        .set(headers)
        .send({ active: true })
        .expect(200);

      expect(res.body.isActive).toBe(true);
    });
  });

  // ── POST /:id/duplicate ───────────────────────────────────────────────────
  describe('POST /api/reminders/:id/duplicate', () => {
    it('returns 404 for non-existent reminder', async () => {
      const { app, headers } = await setup();
      await request(app)
        .post('/api/reminders/000000000000000000000000/duplicate')
        .set(headers)
        .expect(404);
    });

    it('creates a copy of the reminder as inactive', async () => {
      const { admin, app, headers } = await setup();
      const reminder = await createReminderDirect(admin._id);

      const res = await request(app)
        .post(`/api/reminders/${reminder._id}/duplicate`)
        .set(headers)
        .expect(201);

      expect(res.body._id).not.toBe(reminder._id.toString());
      expect(res.body.title).toContain('Copy');
      expect(res.body.isActive).toBe(false);
    });
  });

  // ── Templates ─────────────────────────────────────────────────────────────
  describe('GET /api/reminders/templates/all', () => {
    it('returns empty list when no templates exist', async () => {
      const { app, headers } = await setup();
      const res = await request(app).get('/api/reminders/templates/all').set(headers).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(0);
    });
  });

  describe('POST /api/reminders/templates', () => {
    it('creates a reminder template', async () => {
      const { app, headers } = await setup();
      const res = await request(app)
        .post('/api/reminders/templates')
        .set(headers)
        .send({
          name: 'Fee Reminder Template',
          type: 'fee',
          message: 'Dear parent, your fee of {amount} is due on {date}.',
          defaultChannels: ['inapp', 'sms'],
        })
        .expect(201);

      expect(res.body._id).toBeDefined();
      expect(res.body.name).toBe('Fee Reminder Template');
    });
  });
});
