import request from 'supertest';
import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import Expense from '../models/Expense.js';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const BASE = '/api/expenses';

function buildPayload(overrides = {}) {
  return {
    title: 'Test Expense',
    amount: 1000,
    category: 'supplies',
    paymentMode: 'cash',
    expenseDate: '2025-06-15',
    description: 'Office supplies',
    vendor: 'Stationery Store',
    academicYear: '2025-26',
    ...overrides,
  };
}

describe('expenses routes', () => {
  async function setup() {
    const school = await createSchoolRecord({ name: 'Expense School', code: 'EXP' });
    const admin = await createStaffUser({
      name: 'Exp Admin',
      email: 'exp.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    const { app } = createTestApp();
    const headers = authHeadersFor(admin, 'admin');
    return { school, admin, app, headers };
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('returns 401 without token', async () => {
      const { app } = createTestApp();
      await request(app).get(BASE).expect(401);
      await request(app).post(BASE).send(buildPayload()).expect(401);
    });
  });

  // ── POST /api/expenses ───────────────────────────────────────────────────
  describe('POST /api/expenses', () => {
    it('creates an expense', async () => {
      const { school, app, headers } = await setup();
      const payload = buildPayload();

      const res = await request(app).post(BASE).set(headers).send(payload).expect(201);

      expect(res.body.title).toBe(payload.title);
      expect(res.body.amount).toBe(payload.amount);
      expect(res.body.category).toBe(payload.category);
      expect(res.body.schoolId.toString()).toBe(school._id.toString());
    });

    it('returns 400 when title is missing', async () => {
      const { app, headers } = await setup();
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .send(buildPayload({ title: undefined }))
        .expect(400);
      expect(res.body.error).toBeTruthy();
    });

    it('returns 400 for invalid category', async () => {
      const { app, headers } = await setup();
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .send(buildPayload({ category: 'invalid' }))
        .expect(400);
      expect(res.body.error).toBeTruthy();
    });
  });

  // ── GET /api/expenses ────────────────────────────────────────────────────
  describe('GET /api/expenses', () => {
    it('returns paginated expenses for the school', async () => {
      const { school, app, headers } = await setup();
      await Expense.create([
        {
          schoolId: school._id,
          title: 'A',
          amount: 100,
          category: 'supplies',
          expenseDate: new Date('2025-06-01'),
        },
        {
          schoolId: school._id,
          title: 'B',
          amount: 200,
          category: 'utilities',
          expenseDate: new Date('2025-06-02'),
        },
      ]);

      const res = await request(app).get(BASE).set(headers).expect(200);

      expect(Array.isArray(res.body.expenses)).toBe(true);
      expect(res.body.expenses.length).toBe(2);
      expect(res.body.total).toBe(2);
      expect(res.body.page).toBe(1);
    });

    it('filters by category', async () => {
      const { school, app, headers } = await setup();
      await Expense.create([
        {
          schoolId: school._id,
          title: 'A',
          amount: 100,
          category: 'supplies',
          expenseDate: new Date('2025-06-01'),
        },
        {
          schoolId: school._id,
          title: 'B',
          amount: 200,
          category: 'utilities',
          expenseDate: new Date('2025-06-02'),
        },
      ]);

      const res = await request(app).get(`${BASE}?category=supplies`).set(headers).expect(200);
      expect(res.body.expenses).toHaveLength(1);
      expect(res.body.expenses[0].category).toBe('supplies');
    });

    it('filters by date range', async () => {
      const { school, app, headers } = await setup();
      await Expense.create([
        {
          schoolId: school._id,
          title: 'Early',
          amount: 100,
          category: 'supplies',
          expenseDate: new Date('2025-01-01'),
        },
        {
          schoolId: school._id,
          title: 'Late',
          amount: 200,
          category: 'supplies',
          expenseDate: new Date('2025-12-01'),
        },
      ]);

      const res = await request(app)
        .get(`${BASE}?from=2025-06-01&to=2025-12-31`)
        .set(headers)
        .expect(200);
      expect(res.body.expenses).toHaveLength(1);
      expect(res.body.expenses[0].title).toBe('Late');
    });

    it('excludes soft-deleted expenses', async () => {
      const { school, app, headers } = await setup();
      await Expense.create([
        {
          schoolId: school._id,
          title: 'Active',
          amount: 100,
          category: 'supplies',
          expenseDate: new Date('2025-06-01'),
          isDeleted: false,
        },
        {
          schoolId: school._id,
          title: 'Deleted',
          amount: 200,
          category: 'supplies',
          expenseDate: new Date('2025-06-02'),
          isDeleted: true,
        },
      ]);

      const res = await request(app).get(BASE).set(headers).expect(200);
      const titles = res.body.expenses.map((e) => e.title);
      expect(titles).toContain('Active');
      expect(titles).not.toContain('Deleted');
    });

    describe('q search (PAG-13)', () => {
      async function seedSearchData(school) {
        await Expense.create([
          {
            schoolId: school._id,
            title: 'Projector bulb replacement',
            amount: 100,
            category: 'maintenance',
            expenseDate: new Date('2025-06-01'),
            vendor: 'Acme Electronics',
          },
          {
            schoolId: school._id,
            title: 'Monthly water bill',
            amount: 200,
            category: 'utilities',
            expenseDate: new Date('2025-06-02'),
            vendor: 'City Water Board',
          },
        ]);
      }

      it('matches on title', async () => {
        const { school, app, headers } = await setup();
        await seedSearchData(school);

        const res = await request(app).get(`${BASE}?q=projector`).set(headers).expect(200);
        expect(res.body.expenses).toHaveLength(1);
        expect(res.body.expenses[0].title).toBe('Projector bulb replacement');
      });

      it('matches on vendor', async () => {
        const { school, app, headers } = await setup();
        await seedSearchData(school);

        const res = await request(app).get(`${BASE}?q=water+board`).set(headers).expect(200);
        expect(res.body.expenses).toHaveLength(1);
        expect(res.body.expenses[0].vendor).toBe('City Water Board');
      });

      it('is case-insensitive', async () => {
        const { school, app, headers } = await setup();
        await seedSearchData(school);

        const res = await request(app).get(`${BASE}?q=ACME`).set(headers).expect(200);
        expect(res.body.expenses).toHaveLength(1);
        expect(res.body.expenses[0].vendor).toBe('Acme Electronics');
      });

      it('returns an empty list when nothing matches', async () => {
        const { school, app, headers } = await setup();
        await seedSearchData(school);

        const res = await request(app).get(`${BASE}?q=nonexistent`).set(headers).expect(200);
        expect(res.body.expenses).toHaveLength(0);
        expect(res.body.total).toBe(0);
      });

      it('treats regex metacharacters as literal text (no over-match)', async () => {
        const { school, app, headers } = await setup();
        await Expense.create({
          schoolId: school._id,
          title: 'Refund (50%) processing',
          amount: 100,
          category: 'other',
          expenseDate: new Date('2025-06-01'),
        });

        // '.*' would match everything if not escaped; here it must match nothing literal.
        const wildcard = await request(app).get(`${BASE}?q=.*`).set(headers).expect(200);
        expect(wildcard.body.expenses).toHaveLength(0);

        // The literal parenthesised text should still be found.
        const literal = await request(app).get(`${BASE}?q=(50%)`).set(headers).expect(200);
        expect(literal.body.expenses).toHaveLength(1);
      });

      it('does not crash on object-shaped q (NoSQL injection guard)', async () => {
        const { school, app, headers } = await setup();
        await seedSearchData(school);

        // q[$ne]= arrives as an object; the route must coerce it to a string
        // rather than passing it into the regex, and must not 500.
        const res = await request(app).get(`${BASE}?q[$ne]=x`).set(headers).expect(200);
        expect(Array.isArray(res.body.expenses)).toBe(true);
      });
    });
  });

  // ── GET /api/expenses/summary ────────────────────────────────────────────
  describe('GET /api/expenses/summary', () => {
    it('returns category totals', async () => {
      const { school, app, headers } = await setup();
      await Expense.create([
        {
          schoolId: school._id,
          title: 'A',
          amount: 100,
          category: 'supplies',
          expenseDate: new Date('2025-06-01'),
          status: 'approved',
        },
        {
          schoolId: school._id,
          title: 'B',
          amount: 200,
          category: 'supplies',
          expenseDate: new Date('2025-06-02'),
          status: 'approved',
        },
        {
          schoolId: school._id,
          title: 'C',
          amount: 50,
          category: 'utilities',
          expenseDate: new Date('2025-06-03'),
          status: 'approved',
        },
      ]);

      const res = await request(app).get(`${BASE}/summary`).set(headers).expect(200);

      expect(res.body).toHaveProperty('summary');
      expect(res.body).toHaveProperty('totalAmount');
      expect(res.body.totalAmount).toBe(350);
      const supplies = res.body.summary.find((s) => s._id === 'supplies');
      expect(supplies.total).toBe(300);
    });

    it('excludes rejected expenses', async () => {
      const { school, app, headers } = await setup();
      await Expense.create([
        {
          schoolId: school._id,
          title: 'A',
          amount: 100,
          category: 'supplies',
          expenseDate: new Date('2025-06-01'),
          status: 'approved',
        },
        {
          schoolId: school._id,
          title: 'B',
          amount: 200,
          category: 'supplies',
          expenseDate: new Date('2025-06-02'),
          status: 'rejected',
        },
      ]);

      const res = await request(app).get(`${BASE}/summary`).set(headers).expect(200);
      expect(res.body.totalAmount).toBe(100);
    });
  });

  // ── PUT /api/expenses/:id ────────────────────────────────────────────────
  describe('PUT /api/expenses/:id', () => {
    it('updates an expense', async () => {
      const { school, app, headers } = await setup();
      const expense = await Expense.create({
        schoolId: school._id,
        title: 'Old',
        amount: 100,
        category: 'supplies',
        expenseDate: new Date('2025-06-01'),
      });

      const res = await request(app)
        .put(`${BASE}/${expense._id}`)
        .set(headers)
        .send({ title: 'New', amount: 200 })
        .expect(200);

      expect(res.body.title).toBe('New');
      expect(res.body.amount).toBe(200);
    });

    it('returns 404 for non-existent expense', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).put(`${BASE}/${fakeId}`).set(headers).send({ title: 'X' }).expect(404);
    });

    it('does not update an expense from another school', async () => {
      const { school, app, headers } = await setup();
      const schoolB = await createSchoolRecord({ name: 'School B', code: 'EXPB' });
      const expenseB = await Expense.create({
        schoolId: schoolB._id,
        title: 'B',
        amount: 100,
        category: 'supplies',
        expenseDate: new Date('2025-06-01'),
      });

      await request(app)
        .put(`${BASE}/${expenseB._id}`)
        .set(headers)
        .send({ title: 'Hacked' })
        .expect(404);
    });
  });

  // ── DELETE /api/expenses/:id ─────────────────────────────────────────────
  describe('DELETE /api/expenses/:id', () => {
    it('soft-deletes an expense', async () => {
      const { school, app, headers } = await setup();
      const expense = await Expense.create({
        schoolId: school._id,
        title: 'To Delete',
        amount: 100,
        category: 'supplies',
        expenseDate: new Date('2025-06-01'),
      });

      const res = await request(app).delete(`${BASE}/${expense._id}`).set(headers).expect(200);
      expect(res.body.message).toMatch(/deleted/i);

      const deleted = await Expense.findById(expense._id);
      expect(deleted.isDeleted).toBe(true);
    });

    it('returns 404 for non-existent expense', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).delete(`${BASE}/${fakeId}`).set(headers).expect(404);
    });
  });

  // ── Multi-tenancy ─────────────────────────────────────────────────────────
  describe('multi-tenancy', () => {
    it('only returns expenses for the current school', async () => {
      const schoolA = await createSchoolRecord({ name: 'School A', code: 'EXPA' });
      const schoolB = await createSchoolRecord({ name: 'School B', code: 'EXPB' });
      const adminA = await createStaffUser({
        name: 'Admin A',
        email: 'a@example.com',
        schoolId: schoolA._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      await Expense.create({
        schoolId: schoolA._id,
        title: 'A-only',
        amount: 100,
        category: 'supplies',
        expenseDate: new Date('2025-06-01'),
      });
      await Expense.create({
        schoolId: schoolB._id,
        title: 'B-only',
        amount: 200,
        category: 'supplies',
        expenseDate: new Date('2025-06-01'),
      });

      const { app } = createTestApp();
      const res = await request(app).get(BASE).set(authHeadersFor(adminA, 'admin')).expect(200);
      expect(res.body.expenses).toHaveLength(1);
      expect(res.body.expenses[0].title).toBe('A-only');
    });
  });
});
