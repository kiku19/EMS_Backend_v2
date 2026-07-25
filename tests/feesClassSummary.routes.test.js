import request from 'supertest';
import { describe, expect, it, beforeEach } from 'vitest';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import { FeePayment } from '../database.js';
import {
  authHeadersFor,
  createSchoolRecord,
  createStaffUser,
  createClassRecord,
  createStudentRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const BASE = '/api/fees';
const YEAR = '2025-26';

describe('fees class-summary + invoice', () => {
  let app, school, admin, headers, classA, classB, students;

  beforeEach(async () => {
    school = await createSchoolRecord({ name: 'Summary School', code: 'SUM' });
    admin = await createStaffUser({
      name: 'Summary Admin',
      email: 'summary.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    headers = authHeadersFor(admin, 'admin');
    ({ app } = createTestApp());

    classA = await createClassRecord({
      schoolId: school._id,
      name: 'Class 1',
      section: 'A',
      academicYear: YEAR,
    });
    classB = await createClassRecord({
      schoolId: school._id,
      name: 'Class 1',
      section: 'B',
      academicYear: YEAR,
    });

    students = await Promise.all([
      createStudentRecord({ schoolId: school._id, classId: classA._id, academicYear: YEAR }),
      createStudentRecord({ schoolId: school._id, classId: classA._id, academicYear: YEAR }),
      createStudentRecord({ schoolId: school._id, classId: classB._id, academicYear: YEAR }),
    ]);

    await StudentFeeStructure.create([
      {
        schoolId: school._id,
        academicYear: YEAR,
        classId: classA._id,
        studentId: students[0]._id,
        totalFee: 20000,
        totalPaid: 10000,
        totalBalance: 10000,
        overallStatus: 'partial',
        feeHeads: [],
      },
      {
        schoolId: school._id,
        academicYear: YEAR,
        classId: classA._id,
        studentId: students[1]._id,
        totalFee: 20000,
        totalPaid: 20000,
        totalBalance: 0,
        overallStatus: 'paid',
        feeHeads: [],
      },
      {
        schoolId: school._id,
        academicYear: YEAR,
        classId: classB._id,
        studentId: students[2]._id,
        totalFee: 20000,
        totalPaid: 0,
        totalBalance: 20000,
        overallStatus: 'overdue',
        feeHeads: [],
      },
    ]);
  });

  describe('GET /class-summary', () => {
    it('returns 401 without a token', async () => {
      await request(app).get(`${BASE}/class-summary`).expect(401);
    });

    it('returns section-level rows with aggregated totals', async () => {
      const res = await request(app)
        .get(`${BASE}/class-summary?academicYear=${YEAR}`)
        .set(headers)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      // One row per class+section doc.
      const sectionA = res.body.find((r) => r.section === 'A');
      const sectionB = res.body.find((r) => r.section === 'B');
      expect(sectionA).toBeDefined();
      expect(sectionB).toBeDefined();

      expect(sectionA.studentCount).toBe(2);
      expect(sectionA.feeConfiguredCount).toBe(2);
      expect(sectionA.totalExpected).toBe(40000);
      expect(sectionA.totalCollected).toBe(30000);
      expect(sectionA.fullyPaidCount).toBe(1);
      expect(sectionA.partialCount).toBe(1);

      expect(sectionB.studentCount).toBe(1);
      expect(sectionB.overdueCount).toBe(1);
      expect(sectionB.totalBalance).toBe(20000);
    });

    it('counts enrolled students separately from fee-configured students', async () => {
      await createStudentRecord({
        schoolId: school._id,
        classId: classA._id,
        academicYear: YEAR,
        name: 'Needs fee setup',
      });

      const res = await request(app)
        .get(`${BASE}/class-summary?academicYear=${YEAR}`)
        .set(headers)
        .expect(200);

      const sectionA = res.body.find((row) => row.section === 'A');
      expect(sectionA.studentCount).toBe(3);
      expect(sectionA.feeConfiguredCount).toBe(2);
      expect(sectionA.unconfiguredStudentCount).toBe(1);
    });

    it('sorts rows by numeric class then section', async () => {
      await createClassRecord({
        schoolId: school._id,
        name: 'Class 2',
        section: 'A',
        academicYear: YEAR,
      });

      const res = await request(app)
        .get(`${BASE}/class-summary?academicYear=${YEAR}`)
        .set(headers)
        .expect(200);

      const names = res.body.map((r) => `${r.className}-${r.section}`);
      // "Class 1" sections come before "Class 2"
      const firstClass2 = names.findIndex((n) => n.startsWith('Class 2'));
      const lastClass1 = names.map((n) => n.startsWith('Class 1')).lastIndexOf(true);
      expect(firstClass2).toBeGreaterThan(lastClass1);
    });

    it('filters by classId', async () => {
      const res = await request(app)
        .get(`${BASE}/class-summary?academicYear=${YEAR}&classId=${classA._id}`)
        .set(headers)
        .expect(200);

      expect(res.body.length).toBe(1);
      expect(res.body[0].section).toBe('A');
    });

    it('returns a structured validation error for a malformed classId', async () => {
      const res = await request(app)
        .get(`${BASE}/class-summary?academicYear=${YEAR}&classId=not-an-id`)
        .set(headers)
        .expect(400);

      expect(res.body.error).toBe('Invalid query parameters');
      expect(res.body.details.classId).toBeDefined();
    });
  });

  describe('invoice PDF + send stub', () => {
    let payment;

    beforeEach(async () => {
      payment = await FeePayment.create({
        schoolId: school._id,
        studentId: students[0]._id,
        classId: classA._id,
        academicYear: YEAR,
        receiptNumber: 'RCP-2025-000001',
        paymentDate: '2025-07-01',
        amount: 10000,
        paymentMode: 'cash',
        status: 'completed',
        feeHeads: [],
      });
    });

    it('GET /payments/:id/invoice.pdf streams a PDF', async () => {
      const res = await request(app)
        .get(`${BASE}/payments/${payment._id}/invoice.pdf`)
        .set(headers)
        .expect(200);

      expect(res.headers['content-type']).toBe('application/pdf');
      // PDFs always start with %PDF
      expect(res.body.length).toBeGreaterThan(1000);
    });

    it('GET /payments/:id/invoice returns JSON invoice data', async () => {
      const res = await request(app)
        .get(`${BASE}/payments/${payment._id}/invoice`)
        .set(headers)
        .expect(200);

      expect(res.body.student.name).toBeDefined();
      expect(res.body.invoice).toBeDefined();
      expect(Array.isArray(res.body.payments)).toBe(true);
    });

    it('POST /payments/:id/send-invoice reports delivery failures truthfully', async () => {
      const res = await request(app)
        .post(`${BASE}/payments/${payment._id}/send-invoice`)
        .set(headers)
        .send({ channels: ['whatsapp', 'email'] })
        .expect(502);

      expect(res.body.ok).toBe(false);
      expect(res.body.delivered).toEqual([]);
      expect(res.body.failed).toEqual(['whatsapp', 'email']);
      expect(res.body.results.email.error).toMatch(/email address/i);
      expect(res.body.results.whatsapp.errors.join(' ')).toMatch(/WhatsApp/i);
    });

    it('POST /payments/:id/send-invoice validates requested channels', async () => {
      const res = await request(app)
        .post(`${BASE}/payments/${payment._id}/send-invoice`)
        .set(headers)
        .send({ channels: ['carrier-pigeon'] })
        .expect(400);

      expect(res.body.error).toBe('Validation failed');
    });

    it('GET /payments/:id/invoice.pdf returns 404 for missing payment', async () => {
      const missing = '64b7f8f8f8f8f8f8f8f8f8f8';
      await request(app).get(`${BASE}/payments/${missing}/invoice.pdf`).set(headers).expect(404);
    });
  });
});
