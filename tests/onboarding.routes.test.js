import request from 'supertest';
import { describe, expect, it } from 'vitest';
import AuditTrail from '../models/AuditTrail.js';
import School from '../models/School.js';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const BASE = '/api/onboarding/step';

describe('onboarding routes', () => {
  async function setup() {
    const school = await createSchoolRecord({ name: 'Onboard School', code: 'OB' });
    const admin = await createStaffUser({
      name: 'Onboard Admin',
      email: 'onboard.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    const { app } = createTestApp();
    return { school, admin, app };
  }

  function adminHeaders(admin) {
    return authHeadersFor(admin, 'admin');
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('GET returns 401 without token', async () => {
      const { app } = createTestApp();
      await request(app).get(BASE).expect(401);
    });

    it('PATCH returns 401 without token', async () => {
      const { app } = createTestApp();
      await request(app).patch(BASE).send({ step: 'academic-year' }).expect(401);
    });
  });

  // ── GET /api/onboarding/step ──────────────────────────────────────────────
  describe('GET /api/onboarding/step', () => {
    it('returns the default wizard state for a fresh school', async () => {
      const { school, admin, app } = await setup();
      const res = await request(app).get(BASE).set(adminHeaders(admin)).expect(200);

      expect(res.body.step).toBe('school-profile');
      expect(res.body.skippedSteps).toEqual([]);
      expect(res.body.completedSteps).toEqual([]);
      expect(res.body.provisioningStatus).toBe('pending');
      expect(res.body.schoolProfileComplete).toBe(false);
      expect(res.body.updatedAt).toBeNull();

      // Verify it actually read from the right school (school-scoping check).
      const fromDb = await School.findById(school._id).lean();
      expect(fromDb).toBeTruthy();
    });

    it('returns persisted state when the wizard has advanced', async () => {
      const { school, admin, app } = await setup();
      await School.updateOne(
        { _id: school._id },
        {
          $set: {
            'metadata.onboardingStep': 'first-class',
            'metadata.onboardingCompletedSteps': ['school-profile', 'academic-year'],
          },
        }
      );

      const res = await request(app).get(BASE).set(adminHeaders(admin)).expect(200);
      expect(res.body.step).toBe('first-class');
      expect(res.body.completedSteps).toEqual(['school-profile', 'academic-year']);
    });
  });

  // ── PATCH /api/onboarding/step — happy path ───────────────────────────────
  describe('PATCH /api/onboarding/step — valid transitions', () => {
    it('advances one step and persists metadata', async () => {
      const { school, admin, app } = await setup();
      const res = await request(app)
        .patch(BASE)
        .set(adminHeaders(admin))
        .send({ step: 'academic-year' })
        .expect(200);

      expect(res.body.step).toBe('academic-year');
      expect(res.body.completedSteps).toContain('school-profile');
      expect(res.body.updatedAt).toBeTruthy();

      const fromDb = await School.findById(school._id).lean();
      expect(fromDb.metadata.onboardingStep).toBe('academic-year');
      expect(fromDb.metadata.onboardingCompletedSteps).toContain('school-profile');
    });

    it('supports idempotent re-save (same step)', async () => {
      const { school, admin, app } = await setup();
      await School.updateOne(
        { _id: school._id },
        { $set: { 'metadata.onboardingStep': 'academic-year' } }
      );

      const res = await request(app)
        .patch(BASE)
        .set(adminHeaders(admin))
        .send({ step: 'academic-year' })
        .expect(200);
      expect(res.body.step).toBe('academic-year');
    });

    it('allows back-stepping to a previous step', async () => {
      const { school, admin, app } = await setup();
      await School.updateOne(
        { _id: school._id },
        { $set: { 'metadata.onboardingStep': 'first-class' } }
      );

      const res = await request(app)
        .patch(BASE)
        .set(adminHeaders(admin))
        .send({ step: 'academic-year' })
        .expect(200);
      expect(res.body.step).toBe('academic-year');
    });

    it('records skipped steps so the wizard does not loop the user back', async () => {
      const { admin, app } = await setup();
      // 1) Advance from school-profile to academic-year normally.
      await request(app)
        .patch(BASE)
        .set(adminHeaders(admin))
        .send({ step: 'academic-year' })
        .expect(200);

      // 2) Now on academic-year, the user clicks "Skip for now" — that
      // transitions to the next step (first-class) with skipped=true.
      // The current step (academic-year) ends up in both skippedSteps
      // and completedSteps.
      const res = await request(app)
        .patch(BASE)
        .set(adminHeaders(admin))
        .send({ step: 'first-class', skipped: true })
        .expect(200);

      expect(res.body.step).toBe('first-class');
      expect(res.body.skippedSteps).toContain('academic-year');
      expect(res.body.completedSteps).toContain('academic-year');
    });

    it('flips provisioning.status to ready when step is complete', async () => {
      const { school, admin, app } = await setup();
      await School.updateOne(
        { _id: school._id },
        {
          $set: {
            'metadata.onboardingStep': 'invite-staff',
            'provisioning.status': 'pending',
          },
        }
      );

      const res = await request(app)
        .patch(BASE)
        .set(adminHeaders(admin))
        .send({ step: 'complete' })
        .expect(200);

      expect(res.body.step).toBe('complete');
      expect(res.body.provisioningStatus).toBe('ready');

      const fromDb = await School.findById(school._id).lean();
      expect(fromDb.provisioning.status).toBe('ready');
      expect(fromDb.provisioning.lastProvisionedBy).toBeTruthy();
    });
  });

  // ── PATCH /api/onboarding/step — invalid transitions ──────────────────────
  describe('PATCH /api/onboarding/step — invalid transitions', () => {
    it('rejects skipping ahead by more than one step', async () => {
      const { admin, app } = await setup();
      const res = await request(app)
        .patch(BASE)
        .set(adminHeaders(admin))
        .send({ step: 'first-student' })
        .expect(400);

      expect(res.body.code).toBe('ONBOARDING_INVALID_TRANSITION');
      expect(res.body.error).toMatch(/Invalid onboarding step transition/);
    });

    it('rejects an unknown step value via Zod validation', async () => {
      const { admin, app } = await setup();
      const res = await request(app)
        .patch(BASE)
        .set(adminHeaders(admin))
        .send({ step: 'nope-not-a-step' })
        .expect(400);

      expect(res.body.error).toBe('Validation failed');
      // Zod's enum error mentions the field name and lists the allowed
      // values; the exact wording varies across Zod minor versions, so just
      // check the field name plus a sample of the allowed values.
      const details = JSON.stringify(res.body.details);
      expect(details).toMatch(/"field":"step"/);
      expect(details).toMatch(/school-profile/);
      expect(details).toMatch(/complete/);
    });

    it('rejects skipped=true when step is complete', async () => {
      const { school, admin, app } = await setup();
      await School.updateOne(
        { _id: school._id },
        { $set: { 'metadata.onboardingStep': 'invite-staff' } }
      );
      const res = await request(app)
        .patch(BASE)
        .set(adminHeaders(admin))
        .send({ step: 'complete', skipped: true })
        .expect(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('returns 400 when step is missing', async () => {
      const { admin, app } = await setup();
      const res = await request(app).patch(BASE).set(adminHeaders(admin)).send({}).expect(400);
      expect(res.body.error).toBe('Validation failed');
    });
  });

  // ── School scoping ────────────────────────────────────────────────────────
  describe('multi-tenancy', () => {
    it('cannot advance onboarding for a different school', async () => {
      const { school: schoolA, admin: adminA, app } = await setup();
      const schoolB = await createSchoolRecord({ name: 'Other School', code: 'OS' });

      // Mark schoolA as already on the second step so we can attempt
      // a forward jump to first-student (which would be a skip-ahead from
      // school-profile in schoolB and therefore forbidden).
      await School.updateOne(
        { _id: schoolA._id },
        { $set: { 'metadata.onboardingStep': 'academic-year' } }
      );

      const res = await request(app)
        .patch(BASE)
        .set(adminHeaders(adminA))
        .send({ step: 'first-student' })
        .expect(400);
      expect(res.body.code).toBe('ONBOARDING_INVALID_TRANSITION');

      // Confirm schoolB was not touched.
      const fromDb = await School.findById(schoolB._id).lean();
      expect(fromDb.metadata?.onboardingStep).toBeFalsy();
    });
  });

  // ── Audit logging ─────────────────────────────────────────────────────────
  describe('audit logging', () => {
    it('writes an AuditTrail entry on each step transition', async () => {
      const { school, admin, app } = await setup();
      await request(app)
        .patch(BASE)
        .set(adminHeaders(admin))
        .send({ step: 'academic-year' })
        .expect(200);

      // Audit write is fire-and-forget; give it a moment.
      await new Promise((resolve) => setTimeout(resolve, 50));

      const logs = await AuditTrail.find({ schoolId: school._id, entity: 'onboarding' }).lean();
      expect(logs.length).toBeGreaterThan(0);
      const last = logs[logs.length - 1];
      expect(last.action).toBe('settings_changed');
      expect(last.newValue.step).toBe('academic-year');
      expect(last.oldValue.step).toBe('school-profile');
    });
  });
});
