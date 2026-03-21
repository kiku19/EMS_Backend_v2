import request from 'supertest';
import { describe, expect, it, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { FeeStructure } from '../database.js';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const BASE = '/api/fee-structure';

describe('fee-structure routes', () => {
  let app, school, admin, headers, classRecord;

  beforeEach(async () => {
    school = await createSchoolRecord({ name: 'FeeStructure School', code: 'FSS' });
    admin = await createStaffUser({
      name: 'FS Admin',
      email: 'fs.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    headers = authHeadersFor(admin, 'admin');
    classRecord = await createClassRecord({ name: 'Class 10', section: 'A', schoolId: school._id });
    ({ app } = createTestApp());
  });

  // ───────────────────────────────────────────────────────────────
  // Auth: 401 without token
  // ───────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('GET /class/:classId returns 401 without token', async () => {
      await request(app).get(`${BASE}/class/${classRecord._id}`).expect(401);
    });

    it('POST / returns 401 without token', async () => {
      await request(app)
        .post(BASE)
        .send({ classId: classRecord._id.toString(), academicYear: '2025-26' })
        .expect(401);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // POST / — create / upsert fee structure
  // ───────────────────────────────────────────────────────────────
  describe('POST /', () => {
    it('creates a fee structure for a class and returns 201', async () => {
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .send({
          classId: classRecord._id.toString(),
          academicYear: '2025-26',
          totalAnnualFee: 20000,
          feeHeads: [
            {
              name: 'Tuition Fee',
              category: 'Academic',
              amount: 20000,
              mandatory: true,
              frequency: 'yearly',
            },
          ],
        })
        .expect(201);

      expect(res.body.classId.toString()).toBe(classRecord._id.toString());
      expect(res.body.totalAnnualFee).toBe(20000);
      expect(res.body.schoolId.toString()).toBe(school._id.toString());
    });

    it('upserts (updates) existing structure for the same class+year', async () => {
      // Create initial structure
      await request(app)
        .post(BASE)
        .set(headers)
        .send({
          classId: classRecord._id.toString(),
          academicYear: '2025-26',
          totalAnnualFee: 10000,
        })
        .expect(201);

      // Update with higher fee
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .send({
          classId: classRecord._id.toString(),
          academicYear: '2025-26',
          totalAnnualFee: 15000,
        })
        .expect(201);

      expect(res.body.totalAnnualFee).toBe(15000);

      // Verify only one record in DB
      const count = await FeeStructure.countDocuments({
        classId: classRecord._id,
        academicYear: '2025-26',
        schoolId: school._id,
      });
      expect(count).toBe(1);
    });

    it('returns 400 when classId is missing', async () => {
      await request(app)
        .post(BASE)
        .set(headers)
        .send({ academicYear: '2025-26', totalAnnualFee: 10000 })
        .expect(400);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /class/:classId — get fee structure for a class
  // ───────────────────────────────────────────────────────────────
  describe('GET /class/:classId', () => {
    it('returns the fee structure when it exists', async () => {
      await FeeStructure.create({
        schoolId: school._id,
        classId: classRecord._id,
        academicYear: '2025-26',
        totalAnnualFee: 18000,
        feeHeads: [],
      });

      const res = await request(app)
        .get(`${BASE}/class/${classRecord._id}?academicYear=2025-26`)
        .set(headers)
        .expect(200);

      expect(res.body.totalAnnualFee).toBe(18000);
      expect(res.body.classId.toString()).toBe(classRecord._id.toString());
    });

    it('returns 404 when no fee structure exists for the class', async () => {
      const fakeClassId = new mongoose.Types.ObjectId();
      await request(app)
        .get(`${BASE}/class/${fakeClassId}?academicYear=2025-26`)
        .set(headers)
        .expect(404);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // POST /apply-to-students — apply class fee structure to students
  // ───────────────────────────────────────────────────────────────
  describe('POST /apply-to-students', () => {
    it('applies fee structure to active students who do not have one yet', async () => {
      // Create class fee structure
      await FeeStructure.create({
        schoolId: school._id,
        classId: classRecord._id,
        academicYear: '2025-26',
        totalAnnualFee: 12000,
        feeHeads: [
          {
            name: 'Tuition',
            category: 'Academic',
            amount: 12000,
            mandatory: true,
            frequency: 'yearly',
          },
        ],
      });

      // Create two active students
      await createStudentRecord({
        name: 'Apply Student 1',
        classId: classRecord._id,
        schoolId: school._id,
        status: 'active',
        rollNo: 1,
      });
      await createStudentRecord({
        name: 'Apply Student 2',
        classId: classRecord._id,
        schoolId: school._id,
        status: 'active',
        rollNo: 2,
      });

      const res = await request(app)
        .post(`${BASE}/apply-to-students`)
        .set(headers)
        .send({ classId: classRecord._id.toString(), academicYear: '2025-26' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.appliedCount).toBe(2);

      // Verify student fee structures were created
      const structs = await StudentFeeStructure.find({ classId: classRecord._id });
      expect(structs).toHaveLength(2);
      expect(structs[0].totalFee).toBe(12000);
    });

    it('skips students who already have a fee structure', async () => {
      const student = await createStudentRecord({
        name: 'Already Has Structure',
        classId: classRecord._id,
        schoolId: school._id,
        status: 'active',
        rollNo: 10,
      });

      // Pre-create a student fee structure
      await StudentFeeStructure.create({
        schoolId: school._id,
        studentId: student._id,
        classId: classRecord._id,
        academicYear: '2025-26',
        feeHeads: [],
        totalFee: 5000,
        totalPaid: 0,
        totalBalance: 5000,
        overallStatus: 'pending',
      });

      await FeeStructure.create({
        schoolId: school._id,
        classId: classRecord._id,
        academicYear: '2025-26',
        totalAnnualFee: 5000,
        feeHeads: [],
      });

      const res = await request(app)
        .post(`${BASE}/apply-to-students`)
        .set(headers)
        .send({ classId: classRecord._id.toString(), academicYear: '2025-26' })
        .expect(200);

      expect(res.body.appliedCount).toBe(0);
    });

    it('returns 404 when no class fee structure exists', async () => {
      const emptyClass = await createClassRecord({
        name: 'Empty Class',
        section: 'B',
        schoolId: school._id,
      });

      await request(app)
        .post(`${BASE}/apply-to-students`)
        .set(headers)
        .send({ classId: emptyClass._id.toString(), academicYear: '2025-26' })
        .expect(404);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // Multi-tenancy
  // ───────────────────────────────────────────────────────────────
  describe('multi-tenancy', () => {
    it('does not return fee structure belonging to another school', async () => {
      const schoolB = await createSchoolRecord({ name: 'School B', code: 'SB' });
      const classB = await createClassRecord({
        name: 'Class 10',
        section: 'A',
        schoolId: schoolB._id,
      });

      await FeeStructure.create({
        schoolId: schoolB._id,
        classId: classB._id,
        academicYear: '2025-26',
        totalAnnualFee: 99999,
        feeHeads: [],
      });

      // Admin of school A tries to access school B class structure
      await request(app)
        .get(`${BASE}/class/${classB._id}?academicYear=2025-26`)
        .set(headers)
        .expect(404);
    });
  });
});
