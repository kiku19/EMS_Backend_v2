import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import EmailCampaign from '../models/EmailCampaign.js';
import {
  authHeadersFor,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
  createClassRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

// Mock the Agenda scheduler and email sender so tests don't require real infrastructure.
vi.mock('../config/agenda.js', () => ({
  scheduleJob: vi.fn().mockResolvedValue(undefined),
  cancelJobs: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../config/email.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  verifyEmailConfig: vi.fn().mockResolvedValue(undefined),
}));

function buildCampaignPayload(overrides = {}) {
  return {
    name: 'Test Campaign',
    subject: 'Test Subject',
    htmlBody: '<p>Hello {{parentName}}, your child {{studentName}}.</p>',
    textBody: 'Hello {{parentName}}, your child {{studentName}}.',
    targetCriteria: {
      groupType: 'all_parents',
    },
    ...overrides,
  };
}

async function createCampaignDirect(adminId, schoolId, overrides = {}) {
  return EmailCampaign.create({
    schoolId,
    name: 'Direct Campaign',
    subject: 'Direct Subject',
    htmlBody: '<p>Body</p>',
    targetCriteria: { groupType: 'all_parents' },
    status: 'draft',
    createdBy: adminId,
    ...overrides,
  });
}

let seq = 0;
function nextSeq() {
  return ++seq;
}

async function setup() {
  const school = await createSchoolRecord({
    name: `EmailCampaign School ${nextSeq()}`,
    code: `EC-${nextSeq()}`,
  });
  const admin = await createStaffUser({ schoolId: school._id });
  const { app } = createTestApp();
  const headers = authHeadersFor(admin, 'admin');
  return { school, admin, app, headers };
}

describe('email-campaigns routes', () => {
  // ─── Auth ──────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('returns 401 when no auth token is provided', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/email-campaigns').expect(401);
      await request(app).post('/api/email-campaigns').send(buildCampaignPayload()).expect(401);
    });
  });

  // ─── POST /api/email-campaigns ─────────────────────────────────────────
  describe('POST /api/email-campaigns', () => {
    it('creates a draft campaign with valid payload', async () => {
      const { school, admin, app, headers } = await setup();
      const payload = buildCampaignPayload();

      const res = await request(app)
        .post('/api/email-campaigns')
        .set(headers)
        .send(payload)
        .expect(201);

      expect(res.body).toMatchObject({
        name: payload.name,
        subject: payload.subject,
        status: 'draft',
        schoolId: school._id.toString(),
      });
      expect(res.body._id).toBeTruthy();
    });

    it('creates a scheduled campaign when scheduledFor is provided', async () => {
      const { school, admin, app, headers } = await setup();
      const scheduledFor = new Date(Date.now() + 86400000).toISOString();
      const payload = buildCampaignPayload({ scheduledFor });

      const res = await request(app)
        .post('/api/email-campaigns')
        .set(headers)
        .send(payload)
        .expect(201);

      expect(res.body.status).toBe('scheduled');
      expect(res.body.scheduledFor).toBeTruthy();
    });

    it('returns 400 when validation fails (missing name)', async () => {
      const { app, headers } = await setup();
      const res = await request(app)
        .post('/api/email-campaigns')
        .set(headers)
        .send(buildCampaignPayload({ name: '' }))
        .expect(400);

      expect(res.body.error).toBeTruthy();
    });
  });

  // ─── GET /api/email-campaigns ──────────────────────────────────────────
  describe('GET /api/email-campaigns', () => {
    it('returns paginated list of campaigns', async () => {
      const { school, admin, app, headers } = await setup();
      await createCampaignDirect(admin._id, school._id, { name: 'Campaign A' });
      await createCampaignDirect(admin._id, school._id, { name: 'Campaign B' });

      const res = await request(app).get('/api/email-campaigns').set(headers).expect(200);

      expect(res.body.campaigns).toHaveLength(2);
      expect(res.body.total).toBe(2);
      expect(res.body.currentPage).toBe(1);
    });

    it('filters campaigns by status', async () => {
      const { school, admin, app, headers } = await setup();
      await createCampaignDirect(admin._id, school._id, { name: 'Draft', status: 'draft' });
      await createCampaignDirect(admin._id, school._id, { name: 'Sent', status: 'sent' });

      const res = await request(app)
        .get('/api/email-campaigns')
        .query({ status: 'sent' })
        .set(headers)
        .expect(200);

      expect(res.body.campaigns).toHaveLength(1);
      expect(res.body.campaigns[0].name).toBe('Sent');
    });
  });

  // ─── GET /api/email-campaigns/:id ──────────────────────────────────────
  describe('GET /api/email-campaigns/:id', () => {
    it('returns a campaign by id', async () => {
      const { school, admin, app, headers } = await setup();
      const campaign = await createCampaignDirect(admin._id, school._id, {
        name: 'Detail Campaign',
      });

      const res = await request(app)
        .get(`/api/email-campaigns/${campaign._id}`)
        .set(headers)
        .expect(200);

      expect(res.body.name).toBe('Detail Campaign');
    });

    it('returns 404 for non-existent campaign', async () => {
      const { app, headers } = await setup();
      const fakeId = '000000000000000000000000';
      await request(app).get(`/api/email-campaigns/${fakeId}`).set(headers).expect(404);
    });
  });

  // ─── PUT /api/email-campaigns/:id ──────────────────────────────────────
  describe('PUT /api/email-campaigns/:id', () => {
    it('updates a draft campaign', async () => {
      const { school, admin, app, headers } = await setup();
      const campaign = await createCampaignDirect(admin._id, school._id);

      const res = await request(app)
        .put(`/api/email-campaigns/${campaign._id}`)
        .set(headers)
        .send({ name: 'Updated Name' })
        .expect(200);

      expect(res.body.name).toBe('Updated Name');
    });

    it('returns 400 when trying to edit a sent campaign', async () => {
      const { school, admin, app, headers } = await setup();
      const campaign = await createCampaignDirect(admin._id, school._id, { status: 'sent' });

      const res = await request(app)
        .put(`/api/email-campaigns/${campaign._id}`)
        .set(headers)
        .send({ name: 'New Name' })
        .expect(400);

      expect(res.body.error).toMatch(/cannot edit/i);
    });

    it('returns 404 for non-existent campaign', async () => {
      const { app, headers } = await setup();
      const fakeId = '000000000000000000000000';
      await request(app)
        .put(`/api/email-campaigns/${fakeId}`)
        .set(headers)
        .send({ name: 'X' })
        .expect(404);
    });
  });

  // ─── DELETE /api/email-campaigns/:id ───────────────────────────────────
  describe('DELETE /api/email-campaigns/:id', () => {
    it('deletes a draft campaign', async () => {
      const { school, admin, app, headers } = await setup();
      const campaign = await createCampaignDirect(admin._id, school._id);

      await request(app).delete(`/api/email-campaigns/${campaign._id}`).set(headers).expect(200);

      const deleted = await EmailCampaign.findById(campaign._id);
      expect(deleted).toBeNull();
    });

    it('returns 404 for non-existent campaign', async () => {
      const { app, headers } = await setup();
      const fakeId = '000000000000000000000000';
      await request(app).delete(`/api/email-campaigns/${fakeId}`).set(headers).expect(404);
    });
  });

  // ─── GET /api/email-campaigns/:id/preview-html ─────────────────────────
  describe('GET /api/email-campaigns/:id/preview-html', () => {
    it('returns HTML preview for a campaign', async () => {
      const { school, admin, app, headers } = await setup();
      const campaign = await createCampaignDirect(admin._id, school._id, {
        htmlBody: '<p>Hello</p>',
        subject: 'Preview Subject',
      });

      const res = await request(app)
        .get(`/api/email-campaigns/${campaign._id}/preview-html`)
        .set(headers)
        .expect(200);

      expect(res.text).toContain('Hello');
      expect(res.text).toContain('Preview Subject');
      expect(res.headers['content-type']).toMatch(/text\/html/);
    });

    it('returns 404 for non-existent campaign', async () => {
      const { app, headers } = await setup();
      const fakeId = '000000000000000000000000';
      await request(app)
        .get(`/api/email-campaigns/${fakeId}/preview-html`)
        .set(headers)
        .expect(404);
    });
  });

  // ─── POST /api/email-campaigns/:id/preview-recipients ──────────────────
  describe('POST /api/email-campaigns/:id/preview-recipients', () => {
    it('returns recipient preview for a campaign', async () => {
      const { school, admin, app, headers } = await setup();
      const campaign = await createCampaignDirect(admin._id, school._id);

      const res = await request(app)
        .post(`/api/email-campaigns/${campaign._id}/preview-recipients`)
        .set(headers)
        .expect(200);

      expect(res.body).toHaveProperty('count');
      expect(res.body).toHaveProperty('recipients');
    });

    it('returns 404 for non-existent campaign', async () => {
      const { app, headers } = await setup();
      const fakeId = '000000000000000000000000';
      await request(app)
        .post(`/api/email-campaigns/${fakeId}/preview-recipients`)
        .set(headers)
        .expect(404);
    });
  });

  // ─── POST /api/email-campaigns/:id/send ────────────────────────────────
  describe('POST /api/email-campaigns/:id/send', () => {
    it('returns 400 when no recipients are found', async () => {
      const { school, admin, app, headers } = await setup();
      const campaign = await createCampaignDirect(admin._id, school._id, {
        targetCriteria: { groupType: 'all_parents' },
      });

      const res = await request(app)
        .post(`/api/email-campaigns/${campaign._id}/send`)
        .set(headers)
        .expect(400);

      expect(res.body.error).toMatch(/no recipients/i);
    });

    it('returns 400 when campaign is already sent', async () => {
      const { school, admin, app, headers } = await setup();
      const campaign = await createCampaignDirect(admin._id, school._id, { status: 'sent' });

      const res = await request(app)
        .post(`/api/email-campaigns/${campaign._id}/send`)
        .set(headers)
        .expect(400);

      expect(res.body.error).toMatch(/already sent/i);
    });

    it('returns 404 for non-existent campaign', async () => {
      const { app, headers } = await setup();
      const fakeId = '000000000000000000000000';
      await request(app).post(`/api/email-campaigns/${fakeId}/send`).set(headers).expect(404);
    });
  });

  // ─── GET /api/email-campaigns/:id/analytics ────────────────────────────
  describe('GET /api/email-campaigns/:id/analytics', () => {
    it('returns analytics for a campaign', async () => {
      const { school, admin, app, headers } = await setup();
      const campaign = await createCampaignDirect(admin._id, school._id, {
        status: 'sent',
        analytics: { totalRecipients: 10, sentCount: 8, failedCount: 2 },
      });

      const res = await request(app)
        .get(`/api/email-campaigns/${campaign._id}/analytics`)
        .set(headers)
        .expect(200);

      expect(res.body.analytics).toMatchObject({
        totalRecipients: 10,
        sentCount: 8,
        failedCount: 2,
      });
      expect(res.body.campaign).toBeTruthy();
    });

    it('returns 404 for non-existent campaign', async () => {
      const { app, headers } = await setup();
      const fakeId = '000000000000000000000000';
      await request(app).get(`/api/email-campaigns/${fakeId}/analytics`).set(headers).expect(404);
    });
  });

  // ─── POST /api/email-campaigns/:id/test ────────────────────────────────
  describe('POST /api/email-campaigns/:id/test', () => {
    it('sends a test email to the provided address', async () => {
      const { school, admin, app, headers } = await setup();
      const campaign = await createCampaignDirect(admin._id, school._id);

      const res = await request(app)
        .post(`/api/email-campaigns/${campaign._id}/test`)
        .set(headers)
        .send({ email: 'test@example.com' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/test email sent/i);
    });

    it('returns 400 for invalid email address', async () => {
      const { school, admin, app, headers } = await setup();
      const campaign = await createCampaignDirect(admin._id, school._id);

      const res = await request(app)
        .post(`/api/email-campaigns/${campaign._id}/test`)
        .set(headers)
        .send({ email: 'not-an-email' })
        .expect(400);

      expect(res.body.error).toMatch(/valid test email/i);
    });

    it('returns 404 for non-existent campaign', async () => {
      const { app, headers } = await setup();
      const fakeId = '000000000000000000000000';
      await request(app)
        .post(`/api/email-campaigns/${fakeId}/test`)
        .set(headers)
        .send({ email: 'test@example.com' })
        .expect(404);
    });
  });
});
