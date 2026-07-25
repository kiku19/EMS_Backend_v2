import request from 'supertest';
import { describe, expect, it, beforeEach } from 'vitest';
import FeeHead from '../models/FeeHead.js';
import FeeRefund from '../models/FeeRefund.js';
import FeePayment from '../models/FeePayment.js';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import Exam from '../models/Exam.js';
import Result from '../models/Result.js';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';
import {
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
  authHeadersFor,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

// Regression tests for the data-loss-leak fixes (DATA_LOSS_AUDIT_2026-07-06)
// in the Fees and Academics modules.

// ─── F7: FeeHead classified fields (headType/customType/applicableStreams) ──
describe('F7: fee-head classified fields persist', () => {
  let app, school, admin, headers;

  beforeEach(async () => {
    school = await createSchoolRecord({ name: 'F7 School', code: 'F7' });
    admin = await createStaffUser({
      name: 'F7 Admin',
      email: 'f7@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    headers = authHeadersFor(admin, 'admin');
    ({ app } = createTestApp());
  });

  it('persists headType, customType, applicableStreams on create', async () => {
    const res = await request(app)
      .post('/api/fee-heads')
      .set(headers)
      .send({
        name: 'Lab Fee',
        category: 'Academic',
        amount: 1500,
        applicableClasses: ['11', '12'],
        frequency: 'yearly',
        headType: 'lab',
        customType: 'Special Lab',
        applicableStreams: ['Science'],
      })
      .expect(201);

    expect(res.body.feeHead.headType).toBe('lab');
    expect(res.body.feeHead.customType).toBe('Special Lab');
    expect(res.body.feeHead.applicableStreams).toEqual(['Science']);

    const fetched = await FeeHead.findById(res.body.feeHead._id).lean();
    expect(fetched.headType).toBe('lab');
    expect(fetched.customType).toBe('Special Lab');
    expect(fetched.applicableStreams).toEqual(['Science']);
  });

  it('persists headType on update without wiping other fields', async () => {
    const created = await request(app)
      .post('/api/fee-heads')
      .set(headers)
      .send({
        name: 'Sports Fee',
        category: 'Extra-curricular',
        amount: 800,
        applicableClasses: ['9'],
        frequency: 'yearly',
        headType: 'sports',
        applicableStreams: ['All'],
      })
      .expect(201);

    await request(app)
      .put(`/api/fee-heads/${created.body.feeHead._id}`)
      .set(headers)
      .send({ headType: 'extra_curricular', customType: 'Inter-school' })
      .expect(200);

    const fetched = await FeeHead.findById(created.body.feeHead._id).lean();
    expect(fetched.headType).toBe('extra_curricular');
    expect(fetched.customType).toBe('Inter-school');
    // existing fields untouched
    expect(fetched.applicableStreams).toEqual(['All']);
    expect(fetched.name).toBe('Sports Fee');
  });

  it('F8: description round-trips on update instead of being wiped to ""', async () => {
    const created = await request(app)
      .post('/api/fee-heads')
      .set(headers)
      .send({
        name: 'Library Fee',
        category: 'Academic',
        amount: 300,
        applicableClasses: ['5'],
        description: 'Annual library maintenance',
      })
      .expect(201);

    await request(app)
      .put(`/api/fee-heads/${created.body.feeHead._id}`)
      .set(headers)
      .send({ amount: 400 })
      .expect(200);

    const fetched = await FeeHead.findById(created.body.feeHead._id).lean();
    // Previously the dashboard hard-coded description: "" on every save.
    expect(fetched.description).toBe('Annual library maintenance');
  });
});

// ─── Refund: refundMode enum (online/card/upi) + settlement details (F6) ───
describe('refund enum + settlement details (F6 + hygiene)', () => {
  let app, school, admin, headers, classRecord, student;

  beforeEach(async () => {
    school = await createSchoolRecord({ name: 'Refund School', code: 'RF' });
    admin = await createStaffUser({
      name: 'RF Admin',
      email: 'rf@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    headers = authHeadersFor(admin, 'admin');
    ({ app } = createTestApp());
    classRecord = await createClassRecord({ schoolId: school._id });
    student = await createStudentRecord({
      schoolId: school._id,
      classId: classRecord._id,
    });
  });

  it('accepts refundMode online/card/upi (model enum extended to match Zod)', async () => {
    // Seed a completed payment so the refundable-balance check passes.
    await FeePayment.create({
      schoolId: school._id,
      studentId: student._id,
      classId: classRecord._id,
      academicYear: CURRENT_ACADEMIC_YEAR,
      receiptNumber: 'R-ENUM-1',
      amount: 1000,
      paymentDate: new Date().toISOString().split('T')[0],
      paymentMode: 'cash',
      status: 'completed',
    });

    for (const mode of ['online', 'card', 'upi', 'cash', 'cheque', 'dd', 'bank_transfer']) {
      const res = await request(app)
        .post('/api/fees/refunds')
        .set(headers)
        .send({
          studentId: student._id.toString(),
          classId: classRecord._id.toString(),
          amount: 10,
          reason: 'Test refund reason for mode acceptance',
          refundMode: mode,
          ...(['online', 'card', 'upi', 'bank_transfer'].includes(mode)
            ? { transactionId: `TXN-${mode}` }
            : {}),
          ...(['cheque', 'dd', 'bank_transfer'].includes(mode) ? { bankName: 'Test Bank' } : {}),
          ...(['cheque', 'dd'].includes(mode) ? { chequeNumber: `${mode.toUpperCase()}-123` } : {}),
          ...(mode === 'bank_transfer' ? { accountNumber: 'ACCT-123' } : {}),
        })
        .expect(201);
      expect(res.body.refundNumber || res.body._id).toBeTruthy();
    }
  });

  it('persists settlement details (cheque/bank/account/transactionId) on create', async () => {
    await FeePayment.create({
      schoolId: school._id,
      studentId: student._id,
      classId: classRecord._id,
      academicYear: CURRENT_ACADEMIC_YEAR,
      receiptNumber: 'R-SETTLE-1',
      amount: 1000,
      paymentDate: new Date().toISOString().split('T')[0],
      paymentMode: 'cash',
      status: 'completed',
    });

    const res = await request(app)
      .post('/api/fees/refunds')
      .set(headers)
      .send({
        studentId: student._id.toString(),
        classId: classRecord._id.toString(),
        amount: 50,
        reason: 'Duplicate payment refund with settlement details',
        refundMode: 'cheque',
        chequeNumber: 'CHQ123456',
        bankName: 'Test Bank',
        accountNumber: 'ACCT9999',
        transactionId: 'TXN0001',
        refundDate: '2024-03-15',
      })
      .expect(201);

    const refund = await FeeRefund.findById(res.body._id || res.body.refund._id).lean();
    expect(refund.chequeNumber).toBe('CHQ123456');
    expect(refund.bankName).toBe('Test Bank');
    expect(refund.accountNumber).toBe('ACCT9999');
    expect(refund.transactionId).toBe('TXN0001');
    // F6: refundDate honored, not forced to today.
    expect(refund.refundDate).toBe('2024-03-15');
  });
});

// ─── Academics: exam type enum (A4) + results absent (A8) ─────────────────
describe('academics leak fixes (A4/A8)', () => {
  let app, school, admin, headers, classRecord;

  beforeEach(async () => {
    school = await createSchoolRecord({ name: 'Acad School', code: 'AC' });
    admin = await createStaffUser({
      name: 'Acad Admin',
      email: 'acad@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    headers = authHeadersFor(admin, 'admin');
    ({ app } = createTestApp());
    classRecord = await createClassRecord({ schoolId: school._id });
  });

  it('A4: accepts written/practical/oral as exam type (staff-app categories)', async () => {
    const futureDate = new Date(Date.now() + 86400000 * 7).toISOString().split('T')[0];
    for (const type of ['written', 'practical', 'oral']) {
      const res = await request(app)
        .post('/api/exams')
        .set(headers)
        .send({
          name: `Exam ${type}`,
          type,
          classId: classRecord._id.toString(),
          academicYear: CURRENT_ACADEMIC_YEAR,
          startDate: futureDate,
        })
        .expect(201);
      expect(res.body.type).toBe(type);
    }
  });

  it('A8: POST /results records absent status when sent', async () => {
    const futureDate = new Date(Date.now() + 86400000 * 7).toISOString().split('T')[0];
    const examRes = await request(app)
      .post('/api/exams')
      .set(headers)
      .send({
        name: 'Absent Exam',
        type: 'unit_test',
        classId: classRecord._id.toString(),
        academicYear: CURRENT_ACADEMIC_YEAR,
        startDate: futureDate,
        maxMarks: 100,
        passingMarks: 35,
      })
      .expect(201);

    const student = await createStudentRecord({
      schoolId: school._id,
      classId: classRecord._id,
    });

    const res = await request(app)
      .post('/api/results')
      .set(headers)
      .send({
        examId: examRes.body._id,
        studentId: student._id.toString(),
        classId: classRecord._id.toString(),
        status: 'absent',
      })
      .expect(201);

    expect(res.body.status).toBe('absent');
    const result = await Result.findById(res.body._id).lean();
    expect(result.status).toBe('absent');
  });
});
