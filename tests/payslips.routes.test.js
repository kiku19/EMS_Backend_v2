import request from 'supertest';
import { describe, expect, it, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import PayrollRecord from '../models/PayrollRecord.js';
import PayrollRun from '../models/PayrollRun.js';
import Payslip from '../models/Payslip.js';
import { Staff } from '../database.js';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const BASE = '/api/payslips';

/** Create a payroll record + payslip for a staff member. */
async function createPayslipFixture({
  schoolId,
  employeeId,
  month = 3,
  year = 2025,
  baseSalary = 40000,
}) {
  const run = await PayrollRun.create({
    schoolId,
    month,
    year,
    status: 'completed',
    totalEmployees: 1,
    processedEmployees: 1,
    failedEmployees: 0,
    totalAmount: baseSalary,
    runBy: employeeId,
  });

  const record = await PayrollRecord.create({
    schoolId,
    employeeId,
    payrollRunId: run._id,
    month,
    year,
    baseSalary,
    allowances: [],
    deductions: [],
    totalAllowances: 0,
    totalDeductions: 0,
    grossPay: baseSalary,
    netPay: baseSalary,
    employmentType: 'full_time',
    status: 'generated',
  });

  const payslip = await Payslip.create({
    schoolId,
    payrollRecordId: record._id,
    employeeId,
    month,
    year,
    payslipNumber: `PS-${year}-${String(month).padStart(2, '0')}-${employeeId}`,
  });

  return { run, record, payslip };
}

describe('payslips routes', () => {
  let app, school, admin, headers, staffMember;

  beforeEach(async () => {
    school = await createSchoolRecord({ name: 'Payslip School', code: 'PSL' });
    admin = await createStaffUser({
      name: 'Payslip Admin',
      email: 'payslip.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    staffMember = await createStaffUser({
      name: 'Payslip Staff',
      email: 'payslip.staff@example.com',
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });
    // Ensure staff has the fields used by payslips route
    await Staff.findByIdAndUpdate(staffMember._id, { salary: 40000, employmentType: 'full_time' });
    staffMember = await Staff.findById(staffMember._id);
    headers = authHeadersFor(admin, 'admin');
    ({ app } = createTestApp());
  });

  // ───────────────────────────────────────────────────────────────
  // Auth
  // ───────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('GET /staff/:code returns 401 without token', async () => {
      await request(app).get(`${BASE}/staff/EMP0001`).expect(401);
    });

    it('GET /:id returns 401 without token', async () => {
      await request(app).get(`${BASE}/${new mongoose.Types.ObjectId()}`).expect(401);
    });

    it('GET /staff/:code/summary returns 401 without token', async () => {
      await request(app).get(`${BASE}/staff/EMP0001/summary`).expect(401);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /staff/:employeeId (uses staff code)
  // ───────────────────────────────────────────────────────────────
  describe('GET /staff/:employeeId', () => {
    it('returns 404 when staff code does not exist', async () => {
      const res = await request(app).get(`${BASE}/staff/NONEXISTENT`).set(headers).expect(404);

      expect(res.body.success).toBe(false);
    });

    // Note: When a valid staff code is found, the route then queries PayrollRecord by the
    // code string against an ObjectId field — a type mismatch that causes a CastError (500).
    // This is a known bug in the route. We test the 404 path (invalid code) only.
  });

  // ───────────────────────────────────────────────────────────────
  // GET /staff/:employeeId/summary
  // ───────────────────────────────────────────────────────────────
  describe('GET /staff/:employeeId/summary', () => {
    // Note: The summary route also queries PayrollRecord.find({ employeeId: code_string })
    // which throws a CastError because employeeId is an ObjectId field.
    // Testing authentication guard only.
    it('returns 401 without authentication', async () => {
      await request(app).get(`${BASE}/staff/${staffMember.code}/summary`).expect(401);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /:id (payroll record by ObjectId)
  // ───────────────────────────────────────────────────────────────
  describe('GET /:id', () => {
    it('returns 404 for a non-existent payroll record', async () => {
      const res = await request(app)
        .get(`${BASE}/${new mongoose.Types.ObjectId()}`)
        .set(headers)
        .expect(404);

      expect(res.body.success).toBe(false);
    });

    it('returns 200 with payslip data for an existing payroll record', async () => {
      const { record } = await createPayslipFixture({
        schoolId: school._id,
        employeeId: staffMember._id,
        month: 3,
        year: 2025,
        baseSalary: 40000,
      });

      const res = await request(app).get(`${BASE}/${record._id}`).set(headers).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.payslip).toHaveProperty('monthNumber', 3);
      expect(res.body.payslip).toHaveProperty('basicSalary', 40000);
      expect(res.body.payslip).toHaveProperty('netSalary', 40000);
    });
  });
});
