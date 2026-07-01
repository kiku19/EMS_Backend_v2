import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/smsService.js', () => ({
  sendOTPSMS: vi.fn(async () => ({ success: true })),
  isSmsConfigured: vi.fn(() => true),
}));

vi.mock('../utils/otp.js', async () => {
  const actual = await vi.importActual('../utils/otp.js');
  return {
    ...actual,
    generateOTP: vi.fn(() => '123456'),
  };
});

import parentAuthRoutes, {
  parentOtpRequestLimiter,
  parentOtpVerificationLimiter,
} from '../routes/parentAuth.js';
import { OtpAttempt, Parent, School } from '../database.js';
import { hashOTP } from '../utils/otp.js';

function createParentAuthTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/parent/auth', parentAuthRoutes);
  return app;
}

async function resetRateLimiters() {
  // supertest requests from 127.0.0.1
  await parentOtpRequestLimiter.resetKey('::ffff:127.0.0.1');
  await parentOtpRequestLimiter.resetKey('127.0.0.1');
  await parentOtpVerificationLimiter.resetKey('::ffff:127.0.0.1');
  await parentOtpVerificationLimiter.resetKey('127.0.0.1');
}

describe('parent auth routes', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetRateLimiters();
  });

  describe('send-otp', () => {
    it('returns 503 when no OTP provider is configured', async () => {
      const { isSmsConfigured } = await import('../services/smsService.js');
      isSmsConfigured.mockReturnValueOnce(false);

      const app = createParentAuthTestApp();

      const response = await request(app)
        .post('/api/parent/auth/send-otp')
        .send({
          phone: '9876543210',
        })
        .expect(503);

      expect(response.body).toMatchObject({
        success: false,
        error: {
          code: 'OTP_PROVIDER_NOT_CONFIGURED',
        },
      });
    });

    it('returns 200 and stores an OTP attempt when SMS fallback is active', async () => {
      const school = await School.create({ name: 'Test School', code: 'TS001' });
      await Parent.create({
        schoolId: school._id,
        phone: '9876543210',
        name: 'Test Parent',
        status: 'active',
      });

      const app = createParentAuthTestApp();

      const response = await request(app)
        .post('/api/parent/auth/send-otp')
        .send({
          phone: '9876543210',
        })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'If this phone number is registered, an OTP has been sent.',
      });

      const attempt = await OtpAttempt.findOne({ phone: '9876543210' });
      expect(attempt).toBeTruthy();
      expect(attempt.used).toBe(false);
      expect(attempt.attempts).toBe(0);
    });

    it('does not leak whether a phone number is registered', async () => {
      const app = createParentAuthTestApp();

      const response = await request(app)
        .post('/api/parent/auth/send-otp')
        .send({
          phone: '0000000000',
        })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'If this phone number is registered, an OTP has been sent.',
      });

      const attempt = await OtpAttempt.findOne({ phone: '0000000000' });
      expect(attempt).toBeFalsy();
    });
  });

  describe('verify-otp', () => {
    it('returns 503 when no OTP provider is configured', async () => {
      const { isSmsConfigured } = await import('../services/smsService.js');
      isSmsConfigured.mockReturnValueOnce(false);

      const app = createParentAuthTestApp();

      const response = await request(app)
        .post('/api/parent/auth/verify-otp')
        .send({
          phone: '9876543210',
          firebaseIdToken: 'dummy-token',
        })
        .expect(503);

      expect(response.body).toMatchObject({
        success: false,
        error: {
          code: 'OTP_PROVIDER_NOT_CONFIGURED',
        },
      });
    });

    it('returns 503 for Firebase token when Firebase is not configured', async () => {
      const app = createParentAuthTestApp();

      const response = await request(app)
        .post('/api/parent/auth/verify-otp')
        .send({
          phone: '9876543210',
          firebaseIdToken: 'dummy-token',
        })
        .expect(503);

      expect(response.body).toMatchObject({
        success: false,
        error: {
          code: 'OTP_PROVIDER_NOT_CONFIGURED',
        },
      });
    });

    it('verifies a server-generated SMS OTP and returns tokens', async () => {
      const school = await School.create({
        name: 'Test School',
        code: 'TS001',
      });

      const parent = await Parent.create({
        schoolId: school._id,
        phone: '9876543210',
        name: 'Test Parent',
        status: 'active',
      });

      await OtpAttempt.create({
        phone: '9876543210',
        otpHash: hashOTP('123456'),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        attempts: 0,
        used: false,
      });

      const app = createParentAuthTestApp();

      const response = await request(app)
        .post('/api/parent/auth/verify-otp')
        .send({
          phone: '9876543210',
          otp: '123456',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.accessToken).toBeDefined();
      expect(response.body.data.refreshToken).toBeDefined();
      expect(response.body.data.parent.phone).toBe(parent.phone);

      const attempt = await OtpAttempt.findOne({ phone: '9876543210' });
      expect(attempt.used).toBe(true);
    });

    it('returns 401 for an invalid SMS OTP', async () => {
      await OtpAttempt.create({
        phone: '9876543210',
        otpHash: hashOTP('123456'),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        attempts: 0,
        used: false,
      });

      const app = createParentAuthTestApp();

      const response = await request(app)
        .post('/api/parent/auth/verify-otp')
        .send({
          phone: '9876543210',
          otp: '000000',
        })
        .expect(401);

      expect(response.body.error.code).toBe('INVALID_OTP');

      const attempt = await OtpAttempt.findOne({ phone: '9876543210' });
      expect(attempt.attempts).toBe(1);
    });

    it('returns 401 for an expired SMS OTP', async () => {
      await OtpAttempt.create({
        phone: '9876543210',
        otpHash: hashOTP('123456'),
        expiresAt: new Date(Date.now() - 1000),
        attempts: 0,
        used: false,
      });

      const app = createParentAuthTestApp();

      const response = await request(app)
        .post('/api/parent/auth/verify-otp')
        .send({
          phone: '9876543210',
          otp: '123456',
        })
        .expect(401);

      expect(response.body.error.code).toBe('OTP_EXPIRED');
    });

    it('returns 429 after exceeding max OTP attempts', async () => {
      await OtpAttempt.create({
        phone: '9876543210',
        otpHash: hashOTP('123456'),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        attempts: 3,
        used: false,
      });

      const app = createParentAuthTestApp();

      const response = await request(app)
        .post('/api/parent/auth/verify-otp')
        .send({
          phone: '9876543210',
          otp: '123456',
        })
        .expect(429);

      expect(response.body.error.code).toBe('TOO_MANY_ATTEMPTS');
    });
  });
});
