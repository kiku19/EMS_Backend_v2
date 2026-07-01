import request from 'supertest';
import { describe, expect, it } from 'vitest';
import Notification from '../models/Notification.js';
import {
  authHeadersFor,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
  createParentUser,
  createClassRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

// Regression coverage for SCH-209: student fee/attendance reminders were
// passing the raw reminder type ('fee') straight to sendNotification, but
// 'fee' is NOT a valid Notification.type enum value (the canonical fee type is
// 'payment'). Every reminder notification therefore threw on save and was
// silently swallowed per-parent while the endpoint still reported success — so
// parents received nothing. These tests assert a notification is actually
// persisted with a valid type.

async function setup() {
  const school = await createSchoolRecord({ name: 'Reminder Delivery School' });
  const admin = await createStaffUser({ schoolId: school._id, name: 'Reminder Admin' });
  const klass = await createClassRecord({ schoolId: school._id });
  const student = await createStudentRecord({
    schoolId: school._id,
    name: 'Reminder Student',
    classId: klass._id,
  });
  const parent = await createParentUser({
    schoolId: school._id,
    name: 'Reminder Parent',
    children: [{ studentId: student._id }],
  });
  const { app } = createTestApp();
  const headers = authHeadersFor(admin, 'admin');
  return { school, admin, student, parent, app, headers };
}

describe('student reminder delivery (SCH-209)', () => {
  describe('POST /api/students/send-reminders-bulk', () => {
    it('persists a fee reminder notification with a valid Notification.type', async () => {
      const { student, parent, app, headers } = await setup();

      const res = await request(app)
        .post('/api/students/send-reminders-bulk')
        .set(headers)
        .send({ studentIds: [student._id.toString()], type: 'fee', message: 'Your fee is due.' })
        .expect(200);

      expect(res.body).toEqual({ succeeded: 1, failed: 0 });

      const notifications = await Notification.find({ userId: parent._id, userModel: 'Parent' });
      expect(notifications).toHaveLength(1);
      expect(notifications[0].type).toBe('payment');
      expect(notifications[0].title).toContain('Fee Reminder');
      expect(notifications[0].message).toBe('Your fee is due.');
    });

    it('persists an attendance reminder notification with type "attendance"', async () => {
      const { student, parent, app, headers } = await setup();

      await request(app)
        .post('/api/students/send-reminders-bulk')
        .set(headers)
        .send({
          studentIds: [student._id.toString()],
          type: 'attendance',
          message: 'Please attend.',
        })
        .expect(200);

      const notifications = await Notification.find({ userId: parent._id, userModel: 'Parent' });
      expect(notifications).toHaveLength(1);
      expect(notifications[0].type).toBe('attendance');
      expect(notifications[0].title).toContain('Attendance Reminder');
    });

    it('reports failure for a student that has no linked parent', async () => {
      const { school, app, headers } = await setup();
      const orphanClass = await createClassRecord({
        schoolId: school._id,
        name: 'Class 9',
        section: 'B',
      });
      const orphan = await createStudentRecord({
        schoolId: school._id,
        name: 'No Parent Student',
        classId: orphanClass._id,
      });

      const res = await request(app)
        .post('/api/students/send-reminders-bulk')
        .set(headers)
        .send({ studentIds: [orphan._id.toString()], type: 'fee', message: 'Hi' })
        .expect(200);

      expect(res.body).toEqual({ succeeded: 0, failed: 1 });
      const notifications = await Notification.find({ userModel: 'Parent' });
      expect(notifications).toHaveLength(0);
    });
  });

  describe('POST /api/students/:id/send-reminder', () => {
    it('persists a single fee reminder notification with type "payment"', async () => {
      const { student, parent, app, headers } = await setup();

      const res = await request(app)
        .post(`/api/students/${student._id}/send-reminder`)
        .set(headers)
        .send({ type: 'fee', message: 'Single reminder.' })
        .expect(200);

      expect(res.body.notified).toBe(1);

      const notifications = await Notification.find({ userId: parent._id, userModel: 'Parent' });
      expect(notifications).toHaveLength(1);
      expect(notifications[0].type).toBe('payment');
    });
  });
});
