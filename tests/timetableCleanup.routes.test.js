import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Timetable, Staff } from '../database.js';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

// ─── GET /api/timetable-cleanup/preview ──────────────────────────────────

describe('GET /api/timetable-cleanup/preview — preview cleanup data', () => {
  it('returns 401 when unauthenticated', async () => {
    const { app } = createTestApp();
    await request(app).get('/api/timetable-cleanup/preview').expect(401);
  });

  it('returns counts structure when no data exists', async () => {
    const admin = await createStaffUser();
    const { app } = createTestApp();

    const response = await request(app)
      .get('/api/timetable-cleanup/preview')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.counts).toMatchObject({
      classTimetables: 0,
      teacherTimetables: 0,
      conflictLogs: 0,
      substitutions: 0,
      staffWithAssignments: 0,
      classesWithTeachers: 0,
    });
    expect(Array.isArray(response.body.sampleData.timetables)).toBe(true);
    expect(Array.isArray(response.body.sampleData.staffAssignments)).toBe(true);
  });
});

// ─── POST /api/timetable-cleanup/execute ─────────────────────────────────

describe('POST /api/timetable-cleanup/execute — execute cleanup', () => {
  it('returns 401 when unauthenticated', async () => {
    const { app } = createTestApp();
    await request(app).post('/api/timetable-cleanup/execute').send({}).expect(401);
  });

  it('executes cleanup and returns results', async () => {
    const admin = await createStaffUser();
    const { app } = createTestApp();

    const response = await request(app)
      .post('/api/timetable-cleanup/execute')
      .set(authHeadersFor(admin, 'admin'))
      .send({ options: { timetables: true, teacherTimetables: true } })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.results).toBeDefined();
    expect(response.body.results.deleted).toBeDefined();
  });

  it('deletes timetables scoped to the authenticated school', async () => {
    const schoolA = await createSchoolRecord({ name: 'School Cleanup A', code: 'SCH-CL-A' });
    const schoolB = await createSchoolRecord({ name: 'School Cleanup B', code: 'SCH-CL-B' });

    const adminA = await createStaffUser({ schoolId: schoolA._id });
    const clsA = await createClassRecord({ schoolId: schoolA._id });
    const clsB = await createClassRecord({ schoolId: schoolB._id });

    // Insert timetable records for both schools directly
    await Timetable.create({ schoolId: schoolA._id, classId: clsA._id, academicYear: '2025-26' });
    await Timetable.create({ schoolId: schoolB._id, classId: clsB._id, academicYear: '2025-26' });

    const { app } = createTestApp();

    await request(app)
      .post('/api/timetable-cleanup/execute')
      .set(authHeadersFor(adminA, 'admin'))
      .send({ options: { timetables: true } })
      .expect(200);

    // School A timetable should be deleted
    const remainingA = await Timetable.countDocuments({ schoolId: schoolA._id });
    expect(remainingA).toBe(0);

    // School B timetable should still exist
    const remainingB = await Timetable.countDocuments({ schoolId: schoolB._id });
    expect(remainingB).toBe(1);
  });
});

// ─── POST /api/timetable-cleanup/reset-staff/:staffId ────────────────────

describe('POST /api/timetable-cleanup/reset-staff/:staffId — reset staff assignments', () => {
  it('returns 401 when unauthenticated', async () => {
    const { app } = createTestApp();
    await request(app)
      .post('/api/timetable-cleanup/reset-staff/000000000000000000000000')
      .expect(401);
  });

  it('returns 404 for non-existent staff', async () => {
    const admin = await createStaffUser();
    const { app } = createTestApp();

    await request(app)
      .post('/api/timetable-cleanup/reset-staff/000000000000000000000000')
      .set(authHeadersFor(admin, 'admin'))
      .expect(404);
  });

  it('clears teacher assignments for staff in the same school', async () => {
    const admin = await createStaffUser();
    const teacher = await createStaffUser({ staffRole: ['Teacher'], permissionRole: 'teacher' });

    // Give the teacher some assignments
    await Staff.findByIdAndUpdate(teacher._id, {
      teacherAssignments: [{ classId: '000000000000000000000001', subject: 'Math' }],
      isClassTeacher: true,
    });

    const { app } = createTestApp();

    const response = await request(app)
      .post(`/api/timetable-cleanup/reset-staff/${teacher._id}`)
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.staff.id).toBe(teacher._id.toString());

    // Verify assignments are cleared
    const updatedTeacher = await Staff.findById(teacher._id).lean();
    expect(updatedTeacher.teacherAssignments).toHaveLength(0);
    expect(updatedTeacher.isClassTeacher).toBe(false);
  });

  it('returns 404 when staff belongs to a different school', async () => {
    const schoolA = await createSchoolRecord({ name: 'School RS-A', code: 'SCH-RS-A' });
    const schoolB = await createSchoolRecord({ name: 'School RS-B', code: 'SCH-RS-B' });

    const adminA = await createStaffUser({ schoolId: schoolA._id });
    const teacherB = await createStaffUser({
      schoolId: schoolB._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });

    const { app } = createTestApp();

    // Admin A tries to reset school B's teacher
    await request(app)
      .post(`/api/timetable-cleanup/reset-staff/${teacherB._id}`)
      .set(authHeadersFor(adminA, 'admin'))
      .expect(404);
  });
});
