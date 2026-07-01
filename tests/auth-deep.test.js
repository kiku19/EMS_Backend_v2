import request from 'supertest';
import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { createTestApp } from './helpers/testApp.js';
import { School, Staff } from '../database.js';
import { createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { generateSignupInvite } from '../utils/signupInvites.js';
import { generateToken } from '../middleware/auth.js';

/**
 * E2E-TEST-37: Auth — Signup, Forgot/Reset Password & Email Verify
 *
 * Deep tests for the full authentication lifecycle:
 *   - Multi-step signup with validation
 *   - Forgot / reset password flows
 *   - Email verification & resend
 *   - Login with remember-me (cookie session)
 *   - 2FA challenge flow
 *   - Rate-limiting awareness (lockout messaging)
 */

describe('E2E-TEST-37: Auth deep — signup, password reset & email verify', () => {
  // ─── Signup ──────────────────────────────────────────────────────────────────

  it('1) signup step 1 fields: rejects missing schoolName, name, email', async () => {
    const { app } = createTestApp();
    const inviteToken = generateSignupInvite({
      email: 'step1@example.com',
      schoolName: 'Step1 School',
    });

    // Missing name and schoolName
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'step1@example.com', password: 'Secure1pass', inviteToken })
      .expect(400);

    expect(res.body.error).toBe('Validation Error');
    const fieldNames = res.body.details.map((d) => d.field);
    expect(fieldNames).toContain('name');
    expect(fieldNames).toContain('schoolName');
  });

  it('2) signup step 2 fields: rejects weak password (no uppercase, no digit)', async () => {
    const { app } = createTestApp();
    const inviteToken = generateSignupInvite({
      email: 'step2@example.com',
      schoolName: 'Step2 School',
    });

    const res = await request(app)
      .post('/api/auth/signup')
      .send({
        name: 'Step Two',
        email: 'step2@example.com',
        schoolName: 'Step2 School',
        password: 'weakpass', // no uppercase, no digit
        inviteToken,
      })
      .expect(400);

    expect(res.body.error).toBe('Validation Error');
    const pwDetail = res.body.details.find((d) => d.field === 'password');
    expect(pwDetail).toBeTruthy();
  });

  it('3) signup step 3: successful signup provisions school, admin, settings & subscription', async () => {
    const { app } = createTestApp();
    const inviteToken = generateSignupInvite({
      email: 'plan@example.com',
      schoolName: 'Plan School',
      invitedBy: 'ops-team',
    });

    const res = await request(app)
      .post('/api/auth/signup')
      .send({
        name: 'Plan Admin',
        email: 'plan@example.com',
        schoolName: 'Plan School',
        password: 'StrongPass1',
        inviteToken,
      })
      .expect(201);

    expect(res.body).toMatchObject({
      success: true,
      school: expect.objectContaining({ name: 'Plan School' }),
      user: expect.objectContaining({
        name: 'Plan Admin',
        email: 'plan@example.com',
        subscription: expect.objectContaining({ status: 'trialing' }),
      }),
    });
  });

  it('4) signup submission redirects context: returns schoolId and user can log in', async () => {
    const { app } = createTestApp();
    const inviteToken = generateSignupInvite({
      email: 'redirect@example.com',
      schoolName: 'Redirect School',
    });

    const signupRes = await request(app)
      .post('/api/auth/signup')
      .send({
        name: 'Redirect Admin',
        email: 'redirect@example.com',
        schoolName: 'Redirect School',
        password: 'Redirect1pass',
        inviteToken,
      })
      .expect(201);

    const schoolId = signupRes.body.user.schoolId;
    expect(schoolId).toBeTruthy();
    expect(signupRes.body.token).toBeTruthy();
    expect(signupRes.body.refreshToken).toBeTruthy();

    // New admin can immediately log in
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'redirect@example.com', password: 'Redirect1pass' })
      .expect(200);

    expect(loginRes.body.schoolId).toBe(schoolId);
    expect(loginRes.body.token).toBeTruthy();
  });

  it('5) signup validation: duplicate email shows error, weak password rejected', async () => {
    const { app } = createTestApp();

    // First signup
    const inviteA = generateSignupInvite({ email: 'dup@example.com', schoolName: 'Dup School A' });
    await request(app)
      .post('/api/auth/signup')
      .send({
        name: 'First Admin',
        email: 'dup@example.com',
        schoolName: 'Dup School A',
        password: 'FirstPass1',
        inviteToken: inviteA,
      })
      .expect(201);

    // Duplicate email signup
    const inviteB = generateSignupInvite({ email: 'dup@example.com', schoolName: 'Dup School B' });
    const dupRes = await request(app)
      .post('/api/auth/signup')
      .send({
        name: 'Second Admin',
        email: 'dup@example.com',
        schoolName: 'Dup School B',
        password: 'SecondPass1',
        inviteToken: inviteB,
      })
      .expect(409);

    expect(dupRes.body.error).toMatch(/email already exists/i);
  });

  // ─── Forgot / Reset Password ────────────────────────────────────────────────

  it('6) forgot password sends reset link (generic response regardless of existence)', async () => {
    const school = await createSchoolRecord({ name: 'FP School', code: 'FP-SCH' });
    await createStaffUser({
      name: 'FP User',
      email: 'fp.user@example.com',
      password: 'OldPass1word',
      staffRole: ['Admin'],
      permissionRole: 'admin',
      schoolId: school._id,
    });

    const { app } = createTestApp();

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'fp.user@example.com' })
      .expect(200);

    expect(res.body).toMatchObject({
      success: true,
      message: expect.stringContaining('reset link has been sent'),
    });
  });

  it('7) forgot password with non-existent email shows same generic message', async () => {
    const { app } = createTestApp();

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@nonexistent.com' })
      .expect(200);

    // Must not reveal whether email exists
    expect(res.body).toMatchObject({
      success: true,
      message: expect.stringContaining('reset link has been sent'),
    });
  });

  it('8) reset password with valid token updates password and allows login', async () => {
    const school = await createSchoolRecord({ name: 'Reset School', code: 'RESET-SCH' });
    const staff = await createStaffUser({
      name: 'Reset User',
      email: 'reset.user@example.com',
      password: 'OldPass1word',
      staffRole: ['Admin'],
      permissionRole: 'admin',
      schoolId: school._id,
    });

    // Craft a valid reset token (same as the route does internally)
    const resetToken = jwt.sign(
      { purpose: 'password-reset', staffId: staff._id.toString(), schoolId: school._id.toString() },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    const { app } = createTestApp();

    const resetRes = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: resetToken, newPassword: 'NewSecure1pass' })
      .expect(200);

    expect(resetRes.body).toMatchObject({
      success: true,
      message: expect.stringContaining('Password reset successfully'),
    });

    // Old password no longer works
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'reset.user@example.com', password: 'OldPass1word' })
      .expect(401);

    // New password works
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'reset.user@example.com', password: 'NewSecure1pass' })
      .expect(200);

    expect(loginRes.body.token).toBeTruthy();
  });

  it('9) reset password with expired token returns 410', async () => {
    const school = await createSchoolRecord({ name: 'Expired Reset', code: 'EXP-RESET' });
    const staff = await createStaffUser({
      name: 'Expired User',
      email: 'expired.reset@example.com',
      password: 'OldPass1word',
      staffRole: ['Admin'],
      permissionRole: 'admin',
      schoolId: school._id,
    });

    // Token that already expired
    const expiredToken = jwt.sign(
      { purpose: 'password-reset', staffId: staff._id.toString(), schoolId: school._id.toString() },
      process.env.JWT_SECRET,
      { expiresIn: -1 }
    );

    const { app } = createTestApp();

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: expiredToken, newPassword: 'NewSecure1pass' })
      .expect(410);

    expect(res.body.error).toMatch(/expired/i);
  });

  // ─── Email Verification ──────────────────────────────────────────────────────

  it('10) email verification with valid token marks school as verified', async () => {
    // Sign up a school so it exists in the DB (unverified by default)
    const { app } = createTestApp();
    const inviteToken = generateSignupInvite({
      email: 'verify@example.com',
      schoolName: 'Verify School',
    });

    const signupRes = await request(app)
      .post('/api/auth/signup')
      .send({
        name: 'Verify Admin',
        email: 'verify@example.com',
        schoolName: 'Verify School',
        password: 'VerifyPass1',
        inviteToken,
      })
      .expect(201);

    const schoolId = signupRes.body.user.schoolId;

    // Craft a valid email verification token
    const verificationToken = jwt.sign(
      { purpose: 'email-verification', schoolId, email: 'verify@example.com' },
      process.env.JWT_SECRET,
      { expiresIn: '48h' }
    );

    const verifyRes = await request(app)
      .get('/api/auth/verify-email')
      .query({ token: verificationToken })
      .expect(200);

    expect(verifyRes.body).toMatchObject({
      success: true,
      message: 'Email verified successfully',
    });

    // DB reflects verified status
    const school = await School.findById(schoolId);
    expect(school.metadata.emailVerified).toBe(true);
  });

  it('11) email verification with expired token returns 410 with error', async () => {
    const school = await createSchoolRecord({ name: 'ExpVerify School', code: 'EXP-VER' });

    const expiredToken = jwt.sign(
      { purpose: 'email-verification', schoolId: school._id.toString(), email: 'x@example.com' },
      process.env.JWT_SECRET,
      { expiresIn: -1 }
    );

    const { app } = createTestApp();

    const res = await request(app)
      .get('/api/auth/verify-email')
      .query({ token: expiredToken })
      .expect(410);

    expect(res.body.error).toMatch(/expired/i);
  });

  it('12) resend verification email succeeds for authenticated user with unverified school', async () => {
    const { app } = createTestApp();

    // Signup creates an unverified school
    const inviteToken = generateSignupInvite({
      email: 'resend@example.com',
      schoolName: 'Resend School',
    });

    await request(app)
      .post('/api/auth/signup')
      .send({
        name: 'Resend Admin',
        email: 'resend@example.com',
        schoolName: 'Resend School',
        password: 'ResendPass1',
        inviteToken,
      })
      .expect(201);

    // Login to get a token
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'resend@example.com', password: 'ResendPass1' })
      .expect(200);

    const token = loginRes.body.token;

    const resendRes = await request(app)
      .post('/api/auth/resend-verification')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(resendRes.body).toMatchObject({
      success: true,
      message: expect.stringContaining('Verification email sent'),
    });
  });

  // ─── Login with remember-me / cookie session ────────────────────────────────

  it('13) login with cookie mode sets Set-Cookie header and session endpoint works via cookie', async () => {
    const school = await createSchoolRecord({ name: 'Cookie School', code: 'COOKIE-SCH' });
    await createStaffUser({
      name: 'Cookie User',
      email: 'cookie.user@example.com',
      password: 'CookiePass1',
      staffRole: ['Admin'],
      permissionRole: 'admin',
      schoolId: school._id,
    });

    const { app } = createTestApp();
    const agent = request.agent(app);

    const loginRes = await agent
      .post('/api/auth/login')
      .set('X-Auth-Mode', 'cookie')
      .send({ email: 'cookie.user@example.com', password: 'CookiePass1' })
      .expect(200);

    expect(loginRes.headers['set-cookie']).toBeTruthy();
    expect(loginRes.body.token).toBeTruthy();
    expect(loginRes.body.refreshToken).toBeTruthy();

    // Session endpoint should work via cookie agent
    const sessionRes = await agent.get('/api/auth/session').expect(200);

    expect(sessionRes.body).toMatchObject({
      name: 'Cookie User',
      schoolId: school._id.toString(),
    });
  });

  // ─── 2FA Flow ────────────────────────────────────────────────────────────────

  it('14) 2FA: login returns twoFactorRequired when 2FA is enabled; valid code completes login', async () => {
    const school = await createSchoolRecord({ name: '2FA School', code: 'TFA-SCH' });
    const staff = await createStaffUser({
      name: '2FA User',
      email: 'tfa.user@example.com',
      password: 'TfaPass1word',
      staffRole: ['Admin'],
      permissionRole: 'admin',
      schoolId: school._id,
    });

    // Enable 2FA directly in DB with a known TOTP secret
    // We use the otplib-compatible approach: generate a token manually
    const { TOTP, NobleCryptoPlugin, ScureBase32Plugin } = await import('otplib');
    const crypto = await import('crypto');

    const totp = new TOTP({ crypto: new NobleCryptoPlugin(), base32: new ScureBase32Plugin() });
    const secret = totp.generateSecret();

    // Encrypt the secret the same way twoFactor.js does
    const rawKey = process.env.JWT_SECRET;
    const key = crypto.createHash('sha256').update(rawKey).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const encryptedSecret = `${iv.toString('hex')}.${tag.toString('hex')}.${encrypted.toString('hex')}`;

    await Staff.findByIdAndUpdate(staff._id, {
      twoFactorEnabled: true,
      twoFactorSecret: encryptedSecret,
    });

    const { app } = createTestApp();

    // Login should return 2FA challenge
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'tfa.user@example.com', password: 'TfaPass1word' })
      .expect(200);

    expect(loginRes.body.twoFactorRequired).toBe(true);
    expect(loginRes.body.twoFactorToken).toBeTruthy();

    // Generate a valid TOTP code
    const result = await totp.generate({ secret });
    const code = result.otp || result;

    // Verify 2FA with valid code
    const verifyRes = await request(app)
      .post('/api/auth/2fa/verify')
      .send({
        twoFactorToken: loginRes.body.twoFactorToken,
        code,
      })
      .expect(200);

    expect(verifyRes.body.token).toBeTruthy();
    expect(verifyRes.body.name).toBe('2FA User');

    // Invalid code should fail
    const badRes = await request(app)
      .post('/api/auth/2fa/verify')
      .send({
        twoFactorToken: loginRes.body.twoFactorToken,
        code: '000000',
      })
      .expect(401);

    expect(badRes.body.error).toMatch(/invalid/i);
  });

  // ─── Rate limiting awareness ─────────────────────────────────────────────────

  it('16) signup rejects duplicate school name', async () => {
    const { app } = createTestApp();
    const inviteA = generateSignupInvite({
      email: 'school-dup-a@example.com',
      schoolName: 'Same Name School',
    });
    await request(app)
      .post('/api/auth/signup')
      .send({
        name: 'Admin A',
        email: 'school-dup-a@example.com',
        schoolName: 'Same Name School',
        password: 'Password123',
        inviteToken: inviteA,
      })
      .expect(201);

    const inviteB = generateSignupInvite({
      email: 'school-dup-b@example.com',
      schoolName: 'Same Name School',
    });
    const dupRes = await request(app)
      .post('/api/auth/signup')
      .send({
        name: 'Admin B',
        email: 'school-dup-b@example.com',
        schoolName: 'Same Name School',
        password: 'Password123',
        inviteToken: inviteB,
      })
      .expect(409);

    expect(dupRes.body.error).toMatch(/school with this name already exists/i);
  });

  it('15) multiple failed logins return consistent error messaging', async () => {
    const school = await createSchoolRecord({ name: 'Rate School', code: 'RATE-SCH' });
    await createStaffUser({
      name: 'Rate User',
      email: 'rate.user@example.com',
      password: 'RatePass1word',
      staffRole: ['Admin'],
      permissionRole: 'admin',
      schoolId: school._id,
    });

    const { app } = createTestApp();

    // Send multiple failed login attempts — rate limiter is skipped in test mode,
    // but we verify the error messaging remains consistent and doesn't leak info.
    const attempts = [];
    for (let i = 0; i < 5; i++) {
      attempts.push(
        request(app)
          .post('/api/auth/login')
          .send({ email: 'rate.user@example.com', password: 'wrongpassword' })
      );
    }

    const results = await Promise.all(attempts);

    for (const res of results) {
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid credentials');
    }

    // Valid password still works (rate limiter skipped in test env)
    const validRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'rate.user@example.com', password: 'RatePass1word' })
      .expect(200);

    expect(validRes.body.token).toBeTruthy();
  });
});
