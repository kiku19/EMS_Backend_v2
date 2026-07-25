import request from 'supertest';
import { describe, expect, it, beforeEach } from 'vitest';
import FeeReminderConfig, { DEFAULT_FEE_REMINDER_CONFIG } from '../models/FeeReminderConfig.js';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import {
  authHeadersFor,
  createSchoolRecord,
  createStaffUser,
  createClassRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const BASE = '/api/fee-reminder-config';

describe('fee-reminder-config routes', () => {
  let app, school, admin, headers;

  beforeEach(async () => {
    school = await createSchoolRecord({ name: 'Reminder School', code: 'RS' });
    admin = await createStaffUser({
      name: 'Reminder Admin',
      email: 'reminder.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    headers = authHeadersFor(admin, 'admin');
    ({ app } = createTestApp());
  });

  describe('GET /', () => {
    it('returns 401 without a token', async () => {
      await request(app).get(BASE).expect(401);
    });

    it('returns default config when none persisted', async () => {
      const res = await request(app).get(`${BASE}?academicYear=2025-26`).set(headers).expect(200);

      expect(res.body.enabled).toBe(DEFAULT_FEE_REMINDER_CONFIG.enabled);
      expect(res.body.dueReminder.daysBefore).toBe(
        DEFAULT_FEE_REMINDER_CONFIG.dueReminder.daysBefore
      );
      expect(res.body.overdueReminder.repeatEveryDays).toBe(
        DEFAULT_FEE_REMINDER_CONFIG.overdueReminder.repeatEveryDays
      );
      expect(res.body.channels).toMatchObject(DEFAULT_FEE_REMINDER_CONFIG.channels);
    });

    it('returns persisted config merged over defaults', async () => {
      await FeeReminderConfig.create({
        schoolId: school._id,
        academicYear: '2025-26',
        enabled: false,
        dueReminder: { enabled: true, daysBefore: 5, cadence: 'quarter' },
        channels: { inApp: true, push: false, whatsapp: true, email: false },
      });

      const res = await request(app).get(`${BASE}?academicYear=2025-26`).set(headers).expect(200);

      expect(res.body.enabled).toBe(false);
      expect(res.body.dueReminder.daysBefore).toBe(5);
      expect(res.body.dueReminder.cadence).toBe('quarter');
      expect(res.body.channels.whatsapp).toBe(true);
      // untouched nested default survives the merge
      expect(res.body.overdueReminder.repeatEveryDays).toBe(7);
    });
  });

  describe('PUT /', () => {
    it('rejects invalid payload with 400', async () => {
      const res = await request(app)
        .put(`${BASE}?academicYear=2025-26`)
        .set(headers)
        .send({ dueReminder: { daysBefore: 999 } })
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it('upserts config and returns it', async () => {
      const res = await request(app)
        .put(`${BASE}?academicYear=2025-26`)
        .set(headers)
        .send({
          enabled: true,
          dueReminder: { daysBefore: 4, cadence: 'month' },
          channels: { whatsapp: true, email: true },
        })
        .expect(200);

      expect(res.body.dueReminder.daysBefore).toBe(4);
      expect(res.body.dueReminder.cadence).toBe('month');
      expect(res.body.channels.whatsapp).toBe(true);

      const persisted = await FeeReminderConfig.findOne({
        schoolId: school._id,
        academicYear: '2025-26',
      }).lean();
      expect(persisted.dueReminder.daysBefore).toBe(4);
    });
  });

  describe('manual reminders', () => {
    let classDoc;

    beforeEach(async () => {
      classDoc = await createClassRecord({
        schoolId: school._id,
        name: 'Class 1',
        section: 'A',
      });
      // A student fee record with an outstanding balance so the audience is non-empty.
      await StudentFeeStructure.create({
        schoolId: school._id,
        academicYear: '2025-26',
        classId: classDoc._id,
        studentId: admin._id, // any valid ObjectId ref
        totalFee: 1000,
        totalPaid: 0,
        totalBalance: 1000,
        overallStatus: 'pending',
        feeHeads: [],
      });
    });

    it('GET /manual returns empty list initially', async () => {
      const res = await request(app)
        .get(`${BASE}/manual?academicYear=2025-26`)
        .set(headers)
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('POST /manual creates a manual reminder, returns 201, and lists it', async () => {
      const create = await request(app)
        .post(`${BASE}/manual?academicYear=2025-26`)
        .set(headers)
        .send({ name: 'Mid-term nudge', message: 'Please pay soon', audience: { type: 'overdue' } })
        .expect(201);

      expect(create.body.name).toBe('Mid-term nudge');
      expect(create.body.sentAt).toBeDefined();

      const list = await request(app)
        .get(`${BASE}/manual?academicYear=2025-26`)
        .set(headers)
        .expect(200);

      expect(list.body.length).toBe(1);
      expect(list.body[0].name).toBe('Mid-term nudge');
    });

    it('POST /manual rejects empty name with 400', async () => {
      await request(app)
        .post(`${BASE}/manual?academicYear=2025-26`)
        .set(headers)
        .send({ name: '' })
        .expect(400);
    });
  });
});
