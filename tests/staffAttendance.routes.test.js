import request from 'supertest';
import { describe, expect, it } from 'vitest';
import StaffAttendance from '../models/StaffAttendance.js';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

describe('staff attendance routes', () => {
  // ── POST /api/staff-attendance/ — mark single attendance ────────────────

  describe('POST /api/staff-attendance/ — mark attendance', () => {
    it('marks a staff member as present and returns the saved record', async () => {
      const admin = await createStaffUser({
        name: 'Admin User',
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');
      const date = '2026-03-10';

      const response = await request(app)
        .post('/api/staff-attendance')
        .set(authHeaders)
        .send({
          staffId: admin._id.toString(),
          date,
          status: 'present',
          checkInTime: '09:00',
          checkOutTime: '17:00',
        })
        .expect(200);

      expect(response.body).toMatchObject({
        date,
        status: 'present',
        checkInTime: '09:00',
        checkOutTime: '17:00',
      });

      const saved = await StaffAttendance.findOne({ staffId: admin._id, date }).lean();
      expect(saved).toBeTruthy();
      expect(saved.status).toBe('present');
      expect(saved.markedBy.toString()).toBe(admin._id.toString());
      expect(saved.checkInMethod).toBe('admin');
    });

    it('upserts when marking the same staff+date again', async () => {
      const admin = await createStaffUser({
        name: 'Admin Upsert',
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');
      const date = '2026-03-11';

      await request(app)
        .post('/api/staff-attendance')
        .set(authHeaders)
        .send({ staffId: admin._id.toString(), date, status: 'present' })
        .expect(200);

      const updateResponse = await request(app)
        .post('/api/staff-attendance')
        .set(authHeaders)
        .send({ staffId: admin._id.toString(), date, status: 'absent', reason: 'Sick' })
        .expect(200);

      expect(updateResponse.body.status).toBe('absent');

      const records = await StaffAttendance.find({ staffId: admin._id, date }).lean();
      expect(records).toHaveLength(1);
      expect(records[0].status).toBe('absent');
    });

    it('saves attendance with a reason for absence', async () => {
      const admin = await createStaffUser({
        name: 'Admin Reason',
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app)
        .post('/api/staff-attendance')
        .set(authHeaders)
        .send({
          staffId: admin._id.toString(),
          date: '2026-03-12',
          status: 'leave',
          reason: 'Family emergency',
        })
        .expect(200);

      expect(response.body.status).toBe('leave');
      expect(response.body.reason).toBe('Family emergency');
    });

    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();

      await request(app)
        .post('/api/staff-attendance')
        .send({ staffId: '000000000000000000000000', date: '2026-03-10', status: 'present' })
        .expect(401);
    });
  });

  // ── GET /api/staff-attendance/ — list attendance ────────────────────────

  describe('GET /api/staff-attendance/ — list attendance', () => {
    it('returns paginated attendance records', async () => {
      const admin = await createStaffUser({
        name: 'Admin List',
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      // Seed two records
      await request(app)
        .post('/api/staff-attendance')
        .set(authHeaders)
        .send({ staffId: admin._id.toString(), date: '2026-03-01', status: 'present' })
        .expect(200);

      await request(app)
        .post('/api/staff-attendance')
        .set(authHeaders)
        .send({ staffId: admin._id.toString(), date: '2026-03-02', status: 'absent' })
        .expect(200);

      const response = await request(app).get('/api/staff-attendance').set(authHeaders).expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('pagination');
      expect(response.body.data.length).toBeGreaterThanOrEqual(2);
      expect(response.body.pagination.total).toBeGreaterThanOrEqual(2);
    });

    it('filters by a specific date query param', async () => {
      const admin = await createStaffUser({
        name: 'Admin DateFilter',
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      await request(app)
        .post('/api/staff-attendance')
        .set(authHeaders)
        .send({ staffId: admin._id.toString(), date: '2026-03-05', status: 'present' })
        .expect(200);

      await request(app)
        .post('/api/staff-attendance')
        .set(authHeaders)
        .send({ staffId: admin._id.toString(), date: '2026-03-06', status: 'absent' })
        .expect(200);

      const response = await request(app)
        .get('/api/staff-attendance')
        .query({ date: '2026-03-05' })
        .set(authHeaders)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].date).toBe('2026-03-05');
      expect(response.body.data[0].status).toBe('present');
    });

    it('filters by date range using startDate and endDate', async () => {
      const admin = await createStaffUser({
        name: 'Admin Range',
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      for (const date of ['2025-01-28', '2025-02-01', '2025-02-15', '2025-03-01']) {
        await request(app)
          .post('/api/staff-attendance')
          .set(authHeaders)
          .send({ staffId: admin._id.toString(), date, status: 'present' })
          .expect(200);
      }

      const response = await request(app)
        .get('/api/staff-attendance')
        .query({ startDate: '2025-02-01', endDate: '2025-02-28' })
        .set(authHeaders)
        .expect(200);

      expect(response.body.data).toHaveLength(2);
    });

    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();

      await request(app).get('/api/staff-attendance').expect(401);
    });
  });

  // ── GET /api/staff-attendance/date/:date — get by date ──────────────────

  describe('GET /api/staff-attendance/date/:date — get by date', () => {
    it('returns attendance for all staff on a specific date', async () => {
      const schoolA = await createSchoolRecord({ name: 'Date School', code: 'DATE-SCH' });
      const admin = await createStaffUser({
        name: 'Admin ByDate',
        staffRole: ['Admin'],
        permissionRole: 'admin',
        schoolId: schoolA._id,
      });
      const staffB = await createStaffUser({
        name: 'Staff Beta',
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
        schoolId: schoolA._id,
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');
      const date = '2026-03-12';

      await request(app)
        .post('/api/staff-attendance')
        .set(authHeaders)
        .send({ staffId: admin._id.toString(), date, status: 'present', checkInTime: '09:00' })
        .expect(200);

      await request(app)
        .post('/api/staff-attendance')
        .set(authHeaders)
        .send({ staffId: staffB._id.toString(), date, status: 'absent', reason: 'Sick leave' })
        .expect(200);

      const response = await request(app)
        .get(`/api/staff-attendance/date/${date}`)
        .set(authHeaders)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(2);

      const statuses = response.body.map((r) => r.status);
      expect(statuses).toContain('present');
      expect(statuses).toContain('absent');
    });

    it('returns an empty array when no records exist for the date', async () => {
      const admin = await createStaffUser({
        name: 'Admin NoDate',
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app)
        .get('/api/staff-attendance/date/2026-01-01')
        .set(authHeaders)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(0);
    });

    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();

      await request(app).get('/api/staff-attendance/date/2026-03-12').expect(401);
    });
  });

  // ── GET /api/staff-attendance/staff/:staffId — get by staff ─────────────

  describe('GET /api/staff-attendance/staff/:staffId — get by staff', () => {
    it('returns attendance records for a specific staff member', async () => {
      const admin = await createStaffUser({
        name: 'Admin ByStaff',
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      await request(app)
        .post('/api/staff-attendance')
        .set(authHeaders)
        .send({ staffId: admin._id.toString(), date: '2026-03-01', status: 'present' })
        .expect(200);

      await request(app)
        .post('/api/staff-attendance')
        .set(authHeaders)
        .send({ staffId: admin._id.toString(), date: '2026-03-02', status: 'absent' })
        .expect(200);

      const response = await request(app)
        .get(`/api/staff-attendance/staff/${admin._id.toString()}`)
        .set(authHeaders)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(2);
    });

    it('filters by date range using startDate and endDate query params', async () => {
      const admin = await createStaffUser({
        name: 'Admin StaffRange',
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      for (const date of ['2025-01-15', '2025-02-10', '2025-02-20', '2025-03-05']) {
        await request(app)
          .post('/api/staff-attendance')
          .set(authHeaders)
          .send({ staffId: admin._id.toString(), date, status: 'present' })
          .expect(200);
      }

      const response = await request(app)
        .get(`/api/staff-attendance/staff/${admin._id.toString()}`)
        .query({ startDate: '2025-02-01', endDate: '2025-02-28' })
        .set(authHeaders)
        .expect(200);

      expect(response.body).toHaveLength(2);
    });

    it('returns an empty array for a staff member with no records', async () => {
      const admin = await createStaffUser({
        name: 'Admin Empty Staff',
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app)
        .get(`/api/staff-attendance/staff/${admin._id.toString()}`)
        .set(authHeaders)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(0);
    });

    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();

      await request(app).get('/api/staff-attendance/staff/000000000000000000000000').expect(401);
    });
  });

  // ── POST /api/staff-attendance/bulk — bulk mark ─────────────────────────

  describe('POST /api/staff-attendance/bulk — bulk mark attendance', () => {
    it('marks attendance for multiple staff members in one request', async () => {
      const schoolA = await createSchoolRecord({ name: 'Bulk School A', code: 'BULK-A' });
      const schoolB = await createSchoolRecord({ name: 'Bulk School B', code: 'BULK-B' });
      const schoolC = await createSchoolRecord({ name: 'Bulk School C', code: 'BULK-C' });
      const admin = await createStaffUser({
        name: 'Admin Bulk',
        staffRole: ['Admin'],
        permissionRole: 'admin',
        schoolId: schoolA._id,
      });
      // Each additional staff in a separate school to avoid duplicate username index on null
      const staffA = await createStaffUser({
        name: 'Bulk Staff A',
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
        schoolId: schoolB._id,
      });
      const staffB = await createStaffUser({
        name: 'Bulk Staff B',
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
        schoolId: schoolC._id,
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');
      const date = '2026-03-14';

      const response = await request(app)
        .post('/api/staff-attendance/bulk')
        .set(authHeaders)
        .send({
          date,
          staffIds: [admin._id.toString(), staffA._id.toString(), staffB._id.toString()],
          status: 'present',
        })
        .expect(200);

      expect(response.body).toMatchObject({ success: true });
      expect(response.body.upserted).toBe(3);

      // All records are scoped to admin's school (schoolA)
      const records = await StaffAttendance.find({ date, schoolId: schoolA._id }).lean();
      expect(records).toHaveLength(3);
      expect(records.every((r) => r.status === 'present')).toBe(true);
    });

    it('upserts when bulk-marking the same date again', async () => {
      const admin = await createStaffUser({
        name: 'Admin BulkUpsert',
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');
      const date = '2026-03-15';

      await request(app)
        .post('/api/staff-attendance/bulk')
        .set(authHeaders)
        .send({ date, staffIds: [admin._id.toString()], status: 'present' })
        .expect(200);

      await request(app)
        .post('/api/staff-attendance/bulk')
        .set(authHeaders)
        .send({ date, staffIds: [admin._id.toString()], status: 'absent', reason: 'Updated' })
        .expect(200);

      const records = await StaffAttendance.find({ staffId: admin._id, date }).lean();
      expect(records).toHaveLength(1);
      expect(records[0].status).toBe('absent');
    });

    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();

      await request(app)
        .post('/api/staff-attendance/bulk')
        .send({ date: '2026-03-14', staffIds: [], status: 'present' })
        .expect(401);
    });
  });

  // ── PUT /api/staff-attendance/:id/regularize — regularize attendance ────

  describe('PUT /api/staff-attendance/:id/regularize — regularize attendance', () => {
    it('regularizes an existing attendance record by its _id', async () => {
      const admin = await createStaffUser({
        name: 'Admin Regularize',
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');
      const date = '2026-03-16';

      // First mark as absent
      const markResponse = await request(app)
        .post('/api/staff-attendance')
        .set(authHeaders)
        .send({ staffId: admin._id.toString(), date, status: 'absent' })
        .expect(200);

      const recordId = markResponse.body._id;

      // Regularize to present
      const response = await request(app)
        .put(`/api/staff-attendance/${recordId}/regularize`)
        .set(authHeaders)
        .send({
          status: 'present',
          checkInTime: '09:15',
          checkOutTime: '17:00',
          reason: 'Was present but missed biometric',
        })
        .expect(200);

      expect(response.body.status).toBe('present');
      expect(response.body.checkInTime).toBe('09:15');
      expect(response.body.regularization).toBeTruthy();
      expect(response.body.regularization.previousStatus).toBe('absent');
      expect(response.body.regularization.regularizationReason).toBe(
        'Was present but missed biometric'
      );
    });

    it('regularizes by staffId and date when _id does not match a record', async () => {
      const admin = await createStaffUser({
        name: 'Admin RegByStaff',
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');
      const date = '2026-03-17';

      // Mark attendance first
      await request(app)
        .post('/api/staff-attendance')
        .set(authHeaders)
        .send({ staffId: admin._id.toString(), date, status: 'absent' })
        .expect(200);

      // Regularize using staffId as the :id param with date in body
      const response = await request(app)
        .put(`/api/staff-attendance/${admin._id.toString()}/regularize`)
        .set(authHeaders)
        .send({
          date,
          status: 'present',
          checkInTime: '09:30',
          checkOutTime: '17:30',
          reason: 'Regularized via staffId lookup',
        })
        .expect(200);

      expect(response.body.status).toBe('present');
    });

    it('creates a new record when no existing record found and date is provided', async () => {
      const admin = await createStaffUser({
        name: 'Admin RegNew',
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app)
        .put(`/api/staff-attendance/${admin._id.toString()}/regularize`)
        .set(authHeaders)
        .send({
          date: '2026-03-18',
          status: 'present',
          checkInTime: '09:00',
          checkOutTime: '17:00',
          reason: 'Backdated entry',
        })
        .expect(200);

      expect(response.body.status).toBe('present');
      expect(response.body.regularization.previousStatus).toBe('unmarked');

      const saved = await StaffAttendance.findOne({
        staffId: admin._id,
        date: '2026-03-18',
      }).lean();
      expect(saved).toBeTruthy();
      expect(saved.status).toBe('present');
    });

    it('returns 404 when record not found and no date provided', async () => {
      const admin = await createStaffUser({
        name: 'Admin Reg404',
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      await request(app)
        .put('/api/staff-attendance/000000000000000000000000/regularize')
        .set(authHeaders)
        .send({ status: 'present' })
        .expect(404);
    });

    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();

      await request(app)
        .put('/api/staff-attendance/000000000000000000000000/regularize')
        .send({ status: 'present', date: '2026-03-16' })
        .expect(401);
    });
  });

  // ── GET /api/staff-attendance/summary/:staffId — monthly summary ────────

  describe('GET /api/staff-attendance/summary/:staffId — monthly summary', () => {
    it('returns a breakdown of attendance statuses for the requested month', async () => {
      const admin = await createStaffUser({
        name: 'Admin Summary',
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      // Seed varied attendance for March 2026
      const entries = [
        { date: '2026-03-01', status: 'present' },
        { date: '2026-03-02', status: 'present' },
        { date: '2026-03-03', status: 'absent' },
        { date: '2026-03-04', status: 'leave' },
        { date: '2026-03-05', status: 'halfday' },
      ];

      for (const entry of entries) {
        await request(app)
          .post('/api/staff-attendance')
          .set(authHeaders)
          .send({
            staffId: admin._id.toString(),
            date: entry.date,
            status: entry.status,
            reason: entry.status !== 'present' ? 'Test reason' : undefined,
          })
          .expect(200);
      }

      const response = await request(app)
        .get(`/api/staff-attendance/summary/${admin._id.toString()}`)
        .query({ month: 3, year: 2026 })
        .set(authHeaders)
        .expect(200);

      expect(response.body).toMatchObject({
        present: 2,
        absent: 1,
        leave: 1,
        halfday: 1,
        total: 5,
      });
    });

    it('returns all zeroes when no attendance exists for the month', async () => {
      const admin = await createStaffUser({
        name: 'Admin EmptySummary',
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app)
        .get(`/api/staff-attendance/summary/${admin._id.toString()}`)
        .query({ month: 1, year: 2026 })
        .set(authHeaders)
        .expect(200);

      expect(response.body).toMatchObject({
        present: 0,
        absent: 0,
        leave: 0,
        halfday: 0,
        unmarked: 0,
        total: 0,
      });
    });

    it('does not include records from other months', async () => {
      const admin = await createStaffUser({
        name: 'Admin MonthScope',
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      // Seed attendance in February and March
      await request(app)
        .post('/api/staff-attendance')
        .set(authHeaders)
        .send({ staffId: admin._id.toString(), date: '2026-02-28', status: 'present' })
        .expect(200);

      await request(app)
        .post('/api/staff-attendance')
        .set(authHeaders)
        .send({ staffId: admin._id.toString(), date: '2026-03-01', status: 'absent' })
        .expect(200);

      const response = await request(app)
        .get(`/api/staff-attendance/summary/${admin._id.toString()}`)
        .query({ month: 3, year: 2026 })
        .set(authHeaders)
        .expect(200);

      expect(response.body.total).toBe(1);
      expect(response.body.absent).toBe(1);
      expect(response.body.present).toBe(0);
    });

    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();

      await request(app)
        .get('/api/staff-attendance/summary/000000000000000000000000')
        .query({ month: 3, year: 2026 })
        .expect(401);
    });
  });

  // ── Multi-tenancy isolation ─────────────────────────────────────────────

  describe('multi-tenancy isolation', () => {
    it('school A admin cannot see school B staff attendance in list endpoint', async () => {
      const schoolA = await createSchoolRecord({ name: 'School Alpha', code: 'SCH-ALPHA' });
      const schoolB = await createSchoolRecord({ name: 'School Beta', code: 'SCH-BETA' });

      const adminA = await createStaffUser({
        name: 'Admin School A',
        staffRole: ['Admin'],
        permissionRole: 'admin',
        schoolId: schoolA._id,
      });
      const adminB = await createStaffUser({
        name: 'Admin School B',
        staffRole: ['Admin'],
        permissionRole: 'admin',
        schoolId: schoolB._id,
      });

      // Mark attendance scoped to school B
      const { app } = createTestApp();
      const authHeadersB = authHeadersFor(adminB, 'admin');

      await request(app)
        .post('/api/staff-attendance')
        .set(authHeadersB)
        .send({ staffId: adminB._id.toString(), date: '2026-03-10', status: 'present' })
        .expect(200);

      // School A admin tries to list attendance
      const authHeadersA = authHeadersFor(adminA, 'admin');

      const response = await request(app)
        .get('/api/staff-attendance')
        .set(authHeadersA)
        .expect(200);

      expect(response.body.data).toHaveLength(0);
    });

    it('school A admin cannot see school B staff attendance in date endpoint', async () => {
      const schoolA = await createSchoolRecord({ name: 'Iso School A', code: 'ISO-A' });
      const schoolB = await createSchoolRecord({ name: 'Iso School B', code: 'ISO-B' });

      const adminA = await createStaffUser({
        name: 'Iso Admin A',
        staffRole: ['Admin'],
        permissionRole: 'admin',
        schoolId: schoolA._id,
      });
      const adminB = await createStaffUser({
        name: 'Iso Admin B',
        staffRole: ['Admin'],
        permissionRole: 'admin',
        schoolId: schoolB._id,
      });

      const { app } = createTestApp();
      const date = '2026-03-20';

      // Seed via school B admin
      await request(app)
        .post('/api/staff-attendance')
        .set(authHeadersFor(adminB, 'admin'))
        .send({ staffId: adminB._id.toString(), date, status: 'present' })
        .expect(200);

      // School A admin queries the same date
      const response = await request(app)
        .get(`/api/staff-attendance/date/${date}`)
        .set(authHeadersFor(adminA, 'admin'))
        .expect(200);

      expect(response.body).toHaveLength(0);
    });

    it('school A admin cannot see school B staff summary', async () => {
      const schoolA = await createSchoolRecord({ name: 'Sum School A', code: 'SUM-A' });
      const schoolB = await createSchoolRecord({ name: 'Sum School B', code: 'SUM-B' });

      const adminA = await createStaffUser({
        name: 'Sum Admin A',
        staffRole: ['Admin'],
        permissionRole: 'admin',
        schoolId: schoolA._id,
      });
      const adminB = await createStaffUser({
        name: 'Sum Admin B',
        staffRole: ['Admin'],
        permissionRole: 'admin',
        schoolId: schoolB._id,
      });

      const { app } = createTestApp();

      // Seed via school B
      await request(app)
        .post('/api/staff-attendance')
        .set(authHeadersFor(adminB, 'admin'))
        .send({ staffId: adminB._id.toString(), date: '2026-03-10', status: 'present' })
        .expect(200);

      // School A admin queries summary for school B staff
      const response = await request(app)
        .get(`/api/staff-attendance/summary/${adminB._id.toString()}`)
        .query({ month: 3, year: 2026 })
        .set(authHeadersFor(adminA, 'admin'))
        .expect(200);

      expect(response.body.total).toBe(0);
      expect(response.body.present).toBe(0);
    });
  });
});
