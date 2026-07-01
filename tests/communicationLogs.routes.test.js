import request from 'supertest';
import { describe, expect, it } from 'vitest';
import Announcement from '../models/Announcement.js';
import AnnouncementRecipient from '../models/AnnouncementRecipient.js';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

function seedLogs(schoolId, adminId, count = 3) {
  return Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const announcement = await Announcement.create({
        schoolId,
        title: `Announcement ${i + 1}`,
        content: `Content ${i + 1}`,
        recipients: [{ type: 'all' }],
        channels: [{ type: 'email', status: 'sent' }],
        status: 'sent',
        createdBy: adminId,
        creatorModel: 'Staff',
      });

      return AnnouncementRecipient.create({
        schoolId,
        announcementId: announcement._id,
        userId: adminId,
        userType: 'Staff',
        name: `Recipient ${i + 1}`,
        email: `recipient${i + 1}@example.com`,
        phone: `987654321${i}`,
        deliveryStatus: [
          {
            channel: 'email',
            status: i === 0 ? 'failed' : 'sent',
            sentAt: new Date(),
          },
          {
            channel: 'inapp',
            status: 'delivered',
            sentAt: new Date(),
          },
        ],
        status: 'sent',
      });
    })
  );
}

describe('communication-logs routes', () => {
  // ── Auth ────────────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('returns 401 when no auth token is provided', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/communication-logs').expect(401);
      await request(app).get('/api/communication-logs/stats').expect(401);
    });
  });

  // ── GET /api/communication-logs ─────────────────────────────────────────────
  describe('GET /api/communication-logs', () => {
    it('returns paginated individual delivery logs for the school', async () => {
      const school = await createSchoolRecord({ name: 'Comm Log School', code: 'COMM' });
      const admin = await createStaffUser({
        name: 'Comm Admin',
        email: 'comm.admin@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      await seedLogs(school._id, admin._id, 2);

      const { app } = createTestApp();
      const res = await request(app)
        .get('/api/communication-logs')
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);

      expect(res.body.logs).toBeInstanceOf(Array);
      expect(res.body.logs.length).toBeGreaterThan(0);
      expect(res.body.total).toBe(4); // 2 announcements x 2 channels
      expect(res.body.totalPages).toBe(1);
      expect(res.body.currentPage).toBe(1);

      const log = res.body.logs[0];
      expect(log).toHaveProperty('_id');
      expect(log).toHaveProperty('announcementId');
      expect(log).toHaveProperty('announcementTitle');
      expect(log).toHaveProperty('channel');
      expect(log).toHaveProperty('status');
      expect(log).toHaveProperty('recipient');
      expect(log).toHaveProperty('recipientName');
    });

    it('filters logs by channel', async () => {
      const school = await createSchoolRecord({ name: 'Filter School', code: 'FILT' });
      const admin = await createStaffUser({
        name: 'Filter Admin',
        email: 'filter.admin@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      await seedLogs(school._id, admin._id, 2);

      const { app } = createTestApp();
      const res = await request(app)
        .get('/api/communication-logs?channel=email')
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);

      expect(res.body.logs.every((log) => log.channel === 'email')).toBe(true);
      expect(res.body.total).toBe(2);
    });

    it('filters logs by status', async () => {
      const school = await createSchoolRecord({ name: 'Status School', code: 'STAT' });
      const admin = await createStaffUser({
        name: 'Status Admin',
        email: 'status.admin@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      await seedLogs(school._id, admin._id, 3);

      const { app } = createTestApp();
      const res = await request(app)
        .get('/api/communication-logs?status=failed')
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);

      expect(res.body.logs.every((log) => log.status === 'failed')).toBe(true);
      expect(res.body.total).toBe(1);
    });

    it('searches logs by recipient name', async () => {
      const school = await createSchoolRecord({ name: 'Search School', code: 'SRCH' });
      const admin = await createStaffUser({
        name: 'Search Admin',
        email: 'search.admin@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      await seedLogs(school._id, admin._id, 3);

      const { app } = createTestApp();
      const res = await request(app)
        .get('/api/communication-logs?search=Recipient%201')
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);

      expect(res.body.logs.length).toBe(2);
      expect(res.body.logs.every((log) => log.recipientName.includes('Recipient 1'))).toBe(true);
    });

    it('returns validation error for invalid query params', async () => {
      const school = await createSchoolRecord({ name: 'Val School', code: 'VAL' });
      const admin = await createStaffUser({
        name: 'Val Admin',
        email: 'val.admin@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      const { app } = createTestApp();
      const res = await request(app)
        .get('/api/communication-logs?channel=invalid')
        .set(authHeadersFor(admin, 'admin'))
        .expect(400);

      expect(res.body.error).toBeTruthy();
    });
  });

  // ── GET /api/communication-logs/stats ───────────────────────────────────────
  describe('GET /api/communication-logs/stats', () => {
    it('returns aggregate communication log stats', async () => {
      const school = await createSchoolRecord({ name: 'Stats School', code: 'STATS' });
      const admin = await createStaffUser({
        name: 'Stats Admin',
        email: 'stats.admin@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      await seedLogs(school._id, admin._id, 3);

      const { app } = createTestApp();
      const res = await request(app)
        .get('/api/communication-logs/stats')
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);

      expect(res.body).toMatchObject({
        sentThisMonth: expect.any(Number),
        totalDelivered: expect.any(Number),
        totalFailed: expect.any(Number),
        totalSent: expect.any(Number),
        scheduled: expect.any(Number),
      });

      expect(res.body.totalFailed).toBe(1);
      expect(res.body.totalDelivered).toBe(3); // inapp delivered for 3 announcements
      expect(res.body.totalSent).toBe(6); // 3 email (1 failed) + 3 inapp delivered
    });
  });

  // ── Multi-tenancy ───────────────────────────────────────────────────────────
  describe('multi-tenancy isolation', () => {
    it('does not return logs belonging to another school', async () => {
      const schoolA = await createSchoolRecord({ name: 'School A', code: 'SCHA' });
      const schoolB = await createSchoolRecord({ name: 'School B', code: 'SCHB' });

      const adminA = await createStaffUser({
        name: 'Admin A',
        email: 'admin.a@example.com',
        schoolId: schoolA._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });
      const adminB = await createStaffUser({
        name: 'Admin B',
        email: 'admin.b@example.com',
        schoolId: schoolB._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      await seedLogs(schoolA._id, adminA._id, 2);

      const { app } = createTestApp();
      const res = await request(app)
        .get('/api/communication-logs')
        .set(authHeadersFor(adminB, 'admin'))
        .expect(200);

      expect(res.body.logs).toHaveLength(0);
      expect(res.body.total).toBe(0);
    });
  });
});
