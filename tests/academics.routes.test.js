import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Exam, ExamSchedule, Result } from '../database.js';
import TrashItem from '../models/TrashItem.js';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

describe('academics routes', () => {
  // ─── Exam CRUD ───────────────────────────────────────────────────────

  describe('POST /api/exams — create an exam', () => {
    it('creates an exam with all required fields', async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord({ name: 'Class 10', section: 'A' });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app)
        .post('/api/exams')
        .set(authHeaders)
        .send({
          name: 'Mid Term Exam',
          classId: classRecord._id.toString(),
          maxMarks: 100,
          passingMarks: 35,
          startDate: '2026-05-15',
          academicYear: '2025-26',
        })
        .expect(201);

      expect(response.body).toMatchObject({
        name: 'Mid Term Exam',
        maxMarks: 100,
        passingMarks: 35,
        status: 'scheduled',
        isPublished: false,
      });
      expect(response.body._id).toBeDefined();
    });

    it('returns 401 when unauthenticated', async () => {
      const classRecord = await createClassRecord();
      const { app } = createTestApp();

      await request(app)
        .post('/api/exams')
        .send({
          name: 'Unauth Exam',
          classId: classRecord._id.toString(),
          startDate: '2026-05-15',
        })
        .expect(401);
    });

    // Note: duplicate exam rejection relies on a MongoDB partial unique index
    // with $not expression, which MongoMemoryServer does not support.
    // This constraint is tested at the database level in production.
  });

  describe('PUT /api/exams/:id — tenant and merged validation', () => {
    it('rejects a cross-school class and a partial passingMarks overflow', async () => {
      const schoolA = await createSchoolRecord({ name: 'Exam School A', code: 'EX-SA' });
      const schoolB = await createSchoolRecord({ name: 'Exam School B', code: 'EX-SB' });
      const adminA = await createStaffUser({ schoolId: schoolA._id });
      const classA = await createClassRecord({ schoolId: schoolA._id, subjects: ['Math'] });
      const classB = await createClassRecord({ schoolId: schoolB._id, subjects: ['Math'] });
      const { app } = createTestApp();
      const headers = authHeadersFor(adminA, 'admin');
      const examRes = await request(app)
        .post('/api/exams')
        .set(headers)
        .send({
          name: 'Tenant Update Exam',
          classId: classA._id.toString(),
          maxMarks: 50,
          passingMarks: 20,
          startDate: '2026-05-15',
          endDate: '2026-05-20',
          academicYear: '2025-26',
        })
        .expect(201);

      await request(app)
        .put(`/api/exams/${examRes.body._id}`)
        .set(headers)
        .send({ classId: classB._id.toString() })
        .expect(404);
      await request(app)
        .put(`/api/exams/${examRes.body._id}`)
        .set(headers)
        .send({ passingMarks: 60 })
        .expect(400);
      await request(app)
        .put(`/api/exams/${examRes.body._id}`)
        .set(headers)
        .send({ maxMarks: 10 })
        .expect(400);
      await request(app)
        .put(`/api/exams/${examRes.body._id}`)
        .set(headers)
        .send({ startDate: '2026-05-25' })
        .expect(400);

      const unchanged = await Exam.findById(examRes.body._id).lean();
      expect(String(unchanged.classId)).toBe(String(classA._id));
      expect(unchanged.passingMarks).toBe(20);
      expect(unchanged.maxMarks).toBe(50);
      expect(unchanged.startDate.toISOString().slice(0, 10)).toBe('2026-05-15');
    });

    it('keeps publish lifecycle and result scope out of generic edits', async () => {
      const school = await createSchoolRecord({ name: 'Exam Lifecycle School', code: 'EX-LIFE' });
      const admin = await createStaffUser({ schoolId: school._id });
      const classA = await createClassRecord({
        schoolId: school._id,
        name: 'Class 8',
        section: 'A',
      });
      const classB = await createClassRecord({
        schoolId: school._id,
        name: 'Class 8',
        section: 'B',
      });
      await createStudentRecord({
        schoolId: school._id,
        classId: classA._id,
        name: 'Scope Student',
      });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');
      const startDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

      const examRes = await request(app)
        .post('/api/exams/create-with-results')
        .set(headers)
        .send({
          name: 'Lifecycle Guard Exam',
          classId: classA._id.toString(),
          maxMarks: 100,
          passingMarks: 35,
          startDate,
          academicYear: '2026-27',
        })
        .expect(201);

      await request(app)
        .put(`/api/exams/${examRes.body._id}`)
        .set(headers)
        .send({ status: 'results_published' })
        .expect(400);

      const classMove = await request(app)
        .put(`/api/exams/${examRes.body._id}`)
        .set(headers)
        .send({ classId: classB._id.toString() })
        .expect(409);
      expect(classMove.body.code).toBe('EXAM_RESULT_SCOPE_LOCKED');

      const yearMove = await request(app)
        .put(`/api/exams/${examRes.body._id}`)
        .set(headers)
        .send({ academicYear: '2027-28' })
        .expect(409);
      expect(yearMove.body.code).toBe('EXAM_RESULT_SCOPE_LOCKED');

      const unchanged = await Exam.findById(examRes.body._id).lean();
      expect(unchanged.isPublished).toBe(false);
      expect(unchanged.status).not.toBe('results_published');
      expect(String(unchanged.classId)).toBe(String(classA._id));
      expect(unchanged.academicYear).toBe('2026-27');
    });
  });

  describe('exam/result request integrity gates', () => {
    it('rejects invalid exam ids and unsafe list query values as 400s', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      await request(app).get('/api/exams/not-an-id').set(headers).expect(400);
      await request(app).get('/api/exams?skip=-1').set(headers).expect(400);
      await request(app).get('/api/exams?limit=201').set(headers).expect(400);
      await request(app).get('/api/exams?classId=not-an-id').set(headers).expect(400);
    });

    it('rejects a bulk result class that differs from the exam class', async () => {
      const school = await createSchoolRecord({ name: 'Result Scope School', code: 'RS-SCOPE' });
      const admin = await createStaffUser({ schoolId: school._id });
      const classA = await createClassRecord({
        schoolId: school._id,
        name: 'Class 7',
        section: 'A',
      });
      const classB = await createClassRecord({
        schoolId: school._id,
        name: 'Class 7',
        section: 'B',
      });
      const studentB = await createStudentRecord({ schoolId: school._id, classId: classB._id });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');
      const startDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      const examRes = await request(app)
        .post('/api/exams')
        .set(headers)
        .send({
          name: 'Class Scope Exam',
          classId: classA._id.toString(),
          startDate,
          academicYear: '2026-27',
        })
        .expect(201);

      const response = await request(app)
        .post('/api/results/bulk')
        .set(headers)
        .send({
          examId: examRes.body._id,
          classId: classB._id.toString(),
          results: [{ studentId: studentB._id.toString(), marksObtained: 60 }],
        })
        .expect(400);
      expect(response.body.code).toBe('EXAM_CLASS_MISMATCH');
      expect(await Result.countDocuments({ examId: examRes.body._id })).toBe(0);
    });

    it('ranks only entered rows and leaves initialized placeholders pending', async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord({ name: 'Class 6', section: 'A' });
      const students = await Promise.all([
        createStudentRecord({ classId: classRecord._id, name: 'Entered Student', rollNo: 1 }),
        createStudentRecord({ classId: classRecord._id, name: 'Pending Student', rollNo: 2 }),
      ]);
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');
      const startDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      const examRes = await request(app)
        .post('/api/exams/create-with-results')
        .set(headers)
        .send({
          name: 'Rank Placeholder Exam',
          classId: classRecord._id.toString(),
          startDate,
          academicYear: '2026-27',
        })
        .expect(201);

      await request(app)
        .post('/api/results/bulk')
        .set(headers)
        .send({
          examId: examRes.body._id,
          classId: classRecord._id.toString(),
          results: [{ studentId: students[0]._id.toString(), marksObtained: 70 }],
        })
        .expect(200);

      const [entered, pending] = await Promise.all([
        Result.findOne({ examId: examRes.body._id, studentId: students[0]._id }).lean(),
        Result.findOne({ examId: examRes.body._id, studentId: students[1]._id }).lean(),
      ]);
      expect(entered.rank).toBe(1);
      expect(pending.status).toBe('pending');
      expect(pending.marksObtained).toBeNull();
      expect(pending.rank).toBeUndefined();
    });

    it('atomically recalculates entered rows when passing marks change without consuming placeholders', async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord({ name: 'Class 6', section: 'B' });
      const students = await Promise.all([
        createStudentRecord({ classId: classRecord._id, name: 'Threshold Student', rollNo: 1 }),
        createStudentRecord({ classId: classRecord._id, name: 'Still Pending Student', rollNo: 2 }),
      ]);
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');
      const startDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      const examRes = await request(app)
        .post('/api/exams/create-with-results')
        .set(headers)
        .send({
          name: 'Passing Threshold Exam',
          classId: classRecord._id.toString(),
          maxMarks: 100,
          passingMarks: 35,
          startDate,
          academicYear: '2026-27',
        })
        .expect(201);

      await request(app)
        .post('/api/results/bulk')
        .set(headers)
        .send({
          examId: examRes.body._id,
          classId: classRecord._id.toString(),
          results: [{ studentId: students[0]._id.toString(), marksObtained: 40 }],
        })
        .expect(200);

      await request(app)
        .put(`/api/exams/${examRes.body._id}`)
        .set(headers)
        .send({ passingMarks: 45 })
        .expect(200);

      const [entered, pending] = await Promise.all([
        Result.findOne({ examId: examRes.body._id, studentId: students[0]._id }).lean(),
        Result.findOne({ examId: examRes.body._id, studentId: students[1]._id }).lean(),
      ]);
      expect(entered.status).toBe('failed');
      expect(entered.rank).toBe(1);
      expect(pending).toMatchObject({ status: 'pending', marksObtained: null });
      expect(pending.rank).toBeUndefined();
    });

    it('uses the exam as the canonical class, maximum, and academic year for a single result', async () => {
      const school = await createSchoolRecord({ name: 'Single Result School', code: 'RS-SINGLE' });
      const admin = await createStaffUser({ schoolId: school._id });
      const classA = await createClassRecord({
        schoolId: school._id,
        name: 'Class 5',
        section: 'A',
      });
      const classB = await createClassRecord({
        schoolId: school._id,
        name: 'Class 5',
        section: 'B',
      });
      const [studentA, studentB] = await Promise.all([
        createStudentRecord({ schoolId: school._id, classId: classA._id }),
        createStudentRecord({ schoolId: school._id, classId: classB._id }),
      ]);
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');
      const startDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      const examRes = await request(app)
        .post('/api/exams')
        .set(headers)
        .send({
          name: 'Canonical Result Exam',
          classId: classA._id.toString(),
          maxMarks: 80,
          passingMarks: 30,
          startDate,
          academicYear: '2026-27',
        })
        .expect(201);

      const wrongClass = await request(app)
        .post('/api/results')
        .set(headers)
        .send({ examId: examRes.body._id, studentId: studentB._id.toString(), marksObtained: 50 })
        .expect(400);
      expect(wrongClass.body.code).toBe('EXAM_CLASS_MISMATCH');

      const wrongMaximum = await request(app)
        .post('/api/results')
        .set(headers)
        .send({
          examId: examRes.body._id,
          studentId: studentA._id.toString(),
          marksObtained: 50,
          maxMarks: 100,
        })
        .expect(400);
      expect(wrongMaximum.body.code).toBe('EXAM_MAX_MARKS_MISMATCH');

      const wrongYear = await request(app)
        .post('/api/results')
        .set(headers)
        .send({
          examId: examRes.body._id,
          studentId: studentA._id.toString(),
          marksObtained: 50,
          academicYear: '2027-28',
        })
        .expect(400);
      expect(wrongYear.body.code).toBe('EXAM_ACADEMIC_YEAR_MISMATCH');
      expect(await Result.countDocuments({ examId: examRes.body._id })).toBe(0);
    });
  });

  describe('DELETE /api/exams/:id — restorable cascade', () => {
    it('atomically archives and restores the exam, its active results, and schedule backlink', async () => {
      const school = await createSchoolRecord({ name: 'Exam Restore School', code: 'EX-RST' });
      const admin = await createStaffUser({ schoolId: school._id });
      const classRecord = await createClassRecord({ schoolId: school._id, subjects: ['Math'] });
      const [activeStudent, previouslyDeletedStudent] = await Promise.all([
        createStudentRecord({
          schoolId: school._id,
          classId: classRecord._id,
          name: 'Active Result Student',
          rollNo: 1,
        }),
        createStudentRecord({
          schoolId: school._id,
          classId: classRecord._id,
          name: 'Old Deleted Student',
          rollNo: 2,
        }),
      ]);
      const schedule = await ExamSchedule.create({
        schoolId: school._id,
        name: 'Restore Schedule',
        classIds: [classRecord._id],
        startDate: new Date('2026-05-01'),
        endDate: new Date('2026-05-02'),
        academicYear: '2025-26',
        status: 'scheduled',
      });
      const exam = await Exam.create({
        schoolId: school._id,
        name: 'Restore Exam',
        classId: classRecord._id,
        subjectName: 'Math',
        academicYear: '2025-26',
        startDate: new Date('2026-05-01'),
        examScheduleId: schedule._id,
      });
      schedule.generatedExamIds = [exam._id];
      await schedule.save();
      const oldDeletedAt = new Date('2025-01-01T00:00:00.000Z');
      await Result.create([
        {
          schoolId: school._id,
          examId: exam._id,
          studentId: activeStudent._id,
          classId: classRecord._id,
          academicYear: '2025-26',
          marksObtained: 80,
          maxMarks: 100,
          status: 'passed',
        },
        {
          schoolId: school._id,
          examId: exam._id,
          studentId: previouslyDeletedStudent._id,
          classId: classRecord._id,
          academicYear: '2025-26',
          marksObtained: 60,
          maxMarks: 100,
          status: 'passed',
          isDeleted: true,
          deletedAt: oldDeletedAt,
        },
      ]);

      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');
      await request(app).delete(`/api/exams/${exam._id}`).set(headers).expect(200);

      const archivedResults = await Result.find({ examId: exam._id }).sort({ studentId: 1 }).lean();
      expect(archivedResults.every((result) => result.isDeleted)).toBe(true);
      const archivedSchedule = await ExamSchedule.findById(schedule._id).lean();
      expect(archivedSchedule.generatedExamIds.map(String)).not.toContain(String(exam._id));
      const trashItem = await TrashItem.findOne({ itemType: 'Exam', itemId: exam._id });
      expect(trashItem?.deletionContext?.cascadeDeletedAt).toBeTruthy();

      await request(app).post(`/api/trash/${trashItem._id}/restore`).set(headers).expect(200);

      const restoredExam = await Exam.findById(exam._id).lean();
      expect(restoredExam.isDeleted).toBe(false);
      const restoredActive = await Result.findOne({
        studentId: activeStudent._id,
        examId: exam._id,
      }).lean();
      expect(restoredActive.isDeleted).toBe(false);
      const stillDeleted = await Result.findOne({
        studentId: previouslyDeletedStudent._id,
        examId: exam._id,
      }).lean();
      expect(stillDeleted.isDeleted).toBe(true);
      expect(stillDeleted.deletedAt.toISOString()).toBe(oldDeletedAt.toISOString());
      const restoredSchedule = await ExamSchedule.findById(schedule._id).lean();
      expect(restoredSchedule.generatedExamIds.map(String)).toContain(String(exam._id));

      await request(app).delete(`/api/exams/${exam._id}`).set(headers).expect(200);
      const secondTrashItem = await TrashItem.findOne({ itemType: 'Exam', itemId: exam._id });
      await request(app).delete(`/api/trash/${secondTrashItem._id}`).set(headers).expect(200);
      expect(await Exam.findById(exam._id)).toBeNull();
      expect(await Result.countDocuments({ examId: exam._id })).toBe(0);
    });
  });

  describe('GET /api/exams/class/:classId — academic-year scope', () => {
    it('returns only exams from the requested academic year', async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord();
      const { app } = createTestApp();
      await Exam.create([
        {
          schoolId: admin.schoolId,
          name: 'Current Year Exam',
          classId: classRecord._id,
          academicYear: '2025-26',
          startDate: '2026-05-15',
        },
        {
          schoolId: admin.schoolId,
          name: 'Next Year Exam',
          classId: classRecord._id,
          academicYear: '2026-27',
          startDate: '2026-06-15',
        },
      ]);

      const response = await request(app)
        .get(`/api/exams/class/${classRecord._id}?academicYear=2025-26`)
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);

      expect(response.body.map((exam) => exam.name)).toEqual(['Current Year Exam']);
    });
  });

  describe('GET /api/exams — list exams', () => {
    it('returns all exams for the school with pagination metadata in the body (PAG-10)', async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      await request(app)
        .post('/api/exams')
        .set(authHeaders)
        .send({
          name: 'Unit Test 1',
          classId: classRecord._id.toString(),
          maxMarks: 50,
          passingMarks: 20,
          startDate: '2026-05-10',
          academicYear: '2025-26',
        })
        .expect(201);

      await request(app)
        .post('/api/exams')
        .set(authHeaders)
        .send({
          name: 'Unit Test 2',
          classId: classRecord._id.toString(),
          maxMarks: 50,
          passingMarks: 20,
          startDate: '2026-05-12',
          academicYear: '2025-26',
        })
        .expect(201);

      const response = await request(app).get('/api/exams').set(authHeaders).expect(200);

      // PAG-10: response is now { data, pagination } — not a bare array.
      // This lets the dashboard read total/hasMore without parsing headers.
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.pagination).toMatchObject({
        total: 2,
        skip: 0,
        limit: expect.any(Number),
        hasMore: false,
      });
      // The legacy X-Total-Count header should no longer be the source of
      // truth — the contract now lives in the body.
      expect(response.headers['x-total-count']).toBeUndefined();
    });

    it('honors skip/limit and reports hasMore when more pages exist (PAG-10)', async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      for (const [name, day] of [
        ['Day 1', '2026-05-10'],
        ['Day 2', '2026-05-11'],
        ['Day 3', '2026-05-12'],
      ]) {
        await request(app)
          .post('/api/exams')
          .set(authHeaders)
          .send({
            name,
            classId: classRecord._id.toString(),
            maxMarks: 50,
            passingMarks: 20,
            startDate: day,
            academicYear: '2025-26',
          })
          .expect(201);
      }

      const first = await request(app)
        .get('/api/exams?skip=0&limit=2')
        .set(authHeaders)
        .expect(200);
      expect(first.body.data).toHaveLength(2);
      expect(first.body.pagination).toMatchObject({ total: 3, skip: 0, limit: 2, hasMore: true });

      const second = await request(app)
        .get('/api/exams?skip=2&limit=2')
        .set(authHeaders)
        .expect(200);
      expect(second.body.data).toHaveLength(1);
      expect(second.body.pagination).toMatchObject({ total: 3, skip: 2, limit: 2, hasMore: false });
    });

    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/exams').expect(401);
    });

    // PAG-09: scope + search so the Results-entry picker doesn't drop older exams
    it('filters exams by academicYear', async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      for (const [name, year] of [
        ['2024 Final', '2024-25'],
        ['2025 Final', '2025-26'],
      ]) {
        await request(app)
          .post('/api/exams')
          .set(authHeaders)
          .send({
            name,
            classId: classRecord._id.toString(),
            maxMarks: 100,
            passingMarks: 35,
            startDate: '2026-05-10',
            academicYear: year,
          })
          .expect(201);
      }

      const response = await request(app)
        .get('/api/exams?academicYear=2024-25')
        .set(authHeaders)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe('2024 Final');
      expect(response.body.data[0].academicYear).toBe('2024-25');
    });

    it('filters exams by case-insensitive name search via q', async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      for (const name of ['Mid Term Maths', 'Final Science', 'Pop Quiz English']) {
        await request(app)
          .post('/api/exams')
          .set(authHeaders)
          .send({
            name,
            classId: classRecord._id.toString(),
            maxMarks: 100,
            passingMarks: 35,
            startDate: '2026-05-10',
            academicYear: '2025-26',
          })
          .expect(201);
      }

      const response = await request(app).get('/api/exams?q=maths').set(authHeaders).expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe('Mid Term Maths');
    });

    it('treats regex metacharacters in q as literals (no ReDoS, no crash)', async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      await request(app)
        .post('/api/exams')
        .set(authHeaders)
        .send({
          name: 'Quarterly Test',
          classId: classRecord._id.toString(),
          maxMarks: 100,
          passingMarks: 35,
          startDate: '2026-05-10',
          academicYear: '2025-26',
        })
        .expect(201);

      const response = await request(app)
        .get('/api/exams?q=' + encodeURIComponent('.*Quarterly.*'))
        .set(authHeaders)
        .expect(200);

      // Without the escape, ".*" would match the whole collection; with it,
      // it should match only the literal substring ".*Quarterly.*" (zero rows).
      expect(response.body.data).toHaveLength(0);
    });

    it('includes a school-scoped resultsEntered count per exam', async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord({ name: 'Class 7', section: 'B' });
      const studentA = await createStudentRecord({
        name: 'Asha',
        rollNo: 1,
        classId: classRecord._id,
      });
      const studentB = await createStudentRecord({
        name: 'Arun',
        rollNo: 2,
        classId: classRecord._id,
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      // Exam with results entered
      const examWithResults = await request(app)
        .post('/api/exams')
        .set(authHeaders)
        .send({
          name: 'Science Quiz',
          classId: classRecord._id.toString(),
          maxMarks: 50,
          passingMarks: 20,
          startDate: '2026-05-10',
          academicYear: '2025-26',
        })
        .expect(201);

      // Exam with no results
      await request(app)
        .post('/api/exams')
        .set(authHeaders)
        .send({
          name: 'History Quiz',
          classId: classRecord._id.toString(),
          maxMarks: 50,
          passingMarks: 20,
          startDate: '2026-05-11',
          academicYear: '2025-26',
        })
        .expect(201);

      await request(app)
        .post('/api/results/bulk')
        .set(authHeaders)
        .send({
          examId: examWithResults.body._id,
          classId: classRecord._id.toString(),
          results: [
            { studentId: studentA._id.toString(), marksObtained: 40 },
            { studentId: studentB._id.toString(), marksObtained: 28 },
          ],
        })
        .expect(200);

      const response = await request(app).get('/api/exams').set(authHeaders).expect(200);

      const science = response.body.data.find((e) => e.name === 'Science Quiz');
      const history = response.body.data.find((e) => e.name === 'History Quiz');

      expect(science.resultsEntered).toBe(2);
      expect(history.resultsEntered).toBe(0);
    });

    it('reports resultsEntered as 0 when an exam has no results', async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      await request(app)
        .post('/api/exams')
        .set(authHeaders)
        .send({
          name: 'Empty Exam',
          classId: classRecord._id.toString(),
          maxMarks: 100,
          passingMarks: 35,
          startDate: '2026-05-10',
          academicYear: '2025-26',
        })
        .expect(201);

      const response = await request(app).get('/api/exams').set(authHeaders).expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].resultsEntered).toBe(0);
    });

    it('does not count another school\u2019s results in resultsEntered', async () => {
      const schoolA = await createSchoolRecord({ name: 'School Iota', code: 'SCH-IOTA' });
      const schoolB = await createSchoolRecord({ name: 'School Kappa', code: 'SCH-KAPPA' });

      const adminA = await createStaffUser({ name: 'Admin Iota', schoolId: schoolA._id });
      const adminB = await createStaffUser({ name: 'Admin Kappa', schoolId: schoolB._id });

      const classA = await createClassRecord({
        name: 'Class A1',
        section: 'A',
        schoolId: schoolA._id,
      });
      const classB = await createClassRecord({
        name: 'Class B1',
        section: 'A',
        schoolId: schoolB._id,
      });
      const studentA = await createStudentRecord({
        name: 'A-Scholar',
        rollNo: 1,
        classId: classA._id,
        schoolId: schoolA._id,
      });
      const studentB = await createStudentRecord({
        name: 'B-Scholar',
        rollNo: 1,
        classId: classB._id,
        schoolId: schoolB._id,
      });

      const { app } = createTestApp();
      const authHeadersA = authHeadersFor(adminA, 'admin');
      const authHeadersB = authHeadersFor(adminB, 'admin');

      // Both schools create an exam named identically; each gets its own result.
      const examA = await request(app)
        .post('/api/exams')
        .set(authHeadersA)
        .send({
          name: 'Shared Name Exam',
          classId: classA._id.toString(),
          maxMarks: 100,
          passingMarks: 35,
          startDate: '2026-05-10',
          academicYear: '2025-26',
        })
        .expect(201);
      const examB = await request(app)
        .post('/api/exams')
        .set(authHeadersB)
        .send({
          name: 'Shared Name Exam',
          classId: classB._id.toString(),
          maxMarks: 100,
          passingMarks: 35,
          startDate: '2026-05-10',
          academicYear: '2025-26',
        })
        .expect(201);

      await request(app)
        .post('/api/results/bulk')
        .set(authHeadersA)
        .send({
          examId: examA.body._id,
          classId: classA._id.toString(),
          results: [{ studentId: studentA._id.toString(), marksObtained: 80 }],
        })
        .expect(200);
      await request(app)
        .post('/api/results/bulk')
        .set(authHeadersB)
        .send({
          examId: examB.body._id,
          classId: classB._id.toString(),
          results: [{ studentId: studentB._id.toString(), marksObtained: 70 }],
        })
        .expect(200);

      // School A's listing must show exactly 1 entered result (its own),
      // never school B's. Confirms the aggregate is school-scoped.
      const responseA = await request(app).get('/api/exams').set(authHeadersA).expect(200);
      expect(responseA.body.data).toHaveLength(1);
      expect(responseA.body.data[0].resultsEntered).toBe(1);
    });
  });

  describe('GET /api/exams/:id — get single exam', () => {
    it('returns a single exam by id', async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord({ name: 'Class 8', section: 'A' });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const createRes = await request(app)
        .post('/api/exams')
        .set(authHeaders)
        .send({
          name: 'Quiz 1',
          classId: classRecord._id.toString(),
          maxMarks: 25,
          passingMarks: 10,
          startDate: '2026-05-20',
          academicYear: '2025-26',
        })
        .expect(201);

      const examId = createRes.body._id;

      const response = await request(app).get(`/api/exams/${examId}`).set(authHeaders).expect(200);

      expect(response.body).toMatchObject({
        name: 'Quiz 1',
        maxMarks: 25,
        passingMarks: 10,
      });
      expect(response.body.className).toBe('Class 8-A');
    });

    it('returns 404 for non-existent exam', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');
      const fakeId = '000000000000000000000000';

      await request(app).get(`/api/exams/${fakeId}`).set(authHeaders).expect(404);
    });

    it('includes examSchedule link (name+status) when the exam was generated from a schedule', async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord({
        name: 'Class 8',
        section: 'A',
        subjects: ['Math'],
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      // Create + confirm a schedule so an Exam with examScheduleId exists.
      const schedulePayload = {
        name: 'Mid-Term Linked',
        type: 'midterm',
        classIds: [classRecord._id.toString()],
        startDate: '2026-04-01',
        endDate: '2026-04-15',
        sessionType: 'morning',
        academicYear: '2025-26',
      };
      const scheduleRes = await request(app)
        .post('/api/exam-schedules')
        .set(authHeaders)
        .send(schedulePayload)
        .expect(201);
      await request(app)
        .post(`/api/exam-schedules/${scheduleRes.body._id}/generate`)
        .set(authHeaders)
        .expect(200);
      const confirmRes = await request(app)
        .post(`/api/exam-schedules/${scheduleRes.body._id}/confirm`)
        .set(authHeaders)
        .expect(200);

      // Confirm populated generatedExamIds on the schedule for cross-check.
      expect(confirmRes.body.generatedExamIds?.length).toBeGreaterThan(0);
      const linkedExamId =
        confirmRes.body.generatedExamIds[0]._id || confirmRes.body.generatedExamIds[0];

      const examDetail = await request(app)
        .get(`/api/exams/${linkedExamId}`)
        .set(authHeaders)
        .expect(200);

      expect(examDetail.body.examSchedule).toMatchObject({
        name: 'Mid-Term Linked',
        status: 'scheduled',
      });
      expect(examDetail.body.examSchedule.id).toBeDefined();
    });

    it('returns examSchedule: null for a standalone (non-scheduled) exam', async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord({ name: 'Class 8', section: 'A' });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const createRes = await request(app)
        .post('/api/exams')
        .set(authHeaders)
        .send({
          name: 'Quiz 1',
          classId: classRecord._id.toString(),
          maxMarks: 25,
          passingMarks: 10,
          startDate: '2026-05-20',
          academicYear: '2025-26',
        })
        .expect(201);

      const response = await request(app)
        .get(`/api/exams/${createRes.body._id}`)
        .set(authHeaders)
        .expect(200);

      expect(response.body.examSchedule).toBeNull();
    });
  });

  // ─── Results Entry & Computation ─────────────────────────────────────

  describe('POST /api/results/bulk — enter marks and compute derived fields', () => {
    it('saves results and computes percentage, grade, status, and rank', async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord({ name: 'Class 10', section: 'A' });
      const studentA = await createStudentRecord({
        name: 'Alice',
        rollNo: 1,
        classId: classRecord._id,
      });
      const studentB = await createStudentRecord({
        name: 'Bob',
        rollNo: 2,
        classId: classRecord._id,
        parents: [
          { name: 'Bob Parent', relationship: 'father', phone: '9000000001', isWhatsapp: true },
        ],
      });
      const studentC = await createStudentRecord({
        name: 'Charlie',
        rollNo: 3,
        classId: classRecord._id,
        parents: [
          { name: 'Charlie Parent', relationship: 'father', phone: '9000000002', isWhatsapp: true },
        ],
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      // Create exam
      const examRes = await request(app)
        .post('/api/exams')
        .set(authHeaders)
        .send({
          name: 'Math Final',
          classId: classRecord._id.toString(),
          maxMarks: 100,
          passingMarks: 35,
          startDate: '2026-04-01',
          academicYear: '2025-26',
        })
        .expect(201);

      const examId = examRes.body._id;

      // Submit bulk results: Alice=92, Bob=45, Charlie=30
      const bulkRes = await request(app)
        .post('/api/results/bulk')
        .set(authHeaders)
        .send({
          examId,
          classId: classRecord._id.toString(),
          results: [
            { studentId: studentA._id.toString(), marksObtained: 92 },
            { studentId: studentB._id.toString(), marksObtained: 45 },
            { studentId: studentC._id.toString(), marksObtained: 30 },
          ],
        })
        .expect(200);

      expect(bulkRes.body).toMatchObject({
        message: 'Results saved successfully',
        count: 3,
      });

      // Verify persisted results from DB
      const results = await Result.find({ examId }).sort({ percentage: -1 }).lean();
      expect(results).toHaveLength(3);

      // Alice: 92/100 = 92% => grade A+, status passed, rank 1
      const aliceResult = results.find((r) => r.studentId.toString() === studentA._id.toString());
      expect(aliceResult.percentage).toBe(92);
      expect(aliceResult.grade).toBe('A+');
      expect(aliceResult.status).toBe('passed');
      expect(aliceResult.rank).toBe(1);

      // Bob: 45/100 = 45% => grade D (40-49 range), status passed (45 >= 35), rank 2
      const bobResult = results.find((r) => r.studentId.toString() === studentB._id.toString());
      expect(bobResult.percentage).toBe(45);
      expect(bobResult.grade).toBe('D');
      expect(bobResult.status).toBe('passed');
      expect(bobResult.rank).toBe(2);

      // Charlie: 30/100 = 30% => grade F, status failed (30 < 35), rank 3
      const charlieResult = results.find((r) => r.studentId.toString() === studentC._id.toString());
      expect(charlieResult.percentage).toBe(30);
      expect(charlieResult.grade).toBe('F');
      expect(charlieResult.status).toBe('failed');
      expect(charlieResult.rank).toBe(3);
    });

    it('assigns same rank to students with equal percentages (dense ranking)', async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord({ name: 'Class 9', section: 'A' });
      const studentA = await createStudentRecord({
        name: 'Tied Student A',
        rollNo: 1,
        classId: classRecord._id,
      });
      const studentB = await createStudentRecord({
        name: 'Tied Student B',
        rollNo: 2,
        classId: classRecord._id,
        parents: [
          { name: 'Tied Parent B', relationship: 'father', phone: '9100000001', isWhatsapp: true },
        ],
      });
      const studentC = await createStudentRecord({
        name: 'Lower Student C',
        rollNo: 3,
        classId: classRecord._id,
        parents: [
          { name: 'Lower Parent C', relationship: 'father', phone: '9100000002', isWhatsapp: true },
        ],
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const examRes = await request(app)
        .post('/api/exams')
        .set(authHeaders)
        .send({
          name: 'Tie Test Exam',
          classId: classRecord._id.toString(),
          maxMarks: 100,
          passingMarks: 35,
          startDate: '2026-04-05',
          academicYear: '2025-26',
        })
        .expect(201);

      const examId = examRes.body._id;

      // A and B both score 80, C scores 60
      await request(app)
        .post('/api/results/bulk')
        .set(authHeaders)
        .send({
          examId,
          classId: classRecord._id.toString(),
          results: [
            { studentId: studentA._id.toString(), marksObtained: 80 },
            { studentId: studentB._id.toString(), marksObtained: 80 },
            { studentId: studentC._id.toString(), marksObtained: 60 },
          ],
        })
        .expect(200);

      const results = await Result.find({ examId }).lean();

      const rankA = results.find((r) => r.studentId.toString() === studentA._id.toString()).rank;
      const rankB = results.find((r) => r.studentId.toString() === studentB._id.toString()).rank;
      const rankC = results.find((r) => r.studentId.toString() === studentC._id.toString()).rank;

      // Both A and B tied at rank 1
      expect(rankA).toBe(1);
      expect(rankB).toBe(1);
      // C gets rank 2 (dense ranking: no gap after the tie — see
      // computeAndSaveRanks in routes/academics.js).
      expect(rankC).toBe(2);
    });

    it('computes correct grade thresholds', async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord({ name: 'Class 7', section: 'A' });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      // Create multiple students for each grade bracket
      const gradeTests = [
        { marks: 95, expectedGrade: 'A+', expectedStatus: 'passed' },
        { marks: 85, expectedGrade: 'A', expectedStatus: 'passed' },
        { marks: 75, expectedGrade: 'B+', expectedStatus: 'passed' },
        { marks: 65, expectedGrade: 'B', expectedStatus: 'passed' },
        { marks: 50, expectedGrade: 'C', expectedStatus: 'passed' },
        { marks: 40, expectedGrade: 'D', expectedStatus: 'passed' },
        { marks: 25, expectedGrade: 'F', expectedStatus: 'failed' },
      ];

      const students = [];
      for (let i = 0; i < gradeTests.length; i++) {
        const student = await createStudentRecord({
          name: `Grade Student ${i}`,
          rollNo: i + 1,
          classId: classRecord._id,
          parents: [
            {
              name: 'Grade Parent',
              relationship: 'father',
              phone: `920000000${i}`,
              isWhatsapp: true,
            },
          ],
        });
        students.push(student);
      }

      const examRes = await request(app)
        .post('/api/exams')
        .set(authHeaders)
        .send({
          name: 'Grade Threshold Exam',
          classId: classRecord._id.toString(),
          maxMarks: 100,
          passingMarks: 35,
          startDate: '2026-04-10',
          academicYear: '2025-26',
        })
        .expect(201);

      const examId = examRes.body._id;

      await request(app)
        .post('/api/results/bulk')
        .set(authHeaders)
        .send({
          examId,
          classId: classRecord._id.toString(),
          results: students.map((student, i) => ({
            studentId: student._id.toString(),
            marksObtained: gradeTests[i].marks,
          })),
        })
        .expect(200);

      const results = await Result.find({ examId }).lean();

      for (let i = 0; i < gradeTests.length; i++) {
        const result = results.find((r) => r.studentId.toString() === students[i]._id.toString());
        expect(result.grade).toBe(gradeTests[i].expectedGrade);
        expect(result.status).toBe(gradeTests[i].expectedStatus);
      }
    });
  });

  // ─── Regression: absent status + custom passingMarks ─────────────────

  describe('POST /api/results/bulk — absent / passingMarks regressions', () => {
    it("preserves status:'absent' when submitted through bulk results (Zod no longer strips it)", async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord({ name: 'Class 8', section: 'A' });
      const student = await createStudentRecord({
        name: 'Absent Student',
        rollNo: 1,
        classId: classRecord._id,
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const examRes = await request(app)
        .post('/api/exams')
        .set(authHeaders)
        .send({
          name: 'Absent Test Exam',
          classId: classRecord._id.toString(),
          maxMarks: 100,
          passingMarks: 35,
          startDate: '2027-04-12',
          academicYear: '2025-26',
        })
        .expect(201);

      await request(app)
        .post('/api/results/bulk')
        .set(authHeaders)
        .send({
          examId: examRes.body._id,
          classId: classRecord._id.toString(),
          results: [{ studentId: student._id.toString(), marksObtained: 0, status: 'absent' }],
        })
        .expect(200);

      const saved = await Result.findOne({ studentId: student._id }).lean();
      expect(saved.status).toBe('absent');
    });

    it("respects exam.passingMarks below 33% — a 30% pass does NOT get flipped to 'failed' by the Result pre-save hook", async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord({ name: 'Class 9', section: 'A' });
      const student = await createStudentRecord({
        name: 'Custom Pass Student',
        rollNo: 1,
        classId: classRecord._id,
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      // Exam with a custom passing threshold of 25/100 — common for
      // competitive/practical exams.
      const examRes = await request(app)
        .post('/api/exams')
        .set(authHeaders)
        .send({
          name: 'Low-Threshold Exam',
          classId: classRecord._id.toString(),
          maxMarks: 100,
          passingMarks: 25,
          startDate: '2027-04-14',
          academicYear: '2025-26',
        })
        .expect(201);

      await request(app)
        .post('/api/results/bulk')
        .set(authHeaders)
        .send({
          examId: examRes.body._id,
          classId: classRecord._id.toString(),
          // 30 is below the old hardcoded 33% threshold, but above the
          // exam's real 25 passing mark — must be 'passed'.
          results: [{ studentId: student._id.toString(), marksObtained: 30 }],
        })
        .expect(200);

      const saved = await Result.findOne({ studentId: student._id }).lean();
      expect(saved.marksObtained).toBe(30);
      expect(saved.status).toBe('passed');
    });
  });

  // ─── Exam Publishing ─────────────────────────────────────────────────

  describe('POST /api/exams/:id/publish — publish exam and results', () => {
    it('sets exam.isPublished to true and publishes all associated results', async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord({ name: 'Class 10', section: 'B' });
      const student = await createStudentRecord({
        name: 'Publish Student',
        rollNo: 1,
        classId: classRecord._id,
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      // Create exam
      const examRes = await request(app)
        .post('/api/exams')
        .set(authHeaders)
        .send({
          name: 'Publish Test Exam',
          classId: classRecord._id.toString(),
          maxMarks: 100,
          passingMarks: 35,
          startDate: '2026-04-15',
          academicYear: '2025-26',
        })
        .expect(201);

      const examId = examRes.body._id;

      // Enter results
      await request(app)
        .post('/api/results/bulk')
        .set(authHeaders)
        .send({
          examId,
          classId: classRecord._id.toString(),
          results: [{ studentId: student._id.toString(), marksObtained: 75 }],
        })
        .expect(200);

      // Verify results are NOT published before publish action
      const beforePublish = await Result.findOne({ examId, studentId: student._id }).lean();
      expect(beforePublish.isPublished).toBe(false);

      // Publish the exam
      const publishRes = await request(app)
        .post(`/api/exams/${examId}/publish`)
        .set(authHeaders)
        .expect(200);

      expect(publishRes.body.isPublished).toBe(true);
      expect(publishRes.body.status).toBe('results_published');

      // Verify results are now published
      const afterPublish = await Result.findOne({ examId, studentId: student._id }).lean();
      expect(afterPublish.isPublished).toBe(true);

      // Published marks are immutable until the explicit unpublish workflow.
      const editRes = await request(app)
        .post('/api/results/bulk')
        .set(authHeaders)
        .send({
          examId,
          classId: classRecord._id.toString(),
          results: [{ studentId: student._id.toString(), marksObtained: 99 }],
        })
        .expect(409);
      expect(editRes.body.code).toBe('PUBLISHED_RESULTS_LOCKED');
      const unchanged = await Result.findOne({ examId, studentId: student._id }).lean();
      expect(unchanged.marksObtained).toBe(75);
    });

    it('keeps initialized rows pending and blocks publish until every active student is entered', async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord({ name: 'Class 11', section: 'A' });
      const students = await Promise.all([
        createStudentRecord({ name: 'Pending One', rollNo: 1, classId: classRecord._id }),
        createStudentRecord({ name: 'Pending Two', rollNo: 2, classId: classRecord._id }),
      ]);
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const examRes = await request(app)
        .post('/api/exams/create-with-results')
        .set(authHeaders)
        .send({
          name: 'Completion Gate Exam',
          classId: classRecord._id.toString(),
          maxMarks: 100,
          passingMarks: 35,
          startDate: '2026-05-15',
          academicYear: '2025-26',
        })
        .expect(201);

      const placeholders = await Result.find({ examId: examRes.body._id }).lean();
      expect(placeholders).toHaveLength(2);
      expect(placeholders.every((result) => result.marksObtained === null)).toBe(true);
      expect(placeholders.every((result) => result.status === 'pending')).toBe(true);

      const emptyPublish = await request(app)
        .post(`/api/exams/${examRes.body._id}/publish`)
        .set(authHeaders)
        .expect(409);
      expect(emptyPublish.body).toMatchObject({
        code: 'RESULTS_INCOMPLETE',
        entered: 0,
        expected: 2,
      });

      await request(app)
        .post('/api/results/bulk')
        .set(authHeaders)
        .send({
          examId: examRes.body._id,
          classId: classRecord._id.toString(),
          results: [{ studentId: students[0]._id.toString(), marksObtained: 60 }],
        })
        .expect(200);
      await request(app)
        .post(`/api/exams/${examRes.body._id}/publish`)
        .set(authHeaders)
        .expect(409);

      // An intentional zero is a completed result, not a placeholder.
      await request(app)
        .post('/api/results/bulk')
        .set(authHeaders)
        .send({
          examId: examRes.body._id,
          classId: classRecord._id.toString(),
          results: [{ studentId: students[1]._id.toString(), marksObtained: 0 }],
        })
        .expect(200);
      await request(app)
        .post(`/api/exams/${examRes.body._id}/publish`)
        .set(authHeaders)
        .expect(200);
    });

    it('does not revive a soft-deleted result during bulk upsert', async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord({ subjects: ['Math'] });
      const student = await createStudentRecord({
        name: 'Re-entry Student',
        rollNo: 1,
        classId: classRecord._id,
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');
      const examRes = await request(app)
        .post('/api/exams')
        .set(authHeaders)
        .send({
          name: 'Soft Delete Result Exam',
          classId: classRecord._id.toString(),
          maxMarks: 100,
          passingMarks: 35,
          startDate: '2026-06-01',
          academicYear: '2025-26',
        })
        .expect(201);

      const deleted = await Result.create({
        schoolId: classRecord.schoolId,
        examId: examRes.body._id,
        studentId: student._id,
        classId: classRecord._id,
        marksObtained: 20,
        maxMarks: 100,
        status: 'failed',
        isDeleted: true,
      });

      await request(app)
        .post('/api/results/bulk')
        .set(authHeaders)
        .send({
          examId: examRes.body._id,
          classId: classRecord._id.toString(),
          results: [{ studentId: student._id.toString(), marksObtained: 80 }],
        })
        .expect(200);

      const rows = await Result.find({ examId: examRes.body._id }).sort({ createdAt: 1 }).lean();
      expect(rows).toHaveLength(2);
      expect(rows.find((row) => String(row._id) === String(deleted._id))).toMatchObject({
        marksObtained: 20,
        isDeleted: true,
      });
      expect(rows.find((row) => !row.isDeleted)).toMatchObject({ marksObtained: 80 });
    });

    it('returns 404 when publishing a non-existent exam', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');
      const fakeId = '000000000000000000000000';

      await request(app).post(`/api/exams/${fakeId}/publish`).set(authHeaders).expect(404);
    });
  });

  // ─── Student Results Retrieval ────────────────────────────────────────

  describe('GET /api/results/class/:classId/exam/:examId — get results for class+exam', () => {
    it('returns results with all computed fields', async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord({ name: 'Class 10', section: 'C' });
      const student = await createStudentRecord({
        name: 'Retrieval Student',
        rollNo: 1,
        classId: classRecord._id,
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const examRes = await request(app)
        .post('/api/exams')
        .set(authHeaders)
        .send({
          name: 'Retrieval Exam',
          classId: classRecord._id.toString(),
          maxMarks: 100,
          passingMarks: 35,
          startDate: '2026-04-20',
          academicYear: '2025-26',
        })
        .expect(201);

      const examId = examRes.body._id;

      await request(app)
        .post('/api/results/bulk')
        .set(authHeaders)
        .send({
          examId,
          classId: classRecord._id.toString(),
          results: [{ studentId: student._id.toString(), marksObtained: 88 }],
        })
        .expect(200);

      const response = await request(app)
        .get(`/api/results/class/${classRecord._id.toString()}/exam/${examId}`)
        .set(authHeaders)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(1);
      expect(response.body[0]).toMatchObject({
        marksObtained: 88,
        maxMarks: 100,
        percentage: 88,
        grade: 'A',
        status: 'passed',
        rank: 1,
      });
    });
  });

  // ─── Mark Validation ─────────────────────────────────────────────────

  describe('mark validation (Issue #29)', () => {
    it('rejects marks exceeding maxMarks', async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord({ name: 'Class 6', section: 'A' });
      const student = await createStudentRecord({
        name: 'Overflow Student',
        rollNo: 1,
        classId: classRecord._id,
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const examRes = await request(app)
        .post('/api/exams')
        .set(authHeaders)
        .send({
          name: 'Validation Exam',
          classId: classRecord._id.toString(),
          maxMarks: 50,
          passingMarks: 20,
          startDate: '2026-05-01',
          academicYear: '2025-26',
        })
        .expect(201);

      const examId = examRes.body._id;

      const response = await request(app)
        .post('/api/results/bulk')
        .set(authHeaders)
        .send({
          examId,
          classId: classRecord._id.toString(),
          results: [{ studentId: student._id.toString(), marksObtained: 60 }],
        })
        .expect(400);

      expect(response.body.error).toMatch(/invalid marks/i);
    });

    it('rejects negative marks', async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord({ name: 'Class 5', section: 'A' });
      const student = await createStudentRecord({
        name: 'Negative Student',
        rollNo: 1,
        classId: classRecord._id,
      });
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const examRes = await request(app)
        .post('/api/exams')
        .set(authHeaders)
        .send({
          name: 'Negative Marks Exam',
          classId: classRecord._id.toString(),
          maxMarks: 100,
          passingMarks: 35,
          startDate: '2026-05-05',
          academicYear: '2025-26',
        })
        .expect(201);

      const examId = examRes.body._id;

      // Joi validation should catch min(0) - expect 400
      const response = await request(app)
        .post('/api/results/bulk')
        .set(authHeaders)
        .send({
          examId,
          classId: classRecord._id.toString(),
          results: [{ studentId: student._id.toString(), marksObtained: -5 }],
        })
        .expect(400);

      expect(response.body.error).toBeDefined();
    });
  });

  // ─── Multi-tenancy ────────────────────────────────────────────────────

  describe('multi-tenancy isolation', () => {
    it('school A admin cannot see school B exams', async () => {
      const schoolA = await createSchoolRecord({ name: 'School Alpha', code: 'SCH-ALPHA' });
      const schoolB = await createSchoolRecord({ name: 'School Beta', code: 'SCH-BETA' });

      const adminA = await createStaffUser({
        name: 'Admin School A',
        schoolId: schoolA._id,
      });
      const adminB = await createStaffUser({
        name: 'Admin School B',
        schoolId: schoolB._id,
      });

      const classB = await createClassRecord({
        name: 'Class B1',
        section: 'A',
        schoolId: schoolB._id,
      });

      const { app } = createTestApp();
      const authHeadersB = authHeadersFor(adminB, 'admin');

      // Admin B creates an exam scoped to school B
      await request(app)
        .post('/api/exams')
        .set(authHeadersB)
        .send({
          name: 'School B Exam',
          classId: classB._id.toString(),
          maxMarks: 100,
          passingMarks: 35,
          startDate: '2026-05-10',
          academicYear: '2025-26',
        })
        .expect(201);

      // Admin A from school A lists exams — should NOT see school B's exam
      const authHeadersA = authHeadersFor(adminA, 'admin');
      const response = await request(app).get('/api/exams').set(authHeadersA).expect(200);

      // PAG-10: response is { data, pagination } — pagination.total reflects
      // school-scoped count, so 0 confirms school isolation is intact.
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data).toHaveLength(0);
      expect(response.body.pagination).toMatchObject({ total: 0, hasMore: false });
    });

    it('school A admin cannot see school B results', async () => {
      const schoolA = await createSchoolRecord({ name: 'School Gamma', code: 'SCH-GAMMA' });
      const schoolB = await createSchoolRecord({ name: 'School Delta', code: 'SCH-DELTA' });

      const adminA = await createStaffUser({
        name: 'Admin Gamma',
        schoolId: schoolA._id,
      });
      const adminB = await createStaffUser({
        name: 'Admin Delta',
        schoolId: schoolB._id,
      });

      const classB = await createClassRecord({
        name: 'Class Delta',
        section: 'A',
        schoolId: schoolB._id,
      });
      const studentB = await createStudentRecord({
        name: 'Delta Student',
        rollNo: 1,
        classId: classB._id,
        schoolId: schoolB._id,
      });

      const { app } = createTestApp();
      const authHeadersB = authHeadersFor(adminB, 'admin');

      // Create exam and results in school B
      const examRes = await request(app)
        .post('/api/exams')
        .set(authHeadersB)
        .send({
          name: 'Delta Exam',
          classId: classB._id.toString(),
          maxMarks: 100,
          passingMarks: 35,
          startDate: '2026-05-15',
          academicYear: '2025-26',
        })
        .expect(201);

      const examId = examRes.body._id;

      await request(app)
        .post('/api/results/bulk')
        .set(authHeadersB)
        .send({
          examId,
          classId: classB._id.toString(),
          results: [{ studentId: studentB._id.toString(), marksObtained: 70 }],
        })
        .expect(200);

      // Admin A from school A tries to read school B's results
      const authHeadersA = authHeadersFor(adminA, 'admin');
      const response = await request(app)
        .get(`/api/results/class/${classB._id.toString()}/exam/${examId}`)
        .set(authHeadersA)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(0);
    });

    it('school A admin cannot publish school B exams', async () => {
      const schoolA = await createSchoolRecord({ name: 'School Epsilon', code: 'SCH-EPS' });
      const schoolB = await createSchoolRecord({ name: 'School Zeta', code: 'SCH-ZETA' });

      const adminA = await createStaffUser({
        name: 'Admin Epsilon',
        schoolId: schoolA._id,
      });
      const adminB = await createStaffUser({
        name: 'Admin Zeta',
        schoolId: schoolB._id,
      });

      const classB = await createClassRecord({
        name: 'Class Zeta',
        section: 'A',
        schoolId: schoolB._id,
      });

      const { app } = createTestApp();
      const authHeadersB = authHeadersFor(adminB, 'admin');

      const examRes = await request(app)
        .post('/api/exams')
        .set(authHeadersB)
        .send({
          name: 'Zeta Exam',
          classId: classB._id.toString(),
          maxMarks: 100,
          passingMarks: 35,
          startDate: '2026-05-20',
          academicYear: '2025-26',
        })
        .expect(201);

      const examId = examRes.body._id;

      // Admin A from school A tries to publish school B's exam
      const authHeadersA = authHeadersFor(adminA, 'admin');
      await request(app).post(`/api/exams/${examId}/publish`).set(authHeadersA).expect(404);

      // Verify exam is still not published
      const exam = await Exam.findById(examId).lean();
      expect(exam.isPublished).toBe(false);
    });
  });
});
