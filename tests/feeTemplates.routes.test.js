import request from 'supertest';
import { describe, expect, it, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { FeeTemplate } from '../database.js';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const BASE = '/api/fee-templates';

function buildTemplatePayload(overrides = {}) {
  return {
    name: 'Standard Template',
    section: 'Primary',
    totalAnnualFee: 25000,
    feeHeads: [
      {
        name: 'Tuition Fee',
        category: 'Academic',
        amount: 20000,
        frequency: 'yearly',
        mandatory: true,
      },
      {
        name: 'Sports Fee',
        category: 'Extra-curricular',
        amount: 5000,
        frequency: 'yearly',
        mandatory: false,
      },
    ],
    academicYear: '2025-26',
    ...overrides,
  };
}

describe('fee-templates routes', () => {
  let app, school, admin, headers;

  beforeEach(async () => {
    school = await createSchoolRecord({ name: 'Template School', code: 'TMS' });
    admin = await createStaffUser({
      name: 'Template Admin',
      email: 'template.admin@example.com',
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
    it('GET / returns 401 without token', async () => {
      await request(app).get(BASE).expect(401);
    });

    it('POST / returns 401 without token', async () => {
      await request(app).post(BASE).send(buildTemplatePayload()).expect(401);
    });

    it('PUT /:id returns 401 without token', async () => {
      await request(app)
        .put(`${BASE}/${new mongoose.Types.ObjectId()}`)
        .send({ name: 'Updated' })
        .expect(401);
    });

    it('DELETE /:id returns 401 without token', async () => {
      await request(app).delete(`${BASE}/${new mongoose.Types.ObjectId()}`).expect(401);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // POST / — create
  // ───────────────────────────────────────────────────────────────
  describe('POST /', () => {
    it('creates a fee template and returns 201', async () => {
      const payload = buildTemplatePayload();

      const res = await request(app).post(BASE).set(headers).send(payload).expect(201);

      expect(res.body.name).toBe('Standard Template');
      expect(res.body.totalAnnualFee).toBe(25000);
      expect(res.body.feeHeads).toHaveLength(2);
      expect(res.body.schoolId.toString()).toBe(school._id.toString());
    });

    it('rejects a client-supplied schoolId', async () => {
      const otherSchool = await createSchoolRecord({ name: 'Other School', code: 'OTH' });
      const payload = buildTemplatePayload({ schoolId: otherSchool._id.toString() });

      await request(app).post(BASE).set(headers).send(payload).expect(400);
      expect(await FeeTemplate.countDocuments({ name: 'Standard Template' })).toBe(0);
    });

    it('rejects a total that does not match annualized fee heads', async () => {
      await request(app)
        .post(BASE)
        .set(headers)
        .send(
          buildTemplatePayload({
            totalAnnualFee: 1000,
            feeHeads: [
              {
                name: 'Monthly Tuition',
                amount: 1000,
                frequency: 'monthly',
                category: 'Academic',
              },
            ],
          })
        )
        .expect(400);
    });

    it('returns 400 when required fields are missing', async () => {
      // name and section are required by Zod → proper 400, not raw 500
      await request(app).post(BASE).set(headers).send({ totalAnnualFee: 10000 }).expect(400);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET / — list
  // ───────────────────────────────────────────────────────────────
  describe('GET /', () => {
    it('returns active fee templates for the school sorted by name by default', async () => {
      await FeeTemplate.create({
        schoolId: school._id,
        name: 'Zebra Template',
        section: 'Secondary',
        totalAnnualFee: 30000,
        feeHeads: [],
      });
      await FeeTemplate.create({
        schoolId: school._id,
        name: 'Alpha Template',
        section: 'Primary',
        totalAnnualFee: 15000,
        feeHeads: [],
      });

      const res = await request(app).get(BASE).set(headers).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);
      // Should be sorted by name ascending
      expect(res.body[0].name).toBe('Alpha Template');
      expect(res.body[1].name).toBe('Zebra Template');
    });

    it('keeps inactive templates out of the default selector response', async () => {
      await FeeTemplate.create([
        {
          schoolId: school._id,
          name: 'Active Template',
          section: 'Primary',
          totalAnnualFee: 1000,
          feeHeads: [],
          isActive: true,
        },
        {
          schoolId: school._id,
          name: 'Archived Template',
          section: 'Primary',
          totalAnnualFee: 1000,
          feeHeads: [],
          isActive: false,
        },
      ]);

      const res = await request(app).get(BASE).set(headers).expect(200);

      expect(res.body.map((template) => template.name)).toEqual(['Active Template']);
    });

    it('returns only inactive templates when status=inactive', async () => {
      await FeeTemplate.create([
        {
          schoolId: school._id,
          name: 'Active Template',
          section: 'Primary',
          totalAnnualFee: 1000,
          feeHeads: [],
          isActive: true,
        },
        {
          schoolId: school._id,
          name: 'Archived Template',
          section: 'Primary',
          totalAnnualFee: 1000,
          feeHeads: [],
          isActive: false,
        },
      ]);

      const res = await request(app).get(`${BASE}?status=inactive`).set(headers).expect(200);

      expect(res.body.map((template) => template.name)).toEqual(['Archived Template']);
    });

    it('returns active and inactive own-school templates when status=all', async () => {
      await FeeTemplate.create([
        {
          schoolId: school._id,
          name: 'Active Template',
          section: 'Primary',
          totalAnnualFee: 1000,
          feeHeads: [],
          isActive: true,
        },
        {
          schoolId: school._id,
          name: 'Archived Template',
          section: 'Primary',
          totalAnnualFee: 1000,
          feeHeads: [],
          isActive: false,
        },
      ]);

      const res = await request(app).get(`${BASE}?status=all`).set(headers).expect(200);

      expect(res.body.map((template) => template.name)).toEqual([
        'Active Template',
        'Archived Template',
      ]);
    });

    it('combines status and academic-year filters', async () => {
      await FeeTemplate.create([
        {
          schoolId: school._id,
          name: 'Current Archived',
          section: 'Primary',
          totalAnnualFee: 1000,
          feeHeads: [],
          academicYear: '2025-26',
          isActive: false,
        },
        {
          schoolId: school._id,
          name: 'Other Archived',
          section: 'Primary',
          totalAnnualFee: 1000,
          feeHeads: [],
          academicYear: '2024-25',
          isActive: false,
        },
      ]);

      const res = await request(app)
        .get(`${BASE}?status=inactive&academicYear=2025-26`)
        .set(headers)
        .expect(200);

      expect(res.body.map((template) => template.name)).toEqual(['Current Archived']);
    });

    it('rejects invalid or unknown list filters', async () => {
      const invalidStatus = await request(app)
        .get(`${BASE}?status=deleted`)
        .set(headers)
        .expect(400);
      expect(invalidStatus.body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'status' })])
      );

      await request(app).get(`${BASE}?includeDeleted=true`).set(headers).expect(400);
    });

    it('returns empty array when no templates exist', async () => {
      const res = await request(app).get(BASE).set(headers).expect(200);
      expect(res.body).toEqual([]);
    });

    it('does not return templates belonging to another school, including status=all', async () => {
      const schoolB = await createSchoolRecord({ name: 'School B', code: 'SBB' });
      await FeeTemplate.create({
        schoolId: schoolB._id,
        name: 'School B Template',
        section: 'Primary',
        totalAnnualFee: 5000,
        feeHeads: [],
        isActive: false,
      });

      const res = await request(app).get(`${BASE}?status=all`).set(headers).expect(200);
      expect(res.body).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /:id — single
  // ───────────────────────────────────────────────────────────────
  describe('GET /:id', () => {
    it('returns a fee template by ID', async () => {
      const template = await FeeTemplate.create({
        schoolId: school._id,
        name: 'Single Template',
        section: 'Primary',
        totalAnnualFee: 10000,
        feeHeads: [],
      });

      const res = await request(app).get(`${BASE}/${template._id}`).set(headers).expect(200);

      expect(res.body.name).toBe('Single Template');
      expect(res.body._id.toString()).toBe(template._id.toString());
    });

    it('returns 404 for a non-existent ID', async () => {
      await request(app).get(`${BASE}/${new mongoose.Types.ObjectId()}`).set(headers).expect(404);
    });

    it('returns 404 when template belongs to another school', async () => {
      const schoolB = await createSchoolRecord({ name: 'Other School B', code: 'OSB' });
      const template = await FeeTemplate.create({
        schoolId: schoolB._id,
        name: 'Hidden Template',
        section: 'Primary',
        totalAnnualFee: 10000,
        feeHeads: [],
      });

      await request(app).get(`${BASE}/${template._id}`).set(headers).expect(404);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /:id — update
  // ───────────────────────────────────────────────────────────────
  describe('PUT /:id', () => {
    it('updates a fee template and returns the updated document', async () => {
      const template = await FeeTemplate.create({
        schoolId: school._id,
        name: 'Old Name',
        section: 'Primary',
        totalAnnualFee: 10000,
        feeHeads: [],
      });

      const res = await request(app)
        .put(`${BASE}/${template._id}`)
        .set(headers)
        .send({ name: 'New Name', totalAnnualFee: 12000 })
        .expect(200);

      expect(res.body.name).toBe('New Name');
      expect(res.body.totalAnnualFee).toBe(12000);
    });

    it('returns 404 for a non-existent ID', async () => {
      await request(app)
        .put(`${BASE}/${new mongoose.Types.ObjectId()}`)
        .set(headers)
        .send({ name: 'Ghost' })
        .expect(404);
    });

    it('rejects schoolId overrides in update bodies', async () => {
      const template = await FeeTemplate.create({
        schoolId: school._id,
        name: 'Secure Template',
        section: 'Primary',
        totalAnnualFee: 8000,
        feeHeads: [],
      });
      const otherSchool = await createSchoolRecord({ name: 'Injected School', code: 'INJ' });

      await request(app)
        .put(`${BASE}/${template._id}`)
        .set(headers)
        .send({ schoolId: otherSchool._id.toString(), name: 'Updated Name' })
        .expect(400);

      const unchanged = await FeeTemplate.findById(template._id).lean();
      expect(unchanged.schoolId.toString()).toBe(school._id.toString());
      expect(unchanged.name).toBe('Secure Template');
    });
  });

  // ───────────────────────────────────────────────────────────────
  // DELETE /:id — delete
  // ───────────────────────────────────────────────────────────────
  describe('DELETE /:id', () => {
    it('deletes a fee template and returns success', async () => {
      const template = await FeeTemplate.create({
        schoolId: school._id,
        name: 'Delete Me',
        section: 'Primary',
        totalAnnualFee: 5000,
        feeHeads: [],
      });

      const res = await request(app).delete(`${BASE}/${template._id}`).set(headers).expect(200);

      expect(res.body.success).toBe(true);

      const found = await FeeTemplate.findById(template._id);
      expect(found).toBeNull();
    });

    it('returns 404 when deleting a non-existent template', async () => {
      await request(app)
        .delete(`${BASE}/${new mongoose.Types.ObjectId()}`)
        .set(headers)
        .expect(404);
    });

    it('cannot delete a template belonging to another school', async () => {
      const schoolB = await createSchoolRecord({ name: 'Protected School', code: 'PSB' });
      const template = await FeeTemplate.create({
        schoolId: schoolB._id,
        name: 'Protected Template',
        section: 'Primary',
        totalAnnualFee: 5000,
        feeHeads: [],
      });

      await request(app).delete(`${BASE}/${template._id}`).set(headers).expect(404);

      // Template should still exist
      const found = await FeeTemplate.findById(template._id);
      expect(found).not.toBeNull();
    });
  });
});
