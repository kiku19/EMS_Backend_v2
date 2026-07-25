import mongoose from 'mongoose';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { Class, Staff, Student } from '../database.js';
import Parent from '../models/Parent.js';
import { createOrUpdateParentAccount } from '../utils/parentAccountHelper.js';
import { piiMatch } from '../utils/encryption.js';
import { createTestApp } from './helpers/testApp.js';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
} from './helpers/factories.js';

async function setupSchool(label) {
  const school = await createSchoolRecord({
    name: `${label} School`,
    code: `${label}-${new mongoose.Types.ObjectId().toString().slice(-6)}`,
  });
  const admin = await createStaffUser({ schoolId: school._id });
  return { school, admin, headers: authHeadersFor(admin, 'admin') };
}

describe('Students/Classes final release gate', () => {
  it('clearing classTeacherId clears the matching Staff mirror atomically', async () => {
    const { school, headers } = await setupSchool('TEACHER-CLEAR');
    const teacher = await createStaffUser({
      schoolId: school._id,
      name: 'Class Teacher',
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });
    const classDoc = await createClassRecord({
      schoolId: school._id,
      classTeacherId: teacher._id,
      name: 'Class 7',
      section: 'C',
    });
    teacher.isClassTeacher = true;
    teacher.classTeacherOf = 'Class 7-C';
    await teacher.save();

    const { app } = createTestApp();
    await request(app)
      .put(`/api/classes/${classDoc._id}`)
      .set(headers)
      .send({ classTeacherId: '' })
      .expect(200);

    const [storedClass, storedTeacher] = await Promise.all([
      Class.findById(classDoc._id).lean(),
      Staff.findById(teacher._id).lean(),
    ]);
    expect(storedClass.classTeacherId).toBeNull();
    expect(storedTeacher.isClassTeacher).toBe(false);
    expect(storedTeacher.classTeacherOf).toBeNull();
  });

  it('never assigns one teacher to two classes under concurrent updates', async () => {
    const { school, headers } = await setupSchool('TEACHER-RACE');
    const teacher = await createStaffUser({
      schoolId: school._id,
      name: 'Concurrent Teacher',
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });
    const [firstClass, secondClass] = await Promise.all([
      createClassRecord({ schoolId: school._id, name: 'Class 5', section: 'A' }),
      createClassRecord({ schoolId: school._id, name: 'Class 6', section: 'A' }),
    ]);
    const { app } = createTestApp();

    const responses = await Promise.all([
      request(app)
        .put(`/api/classes/${firstClass._id}`)
        .set(headers)
        .send({ classTeacherId: teacher._id.toString() }),
      request(app)
        .put(`/api/classes/${secondClass._id}`)
        .set(headers)
        .send({ classTeacherId: teacher._id.toString() }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);

    const [storedClasses, storedTeacher] = await Promise.all([
      Class.find({
        schoolId: school._id,
        classTeacherId: teacher._id,
        isDeleted: { $ne: true },
      }).lean(),
      Staff.findById(teacher._id).lean(),
    ]);
    expect(storedClasses).toHaveLength(1);
    expect(storedTeacher.isClassTeacher).toBe(true);
    expect(storedTeacher.classTeacherOf).toBe(
      `${storedClasses[0].name}-${storedClasses[0].section}`
    );
  });

  it('rolls back both sides when guardian replacement cannot be reconciled', async () => {
    const { school, headers } = await setupSchool('PARENT-ATOMIC');
    const classDoc = await createClassRecord({ schoolId: school._id });
    const student = await createStudentRecord({
      schoolId: school._id,
      classId: classDoc._id,
      parents: [
        {
          name: 'Original Guardian',
          relationship: 'guardian',
          phone: '9111111001',
        },
      ],
    });
    await createOrUpdateParentAccount(student);

    const originalParent = await Parent.findOne({
      schoolId: school._id,
      ...piiMatch('phone', '9111111001'),
    });
    expect(originalParent).toBeTruthy();

    const originalSave = Parent.prototype.save;
    const saveSpy = vi.spyOn(Parent.prototype, 'save').mockImplementation(function (...args) {
      if (this.name === 'Replacement Guardian') {
        return Promise.reject(new Error('Simulated parent persistence failure'));
      }
      return originalSave.apply(this, args);
    });

    const { app } = createTestApp();
    try {
      await request(app)
        .put(`/api/students/${student._id}`)
        .set(headers)
        .send({
          parents: [
            {
              name: 'Replacement Guardian',
              relationship: 'guardian',
              phone: '9111111003',
              email: 'replacement@example.com',
            },
          ],
        })
        .expect(500);
    } finally {
      saveSpy.mockRestore();
    }

    const [storedStudent, storedOriginalParent, replacementParent] = await Promise.all([
      Student.findById(student._id).lean(),
      Parent.findById(originalParent._id).lean(),
      Parent.findOne({
        schoolId: school._id,
        ...piiMatch('phone', '9111111003'),
      }).lean(),
    ]);

    expect(storedStudent.parents).toHaveLength(1);
    expect(storedStudent.parents[0].name).toBe('Original Guardian');
    expect(storedStudent.parents[0].parentId.toString()).toBe(originalParent._id.toString());
    expect(
      storedOriginalParent.children.some(
        (child) => child.studentId.toString() === student._id.toString()
      )
    ).toBe(true);
    expect(replacementParent).toBeNull();
  });

  it('keeps identical guardian phone numbers isolated between schools', async () => {
    const first = await setupSchool('PARENT-A');
    const second = await setupSchool('PARENT-B');
    const [firstClass, secondClass] = await Promise.all([
      createClassRecord({ schoolId: first.school._id, name: 'Class 1' }),
      createClassRecord({ schoolId: second.school._id, name: 'Class 1' }),
    ]);
    const sharedPhone = '9222222001';
    const [firstStudent, secondStudent] = await Promise.all([
      createStudentRecord({
        schoolId: first.school._id,
        classId: firstClass._id,
        parents: [{ name: 'School A Guardian', relationship: 'guardian', phone: sharedPhone }],
      }),
      createStudentRecord({
        schoolId: second.school._id,
        classId: secondClass._id,
        parents: [{ name: 'School B Guardian', relationship: 'guardian', phone: sharedPhone }],
      }),
    ]);

    await Promise.all([
      createOrUpdateParentAccount(firstStudent),
      createOrUpdateParentAccount(secondStudent),
    ]);

    const parents = await Parent.find(piiMatch('phone', sharedPhone)).lean();
    expect(parents).toHaveLength(2);
    expect(new Set(parents.map((parent) => parent.schoolId.toString())).size).toBe(2);

    const [storedFirst, storedSecond] = await Promise.all([
      Student.findById(firstStudent._id).lean(),
      Student.findById(secondStudent._id).lean(),
    ]);
    expect(storedFirst.parents[0].parentId.toString()).not.toBe(
      storedSecond.parents[0].parentId.toString()
    );

    await Parent.init();
    const duplicateError = await Parent.create({
      schoolId: first.school._id,
      name: 'Duplicate School A Guardian',
      phone: sharedPhone,
      children: [],
    }).catch((error) => error);
    expect(duplicateError.code).toBe(11000);
  });

  it('reserves collision-free TC numbers concurrently and honors existing high-water marks', async () => {
    const { school, headers } = await setupSchool('TC-NUMBERS');
    const classDoc = await createClassRecord({ schoolId: school._id });
    const year = new Date().getFullYear();
    const seeded = await createStudentRecord({
      schoolId: school._id,
      classId: classDoc._id,
      admissionId: 'TC-HIGH-WATER',
    });

    // Factories intentionally expose only common student fields; persist the
    // legal record explicitly to seed a legacy high-water mark.
    seeded.transferCertificate = { tcNumber: `TC-${year}-0042`, issuedAt: new Date() };
    await seeded.save();

    const { app } = createTestApp();
    const first = await request(app).get('/api/students/tc/next-number').set(headers).expect(200);
    expect(first.body.tcNumber).toBe(`TC-${year}-0043`);

    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(app).get('/api/students/tc/next-number').set(headers).expect(200)
      )
    );
    const numbers = responses.map((response) => response.body.tcNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers.every((number) => number.startsWith(`TC-${year}-`))).toBe(true);
  });

  it('allows the same TC number in different schools but rejects a same-school collision', async () => {
    const first = await setupSchool('TC-A');
    const second = await setupSchool('TC-B');
    const [firstClass, secondClass] = await Promise.all([
      createClassRecord({ schoolId: first.school._id, name: 'Class 8' }),
      createClassRecord({ schoolId: second.school._id, name: 'Class 8' }),
    ]);
    const [studentA, studentB, studentC] = await Promise.all([
      createStudentRecord({ schoolId: first.school._id, classId: firstClass._id }),
      createStudentRecord({ schoolId: first.school._id, classId: firstClass._id }),
      createStudentRecord({ schoolId: second.school._id, classId: secondClass._id }),
    ]);
    const payload = {
      tcNumber: 'TC-CUSTOM-0001',
      issueDate: '2026-03-31',
      daysPresent: 180,
      workingDays: 200,
    };
    const { app } = createTestApp();

    const issued = await request(app)
      .post(`/api/students/${studentA._id}/transfer-certificate`)
      .set(first.headers)
      .send(payload)
      .expect(201);
    expect(issued.body.transferCertificate.issuedBy).toBe(first.admin._id.toString());
    await request(app)
      .post(`/api/students/${studentC._id}/transfer-certificate`)
      .set(second.headers)
      .send(payload)
      .expect(201);
    await request(app)
      .post(`/api/students/${studentB._id}/transfer-certificate`)
      .set(first.headers)
      .send(payload)
      .expect(409);
  });
});
