import request from 'supertest';
import { describe, it, expect, beforeEach } from 'vitest';
import { FormAssignment, FormSubmission, IntakeForm } from '../database.js';
import { createTestApp } from './helpers/testApp.js';

const BASE = '/api/public';

// Helper: create an active IntakeForm + FormAssignment with an access token
async function createFormAndAssignment({
  token = 'validtoken123',
  expiresInMs = 60 * 60 * 1000,
} = {}) {
  const form = await IntakeForm.create({
    formName: 'Test Form',
    formType: 'student',
    status: 'active',
    fields: [{ name: 'fullName', label: 'Full Name', type: 'text', required: true }],
  });

  const assignment = await FormAssignment.create({
    formId: form._id,
    accessToken: token,
    expiresAt: new Date(Date.now() + expiresInMs),
    status: 'pending',
  });

  return { form, assignment };
}

describe('public routes', () => {
  let app;

  beforeEach(() => {
    ({ app } = createTestApp());
  });

  // ───────────────────────────────────────────────────────────────
  // GET /api/public/form-assignment/:token
  // ───────────────────────────────────────────────────────────────
  describe('GET /form-assignment/:token', () => {
    it('returns 401 for an invalid/missing token', async () => {
      const res = await request(app).get(`${BASE}/form-assignment/nonexistenttoken`).expect(401);

      expect(res.body.code).toBe('INVALID_TOKEN');
    });

    it('returns form details for a valid token', async () => {
      const { form } = await createFormAndAssignment({ token: 'tok-get-valid' });

      const res = await request(app).get(`${BASE}/form-assignment/tok-get-valid`).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.form.id).toBe(form._id.toString());
      expect(res.body.alreadySubmitted).toBe(false);
    });

    it('returns 401 for an expired token', async () => {
      await createFormAndAssignment({ token: 'tok-expired', expiresInMs: -1000 });

      const res = await request(app).get(`${BASE}/form-assignment/tok-expired`).expect(401);

      expect(res.body.error).toMatch(/expired/i);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // POST /api/public/form-submission/:token
  // ───────────────────────────────────────────────────────────────
  describe('POST /form-submission/:token', () => {
    it('returns 401 for an invalid token', async () => {
      const res = await request(app)
        .post(`${BASE}/form-submission/badtoken`)
        .send({ submissionData: { fullName: 'Test User' } })
        .expect(401);

      expect(res.body.code).toBe('INVALID_TOKEN');
    });

    it('returns 400 when submissionData is missing', async () => {
      await createFormAndAssignment({ token: 'tok-submit-nodata' });

      const res = await request(app)
        .post(`${BASE}/form-submission/tok-submit-nodata`)
        .send({})
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('creates a submission for a valid token', async () => {
      await createFormAndAssignment({ token: 'tok-submit-ok' });

      const res = await request(app)
        .post(`${BASE}/form-submission/tok-submit-ok`)
        .send({ submissionData: { fullName: 'Alice Smith' } })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.submission).toHaveProperty('id');
    });

    it('returns 400 when form was already submitted', async () => {
      const { assignment } = await createFormAndAssignment({ token: 'tok-duplicate' });

      // First submit
      await request(app)
        .post(`${BASE}/form-submission/tok-duplicate`)
        .send({ submissionData: { fullName: 'Bob' } })
        .expect(201);

      // Second submit — should fail
      const res = await request(app)
        .post(`${BASE}/form-submission/tok-duplicate`)
        .send({ submissionData: { fullName: 'Bob' } })
        .expect(400);

      expect(res.body.code).toBe('ALREADY_SUBMITTED');
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /api/public/form-submission/:token/status
  // ───────────────────────────────────────────────────────────────
  describe('GET /form-submission/:token/status', () => {
    it('returns 401 for an invalid token', async () => {
      await request(app).get(`${BASE}/form-submission/badtoken/status`).expect(401);
    });

    it('returns submitted: false when no submission exists', async () => {
      await createFormAndAssignment({ token: 'tok-status-empty' });

      const res = await request(app)
        .get(`${BASE}/form-submission/tok-status-empty/status`)
        .expect(200);

      expect(res.body.submitted).toBe(false);
    });

    it('returns submitted: true and review status after submission', async () => {
      const { assignment } = await createFormAndAssignment({ token: 'tok-status-done' });

      // Submit first
      await request(app)
        .post(`${BASE}/form-submission/tok-status-done`)
        .send({ submissionData: { fullName: 'Carol' } })
        .expect(201);

      const res = await request(app)
        .get(`${BASE}/form-submission/tok-status-done/status`)
        .expect(200);

      expect(res.body.submitted).toBe(true);
      expect(res.body.submission).toHaveProperty('reviewStatus');
    });
  });
});
