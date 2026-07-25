import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { SchoolSettings } from '../database.js';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

// ─── Helpers ─────────────────────────────────────────────────────────────

let seq = 0;
async function setupSchoolWithAdmin(tag = 'C') {
  seq += 1;
  const school = await createSchoolRecord({
    name: `${tag} School ${seq}`,
    code: `${tag}${seq}`.toUpperCase(),
  });
  const admin = await createStaffUser({
    name: `${tag} Admin ${seq}`,
    email: `${tag.toLowerCase()}.admin.${seq}@example.com`,
    schoolId: school._id,
    staffRole: ['Admin'],
    permissionRole: 'admin',
  });
  return { school, admin };
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('curricula routes', () => {
  describe('authentication', () => {
    it('returns 401 for GET /api/v1/curricula without auth', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/v1/curricula').expect(401);
    });

    it('returns 401 for GET /api/v1/curricula/:id without auth', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/v1/curricula/cbse').expect(401);
    });
  });

  describe('GET /api/v1/curricula', () => {
    it('lists all bundled curricula with id, name, and grade count', async () => {
      const { school, admin } = await setupSchoolWithAdmin('LIST');
      const { app } = createTestApp();

      const res = await request(app)
        .get('/api/v1/curricula')
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);

      const ids = res.body.curricula.map((c) => c.id);
      expect(ids).toEqual(expect.arrayContaining(['cbse', 'icse', 'ib', 'igcse', 'tamilNadu']));
      const cbse = res.body.curricula.find((c) => c.id === 'cbse');
      expect(cbse).toMatchObject({ id: 'cbse', gradeCount: 12 });
      expect(typeof cbse.name).toBe('string');
      // Lightweight payload must not include the full per-grade subject map.
      expect(cbse.grades).toBeUndefined();
      expect(school).toBeDefined();
    });
  });

  describe('GET /api/v1/curricula/:id', () => {
    it('returns the full curriculum with per-grade subjects', async () => {
      const { admin } = await setupSchoolWithAdmin('ONE');
      const { app } = createTestApp();

      const res = await request(app)
        .get('/api/v1/curricula/tamilNadu')
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);

      expect(res.body.id).toBe('tamilNadu');
      expect(res.body.grades['6']).toEqual(
        expect.arrayContaining(['Tamil', 'English', 'Mathematics', 'Science', 'Social Science'])
      );
    });

    it('returns 404 for an unknown curriculum id', async () => {
      const { admin } = await setupSchoolWithAdmin('MISS');
      const { app } = createTestApp();

      await request(app)
        .get('/api/v1/curricula/nope')
        .set(authHeadersFor(admin, 'admin'))
        .expect(404);
    });
  });

  describe('GET /api/v1/curricula/:id/grades/:grade/subjects', () => {
    it('returns subjects for a numeric grade (string)', async () => {
      const { admin } = await setupSchoolWithAdmin('GRD');
      const { app } = createTestApp();

      const res = await request(app)
        .get('/api/v1/curricula/cbse/grades/1/subjects')
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);

      expect(res.body.subjects).toEqual(
        expect.arrayContaining(['English', 'Hindi', 'Mathematics', 'EVS'])
      );
    });

    it('returns [] for a non-numeric grade token like Nursery', async () => {
      const { admin } = await setupSchoolWithAdmin('NON');
      const { app } = createTestApp();

      const res = await request(app)
        .get('/api/v1/curricula/cbse/grades/Nursery/subjects')
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);

      expect(res.body.subjects).toEqual([]);
    });

    it('returns 404 when the curriculum is unknown', async () => {
      const { admin } = await setupSchoolWithAdmin('GNF');
      const { app } = createTestApp();

      await request(app)
        .get('/api/v1/curricula/nope/grades/5/subjects')
        .set(authHeadersFor(admin, 'admin'))
        .expect(404);
    });
  });
});

describe('POST /api/v1/settings/subjects/import-curriculum', () => {
  it('requires authentication', async () => {
    const { app } = createTestApp();
    await request(app)
      .post('/api/v1/settings/subjects/import-curriculum')
      .send({ curriculumId: 'cbse' })
      .expect(401);
  });

  it('appends new subjects and syncs to matching classes', async () => {
    const { school, admin } = await setupSchoolWithAdmin('IMP');
    const { app } = createTestApp();

    // A class whose name parses to grade 5, so syncSubjectsToClasses will
    // pick up grade-5 subjects from the freshly imported curriculum.
    await SchoolSettings.create({ schoolId: school._id, name: school.name });

    const res = await request(app)
      .post('/api/v1/settings/subjects/import-curriculum')
      .set(authHeadersFor(admin, 'admin'))
      .send({ curriculumId: 'cbse', grades: [1, 2] })
      .expect(200);

    expect(res.body.imported).toBeGreaterThan(0);
    expect(res.body.merged).toBe(0);
    const names = res.body.subjects.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['English', 'Mathematics', 'EVS']));

    // Each imported subject must carry the grades we requested.
    const math = res.body.subjects.find((s) => s.name === 'Mathematics');
    expect(math.assignedClasses).toEqual([1, 2]);
  });

  it('merges into an existing subject instead of duplicating, unioning assignedClasses', async () => {
    const { school, admin } = await setupSchoolWithAdmin('MRG');
    const { app } = createTestApp();

    // Seed the master directory with a pre-existing Mathematics on grade 3.
    await SchoolSettings.create({
      schoolId: school._id,
      name: school.name,
      subjects: [{ name: 'Mathematics', code: 'MAT', assignedClasses: [3] }],
    });

    const res = await request(app)
      .post('/api/v1/settings/subjects/import-curriculum')
      .set(authHeadersFor(admin, 'admin'))
      .send({ curriculumId: 'cbse', grades: [1, 2] })
      .expect(200);

    // No second Mathematics should appear.
    const maths = res.body.subjects.filter((s) => s.name.toLowerCase() === 'mathematics');
    expect(maths).toHaveLength(1);
    // Union of [3] (existing) and [1,2] (incoming) → [1,2,3].
    expect(maths[0].assignedClasses).toEqual([1, 2, 3]);
    // The existing subject's code is preserved.
    expect(maths[0].code).toBe('MAT');
    expect(res.body.merged).toBeGreaterThanOrEqual(1);
  });

  it('returns 404 for an unknown curriculum id', async () => {
    const { admin } = await setupSchoolWithAdmin('NF');
    const { app } = createTestApp();

    await request(app)
      .post('/api/v1/settings/subjects/import-curriculum')
      .set(authHeadersFor(admin, 'admin'))
      .send({ curriculumId: 'nope' })
      .expect(404);
  });
});
