import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import { archiveStudent } from '../services/studentArchiveService.js';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

// Regression guard for the orphaned-fee leak: a soft-deleted student must not
// contribute to any fee "unpaid/balance/defaulters" count surfaced by the
// dashboard hero, the Fees KPI, the dashboard feed, or the defaulters list.
//
// The leak is now closed at the source: archiveStudent() soft-deletes the
// student's StudentFeeStructure/FeePayment/FeeRefund (feeArchiveRestore.unit
// test pins that cascade). The four display endpoints here ALSO $lookup into
// students and drop rows whose student is isDeleted — defense-in-depth so a
// future regression in either layer can't resurface archived fees.

const YEAR = '2025-26';

async function createAccountant(opts = {}) {
  return createStaffUser({
    name: 'Accounts User',
    staffRole: ['Accountant'],
    permissionRole: 'accountant',
    ...opts,
  });
}

describe('Orphaned fee records do not leak into fee summaries', () => {
  let app;
  let school;
  let classA;
  let student;
  let headers;

  beforeAll(async () => {
    ({ app } = createTestApp());
  });

  beforeEach(async () => {
    school = await createSchoolRecord({ name: 'Orphan Fee School' });
    const accountant = await createAccountant({ schoolId: school._id });
    headers = authHeadersFor(accountant);

    classA = await createClassRecord({
      schoolId: school._id,
      name: 'Class 1',
      section: 'A',
      academicYear: YEAR,
    });

    student = await createStudentRecord({
      schoolId: school._id,
      classId: classA._id,
      academicYear: YEAR,
      name: 'Defaulter Student',
    });

    // One fee structure with an outstanding balance for this live student.
    await StudentFeeStructure.create({
      schoolId: school._id,
      academicYear: YEAR,
      classId: classA._id,
      studentId: student._id,
      totalFee: 20000,
      totalPaid: 5000,
      totalBalance: 15000,
      overallStatus: 'partial',
      feeHeads: [],
    });
  });

  // Asserts every leaky endpoint counts the one live defaulter.
  async function expectOneDefaulterEverywhere() {
    const feeSummary = await request(app)
      .get(`/api/dashboard/fee-summary?academicYear=${YEAR}`)
      .set(headers)
      .expect(200);
    expect(feeSummary.body.defaulters).toBe(1);
    expect(feeSummary.body.totalPending).toBe(15000);

    const feed = await request(app).get(`/api/dashboard/feed`).set(headers).expect(200);
    const feePriority = feed.body.priorities.find((p) => p.id === 'fees');
    expect(feePriority).toBeDefined();

    const paymentsSummary = await request(app)
      .get(`/api/fees/payments/summary?academicYear=${YEAR}`)
      .set(headers)
      .expect(200);
    expect(paymentsSummary.body.overdueCount).toBe(1);
    expect(paymentsSummary.body.outstandingTotal).toBe(15000);

    const defaulters = await request(app)
      .get(`/api/student-fees/defaulters?academicYear=${YEAR}`)
      .set(headers)
      .expect(200);
    expect(defaulters.body.pagination.total).toBe(1);
    expect(defaulters.body.data).toHaveLength(1);
  }

  // After archiving, all four endpoints must drop to zero/absent — the fee
  // row is orphaned but must no longer be surfaced.
  async function expectNoDefaulterAnywhere() {
    const feeSummary = await request(app)
      .get(`/api/dashboard/fee-summary?academicYear=${YEAR}`)
      .set(headers)
      .expect(200);
    expect(feeSummary.body.defaulters).toBe(0);
    expect(feeSummary.body.totalPending).toBe(0);
    expect(feeSummary.body.feeStructuresExist).toBe(false);

    const feed = await request(app).get(`/api/dashboard/feed`).set(headers).expect(200);
    const feePriority = feed.body.priorities.find((p) => p.id === 'fees');
    expect(feePriority).toBeUndefined();

    const paymentsSummary = await request(app)
      .get(`/api/fees/payments/summary?academicYear=${YEAR}`)
      .set(headers)
      .expect(200);
    expect(paymentsSummary.body.overdueCount).toBe(0);
    expect(paymentsSummary.body.outstandingTotal).toBe(0);

    const defaulters = await request(app)
      .get(`/api/student-fees/defaulters?academicYear=${YEAR}`)
      .set(headers)
      .expect(200);
    expect(defaulters.body.pagination.total).toBe(0);
    expect(defaulters.body.data).toHaveLength(0);
  }

  it('counts the live student as a defaulter before archiving', async () => {
    await expectOneDefaulterEverywhere();
  });

  it('drops the orphaned fee record from every summary after archive', async () => {
    // archiveStudent now closes the leak at the SOURCE: it soft-deletes the
    // StudentFeeStructure (and FeePayment/FeeRefund) in the same transaction.
    // The display-layer $lookup remains as defense-in-depth — both layers must
    // keep hiding the archived student's fees. See feeArchiveRestore.unit.test
    // for the source-layer cascade assertions.
    await archiveStudent({
      studentId: student._id,
      schoolId: school._id,
      deletedBy: student._id,
    });

    // The document still exists (soft-deleted, not hard-deleted) and is now
    // flagged isDeleted at the doc level — so it is hidden by BOTH the
    // source-layer isDeleted filter AND the display-layer $lookup.
    const orphan = await StudentFeeStructure.findOne({
      schoolId: school._id,
      studentId: student._id,
      totalBalance: { $gt: 0 },
    });
    expect(orphan).toBeTruthy();
    expect(orphan.isDeleted).toBe(true);

    await expectNoDefaulterAnywhere();
  });
});
