import mongoose from 'mongoose';
import request from 'supertest';
import { describe, expect, it, beforeEach } from 'vitest';
import FeeHead from '../models/FeeHead.js';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const BASE = '/api/fee-heads';

function buildFeeHeadPayload(overrides = {}) {
  return {
    name: 'Tuition Fee',
    category: 'Academic',
    amount: 5000,
    mandatory: true,
    description: 'Annual tuition fee',
    applicableClasses: ['10'],
    frequency: 'yearly',
    autoApply: false,
    ...overrides,
  };
}

describe('fee-heads routes', () => {
  let app, school, admin, headers;

  beforeEach(async () => {
    school = await createSchoolRecord({ name: 'FeeHead School', code: 'FH' });
    admin = await createStaffUser({
      name: 'FH Admin',
      email: 'fh.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    headers = authHeadersFor(admin, 'admin');
    ({ app } = createTestApp());
  });

  // ---------------------------------------------------------------
  // AUTH: 401 without token
  // ---------------------------------------------------------------
  describe('authentication', () => {
    it('GET / returns 401 without auth token', async () => {
      await request(app).get(BASE).expect(401);
    });

    it('POST / returns 401 without auth token', async () => {
      await request(app).post(BASE).send(buildFeeHeadPayload()).expect(401);
    });

    it('PUT /:id returns 401 without auth token', async () => {
      const id = new mongoose.Types.ObjectId();
      await request(app).put(`${BASE}/${id}`).send({ name: 'Updated' }).expect(401);
    });

    it('DELETE /:id returns 401 without auth token', async () => {
      const id = new mongoose.Types.ObjectId();
      await request(app).delete(`${BASE}/${id}`).expect(401);
    });

    it('POST /:id/apply returns 401 without auth token', async () => {
      const id = new mongoose.Types.ObjectId();
      await request(app).post(`${BASE}/${id}/apply`).expect(401);
    });
  });

  // ---------------------------------------------------------------
  // POST /api/fee-heads — create
  // ---------------------------------------------------------------
  describe('POST /', () => {
    it('creates a fee head and returns 201', async () => {
      const payload = buildFeeHeadPayload();

      const res = await request(app).post(BASE).set(headers).send(payload).expect(201);

      expect(res.body.feeHead).toMatchObject({
        name: 'Tuition Fee',
        category: 'Academic',
        amount: 5000,
        mandatory: true,
        frequency: 'yearly',
        applicableClasses: ['10'],
        isActive: true,
      });
      expect(res.body.feeHead.schoolId).toBe(school._id.toString());
    });

    it('returns 400 when required fields are missing', async () => {
      await request(app)
        .post(BASE)
        .set(headers)
        .send({ description: 'Missing name and amount' })
        .expect(400);
    });

    it('returns 400 when applicableClasses is empty', async () => {
      await request(app)
        .post(BASE)
        .set(headers)
        .send(buildFeeHeadPayload({ applicableClasses: [] }))
        .expect(400);
    });

    it('defaults category to Academic and frequency to yearly', async () => {
      const payload = {
        name: 'Misc Fee',
        amount: 1000,
        applicableClasses: ['5'],
        autoApply: false,
      };

      const res = await request(app).post(BASE).set(headers).send(payload).expect(201);

      expect(res.body.feeHead.category).toBe('Academic');
      expect(res.body.feeHead.frequency).toBe('yearly');
    });

    it('auto-applies to students when autoApply is true', async () => {
      const cls = await createClassRecord({
        name: 'Class 10',
        section: 'A',
        schoolId: school._id,
      });

      await createStudentRecord({
        name: 'Auto Apply Student',
        classId: cls._id,
        schoolId: school._id,
      });

      const payload = buildFeeHeadPayload({ autoApply: true });

      const res = await request(app).post(BASE).set(headers).send(payload).expect(201);

      expect(res.body.applied).toBe(true);
      expect(res.body.studentsUpdated).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------
  // GET /api/fee-heads — list
  // ---------------------------------------------------------------
  describe('GET /', () => {
    it('returns all active fee heads for the school', async () => {
      await FeeHead.create({
        name: 'Lab Fee',
        amount: 2000,
        applicableClasses: ['10'],
        schoolId: school._id,
        isActive: true,
      });
      await FeeHead.create({
        name: 'Sports Fee',
        amount: 1000,
        applicableClasses: ['10'],
        schoolId: school._id,
        isActive: true,
      });

      const res = await request(app).get(BASE).set(headers).expect(200);

      expect(res.body).toHaveLength(2);
      const names = res.body.map((fh) => fh.name);
      expect(names).toContain('Lab Fee');
      expect(names).toContain('Sports Fee');
    });

    it('excludes inactive fee heads', async () => {
      await FeeHead.create({
        name: 'Active Fee',
        amount: 500,
        applicableClasses: ['1'],
        schoolId: school._id,
        isActive: true,
      });
      await FeeHead.create({
        name: 'Inactive Fee',
        amount: 300,
        applicableClasses: ['1'],
        schoolId: school._id,
        isActive: false,
      });

      const res = await request(app).get(BASE).set(headers).expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe('Active Fee');
    });
  });

  // ---------------------------------------------------------------
  // GET /api/fee-heads/:id — get by ID
  // ---------------------------------------------------------------
  describe('GET /:id', () => {
    it('returns a fee head by its ID', async () => {
      const feeHead = await FeeHead.create({
        name: 'Transport Fee',
        category: 'Transport',
        amount: 3000,
        applicableClasses: ['5', '6'],
        schoolId: school._id,
      });

      const res = await request(app).get(`${BASE}/${feeHead._id}`).set(headers).expect(200);

      expect(res.body.name).toBe('Transport Fee');
      expect(res.body.category).toBe('Transport');
      expect(res.body.amount).toBe(3000);
    });

    it('returns 404 for a non-existent ID', async () => {
      const fakeId = new mongoose.Types.ObjectId();

      await request(app).get(`${BASE}/${fakeId}`).set(headers).expect(404);
    });
  });

  // ---------------------------------------------------------------
  // PUT /api/fee-heads/:id — update
  // ---------------------------------------------------------------
  describe('PUT /:id', () => {
    it('updates fee head fields and returns the updated document', async () => {
      const feeHead = await FeeHead.create({
        name: 'Old Name',
        amount: 1000,
        applicableClasses: ['7'],
        schoolId: school._id,
        autoApply: false,
      });

      const res = await request(app)
        .put(`${BASE}/${feeHead._id}`)
        .set(headers)
        .send({ name: 'New Name', amount: 2000 })
        .expect(200);

      expect(res.body.feeHead.name).toBe('New Name');
      expect(res.body.feeHead.amount).toBe(2000);
    });

    it('returns 404 when updating a non-existent fee head', async () => {
      const fakeId = new mongoose.Types.ObjectId();

      await request(app).put(`${BASE}/${fakeId}`).set(headers).send({ name: 'Ghost' }).expect(404);
    });

    it('can deactivate a fee head via isActive: false', async () => {
      const feeHead = await FeeHead.create({
        name: 'Deactivate Me',
        amount: 500,
        applicableClasses: ['3'],
        schoolId: school._id,
        autoApply: false,
      });

      const res = await request(app)
        .put(`${BASE}/${feeHead._id}`)
        .set(headers)
        .send({ isActive: false })
        .expect(200);

      expect(res.body.feeHead.isActive).toBe(false);
    });
  });

  // ---------------------------------------------------------------
  // DELETE /api/fee-heads/:id — delete
  // ---------------------------------------------------------------
  describe('DELETE /:id', () => {
    it('deletes the fee head and returns success', async () => {
      const feeHead = await FeeHead.create({
        name: 'Delete Me',
        amount: 100,
        applicableClasses: ['1'],
        schoolId: school._id,
      });

      const res = await request(app).delete(`${BASE}/${feeHead._id}`).set(headers).expect(200);

      expect(res.body.success).toBe(true);

      const found = await FeeHead.findById(feeHead._id);
      expect(found).toBeNull();
    });

    it('returns 404 when deleting a non-existent fee head', async () => {
      const fakeId = new mongoose.Types.ObjectId();

      await request(app).delete(`${BASE}/${fakeId}`).set(headers).expect(404);
    });

    it('removes the fee head from student fee structures on delete', async () => {
      const feeHead = await FeeHead.create({
        name: 'Removable Fee',
        amount: 1500,
        applicableClasses: ['10'],
        schoolId: school._id,
      });

      const cls = await createClassRecord({
        name: 'Class 10',
        section: 'A',
        schoolId: school._id,
      });

      const student = await createStudentRecord({
        name: 'Structure Student',
        classId: cls._id,
        schoolId: school._id,
      });

      await StudentFeeStructure.create({
        studentId: student._id,
        classId: cls._id,
        schoolId: school._id,
        academicYear: '2025-26',
        feeHeads: [
          {
            feeHeadId: feeHead._id,
            name: feeHead.name,
            category: 'Academic',
            amount: 1500,
            mandatory: true,
            frequency: 'yearly',
            paidAmount: 0,
            balanceAmount: 1500,
            status: 'pending',
          },
        ],
        totalFee: 1500,
        totalPaid: 0,
        totalBalance: 1500,
        overallStatus: 'pending',
      });

      await request(app).delete(`${BASE}/${feeHead._id}`).set(headers).expect(200);

      const structure = await StudentFeeStructure.findOne({
        studentId: student._id,
      });
      const remaining = structure.feeHeads.filter(
        (fh) => fh.feeHeadId.toString() === feeHead._id.toString()
      );
      expect(remaining).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------
  // POST /api/fee-heads/:id/apply — manually apply to students
  // ---------------------------------------------------------------
  describe('POST /:id/apply', () => {
    it('applies a fee head to students in applicable classes', async () => {
      const cls = await createClassRecord({
        name: 'Class 8',
        section: 'A',
        schoolId: school._id,
      });

      await createStudentRecord({
        name: 'Apply Student 1',
        classId: cls._id,
        schoolId: school._id,
      });
      await createStudentRecord({
        name: 'Apply Student 2',
        classId: cls._id,
        schoolId: school._id,
        rollNo: 2,
      });

      const feeHead = await FeeHead.create({
        name: 'Manual Apply Fee',
        amount: 800,
        applicableClasses: ['8'],
        schoolId: school._id,
        autoApply: false,
      });

      const res = await request(app).post(`${BASE}/${feeHead._id}/apply`).set(headers).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.studentsUpdated).toBe(2);

      // Verify student fee structures were created
      const structures = await StudentFeeStructure.find({
        'feeHeads.feeHeadId': feeHead._id,
      });
      expect(structures).toHaveLength(2);
    });

    it('returns 404 when applying a non-existent fee head', async () => {
      const fakeId = new mongoose.Types.ObjectId();

      await request(app).post(`${BASE}/${fakeId}/apply`).set(headers).expect(404);
    });

    it('returns 0 students updated when no students exist in applicable classes', async () => {
      const feeHead = await FeeHead.create({
        name: 'Empty Class Fee',
        amount: 500,
        applicableClasses: ['12'],
        schoolId: school._id,
        autoApply: false,
      });

      const res = await request(app).post(`${BASE}/${feeHead._id}/apply`).set(headers).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.studentsUpdated).toBe(0);
    });
  });

  // ---------------------------------------------------------------
  // Multi-tenancy: fee heads scoped by school
  // ---------------------------------------------------------------
  describe('multi-tenancy', () => {
    it('GET / only returns fee heads belonging to the requesting school', async () => {
      const schoolB = await createSchoolRecord({
        name: 'Other School',
        code: 'OTHER',
      });

      // Fee head for school A (the test school)
      await FeeHead.create({
        name: 'School A Fee',
        amount: 1000,
        applicableClasses: ['1'],
        schoolId: school._id,
        isActive: true,
      });

      // Fee head for school B
      await FeeHead.create({
        name: 'School B Fee',
        amount: 2000,
        applicableClasses: ['1'],
        schoolId: schoolB._id,
        isActive: true,
      });

      const res = await request(app).get(BASE).set(headers).expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe('School A Fee');
    });

    it('POST / assigns the schoolId from the authenticated user, not from the request body', async () => {
      const otherSchool = await createSchoolRecord({
        name: 'Hijack School',
        code: 'HIJACK',
      });

      const payload = buildFeeHeadPayload({
        schoolId: otherSchool._id.toString(), // attempt to inject a different schoolId
      });

      const res = await request(app).post(BASE).set(headers).send(payload).expect(201);

      // The created fee head should belong to the admin's school, not the injected one
      expect(res.body.feeHead.schoolId).toBe(school._id.toString());
    });
  });
});
