import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Exam, ExamSchedule, Result, Student, SchoolSettings } from '../database.js';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';
import TrashItem from '../models/TrashItem.js';

// ─── Helpers ─────────────────────────────────────────────────────────────

async function makeSchedulePayload(classIds, overrides = {}) {
  return {
    name: 'Mid Term Exam Schedule',
    type: 'midterm',
    classIds: classIds.map((id) => id.toString()),
    startDate: '2026-04-01',
    endDate: '2026-04-15',
    sessionType: 'morning',
    defaultMaxMarks: 100,
    defaultPassingMarks: 35,
    academicYear: '2025-26',
    ...overrides,
  };
}

// ─── GET /api/exam-schedules ──────────────────────────────────────────────

describe('GET /api/exam-schedules — list exam schedules', () => {
  it('returns 401 when unauthenticated', async () => {
    const { app } = createTestApp();
    await request(app).get('/api/exam-schedules').expect(401);
  });

  it('returns empty array when no schedules exist', async () => {
    const admin = await createStaffUser();
    const { app } = createTestApp();

    const response = await request(app)
      .get('/api/exam-schedules')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body).toHaveLength(0);
  });
});

// ─── POST /api/exam-schedules ─────────────────────────────────────────────

describe('POST /api/exam-schedules — create exam schedule', () => {
  it('returns 401 when unauthenticated', async () => {
    const { app } = createTestApp();
    await request(app).post('/api/exam-schedules').send({}).expect(401);
  });

  it('returns 400 when classIds is empty', async () => {
    const admin = await createStaffUser();
    const { app } = createTestApp();

    await request(app)
      .post('/api/exam-schedules')
      .set(authHeadersFor(admin, 'admin'))
      .send({
        name: 'Bad Schedule',
        type: 'midterm',
        classIds: [],
        startDate: '2026-04-01',
        endDate: '2026-04-10',
      })
      .expect(400);
  });

  it('returns 400 when class has no subjects', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord({ subjects: [] });
    const { app } = createTestApp();

    await request(app)
      .post('/api/exam-schedules')
      .set(authHeadersFor(admin, 'admin'))
      .send(await makeSchedulePayload([cls._id]))
      .expect(400);
  });

  it('creates a draft schedule for classes with subjects', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord({ subjects: ['Math', 'Science'] });
    const { app } = createTestApp();

    const response = await request(app)
      .post('/api/exam-schedules')
      .set(authHeadersFor(admin, 'admin'))
      .send(await makeSchedulePayload([cls._id]))
      .expect(201);

    expect(response.body).toMatchObject({
      name: 'Mid Term Exam Schedule',
      status: 'draft',
    });
    expect(response.body._id).toBeDefined();
  });

  it('returns 409 when schedule name is duplicate in same academic year', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord({ subjects: ['Math'] });
    const { app } = createTestApp();
    const payload = await makeSchedulePayload([cls._id]);

    await request(app)
      .post('/api/exam-schedules')
      .set(authHeadersFor(admin, 'admin'))
      .send(payload)
      .expect(201);

    await request(app)
      .post('/api/exam-schedules')
      .set(authHeadersFor(admin, 'admin'))
      .send(payload)
      .expect(409);
  });
});

// ─── GET /api/exam-schedules/:id ─────────────────────────────────────────

describe('GET /api/exam-schedules/:id — get single exam schedule', () => {
  it('returns 404 for non-existent schedule', async () => {
    const admin = await createStaffUser();
    const { app } = createTestApp();

    await request(app)
      .get('/api/exam-schedules/000000000000000000000000')
      .set(authHeadersFor(admin, 'admin'))
      .expect(404);
  });

  it('returns the schedule with populated classIds', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord({ name: 'Class 9', section: 'B', subjects: ['History'] });
    const { app } = createTestApp();

    const createRes = await request(app)
      .post('/api/exam-schedules')
      .set(authHeadersFor(admin, 'admin'))
      .send(await makeSchedulePayload([cls._id]))
      .expect(201);

    const scheduleId = createRes.body._id;

    const response = await request(app)
      .get(`/api/exam-schedules/${scheduleId}`)
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body._id).toBe(scheduleId);
    expect(response.body.name).toBe('Mid Term Exam Schedule');
    expect(response.body.status).toBe('draft');
  });
});

// ─── PUT /api/exam-schedules/:id ─────────────────────────────────────────

describe('PUT /api/exam-schedules/:id — update draft schedule', () => {
  it('returns 401 when unauthenticated', async () => {
    const { app } = createTestApp();
    await request(app)
      .put('/api/exam-schedules/000000000000000000000000')
      .send({ name: 'Updated' })
      .expect(401);
  });

  it('returns 404 for non-existent schedule', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord({ subjects: ['Math'] });
    const { app } = createTestApp();

    await request(app)
      .put('/api/exam-schedules/000000000000000000000000')
      .set(authHeadersFor(admin, 'admin'))
      .send({ name: 'Updated', type: 'midterm', classIds: [cls._id.toString()] })
      .expect(404);
  });

  it('updates name on a draft schedule', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord({ subjects: ['Math'] });
    const { app } = createTestApp();

    const createRes = await request(app)
      .post('/api/exam-schedules')
      .set(authHeadersFor(admin, 'admin'))
      .send(await makeSchedulePayload([cls._id]))
      .expect(201);

    const scheduleId = createRes.body._id;

    const response = await request(app)
      .put(`/api/exam-schedules/${scheduleId}`)
      .set(authHeadersFor(admin, 'admin'))
      .send({ name: 'Updated Schedule Name', type: 'midterm', classIds: [cls._id.toString()] })
      .expect(200);

    expect(response.body.name).toBe('Updated Schedule Name');
  });
});

describe('POST /api/exam-schedules/:id/generate — school calendar policy', () => {
  it('uses a configured Sunday working day instead of hard-coding Sunday off', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord({ subjects: ['Math'] });
    const { app } = createTestApp();
    const headers = authHeadersFor(admin, 'admin');
    await SchoolSettings.create({ schoolId: admin.schoolId, workingDays: ['Sun'] });

    const created = await request(app)
      .post('/api/exam-schedules')
      .set(headers)
      .send(
        await makeSchedulePayload([cls._id], {
          name: 'Sunday Working Exam',
          startDate: '2026-04-05',
          endDate: '2026-04-05',
        })
      )
      .expect(201);

    const generated = await request(app)
      .post(`/api/exam-schedules/${created.body._id}/generate`)
      .set(headers)
      .send({})
      .expect(200);

    expect(generated.body.entries).toHaveLength(1);
    expect(generated.body.entries[0].date.slice(0, 10)).toBe('2026-04-05');
  });

  it('excludes configured holidays from available exam slots', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord({ subjects: ['Math'] });
    const { app } = createTestApp();
    const headers = authHeadersFor(admin, 'admin');
    await SchoolSettings.create({
      schoolId: admin.schoolId,
      workingDays: ['Sun'],
      holidays: [{ name: 'School Holiday', date: '2026-04-05', type: 'School' }],
    });

    const created = await request(app)
      .post('/api/exam-schedules')
      .set(headers)
      .send(
        await makeSchedulePayload([cls._id], {
          name: 'Holiday Exclusion Exam',
          startDate: '2026-04-05',
          endDate: '2026-04-05',
        })
      )
      .expect(201);

    const generated = await request(app)
      .post(`/api/exam-schedules/${created.body._id}/generate`)
      .set(headers)
      .send({})
      .expect(400);

    expect(generated.body.error).toBe('NOT_ENOUGH_SLOTS');
    expect(generated.body.available).toBe(0);
  });

  it('rechecks confirmed schedule conflicts immediately before generation', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord({ subjects: ['Math'] });
    const { app } = createTestApp();
    const headers = authHeadersFor(admin, 'admin');
    const payload = await makeSchedulePayload([cls._id], { name: 'Conflict Candidate' });
    const created = await request(app)
      .post('/api/exam-schedules')
      .set(headers)
      .send(payload)
      .expect(201);

    await ExamSchedule.create({
      ...payload,
      name: 'Confirmed Later',
      schoolId: admin.schoolId,
      classIds: [cls._id],
      status: 'scheduled',
      createdBy: admin._id,
    });

    const response = await request(app)
      .post(`/api/exam-schedules/${created.body._id}/generate`)
      .set(headers)
      .send({})
      .expect(409);

    expect(response.body.conflicts).toHaveLength(1);
  });
});

// ─── DELETE /api/exam-schedules/:id ──────────────────────────────────────

describe('DELETE /api/exam-schedules/:id — soft delete', () => {
  it('returns 401 when unauthenticated', async () => {
    const { app } = createTestApp();
    await request(app).delete('/api/exam-schedules/000000000000000000000000').expect(401);
  });

  it('soft deletes the schedule', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord({ subjects: ['Science'] });
    const { app } = createTestApp();

    const createRes = await request(app)
      .post('/api/exam-schedules')
      .set(authHeadersFor(admin, 'admin'))
      .send(await makeSchedulePayload([cls._id]))
      .expect(201);

    const scheduleId = createRes.body._id;

    await request(app)
      .delete(`/api/exam-schedules/${scheduleId}`)
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    // Verify it's soft-deleted
    const schedule = await ExamSchedule.findById(scheduleId).lean();
    expect(schedule.isDeleted).toBe(true);
    expect(schedule.deletedAt).toBeDefined();
  });

  it('returns 404 when deleting an already deleted schedule', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord({ subjects: ['Science'] });
    const { app } = createTestApp();

    const createRes = await request(app)
      .post('/api/exam-schedules')
      .set(authHeadersFor(admin, 'admin'))
      .send(await makeSchedulePayload([cls._id]))
      .expect(201);

    const scheduleId = createRes.body._id;

    await request(app)
      .delete(`/api/exam-schedules/${scheduleId}`)
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    await request(app)
      .delete(`/api/exam-schedules/${scheduleId}`)
      .set(authHeadersFor(admin, 'admin'))
      .expect(404);
  });
});

// ─── Multi-tenancy ────────────────────────────────────────────────────────

describe('multi-tenancy isolation', () => {
  it('school A admin cannot see school B exam schedules', async () => {
    const schoolA = await createSchoolRecord({ name: 'School A', code: 'SCH-ES-A' });
    const schoolB = await createSchoolRecord({ name: 'School B', code: 'SCH-ES-B' });

    const adminA = await createStaffUser({ schoolId: schoolA._id });
    const adminB = await createStaffUser({ schoolId: schoolB._id });

    const clsB = await createClassRecord({ schoolId: schoolB._id, subjects: ['Math'] });
    const { app } = createTestApp();

    // Admin B creates a schedule
    await request(app)
      .post('/api/exam-schedules')
      .set(authHeadersFor(adminB, 'admin'))
      .send(await makeSchedulePayload([clsB._id]))
      .expect(201);

    // Admin A should see empty list
    const response = await request(app)
      .get('/api/exam-schedules')
      .set(authHeadersFor(adminA, 'admin'))
      .expect(200);

    expect(response.body).toHaveLength(0);
  });
});

// ─── GET /api/exam-schedules/:id — generated exam result-entry progress ───

describe('GET /api/exam-schedules/:id — generated exam progress', () => {
  it('returns generatedExams with resultEntry progress scoped to the school', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord({
      name: 'Class 9',
      section: 'A',
      subjects: ['Math', 'Science'],
    });
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(admin, 'admin');

    // Create + confirm a schedule (this creates the Exam documents).
    const createRes = await request(app)
      .post('/api/exam-schedules')
      .set(authHeaders)
      .send(await makeSchedulePayload([cls._id]))
      .expect(201);
    const scheduleId = createRes.body._id;

    await request(app)
      .post(`/api/exam-schedules/${scheduleId}/generate`)
      .set(authHeaders)
      .expect(200);
    await request(app)
      .post(`/api/exam-schedules/${scheduleId}/confirm`)
      .set(authHeaders)
      .expect(200);

    // Enroll 4 active students in the class — that's the denominator.
    const students = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        createStudentRecord({
          name: `Student ${n}`,
          rollNo: n,
          classId: cls._id,
          schoolId: cls.schoolId,
        })
      )
    );

    // Fetch the generated exams so we can attach results to one of them.
    const exams = await Exam.find({ examScheduleId: scheduleId }).lean();
    expect(exams.length).toBeGreaterThan(0);
    const targetExam = exams[0];

    // 2 of 4 students have marks entered for the target exam.
    await Result.create([
      {
        schoolId: cls.schoolId,
        examId: targetExam._id,
        studentId: students[0]._id,
        classId: cls._id,
        marksObtained: 80,
        maxMarks: 100,
        status: 'passed',
      },
      {
        schoolId: cls.schoolId,
        examId: targetExam._id,
        studentId: students[1]._id,
        classId: cls._id,
        marksObtained: 45,
        maxMarks: 100,
        status: 'passed',
      },
    ]);

    // A soft-deleted result must NOT count toward "entered".
    await Result.create({
      schoolId: cls.schoolId,
      examId: targetExam._id,
      studentId: students[2]._id,
      classId: cls._id,
      marksObtained: 30,
      maxMarks: 100,
      status: 'failed',
      isDeleted: true,
    });

    const detail = await request(app)
      .get(`/api/exam-schedules/${scheduleId}`)
      .set(authHeaders)
      .expect(200);

    expect(Array.isArray(detail.body.generatedExams)).toBe(true);
    expect(detail.body.generatedExams.length).toBe(exams.length);

    const targetRow = detail.body.generatedExams.find(
      (e) => String(e._id) === String(targetExam._id)
    );
    expect(targetRow).toBeDefined();
    expect(targetRow.className).toBe('Class 9-A');
    // total = 4 active students, entered = 2 (soft-deleted result excluded)
    expect(targetRow.resultEntry).toEqual({ total: 4, entered: 2 });
  });

  it('returns an empty generatedExams array for a draft schedule with no exams', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord({ subjects: ['Math'] });
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(admin, 'admin');

    const createRes = await request(app)
      .post('/api/exam-schedules')
      .set(authHeaders)
      .send(await makeSchedulePayload([cls._id]))
      .expect(201);

    const detail = await request(app)
      .get(`/api/exam-schedules/${createRes.body._id}`)
      .set(authHeaders)
      .expect(200);

    expect(Array.isArray(detail.body.generatedExams)).toBe(true);
    expect(detail.body.generatedExams).toHaveLength(0);
  });
});

describe('POST /api/exam-schedules/:id/confirm — atomicity and tenant references', () => {
  it('rolls back every generated exam when one class conflicts', async () => {
    const admin = await createStaffUser();
    const classA = await createClassRecord({ name: 'Class A', section: 'A', subjects: ['Math'] });
    const classB = await createClassRecord({ name: 'Class B', section: 'A', subjects: ['Math'] });
    const { app } = createTestApp();
    const headers = authHeadersFor(admin, 'admin');

    const createRes = await request(app)
      .post('/api/exam-schedules')
      .set(headers)
      .send(await makeSchedulePayload([classA._id, classB._id], { name: 'Atomic Schedule' }))
      .expect(201);
    await request(app)
      .post(`/api/exam-schedules/${createRes.body._id}/generate`)
      .set(headers)
      .expect(200);

    // Force a duplicate for one selected class. Confirmation may start
    // creating the other class first, but the transaction must roll it back.
    await Exam.create({
      schoolId: classB.schoolId,
      name: 'Atomic Schedule',
      type: 'midterm',
      classId: classB._id,
      academicYear: '2025-26',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2026-04-15'),
      maxMarks: 100,
      passingMarks: 35,
      status: 'scheduled',
    });

    await request(app)
      .post(`/api/exam-schedules/${createRes.body._id}/confirm`)
      .set(headers)
      .expect(409);

    expect(await Exam.countDocuments({ examScheduleId: createRes.body._id })).toBe(0);
    const unchangedSchedule = await ExamSchedule.findById(createRes.body._id).lean();
    expect(unchangedSchedule.status).toBe('draft');
    expect(unchangedSchedule.generatedExamIds).toHaveLength(0);
  });

  it('rejects a tampered entry that references another school class', async () => {
    const schoolA = await createSchoolRecord({ name: 'Schedule School A', code: 'SCH-SA' });
    const schoolB = await createSchoolRecord({ name: 'Schedule School B', code: 'SCH-SB' });
    const adminA = await createStaffUser({ schoolId: schoolA._id });
    const classA = await createClassRecord({ schoolId: schoolA._id, subjects: ['Math'] });
    const classB = await createClassRecord({ schoolId: schoolB._id, subjects: ['Math'] });
    const { app } = createTestApp();
    const headers = authHeadersFor(adminA, 'admin');

    const createRes = await request(app)
      .post('/api/exam-schedules')
      .set(headers)
      .send(await makeSchedulePayload([classA._id], { name: 'Tenant Safe Schedule' }))
      .expect(201);
    await request(app)
      .post(`/api/exam-schedules/${createRes.body._id}/generate`)
      .set(headers)
      .expect(200);

    // Simulate legacy/corrupt data that bypassed route validation.
    await ExamSchedule.updateOne(
      { _id: createRes.body._id },
      { $set: { 'entries.0.classIds': [classB._id] } }
    );

    await request(app)
      .post(`/api/exam-schedules/${createRes.body._id}/confirm`)
      .set(headers)
      .expect(400);
    expect(await Exam.countDocuments({ examScheduleId: createRes.body._id })).toBe(0);
  });
});

describe('DELETE /api/exam-schedules/:id — restorable cascade', () => {
  it('restores the schedule and only children archived by the same delete transaction', async () => {
    const school = await createSchoolRecord({ name: 'Schedule Restore School', code: 'SCH-RST' });
    const admin = await createStaffUser({ schoolId: school._id });
    const cls = await createClassRecord({ schoolId: school._id, subjects: ['Math'] });
    const [activeStudent, oldDeletedStudent] = await Promise.all([
      createStudentRecord({
        schoolId: school._id,
        classId: cls._id,
        name: 'Schedule Active Student',
        rollNo: 11,
      }),
      createStudentRecord({
        schoolId: school._id,
        classId: cls._id,
        name: 'Schedule Old Student',
        rollNo: 12,
      }),
    ]);
    const schedule = await ExamSchedule.create({
      schoolId: school._id,
      name: 'Restorable Confirmed Schedule',
      classIds: [cls._id],
      startDate: new Date('2026-06-01'),
      endDate: new Date('2026-06-02'),
      academicYear: '2025-26',
      status: 'scheduled',
    });
    const exam = await Exam.create({
      schoolId: school._id,
      name: schedule.name,
      classId: cls._id,
      subjectName: 'Math',
      academicYear: '2025-26',
      startDate: schedule.startDate,
      examScheduleId: schedule._id,
    });
    schedule.generatedExamIds = [exam._id];
    await schedule.save();
    const oldDeletedAt = new Date('2025-02-01T00:00:00.000Z');
    await Result.create([
      {
        schoolId: school._id,
        examId: exam._id,
        studentId: activeStudent._id,
        classId: cls._id,
        marksObtained: 75,
        maxMarks: 100,
        status: 'passed',
      },
      {
        schoolId: school._id,
        examId: exam._id,
        studentId: oldDeletedStudent._id,
        classId: cls._id,
        marksObtained: 55,
        maxMarks: 100,
        status: 'passed',
        isDeleted: true,
        deletedAt: oldDeletedAt,
      },
    ]);

    const { app } = createTestApp();
    const headers = authHeadersFor(admin, 'admin');
    await request(app).delete(`/api/exam-schedules/${schedule._id}`).set(headers).expect(200);
    expect((await Exam.findById(exam._id).lean()).isDeleted).toBe(true);
    const trashItem = await TrashItem.findOne({ itemType: 'ExamSchedule', itemId: schedule._id });
    expect(trashItem?.deletionContext?.cascadeDeletedAt).toBeTruthy();

    await request(app).post(`/api/trash/${trashItem._id}/restore`).set(headers).expect(200);

    expect((await ExamSchedule.findById(schedule._id).lean()).isDeleted).toBe(false);
    expect((await Exam.findById(exam._id).lean()).isDeleted).toBe(false);
    expect(
      (await Result.findOne({ studentId: activeStudent._id, examId: exam._id }).lean()).isDeleted
    ).toBe(false);
    const stillDeleted = await Result.findOne({
      studentId: oldDeletedStudent._id,
      examId: exam._id,
    }).lean();
    expect(stillDeleted.isDeleted).toBe(true);
    expect(stillDeleted.deletedAt.toISOString()).toBe(oldDeletedAt.toISOString());

    await request(app).delete(`/api/exam-schedules/${schedule._id}`).set(headers).expect(200);
    const secondTrashItem = await TrashItem.findOne({
      itemType: 'ExamSchedule',
      itemId: schedule._id,
    });
    await request(app).delete(`/api/trash/${secondTrashItem._id}`).set(headers).expect(200);
    expect(await ExamSchedule.findById(schedule._id)).toBeNull();
    expect(await Exam.findById(exam._id)).toBeNull();
    expect(await Result.countDocuments({ examId: exam._id })).toBe(0);
  });
});
