import request from 'supertest';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { createTestApp } from './helpers/testApp.js';
import { School, Staff } from '../database.js';
import AuditTrail from '../models/AuditTrail.js';
import { zodSchemas } from '../middleware/validation/validation.js';
import * as emailService from '../services/emailService.js';

const ENABLE_FLAG = 'ENABLE_SELF_SIGNUP';

// JWT_SECRET is randomised per test process by tests/setup.js, so read it
// dynamically inside beforeEach. Fall back to a 64-char placeholder only when
// the env has not been initialised (e.g. when this file is run in isolation
// without the global setup).
function getJwtSecret() {
  return process.env.JWT_SECRET || 'x'.repeat(64);
}

function issueVerificationToken({ schoolId, email, expiresIn = '24h', secret }) {
  return jwt.sign({ purpose: 'email-verification', schoolId, email }, secret || getJwtSecret(), {
    expiresIn,
  });
}

async function makeSchoolAndAdmin({ verified = false, email = 'admin@example.com' } = {}) {
  const school = await School.create({
    name: 'Test Academy',
    code: `TEST${Date.now()}${Math.floor(Math.random() * 1000)}`,
    contactEmail: email,
    plan: 'starter',
    planStatus: 'trialing',
    trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    provisioning: { status: 'pending' },
    enabledModules: [],
    isDefault: false,
  });

  const staff = new Staff({
    schoolId: school._id,
    code: `STAFF${Date.now()}${Math.floor(Math.random() * 1000)}`,
    name: 'Test Admin',
    email,
    role: 'Administrator',
    userType: 'staff',
    status: 'active',
    password: '$2b$10$abcdefghijklmnopqrstuvwxyzABCDEF0123456789012345678901234',
    emailVerified: verified,
    emailVerifiedAt: verified ? new Date() : undefined,
  });
  await staff.save();
  return { school, staff };
}

let originalFlag;
let originalNodeEnv;
let emailSpy;

beforeEach(() => {
  originalFlag = process.env[ENABLE_FLAG];
  process.env[ENABLE_FLAG] = 'true';
  originalNodeEnv = process.env.NODE_ENV;
  // Stay outside production so the limiter is permissive for the rate-limit
  // test that explicitly flips NODE_ENV=production mid-test.
  process.env.NODE_ENV = 'test';

  emailSpy = vi.spyOn(emailService, 'sendSchoolWelcomeEmail').mockResolvedValue({
    messageId: 'test',
    accepted: ['admin@example.com'],
  });
});

afterEach(async () => {
  if (originalFlag === undefined) {
    delete process.env[ENABLE_FLAG];
  } else {
    process.env[ENABLE_FLAG] = originalFlag;
  }
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
  vi.restoreAllMocks();
  await School.deleteMany({ name: /Test Academy/ });
  await Staff.deleteMany({ email: /@example\.com$/ });
  // AuditTrail is append-only — bypass the model and clear the raw collection.
  try {
    await mongoose.connection.collection('audittrails').deleteMany({
      entity: 'auth',
      action: 'email.verified',
    });
  } catch {
    // If the collection doesn't exist yet, nothing to clean.
  }
});

describe('POST /api/auth/verify-email', () => {
  it('returns 404 when ENABLE_SELF_SIGNUP is off', async () => {
    process.env[ENABLE_FLAG] = 'false';
    const { app } = createTestApp();
    const { school } = await makeSchoolAndAdmin();

    const token = issueVerificationToken({
      schoolId: school._id.toString(),
      email: 'admin@example.com',
    });

    const res = await request(app).post('/api/auth/verify-email').send({ token });
    expect(res.status).toBe(404);
  });

  it('rejects a missing token with 400', async () => {
    const { app } = createTestApp();
    const res = await request(app).post('/api/auth/verify-email').send({});
    expect(res.status).toBe(400);
  });

  it('verifies a fresh token: sets Staff.emailVerified, mirrors to school metadata, writes audit, returns user', async () => {
    const { app } = createTestApp();
    const { school, staff } = await makeSchoolAndAdmin();

    const token = issueVerificationToken({
      schoolId: school._id.toString(),
      email: 'admin@example.com',
    });

    const res = await request(app).post('/api/auth/verify-email').send({ token });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      user: expect.objectContaining({
        email: 'admin@example.com',
        emailVerified: true,
      }),
    });
    expect(res.body.user.emailVerifiedAt).toBeTruthy();

    const reloadedStaff = await Staff.findById(staff._id);
    expect(reloadedStaff.emailVerified).toBe(true);
    expect(reloadedStaff.emailVerifiedAt).toBeTruthy();

    const reloadedSchool = await School.findById(school._id);
    expect(reloadedSchool.metadata?.emailVerified).toBe(true);
    expect(reloadedSchool.metadata?.emailVerifiedAt).toBeTruthy();

    // Audit trail write is fire-and-forget; wait for the chained promise to
    // flush before asserting.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const audit = await AuditTrail.findOne({
      entity: 'auth',
      action: 'email.verified',
      entityId: staff._id.toString(),
    });
    expect(audit).toBeTruthy();
    expect(audit.schoolId.toString()).toBe(school._id.toString());
  });

  it('returns 410 for an expired token and leaves staff unverified', async () => {
    const { app } = createTestApp();
    const { school, staff } = await makeSchoolAndAdmin();

    const expiredToken = issueVerificationToken({
      schoolId: school._id.toString(),
      email: 'admin@example.com',
      expiresIn: '-1s',
    });

    const res = await request(app).post('/api/auth/verify-email').send({ token: expiredToken });
    expect(res.status).toBe(410);

    const reloaded = await Staff.findById(staff._id);
    expect(reloaded.emailVerified).toBe(false);
  });

  it('returns 400 for a tampered token', async () => {
    const { app } = createTestApp();
    const { school } = await makeSchoolAndAdmin();

    const token = issueVerificationToken({
      schoolId: school._id.toString(),
      email: 'admin@example.com',
    });
    const tampered = `${token.slice(0, -4)}AAAA`;

    const res = await request(app).post('/api/auth/verify-email').send({ token: tampered });
    expect(res.status).toBe(400);
  });

  it('returns alreadyVerified=true and does NOT overwrite timestamp when staff is already verified', async () => {
    const { app } = createTestApp();
    const { school, staff } = await makeSchoolAndAdmin({ verified: true });
    const originalTimestamp = staff.emailVerifiedAt;

    const token = issueVerificationToken({
      schoolId: school._id.toString(),
      email: 'admin@example.com',
    });

    const res = await request(app).post('/api/auth/verify-email').send({ token });
    expect(res.status).toBe(200);
    expect(res.body.alreadyVerified).toBe(true);

    const reloaded = await Staff.findById(staff._id);
    expect(reloaded.emailVerifiedAt?.getTime()).toBe(originalTimestamp?.getTime());
  });

  it('returns 400 for a token signed with the wrong secret', async () => {
    const { app } = createTestApp();
    const { school } = await makeSchoolAndAdmin();

    const wrong = jwt.sign(
      {
        purpose: 'email-verification',
        schoolId: school._id.toString(),
        email: 'admin@example.com',
      },
      'a'.repeat(64),
      { expiresIn: '1h' }
    );

    const res = await request(app).post('/api/auth/verify-email').send({ token: wrong });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/resend-verification', () => {
  it('returns 404 when ENABLE_SELF_SIGNUP is off', async () => {
    process.env[ENABLE_FLAG] = 'false';
    const { app } = createTestApp();

    const res = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: 'admin@example.com' });
    expect(res.status).toBe(404);
  });

  it('rejects missing email with 400', async () => {
    const { app } = createTestApp();
    const res = await request(app).post('/api/auth/resend-verification').send({});
    expect(res.status).toBe(400);
  });

  it('rejects invalid email with 400', async () => {
    const { app } = createTestApp();
    const res = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  it('is idempotent: returns 200 with alreadyVerified=true without sending an email when already verified', async () => {
    const { app } = createTestApp();
    await makeSchoolAndAdmin({ verified: true });

    const res = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: 'admin@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.alreadyVerified).toBe(true);
    expect(emailSpy).not.toHaveBeenCalled();
  });

  it('sends a fresh email on the happy path', async () => {
    const { app } = createTestApp();
    const { school } = await makeSchoolAndAdmin();

    const res = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: 'admin@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.alreadyVerified).toBeUndefined();
    // Fire-and-forget: give the microtask queue a chance to flush the .catch.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(emailSpy).toHaveBeenCalledTimes(1);
    const [adminArg, schoolArg, token] = emailSpy.mock.calls[0];
    expect(adminArg.email).toBe('admin@example.com');
    expect(schoolArg.code).toBe(school.code);
    expect(schoolArg.name).toBe(school.name);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(20);
  });

  it('leaks no information: unknown email returns the same generic 200', async () => {
    const { app } = createTestApp();
    const res = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: 'nobody@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.alreadyVerified).toBeUndefined();
    expect(emailSpy).not.toHaveBeenCalled();
  });

  it('rate-limits beyond 3 attempts per email per hour in production', async () => {
    process.env.NODE_ENV = 'production';
    const { app } = createTestApp();
    await makeSchoolAndAdmin();

    for (let i = 0; i < 3; i += 1) {
      const ok = await request(app)
        .post('/api/auth/resend-verification')
        .send({ email: 'admin@example.com' });
      expect(ok.status).toBe(200);
    }
    const blocked = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: 'admin@example.com' });
    expect(blocked.status).toBe(429);
  });
});

describe('verifyEmail Zod schema', () => {
  it('rejects empty token strings', () => {
    const result = zodSchemas.verifyEmail.safeParse({ token: '   ' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown fields (strict)', () => {
    const result = zodSchemas.verifyEmail.safeParse({ token: 'abc', extra: 'nope' });
    expect(result.success).toBe(false);
  });

  it('accepts a valid token', () => {
    const result = zodSchemas.verifyEmail.safeParse({ token: 'abc.def.ghi' });
    expect(result.success).toBe(true);
  });
});

describe('resendVerification Zod schema', () => {
  it('lowercases and trims email', () => {
    const result = zodSchemas.resendVerification.safeParse({ email: '  Admin@Example.COM ' });
    expect(result.success).toBe(true);
    expect(result.data.email).toBe('admin@example.com');
  });

  it('rejects non-email strings', () => {
    const result = zodSchemas.resendVerification.safeParse({ email: 'foo' });
    expect(result.success).toBe(false);
  });
});
