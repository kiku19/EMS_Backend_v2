import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Exam, Staff } from '../database.js';
import { authHeadersFor, createClassRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

// Bulk exam creation: POST /api/exams/bulk
// Materializes one Exam per (subject × date) for a class.
describe('POST /api/exams/bulk — bulk exam creation', () => {
  it('creates one exam per subject when subjects="all" and a single date', async () => {
    const admin = await createStaffUser();
    const klass = await createClassRecord({
      name: 'Class 9',
      section: 'B',
      subjects: ['Math', 'Science', 'English'],
    });
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(admin, 'admin');

    const response = await request(app)
      .post('/api/exams/bulk')
      .set(authHeaders)
      .send({
        classId: klass._id.toString(),
        name: 'Unit Test 1',
        type: 'unit_test',
        subjects: 'all',
        dates: '2026-08-15',
        maxMarks: 50,
        passingMarks: 20,
        academicYear: '2025-26',
      })
      .expect(201);

    expect(response.body.created).toBe(3);
    expect(response.body.skipped).toBe(0);
    expect(response.body.exams).toHaveLength(3);

    // Multi-subject → name is prefixed with the subject
    const names = response.body.exams.map((e) => e.name).sort();
    expect(names).toEqual(['Unit Test 1 · English', 'Unit Test 1 · Math', 'Unit Test 1 · Science']);

    // Each exam carries the subject + totalMarks (pre-save doesn't fire on insertMany)
    for (const exam of response.body.exams) {
      expect(exam.maxMarks).toBe(50);
      expect(exam.totalMarks).toBe(50);
      expect(exam.passingMarks).toBe(20);
      expect(exam.status).toBe('scheduled');
      expect(exam.type).toBe('unit_test');
    }

    // Persisted to the DB
    const inDb = await Exam.countDocuments({ classId: klass._id, academicYear: '2025-26' });
    expect(inDb).toBe(3);
  });

  it('creates a single exam when subjects is an explicit one-element list', async () => {
    const admin = await createStaffUser();
    const klass = await createClassRecord({
      name: 'Class 11',
      section: 'A',
      subjects: ['Physics', 'Chemistry'],
    });
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(admin, 'admin');

    const response = await request(app)
      .post('/api/exams/bulk')
      .set(authHeaders)
      .send({
        classId: klass._id.toString(),
        name: 'Quiz',
        type: 'quiz',
        subjects: ['Physics'],
        dates: '2026-09-01',
        academicYear: '2025-26',
      })
      .expect(201);

    expect(response.body.created).toBe(1);
    // Single subject → no subject prefix in the name
    expect(response.body.exams[0].name).toBe('Quiz');
    expect(response.body.exams[0].subjectName).toBe('Physics');
  });

  it('accepts per-subject dates', async () => {
    const admin = await createStaffUser();
    const klass = await createClassRecord({
      name: 'Class 8',
      section: 'A',
      subjects: ['Math', 'Science'],
    });
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(admin, 'admin');

    const response = await request(app)
      .post('/api/exams/bulk')
      .set(authHeaders)
      .send({
        classId: klass._id.toString(),
        name: 'Mid Term',
        type: 'midterm',
        subjects: 'all',
        dates: [
          { subjectName: 'Math', date: '2026-09-10' },
          { subjectName: 'Science', date: '2026-09-12' },
        ],
        academicYear: '2025-26',
      })
      .expect(201);

    expect(response.body.created).toBe(2);
    const bySubject = Object.fromEntries(
      response.body.exams.map((e) => [e.subjectName, e.startDate])
    );
    expect(bySubject.Math).toBeDefined();
    expect(bySubject.Science).toBeDefined();
    expect(new Date(bySubject.Math).getTime()).toBeLessThan(new Date(bySubject.Science).getTime());
  });

  it('returns 400 when subjects="all" but the class has no subjects', async () => {
    const admin = await createStaffUser();
    const klass = await createClassRecord({
      name: 'Empty',
      section: 'A',
      subjects: [],
    });
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(admin, 'admin');

    const response = await request(app)
      .post('/api/exams/bulk')
      .set(authHeaders)
      .send({
        classId: klass._id.toString(),
        name: 'Unit Test',
        type: 'unit_test',
        subjects: 'all',
        dates: '2026-08-15',
      })
      .expect(400);

    expect(response.body.error).toMatch(/no subjects/i);
  });

  it('returns 400 when an explicit subject is not on the class', async () => {
    const admin = await createStaffUser();
    const klass = await createClassRecord({
      name: 'Strict',
      section: 'A',
      subjects: ['Math'],
    });
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(admin, 'admin');

    await request(app)
      .post('/api/exams/bulk')
      .set(authHeaders)
      .send({
        classId: klass._id.toString(),
        name: 'Unit Test',
        type: 'unit_test',
        subjects: ['Biology'],
        dates: '2026-08-15',
      })
      .expect(400);
  });

  it('returns 404 when the class does not exist', async () => {
    const admin = await createStaffUser();
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(admin, 'admin');

    await request(app)
      .post('/api/exams/bulk')
      .set(authHeaders)
      .send({
        classId: '64b7f8f8f8f8f8f8f8f8f8f8',
        name: 'Unit Test',
        type: 'unit_test',
        subjects: 'all',
        dates: '2026-08-15',
      })
      .expect(404);
  });

  it('returns 401 when unauthenticated', async () => {
    const klass = await createClassRecord({ subjects: ['Math'] });
    const { app } = createTestApp();

    await request(app)
      .post('/api/exams/bulk')
      .send({
        classId: klass._id.toString(),
        name: 'Unit Test',
        subjects: 'all',
        dates: '2026-08-15',
      })
      .expect(401);
  });

  it('returns 400 on invalid payload (missing name)', async () => {
    const admin = await createStaffUser();
    const klass = await createClassRecord({ subjects: ['Math'] });
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(admin, 'admin');

    await request(app)
      .post('/api/exams/bulk')
      .set(authHeaders)
      .send({
        classId: klass._id.toString(),
        // name omitted
        subjects: 'all',
        dates: '2026-08-15',
      })
      .expect(400);
  });
});

// Academics classes board: GET /api/academic-board
describe('GET /api/academic-board — classes operational board', () => {
  it('returns one row per class with teacher + exam counts', async () => {
    const teacher = await createStaffUser({
      name: 'Ms. Rao',
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });
    const admin = await createStaffUser({ name: 'Admin' });
    const klass = await createClassRecord({
      name: 'Class 10',
      section: 'A',
      subjects: ['Math', 'Science'],
      classTeacherId: teacher._id,
    });

    // Give the teacher a teacherAssignment for this class+subject
    await Staff.updateOne(
      { _id: teacher._id },
      { $push: { teacherAssignments: { subject: 'Math', classes: [klass._id] } } }
    );

    // Seed two exams
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(admin, 'admin');
    await request(app)
      .post('/api/exams/bulk')
      .set(authHeaders)
      .send({
        classId: klass._id.toString(),
        name: 'UT1',
        type: 'unit_test',
        subjects: 'all',
        dates: '2026-08-15',
        academicYear: '2025-26',
      })
      .expect(201);

    const response = await request(app)
      .get('/api/academic-board?academicYear=2025-26')
      .set(authHeaders)
      .expect(200);

    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data.length).toBeGreaterThanOrEqual(1);

    const row = response.body.data.find((r) => r.classId === klass._id.toString());
    expect(row).toBeDefined();
    expect(row.name).toBe('Class 10');
    expect(row.section).toBe('A');
    expect(row.classTeacher.name).toBe('Ms. Rao');
    // Subject-teacher derived from teacherAssignments
    expect(
      row.subjectTeachers.some((st) => st.subject === 'Math' && st.teacherName === 'Ms. Rao')
    ).toBe(true);
    // Two exams created (Math + Science)
    expect(row.examCounts.total).toBe(2);
    expect(row.examCounts.upcoming).toBe(2);
    expect(row.examCounts.drafts).toBe(2);
  });

  it('returns empty data array when no classes exist', async () => {
    const admin = await createStaffUser();
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(admin, 'admin');

    // Use a unique academic year with no classes to avoid cross-test pollution
    const response = await request(app)
      .get('/api/academic-board?academicYear=2099-00&q=ZZNONEXISTENT')
      .set(authHeaders)
      .expect(200);

    expect(response.body.data).toEqual([]);
  });

  it('returns 401 when unauthenticated', async () => {
    const { app } = createTestApp();
    await request(app).get('/api/academic-board').expect(401);
  });
});
