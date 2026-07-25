import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ExamSchedule } from '../database.js';
import {
  authHeadersFor,
  createClassRecord,
  createStaffUser,
  createStudentRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

// Build a draft schedule with one generated paper (entry) for the given class.
async function seedScheduleWithEntry(klass, { studentCount = 3 } = {}) {
  for (let i = 0; i < studentCount; i++) {
    await createStudentRecord({
      name: `Pupil ${i + 1}`,
      classId: klass._id,
      schoolId: klass.schoolId,
    });
  }
  return ExamSchedule.create({
    schoolId: klass.schoolId,
    name: 'Seating Test Exam',
    type: 'midterm',
    classIds: [klass._id],
    startDate: new Date('2026-04-01'),
    endDate: new Date('2026-04-15'),
    sessionType: 'morning',
    status: 'draft',
    entries: [
      {
        date: new Date('2026-04-02'),
        session: 'morning',
        subjectName: 'Math',
        classIds: [klass._id],
        maxMarks: 100,
      },
    ],
  });
}

describe('POST /api/exam-schedules/:id/seat — classroom venues', () => {
  it('requires authentication', async () => {
    const { app } = createTestApp();
    await request(app).post('/api/exam-schedules/000000000000000000000000/seat').expect(401);
  });

  it('seats students in their own classroom when no exam halls exist (one per desk)', async () => {
    const { app } = createTestApp();
    const admin = await createStaffUser();
    const klass = await createClassRecord({ name: 'Class 5', section: 'A', subjects: ['Math'] });
    const schedule = await seedScheduleWithEntry(klass, { studentCount: 3 });

    const res = await request(app)
      .post(`/api/exam-schedules/${schedule._id}/seat`)
      .set(authHeadersFor(admin, 'admin'))
      .send({})
      .expect(200);

    // Response shape: venue snapshot + stats reflecting the classroom venue.
    expect(res.body.seatingStats.venues).toBe(1);
    expect(res.body.seatingStats.classrooms).toBe(1);
    expect(res.body.seatingStats.totalSeated).toBe(3);
    expect(res.body.seatingStats.shareBenches).toBe(false);
    expect(res.body.seatingVenues).toHaveLength(1);
    expect(res.body.seatingVenues[0].kind).toBe('classroom');

    // Every student is on their own bench, in the classroom, seat 0.
    const seating = res.body.entries[0].seating;
    expect(seating).toHaveLength(3);
    expect(seating.every((s) => s.venueKind === 'classroom')).toBe(true);
    expect(seating.every((s) => s.seatInBench === 0)).toBe(true);
    expect(new Set(seating.map((s) => s.benchIndex)).size).toBe(3);
  });

  it('persists the shareBenches option onto the schedule', async () => {
    const { app } = createTestApp();
    const admin = await createStaffUser();
    const klass = await createClassRecord({ name: 'Class 6', section: 'B', subjects: ['Math'] });
    const schedule = await seedScheduleWithEntry(klass, { studentCount: 2 });

    const res = await request(app)
      .post(`/api/exam-schedules/${schedule._id}/seat`)
      .set(authHeadersFor(admin, 'admin'))
      .send({ shareBenches: true })
      .expect(200);

    expect(res.body.seatingStats.shareBenches).toBe(true);
    const saved = await ExamSchedule.findById(schedule._id).lean();
    expect(saved.seatingOptions.shareBenches).toBe(true);
  });

  it('400s when the schedule has no generated timetable yet', async () => {
    const { app } = createTestApp();
    const admin = await createStaffUser();
    const klass = await createClassRecord({ name: 'Class 7', section: 'A', subjects: ['Math'] });
    const schedule = await ExamSchedule.create({
      schoolId: klass.schoolId,
      name: 'No Entries Exam',
      type: 'midterm',
      classIds: [klass._id],
      startDate: new Date('2026-04-01'),
      endDate: new Date('2026-04-15'),
      status: 'draft',
      entries: [],
    });

    await request(app)
      .post(`/api/exam-schedules/${schedule._id}/seat`)
      .set(authHeadersFor(admin, 'admin'))
      .send({})
      .expect(400);
  });
});
