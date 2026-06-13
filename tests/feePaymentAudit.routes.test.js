import mongoose from 'mongoose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Student, FeePaymentAudit } from '../database.js';
import FeeHead from '../models/FeeHead.js';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

// Create a staff user with the accountant permission role.
async function createAccountant(opts = {}) {
  return createStaffUser({
    name: 'Accounts User',
    staffRole: ['Accountant'],
    permissionRole: 'accountant',
    ...opts,
  });
}

// Create FeeHead documents scoped to a school
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
  return { tuition };
}

// Insert a StudentFeeStructure directly for tests
async function insertFeeStructureDirect(fields) {
  const { schoolId, ...rest } = fields;
  const doc = await StudentFeeStructure.create({
    ...rest,
    schoolId: schoolId ? new mongoose.Types.ObjectId(schoolId.toString()) : undefined,
  });
  return doc;
}

describe('Fee Payment Audit Trail', () => {
  it('creates audit log when a payment is recorded via /student-fees', async () => {
    const school = await createSchoolRecord({
      name: 'Audit School',
      code: 'AUD-01',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({
      name: 'Class 10',
      section: 'A',
      schoolId: school._id,
    });
    const { tuition } = await createFeeHeads(school._id, '10');

    const student = await createStudentRecord({
      name: 'Audit Student',
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
        amount: 2000,
        academicYear: '2025-26',
        feeHeadPayments: [{ feeHeadId: tuition._id.toString(), amount: 2000 }],
      })
      .expect(200);

    const auditLogs = await FeePaymentAudit.find({
      schoolId: school._id,
      studentId: student._id,
    }).lean();

    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].action).toBe('payment_recorded');
    expect(auditLogs[0].entityType).toBe('FeePayment');
    expect(auditLogs[0].context.amount).toBe(2000);
    expect(auditLogs[0].performedBy.toString()).toBe(accountant._id.toString());
    expect(auditLogs[0].changes.before.totalPaid).toBe(0);
    expect(auditLogs[0].changes.after.totalPaid).toBe(2000);
  });

  it('creates audit log when a discount is applied', async () => {
    const school = await createSchoolRecord({
      name: 'Discount Audit School',
      code: 'DAU-01',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({
      name: 'Class 10',
      section: 'B',
      schoolId: school._id,
    });

    const student = await createStudentRecord({
      name: 'Discount Audit Student',
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

    await request(app)
      .put(`/api/student-fees/student/${student._id}/discount`)
      .set(authHeaders)
      .send({ discountAmount: 3000, discountReason: 'Test scholarship', academicYear: '2025-26' })
      .expect(200);

    const auditLogs = await FeePaymentAudit.find({
      schoolId: school._id,
      studentId: student._id,
      action: 'discount_applied',
    }).lean();

    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].entityType).toBe('StudentFeeStructure');
    expect(auditLogs[0].changes.before.discountApplied).toBe(0);
    expect(auditLogs[0].changes.after.discountApplied).toBe(3000);
    expect(auditLogs[0].context.reason).toBe('Test scholarship');
  });

  it('GET /api/fees/audit returns paginated audit logs', async () => {
    const school = await createSchoolRecord({
      name: 'Audit List School',
      code: 'ALS-01',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({
      name: 'Class 10',
      section: 'C',
      schoolId: school._id,
    });
    const student = await createStudentRecord({
      name: 'Audit List Student',
      classId: classRecord._id,
      schoolId: school._id,
    });

    // Seed some audit logs
    await FeePaymentAudit.create({
      schoolId: school._id,
      entityType: 'FeePayment',
      entityId: new mongoose.Types.ObjectId(),
      action: 'payment_recorded',
      performedBy: accountant._id,
      performedByName: accountant.name,
      studentId: student._id,
      context: { amount: 1000, receiptNumber: 'RCP-2026-000001' },
    });

    await FeePaymentAudit.create({
      schoolId: school._id,
      entityType: 'FeePayment',
      entityId: new mongoose.Types.ObjectId(),
      action: 'payment_cancelled',
      performedBy: accountant._id,
      performedByName: accountant.name,
      studentId: student._id,
      context: { amount: 500, receiptNumber: 'RCP-2026-000002' },
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app).get('/api/fees/audit').set(authHeaders).expect(200);

    expect(Array.isArray(res.body.logs)).toBe(true);
    expect(res.body.logs).toHaveLength(2);
    expect(res.body.pagination.total).toBe(2);
    const actions = res.body.logs.map((l) => l.action);
    expect(actions).toContain('payment_recorded');
    expect(actions).toContain('payment_cancelled');
  });

  it('GET /api/fees/audit filters by studentId and action', async () => {
    const school = await createSchoolRecord({
      name: 'Filter Audit School',
      code: 'FAS-01',
      isDefault: true,
    });
    const accountant = await createAccountant({ schoolId: school._id });
    const classRecord = await createClassRecord({
      name: 'Class 10',
      section: 'D',
      schoolId: school._id,
    });
    const studentA = await createStudentRecord({
      name: 'Student A',
      classId: classRecord._id,
      schoolId: school._id,
    });
    const studentB = await createStudentRecord({
      name: 'Student B',
      classId: classRecord._id,
      schoolId: school._id,
    });

    await FeePaymentAudit.create({
      schoolId: school._id,
      entityType: 'FeePayment',
      entityId: new mongoose.Types.ObjectId(),
      action: 'payment_recorded',
      performedBy: accountant._id,
      studentId: studentA._id,
      context: { amount: 1000 },
    });

    await FeePaymentAudit.create({
      schoolId: school._id,
      entityType: 'FeePayment',
      entityId: new mongoose.Types.ObjectId(),
      action: 'payment_cancelled',
      performedBy: accountant._id,
      studentId: studentB._id,
      context: { amount: 500 },
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountant, 'accountant');

    const res = await request(app)
      .get('/api/fees/audit')
      .query({ studentId: studentA._id.toString(), action: 'payment_recorded' })
      .set(authHeaders)
      .expect(200);

    expect(res.body.logs).toHaveLength(1);
    expect(res.body.logs[0].action).toBe('payment_recorded');
    expect(res.body.logs[0].studentId._id.toString()).toBe(studentA._id.toString());
  });

  it('GET /api/fees/audit scopes by school (multi-tenancy)', async () => {
    const schoolA = await createSchoolRecord({
      name: 'School A Audit',
      code: 'SAA-01',
      isDefault: true,
    });
    const schoolB = await createSchoolRecord({ name: 'School B Audit', code: 'SBA-01' });
    const classRecord = await createClassRecord({
      name: 'Class 10',
      section: 'E',
      schoolId: schoolA._id,
    });
    const accountantA = await createAccountant({ schoolId: schoolA._id });

    await FeePaymentAudit.create({
      schoolId: schoolA._id,
      entityType: 'FeePayment',
      entityId: new mongoose.Types.ObjectId(),
      action: 'payment_recorded',
      performedBy: accountantA._id,
      context: { amount: 1000 },
    });

    await FeePaymentAudit.create({
      schoolId: schoolB._id,
      entityType: 'FeePayment',
      entityId: new mongoose.Types.ObjectId(),
      action: 'payment_recorded',
      performedBy: new mongoose.Types.ObjectId(),
      context: { amount: 2000 },
    });

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(accountantA, 'accountant');

    const res = await request(app).get('/api/fees/audit').set(authHeaders).expect(200);

    expect(res.body.logs).toHaveLength(1);
    expect(res.body.logs[0].context.amount).toBe(1000);
  });
});
