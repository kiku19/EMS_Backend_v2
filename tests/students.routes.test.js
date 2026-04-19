import request from 'supertest';
import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { Attendance, Student } from '../database.js';
import ClassAnnouncement from '../models/ClassAnnouncement.js';
import Homework from '../models/Homework.js';
import Parent from '../models/Parent.js';
import Remark from '../models/Remark.js';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import { piiMatch } from '../utils/encryption.js';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';
import {
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
  authHeadersFor,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const defaultParent = [
  {
    name: 'Test Parent',
    relationship: 'father',
    phone: '9000000001',
    isWhatsapp: true,
  },
];

describe('students routes', () => {
  it('supports create, read, update, and permanent deletion for a student', async () => {
    const admin = await createStaffUser();
    const classRecord = await createClassRecord();
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(admin, 'admin');

    const createResponse = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send({
        name: 'Jane Student',
        admissionId: 'ADM9001',
        academicYear: CURRENT_ACADEMIC_YEAR,
        rollNo: 7,
        classId: classRecord._id.toString(),
        dateOfBirth: '2010-05-15',
        parentName: 'Mary Parent',
        parentPhone: '9876543210',
        parents: [
          {
            name: 'Mary Parent',
            relationship: 'mother',
            phone: '9876543210',
            isWhatsapp: true,
          },
        ],
      })
      .expect(201);

    const studentId = createResponse.body.id;

    expect(createResponse.body).toMatchObject({
      name: 'Jane Student',
      admissionId: 'ADM9001',
      class: '10-A',
      status: 'active',
    });

    const parent = await Parent.findOne(piiMatch('phone', '9876543210')).lean();
    expect(parent).toBeTruthy();
    expect(parent.children[0].studentId.toString()).toBe(studentId);

    const getResponse = await request(app)
      .get(`/api/students/${studentId}`)
      .set(authHeaders)
      .expect(200);

    expect(getResponse.body).toMatchObject({
      id: studentId,
      class: '10-A',
      className: 'Class 10 A',
    });

    const updateResponse = await request(app)
      .put(`/api/students/${studentId}`)
      .set(authHeaders)
      .send({
        parentName: 'Updated Parent',
        status: 'inactive',
      })
      .expect(200);

    expect(updateResponse.body).toMatchObject({
      id: studentId,
      parentName: 'Updated Parent',
      status: 'inactive',
    });

    await Attendance.create({
      studentId,
      classId: classRecord._id,
      schoolId: admin.schoolId,
      date: '2025-01-20',
      status: 'present',
    });

    await StudentFeeStructure.findOneAndUpdate(
      { studentId, academicYear: CURRENT_ACADEMIC_YEAR },
      {
        studentId,
        classId: classRecord._id,
        academicYear: CURRENT_ACADEMIC_YEAR,
        feeHeads: [],
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await Remark.create({
      schoolId: admin.schoolId,
      studentId,
      title: 'Medical note',
      description: 'Asthma inhaler kept at the front desk.',
      category: 'health',
      authorId: admin._id,
      authorName: admin.name,
    });

    await Homework.create({
      title: 'Math worksheet',
      description: 'Complete the worksheet',
      subject: 'Math',
      classId: classRecord._id,
      schoolId: admin.schoolId,
      teacherId: admin._id,
      dueDate: new Date('2025-01-25T00:00:00.000Z'),
      submissions: [
        {
          studentId,
          remarks: 'Submitted',
        },
      ],
    });

    await ClassAnnouncement.create({
      classId: classRecord._id,
      schoolId: admin.schoolId,
      title: 'Exam reminder',
      description: 'Bring geometry tools.',
      sentBy: admin._id,
      recipients: [
        {
          studentId,
        },
      ],
    });

    const deleteResponse = await request(app)
      .delete(`/api/students/${studentId}`)
      .set(authHeaders)
      .expect(200);

    expect(deleteResponse.body.success).toBe(true);
    expect(deleteResponse.body.deletedStudentId).toBeDefined();
    expect(deleteResponse.body.trashItemId).toBeDefined();

    const deletedStudent = await Student.findById(studentId).lean();
    const attendanceCount = await Attendance.countDocuments({ studentId });

    // Soft-delete: document remains with isDeleted=true so trash-restore is
    // lossless. Attendance is hard-deleted (no isDeleted field on that schema).
    expect(deletedStudent).not.toBeNull();
    expect(deletedStudent.isDeleted).toBe(true);
    expect(attendanceCount).toBe(0);

    await request(app).get(`/api/students/${studentId}`).set(authHeaders).expect(404);
  });

  it('syncs parent accounts when parent contact info changes on update', async () => {
    const admin = await createStaffUser();
    const classRecord = await createClassRecord();
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(admin, 'admin');

    const createResponse = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send({
        name: 'John Student',
        admissionId: 'ADM9002',
        academicYear: CURRENT_ACADEMIC_YEAR,
        rollNo: 8,
        classId: classRecord._id.toString(),
        dateOfBirth: '2011-07-22',
        parentName: 'Old Parent',
        parentPhone: '9876543211',
        parents: [
          {
            name: 'Old Parent',
            relationship: 'father',
            phone: '9876543211',
            isWhatsapp: true,
          },
        ],
      })
      .expect(201);

    const studentId = createResponse.body.id;

    await request(app)
      .put(`/api/students/${studentId}`)
      .set(authHeaders)
      .send({
        parentName: 'New Parent',
        parentPhone: '9876543222',
        parentEmail: 'new.parent@example.com',
        parents: [
          {
            name: 'New Parent',
            relationship: 'mother',
            phone: '9876543222',
            email: 'new.parent@example.com',
            isWhatsapp: true,
          },
        ],
      })
      .expect(200);

    const oldParent = await Parent.findOne(piiMatch('phone', '9876543211')).lean();
    const newParent = await Parent.findOne(piiMatch('phone', '9876543222')).lean();

    expect(oldParent?.children.some((child) => child.studentId.toString() === studentId)).toBe(
      false
    );
    expect(newParent).toBeTruthy();
    expect(newParent.name).toBe('New Parent');
    expect(newParent.email).toBe('new.parent@example.com');
    expect(newParent.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relationship: 'mother',
        }),
      ])
    );
    expect(newParent.children[0].studentId.toString()).toBe(studentId);
  });

  describe('POST /api/students — Create student', () => {
    it('returns 409 when admissionId already exists in the same school', async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      await request(app)
        .post('/api/students')
        .set(authHeaders)
        .send({
          name: 'First Student',
          admissionId: 'ADM-DUP-001',
          academicYear: CURRENT_ACADEMIC_YEAR,
          rollNo: 1,
          classId: classRecord._id.toString(),
          parents: defaultParent,
        })
        .expect(201);

      const response = await request(app)
        .post('/api/students')
        .set(authHeaders)
        .send({
          name: 'Second Student',
          admissionId: 'ADM-DUP-001',
          academicYear: CURRENT_ACADEMIC_YEAR,
          rollNo: 2,
          classId: classRecord._id.toString(),
          parents: defaultParent,
        })
        .expect(409);

      expect(response.body).toMatchObject({
        error: expect.stringContaining('Admission ID'),
        field: 'admissionId',
      });
    });

    it('returns 409 when rollNo already exists in the same class and academic year', async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      await request(app)
        .post('/api/students')
        .set(authHeaders)
        .send({
          name: 'Roll Holder',
          admissionId: 'ADM-ROLL-001',
          academicYear: CURRENT_ACADEMIC_YEAR,
          rollNo: 10,
          classId: classRecord._id.toString(),
          parents: defaultParent,
        })
        .expect(201);

      const response = await request(app)
        .post('/api/students')
        .set(authHeaders)
        .send({
          name: 'Roll Conflict',
          admissionId: 'ADM-ROLL-002',
          academicYear: CURRENT_ACADEMIC_YEAR,
          rollNo: 10,
          classId: classRecord._id.toString(),
          parents: defaultParent,
        })
        .expect(409);

      expect(response.body).toMatchObject({
        error: expect.stringContaining('Roll number'),
        field: 'rollNo',
      });
    });

    it('returns 400 when name is missing', async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app)
        .post('/api/students')
        .set(authHeaders)
        .send({
          admissionId: 'ADM-NO-NAME',
          academicYear: CURRENT_ACADEMIC_YEAR,
          classId: classRecord._id.toString(),
          parents: defaultParent,
        })
        .expect(400);

      expect(response.body.error).toBeTruthy();
    });

    it('returns 400 when admissionId is missing', async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app)
        .post('/api/students')
        .set(authHeaders)
        .send({
          name: 'No Admission ID Student',
          academicYear: CURRENT_ACADEMIC_YEAR,
          classId: classRecord._id.toString(),
          parents: defaultParent,
        })
        .expect(400);

      expect(response.body.error).toBeTruthy();
    });

    it('returns 400 when classId is missing', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app)
        .post('/api/students')
        .set(authHeaders)
        .send({
          name: 'No Class Student',
          admissionId: 'ADM-NO-CLASS',
          academicYear: CURRENT_ACADEMIC_YEAR,
          parents: defaultParent,
        })
        .expect(400);

      expect(response.body.error).toBeTruthy();
    });

    it('returns 400 when classId does not exist in the database', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');
      const nonExistentClassId = new mongoose.Types.ObjectId().toString();

      const response = await request(app)
        .post('/api/students')
        .set(authHeaders)
        .send({
          name: 'Ghost Class Student',
          admissionId: 'ADM-GHOST-CLASS',
          academicYear: CURRENT_ACADEMIC_YEAR,
          classId: nonExistentClassId,
          parents: defaultParent,
        })
        .expect(400);

      expect(response.body).toMatchObject({
        error: expect.stringContaining('Class'),
        field: 'classId',
      });
    });

    it('returns 401 when request is unauthenticated', async () => {
      const classRecord = await createClassRecord();
      const { app } = createTestApp();

      await request(app)
        .post('/api/students')
        .send({
          name: 'Unauthorized Student',
          admissionId: 'ADM-UNAUTH',
          academicYear: CURRENT_ACADEMIC_YEAR,
          classId: classRecord._id.toString(),
          parents: defaultParent,
        })
        .expect(401);
    });

    it('created student has schoolId from the authenticated user', async () => {
      const school = await createSchoolRecord({ name: 'Greenwood Academy' });
      const admin = await createStaffUser({ schoolId: school._id });
      const classRecord = await createClassRecord({ schoolId: school._id });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app)
        .post('/api/students')
        .set(authHeaders)
        .send({
          name: 'School Scoped Student',
          admissionId: 'ADM-SCHOOL-001',
          academicYear: CURRENT_ACADEMIC_YEAR,
          rollNo: 1,
          classId: classRecord._id.toString(),
          parents: defaultParent,
        })
        .expect(201);

      const studentId = response.body.id;
      const savedStudent = await Student.findById(studentId).lean();

      expect(savedStudent.schoolId.toString()).toBe(school._id.toString());
    });
  });

  describe('GET /api/students — List students (paginated)', () => {
    it('returns a paginated list with default page 1 and limit 50', async () => {
      const school = await createSchoolRecord({ name: 'Paginated List School' });
      const admin = await createStaffUser({ schoolId: school._id });
      const classRecord = await createClassRecord();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      await Student.create({
        name: 'Alpha Student',
        admissionId: 'ADM-LIST-001',
        academicYear: CURRENT_ACADEMIC_YEAR,
        rollNo: 1,
        classId: classRecord._id,
        schoolId: school._id,
        parents: defaultParent,
      });

      await Student.create({
        name: 'Beta Student',
        admissionId: 'ADM-LIST-002',
        academicYear: CURRENT_ACADEMIC_YEAR,
        rollNo: 2,
        classId: classRecord._id,
        schoolId: school._id,
        parents: defaultParent,
      });

      const response = await request(app).get('/api/students').set(authHeaders).expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('pagination');
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThanOrEqual(2);
      expect(response.body.pagination).toMatchObject({
        currentPage: 1,
        itemsPerPage: 50,
      });
    });

    it('filters students by classId — only returns students in that class', async () => {
      const school = await createSchoolRecord({ name: 'Filter Class School' });
      const admin = await createStaffUser({ schoolId: school._id });
      const classA = await createClassRecord({ name: 'Class 9', section: 'A' });
      const classB = await createClassRecord({ name: 'Class 9', section: 'B' });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      await Student.create({
        name: 'Class A Student',
        admissionId: 'ADM-CLA-001',
        academicYear: CURRENT_ACADEMIC_YEAR,
        rollNo: 1,
        classId: classA._id,
        schoolId: school._id,
        parents: defaultParent,
      });

      await Student.create({
        name: 'Class B Student',
        admissionId: 'ADM-CLB-001',
        academicYear: CURRENT_ACADEMIC_YEAR,
        rollNo: 1,
        classId: classB._id,
        schoolId: school._id,
        parents: defaultParent,
      });

      const response = await request(app)
        .get(`/api/students?classId=${classA._id.toString()}`)
        .set(authHeaders)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe('Class A Student');
    });

    it('filters students by status — only returns matching students', async () => {
      const school = await createSchoolRecord({ name: 'Filter Status School' });
      const admin = await createStaffUser({ schoolId: school._id });
      const classRecord = await createClassRecord();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      await Student.create({
        name: 'Active Student',
        admissionId: 'ADM-ACT-001',
        academicYear: CURRENT_ACADEMIC_YEAR,
        rollNo: 1,
        classId: classRecord._id,
        schoolId: school._id,
        status: 'active',
        parents: defaultParent,
      });

      await Student.create({
        name: 'Inactive Student',
        admissionId: 'ADM-INA-001',
        academicYear: CURRENT_ACADEMIC_YEAR,
        rollNo: 2,
        classId: classRecord._id,
        schoolId: school._id,
        status: 'inactive',
        parents: defaultParent,
      });

      const activeResponse = await request(app)
        .get('/api/students?status=active')
        .set(authHeaders)
        .expect(200);

      const inactiveResponse = await request(app)
        .get('/api/students?status=inactive')
        .set(authHeaders)
        .expect(200);

      expect(activeResponse.body.data.every((s) => s.status === 'active')).toBe(true);
      expect(inactiveResponse.body.data.every((s) => s.status === 'inactive')).toBe(true);
    });

    it('searches students by name — returns matching students', async () => {
      const school = await createSchoolRecord({ name: 'Search Test School' });
      const admin = await createStaffUser({ schoolId: school._id });
      const classRecord = await createClassRecord();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      await Student.create({
        name: 'Priya Sharma',
        admissionId: 'ADM-SRCH-001',
        academicYear: CURRENT_ACADEMIC_YEAR,
        rollNo: 1,
        classId: classRecord._id,
        schoolId: school._id,
        parents: defaultParent,
      });

      await Student.create({
        name: 'Rahul Verma',
        admissionId: 'ADM-SRCH-002',
        academicYear: CURRENT_ACADEMIC_YEAR,
        rollNo: 2,
        classId: classRecord._id,
        schoolId: school._id,
        parents: defaultParent,
      });

      const response = await request(app)
        .get('/api/students?search=Priya')
        .set(authHeaders)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThanOrEqual(1);
      expect(response.body.data.every((s) => s.name.toLowerCase().includes('priya'))).toBe(true);
    });

    it('School A admin only sees School A students (multi-tenancy)', async () => {
      const schoolA = await createSchoolRecord({ name: 'School A' });
      const schoolB = await createSchoolRecord({ name: 'School B' });
      const adminA = await createStaffUser({ schoolId: schoolA._id });
      const classRecord = await createClassRecord();
      const { app } = createTestApp();
      const authHeadersA = authHeadersFor(adminA, 'admin');

      await Student.create({
        name: 'School A Student',
        admissionId: 'ADM-SA-001',
        academicYear: CURRENT_ACADEMIC_YEAR,
        rollNo: 1,
        classId: classRecord._id,
        schoolId: schoolA._id,
        parents: defaultParent,
      });

      await Student.create({
        name: 'School B Student',
        admissionId: 'ADM-SB-001',
        academicYear: CURRENT_ACADEMIC_YEAR,
        rollNo: 2,
        classId: classRecord._id,
        schoolId: schoolB._id,
        parents: defaultParent,
      });

      const response = await request(app).get('/api/students').set(authHeadersA).expect(200);

      const names = response.body.data.map((s) => s.name);
      expect(names).toContain('School A Student');
      expect(names).not.toContain('School B Student');
    });

    it('returns 401 when request is unauthenticated', async () => {
      const { app } = createTestApp();

      await request(app).get('/api/students').expect(401);
    });
  });

  describe('GET /api/students/:id — Get single student', () => {
    it('returns the correct student with class info', async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const createResponse = await request(app)
        .post('/api/students')
        .set(authHeaders)
        .send({
          name: 'Fetch Me Student',
          admissionId: 'ADM-FETCH-001',
          academicYear: CURRENT_ACADEMIC_YEAR,
          rollNo: 3,
          classId: classRecord._id.toString(),
          parents: defaultParent,
        })
        .expect(201);

      const studentId = createResponse.body.id;

      const response = await request(app)
        .get(`/api/students/${studentId}`)
        .set(authHeaders)
        .expect(200);

      expect(response.body).toMatchObject({
        id: studentId,
        name: 'Fetch Me Student',
        admissionId: 'ADM-FETCH-001',
        class: '10-A',
        className: 'Class 10 A',
      });
    });

    it('returns 404 for a non-existent student ID', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');
      const nonExistentId = new mongoose.Types.ObjectId().toString();

      await request(app).get(`/api/students/${nonExistentId}`).set(authHeaders).expect(404);
    });

    it('returns 404 when student belongs to a different school (multi-tenancy)', async () => {
      const schoolA = await createSchoolRecord({ name: 'School Alpha' });
      const schoolB = await createSchoolRecord({ name: 'School Beta' });
      const adminA = await createStaffUser({ schoolId: schoolA._id });
      const classRecord = await createClassRecord();
      const { app } = createTestApp();
      const authHeadersA = authHeadersFor(adminA, 'admin');

      const schoolBStudent = await Student.create({
        name: 'School B Only Student',
        admissionId: 'ADM-XSID-001',
        academicYear: CURRENT_ACADEMIC_YEAR,
        rollNo: 1,
        classId: classRecord._id,
        schoolId: schoolB._id,
        parents: defaultParent,
      });

      await request(app)
        .get(`/api/students/${schoolBStudent._id.toString()}`)
        .set(authHeadersA)
        .expect(404);
    });

    it('returns 401 when request is unauthenticated', async () => {
      const classRecord = await createClassRecord();
      const student = await createStudentRecord({ classId: classRecord._id });
      const { app } = createTestApp();

      await request(app).get(`/api/students/${student._id.toString()}`).expect(401);
    });
  });

  describe('PUT /api/students/:id — Update student', () => {
    it('updates allowed fields (parentName, status) and returns the updated student', async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const createResponse = await request(app)
        .post('/api/students')
        .set(authHeaders)
        .send({
          name: 'Update Target Student',
          admissionId: 'ADM-UPD-001',
          academicYear: CURRENT_ACADEMIC_YEAR,
          rollNo: 5,
          classId: classRecord._id.toString(),
          parentName: 'Original Parent',
          parents: defaultParent,
        })
        .expect(201);

      const studentId = createResponse.body.id;

      const updateResponse = await request(app)
        .put(`/api/students/${studentId}`)
        .set(authHeaders)
        .send({
          parentName: 'Updated Guardian',
          status: 'inactive',
          medicalConditions: 'None known',
        })
        .expect(200);

      expect(updateResponse.body).toMatchObject({
        id: studentId,
        parentName: 'Updated Guardian',
        status: 'inactive',
        medicalConditions: 'None known',
      });
    });

    it('returns 404 for a non-existent student ID', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');
      const nonExistentId = new mongoose.Types.ObjectId().toString();

      await request(app)
        .put(`/api/students/${nonExistentId}`)
        .set(authHeaders)
        .send({ parentName: 'Ghost Parent' })
        .expect(404);
    });

    it('returns 404 when student belongs to a different school (multi-tenancy)', async () => {
      const schoolA = await createSchoolRecord({ name: 'School One' });
      const schoolB = await createSchoolRecord({ name: 'School Two' });
      const adminA = await createStaffUser({ schoolId: schoolA._id });
      const classRecord = await createClassRecord();
      const { app } = createTestApp();
      const authHeadersA = authHeadersFor(adminA, 'admin');

      const schoolBStudent = await Student.create({
        name: 'School Two Student',
        admissionId: 'ADM-XUPD-001',
        academicYear: CURRENT_ACADEMIC_YEAR,
        rollNo: 1,
        classId: classRecord._id,
        schoolId: schoolB._id,
        parents: defaultParent,
      });

      await request(app)
        .put(`/api/students/${schoolBStudent._id.toString()}`)
        .set(authHeadersA)
        .send({ parentName: 'Intruder Parent' })
        .expect(404);
    });

    it('returns 401 when request is unauthenticated', async () => {
      const classRecord = await createClassRecord();
      const student = await createStudentRecord({ classId: classRecord._id });
      const { app } = createTestApp();

      await request(app)
        .put(`/api/students/${student._id.toString()}`)
        .send({ parentName: 'No Auth Parent' })
        .expect(401);
    });

    it('ignores client-supplied feeStatus on create — always seeds as pending', async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .post('/api/students')
        .set(authHeaders)
        .send({
          name: 'FeeStatus Client',
          admissionId: 'ADM-FS-001',
          academicYear: CURRENT_ACADEMIC_YEAR,
          rollNo: 30,
          classId: classRecord._id.toString(),
          parents: defaultParent,
          feeStatus: 'paid', // client tries to escalate
        })
        .expect(201);

      expect(res.body.feeStatus).toBe('pending');
      const dbStudent = await Student.findById(res.body.id).lean();
      expect(dbStudent.feeStatus).toBe('pending');
    });

    it('ignores client-supplied feeStatus on update', async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const createRes = await request(app)
        .post('/api/students')
        .set(authHeaders)
        .send({
          name: 'FeeStatus PUT Client',
          admissionId: 'ADM-FSU-001',
          academicYear: CURRENT_ACADEMIC_YEAR,
          rollNo: 31,
          classId: classRecord._id.toString(),
          parents: defaultParent,
        })
        .expect(201);

      // Anyone with students.edit could previously flip feeStatus to 'paid'
      // with no payment record — now it's stripped by the Zod schema.
      await request(app)
        .put(`/api/students/${createRes.body.id}`)
        .set(authHeaders)
        .send({ feeStatus: 'paid' })
        .expect(200);

      const dbStudent = await Student.findById(createRes.body.id).lean();
      expect(dbStudent.feeStatus).toBe('pending');
    });

    it('keeps StudentFeeStructure intact after soft-delete so trash-restore preserves fee history', async () => {
      const FeeHead = (await import('../models/FeeHead.js')).default;
      const admin = await createStaffUser();
      const classRecord = await createClassRecord({ name: 'Class 6', section: 'A' });
      await FeeHead.create({
        schoolId: admin.schoolId,
        name: 'Tuition',
        amount: 2000,
        applicableClasses: ['6'],
        isActive: true,
      });

      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const createRes = await request(app)
        .post('/api/students')
        .set(authHeaders)
        .send({
          name: 'Soft Delete Preserves Fees',
          admissionId: 'ADM-SDPF-001',
          academicYear: CURRENT_ACADEMIC_YEAR,
          rollNo: 12,
          classId: classRecord._id.toString(),
          parents: defaultParent,
        })
        .expect(201);

      const studentId = createRes.body.id;

      // Record some payment history
      const fs = await StudentFeeStructure.findOne({
        studentId,
        schoolId: admin.schoolId,
      });
      fs.feeHeads[0].paidAmount = 800;
      fs.feeHeads[0].balanceAmount = 1200;
      fs.totalPaid = 800;
      fs.totalBalance = 1200;
      fs.overallStatus = 'partial';
      await fs.save();

      // Soft-delete the student
      await request(app).delete(`/api/students/${studentId}`).set(authHeaders).expect(200);

      // Before the fix, fee structures were hard-deleted here across all
      // academic years and restore-from-trash left the student with no
      // payment history. Post-fix they must survive soft-delete.
      const surviving = await StudentFeeStructure.findOne({
        studentId,
        schoolId: admin.schoolId,
      });
      expect(surviving).toBeTruthy();
      expect(surviving.totalPaid).toBe(800);
      expect(surviving.feeHeads[0].paidAmount).toBe(800);
    });

    it('preserves paid fee amounts when a student is moved to a new class mid-year', async () => {
      // Seed: admin, two classes, FeeHead applicable to both, then create a
      // student in class A. We'll hand-pay ₹500 against the only fee head,
      // then move the student to class B and assert the paidAmount survives.
      const FeeHead = (await import('../models/FeeHead.js')).default;
      const admin = await createStaffUser();
      const classA = await createClassRecord({ name: 'Class 5', section: 'A' });
      const classB = await createClassRecord({ name: 'Class 5', section: 'B' });

      // Matching applicableClasses: '5' covers both Class 5-A and Class 5-B
      await FeeHead.create({
        schoolId: admin.schoolId,
        name: 'Tuition',
        category: 'Academic',
        amount: 1000,
        applicableClasses: ['5'],
        isActive: true,
      });

      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const createRes = await request(app)
        .post('/api/students')
        .set(authHeaders)
        .send({
          name: 'Class Change Student',
          admissionId: 'ADM-CLC-001',
          academicYear: CURRENT_ACADEMIC_YEAR,
          rollNo: 10,
          classId: classA._id.toString(),
          parents: defaultParent,
        })
        .expect(201);

      const studentId = createRes.body.id;

      // Simulate a payment: bump paidAmount on the existing structure directly
      const seeded = await StudentFeeStructure.findOne({
        studentId,
        schoolId: admin.schoolId,
      });
      expect(seeded).toBeTruthy();
      expect(seeded.totalFee).toBe(1000); // Verifies the #1 fix (fee head is actually picked up)
      seeded.feeHeads[0].paidAmount = 500;
      seeded.feeHeads[0].balanceAmount = 500;
      seeded.feeHeads[0].status = 'partial';
      seeded.totalPaid = 500;
      seeded.totalBalance = 500;
      seeded.overallStatus = 'partial';
      await seeded.save();

      // Move student to class B
      await request(app)
        .put(`/api/students/${studentId}`)
        .set(authHeaders)
        .send({ classId: classB._id.toString() })
        .expect(200);

      const after = await StudentFeeStructure.findOne({
        studentId,
        schoolId: admin.schoolId,
      });
      expect(after).toBeTruthy();
      expect(after.totalPaid).toBe(500); // ← this was 0 before the fix
      expect(after.totalBalance).toBe(500);
      expect(after.classId.toString()).toBe(classB._id.toString());
      expect(after.feeHeads[0].paidAmount).toBe(500);
    });
  });

  describe('DELETE /api/students/:id — Delete student', () => {
    it('returns 404 when deleting a non-existent student ID', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');
      const nonExistentId = new mongoose.Types.ObjectId().toString();

      await request(app).delete(`/api/students/${nonExistentId}`).set(authHeaders).expect(404);
    });

    it('returns 401 when request is unauthenticated', async () => {
      const classRecord = await createClassRecord();
      const student = await createStudentRecord({ classId: classRecord._id });
      const { app } = createTestApp();

      await request(app).delete(`/api/students/${student._id.toString()}`).expect(401);
    });
  });
});
