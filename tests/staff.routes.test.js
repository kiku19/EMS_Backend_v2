import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { Class, Staff } from '../database.js';
import StaffAttendance from '../models/StaffAttendance.js';
import Session from '../models/Session.js';
import TeacherLeave from '../models/TeacherLeave.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import PushToken from '../models/PushToken.js';
import TrashItem from '../models/TrashItem.js';
import {
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  authHeadersFor,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';
import { hmac } from '../utils/encryption.js';

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Helper: create a school with an admin user, returning both.
 * Sets a unique username on the admin to avoid compound unique index
 * collision on { schoolId, username }.
 */
let adminSeq = 0;
async function setupSchoolWithAdmin(schoolName = 'Staff Test School') {
  adminSeq += 1;
  const school = await createSchoolRecord({ name: schoolName });
  const admin = await createStaffUser({ schoolId: school._id });
  await Staff.findByIdAndUpdate(admin._id, {
    username: `staff_admin_${adminSeq}_${Date.now()}`,
  });
  return { school, admin };
}

/**
 * Helper: create a teacher in the given school with a unique username.
 */
let teacherSeq = 0;
async function createTeacherInSchool(schoolId, overrides = {}) {
  teacherSeq += 1;
  const teacher = await createStaffUser({
    name: overrides.name || `Teacher ${teacherSeq}`,
    staffRole: ['Teacher'],
    permissionRole: 'teacher',
    schoolId,
    ...overrides,
  });
  await Staff.findByIdAndUpdate(teacher._id, {
    username: `teacher_${teacherSeq}_${Date.now()}`,
  });
  return teacher;
}

describe('staff routes', () => {
  // ─── AUTH: 401 without token ──────────────────────────────────────

  describe('Authentication — 401 without token', () => {
    it('GET /api/staff returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/staff').expect(401);
    });

    it('GET /api/staff/:id returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).get(`/api/staff/${fakeId}`).expect(401);
    });

    it('POST /api/staff returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app)
        .post('/api/staff')
        .send({ name: 'Ghost Staff', role: ['Teacher'] })
        .expect(401);
    });

    it('PUT /api/staff/:id returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).put(`/api/staff/${fakeId}`).send({ name: 'Updated Name' }).expect(401);
    });

    it('DELETE /api/staff/:id returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).delete(`/api/staff/${fakeId}`).expect(401);
    });

    it('GET /api/staff/me returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/staff/me').expect(401);
    });
  });

  // ─── GET /api/staff/me — Current staff profile ────────────────────

  describe('GET /api/staff/me — Current staff profile', () => {
    it('returns the authenticated staff member profile', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app).get('/api/staff/me').set(authHeaders).expect(200);

      expect(response.body).toMatchObject({
        id: admin._id.toString(),
        name: admin.name,
        role: admin.role,
      });
      expect(response.body).toHaveProperty('email');
      expect(response.body).toHaveProperty('code');
    });

    it('returns 404 if the staff member does not exist (stale token)', async () => {
      const { school } = await setupSchoolWithAdmin();
      // Create a staff user then delete it from DB
      const tempStaff = await createStaffUser({
        name: 'Vanished Staff',
        schoolId: school._id,
      });
      await Staff.findByIdAndUpdate(tempStaff._id, {
        username: `vanished_${Date.now()}`,
      });
      const authHeaders = authHeadersFor(tempStaff, 'admin');
      await Staff.deleteOne({ _id: tempStaff._id });

      const { app } = createTestApp();
      const response = await request(app).get('/api/staff/me').set(authHeaders).expect(404);

      expect(response.body.error).toMatch(/not found/i);
    });
  });

  // ─── GET /api/staff/next-code — Next staff code ────────────────────

  describe('GET /api/staff/next-code — Next staff code', () => {
    it('returns the next auto-generated staff code', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app).get('/api/staff/next-code').set(authHeaders).expect(200);

      expect(response.body).toHaveProperty('nextCode');
      expect(response.body.nextCode).toMatch(/^EMP\d+/);
    });
  });

  // ─── GET /api/staff — List staff ──────────────────────────────────

  describe('GET /api/staff — List staff', () => {
    it('returns all staff for the school as an array (non-paginated)', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      await createTeacherInSchool(school._id, { name: 'Teacher Alpha' });
      await createTeacherInSchool(school._id, { name: 'Teacher Beta' });

      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app).get('/api/staff').set(authHeaders).expect(200);

      // Non-paginated returns a plain array
      expect(Array.isArray(response.body)).toBe(true);
      // Admin + 2 teachers = 3
      expect(response.body.length).toBe(3);
      expect(response.body[0]).toHaveProperty('id');
      expect(response.body[0]).toHaveProperty('name');
      expect(response.body[0]).toHaveProperty('role');
    });

    it('does not expose payroll and bank details to a staff viewer without payroll permission', async () => {
      const { school } = await setupSchoolWithAdmin();
      const viewer = await createTeacherInSchool(school._id, { name: 'Staff Viewer' });
      const target = await createTeacherInSchool(school._id, { name: 'Private Payroll Staff' });
      await Staff.findByIdAndUpdate(target._id, {
        salary: 72000,
        accountNumber: '1234567890',
        ifscCode: 'ABCD0123456',
        bankName: 'Private Bank',
        panNumber: 'ABCDE1234F',
        salaryBreakdown: [{ component: 'Basic', amount: 72000 }],
      });

      const { app } = createTestApp();
      const viewerHeaders = authHeadersFor(viewer, 'teacher');
      const listResponse = await request(app).get('/api/staff').set(viewerHeaders).expect(200);
      const listTarget = listResponse.body.find((staff) => staff.id === target._id.toString());

      expect(listTarget).not.toHaveProperty('salary');
      expect(listTarget).not.toHaveProperty('salaryBreakdown');
      expect(listTarget).not.toHaveProperty('accountNumber');
      expect(listTarget).not.toHaveProperty('ifscCode');
      expect(listTarget).not.toHaveProperty('bankName');
      expect(listTarget).not.toHaveProperty('panNumber');

      const detailResponse = await request(app)
        .get(`/api/staff/${target._id}`)
        .set(viewerHeaders)
        .expect(200);
      expect(detailResponse.body).not.toHaveProperty('salary');
      expect(detailResponse.body).not.toHaveProperty('accountNumber');
      expect(detailResponse.body).not.toHaveProperty('panNumber');
    });

    it('returns payroll details to a viewer with payroll permission', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const target = await createTeacherInSchool(school._id, { name: 'Payroll Visible Staff' });
      await Staff.findByIdAndUpdate(target._id, { salary: 64000 });

      const { app } = createTestApp();
      const response = await request(app)
        .get(`/api/staff/${target._id}`)
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);

      expect(response.body.salary).toBe(64000);
    });

    it('returns paginated results when page param is provided', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      // Create 5 additional staff members
      for (let i = 0; i < 5; i++) {
        await createTeacherInSchool(school._id, { name: `Paged Teacher ${i + 1}` });
      }

      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app)
        .get('/api/staff?page=1&limit=3')
        .set(authHeaders)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('pagination');
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBe(3);
      // Canonical pagination envelope (currentPage/totalPages/totalItems/
      // itemsPerPage/hasNextPage/hasPrevPage). The old staff-specific
      // {page,limit,total,totalPages} shape was standardized via
      // buildPaginationResponse.
      expect(response.body.pagination).toMatchObject({
        currentPage: 1,
        itemsPerPage: 3,
        totalItems: 6, // admin + 5 teachers
        totalPages: 2,
        hasNextPage: true,
        hasPrevPage: false,
      });
      // Aggregates (tab counts) are now part of the paginated response.
      expect(response.body.aggregates).toEqual(
        expect.objectContaining({ total: 6 })
      );
    });

    it('does not return soft-deleted staff in the list', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacherInSchool(school._id, { name: 'Deleted Teacher' });
      await Staff.findByIdAndUpdate(teacher._id, {
        isDeleted: true,
        deletedAt: new Date(),
      });

      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app).get('/api/staff').set(authHeaders).expect(200);

      const names = response.body.map((s) => s.name);
      expect(names).not.toContain('Deleted Teacher');
    });

    // ─── SCH-126 / PAG-28: server-side search, facets, today filter ────

    describe('SCH-126 — server-side search (q param)', () => {
      it('filters by name substring, case-insensitive', async () => {
        const { school, admin } = await setupSchoolWithAdmin();
        await createTeacherInSchool(school._id, { name: 'Alice Smith' });
        await createTeacherInSchool(school._id, { name: 'Bob Jones' });
        await createTeacherInSchool(school._id, { name: 'Eve Smithy' });

        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app)
          .get('/api/staff?page=1&limit=50&q=smith')
          .set(authHeaders)
          .expect(200);

        const names = response.body.data.map((s) => s.name);
        expect(names).toContain('Alice Smith');
        expect(names).toContain('Eve Smithy');
        expect(names).not.toContain('Bob Jones');
      });

      it('matches staffNumber/code as a substring', async () => {
        const { school, admin } = await setupSchoolWithAdmin();
        const teacher = await createTeacherInSchool(school._id, { name: 'Code Match' });
        await Staff.findByIdAndUpdate(teacher._id, { staffNumber: 'SMITH-9999' });

        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app)
          .get('/api/staff?page=1&limit=50&q=SMITH-9999')
          .set(authHeaders)
          .expect(200);

        const names = response.body.data.map((s) => s.name);
        expect(names).toContain('Code Match');
      });

      it('returns zero results when no staff match the query', async () => {
        const { school, admin } = await setupSchoolWithAdmin();
        await createTeacherInSchool(school._id, { name: 'Alice' });

        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app)
          .get('/api/staff?page=1&limit=50&q=zzznomatchzzz')
          .set(authHeaders)
          .expect(200);

        expect(response.body.data).toHaveLength(0);
        expect(response.body.pagination.totalItems).toBe(0);
      });
    });

    describe('SCH-126 — facet filters (role / department / employmentType / gender)', () => {
      it('filters by a single role (comma list semantics, $in)', async () => {
        const { school, admin } = await setupSchoolWithAdmin();
        await createTeacherInSchool(school._id, { name: 'T1', staffRole: ['Teacher'] });
        await createTeacherInSchool(school._id, { name: 'L1', staffRole: ['Librarian'] });

        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app)
          .get('/api/staff?page=1&limit=50&role=Teacher')
          .set(authHeaders)
          .expect(200);

        const names = response.body.data.map((s) => s.name);
        expect(names).toContain('T1');
        expect(names).not.toContain('L1');
      });

      it('filters by multiple roles (comma-separated)', async () => {
        const { school, admin } = await setupSchoolWithAdmin();
        await createTeacherInSchool(school._id, { name: 'T1', staffRole: ['Teacher'] });
        await createTeacherInSchool(school._id, { name: 'L1', staffRole: ['Librarian'] });
        await createTeacherInSchool(school._id, { name: 'A1', staffRole: ['Accountant'] });

        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app)
          .get('/api/staff?page=1&limit=50&role=Teacher,Librarian')
          .set(authHeaders)
          .expect(200);

        const names = response.body.data.map((s) => s.name);
        expect(names).toContain('T1');
        expect(names).toContain('L1');
        expect(names).not.toContain('A1');
      });

      it('filters by department, employmentType, gender', async () => {
        const { school, admin } = await setupSchoolWithAdmin();
        const match = await createTeacherInSchool(school._id, {
          name: 'Match',
          staffRole: ['Teacher'],
          department: 'Science',
        });
        await Staff.findByIdAndUpdate(match._id, {
          employmentType: 'Full-Time',
          gender: 'Female',
        });
        const other = await createTeacherInSchool(school._id, {
          name: 'Other',
          staffRole: ['Teacher'],
          department: 'Math',
        });
        await Staff.findByIdAndUpdate(other._id, {
          employmentType: 'Part-Time',
          gender: 'Male',
        });

        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const deptResponse = await request(app)
          .get('/api/staff?page=1&limit=50&department=Science')
          .set(authHeaders)
          .expect(200);
        expect(deptResponse.body.data.map((s) => s.name)).toContain('Match');
        expect(deptResponse.body.data.map((s) => s.name)).not.toContain('Other');

        const empResponse = await request(app)
          .get('/api/staff?page=1&limit=50&employmentType=Full-Time')
          .set(authHeaders)
          .expect(200);
        expect(empResponse.body.data.map((s) => s.name)).toContain('Match');

        const genderResponse = await request(app)
          .get('/api/staff?page=1&limit=50&gender=Female')
          .set(authHeaders)
          .expect(200);
        expect(genderResponse.body.data.map((s) => s.name)).toContain('Match');
      });
    });

    describe('SCH-126 — facets aggregate', () => {
      it('returns facets with value+count entries in the paginated branch', async () => {
        const { school, admin } = await setupSchoolWithAdmin();
        await createTeacherInSchool(school._id, {
          name: 'T1',
          staffRole: ['Teacher'],
          department: 'Math',
        });
        await createTeacherInSchool(school._id, {
          name: 'T2',
          staffRole: ['Teacher'],
          department: 'Math',
        });
        await createTeacherInSchool(school._id, { name: 'L1', staffRole: ['Librarian'] });

        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app)
          .get('/api/staff?page=1&limit=50')
          .set(authHeaders)
          .expect(200);

        expect(response.body.facets).toBeDefined();
        const teacherFacet = response.body.facets.role.find((r) => r.value === 'Teacher');
        expect(teacherFacet).toBeDefined();
        expect(teacherFacet.count).toBe(2);
        const librarianFacet = response.body.facets.role.find((r) => r.value === 'Librarian');
        expect(librarianFacet.count).toBe(1);

        const mathDept = response.body.facets.department.find((d) => d.value === 'Math');
        expect(mathDept.count).toBe(2);
      });

      it('excludes empty/null values from facet options', async () => {
        const { school, admin } = await setupSchoolWithAdmin();
        await createTeacherInSchool(school._id, {
          name: 'Has Dept',
          staffRole: ['Teacher'],
          department: 'Science',
        });
        await createTeacherInSchool(school._id, { name: 'No Dept', staffRole: ['Teacher'] });

        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app)
          .get('/api/staff?page=1&limit=50')
          .set(authHeaders)
          .expect(200);

        // The 'No Dept' staff should not produce a '' or null facet entry
        const deptValues = response.body.facets.department.map((d) => d.value);
        expect(deptValues).not.toContain('');
        expect(deptValues).not.toContain(null);
      });

      it('facets respect q (search) filtering — pills reflect the searched set', async () => {
        const { school, admin } = await setupSchoolWithAdmin();
        await createTeacherInSchool(school._id, {
          name: 'Alice Math',
          staffRole: ['Teacher'],
          department: 'Math',
        });
        await createTeacherInSchool(school._id, {
          name: 'Bob Science',
          staffRole: ['Teacher'],
          department: 'Science',
        });

        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app)
          .get('/api/staff?page=1&limit=50&q=alice')
          .set(authHeaders)
          .expect(200);

        const deptValues = response.body.facets.department.map((d) => d.value);
        expect(deptValues).toContain('Math');
        expect(deptValues).not.toContain('Science');
      });

      it('facets and aggregates exclude deleted staff and honor the other active filters', async () => {
        const { school, admin } = await setupSchoolWithAdmin();
        await createTeacherInSchool(school._id, {
          name: 'Filtered Teacher',
          staffRole: ['Teacher'],
          department: 'Math',
        });
        await createTeacherInSchool(school._id, {
          name: 'Different Department',
          staffRole: ['Librarian'],
          department: 'Library',
        });
        const deleted = await createTeacherInSchool(school._id, {
          name: 'Deleted Accountant',
          staffRole: ['Accountant'],
          department: 'Math',
        });
        await Staff.findByIdAndUpdate(deleted._id, { isDeleted: true });

        const { app } = createTestApp();
        const response = await request(app)
          .get('/api/staff?page=1&limit=50&department=Math')
          .set(authHeadersFor(admin, 'admin'))
          .expect(200);

        expect(response.body.data.map((member) => member.name)).toEqual(['Filtered Teacher']);
        expect(response.body.facets.role.map((entry) => entry.value)).toContain('Teacher');
        expect(response.body.facets.role.map((entry) => entry.value)).not.toContain('Accountant');
        expect(response.body.aggregates.total).toBe(1);
      });

      it('skips facets when includeFacets=false', async () => {
        const { school, admin } = await setupSchoolWithAdmin();
        await createTeacherInSchool(school._id, { name: 'T1' });

        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app)
          .get('/api/staff?page=1&limit=50&includeFacets=false')
          .set(authHeaders)
          .expect(200);

        expect(response.body.facets).toBeUndefined();
      });

      it('non-paginated branch does NOT return facets (backward compat)', async () => {
        const { school, admin } = await setupSchoolWithAdmin();
        await createTeacherInSchool(school._id, { name: 'T1' });

        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app).get('/api/staff').set(authHeaders).expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.facets).toBeUndefined();
      });
    });

    describe('SCH-126 — today filter (StaffAttendance join)', () => {
      it('restricts to staff with an attendance record for today', async () => {
        const { school, admin } = await setupSchoolWithAdmin();
        const present = await createTeacherInSchool(school._id, { name: 'Present Today' });
        const absent = await createTeacherInSchool(school._id, { name: 'Absent Today' });
        await createTeacherInSchool(school._id, { name: 'No Attendance' });

        const today = new Date().toISOString().split('T')[0];
        await StaffAttendance.create([
          {
            schoolId: school._id,
            staffId: present._id,
            date: today,
            status: 'present',
          },
          {
            schoolId: school._id,
            staffId: absent._id,
            date: today,
            status: 'absent',
          },
        ]);

        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app)
          .get('/api/staff?page=1&limit=50&today=true')
          .set(authHeaders)
          .expect(200);

        const names = response.body.data.map((s) => s.name);
        expect(names).toContain('Present Today');
        expect(names).toContain('Absent Today');
        expect(names).not.toContain('No Attendance');
      });

      it('excludes staff whose only record is "unmarked" (excluded status)', async () => {
        const { school, admin } = await setupSchoolWithAdmin();
        const unmarked = await createTeacherInSchool(school._id, { name: 'Unmarked Today' });

        const today = new Date().toISOString().split('T')[0];
        await StaffAttendance.create({
          schoolId: school._id,
          staffId: unmarked._id,
          date: today,
          status: 'unmarked',
        });

        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app)
          .get('/api/staff?page=1&limit=50&today=true')
          .set(authHeaders)
          .expect(200);

        const names = response.body.data.map((s) => s.name);
        expect(names).not.toContain('Unmarked Today');
      });
    });

    describe('SCH-126 — backward compatibility', () => {
      it('canonical pagination contract: currentPage/itemsPerPage/totalItems/totalPages', async () => {
        const { school, admin } = await setupSchoolWithAdmin();
        for (let i = 0; i < 5; i++) {
          await createTeacherInSchool(school._id, { name: `Paged ${i}` });
        }

        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app)
          .get('/api/staff?page=1&limit=3')
          .set(authHeaders)
          .expect(200);

        // Canonical envelope (standardized via buildPaginationResponse) —
        // replaces the former staff-specific {page,limit,total,totalPages}.
        expect(response.body.pagination).toMatchObject({
          currentPage: 1,
          itemsPerPage: 3,
          totalItems: 6,
          totalPages: 2,
          hasNextPage: true,
          hasPrevPage: false,
        });
      });

      it('unchanged non-paginated contract: plain array with all staff', async () => {
        const { school, admin } = await setupSchoolWithAdmin();
        await createTeacherInSchool(school._id);
        await createTeacherInSchool(school._id);

        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app).get('/api/staff').set(authHeaders).expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBe(3); // admin + 2 teachers
      });

      it('non-paginated branch applies q/facet filters too (single source of truth)', async () => {
        const { school, admin } = await setupSchoolWithAdmin();
        await createTeacherInSchool(school._id, { name: 'Alpha' });
        await createTeacherInSchool(school._id, { name: 'Beta' });

        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app).get('/api/staff?q=alpha').set(authHeaders).expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        const names = response.body.map((s) => s.name);
        expect(names).toContain('Alpha');
        expect(names).not.toContain('Beta');
      });
    });
  });

  // ─── GET /api/staff/:id — Get staff by ID ─────────────────────────

  describe('GET /api/staff/:id — Get staff by ID', () => {
    it('returns the staff member with expected fields', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacherInSchool(school._id, { name: 'Detail Teacher' });

      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app)
        .get(`/api/staff/${teacher._id}`)
        .set(authHeaders)
        .expect(200);

      expect(response.body).toMatchObject({
        id: teacher._id.toString(),
        name: 'Detail Teacher',
        role: ['Teacher'],
      });
      expect(response.body).toHaveProperty('email');
      expect(response.body).toHaveProperty('code');
      expect(response.body).toHaveProperty('status');
    });

    it('returns 404 for a non-existent staff ID', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');
      const fakeId = new mongoose.Types.ObjectId().toString();

      await request(app).get(`/api/staff/${fakeId}`).set(authHeaders).expect(404);
    });

    it('returns 404 for a soft-deleted staff member', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacherInSchool(school._id);
      await Staff.findByIdAndUpdate(teacher._id, {
        isDeleted: true,
        deletedAt: new Date(),
      });

      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      await request(app).get(`/api/staff/${teacher._id}`).set(authHeaders).expect(404);
    });
  });

  // ─── POST /api/staff — Create staff ───────────────────────────────

  describe('POST /api/staff — Create staff', () => {
    it('creates a new staff member and returns it with an id and code', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app)
        .post('/api/staff')
        .set(authHeaders)
        .send({
          name: 'New Teacher',
          role: ['Teacher'],
          email: 'new.teacher@example.com',
          phone: '9876543210',
          department: 'Science',
        })
        .expect(201);

      expect(response.body).toMatchObject({
        name: 'New Teacher',
        role: ['Teacher'],
        department: 'Science',
      });
      expect(response.body.id).toBeTruthy();
      expect(response.body.code).toBeTruthy();
      expect(response.body.username).toBeTruthy();
      // Password should NOT be returned
      expect(response.body.password).toBeUndefined();
    });

    it('creates staff with minimal required fields (name + role)', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app)
        .post('/api/staff')
        .set(authHeaders)
        .send({
          name: 'Minimal Staff',
          role: ['Admin'],
        })
        .expect(201);

      expect(response.body.name).toBe('Minimal Staff');
      expect(response.body.id).toBeTruthy();
    });

    it('creates the Staff and Class sides of a class-teacher assignment together', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const classDoc = await createClassRecord({
        schoolId: school._id,
        name: 'Class Teacher Create',
        section: 'A',
      });
      const { app } = createTestApp();

      const response = await request(app)
        .post('/api/staff')
        .set(authHeadersFor(admin, 'admin'))
        .send({
          name: 'Atomic Class Teacher',
          role: ['Teacher'],
          assignedClassId: classDoc._id.toString(),
        })
        .expect(201);

      const created = await Staff.findById(response.body.id).lean();
      const assigned = await Class.findById(classDoc._id).lean();
      expect(created.isClassTeacher).toBe(true);
      expect(created.classTeacherOf).toBe('Class Teacher Create-A');
      expect(String(assigned.classTeacherId)).toBe(String(created._id));
    });

    it('rolls back staff creation when the class-teacher relationship cannot commit', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const classDoc = await createClassRecord({
        schoolId: school._id,
        name: 'Rollback Create',
        section: 'A',
      });
      const { app } = createTestApp();
      vi.spyOn(Staff, 'updateOne').mockRejectedValueOnce(new Error('forced assignment failure'));

      await request(app)
        .post('/api/staff')
        .set(authHeadersFor(admin, 'admin'))
        .send({
          name: 'Must Not Partially Exist',
          role: ['Teacher'],
          assignedClassId: classDoc._id.toString(),
        })
        .expect(500);

      expect(
        await Staff.exists({ schoolId: school._id, name: 'Must Not Partially Exist' })
      ).toBeNull();
      expect((await Class.findById(classDoc._id).lean()).classTeacherId).toBeFalsy();
    });

    it('canonicalises Teaching to Teacher while preserving additional roles', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();

      const response = await request(app)
        .post('/api/staff')
        .set(authHeadersFor(admin, 'admin'))
        .send({
          name: 'Multi Role Staff',
          role: ['Teaching', 'Accountant', 'Teacher'],
          phone: '9876501234',
          qualification: 'Senior educator',
          professionalQualifications: [{ name: 'B.Ed', year: '2020', documents: [] }],
        })
        .expect(201);

      expect(response.body.role).toEqual(['Teacher', 'Accountant']);
      expect(response.body.qualification).toBe('Senior educator');
      expect(response.body.professionalQualifications).toHaveLength(1);

      const stored = await Staff.findById(response.body.id).select('+phoneHash').lean();
      expect(stored.phoneHash).toBe(hmac('9876501234'));
    });

    it('rejects duplicate email within the same school', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      await request(app)
        .post('/api/staff')
        .set(authHeaders)
        .send({
          name: 'First Staff',
          role: ['Teacher'],
          email: 'duplicate@example.com',
        })
        .expect(201);

      const response = await request(app)
        .post('/api/staff')
        .set(authHeaders)
        .send({
          name: 'Second Staff',
          role: ['Teacher'],
          email: 'duplicate@example.com',
        })
        .expect(409);

      expect(response.body.error).toMatch(/email/i);
    });

    // ─── Zod validation tests ───────────────────────────────────

    describe('Zod validation', () => {
      it('requires a selected class when isClassTeacher is true', async () => {
        const { admin } = await setupSchoolWithAdmin();
        const { app } = createTestApp();

        const response = await request(app)
          .post('/api/staff')
          .set(authHeadersFor(admin, 'admin'))
          .send({ name: 'Unassigned Class Teacher', role: ['Teacher'], isClassTeacher: true })
          .expect(400);

        expect(JSON.stringify(response.body)).toMatch(/select a class/i);
      });

      it('returns 400 when name is missing', async () => {
        const { admin } = await setupSchoolWithAdmin();
        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app)
          .post('/api/staff')
          .set(authHeaders)
          .send({ role: ['Teacher'] })
          .expect(400);

        expect(response.body.error || response.body.errors).toBeTruthy();
      });

      it('returns 400 when role is missing', async () => {
        const { admin } = await setupSchoolWithAdmin();
        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app)
          .post('/api/staff')
          .set(authHeaders)
          .send({ name: 'No Role Staff' })
          .expect(400);

        expect(response.body.error || response.body.errors).toBeTruthy();
      });

      it('returns 400 when name is too short (less than 2 chars)', async () => {
        const { admin } = await setupSchoolWithAdmin();
        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app)
          .post('/api/staff')
          .set(authHeaders)
          .send({ name: 'A', role: ['Teacher'] })
          .expect(400);

        expect(response.body.error || response.body.errors).toBeTruthy();
      });

      it('returns 400 for invalid email format', async () => {
        const { admin } = await setupSchoolWithAdmin();
        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app)
          .post('/api/staff')
          .set(authHeaders)
          .send({
            name: 'Bad Email Staff',
            role: ['Teacher'],
            email: 'not-an-email',
          })
          .expect(400);

        expect(response.body.error || response.body.errors).toBeTruthy();
      });

      it('returns 400 for invalid status enum value', async () => {
        const { admin } = await setupSchoolWithAdmin();
        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app)
          .post('/api/staff')
          .set(authHeaders)
          .send({
            name: 'Bad Status Staff',
            role: ['Teacher'],
            status: 'fired',
          })
          .expect(400);

        expect(response.body.error || response.body.errors).toBeTruthy();
      });

      it('returns 400 for invalid IFSC code format', async () => {
        const { admin } = await setupSchoolWithAdmin();
        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app)
          .post('/api/staff')
          .set(authHeaders)
          .send({
            name: 'Bad IFSC Staff',
            role: ['Teacher'],
            ifscCode: 'INVALID',
          })
          .expect(400);

        expect(response.body.error || response.body.errors).toBeTruthy();
      });

      it('returns 400 for invalid PAN number format', async () => {
        const { admin } = await setupSchoolWithAdmin();
        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app)
          .post('/api/staff')
          .set(authHeaders)
          .send({
            name: 'Bad PAN Staff',
            role: ['Teacher'],
            panNumber: '12345',
          })
          .expect(400);

        expect(response.body.error || response.body.errors).toBeTruthy();
      });

      it('returns 400 for negative salary value', async () => {
        const { admin } = await setupSchoolWithAdmin();
        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app)
          .post('/api/staff')
          .set(authHeaders)
          .send({
            name: 'Negative Salary Staff',
            role: ['Teacher'],
            salary: -5000,
          })
          .expect(400);

        expect(response.body.error || response.body.errors).toBeTruthy();
      });

      it('accepts role as a string and normalizes to array', async () => {
        const { admin } = await setupSchoolWithAdmin();
        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app)
          .post('/api/staff')
          .set(authHeaders)
          .send({
            name: 'String Role Staff',
            role: 'Teacher',
          })
          .expect(201);

        expect(Array.isArray(response.body.role)).toBe(true);
        expect(response.body.role).toContain('Teacher');
      });
    });
  });

  // ─── PUT /api/staff/:id — Update staff ────────────────────────────

  describe('PUT /api/staff/:id — Update staff', () => {
    it('updates staff fields and returns updated data', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacherInSchool(school._id, { name: 'Before Update' });

      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app)
        .put(`/api/staff/${teacher._id}`)
        .set(authHeaders)
        .send({
          name: 'After Update',
          department: 'Mathematics',
          phone: '9111222333',
        })
        .expect(200);

      expect(response.body).toMatchObject({
        id: teacher._id.toString(),
        name: 'After Update',
        department: 'Mathematics',
        phone: '9111222333',
      });
    });

    it('hashes a reset password exactly once and revokes the target staff sessions', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacherInSchool(school._id, {
        name: 'Password Reset Target',
        password: 'OldPassword123',
      });
      const previousTokenVersion = teacher.tokenVersion;
      const session = await Session.create({
        sessionId: `staff-reset-${teacher._id}`,
        userId: teacher._id,
        schoolId: school._id,
        userType: 'staff',
        expiresAt: new Date(Date.now() + 60_000),
      });

      const { app } = createTestApp();
      await request(app)
        .put(`/api/staff/${teacher._id}`)
        .set(authHeadersFor(admin, 'admin'))
        .send({ password: 'NewPassword456' })
        .expect(200);

      const updated = await Staff.findById(teacher._id);
      expect(await updated.comparePassword('NewPassword456')).toBe(true);
      expect(await updated.comparePassword('OldPassword123')).toBe(false);
      expect(updated.tokenVersion).toBe(previousTokenVersion + 1);

      const revokedSession = await Session.findById(session._id).lean();
      expect(revokedSession.isRevoked).toBe(true);
      expect(revokedSession.revokedAt).toBeInstanceOf(Date);
    });

    it('returns 404 when updating a non-existent staff member', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');
      const fakeId = new mongoose.Types.ObjectId().toString();

      await request(app)
        .put(`/api/staff/${fakeId}`)
        .set(authHeaders)
        .send({ name: 'Ghost Update' })
        .expect(404);
    });

    it('returns 404 when updating a soft-deleted staff member', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacherInSchool(school._id);
      await Staff.findByIdAndUpdate(teacher._id, {
        isDeleted: true,
        deletedAt: new Date(),
      });

      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      await request(app)
        .put(`/api/staff/${teacher._id}`)
        .set(authHeaders)
        .send({ name: 'Zombie Update' })
        .expect(404);
    });

    it('lowercases email on update', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacherInSchool(school._id);

      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app)
        .put(`/api/staff/${teacher._id}`)
        .set(authHeaders)
        .send({ email: 'UPPER@EXAMPLE.COM' })
        .expect(200);

      expect(response.body.email).toBe('upper@example.com');
    });

    it('does NOT desync Staff↔Class when caller sends isClassTeacher/classTeacherOf alone', async () => {
      // Before the fix, sending `{isClassTeacher: true, classTeacherOf:
      // 'Class 5-A'}` wrote those flags to the Staff doc without ever
      // updating Class.classTeacherId — the two collections drifted.
      // Now those fields are server-derived; the legacy shape is resolved
      // to an assignedClassId and both sides of the relationship update.
      const { Class } = await import('../database.js');
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacherInSchool(school._id, { name: 'CT Candidate' });

      const targetClass = await Class.create({
        schoolId: school._id,
        name: 'Class 5',
        section: 'A',
      });

      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      await request(app)
        .put(`/api/staff/${teacher._id}`)
        .set(authHeaders)
        .send({
          isClassTeacher: true,
          classTeacherOf: 'Class 5-A',
        })
        .expect(200);

      // Staff side updated
      const updatedTeacher = await Staff.findById(teacher._id).lean();
      expect(updatedTeacher.isClassTeacher).toBe(true);
      expect(updatedTeacher.classTeacherOf).toBe('Class 5-A');

      // Class side MUST also be updated — this is the fix
      const updatedClass = await Class.findById(targetClass._id).lean();
      expect(updatedClass.classTeacherId?.toString()).toBe(teacher._id.toString());
    });

    it('rolls back both sides when a class-teacher update fails mid-transaction', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacherInSchool(school._id, { name: 'Rollback Teacher' });
      const targetClass = await createClassRecord({
        schoolId: school._id,
        name: 'Rollback Class',
        section: 'A',
      });
      const { app } = createTestApp();
      vi.spyOn(Staff, 'updateOne').mockRejectedValueOnce(new Error('forced assignment failure'));

      await request(app)
        .put(`/api/staff/${teacher._id}`)
        .set(authHeadersFor(admin, 'admin'))
        .send({ assignedClassId: targetClass._id.toString() })
        .expect(500);

      const unchangedTeacher = await Staff.findById(teacher._id).lean();
      const unchangedClass = await Class.findById(targetClass._id).lean();
      expect(unchangedTeacher.isClassTeacher).not.toBe(true);
      expect(unchangedTeacher.classTeacherOf).toBeFalsy();
      expect(unchangedClass.classTeacherId).toBeFalsy();
    });

    it('validates update payload with Zod (rejects invalid status)', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacherInSchool(school._id);

      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app)
        .put(`/api/staff/${teacher._id}`)
        .set(authHeaders)
        .send({ status: 'nonexistent-status' })
        .expect(400);

      expect(response.body.error || response.body.errors).toBeTruthy();
    });
  });

  // ─── DELETE /api/staff/:id — Soft delete ──────────────────────────

  describe('DELETE /api/staff/:id — Soft delete', () => {
    it('soft-deletes a staff member and returns success', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacherInSchool(school._id, { name: 'To Delete' });

      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app)
        .delete(`/api/staff/${teacher._id}`)
        .set(authHeaders)
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify in DB: isDeleted is true, status is inactive
      const deleted = await Staff.findById(teacher._id).lean();
      expect(deleted).toBeTruthy();
      expect(deleted.isDeleted).toBe(true);
      expect(deleted.deletedAt).toBeTruthy();
      expect(deleted.status).toBe('inactive');
    });

    it('returns 404 when deleting a non-existent staff member', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');
      const fakeId = new mongoose.Types.ObjectId().toString();

      await request(app).delete(`/api/staff/${fakeId}`).set(authHeaders).expect(404);
    });

    it('returns 404 when deleting an already-deleted staff member', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacherInSchool(school._id);
      await Staff.findByIdAndUpdate(teacher._id, {
        isDeleted: true,
        deletedAt: new Date(),
      });

      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      await request(app).delete(`/api/staff/${teacher._id}`).set(authHeaders).expect(404);
    });

    it('soft-deleted staff no longer appears in GET /api/staff list', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacherInSchool(school._id, { name: 'Vanishing Staff' });

      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      // Delete
      await request(app).delete(`/api/staff/${teacher._id}`).set(authHeaders).expect(200);

      // Verify not in list
      const listResponse = await request(app).get('/api/staff').set(authHeaders).expect(200);

      const names = listResponse.body.map((s) => s.name);
      expect(names).not.toContain('Vanishing Staff');
    });

    it('archives and restores staff without deleting historical records', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacherInSchool(school._id, { name: 'Restorable Teacher' });
      const classDoc = await createClassRecord({
        schoolId: school._id,
        name: 'Restore Class',
        section: 'A',
        classTeacherId: teacher._id,
      });
      await Staff.findByIdAndUpdate(teacher._id, {
        isClassTeacher: true,
        classTeacherOf: `${classDoc.name}-${classDoc.section}`,
      });
      const attendance = await StaffAttendance.create({
        schoolId: school._id,
        staffId: teacher._id,
        date: '2025-03-03',
        status: 'present',
      });
      const leave = await TeacherLeave.create({
        schoolId: school._id,
        teacherId: teacher._id,
        leaveType: 'Sick',
        reason: 'Recovery',
        startDate: new Date('2025-03-04T00:00:00.000Z'),
        endDate: new Date('2025-03-04T00:00:00.000Z'),
        days: 1,
      });
      const conversation = await Conversation.create({
        schoolId: school._id,
        participants: [
          { userId: teacher._id, userModel: 'Staff', name: teacher.name },
          { userId: admin._id, userModel: 'Staff', name: admin.name },
        ],
      });
      const message = await Message.create({
        schoolId: school._id,
        conversationId: conversation._id,
        senderId: teacher._id,
        senderModel: 'Staff',
        receiverId: admin._id,
        receiverModel: 'Staff',
        content: 'Historical message',
      });

      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');
      await request(app).delete(`/api/staff/${teacher._id}`).set(authHeaders).expect(200);

      expect(await StaffAttendance.exists({ _id: attendance._id })).toBeTruthy();
      expect(await TeacherLeave.exists({ _id: leave._id })).toBeTruthy();
      expect(await Conversation.exists({ _id: conversation._id })).toBeTruthy();
      expect(await Message.exists({ _id: message._id })).toBeTruthy();
      expect((await Class.findById(classDoc._id).lean()).classTeacherId).toBeFalsy();

      const trashItem = await TrashItem.findOne({
        schoolId: school._id,
        itemType: 'Staff',
        itemId: teacher._id,
      });
      expect(trashItem).toBeTruthy();
      expect(trashItem.deletionContext.assignedClasses).toHaveLength(1);

      await request(app).post(`/api/trash/${trashItem._id}/restore`).set(authHeaders).expect(200);

      const restored = await Staff.findById(teacher._id).lean();
      const restoredClass = await Class.findById(classDoc._id).lean();
      expect(restored.isDeleted).toBe(false);
      expect(restored.status).toBe('active');
      expect(restored.isClassTeacher).toBe(true);
      expect(String(restoredClass.classTeacherId)).toBe(String(teacher._id));
      expect(await TrashItem.findById(trashItem._id)).toBeNull();
      expect(await StaffAttendance.exists({ _id: attendance._id })).toBeTruthy();
      expect(await TeacherLeave.exists({ _id: leave._id })).toBeTruthy();
      expect(await Conversation.exists({ _id: conversation._id })).toBeTruthy();
      expect(await Message.exists({ _id: message._id })).toBeTruthy();
    });

    it('rolls back account, class, session, and push-token changes if archiving fails', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacherInSchool(school._id, { name: 'Archive Rollback' });
      const classDoc = await createClassRecord({
        schoolId: school._id,
        name: 'Archive Rollback Class',
        section: 'A',
        classTeacherId: teacher._id,
      });
      await Staff.findByIdAndUpdate(teacher._id, {
        isClassTeacher: true,
        classTeacherOf: `${classDoc.name}-${classDoc.section}`,
      });
      const loginSession = await Session.create({
        sessionId: `archive-rollback-${teacher._id}`,
        userId: teacher._id,
        schoolId: school._id,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const pushToken = await PushToken.create({
        user: teacher._id,
        userModel: 'Staff',
        schoolId: school._id,
        token: `archive-rollback-token-${teacher._id}`,
        platform: 'web',
      });
      vi.spyOn(TrashItem, 'create').mockRejectedValueOnce(new Error('forced trash failure'));
      const { app } = createTestApp();

      await request(app)
        .delete(`/api/staff/${teacher._id}`)
        .set(authHeadersFor(admin, 'admin'))
        .expect(500);

      const unchangedTeacher = await Staff.findById(teacher._id).lean();
      const unchangedClass = await Class.findById(classDoc._id).lean();
      const unchangedSession = await Session.findById(loginSession._id).lean();
      const unchangedPushToken = await PushToken.findById(pushToken._id).lean();
      expect(unchangedTeacher.isDeleted).not.toBe(true);
      expect(unchangedTeacher.status).toBe('active');
      expect(unchangedTeacher.isClassTeacher).toBe(true);
      expect(String(unchangedClass.classTeacherId)).toBe(String(teacher._id));
      expect(unchangedSession.isRevoked).toBe(false);
      expect(unchangedPushToken.isActive).toBe(true);
      expect(await TrashItem.exists({ schoolId: school._id, itemId: teacher._id })).toBeNull();
    });

    it('keeps an archived staff member deleted when their former class now has another teacher', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacherInSchool(school._id, { name: 'Archived Teacher' });
      const replacement = await createTeacherInSchool(school._id, { name: 'Replacement Teacher' });
      const classDoc = await createClassRecord({
        schoolId: school._id,
        name: 'Conflict Class',
        section: 'A',
        classTeacherId: teacher._id,
      });
      await Staff.findByIdAndUpdate(teacher._id, {
        isClassTeacher: true,
        classTeacherOf: `${classDoc.name}-${classDoc.section}`,
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');
      await request(app).delete(`/api/staff/${teacher._id}`).set(authHeaders).expect(200);

      await Class.findByIdAndUpdate(classDoc._id, { classTeacherId: replacement._id });
      await Staff.findByIdAndUpdate(replacement._id, {
        isClassTeacher: true,
        classTeacherOf: `${classDoc.name}-${classDoc.section}`,
      });
      const trashItem = await TrashItem.findOne({
        schoolId: school._id,
        itemType: 'Staff',
        itemId: teacher._id,
      });

      await request(app).post(`/api/trash/${trashItem._id}/restore`).set(authHeaders).expect(500);

      expect((await Staff.findById(teacher._id).lean()).isDeleted).toBe(true);
      expect(String((await Class.findById(classDoc._id).lean()).classTeacherId)).toBe(
        String(replacement._id)
      );
      expect(await TrashItem.findById(trashItem._id)).toBeTruthy();
    });
  });

  // ─── Multi-tenancy ────────────────────────────────────────────────

  describe('Multi-tenancy', () => {
    it('School A admin cannot see School B staff in the list', async () => {
      const schoolA = await createSchoolRecord({ name: 'Tenant School A' });
      const schoolB = await createSchoolRecord({ name: 'Tenant School B' });

      const adminA = await createStaffUser({ schoolId: schoolA._id, name: 'Admin A' });
      await Staff.findByIdAndUpdate(adminA._id, { username: `tenantA_admin_${Date.now()}` });

      await createTeacherInSchool(schoolA._id, { name: 'Teacher in A' });
      await createTeacherInSchool(schoolB._id, { name: 'Teacher in B' });

      const { app } = createTestApp();
      const authHeadersA = authHeadersFor(adminA, 'admin');

      const response = await request(app).get('/api/staff').set(authHeadersA).expect(200);

      const names = response.body.map((s) => s.name);
      expect(names).toContain('Teacher in A');
      expect(names).not.toContain('Teacher in B');
    });

    it('School A admin cannot access School B staff by ID', async () => {
      const schoolA = await createSchoolRecord({ name: 'ISO School A' });
      const schoolB = await createSchoolRecord({ name: 'ISO School B' });

      const adminA = await createStaffUser({ schoolId: schoolA._id, name: 'ISO Admin A' });
      await Staff.findByIdAndUpdate(adminA._id, { username: `iso_admin_${Date.now()}` });

      const teacherB = await createTeacherInSchool(schoolB._id, { name: 'Secret Teacher B' });

      const { app } = createTestApp();
      const authHeadersA = authHeadersFor(adminA, 'admin');

      await request(app).get(`/api/staff/${teacherB._id}`).set(authHeadersA).expect(404);
    });

    it('School A admin cannot update School B staff', async () => {
      const schoolA = await createSchoolRecord({ name: 'Update ISO A' });
      const schoolB = await createSchoolRecord({ name: 'Update ISO B' });

      const adminA = await createStaffUser({ schoolId: schoolA._id, name: 'Update Admin A' });
      await Staff.findByIdAndUpdate(adminA._id, { username: `update_iso_admin_${Date.now()}` });

      const teacherB = await createTeacherInSchool(schoolB._id, { name: 'B Only Teacher' });

      const { app } = createTestApp();
      const authHeadersA = authHeadersFor(adminA, 'admin');

      await request(app)
        .put(`/api/staff/${teacherB._id}`)
        .set(authHeadersA)
        .send({ name: 'Hacked Name' })
        .expect(404);

      // Verify the name was NOT changed
      const unchanged = await Staff.findById(teacherB._id).lean();
      expect(unchanged.name).toBe('B Only Teacher');
    });

    it('School A admin cannot delete School B staff', async () => {
      const schoolA = await createSchoolRecord({ name: 'Delete ISO A' });
      const schoolB = await createSchoolRecord({ name: 'Delete ISO B' });

      const adminA = await createStaffUser({ schoolId: schoolA._id, name: 'Delete Admin A' });
      await Staff.findByIdAndUpdate(adminA._id, { username: `delete_iso_admin_${Date.now()}` });

      const teacherB = await createTeacherInSchool(schoolB._id, { name: 'Protected Teacher B' });

      const { app } = createTestApp();
      const authHeadersA = authHeadersFor(adminA, 'admin');

      await request(app).delete(`/api/staff/${teacherB._id}`).set(authHeadersA).expect(404);

      // Verify the staff is still active and not deleted
      const stillExists = await Staff.findById(teacherB._id).lean();
      expect(stillExists.isDeleted).toBeFalsy();
    });

    it('staff created via POST has correct schoolId from auth context', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app)
        .post('/api/staff')
        .set(authHeaders)
        .send({
          name: 'Scoped Staff',
          role: ['Teacher'],
        })
        .expect(201);

      expect(response.body.schoolId).toBe(school._id.toString());

      // Verify in DB
      const dbStaff = await Staff.findById(response.body.id).lean();
      expect(dbStaff.schoolId.toString()).toBe(school._id.toString());
    });
  });
});
