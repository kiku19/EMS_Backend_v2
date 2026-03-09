import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { FeePayment, Student } from '../database.js';
import { authHeadersFor, createClassRecord, createStaffUser, createStudentRecord } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

describe('fees routes', () => {
  it('creates a payment record and updates the student fee totals', async () => {
    const accountant = await createStaffUser({
      name: 'Accounts User',
      email: 'accounts@example.com',
      staffRole: ['Accountant'],
      permissionRole: 'accountant',
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
});
