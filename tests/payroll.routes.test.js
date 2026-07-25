import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import PayrollRecord from '../models/PayrollRecord.js';
import PayrollRun from '../models/PayrollRun.js';
import Payslip from '../models/Payslip.js';
import SalaryAdjustment from '../models/SalaryAdjustment.js';
import TeacherLeave from '../models/TeacherLeave.js';
import SchoolSettings from '../models/SchoolSettings.js';
import UserPermission from '../models/UserPermission.js';
import { Staff } from '../database.js';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const BASE = '/api/payroll';

afterEach(() => {
  vi.restoreAllMocks();
});

let payrollStaffSeq = 0;

/** Create a staff member with a salary for payroll testing. */
async function createPayrollStaff({ schoolId, name, salary = 50000, email }) {
  payrollStaffSeq += 1;
  const staff = await createStaffUser({
    name,
    email,
    schoolId,
    staffRole: ['Teacher'],
    permissionRole: 'teacher',
  });
  await Staff.findByIdAndUpdate(staff._id, {
    salary,
    employmentType: 'full_time',
    status: 'active',
    username: `payroll_staff_${payrollStaffSeq}_${Date.now()}`,
  });
  return Staff.findById(staff._id);
}

/** Create a payroll record directly in the DB. */
async function createPayrollRecord({
  schoolId,
  employeeId,
  month,
  year,
  baseSalary = 50000,
  status = 'generated',
}) {
  let run = await PayrollRun.findOne({ schoolId, month, year });
  if (!run) {
    run = await PayrollRun.create({
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
  }

  return PayrollRecord.create({
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
    status,
  });
}

async function createPayslipForRecord(record) {
  return Payslip.create({
    schoolId: record.schoolId,
    payrollRecordId: record._id,
    employeeId: record.employeeId,
    month: record.month,
    year: record.year,
    payslipNumber: `TEST-PS-${record.year}-${record.month}-${record.employeeId}`,
  });
}

describe('payroll routes', () => {
  let app, school, admin, headers;

  beforeEach(async () => {
    school = await createSchoolRecord({ name: 'Payroll School', code: 'PAY' });
    admin = await createStaffUser({
      name: 'Payroll Admin',
      email: 'payroll.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    headers = authHeadersFor(admin, 'admin');
    ({ app } = createTestApp());
  });

  // ───────────────────────────────────────────────────────────────
  // Auth
  // ───────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('GET /dashboard/:month/:year returns 401 without token', async () => {
      await request(app).get(`${BASE}/dashboard/3/2025`).expect(401);
    });

    it('GET /records returns 401 without token', async () => {
      await request(app).get(`${BASE}/records`).expect(401);
    });

    it('POST /validate returns 401 without token', async () => {
      await request(app)
        .post(`${BASE}/validate`)
        .send({ month: 3, year: 2025, employeeIds: [] })
        .expect(401);
    });

    it('POST /run returns 401 without token', async () => {
      await request(app)
        .post(`${BASE}/run`)
        .send({ month: 3, year: 2025, employeeIds: [] })
        .expect(401);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /dashboard/:month/:year
  // ───────────────────────────────────────────────────────────────
  describe('GET /dashboard/:month/:year', () => {
    it('returns dashboard KPIs for a month with no records', async () => {
      const res = await request(app).get(`${BASE}/dashboard/1/2025`).set(headers).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('totalPayout');
      expect(res.body.data).toHaveProperty('pendingCount');
      expect(res.body.data).toHaveProperty('paidCount');
      expect(res.body.data.totalEmployees).toBe(0);
    });

    it('returns correct KPIs when payroll records exist', async () => {
      const emp = await createPayrollStaff({
        schoolId: school._id,
        name: 'Dashboard Emp',
        salary: 40000,
        email: 'dash.emp@example.com',
      });

      await createPayrollRecord({
        schoolId: school._id,
        employeeId: emp._id,
        month: 2,
        year: 2025,
        baseSalary: 40000,
        status: 'paid',
      });

      const res = await request(app).get(`${BASE}/dashboard/2/2025`).set(headers).expect(200);

      expect(res.body.data.totalEmployees).toBe(1);
      expect(res.body.data.paidCount).toBe(1);
      expect(res.body.data.totalPayout).toBe(40000);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /records
  // ───────────────────────────────────────────────────────────────
  describe('GET /records', () => {
    it('returns paginated payroll records', async () => {
      const emp = await createPayrollStaff({
        schoolId: school._id,
        name: 'Records Emp',
        salary: 30000,
        email: 'rec.emp@example.com',
      });
      await createPayrollRecord({
        schoolId: school._id,
        employeeId: emp._id,
        month: 3,
        year: 2025,
        baseSalary: 30000,
      });

      const res = await request(app)
        .get(`${BASE}/records?month=3&year=2025`)
        .set(headers)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.pagination).toHaveProperty('total', 1);
    });

    it('returns empty when no records match filters', async () => {
      const res = await request(app)
        .get(`${BASE}/records?month=12&year=2099`)
        .set(headers)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(0);
    });

    it('filters by status', async () => {
      const emp1 = await createPayrollStaff({
        schoolId: school._id,
        name: 'Paid Emp',
        salary: 20000,
        email: 'paid.emp@example.com',
      });
      const emp2 = await createPayrollStaff({
        schoolId: school._id,
        name: 'Gen Emp',
        salary: 20000,
        email: 'gen.emp@example.com',
      });

      await createPayrollRecord({
        schoolId: school._id,
        employeeId: emp1._id,
        month: 4,
        year: 2025,
        baseSalary: 20000,
        status: 'paid',
      });
      await createPayrollRecord({
        schoolId: school._id,
        employeeId: emp2._id,
        month: 4,
        year: 2025,
        baseSalary: 20000,
        status: 'generated',
      });

      const res = await request(app)
        .get(`${BASE}/records?month=4&year=2025&status=paid`)
        .set(headers)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].status).toBe('paid');
    });
  });

  // ───────────────────────────────────────────────────────────────
  // POST /validate
  // ───────────────────────────────────────────────────────────────
  describe('POST /validate', () => {
    it('returns 400 when no employeeIds are provided', async () => {
      await request(app)
        .post(`${BASE}/validate`)
        .set(headers)
        .send({ month: 3, year: 2025, employeeIds: [] })
        .expect(400);
    });

    it('validates staff and returns valid/invalid lists', async () => {
      const emp = await createPayrollStaff({
        schoolId: school._id,
        name: 'Valid Emp',
        salary: 45000,
        email: 'valid.emp@example.com',
      });

      // Staff without salary (default from factory has no salary set)
      const noSalaryStaff = await createStaffUser({
        name: 'No Salary',
        email: 'no.salary@example.com',
        schoolId: school._id,
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
      });

      const currentDate = new Date();
      const month = currentDate.getMonth() + 1;
      const year = currentDate.getFullYear();

      const res = await request(app)
        .post(`${BASE}/validate`)
        .set(headers)
        .send({
          month,
          year,
          employeeIds: [emp._id.toString(), noSalaryStaff._id.toString()],
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.valid).toHaveLength(1);
      expect(res.body.data.valid[0].salary).toBe(45000);
    });

    it('uses a template breakdown total when a legacy profile salary is zero', async () => {
      const employee = await createPayrollStaff({
        schoolId: school._id,
        name: 'Template Salary Employee',
        salary: 0,
        email: 'template.salary@example.com',
      });
      await Staff.findByIdAndUpdate(employee._id, {
        salary: 0,
        salaryTemplate: 'Teacher Standard',
        salaryBreakdown: [
          { component: 'Basic', amount: 30000 },
          { component: 'HRA', amount: 5000 },
        ],
      });

      const response = await request(app)
        .post(`${BASE}/validate`)
        .set(headers)
        .send({ month: 3, year: 2025, employeeIds: [employee._id.toString()] })
        .expect(200);

      expect(response.body.data.valid[0].salary).toBe(35000);
    });

    it('returns 400 when month/year is in the future', async () => {
      const emp = await createPayrollStaff({
        schoolId: school._id,
        name: 'Future Emp',
        salary: 30000,
        email: 'future.emp@example.com',
      });

      await request(app)
        .post(`${BASE}/validate`)
        .set(headers)
        .send({
          month: 1,
          year: 2099,
          employeeIds: [emp._id.toString()],
        })
        .expect(400);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // POST /run — run payroll
  // ───────────────────────────────────────────────────────────────
  describe('POST /run', () => {
    it('returns 400 when no employeeIds are provided', async () => {
      const currentDate = new Date();
      await request(app)
        .post(`${BASE}/run`)
        .set(headers)
        .send({
          month: currentDate.getMonth() + 1,
          year: currentDate.getFullYear(),
          employeeIds: [],
        })
        .expect(400);
    });

    it('returns 400 when month/year is in the future', async () => {
      const emp = await createPayrollStaff({
        schoolId: school._id,
        name: 'Run Future',
        salary: 50000,
        email: 'run.future@example.com',
      });

      await request(app)
        .post(`${BASE}/run`)
        .set(headers)
        .send({ month: 1, year: 2099, employeeIds: [emp._id.toString()] })
        .expect(400);
    });

    it('runs payroll and creates records for employees with salary', async () => {
      const emp = await createPayrollStaff({
        schoolId: school._id,
        name: 'Run Emp',
        salary: 60000,
        email: 'run.emp@example.com',
      });

      const currentDate = new Date();
      const month = currentDate.getMonth() + 1;
      const year = currentDate.getFullYear();

      const res = await request(app)
        .post(`${BASE}/run`)
        .set(headers)
        .send({ month, year, employeeIds: [emp._id.toString()] })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.results.success).toContain(emp._id.toString());

      const record = await PayrollRecord.findOne({ employeeId: emp._id, month, year });
      expect(record).not.toBeNull();
      expect(record.baseSalary).toBe(60000);
      expect(record.netPay).toBe(60000);
    });

    it('allows only one concurrent request to acquire a monthly payroll run', async () => {
      const emp = await createPayrollStaff({
        schoolId: school._id,
        name: 'Concurrent Run Employee',
        salary: 61000,
        email: 'concurrent.run@example.com',
      });
      const currentDate = new Date();
      const month = currentDate.getMonth() + 1;
      const year = currentDate.getFullYear();
      const payload = { month, year, employeeIds: [emp._id.toString()] };

      let signalFirstRecord;
      const firstReachedRecord = new Promise((resolve) => {
        signalFirstRecord = resolve;
      });
      let releaseFirstRecord;
      const holdFirstRecord = new Promise((resolve) => {
        releaseFirstRecord = resolve;
      });
      const originalFindOneAndUpdate = PayrollRecord.findOneAndUpdate.bind(PayrollRecord);
      let recordAcquisitions = 0;
      vi.spyOn(PayrollRecord, 'findOneAndUpdate').mockImplementation((...args) => {
        recordAcquisitions += 1;
        if (recordAcquisitions === 1) {
          signalFirstRecord();
          return holdFirstRecord.then(() => originalFindOneAndUpdate(...args));
        }
        return originalFindOneAndUpdate(...args);
      });

      const firstRequest = request(app)
        .post(`${BASE}/run`)
        .set(headers)
        .send(payload)
        .then((response) => response);
      await firstReachedRecord;

      const competingResponse = await request(app).post(`${BASE}/run`).set(headers).send(payload);
      releaseFirstRecord();
      const winningResponse = await firstRequest;

      expect(winningResponse.status).toBe(200);
      expect(competingResponse.status).toBe(409);
      expect(competingResponse.body.error).toMatch(/currently being processed/i);
      expect(await PayrollRun.countDocuments({ schoolId: school._id, month, year })).toBe(1);
      expect(
        await PayrollRecord.countDocuments({
          schoolId: school._id,
          employeeId: emp._id,
          month,
          year,
        })
      ).toBe(1);
      expect(
        await Payslip.countDocuments({
          schoolId: school._id,
          employeeId: emp._id,
          month,
          year,
        })
      ).toBe(1);
    });

    it('does not deduct paid leave and counts unpaid leave only on configured working days', async () => {
      const paidLeaveEmployee = await createPayrollStaff({
        schoolId: school._id,
        name: 'Paid Leave Employee',
        salary: 60000,
        email: 'paid.leave@example.com',
      });
      const unpaidLeaveEmployee = await createPayrollStaff({
        schoolId: school._id,
        name: 'Unpaid Leave Employee',
        salary: 60000,
        email: 'unpaid.leave@example.com',
      });
      const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();
      const leaveStart = new Date(Date.UTC(year, month - 1, 1));
      const leaveEnd = new Date(Date.UTC(year, month - 1, 7));

      await SchoolSettings.create({
        schoolId: school._id,
        workingDays: ['Mon'],
        leaveTypes: [
          { name: 'Sick', quota: 12, paid: true },
          { name: 'Unpaid', quota: 12, paid: false },
        ],
      });
      await TeacherLeave.create([
        {
          schoolId: school._id,
          teacherId: paidLeaveEmployee._id,
          leaveType: 'Sick',
          reason: 'Recovery',
          startDate: leaveStart,
          endDate: leaveEnd,
          days: 7,
          status: 'approved',
        },
        {
          schoolId: school._id,
          teacherId: unpaidLeaveEmployee._id,
          leaveType: 'Unpaid',
          reason: 'Personal',
          startDate: leaveStart,
          endDate: leaveEnd,
          days: 7,
          status: 'approved',
        },
      ]);

      await request(app)
        .post(`${BASE}/run`)
        .set(headers)
        .send({
          month,
          year,
          employeeIds: [paidLeaveEmployee._id.toString(), unpaidLeaveEmployee._id.toString()],
        })
        .expect(200);

      const paidLeaveRecord = await PayrollRecord.findOne({
        schoolId: school._id,
        employeeId: paidLeaveEmployee._id,
        month,
        year,
      });
      const unpaidLeaveRecord = await PayrollRecord.findOne({
        schoolId: school._id,
        employeeId: unpaidLeaveEmployee._id,
        month,
        year,
      });

      expect(paidLeaveRecord.deductions).toHaveLength(0);
      expect(paidLeaveRecord.netPay).toBe(60000);
      expect(unpaidLeaveRecord.deductions).toHaveLength(1);
      expect(unpaidLeaveRecord.deductions[0].type).toBe('Leave Deduction');
      expect(unpaidLeaveRecord.deductions[0].description).toMatch(/^1 unpaid working leave day/);
      expect(unpaidLeaveRecord.netPay).toBeGreaterThan(0);
    });

    it('does not apply a salary adjustment stored under another school', async () => {
      const emp = await createPayrollStaff({
        schoolId: school._id,
        name: 'Tenant Safe Employee',
        salary: 50000,
        email: 'tenant.safe@example.com',
      });
      const otherSchool = await createSchoolRecord({ name: 'Other Payroll School' });
      const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();
      await SalaryAdjustment.create({
        schoolId: otherSchool._id,
        employeeId: emp._id,
        type: 'allowance',
        category: 'Cross-tenant allowance',
        amount: 99999,
        effectiveMonth: month,
        effectiveYear: year,
      });

      await request(app)
        .post(`${BASE}/run`)
        .set(headers)
        .send({ month, year, employeeIds: [emp._id.toString()] })
        .expect(200);

      const record = await PayrollRecord.findOne({
        schoolId: school._id,
        employeeId: emp._id,
        month,
        year,
      });
      expect(record.allowances).toHaveLength(0);
      expect(record.netPay).toBe(50000);
    });
  });

  describe('POST /fix-salaries', () => {
    it('is not available and cannot mass-assign default salaries', async () => {
      const emp = await createPayrollStaff({
        schoolId: school._id,
        name: 'No Mass Salary Employee',
        salary: 0,
        email: 'no.mass.salary@example.com',
      });

      await request(app)
        .post(`${BASE}/fix-salaries`)
        .set(headers)
        .send({ defaultSalary: 50000 })
        .expect(404);

      const unchanged = await Staff.findById(emp._id).lean();
      expect(unchanged.salary).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /records/:id/pay — mark as paid
  // ───────────────────────────────────────────────────────────────
  describe('PUT /records/:id/pay', () => {
    it('marks a payroll record as paid and locks it', async () => {
      const emp = await createPayrollStaff({
        schoolId: school._id,
        name: 'Pay Emp',
        salary: 35000,
        email: 'pay.emp@example.com',
      });
      const record = await createPayrollRecord({
        schoolId: school._id,
        employeeId: emp._id,
        month: 5,
        year: 2025,
        baseSalary: 35000,
      });

      const res = await request(app)
        .put(`${BASE}/records/${record._id}/pay`)
        .set(headers)
        .send({ paymentMethod: 'bank_transfer', paymentReference: 'TXN-001' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('paid');
      expect(res.body.data.isLocked).toBe(true);
      expect(res.body.data.paymentMethod).toBe('bank_transfer');
      expect(res.body.paymentState).toBe('recorded');
      expect(res.body.disbursementInitiated).toBe(false);
      expect(res.body.message).toMatch(/No bank or payment-provider transfer was initiated/i);
      const run = await PayrollRun.findOne({ schoolId: school._id, month: 5, year: 2025 }).lean();
      expect(run.totalPaid).toBe(35000);
      expect(run.totalPending).toBe(0);
    });

    it('returns 404 for a non-existent record', async () => {
      await request(app)
        .put(`${BASE}/records/${new mongoose.Types.ObjectId()}/pay`)
        .set(headers)
        .send({ paymentMethod: 'cash' })
        .expect(404);
    });

    it('returns 400 when record is already locked', async () => {
      const emp = await createPayrollStaff({
        schoolId: school._id,
        name: 'Locked Emp',
        salary: 25000,
        email: 'locked.emp@example.com',
      });
      const record = await createPayrollRecord({
        schoolId: school._id,
        employeeId: emp._id,
        month: 6,
        year: 2025,
        baseSalary: 25000,
        status: 'paid',
      });

      // Lock the record manually
      await PayrollRecord.findByIdAndUpdate(record._id, { isLocked: true });

      await request(app)
        .put(`${BASE}/records/${record._id}/pay`)
        .set(headers)
        .send({ paymentMethod: 'cash' })
        .expect(400);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /records/:id — update payroll record (admin only)
  // ───────────────────────────────────────────────────────────────
  describe('PUT /records/:id (admin edit)', () => {
    it('rejects a null allowance amount (Zod) so grossPay/netPay can never be NaN', async () => {
      const emp = await createPayrollStaff({
        schoolId: school._id,
        name: 'Null Amt Emp',
        salary: 30000,
        email: 'nullamt.emp@example.com',
      });
      const record = await createPayrollRecord({
        schoolId: school._id,
        employeeId: emp._id,
        month: 9,
        year: 2025,
        baseSalary: 30000,
      });

      const res = await request(app)
        .put(`${BASE}/records/${record._id}`)
        .set(headers)
        .send({
          allowances: [{ type: 'HRA', amount: null }],
        })
        .expect(400);

      expect(res.body.error).toBeDefined();

      // Record untouched
      const after = await PayrollRecord.findById(record._id).lean();
      expect(Number.isFinite(after.grossPay)).toBe(true);
      expect(Number.isFinite(after.netPay)).toBe(true);
      expect(after.allowances).toEqual([]);
    });

    it('rejects an unknown status enum (Zod)', async () => {
      const emp = await createPayrollStaff({
        schoolId: school._id,
        name: 'Bad Status Emp',
        salary: 20000,
        email: 'badstatus.emp@example.com',
      });
      const record = await createPayrollRecord({
        schoolId: school._id,
        employeeId: emp._id,
        month: 9,
        year: 2025,
        baseSalary: 20000,
      });

      await request(app)
        .put(`${BASE}/records/${record._id}`)
        .set(headers)
        .send({ status: 'rocketing-to-the-moon' })
        .expect(400);
    });

    it('accepts a valid allowance update and recomputes grossPay/netPay', async () => {
      const emp = await createPayrollStaff({
        schoolId: school._id,
        name: 'Valid Edit Emp',
        salary: 25000,
        email: 'validedit.emp@example.com',
      });
      const record = await createPayrollRecord({
        schoolId: school._id,
        employeeId: emp._id,
        month: 9,
        year: 2025,
        baseSalary: 25000,
      });

      const res = await request(app)
        .put(`${BASE}/records/${record._id}`)
        .set(headers)
        .send({
          allowances: [{ type: 'HRA', amount: 5000 }],
          deductions: [{ type: 'PF', amount: 1500 }],
        })
        .expect(200);

      expect(res.body.data.grossPay).toBe(30000);
      expect(res.body.data.netPay).toBe(28500);
    });

    it('rejects edits that would make net pay negative', async () => {
      const emp = await createPayrollStaff({
        schoolId: school._id,
        name: 'Negative Net Employee',
        salary: 10000,
        email: 'negative.net@example.com',
      });
      const record = await createPayrollRecord({
        schoolId: school._id,
        employeeId: emp._id,
        month: 10,
        year: 2025,
        baseSalary: 10000,
      });

      const response = await request(app)
        .put(`${BASE}/records/${record._id}`)
        .set(headers)
        .send({ deductions: [{ type: 'Recovery', amount: 11000 }] })
        .expect(400);

      expect(response.body.error).toMatch(/net pay/i);
      const unchanged = await PayrollRecord.findById(record._id).lean();
      expect(unchanged.netPay).toBe(10000);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /records/:id/reverse — reverse payment
  // ───────────────────────────────────────────────────────────────
  describe('PUT /records/:id/reverse', () => {
    it('reverses a paid record back to generated status', async () => {
      const emp = await createPayrollStaff({
        schoolId: school._id,
        name: 'Reverse Emp',
        salary: 40000,
        email: 'reverse.emp@example.com',
      });
      const record = await createPayrollRecord({
        schoolId: school._id,
        employeeId: emp._id,
        month: 7,
        year: 2025,
        baseSalary: 40000,
        status: 'paid',
      });

      // Lock it to simulate paid status
      await PayrollRecord.findByIdAndUpdate(record._id, {
        isLocked: true,
        status: 'paid',
        paymentDate: new Date(),
        paymentMethod: 'cash',
      });

      const res = await request(app)
        .put(`${BASE}/records/${record._id}/reverse`)
        .set(headers)
        .send({ reason: 'Error in calculation' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('generated');
      expect(res.body.data.isLocked).toBe(false);
      expect(res.body.reversalState).toBe('cash_record_corrected');
      const run = await PayrollRun.findOne({ schoolId: school._id, month: 7, year: 2025 }).lean();
      expect(run.totalPaid).toBe(0);
      expect(run.totalPending).toBe(40000);
    });

    it('rejects reversal of an externally recorded payment without changing its state', async () => {
      const emp = await createPayrollStaff({
        schoolId: school._id,
        name: 'External Payment Employee',
        salary: 40000,
        email: 'external.payment@example.com',
      });
      const record = await createPayrollRecord({
        schoolId: school._id,
        employeeId: emp._id,
        month: 7,
        year: 2025,
        baseSalary: 40000,
        status: 'paid',
      });
      await PayrollRecord.findByIdAndUpdate(record._id, {
        isLocked: true,
        paymentMethod: 'bank_transfer',
        paymentReference: 'BANK-123',
      });

      const response = await request(app)
        .put(`${BASE}/records/${record._id}/reverse`)
        .set(headers)
        .send({ reason: 'Incorrect bank transfer' })
        .expect(409);

      expect(response.body.code).toBe('EXTERNAL_REVERSAL_REQUIRED');
      const unchanged = await PayrollRecord.findById(record._id).lean();
      expect(unchanged.status).toBe('paid');
      expect(unchanged.isLocked).toBe(true);
      expect(unchanged.paymentReference).toBe('BANK-123');
      expect(unchanged.reversalHistory).toHaveLength(0);
    });

    it('returns 400 when reason is not provided', async () => {
      const emp = await createPayrollStaff({
        schoolId: school._id,
        name: 'No Reason Emp',
        salary: 30000,
        email: 'noreason.emp@example.com',
      });
      const record = await createPayrollRecord({
        schoolId: school._id,
        employeeId: emp._id,
        month: 8,
        year: 2025,
        baseSalary: 30000,
        status: 'paid',
      });
      await PayrollRecord.findByIdAndUpdate(record._id, { isLocked: true, status: 'paid' });

      await request(app)
        .put(`${BASE}/records/${record._id}/reverse`)
        .set(headers)
        .send({})
        .expect(400);
    });

    it('returns 404 for a non-existent record', async () => {
      await request(app)
        .put(`${BASE}/records/${new mongoose.Types.ObjectId()}/reverse`)
        .set(headers)
        .send({ reason: 'Oops' })
        .expect(404);
    });

    it('returns 400 when record is not paid', async () => {
      const emp = await createPayrollStaff({
        schoolId: school._id,
        name: 'Not Paid Emp',
        salary: 20000,
        email: 'notpaid.emp@example.com',
      });
      const record = await createPayrollRecord({
        schoolId: school._id,
        employeeId: emp._id,
        month: 9,
        year: 2025,
        baseSalary: 20000,
        status: 'generated',
      });

      await request(app)
        .put(`${BASE}/records/${record._id}/reverse`)
        .set(headers)
        .send({ reason: 'Mistake' })
        .expect(400);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /adjustments/:employeeId
  // ───────────────────────────────────────────────────────────────
  describe('GET /adjustments/:employeeId', () => {
    it('returns active salary adjustments for an employee', async () => {
      const emp = await createPayrollStaff({
        schoolId: school._id,
        name: 'Adj Emp',
        salary: 30000,
        email: 'adj.emp@example.com',
      });

      await SalaryAdjustment.create({
        schoolId: school._id,
        employeeId: emp._id,
        type: 'allowance',
        category: 'HRA',
        amount: 5000,
        effectiveMonth: 3,
        effectiveYear: 2025,
        description: 'House Rent Allowance',
        isActive: true,
      });

      const res = await request(app).get(`${BASE}/adjustments/${emp._id}`).set(headers).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].category).toBe('HRA');
    });

    it('returns empty when no active adjustments exist', async () => {
      const emp = await createPayrollStaff({
        schoolId: school._id,
        name: 'No Adj Emp',
        salary: 25000,
        email: 'noadj.emp@example.com',
      });

      const res = await request(app).get(`${BASE}/adjustments/${emp._id}`).set(headers).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // POST /adjustments — create adjustment
  // ───────────────────────────────────────────────────────────────
  describe('POST /adjustments', () => {
    it('creates a salary adjustment for an employee', async () => {
      const emp = await createPayrollStaff({
        schoolId: school._id,
        name: 'Create Adj Emp',
        salary: 35000,
        email: 'createadj.emp@example.com',
      });

      const res = await request(app)
        .post(`${BASE}/adjustments`)
        .set(headers)
        .send({
          employeeId: emp._id.toString(),
          type: 'deduction',
          category: 'PF',
          amount: 3000,
          effectiveMonth: 3,
          effectiveYear: 2025,
          description: 'Provident Fund',
          isActive: true,
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.category).toBe('PF');
      expect(res.body.data.amount).toBe(3000);
      expect(res.body.data.schoolId).toBe(school._id.toString());
      expect(res.body.data.createdBy).toBe(admin._id.toString());
    });

    it('rejects invalid adjustment values through Zod validation', async () => {
      const emp = await createPayrollStaff({
        schoolId: school._id,
        name: 'Invalid Adjustment Employee',
        salary: 35000,
        email: 'invalid.adjustment@example.com',
      });

      await request(app)
        .post(`${BASE}/adjustments`)
        .set(headers)
        .send({
          employeeId: emp._id.toString(),
          type: 'deduction',
          category: 'Invalid',
          amount: -1,
          effectiveMonth: 13,
          effectiveYear: 2025,
        })
        .expect(400);
    });

    it('rejects an adjustment for an employee belonging to another school', async () => {
      const otherSchool = await createSchoolRecord({ name: 'Adjustment Other School' });
      const otherEmployee = await createPayrollStaff({
        schoolId: otherSchool._id,
        name: 'Other School Employee',
        salary: 35000,
        email: 'other.adjustment@example.com',
      });

      await request(app)
        .post(`${BASE}/adjustments`)
        .set(headers)
        .send({
          employeeId: otherEmployee._id.toString(),
          type: 'allowance',
          category: 'HRA',
          amount: 3000,
          effectiveMonth: 3,
          effectiveYear: 2025,
        })
        .expect(404);

      expect(await SalaryAdjustment.countDocuments({ employeeId: otherEmployee._id })).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // DELETE /adjustments/:id — deactivate adjustment
  // ───────────────────────────────────────────────────────────────
  describe('DELETE /adjustments/:id', () => {
    it('deactivates (soft-deletes) a salary adjustment', async () => {
      const emp = await createPayrollStaff({
        schoolId: school._id,
        name: 'Del Adj Emp',
        salary: 28000,
        email: 'deladj.emp@example.com',
      });

      const adjustment = await SalaryAdjustment.create({
        schoolId: school._id,
        employeeId: emp._id,
        type: 'allowance',
        category: 'TA',
        amount: 2000,
        effectiveMonth: 4,
        effectiveYear: 2025,
        description: 'Travel Allowance',
        isActive: true,
      });

      const res = await request(app)
        .delete(`${BASE}/adjustments/${adjustment._id}`)
        .set(headers)
        .expect(200);

      expect(res.body.success).toBe(true);

      const updated = await SalaryAdjustment.findById(adjustment._id);
      expect(updated.isActive).toBe(false);
    });

    it('returns 400 for a malformed adjustment id and 404 for a missing adjustment', async () => {
      await request(app).delete(`${BASE}/adjustments/not-an-id`).set(headers).expect(400);
      await request(app)
        .delete(`${BASE}/adjustments/${new mongoose.Types.ObjectId()}`)
        .set(headers)
        .expect(404);
    });
  });

  describe('PUT /adjustments/:id', () => {
    it('validates and updates an active adjustment without changing its employee', async () => {
      const employee = await createPayrollStaff({
        schoolId: school._id,
        name: 'Update Adjustment Employee',
        salary: 28000,
        email: 'update.adjustment@example.com',
      });
      const adjustment = await SalaryAdjustment.create({
        schoolId: school._id,
        employeeId: employee._id,
        type: 'allowance',
        category: 'Travel',
        amount: 1000,
        effectiveMonth: 4,
        effectiveYear: 2025,
        isActive: true,
      });

      const response = await request(app)
        .put(`${BASE}/adjustments/${adjustment._id}`)
        .set(headers)
        .send({ amount: 1500, description: 'Updated amount' })
        .expect(200);

      expect(response.body.data.amount).toBe(1500);
      expect(response.body.data.employeeId).toBe(employee._id.toString());
      await request(app)
        .put(`${BASE}/adjustments/${adjustment._id}`)
        .set(headers)
        .send({ amount: -1 })
        .expect(400);
    });
  });

  describe('declared payroll permissions', () => {
    it('allows an Accountant with payroll create/edit permissions to validate and record payments', async () => {
      const accountant = await createStaffUser({
        name: 'Payroll Accountant',
        email: 'payroll.accountant@example.com',
        schoolId: school._id,
        staffRole: ['Accountant'],
        permissionRole: 'accountant',
      });
      const accountantHeaders = authHeadersFor(accountant, 'accountant');
      const employee = await createPayrollStaff({
        schoolId: school._id,
        name: 'Accountant Managed Employee',
        salary: 22000,
        email: 'managed.by.accountant@example.com',
      });
      const record = await createPayrollRecord({
        schoolId: school._id,
        employeeId: employee._id,
        month: 11,
        year: 2025,
        baseSalary: 22000,
      });

      await request(app)
        .post(`${BASE}/validate`)
        .set(accountantHeaders)
        .send({ month: 11, year: 2025, employeeIds: [employee._id.toString()] })
        .expect(200);
      await request(app)
        .put(`${BASE}/records/${record._id}/pay`)
        .set(accountantHeaders)
        .send({ paymentMethod: 'cash' })
        .expect(200);
    });
  });

  describe('GET /payslips/:employeeId/:month/:year authorization', () => {
    it('allows a non-admin user with the canonical payroll:view permission', async () => {
      const viewer = await createStaffUser({
        name: 'Payroll Permission Viewer',
        email: 'payroll.permission.viewer@example.com',
        schoolId: school._id,
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
      });
      const viewerPermission = await UserPermission.findOne({
        schoolId: school._id,
        userId: viewer._id,
      });
      viewerPermission.permissions.find((permission) => permission.module === 'payroll').view =
        true;
      await viewerPermission.save();

      const employee = await createPayrollStaff({
        schoolId: school._id,
        name: 'Payslip Target',
        salary: 32000,
        email: 'payslip.target@example.com',
      });
      const record = await createPayrollRecord({
        schoolId: school._id,
        employeeId: employee._id,
        month: 9,
        year: 2025,
        baseSalary: 32000,
      });
      await createPayslipForRecord(record);

      const response = await request(app)
        .get(`${BASE}/payslips/${employee._id}/9/2025`)
        .set(authHeadersFor(viewer, 'teacher'))
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.employeeId).toBe(employee._id.toString());
    });

    it('denies another employee even when their display/JWT role says admin but payroll:view is false', async () => {
      const viewer = await createStaffUser({
        name: 'Admin Without Payroll Permission',
        email: 'admin.without.payroll@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'teacher',
      });
      const employee = await createPayrollStaff({
        schoolId: school._id,
        name: 'Protected Payslip Target',
        salary: 33000,
        email: 'protected.payslip@example.com',
      });
      const record = await createPayrollRecord({
        schoolId: school._id,
        employeeId: employee._id,
        month: 8,
        year: 2025,
        baseSalary: 33000,
      });
      await createPayslipForRecord(record);

      await request(app)
        .get(`${BASE}/payslips/${employee._id}/8/2025`)
        .set(authHeadersFor(viewer, 'admin'))
        .expect(403);
    });

    it('allows employees to view their own payslip and validates route params', async () => {
      const employee = await createPayrollStaff({
        schoolId: school._id,
        name: 'Own Payslip Employee',
        salary: 34000,
        email: 'own.payslip@example.com',
      });
      const record = await createPayrollRecord({
        schoolId: school._id,
        employeeId: employee._id,
        month: 7,
        year: 2025,
        baseSalary: 34000,
      });
      await createPayslipForRecord(record);

      await request(app)
        .get(`${BASE}/payslips/${employee._id}/7/2025`)
        .set(authHeadersFor(employee, 'teacher'))
        .expect(200);
      await request(app).get(`${BASE}/payslips/not-an-id/99/not-a-year`).set(headers).expect(400);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /audit-logs
  // ───────────────────────────────────────────────────────────────
  describe('GET /audit-logs', () => {
    it('returns audit logs with pagination', async () => {
      const res = await request(app).get(`${BASE}/audit-logs`).set(headers).expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.pagination).toHaveProperty('total');
    });
  });
});
