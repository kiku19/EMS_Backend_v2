import mongoose from 'mongoose';
import request from 'supertest';
import { describe, expect, it, beforeEach } from 'vitest';
import FeeConsession from '../models/FeeConsession.js';
import LateFeeRule from '../models/LateFeeRule.js';
import FeeRule from '../models/FeeRule.js';
import PaymentMethodConfig from '../models/PaymentMethodConfig.js';
import FeeCollectionPeriod from '../models/FeeCollectionPeriod.js';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const BASE = '/api/fee-settings';

describe('fee-settings routes', () => {
  let app, school, admin, headers;

  beforeEach(async () => {
    school = await createSchoolRecord({ name: 'Settings School', code: 'SS' });
    admin = await createStaffUser({
      name: 'Settings Admin',
      email: 'settings.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    headers = authHeadersFor(admin, 'admin');
    ({ app } = createTestApp());
  });

  // ───────────────────────────────────────────────────────────────
  // Fee Concessions
  // ───────────────────────────────────────────────────────────────
  describe('concessions', () => {
    const CONCESSIONS = `${BASE}/concessions`;

    it('GET /concessions returns 401 without token', async () => {
      await request(app).get(CONCESSIONS).expect(401);
    });

    it('POST /concessions returns 401 without token', async () => {
      await request(app)
        .post(CONCESSIONS)
        .send({ name: 'Test', discountType: 'flat', discountValue: 100, academicYear: '2025-26' })
        .expect(401);
    });

    it('POST /concessions creates a concession and returns 201', async () => {
      const payload = {
        name: 'Sibling Discount',
        discountType: 'percentage',
        discountValue: 10,
        academicYear: '2025-26',
      };

      const res = await request(app).post(CONCESSIONS).set(headers).send(payload).expect(201);

      expect(res.body.name).toBe('Sibling Discount');
      expect(res.body.discountType).toBe('percentage');
      expect(res.body.discountValue).toBe(10);
    });

    it('GET /concessions returns all concessions', async () => {
      await FeeConsession.create({
        name: 'Merit Discount',
        discountType: 'flat',
        discountValue: 500,
        academicYear: '2025-26',
        schoolId: school._id,
      });

      const res = await request(app).get(CONCESSIONS).set(headers).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('GET /concessions filters by academicYear query param', async () => {
      await FeeConsession.create({
        name: 'Old Discount',
        discountType: 'flat',
        discountValue: 200,
        academicYear: '2024-25',
        schoolId: school._id,
      });
      await FeeConsession.create({
        name: 'New Discount',
        discountType: 'flat',
        discountValue: 300,
        academicYear: '2025-26',
        schoolId: school._id,
      });

      const res = await request(app)
        .get(`${CONCESSIONS}?academicYear=2025-26`)
        .set(headers)
        .expect(200);

      expect(res.body.every((c) => c.academicYear === '2025-26')).toBe(true);
    });

    it('GET /concessions/:id returns a single concession', async () => {
      const concession = await FeeConsession.create({
        name: 'Staff Ward',
        discountType: 'percentage',
        discountValue: 50,
        academicYear: '2025-26',
        schoolId: school._id,
      });

      const res = await request(app)
        .get(`${CONCESSIONS}/${concession._id}`)
        .set(headers)
        .expect(200);

      expect(res.body.name).toBe('Staff Ward');
    });

    it('GET /concessions/:id returns 404 for non-existent id', async () => {
      await request(app)
        .get(`${CONCESSIONS}/${new mongoose.Types.ObjectId()}`)
        .set(headers)
        .expect(404);
    });

    it('PUT /concessions/:id updates a concession', async () => {
      const concession = await FeeConsession.create({
        name: 'Old Name',
        discountType: 'flat',
        discountValue: 100,
        academicYear: '2025-26',
        schoolId: school._id,
      });

      const res = await request(app)
        .put(`${CONCESSIONS}/${concession._id}`)
        .set(headers)
        .send({ name: 'Updated Name', discountValue: 200 })
        .expect(200);

      expect(res.body.name).toBe('Updated Name');
      expect(res.body.discountValue).toBe(200);
    });

    it('PUT /concessions/:id returns 404 for non-existent id', async () => {
      await request(app)
        .put(`${CONCESSIONS}/${new mongoose.Types.ObjectId()}`)
        .set(headers)
        .send({ name: 'Ghost' })
        .expect(404);
    });

    it('DELETE /concessions/:id deletes a concession', async () => {
      const concession = await FeeConsession.create({
        name: 'Delete Me',
        discountType: 'flat',
        discountValue: 100,
        academicYear: '2025-26',
        schoolId: school._id,
      });

      const res = await request(app)
        .delete(`${CONCESSIONS}/${concession._id}`)
        .set(headers)
        .expect(200);

      expect(res.body.message).toMatch(/deleted/i);

      const found = await FeeConsession.findById(concession._id);
      expect(found).toBeNull();
    });

    it('DELETE /concessions/:id returns 404 for non-existent id', async () => {
      await request(app)
        .delete(`${CONCESSIONS}/${new mongoose.Types.ObjectId()}`)
        .set(headers)
        .expect(404);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // Late Fee Rules
  // ───────────────────────────────────────────────────────────────
  describe('late-fee-rules', () => {
    const LATE_FEE = `${BASE}/late-fee-rules`;

    it('GET /late-fee-rules returns 401 without token', async () => {
      await request(app).get(LATE_FEE).expect(401);
    });

    it('POST /late-fee-rules creates a new late fee rule', async () => {
      const payload = {
        academicYear: '2025-26',
        fineType: 'flat',
        flatAmount: 50,
        enabled: true,
      };

      const res = await request(app).post(LATE_FEE).set(headers).send(payload).expect(200); // upsert: returns 200 when isNew is false on existing obj

      expect(res.body.fineType).toBe('flat');
      expect(res.body.flatAmount).toBe(50);
    });

    it('POST /late-fee-rules updates existing rule for same academicYear', async () => {
      await LateFeeRule.create({
        academicYear: '2025-26',
        fineType: 'flat',
        flatAmount: 50,
        schoolId: school._id,
      });

      const res = await request(app)
        .post(LATE_FEE)
        .set(headers)
        .send({ academicYear: '2025-26', fineType: 'per_day', perDayAmount: 10 })
        .expect(200);

      expect(res.body.fineType).toBe('per_day');
      expect(res.body.perDayAmount).toBe(10);
    });

    it('GET /late-fee-rules returns all rules', async () => {
      await LateFeeRule.create({
        academicYear: '2025-26',
        fineType: 'flat',
        flatAmount: 25,
        schoolId: school._id,
      });

      const res = await request(app).get(LATE_FEE).set(headers).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('GET /late-fee-rules/:id returns a single rule', async () => {
      const rule = await LateFeeRule.create({
        academicYear: '2025-26',
        fineType: 'flat',
        flatAmount: 75,
        schoolId: school._id,
      });

      const res = await request(app).get(`${LATE_FEE}/${rule._id}`).set(headers).expect(200);

      expect(res.body.flatAmount).toBe(75);
    });

    it('GET /late-fee-rules/:id returns 404 for non-existent id', async () => {
      await request(app)
        .get(`${LATE_FEE}/${new mongoose.Types.ObjectId()}`)
        .set(headers)
        .expect(404);
    });

    it('PUT /late-fee-rules/:id updates a rule', async () => {
      const rule = await LateFeeRule.create({
        academicYear: '2025-26',
        fineType: 'flat',
        flatAmount: 50,
        schoolId: school._id,
      });

      const res = await request(app)
        .put(`${LATE_FEE}/${rule._id}`)
        .set(headers)
        .send({ flatAmount: 100 })
        .expect(200);

      expect(res.body.flatAmount).toBe(100);
    });

    it('DELETE /late-fee-rules/:id deletes a rule', async () => {
      const rule = await LateFeeRule.create({
        academicYear: '2025-26',
        fineType: 'flat',
        flatAmount: 50,
        schoolId: school._id,
      });

      await request(app).delete(`${LATE_FEE}/${rule._id}`).set(headers).expect(200);

      const found = await LateFeeRule.findById(rule._id);
      expect(found).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────
  // Fee Rules
  // ───────────────────────────────────────────────────────────────
  describe('rules', () => {
    const RULES = `${BASE}/rules`;

    it('GET /rules returns 401 without token', async () => {
      await request(app).get(RULES).expect(401);
    });

    it('POST /rules creates a new fee rule', async () => {
      const payload = { academicYear: '2025-26', allowPartialPayment: true };

      const res = await request(app).post(RULES).set(headers).send(payload).expect(200);

      expect(res.body.academicYear).toBe('2025-26');
      expect(res.body.allowPartialPayment).toBe(true);
    });

    it('POST /rules updates existing rule for same academicYear', async () => {
      await FeeRule.create({
        academicYear: '2025-26',
        allowPartialPayment: true,
        schoolId: school._id,
      });

      const res = await request(app)
        .post(RULES)
        .set(headers)
        .send({ academicYear: '2025-26', allowPartialPayment: false })
        .expect(200);

      expect(res.body.allowPartialPayment).toBe(false);
    });

    it('GET /rules returns all fee rules', async () => {
      await FeeRule.create({ academicYear: '2025-26', schoolId: school._id });

      const res = await request(app).get(RULES).set(headers).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('GET /rules/:id returns 404 for non-existent id', async () => {
      await request(app).get(`${RULES}/${new mongoose.Types.ObjectId()}`).set(headers).expect(404);
    });

    it('PUT /rules/:id updates a fee rule', async () => {
      const rule = await FeeRule.create({
        academicYear: '2025-26',
        allowPartialPayment: false,
        schoolId: school._id,
      });

      const res = await request(app)
        .put(`${RULES}/${rule._id}`)
        .set(headers)
        .send({ allowPartialPayment: true })
        .expect(200);

      expect(res.body.allowPartialPayment).toBe(true);
    });

    it('DELETE /rules/:id deletes a fee rule', async () => {
      const rule = await FeeRule.create({ academicYear: '2025-26', schoolId: school._id });

      await request(app).delete(`${RULES}/${rule._id}`).set(headers).expect(200);

      const found = await FeeRule.findById(rule._id);
      expect(found).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────
  // Payment Methods
  // ───────────────────────────────────────────────────────────────
  describe('payment-methods', () => {
    const PAYMENT = `${BASE}/payment-methods`;

    it('GET /payment-methods returns 401 without token', async () => {
      await request(app).get(PAYMENT).expect(401);
    });

    it('POST /payment-methods creates a payment method config', async () => {
      const payload = {
        academicYear: '2025-26',
        online: { enabled: true },
        offline: { enabled: true, cash: true },
      };

      const res = await request(app).post(PAYMENT).set(headers).send(payload).expect(200);

      expect(res.body.academicYear).toBe('2025-26');
    });

    it('POST /payment-methods updates existing config for same academicYear', async () => {
      await PaymentMethodConfig.create({
        academicYear: '2025-26',
        online: { enabled: true },
        schoolId: school._id,
      });

      const res = await request(app)
        .post(PAYMENT)
        .set(headers)
        .send({ academicYear: '2025-26', online: { enabled: false } })
        .expect(200);

      expect(res.body.online.enabled).toBe(false);
    });

    it('GET /payment-methods returns all payment method configs', async () => {
      await PaymentMethodConfig.create({ academicYear: '2025-26', schoolId: school._id });

      const res = await request(app).get(PAYMENT).set(headers).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('GET /payment-methods/:id returns a single config', async () => {
      const config = await PaymentMethodConfig.create({
        academicYear: '2025-26',
        schoolId: school._id,
      });

      const res = await request(app).get(`${PAYMENT}/${config._id}`).set(headers).expect(200);

      expect(res.body.academicYear).toBe('2025-26');
    });

    it('GET /payment-methods/:id returns 404 for non-existent id', async () => {
      await request(app)
        .get(`${PAYMENT}/${new mongoose.Types.ObjectId()}`)
        .set(headers)
        .expect(404);
    });

    it('PUT /payment-methods/:id updates a config', async () => {
      const config = await PaymentMethodConfig.create({
        academicYear: '2025-26',
        offline: { cash: true, cheque: false },
        schoolId: school._id,
      });

      const res = await request(app)
        .put(`${PAYMENT}/${config._id}`)
        .set(headers)
        .send({ offline: { cash: true, cheque: true } })
        .expect(200);

      expect(res.body.offline.cheque).toBe(true);
    });

    it('DELETE /payment-methods/:id deletes a config', async () => {
      const config = await PaymentMethodConfig.create({
        academicYear: '2025-26',
        schoolId: school._id,
      });

      await request(app).delete(`${PAYMENT}/${config._id}`).set(headers).expect(200);

      const found = await PaymentMethodConfig.findById(config._id);
      expect(found).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────
  // Fee Collection Period
  // ───────────────────────────────────────────────────────────────
  describe('collection-period', () => {
    const PERIOD = `${BASE}/collection-period`;

    it('GET /collection-period returns 401 without token', async () => {
      await request(app).get(PERIOD).expect(401);
    });

    it('POST /collection-period creates a collection period config', async () => {
      const payload = {
        academicYear: '2025-26',
        collectionInterval: 'quarterly',
      };

      const res = await request(app).post(PERIOD).set(headers).send(payload).expect(200);

      expect(res.body.collectionInterval).toBe('quarterly');
    });

    it('POST /collection-period updates existing config for same academicYear', async () => {
      await FeeCollectionPeriod.create({
        academicYear: '2025-26',
        collectionInterval: 'monthly',
        schoolId: school._id,
      });

      const res = await request(app)
        .post(PERIOD)
        .set(headers)
        .send({ academicYear: '2025-26', collectionInterval: 'yearly' })
        .expect(200);

      expect(res.body.collectionInterval).toBe('yearly');
    });

    it('GET /collection-period returns all configs', async () => {
      await FeeCollectionPeriod.create({ academicYear: '2025-26', schoolId: school._id });

      const res = await request(app).get(PERIOD).set(headers).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('GET /collection-period/:id returns a single config', async () => {
      const config = await FeeCollectionPeriod.create({
        academicYear: '2025-26',
        collectionInterval: 'term-wise',
        schoolId: school._id,
      });

      const res = await request(app).get(`${PERIOD}/${config._id}`).set(headers).expect(200);

      expect(res.body.collectionInterval).toBe('term-wise');
    });

    it('GET /collection-period/:id returns 404 for non-existent id', async () => {
      await request(app).get(`${PERIOD}/${new mongoose.Types.ObjectId()}`).set(headers).expect(404);
    });

    it('PUT /collection-period/:id updates a config', async () => {
      const config = await FeeCollectionPeriod.create({
        academicYear: '2025-26',
        collectionInterval: 'monthly',
        schoolId: school._id,
      });

      const res = await request(app)
        .put(`${PERIOD}/${config._id}`)
        .set(headers)
        .send({ collectionInterval: 'quarterly' })
        .expect(200);

      expect(res.body.collectionInterval).toBe('quarterly');
    });

    it('DELETE /collection-period/:id deletes a config', async () => {
      const config = await FeeCollectionPeriod.create({
        academicYear: '2025-26',
        schoolId: school._id,
      });

      await request(app).delete(`${PERIOD}/${config._id}`).set(headers).expect(200);

      const found = await FeeCollectionPeriod.findById(config._id);
      expect(found).toBeNull();
    });
  });
});
