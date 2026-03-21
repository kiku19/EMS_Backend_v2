import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ExamSchedule } from '../database.js';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

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
