import mongoose from 'mongoose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Attendance, Class, Staff, Student } from '../database.js';
import ClassRating from '../models/ClassRating.js';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import { createTestApp } from './helpers/testApp.js';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
} from './helpers/factories.js';

async function setupSchool(suffix = '') {
  const school = await createSchoolRecord({
    name: `Safety School ${suffix}`,
    code: `SAFE-${suffix}-${new mongoose.Types.ObjectId().toString().slice(-6)}`,
  });
  const admin = await createStaffUser({ schoolId: school._id });
  return { school, admin, headers: authHeadersFor(admin, 'admin') };
}

describe('Students and Classes destructive-flow safety', () => {
  it('archives and restores a student without deleting attendance history', async () => {
    const { school, admin, headers } = await setupSchool('ARCHIVE');
    const classDoc = await createClassRecord({ schoolId: school._id });
    const student = await createStudentRecord({ schoolId: school._id, classId: classDoc._id });
    const currentAttendance = await Attendance.create({
      schoolId: school._id,
      studentId: student._id,
      classId: classDoc._id,
      date: '2026-07-01',
      status: 'present',
      markedBy: admin._id,
    });
    const previouslyDeletedAttendance = await Attendance.create({
      schoolId: school._id,
      studentId: student._id,
      classId: classDoc._id,
      date: '2026-07-02',
      status: 'absent',
      markedBy: admin._id,
      isDeleted: true,
      deletedAt: new Date('2026-07-03T00:00:00.000Z'),
      deletedBy: admin._id,
    });
    const { app } = createTestApp();

    const archived = await request(app)
      .delete(`/api/students/${student._id}`)
      .set(headers)
      .expect(200);

    expect(archived.body.trashItemId).toBeTruthy();
    expect(await Attendance.findById(currentAttendance._id)).toMatchObject({ isDeleted: true });
    expect(await Attendance.findById(previouslyDeletedAttendance._id)).toMatchObject({
      isDeleted: true,
    });

    await request(app)
      .post(`/api/trash/${archived.body.trashItemId}/restore`)
      .set(headers)
      .expect(200);

    expect(await Student.findById(student._id)).toMatchObject({
      isDeleted: false,
      status: 'active',
    });
    expect(await Attendance.findById(currentAttendance._id)).toMatchObject({ isDeleted: false });
    expect(await Attendance.findById(previouslyDeletedAttendance._id)).toMatchObject({
      isDeleted: true,
    });
  });

  it('uses the reversible archive lifecycle for bulk deletion', async () => {
    const { school, admin, headers } = await setupSchool('BULK');
    const classDoc = await createClassRecord({ schoolId: school._id });
    const first = await createStudentRecord({ schoolId: school._id, classId: classDoc._id });
    const second = await createStudentRecord({ schoolId: school._id, classId: classDoc._id });
    const attendance = await Attendance.create({
      schoolId: school._id,
      studentId: first._id,
      classId: classDoc._id,
      date: '2026-07-04',
      status: 'late',
      markedBy: admin._id,
    });
    const { app } = createTestApp();

    const response = await request(app)
      .post('/api/bulk-ops/students/batch-delete')
      .set(headers)
      .send({ ids: [first._id.toString(), second._id.toString()] })
      .expect(200);

    expect(response.body.summary).toEqual({ total: 2, succeeded: 2, failed: 0 });
    expect(response.body.results.every((item) => item.trashItemId)).toBe(true);
    expect(await Attendance.findById(attendance._id)).toMatchObject({ isDeleted: true });

    await request(app)
      .post(`/api/trash/${response.body.results[0].trashItemId}/restore`)
      .set(headers)
      .expect(200);
    expect(await Attendance.findById(attendance._id)).toMatchObject({ isDeleted: false });
  });

  it('rejects a cross-school bulk promotion before changing any student', async () => {
    const schoolA = await setupSchool('PROMO-A');
    const schoolB = await setupSchool('PROMO-B');
    const sourceClass = await createClassRecord({ schoolId: schoolA.school._id });
    const foreignClass = await createClassRecord({ schoolId: schoolB.school._id });
    const student = await createStudentRecord({
      schoolId: schoolA.school._id,
      classId: sourceClass._id,
    });
    const { app } = createTestApp();

    await request(app)
      .post('/api/students/bulk-promote')
      .set(schoolA.headers)
      .send({
        promotions: [{ studentId: student._id.toString(), targetClassId: foreignClass._id }],
      })
      .expect(400);

    const unchanged = await Student.findById(student._id).lean();
    expect(unchanged.classId.toString()).toBe(sourceClass._id.toString());
  });

  it('rolls back every bulk promotion when one student is invalid', async () => {
    const { school, headers } = await setupSchool('PROMO-ATOMIC');
    const sourceClass = await createClassRecord({ schoolId: school._id });
    const targetClass = await createClassRecord({
      schoolId: school._id,
      name: 'Class 11',
    });
    const student = await createStudentRecord({ schoolId: school._id, classId: sourceClass._id });
    const missingStudentId = new mongoose.Types.ObjectId();
    const { app } = createTestApp();

    await request(app)
      .post('/api/students/bulk-promote')
      .set(headers)
      .send({
        promotions: [
          { studentId: student._id.toString(), targetClassId: targetClass._id.toString() },
          { studentId: missingStudentId.toString(), targetClassId: targetClass._id.toString() },
        ],
      })
      .expect(400);

    const unchanged = await Student.findById(student._id).lean();
    expect(unchanged.classId.toString()).toBe(sourceClass._id.toString());
  });

  it('preserves prior-year fee history during an individual promotion', async () => {
    const { school, headers } = await setupSchool('FEES');
    const sourceClass = await createClassRecord({
      schoolId: school._id,
      academicYear: '2025-26',
    });
    const targetClass = await createClassRecord({
      schoolId: school._id,
      name: 'Class 11',
      academicYear: '2026-27',
    });
    const student = await createStudentRecord({
      schoolId: school._id,
      classId: sourceClass._id,
      academicYear: '2025-26',
      feeStatus: 'paid',
    });
    const historical = await StudentFeeStructure.create({
      schoolId: school._id,
      studentId: student._id,
      classId: sourceClass._id,
      academicYear: '2025-26',
      totalFee: 10000,
      totalPaid: 7500,
      totalBalance: 2500,
      overallStatus: 'partial',
    });
    const { app } = createTestApp();

    await request(app)
      .post(`/api/students/${student._id}/promote`)
      .set(headers)
      .send({
        targetClassId: targetClass._id.toString(),
        academicYear: '2026-27',
        skipFeeCheck: true,
        skipAttendanceCheck: true,
      })
      .expect(200);

    const preserved = await StudentFeeStructure.findById(historical._id).lean();
    expect(preserved).toMatchObject({
      academicYear: '2025-26',
      totalPaid: 7500,
      totalBalance: 2500,
    });
    const promoted = await Student.findById(student._id).lean();
    expect(promoted.classId.toString()).toBe(targetClass._id.toString());
    expect(promoted.academicYear).toBe('2026-27');
  });

  it('preserves prior-year fee history during year-end promotion', async () => {
    const { school, headers } = await setupSchool('YEAR-END');
    const sourceClass = await createClassRecord({
      schoolId: school._id,
      academicYear: '2025-26',
    });
    const targetClass = await createClassRecord({
      schoolId: school._id,
      name: 'Class 11',
      academicYear: '2026-27',
    });
    const student = await createStudentRecord({
      schoolId: school._id,
      classId: sourceClass._id,
      academicYear: '2025-26',
    });
    const historical = await StudentFeeStructure.create({
      schoolId: school._id,
      studentId: student._id,
      classId: sourceClass._id,
      academicYear: '2025-26',
      totalFee: 8000,
      totalPaid: 3000,
      totalBalance: 5000,
      overallStatus: 'partial',
    });
    const { app } = createTestApp();

    const response = await request(app)
      .post('/api/students/promote/year-end')
      .set(headers)
      .send({
        academicYear: '2026-27',
        classPromotions: [
          { fromClassId: sourceClass._id.toString(), toClassId: targetClass._id.toString() },
        ],
        skipFeeCheck: true,
        skipAttendanceCheck: true,
      })
      .expect(200);

    expect(response.body.summary.promoted).toBe(1);
    expect(await StudentFeeStructure.findById(historical._id)).toMatchObject({
      totalPaid: 3000,
      totalBalance: 5000,
    });
  });

  it('rejects class deletion when non-soft-deletable historical data depends on it', async () => {
    const { school, headers } = await setupSchool('CLASS-DEPS');
    const classDoc = await createClassRecord({ schoolId: school._id });
    const rating = await ClassRating.create({ schoolId: school._id, classId: classDoc._id });
    const { app } = createTestApp();

    const response = await request(app)
      .delete(`/api/classes/${classDoc._id}`)
      .set(headers)
      .expect(409);

    expect(response.body.dependencies).toContain('class ratings');
    expect(await Class.findById(classDoc._id)).toMatchObject({ isDeleted: false });
    const unchangedRating = await ClassRating.findById(rating._id).lean();
    expect(unchangedRating).not.toHaveProperty('isDeleted');
  });

  it('atomically restores an empty class and its class-teacher assignment', async () => {
    const { school, headers } = await setupSchool('CLASS-RESTORE');
    const teacher = await createStaffUser({ schoolId: school._id, staffRole: ['Teacher'] });
    const classDoc = await createClassRecord({
      schoolId: school._id,
      name: 'Class 12',
      classTeacherId: teacher._id,
    });
    await Staff.updateOne(
      { _id: teacher._id },
      { $set: { isClassTeacher: true, classTeacherOf: 'Class 12-A' } }
    );
    const { app } = createTestApp();

    const archived = await request(app)
      .delete(`/api/classes/${classDoc._id}`)
      .set(headers)
      .expect(200);
    expect(await Staff.findById(teacher._id)).toMatchObject({ isClassTeacher: false });

    await request(app)
      .post(`/api/trash/${archived.body.trashItemId}/restore`)
      .set(headers)
      .expect(200);

    expect(await Class.findById(classDoc._id)).toMatchObject({ isDeleted: false });
    expect(await Staff.findById(teacher._id)).toMatchObject({
      isClassTeacher: true,
      classTeacherOf: 'Class 12-A',
    });
  });
});
