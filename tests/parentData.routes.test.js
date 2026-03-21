import request from 'supertest';
import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { Exam, FeeStructure, Result, Student } from '../database.js';
import Remark from '../models/Remark.js';
import Parent from '../models/Parent.js';
import { generateToken } from '../middleware/auth.js';
import {
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
  authHeadersFor,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';
import { createParentTestApp } from './helpers/parentTestApp.js';

function parentAuthHeaders(parent) {
  return {
    Authorization: `Bearer ${generateToken(parent._id.toString(), 'parent', {
      userType: 'parent',
    })}`,
  };
}

describe('Parent data routes — results endpoint', () => {
  it('returns only published results for a student', async () => {
    const school = await createSchoolRecord({ name: 'Results School' });
    const admin = await createStaffUser({ schoolId: school._id });
    const classRecord = await createClassRecord({ schoolId: school._id });
    const student = await createStudentRecord({
      name: 'Result Student',
      classId: classRecord._id,
      schoolId: school._id,
    });

    const parent = await Parent.create({
      phone: '9100000001',
      name: 'Result Parent',
      schoolId: school._id,
      status: 'active',
      children: [{ studentId: student._id, relationship: 'father', isPrimary: true }],
    });

    const exam = await Exam.create({
      schoolId: school._id,
      name: 'Midterm Exam',
      examType: 'midterm',
      classId: classRecord._id,
      academicYear: '2025-26',
      maxMarks: 100,
      status: 'results_published',
      isPublished: true,
    });

    // Published result — should appear
    await Result.create({
      schoolId: school._id,
      examId: exam._id,
      studentId: student._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      marksObtained: 85,
      maxMarks: 100,
      percentage: 85,
      grade: 'A',
      status: 'passed',
      isPublished: true,
    });

    // Unpublished result — must NOT appear
    const unpublishedExam = await Exam.create({
      schoolId: school._id,
      name: 'Draft Quiz',
      examType: 'quiz',
      classId: classRecord._id,
      academicYear: '2025-26',
      maxMarks: 50,
      status: 'completed',
      isPublished: false,
    });

    await Result.create({
      schoolId: school._id,
      examId: unpublishedExam._id,
      studentId: student._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      marksObtained: 30,
      maxMarks: 50,
      percentage: 60,
      grade: 'B',
      status: 'passed',
      isPublished: false,
    });

    const { app } = createParentTestApp();

    const response = await request(app)
      .get(`/api/parent/students/${student._id}/results`)
      .set(parentAuthHeaders(parent))
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.results).toHaveLength(1);

    const result = response.body.data.results[0];
    expect(result.marksObtained).toBe(85);
    expect(result.maxMarks).toBe(100);
    expect(result.percentage).toBe(85);
    expect(result.grade).toBe('A');
    expect(result.isPublished).toBe(true);
  });

  it('returns empty array when no published results exist', async () => {
    const school = await createSchoolRecord({ name: 'No Results School' });
    const classRecord = await createClassRecord({ schoolId: school._id });
    const student = await createStudentRecord({
      name: 'No Result Student',
      classId: classRecord._id,
      schoolId: school._id,
    });

    const parent = await Parent.create({
      phone: '9100000002',
      name: 'Empty Result Parent',
      schoolId: school._id,
      status: 'active',
      children: [{ studentId: student._id, relationship: 'mother', isPrimary: true }],
    });

    const exam = await Exam.create({
      schoolId: school._id,
      name: 'Hidden Exam',
      classId: classRecord._id,
      academicYear: '2025-26',
      maxMarks: 100,
      status: 'completed',
    });

    await Result.create({
      schoolId: school._id,
      examId: exam._id,
      studentId: student._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      marksObtained: 40,
      maxMarks: 100,
      isPublished: false,
    });

    const { app } = createParentTestApp();

    const response = await request(app)
      .get(`/api/parent/students/${student._id}/results`)
      .set(parentAuthHeaders(parent))
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.results).toHaveLength(0);
  });

  it('returns 401 without authentication', async () => {
    const classRecord = await createClassRecord();
    const student = await createStudentRecord({ classId: classRecord._id });
    const { app } = createParentTestApp();

    await request(app).get(`/api/parent/students/${student._id}/results`).expect(401);
  });
});

describe('Parent data routes — remarks endpoint', () => {
  it('returns only remarks with sentToParent: true', async () => {
    const school = await createSchoolRecord({ name: 'Remarks School' });
    const admin = await createStaffUser({ schoolId: school._id });
    const classRecord = await createClassRecord({ schoolId: school._id });
    const student = await createStudentRecord({
      name: 'Remark Student',
      classId: classRecord._id,
      schoolId: school._id,
    });

    const parent = await Parent.create({
      phone: '9100000003',
      name: 'Remark Parent',
      schoolId: school._id,
      status: 'active',
      children: [{ studentId: student._id, relationship: 'father', isPrimary: true }],
    });

    // Remark sent to parent — should appear
    await Remark.create({
      schoolId: school._id,
      studentId: student._id,
      title: 'Good Progress',
      description: 'Student is doing well in math.',
      category: 'academic',
      authorId: admin._id,
      authorName: admin.name,
      sentToParent: true,
      sentDate: new Date(),
    });

    // Remark NOT sent to parent — must NOT appear
    await Remark.create({
      schoolId: school._id,
      studentId: student._id,
      title: 'Internal Note',
      description: 'Needs extra attention in class.',
      category: 'behavioral',
      authorId: admin._id,
      authorName: admin.name,
      sentToParent: false,
    });

    const { app } = createParentTestApp();

    const response = await request(app)
      .get(`/api/parent/students/${student._id}/remarks`)
      .set(parentAuthHeaders(parent))
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.remarks).toHaveLength(1);

    const remark = response.body.data.remarks[0];
    expect(remark.title).toBe('Good Progress');
    expect(remark.description).toBe('Student is doing well in math.');
    expect(remark.category).toBe('academic');
    expect(remark.authorName).toBe(admin.name);
    expect(remark.sentToParent).toBe(true);
  });

  it('returns empty array when no remarks are sent to parent', async () => {
    const school = await createSchoolRecord({ name: 'No Remarks School' });
    const admin = await createStaffUser({ schoolId: school._id });
    const classRecord = await createClassRecord({ schoolId: school._id });
    const student = await createStudentRecord({
      name: 'Private Remark Student',
      classId: classRecord._id,
      schoolId: school._id,
    });

    const parent = await Parent.create({
      phone: '9100000004',
      name: 'No Remark Parent',
      schoolId: school._id,
      status: 'active',
      children: [{ studentId: student._id, relationship: 'mother', isPrimary: true }],
    });

    await Remark.create({
      schoolId: school._id,
      studentId: student._id,
      title: 'Staff Only Note',
      description: 'For internal records.',
      category: 'general',
      authorId: admin._id,
      authorName: admin.name,
      sentToParent: false,
    });

    const { app } = createParentTestApp();

    const response = await request(app)
      .get(`/api/parent/students/${student._id}/remarks`)
      .set(parentAuthHeaders(parent))
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.remarks).toHaveLength(0);
  });

  it('returns 403 when parent tries to access a student that is not their child', async () => {
    const school = await createSchoolRecord({ name: 'Access Denied School' });
    const classRecord = await createClassRecord({ schoolId: school._id });
    const ownChild = await createStudentRecord({
      name: 'Own Child',
      classId: classRecord._id,
      schoolId: school._id,
    });
    const otherChild = await createStudentRecord({
      name: 'Other Child',
      admissionId: 'ADM-OTHER-001',
      classId: classRecord._id,
      schoolId: school._id,
      rollNo: 2,
    });

    const parent = await Parent.create({
      phone: '9100000005',
      name: 'Limited Parent',
      schoolId: school._id,
      status: 'active',
      children: [{ studentId: ownChild._id, relationship: 'father', isPrimary: true }],
    });

    const { app } = createParentTestApp();

    await request(app)
      .get(`/api/parent/students/${otherChild._id}/remarks`)
      .set(parentAuthHeaders(parent))
      .expect(403);
  });
});

describe('Student results via staff API — schoolId scoping', () => {
  it('returns published results scoped by schoolId from auth token', async () => {
    const schoolA = await createSchoolRecord({ name: 'School A Results' });
    const schoolB = await createSchoolRecord({ name: 'School B Results' });
    const adminA = await createStaffUser({ schoolId: schoolA._id });
    const adminB = await createStaffUser({ schoolId: schoolB._id });
    const classRecord = await createClassRecord({ schoolId: schoolA._id });

    const student = await createStudentRecord({
      name: 'Scoped Result Student',
      classId: classRecord._id,
      schoolId: schoolA._id,
    });

    const exam = await Exam.create({
      schoolId: schoolA._id,
      name: 'School A Exam',
      classId: classRecord._id,
      academicYear: '2025-26',
      maxMarks: 100,
      status: 'results_published',
    });

    await Result.create({
      schoolId: schoolA._id,
      examId: exam._id,
      studentId: student._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      marksObtained: 90,
      maxMarks: 100,
      percentage: 90,
      grade: 'A+',
      isPublished: true,
    });

    const { app } = createTestApp();

    // School A admin sees the results
    const responseA = await request(app)
      .get(`/api/students/${student._id}/results`)
      .set(authHeadersFor(adminA, 'admin'))
      .expect(200);

    expect(responseA.body).toHaveLength(1);
    expect(responseA.body[0].marksObtained).toBe(90);

    // School B admin should not see them (student belongs to School A)
    const responseB = await request(app)
      .get(`/api/students/${student._id}/results`)
      .set(authHeadersFor(adminB, 'admin'))
      .expect(404);
  });

  it('returns 401 without authentication', async () => {
    const classRecord = await createClassRecord();
    const student = await createStudentRecord({ classId: classRecord._id });
    const { app } = createTestApp();

    await request(app).get(`/api/students/${student._id}/results`).expect(401);
  });
});

describe('Fee structure — schoolId scoping', () => {
  it('scopes fee structure by schoolId so School B cannot see School A data', async () => {
    const schoolA = await createSchoolRecord({ name: 'Fee School A' });
    const schoolB = await createSchoolRecord({ name: 'Fee School B' });
    const adminA = await createStaffUser({ schoolId: schoolA._id });
    const adminB = await createStaffUser({ schoolId: schoolB._id });
    const classRecord = await createClassRecord({ schoolId: schoolA._id });

    await FeeStructure.create({
      schoolId: schoolA._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      totalAnnualFee: 50000,
      feeHeads: [{ name: 'Tuition', amount: 50000 }],
    });

    const { app } = createTestApp();

    // School A admin sees the fee structure
    const responseA = await request(app)
      .get(`/api/fee-structure/class/${classRecord._id}`)
      .set(authHeadersFor(adminA, 'admin'))
      .expect(200);

    expect(responseA.body.totalAnnualFee).toBe(50000);

    // School B admin gets 404 (scoped out)
    await request(app)
      .get(`/api/fee-structure/class/${classRecord._id}`)
      .set(authHeadersFor(adminB, 'admin'))
      .expect(404);
  });

  it('returns 401 without authentication', async () => {
    const classRecord = await createClassRecord();
    const { app } = createTestApp();

    await request(app).get(`/api/fee-structure/class/${classRecord._id}`).expect(401);
  });
});
