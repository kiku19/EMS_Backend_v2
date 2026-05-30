import request from 'supertest';
import { describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import { Staff } from '../database.js';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';
import { issueTwoFactorToken } from '../routes/twoFactor.js';

const BASE = '/api/auth/2fa';

describe('twoFactor routes', () => {
  async function setup() {
    const school = await createSchoolRecord({ name: '2FA School', code: 'TFA' });
    const admin = await createStaffUser({
      name: '2FA Admin',
      email: '2fa.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
      password: 'Password123',
    });
    const { app } = createTestApp();
    const headers = authHeadersFor(admin, 'admin');
    return { school, admin, app, headers };
  }

  // ── POST /auth/2fa/verify (no auth) ──────────────────────────────────────
  describe('POST /auth/2fa/verify', () => {
    it('returns 401 for invalid twoFactorToken', async () => {
      const { app } = createTestApp();
      const res = await request(app)
        .post(`${BASE}/verify`)
        .send({ twoFactorToken: 'invalid.token.here', code: '123456' })
        .expect(401);
      expect(res.body.error).toMatch(/invalid or expired/i);
    });

    it('returns 401 when staff does not have 2FA enabled', async () => {
      const { admin, app } = await setup();
      const token = issueTwoFactorToken(admin._id, admin.schoolId);
      const res = await request(app)
        .post(`${BASE}/verify`)
        .send({ twoFactorToken: token, code: '123456' })
        .expect(401);
      expect(res.body.error).toMatch(/invalid 2FA session/i);
    });

    it('returns 401 for invalid backup code', async () => {
      const { admin, app } = await setup();
      await Staff.findByIdAndUpdate(admin._id, {
        twoFactorEnabled: true,
        twoFactorSecret: 'test-secret-encrypted',
        twoFactorBackupCodes: [await bcrypt.hash('ABCDEF12', 10)],
      });
      const token = issueTwoFactorToken(admin._id, admin.schoolId);
      const res = await request(app)
        .post(`${BASE}/verify`)
        .send({ twoFactorToken: token, backupCode: 'WRONGCODE' })
        .expect(401);
      expect(res.body.error).toMatch(/invalid verification code/i);
    });
  });

  // ── GET /auth/2fa/setup ──────────────────────────────────────────────────
  describe('GET /auth/2fa/setup', () => {
    it('returns 401 without token', async () => {
      const { app } = createTestApp();
      await request(app).get(`${BASE}/setup`).expect(401);
    });

    it('generates a QR code and secret for the authenticated staff', async () => {
      const { admin, app, headers } = await setup();
      const res = await request(app).get(`${BASE}/setup`).set(headers).expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.qrCode).toMatch(/^data:image/);
      expect(res.body.secret).toBeTruthy();
      expect(res.body.otpauthUrl).toBeTruthy();

      const staff = await Staff.findById(admin._id).select('+twoFactorSecret');
      expect(staff.twoFactorSecret).toBeTruthy();
    });
  });

  // ── POST /auth/2fa/confirm ───────────────────────────────────────────────
  describe('POST /auth/2fa/confirm', () => {
    it('returns 401 without token', async () => {
      const { app } = createTestApp();
      await request(app).post(`${BASE}/confirm`).send({ code: '123456' }).expect(401);
    });

    it('returns 400 if setup was not run first', async () => {
      const { app, headers } = await setup();
      const res = await request(app)
        .post(`${BASE}/confirm`)
        .set(headers)
        .send({ code: '123456' })
        .expect(400);
      expect(res.body.error).toMatch(/run 2FA setup first/i);
    });

    it('returns 400 for invalid confirmation code', async () => {
      const { app, headers } = await setup();
      // Run setup to populate secret
      await request(app).get(`${BASE}/setup`).set(headers).expect(200);

      const res = await request(app)
        .post(`${BASE}/confirm`)
        .set(headers)
        .send({ code: '000000' })
        .expect(400);
      expect(res.body.error).toMatch(/invalid verification code/i);
    });
  });

  // ── POST /auth/2fa/disable ───────────────────────────────────────────────
  describe('POST /auth/2fa/disable', () => {
    it('returns 401 without token', async () => {
      const { app } = createTestApp();
      await request(app).post(`${BASE}/disable`).send({ password: 'Password123' }).expect(401);
    });

    it('returns 401 with wrong password', async () => {
      const { app, headers } = await setup();
      const res = await request(app)
        .post(`${BASE}/disable`)
        .set(headers)
        .send({ password: 'wrongpassword' })
        .expect(401);
      expect(res.body.error).toMatch(/incorrect password/i);
    });

    it('disables 2FA with correct password', async () => {
      const { admin, app, headers } = await setup();
      await Staff.findByIdAndUpdate(admin._id, {
        twoFactorEnabled: true,
        twoFactorSecret: 'encrypted-secret',
        twoFactorEnrolledAt: new Date(),
        twoFactorBackupCodes: ['hashedcode'],
      });

      const res = await request(app)
        .post(`${BASE}/disable`)
        .set(headers)
        .send({ password: 'Password123' })
        .expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/disabled/i);

      const staff = await Staff.findById(admin._id).select('+twoFactorSecret');
      expect(staff.twoFactorEnabled).toBe(false);
      expect(staff.twoFactorSecret).toBeNull();
    });
  });

  // ── GET /auth/2fa/status ─────────────────────────────────────────────────
  describe('GET /auth/2fa/status', () => {
    it('returns 401 without token', async () => {
      const { app } = createTestApp();
      await request(app).get(`${BASE}/status`).expect(401);
    });

    it('returns false when 2FA is not enabled', async () => {
      const { app, headers } = await setup();
      const res = await request(app).get(`${BASE}/status`).set(headers).expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.twoFactorEnabled).toBe(false);
      expect(res.body.enrolledAt).toBeNull();
    });

    it('returns true when 2FA is enabled', async () => {
      const { admin, app, headers } = await setup();
      await Staff.findByIdAndUpdate(admin._id, {
        twoFactorEnabled: true,
        twoFactorEnrolledAt: new Date('2025-01-01'),
      });
      const res = await request(app).get(`${BASE}/status`).set(headers).expect(200);
      expect(res.body.twoFactorEnabled).toBe(true);
      expect(res.body.enrolledAt).toBeTruthy();
    });
  });

  // ── POST /auth/2fa/regenerate-backup-codes ───────────────────────────────
  describe('POST /auth/2fa/regenerate-backup-codes', () => {
    it('returns 401 without token', async () => {
      const { app } = createTestApp();
      await request(app).post(`${BASE}/regenerate-backup-codes`).expect(401);
    });

    it('returns 400 when 2FA is not enabled', async () => {
      const { app, headers } = await setup();
      const res = await request(app)
        .post(`${BASE}/regenerate-backup-codes`)
        .set(headers)
        .expect(400);
      expect(res.body.error).toMatch(/2FA is not enabled/i);
    });

    it('regenerates backup codes when 2FA is enabled', async () => {
      const { admin, app, headers } = await setup();
      await Staff.findByIdAndUpdate(admin._id, {
        twoFactorEnabled: true,
        twoFactorBackupCodes: [await bcrypt.hash('OLDCODE', 10)],
      });
      const res = await request(app)
        .post(`${BASE}/regenerate-backup-codes`)
        .set(headers)
        .expect(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.backupCodes)).toBe(true);
      expect(res.body.backupCodes.length).toBeGreaterThan(0);
    });
  });
});
