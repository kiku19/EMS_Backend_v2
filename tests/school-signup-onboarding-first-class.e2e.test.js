import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { School, SchoolSettings, Staff } from '../database.js';
import { createTestApp } from './helpers/testApp.js';
import { generateSignupInvite } from '../utils/signupInvites.js';

/**
 * E2E-01: School signup → onboarding → first class created
 *
 * Covers the complete new-school lifecycle:
 *   1. Admin signs up via invite token (school + admin account provisioned)
 *   2. Admin logs in and receives a Bearer token
 *   3. Onboarding status reflects no classes yet
 *   4. Admin creates the first class
 *   5. Class appears in the class list scoped to that school
 *   6. Onboarding status reflects the class step as complete
 */
describe('E2E-01: school signup → onboarding → first class created', () => {
  it('completes the full new-school journey from signup to first class', async () => {
    const { app } = createTestApp();

    // ── Step 1: Generate an invite and sign up ──────────────────────────────
    const inviteToken = generateSignupInvite({
      email: 'riya.principal@greenvalley.com',
      schoolName: 'Green Valley Academy',
      invitedBy: 'ops-team',
    });

    const signupRes = await request(app)
      .post('/api/auth/signup')
      .send({
        name: 'Riya Mehta',
        email: 'riya.principal@greenvalley.com',
        schoolName: 'Green Valley Academy',
        password: 'SecurePass@123',
        inviteToken,
      })
      .expect(201);

    expect(signupRes.body).toMatchObject({
      success: true,
      school: expect.objectContaining({
        name: 'Green Valley Academy',
        code: 'GREEN-VALLEY-ACADEMY',
      }),
      user: expect.objectContaining({
        name: 'Riya Mehta',
        email: 'riya.principal@greenvalley.com',
        schoolId: expect.any(String),
        subscription: expect.objectContaining({ status: 'trialing' }),
      }),
    });

    const schoolId = signupRes.body.user.schoolId;

    // Verify school and admin were persisted with correct schoolId
    const school = await School.findById(schoolId);
    const admin = await Staff.findOne({ email: 'riya.principal@greenvalley.com' });
    const settings = await SchoolSettings.findOne({ schoolId: school._id });

    expect(school).toBeTruthy();
    expect(admin).toBeTruthy();
    expect(admin.schoolId.toString()).toBe(schoolId);
    expect(admin.role).toEqual(['Admin']);
    expect(settings).toBeTruthy();
    expect(settings.schoolId.toString()).toBe(schoolId);

    // ── Step 2: Log in as the new school admin ──────────────────────────────
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'riya.principal@greenvalley.com',
        password: 'SecurePass@123',
      })
      .expect(200);

    expect(loginRes.body).toMatchObject({
      name: 'Riya Mehta',
      schoolId,
      token: expect.any(String),
    });

    const token = loginRes.body.token;
    const authHeaders = { Authorization: `Bearer ${token}` };

    // ── Step 3: Onboarding status — classes not yet created ────────────────
    const onboardingBeforeRes = await request(app)
      .get('/api/settings/onboarding-status')
      .set(authHeaders)
      .expect(200);

    expect(onboardingBeforeRes.body.progress.classes).toBe(false);
    expect(onboardingBeforeRes.body.completedCount).toBeLessThan(
      onboardingBeforeRes.body.totalSteps
    );

    // ── Step 4: Create the first class ─────────────────────────────────────
    const createClassRes = await request(app)
      .post('/api/classes')
      .set(authHeaders)
      .send({
        name: 'Class 1',
        section: 'A',
        subjects: ['English', 'Math', 'EVS'],
        academicYear: '2025-26',
      })
      .expect(201);

    expect(createClassRes.body).toMatchObject({
      name: 'Class 1',
      section: 'A',
      subjects: expect.arrayContaining(['English', 'Math', 'EVS']),
      academicYear: '2025-26',
    });
    expect(createClassRes.body.id).toBeTruthy();

    // ── Step 5: Class list is scoped to this school ─────────────────────────
    const classListRes = await request(app).get('/api/classes').set(authHeaders).expect(200);

    const classIds = classListRes.body.map((c) => c.id || c._id?.toString());
    expect(classIds).toContain(createClassRes.body.id);
    expect(classListRes.body.length).toBe(1);

    // ── Step 6: Onboarding status — classes step now complete ───────────────
    const onboardingAfterRes = await request(app)
      .get('/api/settings/onboarding-status')
      .set(authHeaders)
      .expect(200);

    expect(onboardingAfterRes.body.progress.classes).toBe(true);
    expect(onboardingAfterRes.body.completedCount).toBeGreaterThan(
      onboardingBeforeRes.body.completedCount
    );
  });

  it('onboarding status classes step stays false when no class exists after signup', async () => {
    const { app } = createTestApp();

    const inviteToken = generateSignupInvite({
      email: 'arjun.principal@sunriseschool.com',
      schoolName: 'Sunrise School',
      invitedBy: 'ops-team',
    });

    const signupRes = await request(app)
      .post('/api/auth/signup')
      .send({
        name: 'Arjun Nair',
        email: 'arjun.principal@sunriseschool.com',
        schoolName: 'Sunrise School',
        password: 'SecurePass@456',
        inviteToken,
      })
      .expect(201);

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'arjun.principal@sunriseschool.com',
        password: 'SecurePass@456',
      })
      .expect(200);

    const authHeaders = { Authorization: `Bearer ${loginRes.body.token}` };

    const onboardingRes = await request(app)
      .get('/api/settings/onboarding-status')
      .set(authHeaders)
      .expect(200);

    expect(onboardingRes.body.progress.classes).toBe(false);
    expect(onboardingRes.body.totalSteps).toBe(7);
  });

  it('class created by School A is not visible to School B after signup', async () => {
    const { app } = createTestApp();

    // Sign up School A
    const inviteA = generateSignupInvite({
      email: 'admin.a@schoola.com',
      schoolName: 'School Alpha',
      invitedBy: 'ops-team',
    });
    await request(app)
      .post('/api/auth/signup')
      .send({
        name: 'Admin Alpha',
        email: 'admin.a@schoola.com',
        schoolName: 'School Alpha',
        password: 'PasswordA@1',
        inviteToken: inviteA,
      })
      .expect(201);

    // Sign up School B
    const inviteB = generateSignupInvite({
      email: 'admin.b@schoolb.com',
      schoolName: 'School Beta',
      invitedBy: 'ops-team',
    });
    await request(app)
      .post('/api/auth/signup')
      .send({
        name: 'Admin Beta',
        email: 'admin.b@schoolb.com',
        schoolName: 'School Beta',
        password: 'PasswordB@2',
        inviteToken: inviteB,
      })
      .expect(201);

    // Log in as School A admin and create a class
    const loginA = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin.a@schoola.com', password: 'PasswordA@1' })
      .expect(200);

    const headersA = { Authorization: `Bearer ${loginA.body.token}` };

    await request(app)
      .post('/api/classes')
      .set(headersA)
      .send({ name: 'Class 5', section: 'B', subjects: ['Math'], academicYear: '2025-26' })
      .expect(201);

    // Log in as School B admin — their class list must be empty
    const loginB = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin.b@schoolb.com', password: 'PasswordB@2' })
      .expect(200);

    const headersB = { Authorization: `Bearer ${loginB.body.token}` };

    const classListB = await request(app).get('/api/classes').set(headersB).expect(200);

    expect(classListB.body.length).toBe(0);
  });
});
