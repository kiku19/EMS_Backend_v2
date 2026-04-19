/**
 * E2E-02: Student registration → class assignment → fee structure auto-assigned
 *
 * Tests the full flow:
 *   1. Create a class via POST /api/classes
 *   2. Register a student via POST /api/students (with classId) — auto-initializes fee structure
 *   3. Verify StudentFeeStructure is auto-created with correct schoolId/studentId/classId
 *   4. Explicitly initialize fees via POST /api/student-fees/initialize/:studentId
 *      — verifies fee heads are assigned from FeeHead collection (schoolId-scoped)
 *   5. Reassign student to a different class via PUT /api/students/:id
 *      — verifies old fee structure is cleared and a new one is auto-created
 *   6. Multi-tenancy: StudentFeeStructure is scoped — School A student cannot share data with School B
 */

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Staff, Student } from '../database.js';
import FeeHead from '../models/FeeHead.js';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import { createSchoolRecord, createStaffUser, authHeadersFor } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let adminSeq = 0;

async function setupSchool(schoolName = 'E2E-02 School') {
  adminSeq += 1;
  const school = await createSchoolRecord({ name: schoolName });
  const admin = await createStaffUser({ schoolId: school._id });
  await Staff.findByIdAndUpdate(admin._id, {
    username: `e2e02_admin_${adminSeq}_${Date.now()}`,
  });
  return { school, admin };
}

function studentPayload(classId, overrides = {}) {
  const seq = Date.now();
  return {
    name: 'Test Student',
    admissionId: `ADM-E2E02-${seq}`,
    academicYear: '2025-26',
    classId: classId.toString(),
    dateOfBirth: '2010-06-15',
    parents: [
      { name: 'Test Parent', relationship: 'father', phone: '9000000099', isWhatsapp: true },
    ],
    ...overrides,
  };
}

async function createFeeHeadsForClass(schoolId, classNumber) {
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

  const lab = await FeeHead.create({
    name: 'Lab Fee',
    category: 'Academic',
    headType: 'lab',
    amount: 1000,
    mandatory: true,
    frequency: 'yearly',
    applicableClasses: [classNumber],
    schoolId,
    isActive: true,
  });

  return { tuition, lab };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('E2E-02: Student registration → class assignment → fee structure auto-assigned', () => {
  // ─── Step 1: Student registration with class assignment ───────────────────

  describe('Step 1 — POST /api/students: Register a student with class assignment', () => {
    it('creates a student assigned to a class and returns id, admissionId, class label', async () => {
      const { school, admin } = await setupSchool('Registration School');
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const classRes = await request(app)
        .post('/api/classes')
        .set(authHeaders)
        .send({
          name: 'Class 10',
          section: 'A',
          subjects: ['Math', 'Science'],
          academicYear: '2025-26',
        })
        .expect(201);
      const classId = classRes.body.id;

      const studentRes = await request(app)
        .post('/api/students')
        .set(authHeaders)
        .send(studentPayload(classId, { rollNo: 1 }))
        .expect(201);

      expect(studentRes.body.id).toBeTruthy();
      expect(studentRes.body.name).toBe('Test Student');
      expect(studentRes.body.class).toBe('10-A');
      // Multi-tenancy: schoolId in response matches the school created above
      expect(studentRes.body.schoolId.toString()).toBe(school._id.toString());
    });

    it('persists the student with correct schoolId and classId in the database', async () => {
      const { school, admin } = await setupSchool('DB Persist School');
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const classRes = await request(app)
        .post('/api/classes')
        .set(authHeaders)
        .send({ name: 'Class 9', section: 'B', subjects: ['English'], academicYear: '2025-26' })
        .expect(201);

      const studentRes = await request(app)
        .post('/api/students')
        .set(authHeaders)
        .send(studentPayload(classRes.body.id))
        .expect(201);

      const dbDoc = await Student.findById(studentRes.body.id).lean();
      expect(dbDoc).toBeTruthy();
      expect(dbDoc.schoolId.toString()).toBe(school._id.toString());
      expect(dbDoc.classId.toString()).toBe(classRes.body.id);
      expect(dbDoc.name).toBe('Test Student');
    });

    it('rejects duplicate admissionId within the same school (409)', async () => {
      const { admin } = await setupSchool('Duplicate AdmId School');
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const classRes = await request(app)
        .post('/api/classes')
        .set(authHeaders)
        .send({ name: 'Class 8', section: 'A', subjects: ['Math'], academicYear: '2025-26' })
        .expect(201);

      const payload = studentPayload(classRes.body.id, { admissionId: 'ADM-DUPE-001', rollNo: 1 });

      await request(app).post('/api/students').set(authHeaders).send(payload).expect(201);

      await request(app)
        .post('/api/students')
        .set(authHeaders)
        .send({ ...payload, rollNo: 2 }) // different rollNo, same admissionId
        .expect(409);
    });

    it('rejects creation when classId does not exist (400)', async () => {
      const { admin } = await setupSchool('Bad Class School');
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const fakeClassId = '000000000000000000000001';
      const res = await request(app)
        .post('/api/students')
        .set(authHeaders)
        .send(studentPayload(fakeClassId))
        .expect(400);

      expect(res.body.error).toMatch(/class does not exist/i);
    });

    it('rejects creation when required fields are missing (400 from Zod)', async () => {
      const { admin } = await setupSchool('Validation School');
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      // Missing admissionId and parents
      const res = await request(app)
        .post('/api/students')
        .set(authHeaders)
        .send({
          name: 'Incomplete Student',
          academicYear: '2025-26',
          classId: '000000000000000000000001',
        })
        .expect(400);

      expect(res.body.details || res.body.error).toBeTruthy();
    });
  });

  // ─── Step 2: Fee structure auto-created on registration ──────────────────

  describe('Step 2 — Fee structure auto-initialized on student registration', () => {
    it('auto-creates a StudentFeeStructure document when a student is registered', async () => {
      const { school, admin } = await setupSchool('Auto Fee School');
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const classRes = await request(app)
        .post('/api/classes')
        .set(authHeaders)
        .send({ name: 'Class 10', section: 'A', subjects: ['Math'], academicYear: '2025-26' })
        .expect(201);

      const studentRes = await request(app)
        .post('/api/students')
        .set(authHeaders)
        .send(studentPayload(classRes.body.id))
        .expect(201);
      const studentId = studentRes.body.id;

      // Verify StudentFeeStructure was auto-created
      const feeStructure = await StudentFeeStructure.findOne({ studentId }).lean();
      expect(feeStructure).toBeTruthy();
      expect(feeStructure.studentId.toString()).toBe(studentId);
      expect(feeStructure.classId.toString()).toBe(classRes.body.id);
      expect(feeStructure.schoolId.toString()).toBe(school._id.toString());
      expect(feeStructure.academicYear).toBe('2025-26');
      expect(feeStructure.overallStatus).toBe('pending');
    });

    it('auto-created StudentFeeStructure is scoped to the correct school (multi-tenancy)', async () => {
      const schoolA = await createSchoolRecord({ name: 'E2E-02 School A' });
      const schoolB = await createSchoolRecord({ name: 'E2E-02 School B' });

      const adminA = await createStaffUser({ schoolId: schoolA._id });
      await Staff.findByIdAndUpdate(adminA._id, { username: `e2e02_a_${Date.now()}` });

      const adminB = await createStaffUser({ schoolId: schoolB._id });
      await Staff.findByIdAndUpdate(adminB._id, { username: `e2e02_b_${Date.now()}` });

      const { app } = createTestApp();
      const authHeadersA = authHeadersFor(adminA, 'admin');
      const authHeadersB = authHeadersFor(adminB, 'admin');

      const classARes = await request(app)
        .post('/api/classes')
        .set(authHeadersA)
        .send({ name: 'Class 10', section: 'A', subjects: ['Math'], academicYear: '2025-26' })
        .expect(201);

      const classBRes = await request(app)
        .post('/api/classes')
        .set(authHeadersB)
        .send({ name: 'Class 10', section: 'A', subjects: ['Math'], academicYear: '2025-26' })
        .expect(201);

      const studentARes = await request(app)
        .post('/api/students')
        .set(authHeadersA)
        .send(studentPayload(classARes.body.id, { admissionId: `ADM-A-${Date.now()}` }))
        .expect(201);

      const studentBRes = await request(app)
        .post('/api/students')
        .set(authHeadersB)
        .send(studentPayload(classBRes.body.id, { admissionId: `ADM-B-${Date.now()}` }))
        .expect(201);

      const feeA = await StudentFeeStructure.findOne({ studentId: studentARes.body.id }).lean();
      const feeB = await StudentFeeStructure.findOne({ studentId: studentBRes.body.id }).lean();

      expect(feeA.schoolId.toString()).toBe(schoolA._id.toString());
      expect(feeB.schoolId.toString()).toBe(schoolB._id.toString());
      // Cross-school isolation: School A's fee structure does not appear in School B's scope
      expect(feeA.schoolId.toString()).not.toBe(feeB.schoolId.toString());
    });
  });

  // ─── Step 3: Explicit fee initialization with fee heads ──────────────────

  describe('Step 3 — POST /api/student-fees/initialize/:studentId: Fee heads assigned', () => {
    it('assigns applicable fee heads when explicitly initializing a student with no existing structure', async () => {
      const { school, admin } = await setupSchool('Explicit Fee Init School');
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      // Create class
      const classRes = await request(app)
        .post('/api/classes')
        .set(authHeaders)
        .send({
          name: 'Class 10',
          section: 'A',
          subjects: ['Math', 'Science'],
          academicYear: '2025-26',
        })
        .expect(201);
      const classId = classRes.body.id;

      // Create fee heads applicable to Class 10
      await createFeeHeadsForClass(school._id, '10');

      // Register student (auto-init creates a StudentFeeStructure — may have empty feeHeads)
      const studentRes = await request(app)
        .post('/api/students')
        .set(authHeaders)
        .send(studentPayload(classId))
        .expect(201);
      const studentId = studentRes.body.id;

      // Delete the auto-created structure so explicit init can create a fresh one with fee heads
      await StudentFeeStructure.deleteMany({ studentId });

      // Explicitly initialize fee structure
      const initRes = await request(app)
        .post(`/api/student-fees/initialize/${studentId}`)
        .set(authHeaders)
        .send({ academicYear: '2025-26' })
        .expect(201);

      expect(initRes.body.feeStructure || initRes.body).toBeTruthy();

      // Verify fee heads were assigned from the FeeHead collection
      const feeStructure = await StudentFeeStructure.findOne({ studentId }).lean();
      expect(feeStructure).toBeTruthy();
      expect(feeStructure.feeHeads).toHaveLength(2);
      expect(feeStructure.totalFee).toBe(6000); // 5000 + 1000
      expect(feeStructure.totalBalance).toBe(6000);
      expect(feeStructure.totalPaid).toBe(0);
      expect(feeStructure.overallStatus).toBe('pending');
      expect(feeStructure.schoolId.toString()).toBe(school._id.toString());
    });

    it('returns 200 and existing structure when fee structure already exists (idempotent)', async () => {
      const { admin } = await setupSchool('Idempotent Init School');
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const classRes = await request(app)
        .post('/api/classes')
        .set(authHeaders)
        .send({ name: 'Class 8', section: 'A', subjects: ['Math'], academicYear: '2025-26' })
        .expect(201);

      const studentRes = await request(app)
        .post('/api/students')
        .set(authHeaders)
        .send(studentPayload(classRes.body.id))
        .expect(201);

      // First explicit call
      await request(app)
        .post(`/api/student-fees/initialize/${studentRes.body.id}`)
        .set(authHeaders)
        .send({ academicYear: '2025-26' });

      // Second explicit call — should be idempotent (returns existing)
      const secondRes = await request(app)
        .post(`/api/student-fees/initialize/${studentRes.body.id}`)
        .set(authHeaders)
        .send({ academicYear: '2025-26' })
        .expect(200);

      expect(secondRes.body.message).toMatch(/already exists/i);

      // Only one StudentFeeStructure exists for this student+year
      const count = await StudentFeeStructure.countDocuments({
        studentId: studentRes.body.id,
        academicYear: '2025-26',
      });
      expect(count).toBe(1);
    });

    it('only assigns fee heads scoped to the student school (cross-school isolation)', async () => {
      const schoolA = await createSchoolRecord({ name: 'Fee Isolation A' });
      const schoolB = await createSchoolRecord({ name: 'Fee Isolation B' });

      const adminA = await createStaffUser({ schoolId: schoolA._id });
      await Staff.findByIdAndUpdate(adminA._id, { username: `fi_a_${Date.now()}` });

      const { app } = createTestApp();
      const authHeadersA = authHeadersFor(adminA, 'admin');

      // Create fee heads in School A only
      await FeeHead.create({
        name: 'School A Tuition',
        category: 'Academic',
        headType: 'tuition',
        amount: 3000,
        mandatory: true,
        frequency: 'yearly',
        applicableClasses: ['10'],
        schoolId: schoolA._id,
        isActive: true,
      });

      // Also create a fee head in School B (should NOT be included for School A students)
      await FeeHead.create({
        name: 'School B Tuition',
        category: 'Academic',
        headType: 'tuition',
        amount: 9999,
        mandatory: true,
        frequency: 'yearly',
        applicableClasses: ['10'],
        schoolId: schoolB._id,
        isActive: true,
      });

      const classRes = await request(app)
        .post('/api/classes')
        .set(authHeadersA)
        .send({ name: 'Class 10', section: 'A', subjects: ['Math'], academicYear: '2025-26' })
        .expect(201);

      const studentRes = await request(app)
        .post('/api/students')
        .set(authHeadersA)
        .send(studentPayload(classRes.body.id, { admissionId: `ADM-FI-${Date.now()}` }))
        .expect(201);

      // Delete auto-created structure to allow fresh explicit init
      await StudentFeeStructure.deleteMany({ studentId: studentRes.body.id });

      await request(app)
        .post(`/api/student-fees/initialize/${studentRes.body.id}`)
        .set(authHeadersA)
        .send({ academicYear: '2025-26' })
        .expect(201);

      const feeStructure = await StudentFeeStructure.findOne({
        studentId: studentRes.body.id,
      }).lean();
      // Only School A's fee head should be included
      expect(feeStructure.feeHeads).toHaveLength(1);
      expect(feeStructure.totalFee).toBe(3000);
    });
  });

  // ─── Step 4: Class reassignment triggers fee structure re-initialization ──

  describe('Step 4 — PUT /api/students/:id: Class reassignment clears and re-creates fee structure', () => {
    it('clears existing fee structure when student is moved to a different class', async () => {
      const { school, admin } = await setupSchool('Class Reassign School');
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      // Create two classes
      const class1Res = await request(app)
        .post('/api/classes')
        .set(authHeaders)
        .send({ name: 'Class 8', section: 'A', subjects: ['Math'], academicYear: '2025-26' })
        .expect(201);

      const class2Res = await request(app)
        .post('/api/classes')
        .set(authHeaders)
        .send({
          name: 'Class 9',
          section: 'A',
          subjects: ['Math', 'Science'],
          academicYear: '2025-26',
        })
        .expect(201);

      // Create fee heads for Class 9
      await FeeHead.create({
        name: 'Class 9 Tuition',
        category: 'Academic',
        headType: 'tuition',
        amount: 7000,
        mandatory: true,
        frequency: 'yearly',
        applicableClasses: ['9'],
        schoolId: school._id,
        isActive: true,
      });

      // Register student in Class 8
      const studentRes = await request(app)
        .post('/api/students')
        .set(authHeaders)
        .send(studentPayload(class1Res.body.id))
        .expect(201);
      const studentId = studentRes.body.id;

      // Verify fee structure was created for Class 8
      const oldStructure = await StudentFeeStructure.findOne({ studentId }).lean();
      expect(oldStructure).toBeTruthy();
      expect(oldStructure.classId.toString()).toBe(class1Res.body.id);

      // Move student to Class 9
      const updateRes = await request(app)
        .put(`/api/students/${studentId}`)
        .set(authHeaders)
        .send({ classId: class2Res.body.id })
        .expect(200);

      expect(updateRes.body.class).toBe('9-A');

      // The existing StudentFeeStructure row is UPDATED in place (classId +
      // merged fee heads) rather than deleted and re-created, so the original
      // _id survives the class change. This preserves FeePayment.feeHeads
      // references across class moves.
      const updatedStructure = await StudentFeeStructure.findById(oldStructure._id).lean();
      expect(updatedStructure).toBeTruthy();
      expect(updatedStructure.classId.toString()).toBe(class2Res.body.id);
      expect(updatedStructure.schoolId.toString()).toBe(school._id.toString());

      // Only one structure row exists per student+year.
      const structuresForStudent = await StudentFeeStructure.countDocuments({ studentId });
      expect(structuresForStudent).toBe(1);
    });

    it('preserves fee structure when class is not changed on update', async () => {
      const { admin } = await setupSchool('No Class Change School');
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const classRes = await request(app)
        .post('/api/classes')
        .set(authHeaders)
        .send({ name: 'Class 7', section: 'A', subjects: ['Math'], academicYear: '2025-26' })
        .expect(201);

      const studentRes = await request(app)
        .post('/api/students')
        .set(authHeaders)
        .send(studentPayload(classRes.body.id))
        .expect(201);
      const studentId = studentRes.body.id;

      const structureBefore = await StudentFeeStructure.findOne({ studentId }).lean();
      expect(structureBefore).toBeTruthy();

      // Update student name only (no class change)
      await request(app)
        .put(`/api/students/${studentId}`)
        .set(authHeaders)
        .send({ name: 'Updated Student Name' })
        .expect(200);

      // Fee structure should remain unchanged
      const structureAfter = await StudentFeeStructure.findOne({ studentId }).lean();
      expect(structureAfter).toBeTruthy();
      expect(structureAfter._id.toString()).toBe(structureBefore._id.toString());
    });
  });
});
