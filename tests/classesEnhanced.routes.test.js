import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

// ─── GET /api/classes-enhanced/missing-subjects ───────────────────────────

describe('GET /api/classes-enhanced/missing-subjects', () => {
  it('returns 401 when unauthenticated', async () => {
    const { app } = createTestApp();
    await request(app).get('/api/classes-enhanced/missing-subjects').expect(401);
  });

  it('returns classes with no subjects', async () => {
    const admin = await createStaffUser();
    // Class without subjects
    await createClassRecord({ name: 'Empty Class', section: 'A', subjects: [] });
    // Class with subjects
    await createClassRecord({ name: 'Full Class', section: 'B', subjects: ['Math'] });

    const { app } = createTestApp();

    const response = await request(app)
      .get('/api/classes-enhanced/missing-subjects')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.classesWithMissingSubjects).toBe(1);
    expect(response.body.missingSubjects[0].className).toContain('Empty Class');
  });

  it('returns zero missing subjects when all classes have subjects', async () => {
    const admin = await createStaffUser();
    await createClassRecord({ subjects: ['Math', 'Science'] });

    const { app } = createTestApp();

    const response = await request(app)
      .get('/api/classes-enhanced/missing-subjects')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.classesWithMissingSubjects).toBe(0);
    expect(response.body.missingSubjects).toHaveLength(0);
  });
});

// ─── GET /api/classes-enhanced/:id/academic-performance ──────────────────

describe('GET /api/classes-enhanced/:id/academic-performance', () => {
  it('returns 401 when unauthenticated', async () => {
    const { app } = createTestApp();
    await request(app)
      .get('/api/classes-enhanced/000000000000000000000000/academic-performance')
      .expect(401);
  });

  it('returns performance stats for a class', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord();
    const { app } = createTestApp();

    const response = await request(app)
      .get(`/api/classes-enhanced/${cls._id}/academic-performance`)
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body).toMatchObject({
      classId: cls._id.toString(),
      classAverage: 0,
      totalStudentsEvaluated: 0,
    });
    expect(Array.isArray(response.body.topPerformers)).toBe(true);
    expect(Array.isArray(response.body.needImprovement)).toBe(true);
  });
});

// ─── GET /api/classes-enhanced/:id/fees-overview ─────────────────────────

describe('GET /api/classes-enhanced/:id/fees-overview', () => {
  it('returns 401 when unauthenticated', async () => {
    const { app } = createTestApp();
    await request(app)
      .get('/api/classes-enhanced/000000000000000000000000/fees-overview')
      .expect(401);
  });

  it('returns fee stats with zero counts for empty class', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord();
    const { app } = createTestApp();

    const response = await request(app)
      .get(`/api/classes-enhanced/${cls._id}/fees-overview`)
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body).toMatchObject({
      totalStudents: 0,
      paid: 0,
      unpaid: 0,
      partial: 0,
    });
  });
});

// ─── GET /api/classes-enhanced/:id/attendance-analytics ──────────────────

describe('GET /api/classes-enhanced/:id/attendance-analytics', () => {
  it('returns 401 when unauthenticated', async () => {
    const { app } = createTestApp();
    await request(app)
      .get('/api/classes-enhanced/000000000000000000000000/attendance-analytics')
      .expect(401);
  });

  it('returns analytics structure for a class', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord();
    const { app } = createTestApp();

    const response = await request(app)
      .get(`/api/classes-enhanced/${cls._id}/attendance-analytics`)
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body).toHaveProperty('mostAttentive');
    expect(response.body).toHaveProperty('lessAttentive');
    expect(response.body).toHaveProperty('classAverage');
  });
});

// ─── GET /api/classes-enhanced/:id/subjects ──────────────────────────────

describe('GET /api/classes-enhanced/:id/subjects', () => {
  it('returns 401 when unauthenticated', async () => {
    const { app } = createTestApp();
    await request(app).get('/api/classes-enhanced/000000000000000000000000/subjects').expect(401);
  });

  it('returns 404 when class does not exist', async () => {
    const admin = await createStaffUser();
    const { app } = createTestApp();

    await request(app)
      .get('/api/classes-enhanced/000000000000000000000000/subjects')
      .set(authHeadersFor(admin, 'admin'))
      .expect(404);
  });

  it('returns empty array for class with no chapter progress', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord();
    const { app } = createTestApp();

    const response = await request(app)
      .get(`/api/classes-enhanced/${cls._id}/subjects`)
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body).toHaveLength(0);
  });
});

// ─── POST /api/classes-enhanced/:id/subjects ─────────────────────────────

describe('POST /api/classes-enhanced/:id/subjects', () => {
  it('returns 401 when unauthenticated', async () => {
    const { app } = createTestApp();
    await request(app)
      .post('/api/classes-enhanced/000000000000000000000000/subjects')
      .send({ subjectName: 'Math' })
      .expect(401);
  });

  it('creates a subject/chapter progress entry', async () => {
    const admin = await createStaffUser();
    const teacher = await createStaffUser({ staffRole: ['Teacher'], permissionRole: 'teacher' });
    const cls = await createClassRecord({ subjects: ['Math'] });
    const { app } = createTestApp();

    const response = await request(app)
      .post(`/api/classes-enhanced/${cls._id}/subjects`)
      .set(authHeadersFor(admin, 'admin'))
      .send({
        subjectName: 'Math',
        teacherId: teacher._id.toString(),
        academicYear: '2025-26',
        chapters: [],
      })
      .expect(201);

    expect(response.body.subjectName).toBe('Math');
    expect(response.body.classId.toString()).toBe(cls._id.toString());
  });
});

// ─── GET /api/classes-enhanced/:id/activity-log ──────────────────────────

describe('GET /api/classes-enhanced/:id/activity-log', () => {
  it('returns 401 when unauthenticated', async () => {
    const { app } = createTestApp();
    await request(app)
      .get('/api/classes-enhanced/000000000000000000000000/activity-log')
      .expect(401);
  });

  it('returns empty array when no activity exists', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord();
    const { app } = createTestApp();

    const response = await request(app)
      .get(`/api/classes-enhanced/${cls._id}/activity-log`)
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body).toHaveLength(0);
  });
});

// ─── GET /api/classes-enhanced/:id/rating ────────────────────────────────

describe('GET /api/classes-enhanced/:id/rating', () => {
  it('returns 401 when unauthenticated', async () => {
    const { app } = createTestApp();
    await request(app).get('/api/classes-enhanced/000000000000000000000000/rating').expect(401);
  });

  it('returns 404 for non-existent class', async () => {
    const admin = await createStaffUser();
    const { app } = createTestApp();

    await request(app)
      .get('/api/classes-enhanced/000000000000000000000000/rating')
      .set(authHeadersFor(admin, 'admin'))
      .expect(404);
  });

  it('creates and returns a rating record for a class', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord();
    const { app } = createTestApp();

    const response = await request(app)
      .get(`/api/classes-enhanced/${cls._id}/rating`)
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.classId.toString()).toBe(cls._id.toString());
  });
});

// ─── Multi-tenancy ────────────────────────────────────────────────────────

describe('multi-tenancy isolation — classesEnhanced', () => {
  it('school A cannot see school B missing-subjects', async () => {
    const schoolA = await createSchoolRecord({ name: 'School CE-A', code: 'SCH-CE-A' });
    const schoolB = await createSchoolRecord({ name: 'School CE-B', code: 'SCH-CE-B' });

    const adminA = await createStaffUser({ schoolId: schoolA._id });

    // Create a class without subjects in school B
    await createClassRecord({ schoolId: schoolB._id, subjects: [] });

    const { app } = createTestApp();

    const response = await request(app)
      .get('/api/classes-enhanced/missing-subjects')
      .set(authHeadersFor(adminA, 'admin'))
      .expect(200);

    // School A admin should see 0 classes (from school A, which has none)
    expect(response.body.totalClasses).toBe(0);
  });
});
