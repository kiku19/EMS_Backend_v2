import mongoose from 'mongoose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Counter, FeePayment, FeeRefund, Student, StudentFeeStructure } from '../database.js';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Build a well-formed POST body for POST /api/fees/payments.
function validPaymentBody(studentId, classId, overrides = {}) {
  return {
    studentId: studentId.toString(),
    studentName: 'Fee Student',
    classId: classId.toString(),
    academicYear: '2025-26',
    paymentDate: '2026-03-06',
    amount: 500,
    paymentMode: 'cash',
    remarks: 'Test payment',
    ...overrides,
  };
}

// Create a staff user with the accountant permission role.
async function createAccountant(opts = {}) {
  return createStaffUser({
    name: 'Accounts User',
    staffRole: ['Accountant'],
    permissionRole: 'accountant',
    ...opts,
  });
}

// POST a payment through the API and return the response body.
async function seedPayment(app, accountant, student, classRecord, overrides = {}) {
  const authHeaders = authHeadersFor(accountant, 'accountant');
  const res = await request(app)
    .post('/api/fees/payments')
    .set(authHeaders)
    .send(validPaymentBody(student._id, classRecord._id, overrides))
    .expect(201);
  return res.body;
}

// Insert a FeePayment directly into MongoDB bypassing Mongoose strict-schema
// validation. Used to pre-seed payments in tests that exercise GET/PUT/DELETE
// routes, where we need the schoolId to be persisted alongside the document.
//
// schoolId is stored as a proper ObjectId because feePaymentSchema declares
// the field as { type: ObjectId }. Mongoose auto-casts string query filters
// to ObjectId when the schema says so, so the query filter ends up as
// ObjectId("..."). If we stored a plain string here MongoDB would never match
// it against an ObjectId query — hence the explicit cast below.
// Seed a StudentFeeStructure so POST /payments passes the EXCEEDS_BALANCE
// guard. The route's auto-init only populates totalFee when a matching FeeHead
// exists for the class — tests that don't seed FeeHeads need an explicit
// structure row with a nonzero totalBalance.
async function seedStudentFeeStructure({ studentId, classId, schoolId, totalFee = 1000 }) {
  return StudentFeeStructure.create({
    studentId,
    classId,
    academicYear: '2025-26',
    schoolId,
    feeHeads: [],
    totalFee,
    totalPaid: 0,
    totalBalance: totalFee,
    overallStatus: 'pending',
  });
}

async function insertPaymentDirect(fields) {
  const { schoolId, ...rest } = fields;
  const result = await FeePayment.collection.insertOne({
    academicYear: '2025-26',
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
    // Store schoolId as ObjectId so it matches Mongoose's ObjectId query filter.
    ...(schoolId != null ? { schoolId: new mongoose.Types.ObjectId(schoolId.toString()) } : {}),
    receiptNumber: rest.receiptNumber || `RCP-DIRECT-${Date.now()}-${Math.random()}`,
  });
  return result.insertedId;
}

// ---------------------------------------------------------------------------
// Background: auth middleware + schoolId resolution
// ---------------------------------------------------------------------------
//
// The authenticate middleware calls ensureDocumentSchool for staff whose JWT
// token contains schoolId: null.  This lazily creates a default School record,
// assigns it to the staff document, and puts its _id on req.user.schoolId.
//
// As a result req.user.schoolId is ALWAYS a non-null ObjectId string for any
// regular staff user — it is never null after the middleware runs.
//
// The fees route's scopeBySchool helper then appends { schoolId: <that id> }
// to every query.  extractSchoolId always returns a string, so the filter
// value is a string — but because feePaymentSchema defines schoolId as ObjectId
// Mongoose auto-casts it to ObjectId before sending to MongoDB.
//
// Tests that need to verify GET behaviour for an existing payment use
// insertPaymentDirect (above) which stores schoolId as a real ObjectId so
// that the scoped query finds the document.

// ---------------------------------------------------------------------------
// POST /api/fees/payments — Create payment
// ---------------------------------------------------------------------------

describe('POST /api/fees/payments', () => {
  it('creates a payment record and updates the student fee totals', async () => {
    // Pre-create the default school so ensureDefaultSchool returns a known
    // record and the accountant's resolved schoolId matches the student's.
    const school = await createSchoolRecord({
      name: 'Test School',
      code: 'TST-MAIN',
      isDefault: true,
    });

    const accountant = await createAccountant({
      email: 'accounts@example.com',
      schoolId: school._id,
    });

    const classRecord = await createClassRecord({
      name: 'Class 9',
      section: 'A',
      schoolId: school._id,
    });

    const student = await createStudentRecord({
      name: 'Fee Student',
      admissionId: 'ADM9002',
      classId: classRecord._id,
      feeDetails: {
        totalFee: 1200,
        totalPaid: 0,
        totalPending: 1200,
      },
    });

    // Scope the student to the same school so the route can find it when
    // updating fee totals.
    await Student.findByIdAndUpdate(student._id, { schoolId: school._id });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const paymentResponse = await request(app).post('/api/fees/payments').set(authHeaders).send({
      studentId: student._id.toString(),
      studentName: student.name,
      classId: classRecord._id.toString(),
      academicYear: '2025-26',
      paymentDate: '2026-03-06',
      amount: 500,
      paymentMode: 'cash',
      remarks: 'Partial payment',
    });

    expect(paymentResponse.status, JSON.stringify(paymentResponse.body)).toBe(201);

    expect(paymentResponse.body.status).toBe('completed');
    expect(paymentResponse.body.receiptNumber).toMatch(/^RCP-/);

    const savedPayment = await FeePayment.findById(paymentResponse.body._id).lean();
    const refreshedStudent = await Student.findById(student._id).lean();

    expect(savedPayment.amount).toBe(500);
    expect(refreshedStudent.feeDetails.paidAmount).toBe(500);
    expect(refreshedStudent.feeDetails.balanceAmount).toBe(700);
    expect(refreshedStudent.feeStatus).toBe('partial');
  });

  it('returns 401 when no auth token is provided', async () => {
    const classRecord = await createClassRecord({ name: 'Class 9', section: 'B' });
    const student = await createStudentRecord({
      name: 'Unauth Student',
      classId: classRecord._id,
    });
    const { app } = createTestApp();

    await request(app)
      .post('/api/fees/payments')
      .send(validPaymentBody(student._id, classRecord._id))
      .expect(401);
  });

  it('returns 400 when studentId is missing (Zod validation)', async () => {
    // The Zod schema requires studentId, so the validation middleware
    // rejects the request with 400 before it reaches the route handler.
    const accountant = await createAccountant();
    const classRecord = await createClassRecord({ name: 'Class 9', section: 'C' });
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app).post('/api/fees/payments').set(authHeaders).send({
      // studentId intentionally omitted
      classId: classRecord._id.toString(),
      academicYear: '2025-26',
      paymentDate: '2026-03-06',
      amount: 300,
      paymentMode: 'cash',
    });

    expect(res.status).toBe(400);
  });

  it('rejects a payment when studentId does not exist', async () => {
    const accountant = await createAccountant();
    const classRecord = await createClassRecord({ name: 'Class 10', section: 'A' });
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const fakeStudentId = '000000000000000000000001';

    const res = await request(app)
      .post('/api/fees/payments')
      .set(authHeaders)
      .send(validPaymentBody(fakeStudentId, classRecord._id))
      .expect(404);

    expect(res.body.error).toMatch(/student not found/i);
    expect(await FeePayment.countDocuments({})).toBe(0);
  });

  it('returns 400 when amount is missing (Zod validation)', async () => {
    // The Zod schema requires amount, so the validation middleware
    // rejects the request with 400 before it reaches the route handler.
    const accountant = await createAccountant();
    const classRecord = await createClassRecord({ name: 'Class 10', section: 'B' });
    const student = await createStudentRecord({
      name: 'No Amount Student',
      rollNo: 2,
      classId: classRecord._id,
    });
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app).post('/api/fees/payments').set(authHeaders).send({
      studentId: student._id.toString(),
      classId: classRecord._id.toString(),
      academicYear: '2025-26',
      paymentDate: '2026-03-06',
      // amount intentionally omitted
      paymentMode: 'cash',
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 when amount is 0 (Zod enforces min 1)', async () => {
    // The Zod schema enforces amount >= 1, so a zero amount is rejected.
    const accountant = await createAccountant();
    const classRecord = await createClassRecord({ name: 'Class 10', section: 'C' });
    const student = await createStudentRecord({
      name: 'Zero Amount Student',
      rollNo: 3,
      classId: classRecord._id,
    });
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .post('/api/fees/payments')
      .set(authHeaders)
      .send(validPaymentBody(student._id, classRecord._id, { amount: 0 }));

    expect(res.status).toBe(400);
  });

  it('auto-generates a receipt number when none is supplied', async () => {
    const accountant = await createAccountant();
    const classRecord = await createClassRecord({ name: 'Class 11', section: 'A' });
    const student = await createStudentRecord({
      name: 'Auto Receipt Student',
      rollNo: 4,
      classId: classRecord._id,
      feeDetails: { totalFee: 1000, paidAmount: 0, balanceAmount: 1000 },
    });
    await seedStudentFeeStructure({
      studentId: student._id,
      classId: classRecord._id,
      schoolId: student.schoolId,
    });
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .post('/api/fees/payments')
      .set(authHeaders)
      .send(validPaymentBody(student._id, classRecord._id))
      .expect(201);

    expect(res.body.receiptNumber).toMatch(/^RCP-\d{4}-\d+$/);
  });

  it('rejects client-supplied receipt numbers', async () => {
    const accountant = await createAccountant();
    const classRecord = await createClassRecord({ name: 'Class 11', section: 'B' });
    const student = await createStudentRecord({
      name: 'Custom Receipt Student',
      rollNo: 5,
      classId: classRecord._id,
      feeDetails: { totalFee: 1000, paidAmount: 0, balanceAmount: 1000 },
    });
    await seedStudentFeeStructure({
      studentId: student._id,
      classId: classRecord._id,
      schoolId: student.schoolId,
    });
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .post('/api/fees/payments')
      .set(authHeaders)
      .send(validPaymentBody(student._id, classRecord._id, { receiptNumber: 'RCP-CUSTOM-001' }))
      .expect(400);

    expect(res.body.details?.some((item) => item.field === '')).toBe(true);
    expect(await FeePayment.countDocuments({ studentId: student._id })).toBe(0);
  });

  it('self-heals when the receipt counter is behind existing receipts (no false "concurrent" 409)', async () => {
    // Reproduces the user's bug: a payment recorded out-of-band (manual insert,
    // restore, or test seed) occupies a receipt number the counter would
    // generate. Before the fix this made EVERY subsequent payment fail with
    // "A payment was already recorded concurrently". The self-healing
    // generator must fast-forward the counter past the existing receipt.
    const accountant = await createAccountant();
    const classRecord = await createClassRecord({ name: 'Class 12', section: 'C' });
    const student = await createStudentRecord({
      name: 'Self Heal Student',
      rollNo: 9,
      classId: classRecord._id,
      feeDetails: { totalFee: 5000, paidAmount: 0, balanceAmount: 5000 },
    });
    await seedStudentFeeStructure({
      studentId: student._id,
      classId: classRecord._id,
      schoolId: student.schoolId,
    });
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');
    const schoolId = accountant.schoolId;
    const year = new Date().getFullYear();

    // Pre-occupy receipt numbers that the counter will reach.
    // Force the counter to seq=0 so the next generation would be seq=1.
    await Counter.findByIdAndUpdate(
      `receiptNumber_${schoolId}`,
      { $set: { seq: 0 } },
      { upsert: true, new: true }
    );
    // Insert receipts for seq 1..3 directly (simulating out-of-band data).
    for (const seq of [1, 2, 3]) {
      await FeePayment.create({
        schoolId,
        studentId: student._id,
        classId: classRecord._id,
        academicYear: CURRENT_ACADEMIC_YEAR,
        receiptNumber: `RCP-${year}-${String(seq).padStart(6, '0')}`,
        paymentDate: new Date().toISOString().split('T')[0],
        amount: 100,
        paymentMode: 'cash',
        status: 'completed',
        feeHeads: [],
      });
    }

    // Now record a new payment. The counter would generate RCP-{year}-000001
    // and collide — the self-healing path must skip ahead to 000004.
    const res = await request(app)
      .post('/api/fees/payments')
      .set(authHeaders)
      .send(validPaymentBody(student._id, classRecord._id, { amount: 500 }))
      .expect(201);

    expect(res.body.receiptNumber).toBe(`RCP-${year}-000004`);
    // And the counter must have advanced so the NEXT payment doesn't recollide.
    const counterAfter = await Counter.findById(`receiptNumber_${schoolId}`);
    expect(counterAfter.seq).toBeGreaterThanOrEqual(4);
  });

  it('marks student feeStatus as paid when payment covers the full fee balance', async () => {
    const school = await createSchoolRecord({
      name: 'Paid Status School',
      code: 'TST-PAID',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({
      name: 'Class 12',
      section: 'A',
      schoolId: school._id,
    });
    const student = await createStudentRecord({
      name: 'Full Pay Student',
      classId: classRecord._id,
      feeDetails: { totalFee: 1000, paidAmount: 0, balanceAmount: 1000 },
    });
    await Student.findByIdAndUpdate(student._id, { schoolId: school._id });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    await request(app)
      .post('/api/fees/payments')
      .set(authHeaders)
      .send(validPaymentBody(student._id, classRecord._id, { amount: 1000 }))
      .expect(201);

    const refreshed = await Student.findById(student._id).lean();
    expect(refreshed.feeDetails.paidAmount).toBe(1000);
    expect(refreshed.feeDetails.balanceAmount).toBe(0);
    expect(refreshed.feeStatus).toBe('paid');
  });

  it('multi-tenancy: rejects a payment for a student belonging to a different school', async () => {
    const schoolA = await createSchoolRecord({
      name: 'School A',
      code: 'SCH-A-MT',
      isDefault: true,
    });
    const schoolB = await createSchoolRecord({ name: 'School B', code: 'SCH-B-MT' });

    const accountantA = await createAccountant({ schoolId: schoolA._id });
    const classRecord = await createClassRecord({
      name: 'Class 8',
      section: 'A',
      schoolId: schoolB._id,
    });

    const studentB = await createStudentRecord({
      name: 'School B Student',
      classId: classRecord._id,
      feeDetails: { totalFee: 800, paidAmount: 0, balanceAmount: 800 },
    });
    // Explicitly scope the student to School B only.
    await Student.findByIdAndUpdate(studentB._id, { schoolId: schoolB._id });

    const { app } = createTestApp();
    const authHeadersA = authHeadersFor(accountantA, 'accountant');

    const res = await request(app)
      .post('/api/fees/payments')
      .set(authHeadersA)
      .send(validPaymentBody(studentB._id, classRecord._id, { amount: 200 }))
      .expect(404);

    expect(res.body.error).toMatch(/student not found/i);
    expect(await FeePayment.countDocuments({ schoolId: schoolA._id })).toBe(0);

    // School B's student fee totals were NOT updated because the scoped
    // student lookup returned null.
    const unchangedStudent = await Student.findById(studentB._id).lean();
    expect(unchangedStudent.feeDetails.paidAmount ?? 0).toBe(0);
  });

  it('rejects collector impersonation and derives collectedBy for valid requests', async () => {
    const accountant = await createAccountant();
    const otherStaff = await createAccountant({ email: 'other-accountant@example.com' });
    const classRecord = await createClassRecord({ name: 'Class 7', section: 'A' });
    const student = await createStudentRecord({
      name: 'Collector Test Student',
      classId: classRecord._id,
      feeDetails: { totalFee: 1000, paidAmount: 0, balanceAmount: 1000 },
    });
    const { app } = createTestApp();

    await request(app)
      .post('/api/fees/payments')
      .set(authHeadersFor(accountant, 'accountant'))
      .send(
        validPaymentBody(student._id, classRecord._id, {
          collectedBy: otherStaff._id.toString(),
          idempotencyKey: 'collector-test-001',
        })
      )
      .expect(400);

    const response = await request(app)
      .post('/api/fees/payments')
      .set(authHeadersFor(accountant, 'accountant'))
      .send(
        validPaymentBody(student._id, classRecord._id, {
          idempotencyKey: 'collector-test-001',
        })
      )
      .expect(201);

    const saved = await FeePayment.findById(response.body._id).lean();
    expect(saved.collectedBy.toString()).toBe(accountant._id.toString());
  });

  it('uses idempotency keys to prevent duplicate ledger and balance updates', async () => {
    const accountant = await createAccountant();
    const classRecord = await createClassRecord({ name: 'Class 7', section: 'B' });
    const student = await createStudentRecord({
      name: 'Idempotent Student',
      classId: classRecord._id,
      feeDetails: { totalFee: 1000, paidAmount: 0, balanceAmount: 1000 },
    });
    const { app } = createTestApp();
    const headers = authHeadersFor(accountant, 'accountant');
    const body = validPaymentBody(student._id, classRecord._id, {
      idempotencyKey: 'payment-retry-001',
    });

    await request(app).post('/api/fees/payments').set(headers).send(body).expect(201);
    const duplicate = await request(app)
      .post('/api/fees/payments')
      .set(headers)
      .send(body)
      .expect(409);

    expect(duplicate.body.code).toBe('IDEMPOTENCY_KEY_USED');
    expect(await FeePayment.countDocuments({ idempotencyKey: 'payment-retry-001' })).toBe(1);
    const feeStructure = await StudentFeeStructure.findOne({ studentId: student._id }).lean();
    expect(feeStructure.totalPaid).toBe(500);
  });

  it('automatically distributes aggregate payments across outstanding fee heads', async () => {
    const accountant = await createAccountant();
    const classRecord = await createClassRecord({ name: 'Class 7', section: 'C' });
    const student = await createStudentRecord({
      name: 'Distribution Student',
      classId: classRecord._id,
      feeDetails: { totalFee: 1000, paidAmount: 0, balanceAmount: 1000 },
    });
    await StudentFeeStructure.create({
      schoolId: student.schoolId,
      studentId: student._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      feeHeads: [
        {
          feeHeadId: new mongoose.Types.ObjectId(),
          name: 'Tuition',
          amount: 300,
          paidAmount: 0,
          balanceAmount: 300,
        },
        {
          feeHeadId: new mongoose.Types.ObjectId(),
          name: 'Activities',
          amount: 700,
          paidAmount: 0,
          balanceAmount: 700,
        },
      ],
      totalFee: 1000,
      totalPaid: 0,
      totalBalance: 1000,
    });
    const { app } = createTestApp();

    const response = await request(app)
      .post('/api/fees/payments')
      .set(authHeadersFor(accountant, 'accountant'))
      .send(
        validPaymentBody(student._id, classRecord._id, {
          amount: 500,
          feeHeads: [],
          idempotencyKey: 'aggregate-payment-001',
        })
      )
      .expect(201);

    const structure = await StudentFeeStructure.findOne({ studentId: student._id }).lean();
    expect(structure.feeHeads[0].paidAmount).toBe(300);
    expect(structure.feeHeads[1].paidAmount).toBe(200);
    expect(response.body.feeHeads.map((head) => head.amount)).toEqual([300, 200]);
  });

  it('tracks installment payments without losing the fee-head allocation', async () => {
    const accountant = await createAccountant();
    const classRecord = await createClassRecord({ name: 'Class 7', section: 'D' });
    const student = await createStudentRecord({
      name: 'Installment Student',
      classId: classRecord._id,
      feeDetails: { totalFee: 1000, paidAmount: 0, balanceAmount: 1000 },
    });
    await StudentFeeStructure.create({
      schoolId: student.schoolId,
      studentId: student._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      feeHeads: [
        {
          feeHeadId: new mongoose.Types.ObjectId(),
          name: 'Tuition',
          amount: 1000,
          paidAmount: 0,
          balanceAmount: 1000,
        },
      ],
      installments: [
        {
          name: 'Term 1',
          dueDate: new Date('2025-04-15'),
          amount: 500,
          paidAmount: 0,
          balanceAmount: 500,
          status: 'pending',
        },
        {
          name: 'Term 2',
          dueDate: new Date('2025-10-15'),
          amount: 500,
          paidAmount: 0,
          balanceAmount: 500,
          status: 'pending',
        },
      ],
      totalFee: 1000,
      totalPaid: 0,
      totalBalance: 1000,
    });
    const { app } = createTestApp();

    const response = await request(app)
      .post('/api/fees/payments')
      .set(authHeadersFor(accountant, 'accountant'))
      .send(
        validPaymentBody(student._id, classRecord._id, {
          amount: 500,
          feeHeads: [],
          installmentIndex: 0,
          idempotencyKey: 'installment-payment-001',
        })
      )
      .expect(201);

    expect(response.body).toMatchObject({ installmentIndex: 0, installmentName: 'Term 1' });
    const structure = await StudentFeeStructure.findOne({ studentId: student._id }).lean();
    expect(structure.installments[0]).toMatchObject({
      paidAmount: 500,
      balanceAmount: 0,
      status: 'paid',
    });
    expect(structure.feeHeads[0].paidAmount).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// GET /api/fees/payments — List payments
// ---------------------------------------------------------------------------

describe('GET /api/fees/payments', () => {
  it('returns 401 when no auth token is provided', async () => {
    const { app } = createTestApp();

    await request(app).get('/api/fees/payments').expect(401);
  });

  it('returns an empty array when no payments exist', async () => {
    const accountant = await createAccountant();
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app).get('/api/fees/payments').set(authHeaders).expect(200);

    expect(Array.isArray(res.body.payments)).toBe(true);
    expect(res.body.payments).toHaveLength(0);
  });

  it('returns all payments scoped to the authenticated user school', async () => {
    // Insert payments directly into MongoDB so that schoolId is persisted.
    // (The FeePayment schema has no schoolId field, so Mongoose strict mode
    // would drop it on a regular save.)
    const school = await createSchoolRecord({
      name: 'List School',
      code: 'LST-MAIN',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({ name: 'Class 7', section: 'A' });
    const studentA = await createStudentRecord({
      name: 'Student A',
      rollNo: 1,
      classId: classRecord._id,
    });
    const studentB = await createStudentRecord({
      name: 'Student B',
      rollNo: 2,
      classId: classRecord._id,
    });

    await insertPaymentDirect({
      studentId: studentA._id,
      classId: classRecord._id,
      schoolId: school._id,
      amount: 100,
    });
    await insertPaymentDirect({
      studentId: studentB._id,
      classId: classRecord._id,
      schoolId: school._id,
      amount: 200,
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app).get('/api/fees/payments').set(authHeaders).expect(200);

    expect(res.body.payments).toHaveLength(2);
    const amounts = res.body.payments.map((p) => p.amount).sort((a, b) => a - b);
    expect(amounts).toEqual([100, 200]);
  });

  it('filters payments by studentId', async () => {
    const school = await createSchoolRecord({
      name: 'Filter School',
      code: 'FLT-MAIN',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({ name: 'Class 7', section: 'B' });
    const studentA = await createStudentRecord({
      name: 'Filter Student A',
      rollNo: 1,
      classId: classRecord._id,
    });
    const studentB = await createStudentRecord({
      name: 'Filter Student B',
      rollNo: 2,
      classId: classRecord._id,
    });

    await insertPaymentDirect({
      studentId: studentA._id,
      classId: classRecord._id,
      schoolId: school._id,
      amount: 150,
    });
    await insertPaymentDirect({
      studentId: studentB._id,
      classId: classRecord._id,
      schoolId: school._id,
      amount: 250,
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .get('/api/fees/payments')
      .query({ studentId: studentA._id.toString() })
      .set(authHeaders)
      .expect(200);

    expect(res.body.payments).toHaveLength(1);
    expect(res.body.payments[0].amount).toBe(150);
  });

  it('filters payments by academicYear', async () => {
    const school = await createSchoolRecord({
      name: 'AcYear School',
      code: 'ACY-MAIN',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({ name: 'Class 7', section: 'C' });
    const student = await createStudentRecord({ name: 'AcYear Student', classId: classRecord._id });

    await insertPaymentDirect({
      studentId: student._id,
      classId: classRecord._id,
      schoolId: school._id,
      academicYear: CURRENT_ACADEMIC_YEAR,
      amount: 300,
    });
    await insertPaymentDirect({
      studentId: student._id,
      classId: classRecord._id,
      schoolId: school._id,
      academicYear: '2024-25',
      amount: 400,
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .get('/api/fees/payments')
      .query({ academicYear: CURRENT_ACADEMIC_YEAR })
      .set(authHeaders)
      .expect(200);

    expect(res.body.payments).toHaveLength(1);
    expect(res.body.payments[0].amount).toBe(300);
    expect(res.body.payments[0].academicYear).toBe(CURRENT_ACADEMIC_YEAR);
  });

  it('filters payments by status', async () => {
    const school = await createSchoolRecord({
      name: 'Status School',
      code: 'STS-MAIN',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({ name: 'Class 7', section: 'D' });
    const student = await createStudentRecord({ name: 'Status Student', classId: classRecord._id });

    await insertPaymentDirect({
      studentId: student._id,
      classId: classRecord._id,
      schoolId: school._id,
      amount: 500,
      status: 'completed',
    });
    await insertPaymentDirect({
      studentId: student._id,
      classId: classRecord._id,
      schoolId: school._id,
      amount: 600,
      status: 'pending',
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const completedRes = await request(app)
      .get('/api/fees/payments')
      .query({ status: 'completed' })
      .set(authHeaders)
      .expect(200);

    expect(completedRes.body.payments).toHaveLength(1);
    expect(completedRes.body.payments[0].status).toBe('completed');
    expect(completedRes.body.payments[0].amount).toBe(500);

    const pendingRes = await request(app)
      .get('/api/fees/payments')
      .query({ status: 'pending' })
      .set(authHeaders)
      .expect(200);

    expect(pendingRes.body.payments).toHaveLength(1);
    expect(pendingRes.body.payments[0].status).toBe('pending');
    expect(pendingRes.body.payments[0].amount).toBe(600);
  });

  it('returns payments sorted by paymentDate descending', async () => {
    const school = await createSchoolRecord({
      name: 'Sort School',
      code: 'SRT-MAIN',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({ name: 'Class 8', section: 'A' });
    const student = await createStudentRecord({ name: 'Sort Student', classId: classRecord._id });

    // Insert out of chronological order to verify the sort guarantee.
    await insertPaymentDirect({
      studentId: student._id,
      classId: classRecord._id,
      schoolId: school._id,
      amount: 100,
      paymentDate: '2026-01-01',
    });
    await insertPaymentDirect({
      studentId: student._id,
      classId: classRecord._id,
      schoolId: school._id,
      amount: 200,
      paymentDate: '2026-03-01',
    });
    await insertPaymentDirect({
      studentId: student._id,
      classId: classRecord._id,
      schoolId: school._id,
      amount: 150,
      paymentDate: '2026-02-01',
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app).get('/api/fees/payments').set(authHeaders).expect(200);

    expect(res.body.payments).toHaveLength(3);
    expect(res.body.payments[0].paymentDate).toBe('2026-03-01');
    expect(res.body.payments[1].paymentDate).toBe('2026-02-01');
    expect(res.body.payments[2].paymentDate).toBe('2026-01-01');
  });

  it('multi-tenancy: School A admin cannot see School B payments', async () => {
    // Payments inserted with School B's schoolId should not be visible to
    // School A's accountant, whose query filter uses School A's schoolId.
    const schoolA = await createSchoolRecord({
      name: 'List School A',
      code: 'LST-A',
      isDefault: true,
    });
    const schoolB = await createSchoolRecord({ name: 'List School B', code: 'LST-B' });

    const accountantA = await createAccountant({ schoolId: schoolA._id });
    const accountantB = await createAccountant({ schoolId: schoolB._id });

    const classRecord = await createClassRecord({ name: 'Class 6', section: 'A' });
    const student = await createStudentRecord({
      name: 'School B Student',
      classId: classRecord._id,
    });

    // Insert a payment scoped to School B.
    await insertPaymentDirect({
      studentId: student._id,
      classId: classRecord._id,
      schoolId: schoolB._id,
      amount: 750,
    });

    const { app } = createTestApp();

    // School A accountant should see zero payments.
    const authHeadersA = authHeadersFor(accountantA, 'accountant');
    const resA = await request(app).get('/api/fees/payments').set(authHeadersA).expect(200);

    expect(resA.body.payments).toHaveLength(0);

    // School B accountant should see that payment.
    const authHeadersB = authHeadersFor(accountantB, 'accountant');
    const resB = await request(app).get('/api/fees/payments').set(authHeadersB).expect(200);

    expect(resB.body.payments).toHaveLength(1);
    expect(resB.body.payments[0].amount).toBe(750);
  });
});

// ---------------------------------------------------------------------------
// GET /api/fees/payments/:id — Get payment by ID
// ---------------------------------------------------------------------------

describe('GET /api/fees/payments/:id', () => {
  it('returns 401 when no auth token is provided', async () => {
    const { app } = createTestApp();
    const fakeId = '000000000000000000000001';

    await request(app).get(`/api/fees/payments/${fakeId}`).expect(401);
  });

  it('returns the correct payment when the ID exists', async () => {
    const school = await createSchoolRecord({
      name: 'GetById School',
      code: 'GBY-MAIN',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({ name: 'Class 9', section: 'D' });
    const student = await createStudentRecord({
      name: 'GetById Student',
      classId: classRecord._id,
    });

    const insertedId = await insertPaymentDirect({
      studentId: student._id,
      classId: classRecord._id,
      schoolId: school._id,
      amount: 450,
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .get(`/api/fees/payments/${insertedId.toString()}`)
      .set(authHeaders)
      .expect(200);

    expect(res.body._id).toBe(insertedId.toString());
    expect(res.body.amount).toBe(450);
    expect(res.body.status).toBe('completed');
  });

  it('returns 404 for a non-existent payment ID', async () => {
    const accountant = await createAccountant();
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');
    const nonExistentId = '000000000000000000000001';

    await request(app).get(`/api/fees/payments/${nonExistentId}`).set(authHeaders).expect(404);
  });

  it('returns 400 for a malformed payment ID', async () => {
    // Mongoose throws a CastError for an invalid ObjectId; the route's
    // catch block returns 500.
    const accountant = await createAccountant();
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app).get('/api/fees/payments/not-a-valid-objectid').set(authHeaders);

    expect(res.status).toBe(400);
  });

  it('multi-tenancy: School A admin cannot retrieve a payment belonging to School B', async () => {
    // The GET /:id route appends schoolId to the findOne query.
    // School B's payment is only visible to School B's accountant — not School A's.
    const schoolA = await createSchoolRecord({
      name: 'GetId School A',
      code: 'GID-A',
      isDefault: true,
    });
    const schoolB = await createSchoolRecord({ name: 'GetId School B', code: 'GID-B' });

    const accountantA = await createAccountant({ schoolId: schoolA._id });
    const accountantB = await createAccountant({ schoolId: schoolB._id });

    const classRecord = await createClassRecord({ name: 'Class 9', section: 'E' });
    const student = await createStudentRecord({
      name: 'MT GetById Student',
      classId: classRecord._id,
    });

    // Payment scoped to School B.
    const insertedId = await insertPaymentDirect({
      studentId: student._id,
      classId: classRecord._id,
      schoolId: schoolB._id,
      amount: 550,
    });

    const { app } = createTestApp();
    const paymentPath = `/api/fees/payments/${insertedId.toString()}`;

    // School A accountant: should get 404.
    const authHeadersA = authHeadersFor(accountantA, 'accountant');
    await request(app).get(paymentPath).set(authHeadersA).expect(404);

    // School B accountant: should get 200.
    const authHeadersB = authHeadersFor(accountantB, 'accountant');
    const resB = await request(app).get(paymentPath).set(authHeadersB).expect(200);

    expect(resB.body.amount).toBe(550);
  });

  it('populates the studentId field with student name and admissionId', async () => {
    const school = await createSchoolRecord({
      name: 'Populate School',
      code: 'POP-MAIN',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({
      name: 'Class 10',
      section: 'D',
      schoolId: school._id,
    });
    const student = await createStudentRecord({
      name: 'Populated Student',
      admissionId: 'ADM-POP-001',
      classId: classRecord._id,
      schoolId: school._id,
    });

    const insertedId = await insertPaymentDirect({
      studentId: student._id,
      classId: classRecord._id,
      schoolId: school._id,
      amount: 700,
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .get(`/api/fees/payments/${insertedId.toString()}`)
      .set(authHeaders)
      .expect(200);

    // studentId should be populated (an object), not a raw ObjectId string.
    expect(typeof res.body.studentId).toBe('object');
    expect(res.body.studentId).not.toBeNull();
    expect(res.body.studentId.name).toBe('Populated Student');
    expect(res.body.studentId.admissionId).toBe('ADM-POP-001');
  });

  it('returns all expected fields on a payment document', async () => {
    const school = await createSchoolRecord({
      name: 'Fields School',
      code: 'FLD-MAIN',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({ name: 'Class 10', section: 'E' });
    const student = await createStudentRecord({ name: 'Fields Student', classId: classRecord._id });

    const insertedId = await insertPaymentDirect({
      studentId: student._id,
      classId: classRecord._id,
      schoolId: school._id,
      amount: 800,
      paymentMode: 'online',
      remarks: 'Full term fee',
      academicYear: '2025-26',
      paymentDate: '2026-03-06',
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .get(`/api/fees/payments/${insertedId.toString()}`)
      .set(authHeaders)
      .expect(200);

    expect(res.body).toMatchObject({
      _id: insertedId.toString(),
      amount: 800,
      paymentMode: 'online',
      remarks: 'Full term fee',
      status: 'completed',
      academicYear: '2025-26',
      paymentDate: '2026-03-06',
    });
    expect(res.body.createdAt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
describe('GET /api/fees/payments/total-paid', () => {
  it('returns the complete school- and academic-year-scoped total', async () => {
    const accountant = await createAccountant();
    const classRecord = await createClassRecord({ name: 'Class 6', section: 'T' });
    const student = await createStudentRecord({
      name: 'Total Paid Student',
      classId: classRecord._id,
    });
    await FeePayment.create([
      {
        schoolId: student.schoolId,
        studentId: student._id,
        classId: classRecord._id,
        academicYear: '2025-26',
        receiptNumber: 'RCP-TOTAL-001',
        paymentDate: '2026-03-01',
        amount: 400,
        paymentMode: 'cash',
        status: 'completed',
      },
      {
        schoolId: student.schoolId,
        studentId: student._id,
        classId: classRecord._id,
        academicYear: '2024-25',
        receiptNumber: 'RCP-TOTAL-002',
        paymentDate: '2025-03-01',
        amount: 900,
        paymentMode: 'cash',
        status: 'completed',
      },
      {
        schoolId: student.schoolId,
        studentId: student._id,
        classId: classRecord._id,
        academicYear: '2025-26',
        receiptNumber: 'RCP-TOTAL-003',
        paymentDate: '2026-03-02',
        amount: 100,
        paymentMode: 'cash',
        status: 'cancelled',
      },
    ]);
    const { app } = createTestApp();

    const response = await request(app)
      .get('/api/fees/payments/total-paid')
      .query({ studentId: student._id.toString(), academicYear: '2025-26' })
      .set(authHeadersFor(accountant, 'accountant'))
      .expect(200);

    expect(response.body).toMatchObject({
      totalPaid: 400,
      paymentCount: 1,
      academicYear: '2025-26',
    });
  });
});

// Refund financial integrity
// ---------------------------------------------------------------------------

describe('refund financial integrity', () => {
  it('does not reverse balances when electronic settlement details are missing', async () => {
    const accountant = await createAccountant();
    const classRecord = await createClassRecord({ name: 'Class 6', section: 'E' });
    const student = await createStudentRecord({
      name: 'Refund Settlement Student',
      classId: classRecord._id,
      feeDetails: { totalFee: 500, paidAmount: 500, balanceAmount: 0 },
    });
    await insertPaymentDirect({
      schoolId: student.schoolId,
      studentId: student._id,
      classId: classRecord._id,
      amount: 500,
      receiptNumber: 'RCP-REFUND-SETTLEMENT',
    });
    const ledger = await StudentFeeStructure.create({
      schoolId: student.schoolId,
      studentId: student._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      feeHeads: [],
      totalFee: 500,
      totalPaid: 500,
      totalBalance: 0,
      overallStatus: 'paid',
    });
    const refund = await FeeRefund.create({
      schoolId: student.schoolId,
      studentId: student._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      refundNumber: 'RFD-SETTLEMENT-001',
      refundDate: '2026-03-06',
      amount: 100,
      reason: 'Electronic refund requires a transaction reference',
      refundMode: 'online',
      status: 'approved',
    });
    const { app } = createTestApp();

    const response = await request(app)
      .put(`/api/fees/refunds/${refund._id}/process`)
      .set(authHeadersFor(accountant, 'accountant'))
      .send({})
      .expect(400);

    expect(response.body.code).toBe('REFUND_SETTLEMENT_DETAILS_REQUIRED');
    expect((await FeeRefund.findById(refund._id).lean()).status).toBe('approved');
    expect((await StudentFeeStructure.findById(ledger._id).lean()).totalPaid).toBe(500);
  });

  it('serializes concurrent approvals so reservations cannot exceed paid fees', async () => {
    const accountant = await createAccountant();
    const classRecord = await createClassRecord({ name: 'Class 6', section: 'R' });
    const student = await createStudentRecord({
      name: 'Concurrent Refund Student',
      classId: classRecord._id,
      feeDetails: { totalFee: 100, paidAmount: 100, balanceAmount: 0 },
    });
    await insertPaymentDirect({
      schoolId: student.schoolId,
      studentId: student._id,
      classId: classRecord._id,
      amount: 100,
      receiptNumber: 'RCP-REFUND-RACE',
    });
    await StudentFeeStructure.create({
      schoolId: student.schoolId,
      studentId: student._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      feeHeads: [],
      totalFee: 100,
      totalPaid: 100,
      totalBalance: 0,
      overallStatus: 'paid',
    });
    const refunds = await FeeRefund.create([
      {
        schoolId: student.schoolId,
        studentId: student._id,
        classId: classRecord._id,
        academicYear: '2025-26',
        refundNumber: 'RFD-RACE-001',
        refundDate: '2026-03-06',
        amount: 80,
        reason: 'Duplicate collection requires a refund',
        refundMode: 'cash',
        status: 'pending',
      },
      {
        schoolId: student.schoolId,
        studentId: student._id,
        classId: classRecord._id,
        academicYear: '2025-26',
        refundNumber: 'RFD-RACE-002',
        refundDate: '2026-03-06',
        amount: 80,
        reason: 'Duplicate collection requires a refund',
        refundMode: 'cash',
        status: 'pending',
      },
    ]);
    const { app } = createTestApp();
    const headers = authHeadersFor(accountant, 'accountant');

    const responses = await Promise.all(
      refunds.map((refund) =>
        request(app).put(`/api/fees/refunds/${refund._id}/approve`).set(headers).send({})
      )
    );

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const saved = await FeeRefund.find({ _id: { $in: refunds.map((item) => item._id) } }).lean();
    expect(saved.filter((item) => item.status === 'approved')).toHaveLength(1);
    expect(saved.filter((item) => item.status === 'pending')).toHaveLength(1);
  });

  it('keeps an approved refund unchanged when balance reversal cannot be completed', async () => {
    const accountant = await createAccountant();
    const classRecord = await createClassRecord({ name: 'Class 6', section: 'A' });
    const student = await createStudentRecord({
      name: 'Refund Rollback Student',
      classId: classRecord._id,
      feeDetails: { totalFee: 1000, paidAmount: 500, balanceAmount: 500 },
    });
    const paymentId = await insertPaymentDirect({
      schoolId: student.schoolId,
      studentId: student._id,
      classId: classRecord._id,
      amount: 500,
      receiptNumber: 'RCP-REFUND-ROLLBACK',
    });
    const refund = await FeeRefund.create({
      schoolId: student.schoolId,
      studentId: student._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      refundNumber: 'RFD-ROLLBACK-001',
      refundDate: '2026-03-06',
      amount: 200,
      reason: 'Duplicate payment requires a refund',
      refundMode: 'cash',
      originalPaymentId: paymentId,
      status: 'approved',
    });
    const { app } = createTestApp();

    const response = await request(app)
      .put(`/api/fees/refunds/${refund._id}/process`)
      .set(authHeadersFor(accountant, 'accountant'))
      .send({})
      .expect(409);

    expect(response.body.code).toBe('FEE_STRUCTURE_NOT_FOUND');
    const unchanged = await FeeRefund.findById(refund._id).lean();
    expect(unchanged.status).toBe('approved');
    expect(unchanged.processedAt).toBeUndefined();
  });

  it('processes the refund and fee-balance reversal in one transaction', async () => {
    const accountant = await createAccountant();
    const classRecord = await createClassRecord({ name: 'Class 6', section: 'B' });
    const student = await createStudentRecord({
      name: 'Refund Success Student',
      classId: classRecord._id,
      feeDetails: { totalFee: 1000, paidAmount: 500, balanceAmount: 500 },
    });
    const paymentId = await insertPaymentDirect({
      schoolId: student.schoolId,
      studentId: student._id,
      classId: classRecord._id,
      amount: 500,
      receiptNumber: 'RCP-REFUND-SUCCESS',
    });
    await StudentFeeStructure.create({
      schoolId: student.schoolId,
      studentId: student._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      feeHeads: [],
      totalFee: 1000,
      totalPaid: 500,
      totalBalance: 500,
      overallStatus: 'partial',
    });
    const refund = await FeeRefund.create({
      schoolId: student.schoolId,
      studentId: student._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      refundNumber: 'RFD-SUCCESS-001',
      refundDate: '2026-03-06',
      amount: 200,
      reason: 'Duplicate payment requires a refund',
      refundMode: 'cash',
      originalPaymentId: paymentId,
      status: 'approved',
    });
    const { app } = createTestApp();

    await request(app)
      .put(`/api/fees/refunds/${refund._id}/process`)
      .set(authHeadersFor(accountant, 'accountant'))
      .send({ remarks: 'Cash returned at accounts office' })
      .expect(200);

    const [savedRefund, feeStructure, savedStudent] = await Promise.all([
      FeeRefund.findById(refund._id).lean(),
      StudentFeeStructure.findOne({ studentId: student._id }).lean(),
      Student.findById(student._id).lean(),
    ]);
    expect(savedRefund.status).toBe('processed');
    expect(feeStructure.totalPaid).toBe(300);
    expect(feeStructure.totalBalance).toBe(700);
    expect(savedStudent.feeDetails.paidAmount).toBe(300);
    expect(savedStudent.feeDetails.balanceAmount).toBe(700);
  });
});

// GET /api/fees/refunds — pagination, search, and KPI summary (PAG-17)
// ---------------------------------------------------------------------------
//
// Refunds previously fetch-all'd and let the frontend slice client-side; this
// suite locks down the server-side pagination + search added in PAG-17 and the
// /refunds/summary aggregate that backs the page's KPI cards.

// Insert a FeeRefund straight into MongoDB. schoolId is stored as a real
// ObjectId for the same reason insertPaymentDirect does it: the scoped query
// casts the filter to ObjectId, so a plain string schoolId would never match.
async function insertRefundDirect(fields) {
  const { schoolId, studentId, classId, ...rest } = fields;
  const result = await FeeRefund.collection.insertOne({
    academicYear: CURRENT_ACADEMIC_YEAR,
    refundDate: '2026-03-06',
    amount: 100,
    reason: 'Duplicate payment, refund requested',
    refundMode: 'cash',
    status: 'pending',
    remarks: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...rest,
    schoolId: new mongoose.Types.ObjectId(schoolId.toString()),
    studentId: new mongoose.Types.ObjectId(studentId.toString()),
    classId: new mongoose.Types.ObjectId(classId.toString()),
    refundNumber: rest.refundNumber || `RFD-${Date.now()}-${Math.random()}`,
  });
  return result.insertedId;
}

describe('GET /api/fees/refunds — pagination + search (PAG-17)', () => {
  it('returns { refunds, pagination } and respects page/limit', async () => {
    const school = await createSchoolRecord({
      name: 'Refunds Page School',
      code: 'RPG-MAIN',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({ name: 'Class 9', section: 'A' });
    const student = await createStudentRecord({
      name: 'Refund Student',
      classId: classRecord._id,
    });

    // 3 refunds — default limit is 50 so all fit on page 1, but ask for 2.
    await insertRefundDirect({
      schoolId: school._id,
      studentId: student._id,
      classId: classRecord._id,
      refundNumber: 'RFD-PG-001',
      amount: 100,
    });
    await insertRefundDirect({
      schoolId: school._id,
      studentId: student._id,
      classId: classRecord._id,
      refundNumber: 'RFD-PG-002',
      amount: 200,
    });
    await insertRefundDirect({
      schoolId: school._id,
      studentId: student._id,
      classId: classRecord._id,
      refundNumber: 'RFD-PG-003',
      amount: 300,
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .get('/api/fees/refunds')
      .query({ page: 1, limit: 2 })
      .set(authHeaders)
      .expect(200);

    expect(Array.isArray(res.body.refunds)).toBe(true);
    expect(res.body.refunds).toHaveLength(2);
    expect(res.body.pagination).toMatchObject({
      page: 1,
      limit: 2,
      total: 3,
      totalPages: 2,
    });

    // Page 2 returns the remaining refund.
    const res2 = await request(app)
      .get('/api/fees/refunds')
      .query({ page: 2, limit: 2 })
      .set(authHeaders)
      .expect(200);
    expect(res2.body.refunds).toHaveLength(1);
    expect(res2.body.pagination.total).toBe(3);
  });

  it('matches by student name via server-side search', async () => {
    const school = await createSchoolRecord({
      name: 'Refunds Search School',
      code: 'RSR-MAIN',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({
      name: 'Class 9',
      section: 'B',
      schoolId: school._id,
    });
    const studentA = await createStudentRecord({
      name: 'Alice Wonderland',
      classId: classRecord._id,
      schoolId: school._id,
    });
    const studentB = await createStudentRecord({
      name: 'Bob Builder',
      classId: classRecord._id,
      schoolId: school._id,
    });

    await insertRefundDirect({
      schoolId: school._id,
      studentId: studentA._id,
      classId: classRecord._id,
      refundNumber: 'RFD-SR-001',
    });
    await insertRefundDirect({
      schoolId: school._id,
      studentId: studentB._id,
      classId: classRecord._id,
      refundNumber: 'RFD-SR-002',
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .get('/api/fees/refunds')
      .query({ search: 'alice' })
      .set(authHeaders)
      .expect(200);

    expect(res.body.refunds).toHaveLength(1);
    expect(res.body.refunds[0].studentId.name).toBe('Alice Wonderland');
  });

  it('matches by refundNumber via server-side search', async () => {
    const school = await createSchoolRecord({
      name: 'Refunds Number School',
      code: 'RNO-MAIN',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({ name: 'Class 9', section: 'C' });
    const student = await createStudentRecord({
      name: 'Number Student',
      classId: classRecord._id,
    });

    await insertRefundDirect({
      schoolId: school._id,
      studentId: student._id,
      classId: classRecord._id,
      refundNumber: 'RFD-UNIQUE-42',
    });
    await insertRefundDirect({
      schoolId: school._id,
      studentId: student._id,
      classId: classRecord._id,
      refundNumber: 'RFD-OTHER-99',
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .get('/api/fees/refunds')
      .query({ search: 'UNIQUE-42' })
      .set(authHeaders)
      .expect(200);

    expect(res.body.refunds).toHaveLength(1);
    expect(res.body.refunds[0].refundNumber).toBe('RFD-UNIQUE-42');
  });

  it('does not interpret regex metacharacters in search (ReDoS safety)', async () => {
    const school = await createSchoolRecord({
      name: 'Refunds Regex School',
      code: 'RRX-MAIN',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({ name: 'Class 9', section: 'D' });
    const student = await createStudentRecord({
      name: 'Regex (Safe)',
      classId: classRecord._id,
    });

    await insertRefundDirect({
      schoolId: school._id,
      studentId: student._id,
      classId: classRecord._id,
      // Refund number containing literal parens — a naive RegExp construction
      // from the search string would treat these as a capture group.
      refundNumber: 'RFD-(LITERAL)',
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    // Searching for the literal "(LITERAL)" matches exactly one row.
    // If the route fed the raw string to `new RegExp(...)`, the parens would
    // form a valid (harmless) group but the search would still match — the
    // real safety net is that no SyntaxError is thrown and the result is the
    // same set of rows a plain substring match would return.
    const res = await request(app)
      .get('/api/fees/refunds')
      .query({ search: '(LITERAL)' })
      .set(authHeaders)
      .expect(200);

    expect(res.body.refunds).toHaveLength(1);
    expect(res.body.refunds[0].refundNumber).toBe('RFD-(LITERAL)');

    // A search with a regex quantifier like "a{1,2,3}" (invalid quantifier)
    // would throw a SyntaxError if the route didn't escape — verify it
    // returns an empty page rather than crashing.
    const res2 = await request(app)
      .get('/api/fees/refunds')
      .query({ search: 'a{1,2,3}' })
      .set(authHeaders)
      .expect(200);
    expect(res2.body.refunds).toHaveLength(0);
  });

  it('filters by status', async () => {
    const school = await createSchoolRecord({
      name: 'Refunds Status School',
      code: 'RST-MAIN',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({ name: 'Class 9', section: 'E' });
    const student = await createStudentRecord({
      name: 'Status Student',
      classId: classRecord._id,
    });

    await insertRefundDirect({
      schoolId: school._id,
      studentId: student._id,
      classId: classRecord._id,
      refundNumber: 'RFD-ST-1',
      status: 'pending',
    });
    await insertRefundDirect({
      schoolId: school._id,
      studentId: student._id,
      classId: classRecord._id,
      refundNumber: 'RFD-ST-2',
      status: 'approved',
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .get('/api/fees/refunds')
      .query({ status: 'approved' })
      .set(authHeaders)
      .expect(200);

    expect(res.body.refunds).toHaveLength(1);
    expect(res.body.refunds[0].status).toBe('approved');
    expect(res.body.pagination.total).toBe(1);
  });

  it('multi-tenancy: School A cannot see School B refunds', async () => {
    const schoolA = await createSchoolRecord({
      name: 'Refunds School A',
      code: 'RMT-A',
      isDefault: true,
    });
    const schoolB = await createSchoolRecord({ name: 'Refunds School B', code: 'RMT-B' });
    const accountantA = await createAccountant({ schoolId: schoolA._id });
    const accountantB = await createAccountant({ schoolId: schoolB._id });
    const classRecord = await createClassRecord({ name: 'Class 9', section: 'F' });
    const student = await createStudentRecord({
      name: 'MT Refund Student',
      classId: classRecord._id,
    });

    // Refund scoped to School B.
    await insertRefundDirect({
      schoolId: schoolB._id,
      studentId: student._id,
      classId: classRecord._id,
      refundNumber: 'RFD-MT-B-1',
    });

    const { app } = createTestApp();
    const authHeadersA = authHeadersFor(accountantA, 'accountant');
    const authHeadersB = authHeadersFor(accountantB, 'accountant');

    const resA = await request(app).get('/api/fees/refunds').set(authHeadersA).expect(200);
    expect(resA.body.refunds).toHaveLength(0);

    const resB = await request(app).get('/api/fees/refunds').set(authHeadersB).expect(200);
    expect(resB.body.refunds).toHaveLength(1);
    expect(resB.body.refunds[0].refundNumber).toBe('RFD-MT-B-1');
  });
});

describe('GET /api/fees/refunds/summary — KPI aggregate (PAG-17)', () => {
  it('returns totalAmount + per-status counts over the full dataset', async () => {
    const school = await createSchoolRecord({
      name: 'Refunds Summary School',
      code: 'RSU-MAIN',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({ name: 'Class 11', section: 'A' });
    const student = await createStudentRecord({
      name: 'Summary Student',
      classId: classRecord._id,
    });

    await insertRefundDirect({
      schoolId: school._id,
      studentId: student._id,
      classId: classRecord._id,
      refundNumber: 'RFD-SU-1',
      amount: 100,
      status: 'pending',
    });
    await insertRefundDirect({
      schoolId: school._id,
      studentId: student._id,
      classId: classRecord._id,
      refundNumber: 'RFD-SU-2',
      amount: 250,
      status: 'pending',
    });
    await insertRefundDirect({
      schoolId: school._id,
      studentId: student._id,
      classId: classRecord._id,
      refundNumber: 'RFD-SU-3',
      amount: 500,
      status: 'approved',
    });
    await insertRefundDirect({
      schoolId: school._id,
      studentId: student._id,
      classId: classRecord._id,
      refundNumber: 'RFD-SU-4',
      amount: 750,
      status: 'processed',
    });
    await insertRefundDirect({
      schoolId: school._id,
      studentId: student._id,
      classId: classRecord._id,
      refundNumber: 'RFD-SU-5',
      amount: 50,
      status: 'rejected',
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app).get('/api/fees/refunds/summary').set(authHeaders).expect(200);

    expect(res.body).toMatchObject({
      totalAmount: 1650,
      totalCount: 5,
      pendingCount: 2,
      approvedCount: 1,
      processedCount: 1,
      rejectedCount: 1,
    });
  });

  it('respects status filter (only the matching status contributes)', async () => {
    const school = await createSchoolRecord({
      name: 'Refunds Summary Status School',
      code: 'RSS-MAIN',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({ name: 'Class 11', section: 'B' });
    const student = await createStudentRecord({
      name: 'Summary Status Student',
      classId: classRecord._id,
    });

    await insertRefundDirect({
      schoolId: school._id,
      studentId: student._id,
      classId: classRecord._id,
      refundNumber: 'RFD-SS-1',
      amount: 100,
      status: 'pending',
    });
    await insertRefundDirect({
      schoolId: school._id,
      studentId: student._id,
      classId: classRecord._id,
      refundNumber: 'RFD-SS-2',
      amount: 500,
      status: 'approved',
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .get('/api/fees/refunds/summary')
      .query({ status: 'approved' })
      .set(authHeaders)
      .expect(200);

    expect(res.body).toMatchObject({
      totalAmount: 500,
      totalCount: 1,
      approvedCount: 1,
      pendingCount: 0,
    });
  });

  it('respects search filter (matches student name)', async () => {
    const school = await createSchoolRecord({
      name: 'Refunds Summary Search School',
      code: 'RSSR-MAIN',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({
      name: 'Class 11',
      section: 'C',
      schoolId: school._id,
    });
    const studentA = await createStudentRecord({
      name: 'Carol Search',
      classId: classRecord._id,
      schoolId: school._id,
    });
    const studentB = await createStudentRecord({
      name: 'Dave Other',
      classId: classRecord._id,
      schoolId: school._id,
    });

    await insertRefundDirect({
      schoolId: school._id,
      studentId: studentA._id,
      classId: classRecord._id,
      refundNumber: 'RFD-SSR-1',
      amount: 300,
      status: 'pending',
    });
    await insertRefundDirect({
      schoolId: school._id,
      studentId: studentB._id,
      classId: classRecord._id,
      refundNumber: 'RFD-SSR-2',
      amount: 400,
      status: 'pending',
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .get('/api/fees/refunds/summary')
      .query({ search: 'carol' })
      .set(authHeaders)
      .expect(200);

    expect(res.body.totalAmount).toBe(300);
    expect(res.body.totalCount).toBe(1);
  });

  it('is registered before /:id (not shadowed)', async () => {
    // A get to /refunds/summary must run the summary handler, not the
    // /refunds/:id handler with id="summary".
    const accountant = await createAccountant();
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app).get('/api/fees/refunds/summary').set(authHeaders).expect(200);

    // If it had been shadowed by /:id, the response would be a 404 "Refund not
    // found" object, not a summary object with totalCount.
    expect(res.body).toHaveProperty('totalCount');
    expect(res.body).toHaveProperty('totalAmount');
  });

  it('returns 400 on invalid query parameters', async () => {
    const accountant = await createAccountant();
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    // search string longer than the schema's 100-char max
    const res = await request(app)
      .get('/api/fees/refunds/summary')
      .query({ search: 'x'.repeat(101) })
      .set(authHeaders)
      .expect(400);

    expect(res.body).toHaveProperty('details');
  });
});
