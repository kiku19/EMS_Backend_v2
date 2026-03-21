import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Attendance } from '../database.js';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

describe('attendance routes', () => {
  describe('POST /api/attendance/bulk — bulk mark attendance', () => {
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
      expect(
        savedRecords.every((record) => record.markedBy.toString() === teacher._id.toString())
      ).toBe(true);
    });

    it('marks all students present', async () => {
      const teacher = await createStaffUser({
        name: 'Teacher All Present',
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
      });
      const classRecord = await createClassRecord({
        classTeacherId: teacher._id,
        name: 'Class 8',
        section: 'A',
      });
      const studentA = await createStudentRecord({
        name: 'Student Alpha',
        rollNo: 1,
        classId: classRecord._id,
      });
      const studentB = await createStudentRecord({
        name: 'Student Beta',
        rollNo: 2,
        classId: classRecord._id,
        parentPhone: '9000000001',
      });
      const studentC = await createStudentRecord({
        name: 'Student Gamma',
        rollNo: 3,
        classId: classRecord._id,
        parentPhone: '9000000002',
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(teacher, 'teacher');
      const date = '2026-03-07';

      const response = await request(app)
        .post('/api/attendance/bulk')
        .set(authHeaders)
        .send({
          classId: classRecord._id.toString(),
          date,
          attendance: [
            { studentId: studentA._id.toString(), status: 'present' },
            { studentId: studentB._id.toString(), status: 'present' },
            { studentId: studentC._id.toString(), status: 'present' },
          ],
        })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Attendance marked for 3 students',
      });

      const savedRecords = await Attendance.find({ classId: classRecord._id, date }).lean();
      expect(savedRecords).toHaveLength(3);
      expect(savedRecords.every((r) => r.status === 'present')).toBe(true);
    });

    it('marks a mix of present, absent, and late statuses', async () => {
      const teacher = await createStaffUser({
        name: 'Teacher Mixed',
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
      });
      const classRecord = await createClassRecord({
        classTeacherId: teacher._id,
        name: 'Class 9',
        section: 'B',
      });
      const presentStudent = await createStudentRecord({
        name: 'Present Student',
        rollNo: 1,
        classId: classRecord._id,
      });
      const absentStudent = await createStudentRecord({
        name: 'Absent Student',
        rollNo: 2,
        classId: classRecord._id,
        parentPhone: '9100000001',
      });
      const lateStudent = await createStudentRecord({
        name: 'Late Student',
        rollNo: 3,
        classId: classRecord._id,
        parentPhone: '9100000002',
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(teacher, 'teacher');
      const date = '2026-03-08';

      const response = await request(app)
        .post('/api/attendance/bulk')
        .set(authHeaders)
        .send({
          classId: classRecord._id.toString(),
          date,
          attendance: [
            { studentId: presentStudent._id.toString(), status: 'present' },
            { studentId: absentStudent._id.toString(), status: 'absent' },
            { studentId: lateStudent._id.toString(), status: 'late' },
          ],
        })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Attendance marked for 3 students',
      });

      const savedRecords = await Attendance.find({ classId: classRecord._id, date }).lean();
      const byStudent = Object.fromEntries(
        savedRecords.map((r) => [r.studentId.toString(), r.status])
      );
      expect(byStudent[presentStudent._id.toString()]).toBe('present');
      expect(byStudent[absentStudent._id.toString()]).toBe('absent');
      expect(byStudent[lateStudent._id.toString()]).toBe('late');
    });

    it('re-marking the same date upserts records — updates instead of duplicating', async () => {
      const teacher = await createStaffUser({
        name: 'Teacher Upsert',
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
      });
      const classRecord = await createClassRecord({
        classTeacherId: teacher._id,
        name: 'Class 10',
        section: 'D',
      });
      const student = await createStudentRecord({
        name: 'Upsert Student',
        rollNo: 1,
        classId: classRecord._id,
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(teacher, 'teacher');
      const date = '2026-03-09';

      await request(app)
        .post('/api/attendance/bulk')
        .set(authHeaders)
        .send({
          classId: classRecord._id.toString(),
          date,
          attendance: [{ studentId: student._id.toString(), status: 'present' }],
        })
        .expect(200);

      // Re-mark same date with a different status
      const secondResponse = await request(app)
        .post('/api/attendance/bulk')
        .set(authHeaders)
        .send({
          classId: classRecord._id.toString(),
          date,
          attendance: [{ studentId: student._id.toString(), status: 'absent' }],
        })
        .expect(200);

      expect(secondResponse.body).toMatchObject({
        success: true,
        message: 'Attendance marked for 1 students',
      });

      // Should have only one record, not two
      const savedRecords = await Attendance.find({ studentId: student._id, date }).lean();
      expect(savedRecords).toHaveLength(1);
      expect(savedRecords[0].status).toBe('absent');
    });

    it('returns 401 when unauthenticated', async () => {
      const classRecord = await createClassRecord({ name: 'Class 11', section: 'A' });
      const { app } = createTestApp();

      await request(app)
        .post('/api/attendance/bulk')
        .send({
          classId: classRecord._id.toString(),
          date: '2026-03-10',
          attendance: [],
        })
        .expect(401);
    });

    it('handles an empty attendance array gracefully', async () => {
      const teacher = await createStaffUser({
        name: 'Teacher Empty',
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
      });
      const classRecord = await createClassRecord({
        classTeacherId: teacher._id,
        name: 'Class 12',
        section: 'A',
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(teacher, 'teacher');

      const response = await request(app)
        .post('/api/attendance/bulk')
        .set(authHeaders)
        .send({
          classId: classRecord._id.toString(),
          date: '2026-03-10',
          attendance: [],
        })
        .expect(400);

      expect(response.body.error).toBeDefined();
    });
  });

  describe('POST /api/attendance — mark single attendance record', () => {
    it('marks a single student attendance record for a date', async () => {
      const teacher = await createStaffUser({
        name: 'Teacher Single',
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
      });
      const classRecord = await createClassRecord({
        classTeacherId: teacher._id,
        name: 'Class 6',
        section: 'A',
      });
      const student = await createStudentRecord({
        name: 'Single Student',
        rollNo: 1,
        classId: classRecord._id,
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(teacher, 'teacher');
      const date = '2026-03-10';

      const response = await request(app)
        .post('/api/attendance')
        .set(authHeaders)
        .send({
          studentId: student._id.toString(),
          classId: classRecord._id.toString(),
          date,
          status: 'present',
        })
        .expect(200);

      expect(response.body).toMatchObject({
        studentId: student._id.toString(),
        classId: classRecord._id.toString(),
        date,
        status: 'present',
      });

      const savedRecord = await Attendance.findOne({ studentId: student._id, date }).lean();
      expect(savedRecord).toBeTruthy();
      expect(savedRecord.status).toBe('present');
      expect(savedRecord.markedBy.toString()).toBe(teacher._id.toString());
    });

    it('returns 401 when unauthenticated', async () => {
      const classRecord = await createClassRecord({ name: 'Class 6', section: 'B' });
      const student = await createStudentRecord({
        name: 'Unauth Student',
        rollNo: 1,
        classId: classRecord._id,
      });
      const { app } = createTestApp();

      await request(app)
        .post('/api/attendance')
        .send({
          studentId: student._id.toString(),
          classId: classRecord._id.toString(),
          date: '2026-03-10',
          status: 'present',
        })
        .expect(401);
    });
  });

  describe('GET /api/attendance/student/:studentId — get student attendance', () => {
    it('returns all attendance records for a student', async () => {
      const teacher = await createStaffUser({
        name: 'Teacher Student Get',
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
      });
      const classRecord = await createClassRecord({
        classTeacherId: teacher._id,
        name: 'Class 5',
        section: 'A',
      });
      const student = await createStudentRecord({
        name: 'Records Student',
        rollNo: 1,
        classId: classRecord._id,
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(teacher, 'teacher');

      // Seed attendance via the API so schoolId is consistently scoped by the route
      await request(app)
        .post('/api/attendance/bulk')
        .set(authHeaders)
        .send({
          classId: classRecord._id.toString(),
          date: '2026-03-01',
          attendance: [{ studentId: student._id.toString(), status: 'present' }],
        })
        .expect(200);

      await request(app)
        .post('/api/attendance/bulk')
        .set(authHeaders)
        .send({
          classId: classRecord._id.toString(),
          date: '2026-03-02',
          attendance: [{ studentId: student._id.toString(), status: 'absent' }],
        })
        .expect(200);

      const response = await request(app)
        .get(`/api/attendance/student/${student._id.toString()}`)
        .set(authHeaders)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThanOrEqual(2);

      const statuses = response.body.map((r) => r.status);
      expect(statuses).toContain('present');
      expect(statuses).toContain('absent');
    });

    it('filters records by date range using start and end query params', async () => {
      const teacher = await createStaffUser({
        name: 'Teacher Date Range',
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
      });
      const classRecord = await createClassRecord({
        classTeacherId: teacher._id,
        name: 'Class 4',
        section: 'A',
      });
      const student = await createStudentRecord({
        name: 'Range Student',
        rollNo: 1,
        classId: classRecord._id,
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(teacher, 'teacher');

      // Seed attendance via the API so schoolId scoping is consistent
      for (const { date, status } of [
        { date: '2026-02-01', status: 'present' },
        { date: '2026-03-01', status: 'absent' },
        { date: '2026-04-01', status: 'late' },
      ]) {
        await request(app)
          .post('/api/attendance/bulk')
          .set(authHeaders)
          .send({
            classId: classRecord._id.toString(),
            date,
            attendance: [{ studentId: student._id.toString(), status }],
          })
          .expect(200);
      }

      const response = await request(app)
        .get(`/api/attendance/student/${student._id.toString()}`)
        .query({ start: '2026-03-01', end: '2026-03-31' })
        .set(authHeaders)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].status).toBe('absent');
      expect(response.body[0].date).toBe('2026-03-01');
    });

    it('returns 401 when unauthenticated', async () => {
      const classRecord = await createClassRecord({ name: 'Class 3', section: 'A' });
      const student = await createStudentRecord({
        name: 'Unauth Student 2',
        rollNo: 1,
        classId: classRecord._id,
      });
      const { app } = createTestApp();

      await request(app).get(`/api/attendance/student/${student._id.toString()}`).expect(401);
    });

    it('returns no records for a student from a different school (multi-tenancy)', async () => {
      const schoolA = await createSchoolRecord({ name: 'School Alpha', code: 'SCH-A01' });
      const schoolB = await createSchoolRecord({ name: 'School Beta', code: 'SCH-B01' });

      const teacherA = await createStaffUser({
        name: 'Teacher School A',
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
        schoolId: schoolA._id,
      });
      const teacherB = await createStaffUser({
        name: 'Teacher School B',
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
        schoolId: schoolB._id,
      });

      const classB = await createClassRecord({
        classTeacherId: teacherB._id,
        name: 'Class B1',
        section: 'A',
      });
      const studentB = await createStudentRecord({
        name: 'Student School B',
        rollNo: 1,
        classId: classB._id,
      });

      // Mark attendance with School B's teacher (scoped to schoolB)
      await Attendance.create({
        schoolId: schoolB._id,
        studentId: studentB._id,
        classId: classB._id,
        date: '2026-03-05',
        status: 'present',
        markedBy: teacherB._id,
      });

      const { app } = createTestApp();
      // Teacher A (school A) tries to read student B's attendance
      const authHeadersA = authHeadersFor(teacherA, 'teacher');

      const response = await request(app)
        .get(`/api/attendance/student/${studentB._id.toString()}`)
        .set(authHeadersA)
        .expect(200);

      // Should return empty — schoolA cannot see schoolB's records
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(0);
    });
  });

  describe('GET /api/attendance/class/:classId/:date — get class attendance for a date', () => {
    it('returns attendance records for all students in a class on a given date', async () => {
      const teacher = await createStaffUser({
        name: 'Teacher Class Snap',
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
      });
      const classRecord = await createClassRecord({
        classTeacherId: teacher._id,
        name: 'Class 2',
        section: 'A',
      });
      const studentOne = await createStudentRecord({
        name: 'Snap Student One',
        rollNo: 1,
        classId: classRecord._id,
      });
      const studentTwo = await createStudentRecord({
        name: 'Snap Student Two',
        rollNo: 2,
        classId: classRecord._id,
        parentPhone: '9200000001',
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(teacher, 'teacher');
      const date = '2026-03-11';

      // Seed attendance via the API so schoolId scoping is consistent with the read endpoint
      await request(app)
        .post('/api/attendance/bulk')
        .set(authHeaders)
        .send({
          classId: classRecord._id.toString(),
          date,
          attendance: [
            { studentId: studentOne._id.toString(), status: 'present' },
            { studentId: studentTwo._id.toString(), status: 'late' },
          ],
        })
        .expect(200);

      const response = await request(app)
        .get(`/api/attendance/class/${classRecord._id.toString()}/${date}`)
        .set(authHeaders)
        .expect(200);

      expect(response.body).toMatchObject({
        [studentOne._id.toString()]: { status: 'present' },
        [studentTwo._id.toString()]: { status: 'late' },
      });
    });

    it('returns an empty object when no attendance has been marked yet for the date', async () => {
      const teacher = await createStaffUser({
        name: 'Teacher No Records',
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
      });
      const classRecord = await createClassRecord({
        classTeacherId: teacher._id,
        name: 'Class 1',
        section: 'A',
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(teacher, 'teacher');

      const response = await request(app)
        .get(`/api/attendance/class/${classRecord._id.toString()}/2026-01-01`)
        .set(authHeaders)
        .expect(200);

      expect(response.body).toEqual({});
    });

    it('returns 401 when unauthenticated', async () => {
      const classRecord = await createClassRecord({ name: 'Class 1', section: 'B' });
      const { app } = createTestApp();

      await request(app)
        .get(`/api/attendance/class/${classRecord._id.toString()}/2026-03-11`)
        .expect(401);
    });
  });

  describe('multi-tenancy isolation', () => {
    it('school A teacher cannot read school B class attendance', async () => {
      const schoolA = await createSchoolRecord({ name: 'School One', code: 'SCH-ONE' });
      const schoolB = await createSchoolRecord({ name: 'School Two', code: 'SCH-TWO' });

      const teacherA = await createStaffUser({
        name: 'Multi Teacher A',
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
        schoolId: schoolA._id,
      });
      const teacherB = await createStaffUser({
        name: 'Multi Teacher B',
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
        schoolId: schoolB._id,
      });

      const classB = await createClassRecord({
        classTeacherId: teacherB._id,
        name: 'Class MT-B',
        section: 'A',
      });
      const studentB = await createStudentRecord({
        name: 'MT Student B',
        rollNo: 1,
        classId: classB._id,
        parentPhone: '9300000001',
      });
      const date = '2026-03-11';

      // Seed attendance scoped to School B
      await Attendance.create({
        schoolId: schoolB._id,
        studentId: studentB._id,
        classId: classB._id,
        date,
        status: 'present',
        markedBy: teacherB._id,
      });

      const { app } = createTestApp();
      // Teacher A from School A reads School B's class attendance
      const authHeadersA = authHeadersFor(teacherA, 'teacher');

      const response = await request(app)
        .get(`/api/attendance/class/${classB._id.toString()}/${date}`)
        .set(authHeadersA)
        .expect(200);

      // School A should not see School B's attendance records
      expect(response.body).toEqual({});
    });

    it('school A teacher cannot mark attendance for school B class via bulk endpoint', async () => {
      const schoolA = await createSchoolRecord({ name: 'School Three', code: 'SCH-THREE' });
      const schoolB = await createSchoolRecord({ name: 'School Four', code: 'SCH-FOUR' });

      const teacherA = await createStaffUser({
        name: 'Cross Teacher A',
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
        schoolId: schoolA._id,
      });
      const teacherB = await createStaffUser({
        name: 'Cross Teacher B',
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
        schoolId: schoolB._id,
      });

      const classB = await createClassRecord({
        classTeacherId: teacherB._id,
        name: 'Class Cross-B',
        section: 'A',
      });
      const studentB = await createStudentRecord({
        name: 'Cross Student B',
        rollNo: 1,
        classId: classB._id,
        parentPhone: '9400000001',
      });
      const date = '2026-03-12';

      const { app } = createTestApp();
      // Teacher A from School A marks attendance for School B's class
      const authHeadersA = authHeadersFor(teacherA, 'teacher');

      const response = await request(app)
        .post('/api/attendance/bulk')
        .set(authHeadersA)
        .send({
          classId: classB._id.toString(),
          date,
          attendance: [{ studentId: studentB._id.toString(), status: 'present' }],
        })
        .expect(200);

      expect(response.body).toMatchObject({ success: true });

      // The record should be scoped to School A, not School B
      const recordScopedToB = await Attendance.findOne({
        schoolId: schoolB._id,
        studentId: studentB._id,
        date,
      }).lean();
      expect(recordScopedToB).toBeNull();

      // The record exists but is scoped to School A (Teacher A's school)
      const recordScopedToA = await Attendance.findOne({
        schoolId: schoolA._id,
        studentId: studentB._id,
        date,
      }).lean();
      expect(recordScopedToA).toBeTruthy();
      expect(recordScopedToA.status).toBe('present');
    });
  });
});
