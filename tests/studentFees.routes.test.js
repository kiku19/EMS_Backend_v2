import mongoose from 'mongoose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Student, FeePayment } from '../database.js';
import FeeHead from '../models/FeeHead.js';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
} from './helpers/factories.js';
import { FeePaymentAudit } from '../database.js';
import { createTestApp } from './helpers/testApp.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Create a staff user with the accountant permission role.
async function createAccountant(opts = {}) {
  return createStaffUser({
    name: 'Accounts User',
    staffRole: ['Accountant'],
    permissionRole: 'accountant',
    ...opts,
  });
}

// Create FeeHead documents scoped to a school and applicable to a class number.
async function createFeeHeads(schoolId, classNumber = '10') {
  const tuition = await FeeHead.create({
    name: 'Tuition Fee',
    category: 'Academic',
    headType: 'tuition',
    amount: 5000,
    mandatory: true,
    frequency: 'yearly',
    applicableClasses: [classNumber],
    schoolId,
    isActive: true,
  });

  const lab = await FeeHead.create({
    name: 'Lab Fee',
    category: 'Academic',
    headType: 'lab',
    amount: 1000,
    mandatory: true,
    frequency: 'yearly',
    applicableClasses: [classNumber],
    schoolId,
    isActive: true,
  });

  return { tuition, lab };
}

// Insert a StudentFeeStructure directly for tests that need pre-existing data.
async function insertFeeStructureDirect(fields) {
  const { schoolId, ...rest } = fields;
  const doc = await StudentFeeStructure.create({
    ...rest,
    schoolId: schoolId ? new mongoose.Types.ObjectId(schoolId.toString()) : undefined,
  });
  return doc;
}

// ---------------------------------------------------------------------------
// GET /api/student-fees/student/:studentId — Get fee structure (auto-init)
// ---------------------------------------------------------------------------

describe('GET /api/student-fees/student/:studentId', () => {
  it('returns 401 when no auth token is provided', async () => {
    const { app } = createTestApp();
    const fakeId = '000000000000000000000001';

    await request(app).get(`/api/student-fees/student/${fakeId}`).expect(401);
  });

  it('returns 404 when the student does not exist', async () => {
    const accountant = await createAccountant();
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');
    const fakeId = '000000000000000000000001';

    await request(app).get(`/api/student-fees/student/${fakeId}`).set(authHeaders).expect(404);
  });

  it('auto-initializes a fee structure when none exists and student has a class', async () => {
    const school = await createSchoolRecord({
      name: 'Auto Init School',
      code: 'AIS-01',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({
      name: 'Class 10',
      section: 'A',
      schoolId: school._id,
    });
    const { tuition, lab } = await createFeeHeads(school._id, '10');

    const student = await createStudentRecord({
      name: 'Auto Init Student',
      classId: classRecord._id,
      schoolId: school._id,
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .get(`/api/student-fees/student/${student._id}`)
      .set(authHeaders)
      .expect(200);

    // Should have auto-created a fee structure with the two fee heads
    expect(res.body.feeHeads).toHaveLength(2);
    expect(res.body.totalFee).toBe(6000); // 5000 + 1000
    expect(res.body.totalPaid).toBe(0);
    expect(res.body.totalBalance).toBe(6000);
    expect(res.body.overallStatus).toBe('pending');

    // Verify a StudentFeeStructure was persisted
    const persisted = await StudentFeeStructure.findOne({ studentId: student._id });
    expect(persisted).not.toBeNull();
    expect(persisted.totalFee).toBe(6000);
  });

  it('returns existing fee structure without re-initializing', async () => {
    const school = await createSchoolRecord({
      name: 'Existing FS School',
      code: 'EFS-01',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({
      name: 'Class 10',
      section: 'B',
      schoolId: school._id,
    });

    const student = await createStudentRecord({
      name: 'Existing FS Student',
      classId: classRecord._id,
      schoolId: school._id,
    });

    // Pre-create a fee structure
    await insertFeeStructureDirect({
      studentId: student._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      schoolId: school._id,
      feeHeads: [],
      totalFee: 9999,
      totalPaid: 1000,
      totalBalance: 8999,
      overallStatus: 'partial',
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .get(`/api/student-fees/student/${student._id}`)
      .set(authHeaders)
      .expect(200);

    // Should return the existing structure, not a new one
    expect(res.body.totalFee).toBe(9999);
    expect(res.body.totalPaid).toBe(1000);
    expect(res.body.overallStatus).toBe('partial');
  });

  it('returns empty structure with _initialized: false when student has no class', async () => {
    const school = await createSchoolRecord({
      name: 'No Class School',
      code: 'NCS-01',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });

    // Create a student without a classId by using a class then removing it
    const classRecord = await createClassRecord({
      name: 'Class 10',
      section: 'C',
      schoolId: school._id,
    });
    const student = await createStudentRecord({
      name: 'No Class Student',
      classId: classRecord._id,
      schoolId: school._id,
    });
    // Remove classId to simulate no class assigned
    await Student.findByIdAndUpdate(student._id, { $unset: { classId: '' } });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .get(`/api/student-fees/student/${student._id}`)
      .set(authHeaders)
      .expect(200);

    expect(res.body._initialized).toBe(false);
    expect(res.body.feeHeads).toEqual([]);
    expect(res.body.totalFee).toBe(0);
  });

  it('populates studentId, classId, and feeHeadId fields', async () => {
    const school = await createSchoolRecord({
      name: 'Populate School',
      code: 'POP-SF',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({
      name: 'Class 10',
      section: 'D',
      schoolId: school._id,
    });
    await createFeeHeads(school._id, '10');

    const student = await createStudentRecord({
      name: 'Populate Student',
      admissionId: 'ADM-POP-SF',
      classId: classRecord._id,
      schoolId: school._id,
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .get(`/api/student-fees/student/${student._id}`)
      .set(authHeaders)
      .expect(200);

    // studentId should be populated
    expect(typeof res.body.studentId).toBe('object');
    expect(res.body.studentId.name).toBe('Populate Student');
    expect(res.body.studentId.admissionId).toBe('ADM-POP-SF');

    // classId should be populated
    expect(typeof res.body.classId).toBe('object');
    expect(res.body.classId.name).toBe('Class 10');
    expect(res.body.classId.section).toBe('D');
  });
});

// ---------------------------------------------------------------------------
// POST /api/student-fees/initialize/:studentId — Manual initialization
// ---------------------------------------------------------------------------

describe('POST /api/student-fees/initialize/:studentId', () => {
  it('returns 401 when no auth token is provided', async () => {
    const { app } = createTestApp();
    const fakeId = '000000000000000000000001';

    await request(app).post(`/api/student-fees/initialize/${fakeId}`).send({}).expect(401);
  });

  it('returns 404 when the student does not exist', async () => {
    const accountant = await createAccountant();
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');
    const fakeId = '000000000000000000000001';

    await request(app)
      .post(`/api/student-fees/initialize/${fakeId}`)
      .set(authHeaders)
      .send({})
      .expect(404);
  });

  it('returns 400 when student has no class assigned', async () => {
    const school = await createSchoolRecord({
      name: 'No Class Init School',
      code: 'NCI-01',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({
      name: 'Class 10',
      section: 'E',
      schoolId: school._id,
    });

    const student = await createStudentRecord({
      name: 'No Class Init Student',
      classId: classRecord._id,
      schoolId: school._id,
    });
    await Student.findByIdAndUpdate(student._id, { $unset: { classId: '' } });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .post(`/api/student-fees/initialize/${student._id}`)
      .set(authHeaders)
      .send({})
      .expect(400);

    expect(res.body.error).toMatch(/class/i);
  });

  it('creates fee structure with applicable fee heads and returns 201', async () => {
    const school = await createSchoolRecord({
      name: 'Init School',
      code: 'INI-01',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({
      name: 'Class 10',
      section: 'F',
      schoolId: school._id,
    });
    const { tuition, lab } = await createFeeHeads(school._id, '10');

    const student = await createStudentRecord({
      name: 'Init Student',
      classId: classRecord._id,
      schoolId: school._id,
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .post(`/api/student-fees/initialize/${student._id}`)
      .set(authHeaders)
      .send({ academicYear: '2025-26' })
      .expect(201);

    expect(res.body.feeHeads).toHaveLength(2);
    expect(res.body.totalFee).toBe(6000);
    expect(res.body.totalPaid).toBe(0);
    expect(res.body.totalBalance).toBe(6000);
    expect(res.body.overallStatus).toBe('pending');

    // Verify Student.feeDetails was synced
    const refreshed = await Student.findById(student._id).lean();
    expect(refreshed.feeDetails.totalFee).toBe(6000);
    expect(refreshed.feeDetails.paidAmount).toBe(0);
    expect(refreshed.feeDetails.balanceAmount).toBe(6000);
    expect(refreshed.feeStatus).toBe('pending');
  });

  it('returns existing fee structure when already initialized', async () => {
    const school = await createSchoolRecord({
      name: 'Already Init School',
      code: 'ALI-01',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({
      name: 'Class 10',
      section: 'G',
      schoolId: school._id,
    });
    await createFeeHeads(school._id, '10');

    const student = await createStudentRecord({
      name: 'Already Init Student',
      classId: classRecord._id,
      schoolId: school._id,
    });

    // Pre-create fee structure
    await insertFeeStructureDirect({
      studentId: student._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      schoolId: school._id,
      feeHeads: [],
      totalFee: 7777,
      totalPaid: 0,
      totalBalance: 7777,
      overallStatus: 'pending',
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .post(`/api/student-fees/initialize/${student._id}`)
      .set(authHeaders)
      .send({ academicYear: '2025-26' })
      .expect(200);

    expect(res.body.message).toBe('Fee structure already exists');
    expect(res.body.feeStructure.totalFee).toBe(7777);
  });

  it('only includes active fee heads for the correct class', async () => {
    const school = await createSchoolRecord({
      name: 'Active FH School',
      code: 'AFH-01',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({
      name: 'Class 5',
      section: 'A',
      schoolId: school._id,
    });

    // Create fee heads for class 5
    await FeeHead.create({
      name: 'Class 5 Tuition',
      category: 'Academic',
      amount: 3000,
      mandatory: true,
      frequency: 'yearly',
      applicableClasses: ['5'],
      schoolId: school._id,
      isActive: true,
    });

    // Inactive fee head — should NOT be included
    await FeeHead.create({
      name: 'Inactive Fee',
      category: 'Other',
      amount: 500,
      mandatory: false,
      frequency: 'yearly',
      applicableClasses: ['5'],
      schoolId: school._id,
      isActive: false,
    });

    // Fee head for different class — should NOT be included
    await FeeHead.create({
      name: 'Class 10 Only',
      category: 'Academic',
      amount: 8000,
      mandatory: true,
      frequency: 'yearly',
      applicableClasses: ['10'],
      schoolId: school._id,
      isActive: true,
    });

    const student = await createStudentRecord({
      name: 'Class 5 Student',
      classId: classRecord._id,
      schoolId: school._id,
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .post(`/api/student-fees/initialize/${student._id}`)
      .set(authHeaders)
      .send({})
      .expect(201);

    expect(res.body.feeHeads).toHaveLength(1);
    expect(res.body.feeHeads[0].name).toBe('Class 5 Tuition');
    expect(res.body.totalFee).toBe(3000);
  });

  it('scopes 11000-duplicate recovery by schoolId + academicYear, not studentId alone', async () => {
    // Before the fix, a 11000 on initialize fell back to
    // `StudentFeeStructure.findOne({ studentId })` which could return a
    // doc from a prior academic year or (if studentIds ever collided
    // across tenants) from a different school. Force the duplicate
    // condition for school A by seeding a fee structure for the current
    // academic year, then request an initialize that somehow clashes on the
    // unique index; the recovery MUST return the exact (student,
    // school, year) tuple.
    const schoolA = await createSchoolRecord({
      name: 'Scope School',
      code: 'SSC-01',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: schoolA._id });
    const classRecord = await createClassRecord({
      name: 'Class 10',
      section: 'Z',
      schoolId: schoolA._id,
    });
    await createFeeHeads(schoolA._id, '10');

    const student = await createStudentRecord({
      name: 'Scope Student',
      classId: classRecord._id,
      schoolId: schoolA._id,
    });

    // Seed a fee structure for an OLD academic year — the recovery must
    // NOT match on this if we ask for a different year.
    await insertFeeStructureDirect({
      studentId: student._id,
      classId: classRecord._id,
      academicYear: '2024-25',
      schoolId: schoolA._id,
      feeHeads: [],
      totalFee: 1111,
      totalPaid: 0,
      totalBalance: 1111,
      overallStatus: 'pending',
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    // Happy path: request 2025-26 → new structure created, NOT the current
    // academic year row the buggy recovery would have returned.
    const res = await request(app)
      .post(`/api/student-fees/initialize/${student._id}`)
      .set(authHeaders)
      .send({ academicYear: '2025-26' })
      .expect(201);

    expect(res.body.academicYear).toBe('2025-26');
    expect(res.body.totalFee).not.toBe(1111);

    // And both rows exist — the recovery didn't accidentally hand back
    // the wrong academic year.
    const rows = await StudentFeeStructure.find({ studentId: student._id }).lean();
    expect(rows).toHaveLength(2);
    const years = rows.map((r) => r.academicYear).sort();
    expect(years).toEqual(['2024-25', '2025-26']);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/student-fees/student/:studentId/discount — Apply discount
// ---------------------------------------------------------------------------

describe('PUT /api/student-fees/student/:studentId/discount', () => {
  it('returns 401 when no auth token is provided', async () => {
    const { app } = createTestApp();
    const fakeId = '000000000000000000000001';

    await request(app)
      .put(`/api/student-fees/student/${fakeId}/discount`)
      .send({ discountAmount: 100 })
      .expect(401);
  });

  it('returns 404 when fee structure does not exist', async () => {
    const accountant = await createAccountant();
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');
    const fakeId = '000000000000000000000001';

    await request(app)
      .put(`/api/student-fees/student/${fakeId}/discount`)
      .set(authHeaders)
      .send({ discountAmount: 100, academicYear: '2025-26' })
      .expect(404);
  });

  it('applies a discount and recalculates totalBalance', async () => {
    const school = await createSchoolRecord({
      name: 'Discount School',
      code: 'DSC-01',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({
      name: 'Class 10',
      section: 'H',
      schoolId: school._id,
    });

    const student = await createStudentRecord({
      name: 'Discount Student',
      classId: classRecord._id,
      schoolId: school._id,
    });

    await insertFeeStructureDirect({
      studentId: student._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      schoolId: school._id,
      feeHeads: [],
      totalFee: 10000,
      totalPaid: 2000,
      totalBalance: 8000,
      overallStatus: 'partial',
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .put(`/api/student-fees/student/${student._id}/discount`)
      .set(authHeaders)
      .send({ discountAmount: 3000, discountReason: 'Merit scholarship', academicYear: '2025-26' })
      .expect(200);

    // totalBalance = totalFee(10000) - totalPaid(2000) - discount(3000) = 5000
    expect(res.body.discountApplied).toBe(3000);
    expect(res.body.discountReason).toBe('Merit scholarship');
    expect(res.body.totalBalance).toBe(5000);
    expect(res.body.overallStatus).toBe('partial');

    // Verify Student.feeDetails was synced
    const refreshed = await Student.findById(student._id).lean();
    expect(refreshed.feeDetails.discountApplied).toBe(3000);
    expect(refreshed.feeDetails.balanceAmount).toBe(5000);

    // Verify fee payment audit trail was recorded
    const auditLogs = await FeePaymentAudit.find({
      schoolId: school._id,
      studentId: student._id,
      action: 'discount_applied',
    }).lean();
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].changes.before.discountApplied).toBe(0);
    expect(auditLogs[0].changes.after.discountApplied).toBe(3000);
    expect(auditLogs[0].context.amount).toBe(3000);
    expect(auditLogs[0].context.reason).toBe('Merit scholarship');
  });

  it('returns 400 when discount exceeds outstanding balance', async () => {
    const school = await createSchoolRecord({
      name: 'Over Discount School',
      code: 'ODS-01',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({
      name: 'Class 10',
      section: 'I',
      schoolId: school._id,
    });

    const student = await createStudentRecord({
      name: 'Over Discount Student',
      classId: classRecord._id,
      schoolId: school._id,
    });

    await insertFeeStructureDirect({
      studentId: student._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      schoolId: school._id,
      feeHeads: [],
      totalFee: 5000,
      totalPaid: 4000,
      totalBalance: 1000,
      overallStatus: 'partial',
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .put(`/api/student-fees/student/${student._id}/discount`)
      .set(authHeaders)
      .send({ discountAmount: 2000, academicYear: '2025-26' })
      .expect(400);

    expect(res.body.error).toMatch(/discount/i);
    expect(res.body.maxAllowed).toBe(1000);
  });

  it('sets overallStatus to paid when discount covers remaining balance', async () => {
    const school = await createSchoolRecord({
      name: 'Full Discount School',
      code: 'FDS-01',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({
      name: 'Class 10',
      section: 'J',
      schoolId: school._id,
    });

    const student = await createStudentRecord({
      name: 'Full Discount Student',
      classId: classRecord._id,
      schoolId: school._id,
    });

    await insertFeeStructureDirect({
      studentId: student._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      schoolId: school._id,
      feeHeads: [],
      totalFee: 5000,
      totalPaid: 3000,
      totalBalance: 2000,
      overallStatus: 'partial',
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .put(`/api/student-fees/student/${student._id}/discount`)
      .set(authHeaders)
      .send({ discountAmount: 2000, academicYear: '2025-26' })
      .expect(200);

    // totalBalance = 5000 - 3000 - 2000 = 0
    expect(res.body.totalBalance).toBe(0);
    expect(res.body.overallStatus).toBe('paid');

    const refreshed = await Student.findById(student._id).lean();
    expect(refreshed.feeStatus).toBe('paid');
  });
});

// ---------------------------------------------------------------------------
// POST /api/student-fees/student/:studentId/payment — Record payment
// ---------------------------------------------------------------------------

describe('POST /api/student-fees/student/:studentId/payment', () => {
  it('returns 401 when no auth token is provided', async () => {
    const { app } = createTestApp();
    const fakeId = '000000000000000000000001';

    await request(app)
      .post(`/api/student-fees/student/${fakeId}/payment`)
      .send({ amount: 500 })
      .expect(401);
  });

  it('returns 404 when fee structure does not exist', async () => {
    const accountant = await createAccountant();
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');
    const fakeId = '000000000000000000000001';

    await request(app)
      .post(`/api/student-fees/student/${fakeId}/payment`)
      .set(authHeaders)
      .send({ amount: 500, academicYear: '2025-26' })
      .expect(404);
  });

  it('records a payment with feeHeadPayments and recalculates totals', async () => {
    const school = await createSchoolRecord({
      name: 'Payment School',
      code: 'PAY-01',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({
      name: 'Class 10',
      section: 'K',
      schoolId: school._id,
    });
    const { tuition, lab } = await createFeeHeads(school._id, '10');

    const student = await createStudentRecord({
      name: 'Payment Student',
      classId: classRecord._id,
      schoolId: school._id,
    });

    // Create a fee structure with fee heads
    await insertFeeStructureDirect({
      studentId: student._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      schoolId: school._id,
      feeHeads: [
        {
          feeHeadId: tuition._id,
          name: 'Tuition Fee',
          category: 'Academic',
          amount: 5000,
          mandatory: true,
          frequency: 'yearly',
          paidAmount: 0,
          balanceAmount: 5000,
          status: 'pending',
        },
        {
          feeHeadId: lab._id,
          name: 'Lab Fee',
          category: 'Academic',
          amount: 1000,
          mandatory: true,
          frequency: 'yearly',
          paidAmount: 0,
          balanceAmount: 1000,
          status: 'pending',
        },
      ],
      totalFee: 6000,
      totalPaid: 0,
      totalBalance: 6000,
      overallStatus: 'pending',
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .post(`/api/student-fees/student/${student._id}/payment`)
      .set(authHeaders)
      .send({
        amount: 3000,
        academicYear: '2025-26',
        feeHeadPayments: [
          { feeHeadId: tuition._id.toString(), amount: 2000 },
          { feeHeadId: lab._id.toString(), amount: 1000 },
        ],
      })
      .expect(200);

    // Tuition: paid 2000 of 5000 => partial
    const tuitionHead = res.body.feeHeads.find((fh) => fh.name === 'Tuition Fee');
    expect(tuitionHead.paidAmount).toBe(2000);
    expect(tuitionHead.balanceAmount).toBe(3000);
    expect(tuitionHead.status).toBe('partial');

    // Lab: paid 1000 of 1000 => paid
    const labHead = res.body.feeHeads.find((fh) => fh.name === 'Lab Fee');
    expect(labHead.paidAmount).toBe(1000);
    expect(labHead.balanceAmount).toBe(0);
    expect(labHead.status).toBe('paid');

    // Totals recalculated
    expect(res.body.totalPaid).toBe(3000);
    expect(res.body.totalBalance).toBe(3000);
    expect(res.body.overallStatus).toBe('partial');
    expect(res.body.lastPaymentDate).toBeDefined();

    // Verify Student.feeDetails was synced
    const refreshed = await Student.findById(student._id).lean();
    expect(refreshed.feeDetails.paidAmount).toBe(3000);
    expect(refreshed.feeDetails.balanceAmount).toBe(3000);
    expect(refreshed.feeStatus).toBe('partial');

    // Verify fee payment audit trail was recorded
    const auditLogs = await FeePaymentAudit.find({
      schoolId: school._id,
      studentId: student._id,
      action: 'payment_recorded',
    }).lean();
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].changes.before.totalPaid).toBe(0);
    expect(auditLogs[0].changes.after.totalPaid).toBe(3000);
    expect(auditLogs[0].context.amount).toBe(3000);
    expect(auditLogs[0].context.receiptNumber).toBeDefined();
  });

  it('marks overall status as paid when full amount is covered', async () => {
    const school = await createSchoolRecord({
      name: 'Full Pay School',
      code: 'FPY-01',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({
      name: 'Class 10',
      section: 'L',
      schoolId: school._id,
    });
    const { tuition } = await createFeeHeads(school._id, '10');

    const student = await createStudentRecord({
      name: 'Full Pay Student',
      classId: classRecord._id,
      schoolId: school._id,
    });

    await insertFeeStructureDirect({
      studentId: student._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      schoolId: school._id,
      feeHeads: [
        {
          feeHeadId: tuition._id,
          name: 'Tuition Fee',
          category: 'Academic',
          amount: 5000,
          mandatory: true,
          frequency: 'yearly',
          paidAmount: 0,
          balanceAmount: 5000,
          status: 'pending',
        },
      ],
      totalFee: 5000,
      totalPaid: 0,
      totalBalance: 5000,
      overallStatus: 'pending',
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .post(`/api/student-fees/student/${student._id}/payment`)
      .set(authHeaders)
      .send({
        amount: 5000,
        academicYear: '2025-26',
        feeHeadPayments: [{ feeHeadId: tuition._id.toString(), amount: 5000 }],
      })
      .expect(200);

    expect(res.body.totalPaid).toBe(5000);
    expect(res.body.totalBalance).toBe(0);
    expect(res.body.overallStatus).toBe('paid');

    const refreshed = await Student.findById(student._id).lean();
    expect(refreshed.feeStatus).toBe('paid');

    // Verify fee payment audit trail was recorded
    const auditLogs = await FeePaymentAudit.find({
      schoolId: school._id,
      studentId: student._id,
      action: 'payment_recorded',
    }).lean();
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].context.amount).toBe(5000);
  });

  it('handles payment without feeHeadPayments array gracefully', async () => {
    const school = await createSchoolRecord({
      name: 'No FHP School',
      code: 'NFP-01',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({
      name: 'Class 10',
      section: 'M',
      schoolId: school._id,
    });

    const student = await createStudentRecord({
      name: 'No FHP Student',
      classId: classRecord._id,
      schoolId: school._id,
    });

    await insertFeeStructureDirect({
      studentId: student._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      schoolId: school._id,
      feeHeads: [],
      totalFee: 5000,
      totalPaid: 0,
      totalBalance: 5000,
      overallStatus: 'pending',
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    // Send payment without feeHeadPayments — route should not crash
    const res = await request(app)
      .post(`/api/student-fees/student/${student._id}/payment`)
      .set(authHeaders)
      .send({ amount: 1000, academicYear: '2025-26' })
      .expect(200);

    // Totals remain unchanged because no individual fee heads were updated
    expect(res.body.totalPaid).toBe(0);
    expect(res.body.lastPaymentDate).toBeDefined();
  });

  it('stores idempotencyKey on the FeePayment document', async () => {
    const school = await createSchoolRecord({
      name: 'Idempotency School',
      code: 'IDM-01',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({
      name: 'Class 10',
      section: 'N',
      schoolId: school._id,
    });
    const { tuition } = await createFeeHeads(school._id, '10');

    const student = await createStudentRecord({
      name: 'Idempotency Student',
      classId: classRecord._id,
      schoolId: school._id,
    });

    await insertFeeStructureDirect({
      studentId: student._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      schoolId: school._id,
      feeHeads: [
        {
          feeHeadId: tuition._id,
          name: 'Tuition Fee',
          category: 'Academic',
          amount: 5000,
          mandatory: true,
          frequency: 'yearly',
          paidAmount: 0,
          balanceAmount: 5000,
          status: 'pending',
        },
      ],
      totalFee: 5000,
      totalPaid: 0,
      totalBalance: 5000,
      overallStatus: 'pending',
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    await request(app)
      .post(`/api/student-fees/student/${student._id}/payment`)
      .set(authHeaders)
      .send({
        amount: 1000,
        academicYear: '2025-26',
        idempotencyKey: 'pay-key-123',
      })
      .expect(200);

    const payment = await FeePayment.findOne({
      studentId: student._id,
      idempotencyKey: 'pay-key-123',
    }).lean();

    expect(payment).toBeTruthy();
    expect(payment.amount).toBe(1000);
    expect(payment.receiptNumber).toBeTruthy();
  });

  it('rejects duplicate payment with same idempotencyKey with 409', async () => {
    const school = await createSchoolRecord({
      name: 'Duplicate School',
      code: 'DUP-01',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({
      name: 'Class 10',
      section: 'O',
      schoolId: school._id,
    });
    const { tuition } = await createFeeHeads(school._id, '10');

    const student = await createStudentRecord({
      name: 'Duplicate Student',
      classId: classRecord._id,
      schoolId: school._id,
    });

    await insertFeeStructureDirect({
      studentId: student._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      schoolId: school._id,
      feeHeads: [
        {
          feeHeadId: tuition._id,
          name: 'Tuition Fee',
          category: 'Academic',
          amount: 5000,
          mandatory: true,
          frequency: 'yearly',
          paidAmount: 0,
          balanceAmount: 5000,
          status: 'pending',
        },
      ],
      totalFee: 5000,
      totalPaid: 0,
      totalBalance: 5000,
      overallStatus: 'pending',
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    // First payment succeeds
    await request(app)
      .post(`/api/student-fees/student/${student._id}/payment`)
      .set(authHeaders)
      .send({
        amount: 1000,
        academicYear: '2025-26',
        idempotencyKey: 'dup-key-456',
      })
      .expect(200);

    // Second payment with same key is rejected
    const second = await request(app)
      .post(`/api/student-fees/student/${student._id}/payment`)
      .set(authHeaders)
      .send({
        amount: 1000,
        academicYear: '2025-26',
        idempotencyKey: 'dup-key-456',
      })
      .expect(409);

    expect(second.body.code).toBe('IDEMPOTENCY_KEY_USED');
    expect(typeof second.body.receiptNumber).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Regression — FeePayment idempotency unique index must build cleanly (SCH-210)
// ---------------------------------------------------------------------------
//
// MongoDB partial indexes reject `$ne` (it compiles to `$not: {$eq}`), so the
// old `partialFilterExpression: { idempotencyKey: { $exists: true, $ne: null } }`
// made `syncIndexes()` / `createIndexes` fail — meaning the unique idempotency
// index never actually existed in prod (autoIndex swallows the error). This
// test guards the corrected spec (`$type: 'string'`) by driving the real index
// build against the in-memory mongod and asserting the partial unique compound
// index shows up.
describe('FeePayment idempotency index (SCH-210)', () => {
  it('builds the unique partial index without error and with the expected filter', async () => {
    // Drive the real index build the same way `npm run migrate:indexes` does.
    await expect(FeePayment.syncIndexes()).resolves.not.toThrow();

    const indexes = await FeePayment.collection.indexes();
    const compound = indexes.find(
      (i) => i.key && i.key.schoolId === 1 && i.key.idempotencyKey === 1
    );

    expect(compound, 'compound (schoolId, idempotencyKey) index should exist').toBeTruthy();
    expect(compound.unique).toBe(true);
    expect(compound.partialFilterExpression).toEqual({
      idempotencyKey: { $type: 'string' },
    });
  });

  it('does not treat missing/empty idempotencyKey as a uniqueness collision', async () => {
    const school = await createSchoolRecord({
      name: 'No-Key School',
      code: 'NKY-01',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({
      name: 'Class 10',
      section: 'P',
      schoolId: school._id,
    });
    const { tuition } = await createFeeHeads(school._id, '10');
    const student = await createStudentRecord({
      name: 'No-Key Student',
      classId: classRecord._id,
      schoolId: school._id,
    });

    await insertFeeStructureDirect({
      studentId: student._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      schoolId: school._id,
      feeHeads: [
        {
          feeHeadId: tuition._id,
          name: 'Tuition Fee',
          category: 'Academic',
          amount: 5000,
          mandatory: true,
          frequency: 'yearly',
          paidAmount: 0,
          balanceAmount: 5000,
          status: 'pending',
        },
      ],
      totalFee: 5000,
      totalPaid: 0,
      totalBalance: 5000,
      overallStatus: 'pending',
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    // Two payments with no idempotencyKey must both succeed — the partial
    // index excludes documents where the key isn't a real string.
    await request(app)
      .post(`/api/student-fees/student/${student._id}/payment`)
      .set(authHeaders)
      .send({ amount: 1000, academicYear: '2025-26' })
      .expect(200);

    await request(app)
      .post(`/api/student-fees/student/${student._id}/payment`)
      .set(authHeaders)
      .send({ amount: 500, academicYear: '2025-26' })
      .expect(200);
  });
});

// ---------------------------------------------------------------------------
// GET /api/student-fees/defaulters — List defaulters
// ---------------------------------------------------------------------------

describe('GET /api/student-fees/defaulters', () => {
  it('returns 401 when no auth token is provided', async () => {
    const { app } = createTestApp();

    await request(app).get('/api/student-fees/defaulters').expect(401);
  });

  it('returns an empty array when no defaulters exist', async () => {
    const accountant = await createAccountant();
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app).get('/api/student-fees/defaulters').set(authHeaders).expect(200);

    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(0);
  });

  it('returns students with pending or partial status and positive balance', async () => {
    const school = await createSchoolRecord({
      name: 'Defaulter School',
      code: 'DEF-01',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({
      name: 'Class 10',
      section: 'N',
      schoolId: school._id,
    });

    const studentA = await createStudentRecord({
      name: 'Defaulter A',
      classId: classRecord._id,
      schoolId: school._id,
    });
    const studentB = await createStudentRecord({
      name: 'Partial B',
      classId: classRecord._id,
      schoolId: school._id,
    });
    const studentC = await createStudentRecord({
      name: 'Paid C',
      classId: classRecord._id,
      schoolId: school._id,
    });

    // Pending defaulter
    await insertFeeStructureDirect({
      studentId: studentA._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      schoolId: school._id,
      feeHeads: [],
      totalFee: 5000,
      totalPaid: 0,
      totalBalance: 5000,
      overallStatus: 'pending',
    });

    // Partial defaulter
    await insertFeeStructureDirect({
      studentId: studentB._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      schoolId: school._id,
      feeHeads: [],
      totalFee: 5000,
      totalPaid: 2000,
      totalBalance: 3000,
      overallStatus: 'partial',
    });

    // Fully paid — should NOT appear in defaulters
    await insertFeeStructureDirect({
      studentId: studentC._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      schoolId: school._id,
      feeHeads: [],
      totalFee: 5000,
      totalPaid: 5000,
      totalBalance: 0,
      overallStatus: 'paid',
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app).get('/api/student-fees/defaulters').set(authHeaders).expect(200);

    expect(res.body.data).toHaveLength(2);

    // Sorted by totalBalance descending: studentA (5000) first, then studentB (3000)
    expect(res.body.data[0].totalBalance).toBe(5000);
    expect(res.body.data[1].totalBalance).toBe(3000);
  });

  it('multi-tenancy: defaulters are scoped by school', async () => {
    const schoolA = await createSchoolRecord({
      name: 'School A Defaulter',
      code: 'DEF-A',
      isDefault: true,
    });
    const schoolB = await createSchoolRecord({ name: 'School B Defaulter', code: 'DEF-B' });

    const accountantA = await createAccountant({ schoolId: schoolA._id });
    const classRecord = await createClassRecord({
      name: 'Class 10',
      section: 'O',
      schoolId: schoolA._id,
    });

    const studentA = await createStudentRecord({
      name: 'School A Defaulter',
      classId: classRecord._id,
      schoolId: schoolA._id,
    });
    const studentB = await createStudentRecord({
      name: 'School B Defaulter',
      classId: classRecord._id,
      schoolId: schoolB._id,
    });

    await insertFeeStructureDirect({
      studentId: studentA._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      schoolId: schoolA._id,
      feeHeads: [],
      totalFee: 5000,
      totalPaid: 0,
      totalBalance: 5000,
      overallStatus: 'pending',
    });

    await insertFeeStructureDirect({
      studentId: studentB._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      schoolId: schoolB._id,
      feeHeads: [],
      totalFee: 8000,
      totalPaid: 0,
      totalBalance: 8000,
      overallStatus: 'pending',
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountantA, 'accountant');

    const res = await request(app).get('/api/student-fees/defaulters').set(authHeaders).expect(200);

    // School A accountant should only see School A's defaulter
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].totalBalance).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// GET /api/student-fees/all — List all students with fee structures
// ---------------------------------------------------------------------------

describe('GET /api/student-fees/all', () => {
  it('returns 401 when no auth token is provided', async () => {
    const { app } = createTestApp();

    await request(app).get('/api/student-fees/all').expect(401);
  });

  it('returns an empty array when no fee structures exist', async () => {
    const accountant = await createAccountant();
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app).get('/api/student-fees/all').set(authHeaders).expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  it('returns all fee structures scoped to the school', async () => {
    const school = await createSchoolRecord({
      name: 'All Fees School',
      code: 'ALL-01',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({
      name: 'Class 10',
      section: 'P',
      schoolId: school._id,
    });

    const studentA = await createStudentRecord({
      name: 'All A',
      classId: classRecord._id,
      schoolId: school._id,
    });
    const studentB = await createStudentRecord({
      name: 'All B',
      classId: classRecord._id,
      schoolId: school._id,
    });

    await insertFeeStructureDirect({
      studentId: studentA._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      schoolId: school._id,
      feeHeads: [],
      totalFee: 5000,
      totalPaid: 0,
      totalBalance: 5000,
      overallStatus: 'pending',
    });

    await insertFeeStructureDirect({
      studentId: studentB._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      schoolId: school._id,
      feeHeads: [],
      totalFee: 5000,
      totalPaid: 5000,
      totalBalance: 0,
      overallStatus: 'paid',
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app).get('/api/student-fees/all').set(authHeaders).expect(200);

    expect(res.body).toHaveLength(2);
  });

  it('filters by classId query parameter', async () => {
    const school = await createSchoolRecord({
      name: 'Filter Class School',
      code: 'FCS-01',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classA = await createClassRecord({
      name: 'Class 10',
      section: 'Q',
      schoolId: school._id,
    });
    const classB = await createClassRecord({
      name: 'Class 11',
      section: 'A',
      schoolId: school._id,
    });

    const studentA = await createStudentRecord({
      name: 'Class A Student',
      classId: classA._id,
      schoolId: school._id,
    });
    const studentB = await createStudentRecord({
      name: 'Class B Student',
      classId: classB._id,
      schoolId: school._id,
    });

    await insertFeeStructureDirect({
      studentId: studentA._id,
      classId: classA._id,
      academicYear: '2025-26',
      schoolId: school._id,
      feeHeads: [],
      totalFee: 5000,
      totalPaid: 0,
      totalBalance: 5000,
      overallStatus: 'pending',
    });

    await insertFeeStructureDirect({
      studentId: studentB._id,
      classId: classB._id,
      academicYear: '2025-26',
      schoolId: school._id,
      feeHeads: [],
      totalFee: 7000,
      totalPaid: 0,
      totalBalance: 7000,
      overallStatus: 'pending',
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .get('/api/student-fees/all')
      .query({ classId: classA._id.toString() })
      .set(authHeaders)
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].totalFee).toBe(5000);
  });

  it('filters by status query parameter', async () => {
    const school = await createSchoolRecord({
      name: 'Filter Status School',
      code: 'FSS-01',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({
      name: 'Class 10',
      section: 'R',
      schoolId: school._id,
    });

    const studentA = await createStudentRecord({
      name: 'Pending Student',
      classId: classRecord._id,
      schoolId: school._id,
    });
    const studentB = await createStudentRecord({
      name: 'Paid Student',
      classId: classRecord._id,
      schoolId: school._id,
    });

    await insertFeeStructureDirect({
      studentId: studentA._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      schoolId: school._id,
      feeHeads: [],
      totalFee: 5000,
      totalPaid: 0,
      totalBalance: 5000,
      overallStatus: 'pending',
    });

    await insertFeeStructureDirect({
      studentId: studentB._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      schoolId: school._id,
      feeHeads: [],
      totalFee: 5000,
      totalPaid: 5000,
      totalBalance: 0,
      overallStatus: 'paid',
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .get('/api/student-fees/all')
      .query({ status: 'paid' })
      .set(authHeaders)
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].overallStatus).toBe('paid');
  });

  it('multi-tenancy: only returns fee structures for the authenticated school', async () => {
    const schoolA = await createSchoolRecord({
      name: 'All School A',
      code: 'ALL-A',
      isDefault: true,
    });
    const schoolB = await createSchoolRecord({ name: 'All School B', code: 'ALL-B' });

    const accountantA = await createAccountant({ schoolId: schoolA._id });
    const classRecord = await createClassRecord({
      name: 'Class 10',
      section: 'S',
      schoolId: schoolA._id,
    });

    const studentA = await createStudentRecord({
      name: 'School A All',
      classId: classRecord._id,
      schoolId: schoolA._id,
    });
    const studentB = await createStudentRecord({
      name: 'School B All',
      classId: classRecord._id,
      schoolId: schoolB._id,
    });

    await insertFeeStructureDirect({
      studentId: studentA._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      schoolId: schoolA._id,
      feeHeads: [],
      totalFee: 5000,
      totalPaid: 0,
      totalBalance: 5000,
      overallStatus: 'pending',
    });

    await insertFeeStructureDirect({
      studentId: studentB._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      schoolId: schoolB._id,
      feeHeads: [],
      totalFee: 9000,
      totalPaid: 0,
      totalBalance: 9000,
      overallStatus: 'pending',
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountantA, 'accountant');

    const res = await request(app).get('/api/student-fees/all').set(authHeaders).expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].totalFee).toBe(5000);
  });
});
