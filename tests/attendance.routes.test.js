import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Attendance } from '../database.js';
import { authHeadersFor, createClassRecord, createStaffUser, createStudentRecord } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

describe('attendance routes', () => {
  it('marks class attendance in bulk and returns the class snapshot', async () => {
    const teacher = await createStaffUser({
      name: 'Teacher User',
      email: 'teacher@example.com',
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });
    const classRecord = await createClassRecord({
      classTeacherId: teacher._id,
      name: 'Class 7',
      section: 'C',
    });
    const firstStudent = await createStudentRecord({
      name: 'First Student',
      admissionId: 'ADM7001',
      rollNo: 1,
      classId: classRecord._id,
    });
    const secondStudent = await createStudentRecord({
      name: 'Second Student',
      admissionId: 'ADM7002',
      rollNo: 2,
      classId: classRecord._id,
      parentPhone: '9876543211',
    });
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(teacher, 'teacher');
    const date = '2026-03-06';

    const markResponse = await request(app)
      .post('/api/attendance/bulk')
      .set(authHeaders)
      .send({
        classId: classRecord._id.toString(),
        date,
        attendance: [
          { studentId: firstStudent._id.toString(), status: 'present' },
          { studentId: secondStudent._id.toString(), status: 'absent' },
        ],
      })
      .expect(200);

    expect(markResponse.body).toMatchObject({
      success: true,
      message: 'Attendance marked for 2 students',
    });

    const snapshotResponse = await request(app)
      .get(`/api/attendance/class/${classRecord._id.toString()}/${date}`)
      .set(authHeaders)
      .expect(200);

    expect(snapshotResponse.body).toMatchObject({
      [firstStudent._id.toString()]: { status: 'present' },
      [secondStudent._id.toString()]: { status: 'absent' },
    });

    const savedRecords = await Attendance.find({ classId: classRecord._id, date }).lean();
    expect(savedRecords).toHaveLength(2);
    expect(savedRecords.every((record) => record.markedBy.toString() === teacher._id.toString())).toBe(true);
  });
});
