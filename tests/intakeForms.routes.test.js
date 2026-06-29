import request from 'supertest';
import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { IntakeForm, FormSubmission } from '../database.js';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const BASE = '/api/intake-forms';

describe('intakeForms routes', () => {
  let app, school, admin, headers;

  beforeEach(async () => {
    school = await createSchoolRecord({ name: 'Forms School', code: 'FRMS' });
    admin = await createStaffUser({
      name: 'Forms Admin',
      email: 'forms.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    headers = authHeadersFor(admin, 'admin');
    ({ app } = createTestApp());
  });

  // ───────────────────────────────────────────────────────────────
  // Auth
  // ───────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('GET /api/intake-forms returns 401 without token', async () => {
      await request(app).get(BASE).expect(401);
    });

    it('POST /api/intake-forms returns 401 without token', async () => {
      await request(app).post(BASE).send({ formName: 'X' }).expect(401);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /api/intake-forms
  // ───────────────────────────────────────────────────────────────
  describe('GET /api/intake-forms', () => {
    it('returns an empty array when no forms exist', async () => {
      const res = await request(app).get(BASE).set(headers).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(0);
    });

    it('returns existing forms', async () => {
      await IntakeForm.create({
        schoolId: school._id,
        formName: 'Student Intake',
        formType: 'student',
        status: 'active',
        fields: [],
      });

      const res = await request(app).get(BASE).set(headers).expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].formName).toBe('Student Intake');
    });

    it('filters by type query param', async () => {
      await IntakeForm.create({
        schoolId: school._id,
        formName: 'Student Form',
        formType: 'student',
        fields: [],
      });
      await IntakeForm.create({
        schoolId: school._id,
        formName: 'Staff Form',
        formType: 'staff',
        fields: [],
      });

      const res = await request(app).get(`${BASE}?type=student`).set(headers).expect(200);

      expect(res.body.every((f) => f.formType === 'student')).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /api/intake-forms/:id
  // ───────────────────────────────────────────────────────────────
  describe('GET /api/intake-forms/:id', () => {
    it('returns 404 for a non-existent form', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      await request(app).get(`${BASE}/${fakeId}`).set(headers).expect(404);
    });

    it('returns the form for a valid id', async () => {
      const form = await IntakeForm.create({
        schoolId: school._id,
        formName: 'Lookup Form',
        formType: 'parent',
        fields: [],
      });

      const res = await request(app).get(`${BASE}/${form._id}`).set(headers).expect(200);

      expect(res.body.formName).toBe('Lookup Form');
    });
  });

  // ───────────────────────────────────────────────────────────────
  // POST /api/intake-forms
  // ───────────────────────────────────────────────────────────────
  describe('POST /api/intake-forms', () => {
    it('creates a new intake form', async () => {
      const payload = {
        formName: 'New Admission Form',
        formType: 'student',
        fields: [
          { fieldName: 'studentName', fieldType: 'text', label: 'Student Name', required: true },
        ],
      };

      const res = await request(app).post(BASE).set(headers).send(payload).expect(201);

      expect(res.body.formName).toBe('New Admission Form');
      expect(res.body._id).toBeDefined();
    });
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /api/intake-forms/:id
  // ───────────────────────────────────────────────────────────────
  describe('PUT /api/intake-forms/:id', () => {
    it('returns 404 when updating a non-existent form', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      await request(app)
        .put(`${BASE}/${fakeId}`)
        .set(headers)
        .send({ formName: 'Updated' })
        .expect(404);
    });

    it('updates an existing form', async () => {
      const form = await IntakeForm.create({
        schoolId: school._id,
        formName: 'Old Name',
        formType: 'student',
        fields: [],
      });

      const res = await request(app)
        .put(`${BASE}/${form._id}`)
        .set(headers)
        .send({ formName: 'New Name' })
        .expect(200);

      expect(res.body.formName).toBe('New Name');
    });
  });

  // ───────────────────────────────────────────────────────────────
  // DELETE /api/intake-forms/:id
  // ───────────────────────────────────────────────────────────────
  describe('DELETE /api/intake-forms/:id', () => {
    it('returns 404 when deleting a non-existent form', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      await request(app).delete(`${BASE}/${fakeId}`).set(headers).expect(404);
    });

    it('deletes an existing form', async () => {
      const form = await IntakeForm.create({
        schoolId: school._id,
        formName: 'To Delete',
        formType: 'student',
        fields: [],
      });

      const res = await request(app).delete(`${BASE}/${form._id}`).set(headers).expect(200);

      expect(res.body.message).toMatch(/deleted/i);

      const gone = await IntakeForm.findById(form._id);
      expect(gone).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /api/form-submissions
  // ───────────────────────────────────────────────────────────────
  describe('GET /api/form-submissions', () => {
    it('returns 401 without token', async () => {
      await request(app).get('/api/form-submissions').expect(401);
    });

    it('returns submissions list (empty)', async () => {
      const res = await request(app).get('/api/form-submissions').set(headers).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    // PAG-16: pagination is opt-in via page/limit.
    const seedSubmissions = async (count) => {
      const form = await IntakeForm.create({
        schoolId: school._id,
        formName: 'Paged Form',
        formType: 'student',
        fields: [],
      });
      const docs = Array.from({ length: count }, (_, i) => ({
        schoolId: school._id,
        assignmentId: new mongoose.Types.ObjectId(),
        formId: form._id,
        submittedByEmail: `parent${i}@example.com`,
        reviewStatus: 'pending',
        submittedAt: new Date(Date.now() - i * 1000),
      }));
      await FormSubmission.insertMany(docs);
    };

    it('returns the full array (no pagination) when page/limit are omitted', async () => {
      await seedSubmissions(3);

      const res = await request(app).get('/api/form-submissions').set(headers).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(3);
    });

    it('returns a paginated envelope when page/limit are supplied', async () => {
      await seedSubmissions(25);

      const res = await request(app)
        .get('/api/form-submissions?page=1&limit=10')
        .set(headers)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(10);
      expect(res.body.pagination).toMatchObject({
        currentPage: 1,
        totalPages: 3,
        totalItems: 25,
        itemsPerPage: 10,
        hasNextPage: true,
        hasPrevPage: false,
      });
    });

    it('returns the last partial page with correct flags', async () => {
      await seedSubmissions(25);

      const res = await request(app)
        .get('/api/form-submissions?page=3&limit=10')
        .set(headers)
        .expect(200);

      expect(res.body.data).toHaveLength(5);
      expect(res.body.pagination).toMatchObject({
        currentPage: 3,
        totalPages: 3,
        hasNextPage: false,
        hasPrevPage: true,
      });
    });

    it('clamps an over-large limit to 100', async () => {
      await seedSubmissions(2);

      const res = await request(app)
        .get('/api/form-submissions?page=1&limit=9999')
        .set(headers)
        .expect(200);

      expect(res.body.pagination.itemsPerPage).toBe(100);
      expect(res.body.data).toHaveLength(2);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /api/form-assignments
  // ───────────────────────────────────────────────────────────────
  describe('GET /api/form-assignments', () => {
    it('returns 401 without token', async () => {
      await request(app).get('/api/form-assignments').expect(401);
    });

    it('returns assignments list (empty)', async () => {
      const res = await request(app).get('/api/form-assignments').set(headers).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });
});
