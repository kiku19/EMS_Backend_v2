import request from 'supertest';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

// Mock email + SMS senders so tests don't hit real providers.
vi.mock('../config/email.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true, messageId: 'test-message-id' }),
  verifyEmailConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../config/sms.js', () => ({
  sendSMS: vi.fn().mockResolvedValue({ success: true, messageId: 'test-sms-id' }),
}));

import { sendEmail } from '../config/email.js';
import { sendSMS } from '../config/sms.js';

describe('POST /api/settings/communication/test-email', () => {
  beforeEach(() => {
    sendEmail.mockReset();
    sendSMS.mockReset();
  });

  it('returns 401 without auth', async () => {
    const { app } = createTestApp();
    await request(app)
      .post('/api/settings/communication/test-email')
      .send({ to: 'someone@example.com' })
      .expect(401);
  });

  it('returns 400 on invalid email', async () => {
    const school = await createSchoolRecord({ name: 'Comm School', code: 'COMM' });
    const admin = await createStaffUser({
      name: 'Comm Admin',
      email: 'comm.admin@example.com',
      schoolId: school._id,
      permissionRole: 'admin',
    });
    const { app } = createTestApp();

    const res = await request(app)
      .post('/api/settings/communication/test-email')
      .set(authHeadersFor(admin, 'admin'))
      .send({ to: 'not-an-email' })
      .expect(400);

    expect(res.body.error).toMatch(/validation/i);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('sends a test email and returns success', async () => {
    sendEmail.mockResolvedValue({ success: true, messageId: 'mid-1' });
    const school = await createSchoolRecord({ name: 'Comm School 2', code: 'COMM2' });
    const admin = await createStaffUser({
      name: 'Comm Admin 2',
      email: 'comm.admin2@example.com',
      schoolId: school._id,
      permissionRole: 'admin',
    });
    const { app } = createTestApp();

    const res = await request(app)
      .post('/api/settings/communication/test-email')
      .set(authHeadersFor(admin, 'admin'))
      .send({ to: 'recipient@example.com' })
      .expect(200);

    expect(res.body).toMatchObject({ success: true });
    expect(res.body.message).toContain('recipient@example.com');
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const call = sendEmail.mock.calls[0][0];
    expect(call.to).toBe('recipient@example.com');
    expect(call.subject).toMatch(/\[TEST\]/);
    expect(call.schoolId).toBe(admin.schoolId.toString());
  });

  it('returns 400 when sendEmail reports failure', async () => {
    sendEmail.mockResolvedValue({ success: false, error: 'SMTP credentials not configured' });
    const school = await createSchoolRecord({ name: 'Comm School 3', code: 'COMM3' });
    const admin = await createStaffUser({
      name: 'Comm Admin 3',
      email: 'comm.admin3@example.com',
      schoolId: school._id,
      permissionRole: 'admin',
    });
    const { app } = createTestApp();

    const res = await request(app)
      .post('/api/settings/communication/test-email')
      .set(authHeadersFor(admin, 'admin'))
      .send({ to: 'recipient@example.com' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/SMTP credentials/);
  });

  it('rejects a teacher without settings.edit permission', async () => {
    const school = await createSchoolRecord({ name: 'Comm School 4', code: 'COMM4' });
    const teacher = await createStaffUser({
      name: 'Comm Teacher',
      email: 'comm.teacher@example.com',
      schoolId: school._id,
      permissionRole: 'teacher',
    });
    const { app } = createTestApp();

    await request(app)
      .post('/api/settings/communication/test-email')
      .set(authHeadersFor(teacher, 'teacher'))
      .send({ to: 'recipient@example.com' })
      .expect(403);

    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('POST /api/settings/communication/test-sms', () => {
  beforeEach(() => {
    sendEmail.mockReset();
    sendSMS.mockReset();
  });

  it('returns 400 on invalid phone', async () => {
    const school = await createSchoolRecord({ name: 'Comm School 5', code: 'COMM5' });
    const admin = await createStaffUser({
      name: 'Comm Admin 5',
      email: 'comm.admin5@example.com',
      schoolId: school._id,
      permissionRole: 'admin',
    });
    const { app } = createTestApp();

    const res = await request(app)
      .post('/api/settings/communication/test-sms')
      .set(authHeadersFor(admin, 'admin'))
      .send({ to: 'not-a-number' })
      .expect(400);

    expect(res.body.error).toMatch(/validation/i);
    expect(sendSMS).not.toHaveBeenCalled();
  });

  it('sends a test SMS and returns success', async () => {
    sendSMS.mockResolvedValue({ success: true, messageId: 'sms-1' });
    const school = await createSchoolRecord({ name: 'Comm School 6', code: 'COMM6' });
    const admin = await createStaffUser({
      name: 'Comm Admin 6',
      email: 'comm.admin6@example.com',
      schoolId: school._id,
      permissionRole: 'admin',
    });
    const { app } = createTestApp();

    const res = await request(app)
      .post('/api/settings/communication/test-sms')
      .set(authHeadersFor(admin, 'admin'))
      .send({ to: '919876543210' })
      .expect(200);

    expect(res.body).toMatchObject({ success: true });
    expect(res.body.message).toContain('919876543210');
    expect(sendSMS).toHaveBeenCalledWith('919876543210', expect.any(String));
  });

  it('returns 400 when sendSMS reports failure', async () => {
    sendSMS.mockResolvedValue({ success: false, error: 'MSG91 credentials not configured' });
    const school = await createSchoolRecord({ name: 'Comm School 7', code: 'COMM7' });
    const admin = await createStaffUser({
      name: 'Comm Admin 7',
      email: 'comm.admin7@example.com',
      schoolId: school._id,
      permissionRole: 'admin',
    });
    const { app } = createTestApp();

    const res = await request(app)
      .post('/api/settings/communication/test-sms')
      .set(authHeadersFor(admin, 'admin'))
      .send({ to: '919876543210' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/MSG91 credentials/);
  });
});
