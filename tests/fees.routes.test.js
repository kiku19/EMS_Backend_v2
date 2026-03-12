import mongoose from 'mongoose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { FeePayment, Student } from '../database.js';
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
    ...(schoolId != null
      ? { schoolId: new mongoose.Types.ObjectId(schoolId.toString()) }
      : {}),
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

    const paymentResponse = await request(app)
      .post('/api/fees/payments')
      .set(authHeaders)
      .send({
        studentId: student._id.toString(),
        studentName: student.name,
        classId: classRecord._id.toString(),
        academicYear: '2025-26',
        paymentDate: '2026-03-06',
        amount: 500,
        paymentMode: 'cash',
        remarks: 'Partial payment',
      })
      .expect(201);

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

  it('returns 500 when studentId is missing (Mongoose required field)', async () => {
    // The route passes body fields directly to new FeePayment(). When
    // studentId is absent the schema validation fails and the route's catch
    // block returns 500.
    const accountant = await createAccountant();
    const classRecord = await createClassRecord({ name: 'Class 9', section: 'C' });
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .post('/api/fees/payments')
      .set(authHeaders)
      .send({
        // studentId intentionally omitted
        classId: classRecord._id.toString(),
        academicYear: '2025-26',
        paymentDate: '2026-03-06',
        amount: 300,
        paymentMode: 'cash',
      });

    expect(res.status).toBe(500);
  });

  it('still creates a payment record when studentId does not exist in DB (non-blocking student update)', async () => {
    // The route saves the payment first, then tries to update the student in
    // a non-blocking try/catch. A missing student is silently ignored, so the
    // route still responds 201.
    const accountant = await createAccountant();
    const classRecord = await createClassRecord({ name: 'Class 10', section: 'A' });
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const fakeStudentId = '000000000000000000000001';

    const res = await request(app)
      .post('/api/fees/payments')
      .set(authHeaders)
      .send(validPaymentBody(fakeStudentId, classRecord._id))
      .expect(201);

    expect(res.body.status).toBe('completed');
    expect(res.body.receiptNumber).toMatch(/^RCP-/);

    const saved = await FeePayment.findById(res.body._id).lean();
    expect(saved).not.toBeNull();
    expect(saved.amount).toBe(500);
  });

  it('returns 500 when amount is missing (Mongoose required field)', async () => {
    const accountant = await createAccountant();
    const classRecord = await createClassRecord({ name: 'Class 10', section: 'B' });
    const student = await createStudentRecord({
      name: 'No Amount Student',
      rollNo: 2,
      classId: classRecord._id,
    });
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .post('/api/fees/payments')
      .set(authHeaders)
      .send({
        studentId: student._id.toString(),
        classId: classRecord._id.toString(),
        academicYear: '2025-26',
        paymentDate: '2026-03-06',
        // amount intentionally omitted
        paymentMode: 'cash',
      });

    expect(res.status).toBe(500);
  });

  it('creates a payment with amount 0 (no minimum enforced by schema or route)', async () => {
    // The schema requires amount but does not enforce a positive minimum,
    // so 0 is accepted.
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
      .send(validPaymentBody(student._id, classRecord._id, { amount: 0 }))
      .expect(201);

    expect(res.body.amount).toBe(0);
    expect(res.body.status).toBe('completed');
  });

  it('auto-generates a receipt number when none is supplied', async () => {
    const accountant = await createAccountant();
    const classRecord = await createClassRecord({ name: 'Class 11', section: 'A' });
    const student = await createStudentRecord({
      name: 'Auto Receipt Student',
      rollNo: 4,
      classId: classRecord._id,
    });
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .post('/api/fees/payments')
      .set(authHeaders)
      .send(validPaymentBody(student._id, classRecord._id))
      .expect(201);

    expect(res.body.receiptNumber).toMatch(/^RCP-\d+$/);
  });

  it('uses the supplied receipt number when one is provided', async () => {
    const accountant = await createAccountant();
    const classRecord = await createClassRecord({ name: 'Class 11', section: 'B' });
    const student = await createStudentRecord({
      name: 'Custom Receipt Student',
      rollNo: 5,
      classId: classRecord._id,
    });
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .post('/api/fees/payments')
      .set(authHeaders)
      .send(validPaymentBody(student._id, classRecord._id, { receiptNumber: 'RCP-CUSTOM-001' }))
      .expect(201);

    expect(res.body.receiptNumber).toBe('RCP-CUSTOM-001');
  });

  it('marks student feeStatus as paid when payment covers the full fee balance', async () => {
    const school = await createSchoolRecord({
      name: 'Paid Status School',
      code: 'TST-PAID',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({ name: 'Class 12', section: 'A' });
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

  it('multi-tenancy: payment creation does not update a student belonging to a different school', async () => {
    // School A's accountant submits a payment referencing School B's student.
    // scopeBySchool scopes the student lookup to School A's schoolId, so the
    // student is not found. The payment itself is still saved (201) but the
    // student's fee totals remain unchanged.
    const schoolA = await createSchoolRecord({ name: 'School A', code: 'SCH-A-MT', isDefault: true });
    const schoolB = await createSchoolRecord({ name: 'School B', code: 'SCH-B-MT' });

    const accountantA = await createAccountant({ schoolId: schoolA._id });
    const classRecord = await createClassRecord({ name: 'Class 8', section: 'A' });

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
      .expect(201);

    // The payment record is created regardless.
    expect(res.body.status).toBe('completed');

    // School B's student fee totals were NOT updated because the scoped
    // student lookup returned null.
    const unchangedStudent = await Student.findById(studentB._id).lean();
    expect(unchangedStudent.feeDetails.paidAmount ?? 0).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GET /api/fees/payments — List payments
// ---------------------------------------------------------------------------

describe('GET /api/fees/payments', () => {
  it('returns 401 when no auth token is provided', async () => {
    const { app } = createTestApp();

    await request(app)
      .get('/api/fees/payments')
      .expect(401);
  });

  it('returns an empty array when no payments exist', async () => {
    const accountant = await createAccountant();
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .get('/api/fees/payments')
      .set(authHeaders)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  it('returns all payments scoped to the authenticated user school', async () => {
    // Insert payments directly into MongoDB so that schoolId is persisted.
    // (The FeePayment schema has no schoolId field, so Mongoose strict mode
    // would drop it on a regular save.)
    const school = await createSchoolRecord({ name: 'List School', code: 'LST-MAIN', isDefault: true });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({ name: 'Class 7', section: 'A' });
    const studentA = await createStudentRecord({ name: 'Student A', rollNo: 1, classId: classRecord._id });
    const studentB = await createStudentRecord({ name: 'Student B', rollNo: 2, classId: classRecord._id });

    await insertPaymentDirect({ studentId: studentA._id, classId: classRecord._id, schoolId: school._id, amount: 100 });
    await insertPaymentDirect({ studentId: studentB._id, classId: classRecord._id, schoolId: school._id, amount: 200 });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .get('/api/fees/payments')
      .set(authHeaders)
      .expect(200);

    expect(res.body).toHaveLength(2);
    const amounts = res.body.map((p) => p.amount).sort((a, b) => a - b);
    expect(amounts).toEqual([100, 200]);
  });

  it('filters payments by studentId', async () => {
    const school = await createSchoolRecord({ name: 'Filter School', code: 'FLT-MAIN', isDefault: true });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({ name: 'Class 7', section: 'B' });
    const studentA = await createStudentRecord({ name: 'Filter Student A', rollNo: 1, classId: classRecord._id });
    const studentB = await createStudentRecord({ name: 'Filter Student B', rollNo: 2, classId: classRecord._id });

    await insertPaymentDirect({ studentId: studentA._id, classId: classRecord._id, schoolId: school._id, amount: 150 });
    await insertPaymentDirect({ studentId: studentB._id, classId: classRecord._id, schoolId: school._id, amount: 250 });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .get('/api/fees/payments')
      .query({ studentId: studentA._id.toString() })
      .set(authHeaders)
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].amount).toBe(150);
  });

  it('filters payments by academicYear', async () => {
    const school = await createSchoolRecord({ name: 'AcYear School', code: 'ACY-MAIN', isDefault: true });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({ name: 'Class 7', section: 'C' });
    const student = await createStudentRecord({ name: 'AcYear Student', classId: classRecord._id });

    await insertPaymentDirect({
      studentId: student._id,
      classId: classRecord._id,
      schoolId: school._id,
      academicYear: '2024-25',
      amount: 300,
    });
    await insertPaymentDirect({
      studentId: student._id,
      classId: classRecord._id,
      schoolId: school._id,
      academicYear: '2025-26',
      amount: 400,
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .get('/api/fees/payments')
      .query({ academicYear: '2024-25' })
      .set(authHeaders)
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].amount).toBe(300);
    expect(res.body[0].academicYear).toBe('2024-25');
  });

  it('filters payments by status', async () => {
    const school = await createSchoolRecord({ name: 'Status School', code: 'STS-MAIN', isDefault: true });
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

    expect(completedRes.body).toHaveLength(1);
    expect(completedRes.body[0].status).toBe('completed');
    expect(completedRes.body[0].amount).toBe(500);

    const pendingRes = await request(app)
      .get('/api/fees/payments')
      .query({ status: 'pending' })
      .set(authHeaders)
      .expect(200);

    expect(pendingRes.body).toHaveLength(1);
    expect(pendingRes.body[0].status).toBe('pending');
    expect(pendingRes.body[0].amount).toBe(600);
  });

  it('returns payments sorted by paymentDate descending', async () => {
    const school = await createSchoolRecord({ name: 'Sort School', code: 'SRT-MAIN', isDefault: true });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({ name: 'Class 8', section: 'A' });
    const student = await createStudentRecord({ name: 'Sort Student', classId: classRecord._id });

    // Insert out of chronological order to verify the sort guarantee.
    await insertPaymentDirect({ studentId: student._id, classId: classRecord._id, schoolId: school._id, amount: 100, paymentDate: '2026-01-01' });
    await insertPaymentDirect({ studentId: student._id, classId: classRecord._id, schoolId: school._id, amount: 200, paymentDate: '2026-03-01' });
    await insertPaymentDirect({ studentId: student._id, classId: classRecord._id, schoolId: school._id, amount: 150, paymentDate: '2026-02-01' });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .get('/api/fees/payments')
      .set(authHeaders)
      .expect(200);

    expect(res.body).toHaveLength(3);
    expect(res.body[0].paymentDate).toBe('2026-03-01');
    expect(res.body[1].paymentDate).toBe('2026-02-01');
    expect(res.body[2].paymentDate).toBe('2026-01-01');
  });

  it('multi-tenancy: School A admin cannot see School B payments', async () => {
    // Payments inserted with School B's schoolId should not be visible to
    // School A's accountant, whose query filter uses School A's schoolId.
    const schoolA = await createSchoolRecord({ name: 'List School A', code: 'LST-A', isDefault: true });
    const schoolB = await createSchoolRecord({ name: 'List School B', code: 'LST-B' });

    const accountantA = await createAccountant({ schoolId: schoolA._id });
    const accountantB = await createAccountant({ schoolId: schoolB._id });

    const classRecord = await createClassRecord({ name: 'Class 6', section: 'A' });
    const student = await createStudentRecord({ name: 'School B Student', classId: classRecord._id });

    // Insert a payment scoped to School B.
    await insertPaymentDirect({ studentId: student._id, classId: classRecord._id, schoolId: schoolB._id, amount: 750 });

    const { app } = createTestApp();

    // School A accountant should see zero payments.
    const authHeadersA = authHeadersFor(accountantA, 'accountant');
    const resA = await request(app)
      .get('/api/fees/payments')
      .set(authHeadersA)
      .expect(200);

    expect(resA.body).toHaveLength(0);

    // School B accountant should see that payment.
    const authHeadersB = authHeadersFor(accountantB, 'accountant');
    const resB = await request(app)
      .get('/api/fees/payments')
      .set(authHeadersB)
      .expect(200);

    expect(resB.body).toHaveLength(1);
    expect(resB.body[0].amount).toBe(750);
  });
});

// ---------------------------------------------------------------------------
// GET /api/fees/payments/:id — Get payment by ID
// ---------------------------------------------------------------------------

describe('GET /api/fees/payments/:id', () => {
  it('returns 401 when no auth token is provided', async () => {
    const { app } = createTestApp();
    const fakeId = '000000000000000000000001';

    await request(app)
      .get(`/api/fees/payments/${fakeId}`)
      .expect(401);
  });

  it('returns the correct payment when the ID exists', async () => {
    const school = await createSchoolRecord({ name: 'GetById School', code: 'GBY-MAIN', isDefault: true });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({ name: 'Class 9', section: 'D' });
    const student = await createStudentRecord({ name: 'GetById Student', classId: classRecord._id });

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

    await request(app)
      .get(`/api/fees/payments/${nonExistentId}`)
      .set(authHeaders)
      .expect(404);
  });

  it('returns 500 for a malformed payment ID', async () => {
    // Mongoose throws a CastError for an invalid ObjectId; the route's
    // catch block returns 500.
    const accountant = await createAccountant();
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .get('/api/fees/payments/not-a-valid-objectid')
      .set(authHeaders);

    expect(res.status).toBe(500);
  });

  it('multi-tenancy: School A admin cannot retrieve a payment belonging to School B', async () => {
    // The GET /:id route appends schoolId to the findOne query.
    // School B's payment is only visible to School B's accountant — not School A's.
    const schoolA = await createSchoolRecord({ name: 'GetId School A', code: 'GID-A', isDefault: true });
    const schoolB = await createSchoolRecord({ name: 'GetId School B', code: 'GID-B' });

    const accountantA = await createAccountant({ schoolId: schoolA._id });
    const accountantB = await createAccountant({ schoolId: schoolB._id });

    const classRecord = await createClassRecord({ name: 'Class 9', section: 'E' });
    const student = await createStudentRecord({ name: 'MT GetById Student', classId: classRecord._id });

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
    await request(app)
      .get(paymentPath)
      .set(authHeadersA)
      .expect(404);

    // School B accountant: should get 200.
    const authHeadersB = authHeadersFor(accountantB, 'accountant');
    const resB = await request(app)
      .get(paymentPath)
      .set(authHeadersB)
      .expect(200);

    expect(resB.body.amount).toBe(550);
  });

  it('populates the studentId field with student name and admissionId', async () => {
    const school = await createSchoolRecord({ name: 'Populate School', code: 'POP-MAIN', isDefault: true });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({ name: 'Class 10', section: 'D' });
    const student = await createStudentRecord({
      name: 'Populated Student',
      admissionId: 'ADM-POP-001',
      classId: classRecord._id,
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
    const school = await createSchoolRecord({ name: 'Fields School', code: 'FLD-MAIN', isDefault: true });
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
