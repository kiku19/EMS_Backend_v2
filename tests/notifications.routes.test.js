import request from 'supertest';
import { describe, expect, it, beforeEach } from 'vitest';
import Notification from '../models/Notification.js';
import NotificationPreference from '../models/NotificationPreference.js';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

describe('notifications routes', () => {
  let school, admin, authHeaders, app;

  beforeEach(async () => {
    school = await createSchoolRecord({
      name: 'Notify School',
      code: 'NOTIFY',
    });
    admin = await createStaffUser({
      name: 'Notify Admin',
      email: 'notify.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    authHeaders = authHeadersFor(admin, 'admin');
    ({ app } = createTestApp());
  });

  // ── Auth ──────────────────────────────────────────────────────────

  it('returns 401 when no token is provided', async () => {
    await request(app).get('/api/notifications').expect(401);
    await request(app).put('/api/notifications/read-all').expect(401);
    await request(app).get('/api/notifications/preferences/me').expect(401);
  });

  // ── GET /api/notifications ────────────────────────────────────────

  it('returns an empty list when no notifications exist', async () => {
    const res = await request(app).get('/api/notifications').set(authHeaders).expect(200);

    expect(res.body).toMatchObject({
      notifications: [],
      unreadCount: 0,
    });
  });

  it('returns notifications belonging to the authenticated user', async () => {
    await Notification.create({
      userId: admin._id,
      userModel: 'Staff',
      schoolId: school._id,
      type: 'announcement',
      title: 'Welcome',
      message: 'Hello admin',
      channels: [{ type: 'inapp', status: 'pending' }],
    });

    // Create a notification for a different user — should NOT appear
    const other = await createStaffUser({
      name: 'Other Staff',
      email: 'other.staff@example.com',
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });
    await Notification.create({
      userId: other._id,
      userModel: 'Staff',
      schoolId: school._id,
      type: 'announcement',
      title: 'Other',
      message: 'Not for admin',
      channels: [{ type: 'inapp', status: 'pending' }],
    });

    const res = await request(app).get('/api/notifications').set(authHeaders).expect(200);

    expect(res.body.notifications).toHaveLength(1);
    expect(res.body.notifications[0].title).toBe('Welcome');
    expect(res.body.unreadCount).toBe(1);
  });

  it('filters by unreadOnly=true', async () => {
    await Notification.create({
      userId: admin._id,
      userModel: 'Staff',
      schoolId: school._id,
      type: 'event',
      title: 'Unread',
      message: 'not read',
      read: false,
      channels: [{ type: 'inapp', status: 'pending' }],
    });
    await Notification.create({
      userId: admin._id,
      userModel: 'Staff',
      schoolId: school._id,
      type: 'event',
      title: 'Read',
      message: 'already read',
      read: true,
      readAt: new Date(),
      channels: [{ type: 'inapp', status: 'pending' }],
    });

    const res = await request(app)
      .get('/api/notifications')
      .query({ unreadOnly: 'true' })
      .set(authHeaders)
      .expect(200);

    expect(res.body.notifications).toHaveLength(1);
    expect(res.body.notifications[0].title).toBe('Unread');
  });

  it('filters by notification type', async () => {
    await Notification.create({
      userId: admin._id,
      userModel: 'Staff',
      schoolId: school._id,
      type: 'payment',
      title: 'Payment Due',
      message: 'pay up',
      channels: [{ type: 'inapp', status: 'pending' }],
    });
    await Notification.create({
      userId: admin._id,
      userModel: 'Staff',
      schoolId: school._id,
      type: 'attendance',
      title: 'Absent',
      message: 'student absent',
      channels: [{ type: 'inapp', status: 'pending' }],
    });

    const res = await request(app)
      .get('/api/notifications')
      .query({ type: 'payment' })
      .set(authHeaders)
      .expect(200);

    expect(res.body.notifications).toHaveLength(1);
    expect(res.body.notifications[0].type).toBe('payment');
  });

  // ── GET /api/notifications pagination (PAG-18) ────────────────────

  // Seed a notification with a deterministic createdAt so skip/limit ordering
  // is stable across pages (createdAt is what the route sorts on, desc).
  // Inserted via the native driver because the Mongoose `timestamps` plugin
  // protects createdAt — it ignores values passed to create()/updateOne(),
  // and rapid inserts would otherwise collide on the same millisecond.
  const seedNotification = (i) =>
    Notification.collection.insertOne({
      userId: admin._id,
      userModel: 'Staff',
      schoolId: school._id,
      type: 'announcement',
      title: `N${i}`,
      message: `message ${i}`,
      read: false,
      priority: 'normal',
      channels: [{ type: 'inapp', status: 'pending' }],
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
      updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
    });

  it('paginates with skip/limit and reports total + hasMore', async () => {
    for (let i = 1; i <= 5; i += 1) {
      await seedNotification(i);
    }

    // Page 1 — newest first (N5, N4)
    const page1 = await request(app)
      .get('/api/notifications')
      .query({ limit: 2, skip: 0 })
      .set(authHeaders)
      .expect(200);
    expect(page1.body.notifications).toHaveLength(2);
    expect(page1.body.notifications.map((n) => n.title)).toEqual(['N5', 'N4']);
    expect(page1.body.total).toBe(5);
    expect(page1.body.pagination).toMatchObject({ total: 5, skip: 0, limit: 2, hasMore: true });

    // Page 2 — (N3, N2)
    const page2 = await request(app)
      .get('/api/notifications')
      .query({ limit: 2, skip: 2 })
      .set(authHeaders)
      .expect(200);
    expect(page2.body.notifications.map((n) => n.title)).toEqual(['N3', 'N2']);
    expect(page2.body.pagination).toMatchObject({ skip: 2, hasMore: true });

    // Page 3 — last item (N1), hasMore now false
    const page3 = await request(app)
      .get('/api/notifications')
      .query({ limit: 2, skip: 4 })
      .set(authHeaders)
      .expect(200);
    expect(page3.body.notifications.map((n) => n.title)).toEqual(['N1']);
    expect(page3.body.pagination).toMatchObject({ skip: 4, hasMore: false });
  });

  it('clamps an oversized limit to 100', async () => {
    const res = await request(app)
      .get('/api/notifications')
      .query({ limit: 500 })
      .set(authHeaders)
      .expect(200);

    expect(res.body.pagination.limit).toBe(100);
  });

  it('computes unreadCount over all matches, not just the returned page', async () => {
    for (let i = 1; i <= 3; i += 1) {
      await seedNotification(i); // all unread by default
    }

    // Only ask for the first page (1 item) — unreadCount/total must still
    // reflect all 3, proving the badge is not derived from the page.
    const res = await request(app)
      .get('/api/notifications')
      .query({ limit: 1 })
      .set(authHeaders)
      .expect(200);

    expect(res.body.notifications).toHaveLength(1);
    expect(res.body.unreadCount).toBe(3);
    expect(res.body.total).toBe(3);
    expect(res.body.pagination.hasMore).toBe(true);
  });

  // ── PUT /api/notifications/:id/read ───────────────────────────────

  it('marks a notification as read', async () => {
    const notif = await Notification.create({
      userId: admin._id,
      userModel: 'Staff',
      schoolId: school._id,
      type: 'academic',
      title: 'Exam Published',
      message: 'Results are out',
      channels: [{ type: 'inapp', status: 'pending' }],
    });

    const res = await request(app)
      .put(`/api/notifications/${notif._id}/read`)
      .set(authHeaders)
      .expect(200);

    expect(res.body.read).toBe(true);
    expect(res.body.readAt).toBeTruthy();

    const updated = await Notification.findById(notif._id);
    expect(updated.read).toBe(true);
  });

  it('returns 404 when marking a non-existent notification as read', async () => {
    const fakeId = '6601234567890abcdef01234';
    await request(app).put(`/api/notifications/${fakeId}/read`).set(authHeaders).expect(404);
  });

  it('returns 404 when marking another user notification as read', async () => {
    const other = await createStaffUser({
      name: 'Other Teacher',
      email: 'other.teacher@example.com',
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });
    const notif = await Notification.create({
      userId: other._id,
      userModel: 'Staff',
      schoolId: school._id,
      type: 'chat',
      title: 'Message',
      message: 'Hello',
      channels: [{ type: 'inapp', status: 'pending' }],
    });

    await request(app).put(`/api/notifications/${notif._id}/read`).set(authHeaders).expect(404);
  });

  // ── PUT /api/notifications/read-all ───────────────────────────────

  it('marks all notifications as read for the user', async () => {
    await Notification.insertMany([
      {
        userId: admin._id,
        userModel: 'Staff',
        schoolId: school._id,
        type: 'event',
        title: 'Event 1',
        message: 'msg1',
        channels: [{ type: 'inapp', status: 'pending' }],
      },
      {
        userId: admin._id,
        userModel: 'Staff',
        schoolId: school._id,
        type: 'event',
        title: 'Event 2',
        message: 'msg2',
        channels: [{ type: 'inapp', status: 'pending' }],
      },
    ]);

    const res = await request(app).put('/api/notifications/read-all').set(authHeaders).expect(200);

    expect(res.body.message).toBe('All notifications marked as read');

    const unread = await Notification.countDocuments({
      userId: admin._id,
      read: false,
    });
    expect(unread).toBe(0);
  });

  // ── DELETE /api/notifications/:id ─────────────────────────────────

  it('deletes a notification', async () => {
    const notif = await Notification.create({
      userId: admin._id,
      userModel: 'Staff',
      schoolId: school._id,
      type: 'salary',
      title: 'Payslip',
      message: 'Your payslip is ready',
      channels: [{ type: 'inapp', status: 'pending' }],
    });

    const res = await request(app)
      .delete(`/api/notifications/${notif._id}`)
      .set(authHeaders)
      .expect(200);

    expect(res.body.message).toBe('Notification deleted');

    const found = await Notification.findById(notif._id);
    expect(found).toBeNull();
  });

  it('returns 404 when deleting a non-existent notification', async () => {
    const fakeId = '6601234567890abcdef01234';
    await request(app).delete(`/api/notifications/${fakeId}`).set(authHeaders).expect(404);
  });

  it('returns 404 when deleting another user notification', async () => {
    const other = await createStaffUser({
      name: 'Delete Other',
      email: 'delete.other@example.com',
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });
    const notif = await Notification.create({
      userId: other._id,
      userModel: 'Staff',
      schoolId: school._id,
      type: 'transport',
      title: 'Bus Update',
      message: 'Route changed',
      channels: [{ type: 'inapp', status: 'pending' }],
    });

    await request(app).delete(`/api/notifications/${notif._id}`).set(authHeaders).expect(404);
  });

  // ── GET /api/notifications/preferences/me ─────────────────────────

  it('returns default preferences when none exist', async () => {
    const res = await request(app)
      .get('/api/notifications/preferences/me')
      .set(authHeaders)
      .expect(200);

    expect(res.body).toMatchObject({
      userId: admin._id.toString(),
      userModel: 'Staff',
      role: 'admin',
    });
  });

  it('returns existing preferences', async () => {
    await NotificationPreference.create({
      userId: admin._id,
      userModel: 'Staff',
      schoolId: school._id,
      role: 'admin',
      digestFrequency: 'daily',
      preferences: [
        {
          category: 'payment',
          notifications: [
            {
              type: 'payment_successful',
              channels: { email: true, sms: false, whatsapp: false, inapp: true },
              enabled: true,
            },
          ],
        },
      ],
    });

    const res = await request(app)
      .get('/api/notifications/preferences/me')
      .set(authHeaders)
      .expect(200);

    expect(res.body.digestFrequency).toBe('daily');
    expect(res.body.preferences).toHaveLength(1);
    expect(res.body.preferences[0].category).toBe('payment');
  });

  // ── PUT /api/notifications/preferences/me ─────────────────────────

  it('creates preferences when updating and none exist', async () => {
    const res = await request(app)
      .put('/api/notifications/preferences/me')
      .set(authHeaders)
      .send({
        digestFrequency: 'weekly',
        quietHours: {
          enabled: true,
          startTime: '22:00',
          endTime: '07:00',
          timezone: 'Asia/Kolkata',
        },
      })
      .expect(200);

    expect(res.body.digestFrequency).toBe('weekly');
    expect(res.body.quietHours.enabled).toBe(true);
    expect(res.body.quietHours.startTime).toBe('22:00');
  });

  it('updates existing preferences', async () => {
    await NotificationPreference.create({
      userId: admin._id,
      userModel: 'Staff',
      schoolId: school._id,
      role: 'admin',
      digestFrequency: 'instant',
    });

    const res = await request(app)
      .put('/api/notifications/preferences/me')
      .set(authHeaders)
      .send({
        digestFrequency: 'hourly',
        emailDigest: {
          enabled: true,
          frequency: 'daily',
          time: '09:00',
        },
      })
      .expect(200);

    expect(res.body.digestFrequency).toBe('hourly');
    expect(res.body.emailDigest.enabled).toBe(true);
    expect(res.body.emailDigest.frequency).toBe('daily');
  });

  it('updates category preferences', async () => {
    const res = await request(app)
      .put('/api/notifications/preferences/me')
      .set(authHeaders)
      .send({
        preferences: [
          {
            category: 'attendance',
            notifications: [
              {
                type: 'student_absent',
                channels: { email: true, sms: true, whatsapp: false, inapp: true },
                enabled: true,
              },
            ],
          },
        ],
      })
      .expect(200);

    expect(res.body.preferences).toHaveLength(1);
    expect(res.body.preferences[0].category).toBe('attendance');
    expect(res.body.preferences[0].notifications[0].channels.sms).toBe(true);
  });

  // ── POST /api/notifications/preferences/reset ─────────────────────

  it('resets preferences to defaults by deleting them', async () => {
    await NotificationPreference.create({
      userId: admin._id,
      userModel: 'Staff',
      schoolId: school._id,
      role: 'admin',
      digestFrequency: 'weekly',
    });

    const res = await request(app)
      .post('/api/notifications/preferences/reset')
      .set(authHeaders)
      .expect(200);

    expect(res.body.message).toBe('Preferences reset to defaults');

    const pref = await NotificationPreference.findOne({
      userId: admin._id,
      userModel: 'Staff',
    });
    expect(pref).toBeNull();
  });

  it('succeeds even when no preferences exist to reset', async () => {
    await request(app).post('/api/notifications/preferences/reset').set(authHeaders).expect(200);
  });
});
