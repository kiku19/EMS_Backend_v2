import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { SchoolSettings } from '../database.js';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const PAYMENT_METHODS = ['bank_transfer', 'cheque', 'cash', 'upi'];

describe('settings/payroll routes', () => {
  describe('authentication', () => {
    it('returns 401 for GET /api/settings/payroll without auth', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/settings/payroll').expect(401);
    });

    it('returns 401 for PUT /api/settings/payroll without auth', async () => {
      const { app } = createTestApp();
      await request(app).put('/api/settings/payroll').send({ disburseDate: 5 }).expect(401);
    });
  });

  describe('GET /api/settings/payroll', () => {
    it('returns defaults when no payroll settings exist', async () => {
      const school = await createSchoolRecord({
        name: 'Payroll Default School',
        code: 'PAYDEF',
      });
      const admin = await createStaffUser({
        name: 'Payroll Default Admin',
        email: 'payroll.default@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      const { app } = createTestApp();
      const response = await request(app)
        .get('/api/settings/payroll')
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);

      expect(response.body).toEqual({
        data: {
          disburseDate: 1,
          payrollCycle: 'monthly',
          paymentMethod: 'bank_transfer',
          autoReminder: true,
          reminderDays: 3,
        },
      });
    });

    it('returns persisted payroll fields', async () => {
      const school = await createSchoolRecord({
        name: 'Payroll Existing School',
        code: 'PAYEX',
      });
      const admin = await createStaffUser({
        name: 'Payroll Existing Admin',
        email: 'payroll.existing@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      await SchoolSettings.create({
        schoolId: school._id,
        name: 'Payroll Existing School',
        payroll: {
          disburseDate: 7,
          payrollCycle: 'weekly',
          paymentMethod: 'upi',
          autoReminder: true,
          reminderDays: 5,
        },
      });

      const { app } = createTestApp();
      const response = await request(app)
        .get('/api/settings/payroll')
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);

      expect(response.body.data).toEqual({
        disburseDate: 7,
        payrollCycle: 'weekly',
        paymentMethod: 'upi',
        autoReminder: true,
        reminderDays: 5,
      });
    });
  });

  describe('PUT /api/settings/payroll', () => {
    const setupAdmin = async (suffix) => {
      const school = await createSchoolRecord({
        name: `Payroll Update School ${suffix}`,
        code: `PAYUP${suffix}`,
      });
      const admin = await createStaffUser({
        name: `Payroll Update Admin ${suffix}`,
        email: `payroll.update.${suffix}@example.com`,
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });
      await SchoolSettings.create({
        schoolId: school._id,
        name: `Payroll Update School ${suffix}`,
      });
      return { school, admin };
    };

    it('persists all five payroll fields and round-trips on subsequent GET', async () => {
      const { admin } = await setupAdmin('ALL');

      const { app } = createTestApp();
      const putResponse = await request(app)
        .put('/api/settings/payroll')
        .set(authHeadersFor(admin, 'admin'))
        .send({
          disburseDate: 5,
          payrollCycle: 'monthly',
          paymentMethod: 'bank_transfer',
          autoReminder: true,
          reminderDays: 3,
        })
        .expect(200);

      expect(putResponse.body.data).toEqual({
        disburseDate: 5,
        payrollCycle: 'monthly',
        paymentMethod: 'bank_transfer',
        autoReminder: true,
        reminderDays: 3,
      });

      const getResponse = await request(app)
        .get('/api/settings/payroll')
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);

      expect(getResponse.body.data).toEqual({
        disburseDate: 5,
        payrollCycle: 'monthly',
        paymentMethod: 'bank_transfer',
        autoReminder: true,
        reminderDays: 3,
      });
    });

    it('accepts every paymentMethod enum value', async () => {
      for (const method of PAYMENT_METHODS) {
        const { admin } = await setupAdmin(method.toUpperCase());
        const { app } = createTestApp();
        const response = await request(app)
          .put('/api/settings/payroll')
          .set(authHeadersFor(admin, 'admin'))
          .send({ paymentMethod: method })
          .expect(200);
        expect(response.body.data.paymentMethod).toBe(method);
      }
    });

    it('rejects paymentMethod outside the enum', async () => {
      const { admin } = await setupAdmin('BADMETHOD');
      const { app } = createTestApp();
      await request(app)
        .put('/api/settings/payroll')
        .set(authHeadersFor(admin, 'admin'))
        .send({ paymentMethod: 'crypto' })
        .expect(400);
    });

    it('preserves existing fields when a partial update is sent', async () => {
      const { admin } = await setupAdmin('PARTIAL');
      const { app } = createTestApp();

      await request(app)
        .put('/api/settings/payroll')
        .set(authHeadersFor(admin, 'admin'))
        .send({
          disburseDate: 15,
          payrollCycle: 'biweekly',
          paymentMethod: 'cash',
          autoReminder: true,
          reminderDays: 10,
        })
        .expect(200);

      const response = await request(app)
        .put('/api/settings/payroll')
        .set(authHeadersFor(admin, 'admin'))
        .send({ autoReminder: false })
        .expect(200);

      expect(response.body.data).toEqual({
        disburseDate: 15,
        payrollCycle: 'biweekly',
        paymentMethod: 'cash',
        autoReminder: false,
        reminderDays: 10,
      });
    });

    it('rejects reminderDays above 30', async () => {
      const { admin } = await setupAdmin('MAX1');
      const { app } = createTestApp();
      await request(app)
        .put('/api/settings/payroll')
        .set(authHeadersFor(admin, 'admin'))
        .send({ reminderDays: 31 })
        .expect(400);
    });

    it('rejects negative reminderDays', async () => {
      const { admin } = await setupAdmin('MAX2');
      const { app } = createTestApp();
      await request(app)
        .put('/api/settings/payroll')
        .set(authHeadersFor(admin, 'admin'))
        .send({ reminderDays: -1 })
        .expect(400);
    });

    it('accepts reminderDays at 1 and 30 (boundary values)', async () => {
      for (const value of [1, 30]) {
        const { admin } = await setupAdmin(`BND${value}`);
        const { app } = createTestApp();
        const response = await request(app)
          .put('/api/settings/payroll')
          .set(authHeadersFor(admin, 'admin'))
          .send({ reminderDays: value })
          .expect(200);
        expect(response.body.data.reminderDays).toBe(value);
      }
    });

    it('rejects a non-integer reminderDays', async () => {
      const { admin } = await setupAdmin('FRAC');
      const { app } = createTestApp();
      await request(app)
        .put('/api/settings/payroll')
        .set(authHeadersFor(admin, 'admin'))
        .send({ reminderDays: 1.5 })
        .expect(400);
    });

    it('rejects unknown fields (strict schema)', async () => {
      const { admin } = await setupAdmin('STRICT');
      const { app } = createTestApp();
      await request(app)
        .put('/api/settings/payroll')
        .set(authHeadersFor(admin, 'admin'))
        .send({ suspicious: 'value' })
        .expect(400);
    });
  });
});
