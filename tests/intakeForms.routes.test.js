import request from 'supertest';
import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { IntakeForm } from '../database.js';
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
      await IntakeForm.create({ formName: 'Student Form', formType: 'student', fields: [] });
      await IntakeForm.create({ formName: 'Staff Form', formType: 'staff', fields: [] });

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
        fields: [{ name: 'studentName', label: 'Student Name', type: 'text', required: true }],
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
