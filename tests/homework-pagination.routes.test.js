import request from 'supertest';
import { describe, expect, it } from 'vitest';
import Homework from '../models/Homework.js';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

// PAG-08 — server pagination, server-side search, and the KPI stats endpoint
// for the Homework dashboard. Kept in a dedicated file so it doesn't collide
// with in-flight edits to the long-standing homework.routes.test.js.

function futureDateISO(daysFromNow = 7) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString();
}

function pastDateISO(daysAgo = 3) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

async function seedSchool(code) {
  const school = await createSchoolRecord({ name: `${code} School`, code, isDefault: true });
  const admin = await createStaffUser({ schoolId: school._id });
  const teacher = await createStaffUser({
    name: `${code} Teacher`,
    staffRole: ['Teacher'],
    permissionRole: 'teacher',
    schoolId: school._id,
  });
  const cls = await createClassRecord({ name: `${code} Class`, schoolId: school._id });
  const { app } = createTestApp();
  const authHeaders = authHeadersFor(admin, 'admin');
  return { school, admin, teacher, classRecord: cls, app, authHeaders };
}

async function insertHomework({ school, teacher, classRecord, ...overrides }) {
  return Homework.create({
    schoolId: school._id,
    title: 'Sample HW',
    description: 'Sample description',
    subject: 'Math',
    classId: classRecord._id,
    teacherId: teacher._id,
    dueDate: futureDateISO(5),
    status: 'active',
    ...overrides,
  });
}

describe('GET /api/homework — pagination (PAG-08)', () => {
  it('returns the requested page and accurate pagination metadata', async () => {
    const { school, teacher, classRecord, app, authHeaders } = await seedSchool('PGN-MAIN');
    await insertHomework({ school, teacher, classRecord, title: 'A', dueDate: futureDateISO(1) });
    await insertHomework({ school, teacher, classRecord, title: 'B', dueDate: futureDateISO(2) });
    await insertHomework({ school, teacher, classRecord, title: 'C', dueDate: futureDateISO(3) });

    const page1 = await request(app)
      .get('/api/homework?limit=2&page=1')
      .set(authHeaders)
      .expect(200);
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.pagination).toMatchObject({ page: 1, limit: 2, total: 3, totalPages: 2 });
    // Sorted by dueDate desc → C then B
    expect(page1.body.data[0].title).toBe('C');
    expect(page1.body.data[1].title).toBe('B');

    const page2 = await request(app)
      .get('/api/homework?limit=2&page=2')
      .set(authHeaders)
      .expect(200);
    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.data[0].title).toBe('A');
  });

  it('defaults page=1 and limit=25 when no query params are sent', async () => {
    const { school, teacher, classRecord, app, authHeaders } = await seedSchool('PGN-DEF');
    await insertHomework({ school, teacher, classRecord, title: 'One' });

    const res = await request(app).get('/api/homework').set(authHeaders).expect(200);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 25, total: 1, totalPages: 1 });
  });

  it('rejects a malformed page param with 400 (Zod validation)', async () => {
    const { app, authHeaders } = await seedSchool('PGN-INV');
    const res = await request(app)
      .get('/api/homework?page=not-a-number')
      .set(authHeaders)
      .expect(400);
    expect(JSON.stringify(res.body)).toMatch(/page/i);
  });
});

describe('GET /api/homework — server-side search (PAG-08)', () => {
  it('matches by title, subject, or description across the whole dataset', async () => {
    const { school, teacher, classRecord, app, authHeaders } = await seedSchool('SRCH-MAIN');
    await insertHomework({
      school,
      teacher,
      classRecord,
      title: 'Algebra Practice',
      subject: 'Math',
    });
    await insertHomework({
      school,
      teacher,
      classRecord,
      title: 'Essay Writing',
      subject: 'English',
    });
    await insertHomework({
      school,
      teacher,
      classRecord,
      title: 'Geometry',
      subject: 'Math',
      description: 'Worksheet on angles',
    });

    const byTitle = await request(app)
      .get('/api/homework?search=Algebra')
      .set(authHeaders)
      .expect(200);
    expect(byTitle.body.data).toHaveLength(1);
    expect(byTitle.body.pagination.total).toBe(1);

    // Search also matches the subject field
    const bySubject = await request(app)
      .get('/api/homework?search=English')
      .set(authHeaders)
      .expect(200);
    expect(bySubject.body.data).toHaveLength(1);
    expect(bySubject.body.data[0].title).toBe('Essay Writing');

    const byDesc = await request(app)
      .get('/api/homework?search=angles')
      .set(authHeaders)
      .expect(200);
    expect(byDesc.body.data).toHaveLength(1);
    expect(byDesc.body.data[0].title).toBe('Geometry');
  });

  it('treats regex metacharacters in the search term as literals', async () => {
    const { school, teacher, classRecord, app, authHeaders } = await seedSchool('SRCH-RGX');
    await insertHomework({ school, teacher, classRecord, title: 'Normal Title' });
    const res = await request(app).get('/api/homework?search=.*').set(authHeaders).expect(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('search is not bound to the current page — finds rows on later pages', async () => {
    const { school, teacher, classRecord, app, authHeaders } = await seedSchool('SRCH-PAGE');
    // 5 routine rows that should NOT match the search, then 1 row that does.
    for (let i = 0; i < 5; i += 1) {
      await insertHomework({
        school,
        teacher,
        classRecord,
        title: `Routine ${i}`,
        dueDate: futureDateISO(i + 1),
      });
    }
    await insertHomework({
      school,
      teacher,
      classRecord,
      title: 'Special Find',
      dueDate: futureDateISO(0),
    });

    // The matching row sits on page 1 of the search-filtered list (filter
    // narrows total to 1, so totalPages=1 — but the row IS reachable, which
    // is what this test guards: a client-side search would have seen only
    // the 2 rows on whatever page was loaded, missing the match entirely).
    const filtered = await request(app)
      .get('/api/homework?search=Special&limit=2&page=1')
      .set(authHeaders)
      .expect(200);
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0].title).toBe('Special Find');
    expect(filtered.body.pagination.total).toBe(1);

    // And the matching row is also findable when paginating the full list
    // (page 3 of 3, since 6 total rows / 2 per page = 3 pages).
    const unfiltered = await request(app)
      .get('/api/homework?limit=2&page=3')
      .set(authHeaders)
      .expect(200);
    const titles = unfiltered.body.data.map((hw) => hw.title);
    expect(titles).toContain('Special Find');
  });
});

describe('GET /api/homework/stats (PAG-08)', () => {
  it('requires authentication', async () => {
    const { app } = createTestApp();
    await request(app).get('/api/homework/stats').expect(401);
  });

  it('computes KPI counts over the full dataset, not just one page', async () => {
    const { school, teacher, classRecord, app, authHeaders } = await seedSchool('STATS-MAIN');
    const past = pastDateISO(2);
    const future = futureDateISO(5);

    // 2 active + future
    await insertHomework({ school, teacher, classRecord, title: 'A1', dueDate: future });
    await insertHomework({ school, teacher, classRecord, title: 'A2', dueDate: future });
    // 1 active + past → overdue
    await insertHomework({ school, teacher, classRecord, title: 'Ov1', dueDate: past });
    // 1 completed
    await insertHomework({
      school,
      teacher,
      classRecord,
      title: 'C1',
      status: 'completed',
      dueDate: past,
    });
    // 1 cancelled
    await insertHomework({
      school,
      teacher,
      classRecord,
      title: 'X1',
      status: 'cancelled',
      dueDate: past,
    });

    const res = await request(app).get('/api/homework/stats').set(authHeaders).expect(200);
    expect(res.body).toEqual({ total: 5, active: 3, completed: 1, cancelled: 1, overdue: 1 });
  });

  it('honors status and classId filters so the stats match the filtered table', async () => {
    const { school, teacher, classRecord, app, authHeaders } = await seedSchool('STATS-FILT');
    const future = futureDateISO(3);
    await insertHomework({ school, teacher, classRecord, title: 'A', dueDate: future });
    await insertHomework({
      school,
      teacher,
      classRecord,
      title: 'B',
      status: 'completed',
      dueDate: future,
    });

    const filtered = await request(app)
      .get(`/api/homework/stats?classId=${classRecord._id.toString()}&status=active`)
      .set(authHeaders)
      .expect(200);
    expect(filtered.body).toEqual({ total: 1, active: 1, completed: 0, cancelled: 0, overdue: 0 });
  });

  it("does not include another school's homework in the counts", async () => {
    const a = await seedSchool('STATS-A');
    const b = await seedSchool('STATS-B');
    await insertHomework({
      school: a.school,
      teacher: a.teacher,
      classRecord: a.classRecord,
      title: 'A',
    });
    await insertHomework({
      school: b.school,
      teacher: b.teacher,
      classRecord: b.classRecord,
      title: 'B',
    });

    const res = await request(a.app).get('/api/homework/stats').set(a.authHeaders).expect(200);
    expect(res.body).toEqual({ total: 1, active: 1, completed: 0, cancelled: 0, overdue: 0 });
  });
});
