/**
 * E2E-06: Staff creation → class teacher assignment → timetable generation
 *
 * Tests the full flow:
 *   1. Create a staff member via POST /api/staff
 *   2. Create a class via POST /api/classes
 *   3. Assign the staff as class teacher via PUT /api/classes/:id/class-teacher
 *      — verifies the Staff document is synced (isClassTeacher, classTeacherOf)
 *   4. Generate timetables via POST /api/timetable/generate-all
 *      — verifies Timetable and TeacherTimetable documents are created with correct schoolId
 */

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Class, Staff, Timetable, TeacherTimetable } from '../database.js';
import { createSchoolRecord, createStaffUser, authHeadersFor } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let adminSeq = 0;
async function setupSchoolWithAdmin(schoolName = 'E2E Test School') {
  adminSeq += 1;
  const school = await createSchoolRecord({ name: schoolName });
  const admin = await createStaffUser({ schoolId: school._id });
  await Staff.findByIdAndUpdate(admin._id, {
    username: `e2e_admin_${adminSeq}_${Date.now()}`,
  });
  return { school, admin };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('E2E-06: Staff creation → class teacher assignment → timetable generation', () => {
  // ─── Step 1: Staff creation ────────────────────────────────────────────────

  describe('Step 1 — POST /api/staff: Create a staff member', () => {
    it('creates a teacher and returns id, role, code; never returns password', async () => {
      const { school, admin } = await setupSchoolWithAdmin('Staff Creation School');
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .post('/api/staff')
        .set(authHeaders)
        .send({
          name: 'Ms. Priya Sharma',
          role: ['Teacher'],
          email: 'priya.sharma@e2e.example.com',
          phone: '9876500001',
          department: 'Mathematics',
        })
        .expect(201);

      expect(res.body.id).toBeTruthy();
      expect(res.body.name).toBe('Ms. Priya Sharma');
      expect(res.body.role).toContain('Teacher');
      expect(res.body.code).toBeTruthy();
      // Multi-tenancy: schoolId in response must match the auth school
      expect(res.body.schoolId).toBe(school._id.toString());
      // Security: password must never be returned
      expect(res.body.password).toBeUndefined();
    });

    it('persists the staff document with correct schoolId in the database', async () => {
      const { school, admin } = await setupSchoolWithAdmin('DB Persist School');
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .post('/api/staff')
        .set(authHeaders)
        .send({ name: 'Mr. DB Teacher', role: ['Teacher'] })
        .expect(201);

      const dbDoc = await Staff.findById(res.body.id).lean();
      expect(dbDoc).toBeTruthy();
      expect(dbDoc.schoolId.toString()).toBe(school._id.toString());
      expect(dbDoc.name).toBe('Mr. DB Teacher');
    });
  });

  // ─── Step 2: Class teacher assignment ─────────────────────────────────────

  describe('Step 2 — PUT /api/classes/:id/class-teacher: Assign class teacher', () => {
    it('assigns a teacher and syncs isClassTeacher + classTeacherOf on the Staff document', async () => {
      const { admin } = await setupSchoolWithAdmin('Assign Teacher School');
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      // Create teacher via API
      const staffRes = await request(app)
        .post('/api/staff')
        .set(authHeaders)
        .send({ name: 'Mr. Ravi Kumar', role: ['Teacher'] })
        .expect(201);
      const teacherId = staffRes.body.id;

      // Create class via API
      const classRes = await request(app)
        .post('/api/classes')
        .set(authHeaders)
        .send({
          name: 'Class 8',
          section: 'A',
          subjects: ['Math', 'Science', 'English'],
          academicYear: '2025-26',
        })
        .expect(201);
      const classId = classRes.body.id;

      // Assign class teacher
      const assignRes = await request(app)
        .put(`/api/classes/${classId}/class-teacher`)
        .set(authHeaders)
        .send({ classTeacherId: teacherId })
        .expect(200);

      expect(assignRes.body.classTeacherId.toString()).toBe(teacherId);
      expect(assignRes.body.teacherName).toBe('Mr. Ravi Kumar');

      // Verify Staff document was synced
      const staffDoc = await Staff.findById(teacherId).lean();
      expect(staffDoc.isClassTeacher).toBe(true);
      expect(staffDoc.classTeacherOf).toBe('Class 8-A');
    });

    it('unassigning a class teacher clears isClassTeacher and classTeacherOf on the Staff document', async () => {
      const { admin } = await setupSchoolWithAdmin('Unassign Teacher School');
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const staffRes = await request(app)
        .post('/api/staff')
        .set(authHeaders)
        .send({ name: 'Ms. Temp Teacher', role: ['Teacher'] })
        .expect(201);
      const teacherId = staffRes.body.id;

      const classRes = await request(app)
        .post('/api/classes')
        .set(authHeaders)
        .send({ name: 'Class 7', section: 'B', subjects: ['Math'], academicYear: '2025-26' })
        .expect(201);
      const classId = classRes.body.id;

      // Assign
      await request(app)
        .put(`/api/classes/${classId}/class-teacher`)
        .set(authHeaders)
        .send({ classTeacherId: teacherId })
        .expect(200);

      // Unassign by sending null
      await request(app)
        .put(`/api/classes/${classId}/class-teacher`)
        .set(authHeaders)
        .send({ classTeacherId: null })
        .expect(200);

      // Verify Staff doc was cleared
      const staffDoc = await Staff.findById(teacherId).lean();
      expect(staffDoc.isClassTeacher).toBeFalsy();
      expect(staffDoc.classTeacherOf).toBeFalsy();
    });

    it('prevents assigning the same teacher as class teacher in two classes (returns 400)', async () => {
      const { admin } = await setupSchoolWithAdmin('Duplicate Teacher School');
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const staffRes = await request(app)
        .post('/api/staff')
        .set(authHeaders)
        .send({ name: 'Ms. Dual Teacher', role: ['Teacher'] })
        .expect(201);
      const teacherId = staffRes.body.id;

      const class1Res = await request(app)
        .post('/api/classes')
        .set(authHeaders)
        .send({ name: 'Class 9', section: 'A', academicYear: '2025-26' })
        .expect(201);

      const class2Res = await request(app)
        .post('/api/classes')
        .set(authHeaders)
        .send({ name: 'Class 9', section: 'B', academicYear: '2025-26' })
        .expect(201);

      // First assignment succeeds
      await request(app)
        .put(`/api/classes/${class1Res.body.id}/class-teacher`)
        .set(authHeaders)
        .send({ classTeacherId: teacherId })
        .expect(200);

      // Second assignment to a different class should fail
      const conflictRes = await request(app)
        .put(`/api/classes/${class2Res.body.id}/class-teacher`)
        .set(authHeaders)
        .send({ classTeacherId: teacherId })
        .expect(400);

      expect(conflictRes.body.error).toMatch(/already assigned/i);
    });

    it('returns 404 when assigning a teacher from another school (multi-tenancy)', async () => {
      const schoolA = await createSchoolRecord({ name: 'E2E School A' });
      const schoolB = await createSchoolRecord({ name: 'E2E School B' });

      const adminA = await createStaffUser({ schoolId: schoolA._id });
      await Staff.findByIdAndUpdate(adminA._id, { username: `e2e_admin_a_${Date.now()}` });

      // Teacher belongs to school B
      const teacherB = await createStaffUser({
        schoolId: schoolB._id,
        name: 'Teacher in B',
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
      });
      await Staff.findByIdAndUpdate(teacherB._id, { username: `e2e_teacher_b_${Date.now()}` });

      const { app } = createTestApp();
      const authHeadersA = authHeadersFor(adminA, 'admin');

      // Create a class in school A
      const classRes = await request(app)
        .post('/api/classes')
        .set(authHeadersA)
        .send({ name: 'Class 6', section: 'A', subjects: ['Math'], academicYear: '2025-26' })
        .expect(201);

      // Admin A tries to assign school B teacher — should be rejected (teacher not found in school A scope)
      await request(app)
        .put(`/api/classes/${classRes.body.id}/class-teacher`)
        .set(authHeadersA)
        .send({ classTeacherId: teacherB._id.toString() })
        .expect(404);
    });
  });

  // ─── Step 3: Timetable generation ─────────────────────────────────────────

  describe('Step 3 — POST /api/timetable/generate-all: Generate timetables', () => {
    it('full flow: staff → class teacher assignment → timetable generation with TeacherTimetable sync', async () => {
      const { school, admin } = await setupSchoolWithAdmin('Full E2E School');
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      // 1. Create teacher via API
      const staffRes = await request(app)
        .post('/api/staff')
        .set(authHeaders)
        .send({ name: 'Mr. Timetable Teacher', role: ['Teacher'] })
        .expect(201);
      const teacherId = staffRes.body.id;

      // 2. Create class with subjects via API
      const classRes = await request(app)
        .post('/api/classes')
        .set(authHeaders)
        .send({
          name: 'Class 10',
          section: 'A',
          subjects: ['Math', 'Science', 'English'],
          academicYear: '2025-26',
        })
        .expect(201);
      const classId = classRes.body.id;

      // 3. Assign teacher as class teacher via API
      const assignRes = await request(app)
        .put(`/api/classes/${classId}/class-teacher`)
        .set(authHeaders)
        .send({ classTeacherId: teacherId })
        .expect(200);

      expect(assignRes.body.teacherName).toBe('Mr. Timetable Teacher');

      // 4. Set teacherAssignments so the generator can schedule the teacher
      await Staff.findByIdAndUpdate(teacherId, {
        teacherAssignments: [{ subject: 'Math', classes: [classId] }],
      });

      // 5. Generate timetables for all classes
      const genRes = await request(app)
        .post('/api/timetable/generate-all')
        .set(authHeaders)
        .send({ academicYear: '2025-26' })
        .expect(200);

      expect(genRes.body.success).toBe(true);
      expect(genRes.body.generated).toBe(1);

      // 6. Verify class Timetable was created with correct schoolId
      const timetables = await Timetable.find({ schoolId: school._id }).lean();
      expect(timetables).toHaveLength(1);
      expect(timetables[0].classId.toString()).toBe(classId);
      expect(timetables[0].schoolId.toString()).toBe(school._id.toString());
      expect(timetables[0].academicYear).toBe('2025-26');

      // 7. Verify TeacherTimetable was synced for the teacher
      const teacherTimetable = await TeacherTimetable.findOne({
        teacherId,
        schoolId: school._id,
      }).lean();
      expect(teacherTimetable).toBeTruthy();
      expect(teacherTimetable.schoolId.toString()).toBe(school._id.toString());
      expect(teacherTimetable.totalPeriodsPerWeek).toBeGreaterThan(0);
    });

    it('generates timetables for multiple classes and syncs teacher across all of them', async () => {
      const { school, admin } = await setupSchoolWithAdmin('Multi-Class E2E School');
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      // Create teacher
      const staffRes = await request(app)
        .post('/api/staff')
        .set(authHeaders)
        .send({ name: 'Ms. Multi-Class Teacher', role: ['Teacher'] })
        .expect(201);
      const teacherId = staffRes.body.id;

      // Create two classes
      const class1Res = await request(app)
        .post('/api/classes')
        .set(authHeaders)
        .send({
          name: 'Class 11',
          section: 'A',
          subjects: ['Math', 'Science'],
          academicYear: '2025-26',
        })
        .expect(201);

      const class2Res = await request(app)
        .post('/api/classes')
        .set(authHeaders)
        .send({
          name: 'Class 11',
          section: 'B',
          subjects: ['Math', 'English'],
          academicYear: '2025-26',
        })
        .expect(201);

      // Assign teacher to Math in both classes via teacherAssignments
      await Staff.findByIdAndUpdate(teacherId, {
        teacherAssignments: [{ subject: 'Math', classes: [class1Res.body.id, class2Res.body.id] }],
      });

      // Generate timetables
      const genRes = await request(app)
        .post('/api/timetable/generate-all')
        .set(authHeaders)
        .send({ academicYear: '2025-26' })
        .expect(200);

      expect(genRes.body.success).toBe(true);
      expect(genRes.body.generated).toBe(2);

      // Both timetables belong to this school
      const timetables = await Timetable.find({ schoolId: school._id }).lean();
      expect(timetables).toHaveLength(2);
      timetables.forEach((tt) => {
        expect(tt.schoolId.toString()).toBe(school._id.toString());
      });

      // TeacherTimetable was created for the teacher
      const teacherTimetable = await TeacherTimetable.findOne({
        teacherId,
        schoolId: school._id,
        academicYear: '2025-26',
      }).lean();
      expect(teacherTimetable).toBeTruthy();
      expect(teacherTimetable.totalPeriodsPerWeek).toBeGreaterThan(0);
    });

    it('timetable generation is scoped to the school — School A does not generate School B timetables', async () => {
      const schoolA = await createSchoolRecord({ name: 'Isolated School A' });
      const schoolB = await createSchoolRecord({ name: 'Isolated School B' });

      const adminA = await createStaffUser({ schoolId: schoolA._id });
      await Staff.findByIdAndUpdate(adminA._id, { username: `iso_admin_a_${Date.now()}` });

      // Create a class with subjects in school A only
      const { app } = createTestApp();
      const authHeadersA = authHeadersFor(adminA, 'admin');

      await request(app)
        .post('/api/classes')
        .set(authHeadersA)
        .send({
          name: 'Class 5',
          section: 'A',
          subjects: ['Math', 'Science'],
          academicYear: '2025-26',
        })
        .expect(201);

      // Also create a class in school B (via direct DB insert — simulates pre-existing data)
      await Class.create({
        schoolId: schoolB._id,
        name: 'Class 5',
        section: 'A',
        subjects: ['Math', 'Science'],
        academicYear: '2025-26',
      });

      // Generate for school A only
      const genRes = await request(app)
        .post('/api/timetable/generate-all')
        .set(authHeadersA)
        .send({ academicYear: '2025-26' })
        .expect(200);

      expect(genRes.body.generated).toBe(1);

      // Only school A timetable was created
      const schoolATimetables = await Timetable.find({ schoolId: schoolA._id }).lean();
      const schoolBTimetables = await Timetable.find({ schoolId: schoolB._id }).lean();

      expect(schoolATimetables).toHaveLength(1);
      expect(schoolBTimetables).toHaveLength(0);
    });

    it('returns 0 generated when the class has no subjects (skips gracefully)', async () => {
      const { admin } = await setupSchoolWithAdmin('No Subject School');
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      await request(app)
        .post('/api/classes')
        .set(authHeaders)
        .send({ name: 'Empty Class', section: 'A', subjects: [], academicYear: '2025-26' })
        .expect(201);

      const genRes = await request(app)
        .post('/api/timetable/generate-all')
        .set(authHeaders)
        .send({})
        .expect(200);

      expect(genRes.body.generated).toBe(0);
      expect(genRes.body.errors.length).toBeGreaterThan(0);
    });
  });
});
