import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Class } from '../database.js';
import { authHeadersFor, createClassRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

// ─── GET /api/class-settings/:id ─────────────────────────────────────────

describe('GET /api/class-settings/:id — get class settings', () => {
  it('returns 401 when unauthenticated', async () => {
    const { app } = createTestApp();
    await request(app).get('/api/class-settings/000000000000000000000000').expect(401);
  });

  it('returns 404 for non-existent class', async () => {
    const admin = await createStaffUser();
    const { app } = createTestApp();

    await request(app)
      .get('/api/class-settings/000000000000000000000000')
      .set(authHeadersFor(admin, 'admin'))
      .expect(404);
  });

  it('returns classTag and subjects for an existing class', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord({
      name: 'Class 10',
      section: 'A',
      subjects: ['Math', 'Science'],
    });
    const { app } = createTestApp();

    const response = await request(app)
      .get(`/api/class-settings/${cls._id}`)
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.className).toBe('Class 10 A');
    expect(Array.isArray(response.body.subjects)).toBe(true);
    expect(response.body.subjects).toContain('Math');
  });

  it('returns empty classTag when not set', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord();
    const { app } = createTestApp();

    const response = await request(app)
      .get(`/api/class-settings/${cls._id}`)
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.classTag).toBe('');
  });
});

// ─── PUT /api/class-settings/:id/tag ─────────────────────────────────────

describe('PUT /api/class-settings/:id/tag — update class tag', () => {
  it('returns 401 when unauthenticated', async () => {
    const { app } = createTestApp();
    await request(app)
      .put('/api/class-settings/000000000000000000000000/tag')
      .send({ classTag: 'Science Stream' })
      .expect(401);
  });

  it('returns 404 for non-existent class', async () => {
    const admin = await createStaffUser();
    const { app } = createTestApp();

    await request(app)
      .put('/api/class-settings/000000000000000000000000/tag')
      .set(authHeadersFor(admin, 'admin'))
      .send({ classTag: 'Tag' })
      .expect(404);
  });

  it('updates classTag successfully', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord();
    const { app } = createTestApp();

    const response = await request(app)
      .put(`/api/class-settings/${cls._id}/tag`)
      .set(authHeadersFor(admin, 'admin'))
      .send({ classTag: 'Science Stream' })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.classTag).toBe('Science Stream');

    // Verify persisted in DB
    const updated = await Class.findById(cls._id).lean();
    expect(updated.classTag).toBe('Science Stream');
  });

  it('rejects classTag longer than 50 characters', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord();
    const { app } = createTestApp();

    await request(app)
      .put(`/api/class-settings/${cls._id}/tag`)
      .set(authHeadersFor(admin, 'admin'))
      .send({ classTag: 'A'.repeat(51) })
      .expect(400);
  });

  it('clears classTag when empty string is sent', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord();
    const { app } = createTestApp();

    // Set a tag first
    await request(app)
      .put(`/api/class-settings/${cls._id}/tag`)
      .set(authHeadersFor(admin, 'admin'))
      .send({ classTag: 'Some Tag' })
      .expect(200);

    // Clear it
    const response = await request(app)
      .put(`/api/class-settings/${cls._id}/tag`)
      .set(authHeadersFor(admin, 'admin'))
      .send({ classTag: '' })
      .expect(200);

    expect(response.body.classTag).toBe('');
  });
});

// ─── PUT /api/class-settings/:id/subjects ────────────────────────────────

describe('PUT /api/class-settings/:id/subjects — update assigned subjects', () => {
  it('returns 401 when unauthenticated', async () => {
    const { app } = createTestApp();
    await request(app)
      .put('/api/class-settings/000000000000000000000000/subjects')
      .send({ subjects: ['Math'] })
      .expect(401);
  });

  it('returns 404 for non-existent class', async () => {
    const admin = await createStaffUser();
    const { app } = createTestApp();

    await request(app)
      .put('/api/class-settings/000000000000000000000000/subjects')
      .set(authHeadersFor(admin, 'admin'))
      .send({ subjects: ['Math'] })
      .expect(404);
  });

  it('returns 400 when subjects is not an array', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord();
    const { app } = createTestApp();

    await request(app)
      .put(`/api/class-settings/${cls._id}/subjects`)
      .set(authHeadersFor(admin, 'admin'))
      .send({ subjects: 'Math' })
      .expect(400);
  });

  it('returns 400 when subjects array is empty', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord();
    const { app } = createTestApp();

    await request(app)
      .put(`/api/class-settings/${cls._id}/subjects`)
      .set(authHeadersFor(admin, 'admin'))
      .send({ subjects: [] })
      .expect(400);
  });

  it('returns 400 when subjects contain non-string values', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord();
    const { app } = createTestApp();

    await request(app)
      .put(`/api/class-settings/${cls._id}/subjects`)
      .set(authHeadersFor(admin, 'admin'))
      .send({ subjects: ['Math', 123] })
      .expect(400);
  });

  it('updates both assignedSubjects and subjects fields', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord({ subjects: ['Math'] });
    const { app } = createTestApp();

    const response = await request(app)
      .put(`/api/class-settings/${cls._id}/subjects`)
      .set(authHeadersFor(admin, 'admin'))
      .send({ subjects: ['Math', 'Science', 'English'] })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.subjects).toEqual(['Math', 'Science', 'English']);
    expect(response.body.assignedSubjects).toEqual(['Math', 'Science', 'English']);

    // Verify persisted in DB
    const updated = await Class.findById(cls._id).lean();
    expect(updated.subjects).toEqual(['Math', 'Science', 'English']);
    expect(updated.assignedSubjects).toEqual(['Math', 'Science', 'English']);
  });
});
