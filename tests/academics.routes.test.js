import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Exam, Result } from '../database.js';
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

  describe('GET /api/exams — list exams', () => {
    it('returns all exams for the school', async () => {
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

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(2);
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

      expect(response.body).toHaveLength(1);
      expect(response.body[0].name).toBe('2024 Final');
      expect(response.body[0].academicYear).toBe('2024-25');
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

      expect(response.body).toHaveLength(1);
      expect(response.body[0].name).toBe('Mid Term Maths');
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
      expect(response.body).toHaveLength(0);
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

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(0);
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
