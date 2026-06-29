import mongoose from 'mongoose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { FeePayment, StudentFeeStructure } from '../database.js';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

// PAG-01 — server pagination, server-side search, and the KPI summary
// endpoint for the Fees page. Kept in a dedicated file so it doesn't collide
// with the in-flight edits to fees.routes.test.js (PRs #38/#93).

const YEAR = '2025-26';

async function createAccountant(opts = {}) {
  return createStaffUser({
    name: 'Accounts User',
    staffRole: ['Accountant'],
    permissionRole: 'accountant',
    ...opts,
  });
}

// Insert a FeePayment straight into MongoDB with schoolId stored as a real
// ObjectId (the FeePayment schema declares schoolId as ObjectId, so the scoped
// query casts the filter to ObjectId — a string here would never match).
async function insertPaymentDirect(fields) {
  const { schoolId, ...rest } = fields;
  const result = await FeePayment.collection.insertOne({
    academicYear: YEAR,
    paymentDate: '2026-03-06',
    paymentMode: 'cash',
    status: 'completed',
    feeHeads: [],
    lateFee: 0,
    discount: 0,
    remarks: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...rest,
    ...(schoolId != null ? { schoolId: new mongoose.Types.ObjectId(schoolId.toString()) } : {}),
    receiptNumber: rest.receiptNumber || `RCP-${Date.now()}-${Math.random()}`,
  });
  return result.insertedId;
}

// Stand up a school + accountant + class and return everything a test needs.
async function seedSchool(code) {
  const school = await createSchoolRecord({ name: `${code} School`, code, isDefault: true });
  const accountant = await createAccountant({ schoolId: school._id });
  const classRecord = await createClassRecord({ name: 'Class 7', section: 'A' });
  const { app } = createTestApp();
  const authHeaders = authHeadersFor(accountant, 'accountant');
  return { school, accountant, classRecord, app, authHeaders };
}

describe('GET /api/fees/payments — pagination', () => {
  it('returns the requested page and accurate pagination metadata', async () => {
    const { school, classRecord, app, authHeaders } = await seedSchool('PGN-MAIN');
    const student = await createStudentRecord({
      name: 'Pager One',
      rollNo: 1,
      classId: classRecord._id,
    });

    // 3 payments, ordered by paymentDate desc by the route
    await insertPaymentDirect({
      studentId: student._id,
      classId: classRecord._id,
      schoolId: school._id,
      amount: 100,
      paymentDate: '2026-03-01',
    });
    await insertPaymentDirect({
      studentId: student._id,
      classId: classRecord._id,
      schoolId: school._id,
      amount: 200,
      paymentDate: '2026-03-02',
    });
    await insertPaymentDirect({
      studentId: student._id,
      classId: classRecord._id,
      schoolId: school._id,
      amount: 300,
      paymentDate: '2026-03-03',
    });

    const page1 = await request(app)
      .get('/api/fees/payments?limit=2&page=1')
      .set(authHeaders)
      .expect(200);
    expect(page1.body.payments).toHaveLength(2);
    expect(page1.body.pagination).toMatchObject({ page: 1, limit: 2, total: 3, totalPages: 2 });
    // Newest first
    expect(page1.body.payments[0].amount).toBe(300);

    const page2 = await request(app)
      .get('/api/fees/payments?limit=2&page=2')
      .set(authHeaders)
      .expect(200);
    expect(page2.body.payments).toHaveLength(1);
    expect(page2.body.pagination).toMatchObject({ page: 2, limit: 2, total: 3, totalPages: 2 });
    expect(page2.body.payments[0].amount).toBe(100);
  });
});

describe('GET /api/fees/payments — server-side search', () => {
  it('matches by student name and by receipt number across the whole dataset', async () => {
    const { school, classRecord, app, authHeaders } = await seedSchool('SRCH-MAIN');
    const alice = await createStudentRecord({
      name: 'Alice Wonderland',
      rollNo: 1,
      classId: classRecord._id,
    });
    const bob = await createStudentRecord({
      name: 'Bob Builder',
      rollNo: 2,
      classId: classRecord._id,
    });

    await insertPaymentDirect({
      studentId: alice._id,
      classId: classRecord._id,
      schoolId: school._id,
      amount: 100,
      receiptNumber: 'RCP-ALICE-1',
    });
    await insertPaymentDirect({
      studentId: bob._id,
      classId: classRecord._id,
      schoolId: school._id,
      amount: 200,
      receiptNumber: 'RCP-BOB-1',
    });

    const byName = await request(app)
      .get('/api/fees/payments?search=alice')
      .set(authHeaders)
      .expect(200);
    expect(byName.body.payments).toHaveLength(1);
    expect(byName.body.payments[0].amount).toBe(100);
    expect(byName.body.pagination.total).toBe(1);

    const byReceipt = await request(app)
      .get('/api/fees/payments?search=RCP-BOB')
      .set(authHeaders)
      .expect(200);
    expect(byReceipt.body.payments).toHaveLength(1);
    expect(byReceipt.body.payments[0].amount).toBe(200);
  });

  it('treats regex metacharacters in the search term as literals', async () => {
    const { school, classRecord, app, authHeaders } = await seedSchool('RGX-MAIN');
    const student = await createStudentRecord({
      name: 'Normal Name',
      rollNo: 1,
      classId: classRecord._id,
    });
    await insertPaymentDirect({
      studentId: student._id,
      classId: classRecord._id,
      schoolId: school._id,
      amount: 100,
    });

    // ".*" would match everything if not escaped; expect zero matches instead.
    const res = await request(app).get('/api/fees/payments?search=.*').set(authHeaders).expect(200);
    expect(res.body.payments).toHaveLength(0);
  });
});

describe('GET /api/fees/payments/summary', () => {
  it('requires authentication', async () => {
    const { app } = createTestApp();
    await request(app).get('/api/fees/payments/summary').expect(401);
  });

  it('rejects a malformed date param', async () => {
    const { app, authHeaders } = await seedSchool('SUMV-MAIN');
    await request(app)
      .get('/api/fees/payments/summary?date=03-06-2026')
      .set(authHeaders)
      .expect(400);
  });

  it('computes KPIs over the full dataset, not just one page', async () => {
    const { school, classRecord, app, authHeaders } = await seedSchool('SUM-MAIN');
    const student = await createStudentRecord({
      name: 'Summary Student',
      rollNo: 1,
      classId: classRecord._id,
    });
    const other = await createStudentRecord({
      name: 'Other Student',
      rollNo: 2,
      classId: classRecord._id,
    });

    // Collected today (2026-03-06): 500 + 250 ; one payment on another day is excluded.
    await insertPaymentDirect({
      studentId: student._id,
      classId: classRecord._id,
      schoolId: school._id,
      amount: 500,
      paymentDate: '2026-03-06',
    });
    await insertPaymentDirect({
      studentId: other._id,
      classId: classRecord._id,
      schoolId: school._id,
      amount: 250,
      paymentDate: '2026-03-06',
    });
    await insertPaymentDirect({
      studentId: student._id,
      classId: classRecord._id,
      schoolId: school._id,
      amount: 999,
      paymentDate: '2026-03-05',
    });
    // A cancelled payment today must not count.
    await insertPaymentDirect({
      studentId: student._id,
      classId: classRecord._id,
      schoolId: school._id,
      amount: 777,
      paymentDate: '2026-03-06',
      status: 'cancelled',
    });

    // Outstanding dues live on StudentFeeStructure: 800 + 200 owed; a fully-paid
    // structure (balance 0) is excluded from both the total and the count.
    await StudentFeeStructure.create({
      studentId: student._id,
      classId: classRecord._id,
      schoolId: school._id,
      academicYear: YEAR,
      totalFee: 1000,
      totalPaid: 200,
      totalBalance: 800,
      overallStatus: 'partial',
    });
    await StudentFeeStructure.create({
      studentId: other._id,
      classId: classRecord._id,
      schoolId: school._id,
      academicYear: YEAR,
      totalFee: 200,
      totalPaid: 0,
      totalBalance: 200,
      overallStatus: 'pending',
    });
    const paidStudent = await createStudentRecord({
      name: 'Paid Student',
      rollNo: 3,
      classId: classRecord._id,
    });
    await StudentFeeStructure.create({
      studentId: paidStudent._id,
      classId: classRecord._id,
      schoolId: school._id,
      academicYear: YEAR,
      totalFee: 500,
      totalPaid: 500,
      totalBalance: 0,
      overallStatus: 'paid',
    });

    const res = await request(app)
      .get(`/api/fees/payments/summary?date=2026-03-06&academicYear=${YEAR}`)
      .set(authHeaders)
      .expect(200);

    expect(res.body.collectedToday).toBe(750);
    expect(res.body.outstandingTotal).toBe(1000);
    expect(res.body.overdueCount).toBe(2);
    expect(res.body.date).toBe('2026-03-06');
    expect(res.body.academicYear).toBe(YEAR);
  });
});
