/**
 * E2E-10: Multi-tenant isolation — school A cannot see school B data
 *
 * Verifies that all major resource endpoints enforce schoolId scoping from
 * the JWT so that one school's admin cannot read, update, or delete another
 * school's records — even when supplying the foreign resource ID directly.
 *
 * Modules covered: students, classes, staff
 */

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Staff } from '../database.js';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let seq = 0;

/**
 * Create an isolated school + admin pair. Each call produces a unique school
 * and admin so tests are fully independent of each other.
 */
async function buildTenant(label = 'School') {
  seq += 1;
  const school = await createSchoolRecord({ name: `${label} ${seq}` });
  const admin = await createStaffUser({ schoolId: school._id });
  // Ensure unique username to avoid sparse compound-unique-index collisions.
  await Staff.findByIdAndUpdate(admin._id, { username: `admin_${label}_${seq}_${Date.now()}` });
  return { school, admin, headers: authHeadersFor(admin, 'admin') };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Multi-tenant isolation (E2E-10)', () => {
  // ── Students ──────────────────────────────────────────────────────────────

  describe('Students — schoolId scoping', () => {
    it('school A admin sees only school A students in the list', async () => {
      const { app } = createTestApp();
      const tenantA = await buildTenant('SchoolA');
      const tenantB = await buildTenant('SchoolB');

      const classA = await createClassRecord({ schoolId: tenantA.school._id });
      const classB = await createClassRecord({ schoolId: tenantB.school._id });

      // Two students in school A, one in school B
      await createStudentRecord({
        name: 'Alice A',
        schoolId: tenantA.school._id,
        classId: classA._id,
      });
      await createStudentRecord({
        name: 'Bob A',
        schoolId: tenantA.school._id,
        classId: classA._id,
      });
      await createStudentRecord({
        name: 'Carol B',
        schoolId: tenantB.school._id,
        classId: classB._id,
      });

      const res = await request(app).get('/api/students').set(tenantA.headers).expect(200);

      const names = res.body.data.map((s) => s.name);
      expect(names).toContain('Alice A');
      expect(names).toContain('Bob A');
      expect(names).not.toContain('Carol B');
    });

    it('school B admin sees only school B students in the list', async () => {
      const { app } = createTestApp();
      const tenantA = await buildTenant('SchoolA');
      const tenantB = await buildTenant('SchoolB');

      const classA = await createClassRecord({ schoolId: tenantA.school._id });
      const classB = await createClassRecord({ schoolId: tenantB.school._id });

      await createStudentRecord({
        name: 'Alice A',
        schoolId: tenantA.school._id,
        classId: classA._id,
      });
      await createStudentRecord({
        name: 'Carol B',
        schoolId: tenantB.school._id,
        classId: classB._id,
      });

      const res = await request(app).get('/api/students').set(tenantB.headers).expect(200);

      const names = res.body.data.map((s) => s.name);
      expect(names).toContain('Carol B');
      expect(names).not.toContain('Alice A');
    });

    it('school A admin gets 404 when fetching a school B student by ID', async () => {
      const { app } = createTestApp();
      const tenantA = await buildTenant('SchoolA');
      const tenantB = await buildTenant('SchoolB');

      const classB = await createClassRecord({ schoolId: tenantB.school._id });
      const studentB = await createStudentRecord({
        name: 'Carol B',
        schoolId: tenantB.school._id,
        classId: classB._id,
      });

      await request(app).get(`/api/students/${studentB._id}`).set(tenantA.headers).expect(404);
    });

    it('school A admin cannot update a school B student', async () => {
      const { app } = createTestApp();
      const tenantA = await buildTenant('SchoolA');
      const tenantB = await buildTenant('SchoolB');

      const classB = await createClassRecord({ schoolId: tenantB.school._id });
      const studentB = await createStudentRecord({
        name: 'Carol B',
        schoolId: tenantB.school._id,
        classId: classB._id,
      });

      await request(app)
        .put(`/api/students/${studentB._id}`)
        .set(tenantA.headers)
        .send({ name: 'Hacked Name' })
        .expect(404);
    });

    it('creating a student always uses schoolId from JWT, not request body', async () => {
      const { app } = createTestApp();
      const tenantA = await buildTenant('SchoolA');
      const tenantB = await buildTenant('SchoolB');

      const classA = await createClassRecord({ schoolId: tenantA.school._id });

      const res = await request(app)
        .post('/api/students')
        .set(tenantA.headers)
        .send({
          name: 'Injected Student',
          admissionId: `ADM-INJECT-${Date.now()}`,
          academicYear: '2025-26',
          rollNo: 99,
          classId: classA._id.toString(),
          dateOfBirth: '2010-01-01',
          parents: [
            { name: 'Parent X', relationship: 'father', phone: '9000000099', isWhatsapp: false },
          ],
          // Attacker tries to assign data to school B
          schoolId: tenantB.school._id.toString(),
        })
        .expect(201);

      // The created student must belong to school A (from JWT), not school B
      expect(res.body.schoolId?.toString()).not.toBe(tenantB.school._id.toString());
    });
  });

  // ── Classes ───────────────────────────────────────────────────────────────

  describe('Classes — schoolId scoping', () => {
    it('school A admin sees only school A classes in the list', async () => {
      const { app } = createTestApp();
      const tenantA = await buildTenant('SchoolA');
      const tenantB = await buildTenant('SchoolB');

      await createClassRecord({ name: 'ClassA', section: 'A', schoolId: tenantA.school._id });
      await createClassRecord({ name: 'ClassB', section: 'A', schoolId: tenantB.school._id });

      const res = await request(app).get('/api/classes').set(tenantA.headers).expect(200);

      const names = res.body.map((c) => c.name);
      expect(names).toContain('ClassA');
      expect(names).not.toContain('ClassB');
    });

    it('school A admin gets 404 when fetching a school B class by ID', async () => {
      const { app } = createTestApp();
      const tenantA = await buildTenant('SchoolA');
      const tenantB = await buildTenant('SchoolB');

      const classB = await createClassRecord({
        name: 'ClassB',
        section: 'A',
        schoolId: tenantB.school._id,
      });

      await request(app).get(`/api/classes/${classB._id}`).set(tenantA.headers).expect(404);
    });

    it('school A admin cannot update a school B class', async () => {
      const { app } = createTestApp();
      const tenantA = await buildTenant('SchoolA');
      const tenantB = await buildTenant('SchoolB');

      const classB = await createClassRecord({
        name: 'ClassB',
        section: 'A',
        schoolId: tenantB.school._id,
      });

      await request(app)
        .put(`/api/classes/${classB._id}`)
        .set(tenantA.headers)
        .send({ name: 'Hacked Class' })
        .expect(404);
    });

    it('school A admin cannot delete a school B class', async () => {
      const { app } = createTestApp();
      const tenantA = await buildTenant('SchoolA');
      const tenantB = await buildTenant('SchoolB');

      const classB = await createClassRecord({
        name: 'ClassB-Del',
        section: 'B',
        schoolId: tenantB.school._id,
      });

      await request(app).delete(`/api/classes/${classB._id}`).set(tenantA.headers).expect(404);
    });
  });

  // ── Staff ─────────────────────────────────────────────────────────────────

  describe('Staff — schoolId scoping', () => {
    it('school A admin sees only school A staff in the list', async () => {
      const { app } = createTestApp();
      const tenantA = await buildTenant('SchoolA');
      const tenantB = await buildTenant('SchoolB');

      // Add an extra teacher to each school so we have a clear signal
      const teacherA = await createStaffUser({
        name: 'Teacher Alpha',
        schoolId: tenantA.school._id,
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
      });
      const teacherB = await createStaffUser({
        name: 'Teacher Beta',
        schoolId: tenantB.school._id,
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
      });

      await Staff.findByIdAndUpdate(teacherA._id, { username: `ta_${Date.now()}a` });
      await Staff.findByIdAndUpdate(teacherB._id, { username: `tb_${Date.now()}b` });

      const res = await request(app).get('/api/staff').set(tenantA.headers).expect(200);

      // GET /api/staff without ?page returns a plain array
      const staffList = Array.isArray(res.body) ? res.body : (res.body.data ?? []);
      const names = staffList.map((s) => s.name);
      expect(names).toContain('Teacher Alpha');
      expect(names).not.toContain('Teacher Beta');
    });

    it('school A admin gets 404 when fetching a school B staff member by ID', async () => {
      const { app } = createTestApp();
      const tenantA = await buildTenant('SchoolA');
      const tenantB = await buildTenant('SchoolB');

      const staffB = await createStaffUser({ name: 'Staff Beta', schoolId: tenantB.school._id });
      await Staff.findByIdAndUpdate(staffB._id, { username: `sb_${Date.now()}` });

      await request(app).get(`/api/staff/${staffB._id}`).set(tenantA.headers).expect(404);
    });
  });

  // ── Token forgery guard ───────────────────────────────────────────────────

  describe('Token — unauthenticated requests are rejected', () => {
    it('returns 401 for students list without auth header', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/students').expect(401);
    });

    it('returns 401 for classes list without auth header', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/classes').expect(401);
    });

    it('returns 401 for staff list without auth header', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/staff').expect(401);
    });
  });
});
