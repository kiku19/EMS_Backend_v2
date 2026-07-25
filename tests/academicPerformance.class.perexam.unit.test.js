import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Exam, Result } from '../database.js';
import {
  authHeadersFor,
  createClassRecord,
  createStaffUser,
  createStudentRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

// Per-exam rollup added (additively) to
// GET /api/academic-performance/class/:classId
describe('GET /api/academic-performance/class/:classId — per-exam rollup', () => {
  it('returns one entry per published exam with avg %, pass %, fail %, participants', async () => {
    const admin = await createStaffUser();
    const klass = await createClassRecord({ name: 'Class 7', section: 'A', subjects: ['Math'] });
    const s1 = await createStudentRecord({ name: 'Aarav', classId: klass._id });
    const s2 = await createStudentRecord({ name: 'Diya', classId: klass._id });
    const s3 = await createStudentRecord({ name: 'Kabir', classId: klass._id });

    // Two exams, both published
    const exam1 = await Exam.create({
      schoolId: klass.schoolId,
      name: 'UT 1',
      type: 'unit_test',
      classId: klass._id,
      subjectName: 'Math',
      academicYear: klass.academicYear,
      maxMarks: 100,
      totalMarks: 100,
      passingMarks: 35,
      status: 'results_published',
      isPublished: true,
      startDate: '2026-07-01',
    });
    const exam2 = await Exam.create({
      schoolId: klass.schoolId,
      name: 'UT 2',
      type: 'unit_test',
      classId: klass._id,
      subjectName: 'Math',
      academicYear: klass.academicYear,
      maxMarks: 100,
      totalMarks: 100,
      passingMarks: 35,
      status: 'results_published',
      isPublished: true,
      startDate: '2026-08-01',
    });

    // Exam1 results: 80 (pass), 50 (pass), 20 (fail) → avg 50, pass 2/3
    await Result.create([
      {
        schoolId: klass.schoolId,
        examId: exam1._id,
        classId: klass._id,
        studentId: s1._id,
        academicYear: klass.academicYear,
        marksObtained: 80,
        maxMarks: 100,
        percentage: 80,
        status: 'passed',
        isPublished: true,
      },
      {
        schoolId: klass.schoolId,
        examId: exam1._id,
        classId: klass._id,
        studentId: s2._id,
        academicYear: klass.academicYear,
        marksObtained: 50,
        maxMarks: 100,
        percentage: 50,
        status: 'passed',
        isPublished: true,
      },
      {
        schoolId: klass.schoolId,
        examId: exam1._id,
        classId: klass._id,
        studentId: s3._id,
        academicYear: klass.academicYear,
        marksObtained: 20,
        maxMarks: 100,
        percentage: 20,
        status: 'failed',
        isPublished: true,
      },
    ]);
    // Exam2 results: 100 (pass), 60 (pass), 30 (fail) → avg 63.3, pass 2/3
    await Result.create([
      {
        schoolId: klass.schoolId,
        examId: exam2._id,
        classId: klass._id,
        studentId: s1._id,
        academicYear: klass.academicYear,
        marksObtained: 100,
        maxMarks: 100,
        percentage: 100,
        status: 'passed',
        isPublished: true,
      },
      {
        schoolId: klass.schoolId,
        examId: exam2._id,
        classId: klass._id,
        studentId: s2._id,
        academicYear: klass.academicYear,
        marksObtained: 60,
        maxMarks: 100,
        percentage: 60,
        status: 'passed',
        isPublished: true,
      },
      {
        schoolId: klass.schoolId,
        examId: exam2._id,
        classId: klass._id,
        studentId: s3._id,
        academicYear: klass.academicYear,
        marksObtained: 30,
        maxMarks: 100,
        percentage: 30,
        status: 'failed',
        isPublished: true,
      },
    ]);

    const { app } = createTestApp();
    const authHeaders = authHeadersFor(admin, 'admin');

    const response = await request(app)
      .get(`/api/academic-performance/class/${klass._id}?academicYear=${klass.academicYear}`)
      .set(authHeaders)
      .expect(200);

    expect(Array.isArray(response.body.exams)).toBe(true);
    expect(response.body.exams).toHaveLength(2);

    // Sorted by date desc → exam2 first
    const [first, second] = response.body.exams;
    expect(first.examName).toBe('UT 2');
    expect(first.participantCount).toBe(3);
    expect(first.averagePercentage).toBeCloseTo(63.3, 1);
    expect(first.passRate).toBeCloseTo(67, 0);
    expect(first.failRate).toBeCloseTo(33, 0);

    expect(second.examName).toBe('UT 1');
    expect(second.averagePercentage).toBeCloseTo(50, 0);
    expect(second.passRate).toBeCloseTo(67, 0);

    // Existing response fields are unchanged (additive)
    expect(Array.isArray(response.body.students)).toBe(true);
    expect(Array.isArray(response.body.subjectBreakdown)).toBe(true);
    expect(response.body.stats).toBeDefined();
  });

  it('returns an empty exams array when no published results exist', async () => {
    const admin = await createStaffUser();
    const klass = await createClassRecord({ name: 'Empty', section: 'A', subjects: ['Math'] });
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(admin, 'admin');

    const response = await request(app)
      .get(`/api/academic-performance/class/${klass._id}?academicYear=${klass.academicYear}`)
      .set(authHeaders)
      .expect(200);

    expect(response.body.exams).toEqual([]);
  });

  it('excludes pending placeholders and gives tied students the same dense rank', async () => {
    const admin = await createStaffUser();
    const klass = await createClassRecord({ name: 'Class 8', section: 'B', subjects: ['Math'] });
    const s1 = await createStudentRecord({ name: 'A', classId: klass._id });
    const s2 = await createStudentRecord({ name: 'B', classId: klass._id });
    const pending = await createStudentRecord({ name: 'Pending', classId: klass._id });
    const exam = await Exam.create({
      schoolId: klass.schoolId,
      name: 'Rank Test',
      type: 'unit_test',
      classId: klass._id,
      subjectName: 'Math',
      academicYear: klass.academicYear,
      maxMarks: 100,
      passingMarks: 35,
      status: 'results_published',
      isPublished: true,
      startDate: '2026-09-01',
    });
    await Result.create([
      {
        schoolId: klass.schoolId,
        examId: exam._id,
        classId: klass._id,
        studentId: s1._id,
        academicYear: klass.academicYear,
        marksObtained: 75,
        maxMarks: 100,
        percentage: 75,
        status: 'passed',
        isPublished: true,
      },
      {
        schoolId: klass.schoolId,
        examId: exam._id,
        classId: klass._id,
        studentId: s2._id,
        academicYear: klass.academicYear,
        marksObtained: 75,
        maxMarks: 100,
        percentage: 75,
        status: 'passed',
        isPublished: true,
      },
      {
        schoolId: klass.schoolId,
        examId: exam._id,
        classId: klass._id,
        studentId: pending._id,
        academicYear: klass.academicYear,
        marksObtained: null,
        maxMarks: 100,
        status: 'pending',
        isPublished: true,
      },
    ]);

    const { app } = createTestApp();
    const response = await request(app)
      .get(`/api/academic-performance/class/${klass._id}?academicYear=${klass.academicYear}`)
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.exams[0].participantCount).toBe(2);
    expect(response.body.students).toHaveLength(2);
    expect(response.body.students.map((student) => student.classRank)).toEqual([1, 1]);
    expect(response.body.stats.totalStudents).toBe(2);
    expect(response.body.stats.participantCount).toBe(2);
    expect(response.body.stats.enrolledStudentCount).toBe(3);
  });
});
