import request from 'supertest';
import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import PromotionRecord from '../models/PromotionRecord.js';
import PromotionRule from '../models/PromotionRule.js';
import { Class, Student } from '../database.js';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';
import { CURRENT_ACADEMIC_YEAR, getNextAcademicYear } from '../utils/constants.js';

async function setupSchoolWithAdmin(schoolName = 'Promotion School') {
  const school = await createSchoolRecord({ name: schoolName });
  const admin = await createStaffUser({ schoolId: school._id });
  return { school, admin };
}

describe('promotion routes', () => {
  // ─── AUTH ──────────────────────────────────────────────────────────────

  describe('authentication', () => {
    it('returns 401 when no token is provided', async () => {
      const { app } = createTestApp();
      const fakeId = new mongoose.Types.ObjectId().toString();

      await request(app).get('/api/promotions/preview').expect(401);
      await request(app).post('/api/promotions/execute').send({}).expect(401);
      await request(app).get('/api/promotions/records').expect(401);
      await request(app).get(`/api/promotions/records/${fakeId}`).expect(401);
      await request(app).post(`/api/promotions/rollback/${fakeId}`).send({}).expect(401);
      await request(app).post('/api/promotions/new-academic-year').send({}).expect(401);
      await request(app).get('/api/promotions/rules').expect(401);
      await request(app).put('/api/promotions/rules').send({}).expect(401);
      await request(app).get('/api/promotions/check-year').expect(401);
    });
  });

  // ─── GET /promotions/preview ───────────────────────────────────────────

  describe('GET /api/promotions/preview', () => {
    it('returns promotion preview for a class with students', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const cls = await createClassRecord({
        schoolId: school._id,
        academicYear: CURRENT_ACADEMIC_YEAR,
      });
      await createStudentRecord({ schoolId: school._id, classId: cls._id, status: 'active' });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .get('/api/promotions/preview')
        .set(headers)
        .query({ classId: cls._id.toString(), academicYear: CURRENT_ACADEMIC_YEAR })
        .expect(200);

      expect(res.body).toHaveProperty('class');
      expect(res.body).toHaveProperty('students');
      expect(Array.isArray(res.body.students)).toBe(true);
      expect(res.body.students.length).toBeGreaterThanOrEqual(1);
      expect(res.body.students[0]).toHaveProperty('suggestedDecision');
    });

    it('returns 400 when classId is missing', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app).get('/api/promotions/preview').set(headers);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/classId is required/i);
    });

    it('returns 404 for non-existent class', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');
      const fakeId = new mongoose.Types.ObjectId().toString();

      const res = await request(app)
        .get('/api/promotions/preview')
        .set(headers)
        .query({ classId: fakeId });

      expect(res.status).toBe(404);
    });
  });

  // ─── POST /promotions/execute ──────────────────────────────────────────

  describe('POST /api/promotions/execute', () => {
    it('executes bulk promotion and returns summary', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const fromYear = CURRENT_ACADEMIC_YEAR;
      const toYear = getNextAcademicYear(fromYear);
      const clsFrom = await createClassRecord({
        schoolId: school._id,
        academicYear: fromYear,
        name: 'Class 5',
      });
      const clsTo = await createClassRecord({
        schoolId: school._id,
        academicYear: toYear,
        name: 'Class 6',
      });
      const student = await createStudentRecord({
        schoolId: school._id,
        classId: clsFrom._id,
        status: 'active',
        academicYear: fromYear,
      });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .post('/api/promotions/execute')
        .set(headers)
        .send({
          fromAcademicYear: fromYear,
          toAcademicYear: toYear,
          studentDecisions: [
            {
              studentId: student._id.toString(),
              decision: 'promoted',
              toClassId: clsTo._id.toString(),
            },
          ],
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.summary.promoted).toBe(1);
      expect(res.body.summary.totalStudents).toBe(1);
      expect(res.body).toHaveProperty('promotionRecordId');

      // Verify student was promoted
      const updated = await Student.findById(student._id);
      expect(updated.classId.toString()).toBe(clsTo._id.toString());
      expect(updated.academicYear).toBe(toYear);
    });

    it('returns 400 for invalid body (missing studentDecisions)', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .post('/api/promotions/execute')
        .set(headers)
        .send({
          fromAcademicYear: CURRENT_ACADEMIC_YEAR,
          toAcademicYear: getNextAcademicYear(CURRENT_ACADEMIC_YEAR),
        });

      expect(res.status).toBe(400);
    });

    it('detains a student when decision is detained', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const fromYear = CURRENT_ACADEMIC_YEAR;
      const toYear = getNextAcademicYear(fromYear);
      const cls = await createClassRecord({
        schoolId: school._id,
        academicYear: fromYear,
      });
      const student = await createStudentRecord({
        schoolId: school._id,
        classId: cls._id,
        status: 'active',
        academicYear: fromYear,
      });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .post('/api/promotions/execute')
        .set(headers)
        .send({
          fromAcademicYear: fromYear,
          toAcademicYear: toYear,
          studentDecisions: [
            {
              studentId: student._id.toString(),
              decision: 'detained',
            },
          ],
        })
        .expect(200);

      expect(res.body.summary.detained).toBe(1);

      const updated = await Student.findById(student._id);
      expect(updated.classId.toString()).toBe(cls._id.toString());
      expect(updated.academicYear).toBe(toYear);
    });
  });

  // ─── GET /promotions/records ───────────────────────────────────────────

  describe('GET /api/promotions/records', () => {
    it('lists promotion records for the school', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      await PromotionRecord.create({
        schoolId: school._id,
        fromAcademicYear: '2024-2025',
        toAcademicYear: '2025-2026',
        studentSnapshots: [],
        summary: {
          totalStudents: 0,
          promoted: 0,
          detained: 0,
          transferred: 0,
          graduated: 0,
          errors: 0,
        },
      });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app).get('/api/promotions/records').set(headers).expect(200);

      expect(res.body).toHaveProperty('records');
      expect(Array.isArray(res.body.records)).toBe(true);
      expect(res.body.records.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── GET /promotions/records/:recordId ─────────────────────────────────

  describe('GET /api/promotions/records/:recordId', () => {
    it('returns a specific promotion record with class report', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const cls = await createClassRecord({ schoolId: school._id });
      const record = await PromotionRecord.create({
        schoolId: school._id,
        fromAcademicYear: '2024-2025',
        toAcademicYear: '2025-2026',
        studentSnapshots: [
          {
            studentId: new mongoose.Types.ObjectId(),
            studentName: 'Test Student',
            decision: 'promoted',
            fromClassId: cls._id,
          },
        ],
        summary: {
          totalStudents: 1,
          promoted: 1,
          detained: 0,
          transferred: 0,
          graduated: 0,
          errors: 0,
        },
      });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .get(`/api/promotions/records/${record._id}`)
        .set(headers)
        .expect(200);

      expect(res.body).toHaveProperty('record');
      expect(res.body.record).toHaveProperty('classReport');
    });

    it('returns 404 for non-existent record', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');
      const fakeId = new mongoose.Types.ObjectId().toString();

      const res = await request(app).get(`/api/promotions/records/${fakeId}`).set(headers);

      expect(res.status).toBe(404);
    });
  });

  // ─── POST /promotions/rollback/:recordId ───────────────────────────────

  describe('POST /api/promotions/rollback/:recordId', () => {
    it('rolls back a promotion and restores student state', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const fromYear = CURRENT_ACADEMIC_YEAR;
      const toYear = getNextAcademicYear(fromYear);
      const cls = await createClassRecord({ schoolId: school._id, academicYear: fromYear });
      const student = await createStudentRecord({
        schoolId: school._id,
        classId: cls._id,
        status: 'active',
        academicYear: fromYear,
        rollNo: 10,
      });
      const record = await PromotionRecord.create({
        schoolId: school._id,
        fromAcademicYear: fromYear,
        toAcademicYear: toYear,
        studentSnapshots: [
          {
            studentId: student._id,
            studentName: student.name,
            admissionId: student.admissionId,
            rollNo: 10,
            fromClassId: cls._id,
            fromAcademicYear: fromYear,
            previousStatus: 'active',
            previousFeeStatus: 'pending',
            decision: 'promoted',
            toClassId: cls._id,
            newRollNo: null,
          },
        ],
        summary: {
          totalStudents: 1,
          promoted: 1,
          detained: 0,
          transferred: 0,
          graduated: 0,
          errors: 0,
        },
      });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .post(`/api/promotions/rollback/${record._id}`)
        .set(headers)
        .send({ reason: 'Mistake' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.restored).toBe(1);

      const updatedRecord = await PromotionRecord.findById(record._id);
      expect(updatedRecord.status).toBe('rolledback');
    });

    it('returns 400 when record is already rolled back', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const record = await PromotionRecord.create({
        schoolId: school._id,
        fromAcademicYear: '2024-2025',
        toAcademicYear: '2025-2026',
        status: 'rolledback',
        studentSnapshots: [],
        summary: {
          totalStudents: 0,
          promoted: 0,
          detained: 0,
          transferred: 0,
          graduated: 0,
          errors: 0,
        },
      });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .post(`/api/promotions/rollback/${record._id}`)
        .set(headers)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/already been rolled back/i);
    });

    it('returns 404 for non-existent record', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');
      const fakeId = new mongoose.Types.ObjectId().toString();

      const res = await request(app)
        .post(`/api/promotions/rollback/${fakeId}`)
        .set(headers)
        .send({});

      expect(res.status).toBe(404);
    });
  });

  // ─── POST /promotions/new-academic-year ────────────────────────────────

  describe('POST /api/promotions/new-academic-year', () => {
    it('creates new academic year by copying class structure', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const fromYear = CURRENT_ACADEMIC_YEAR;
      const toYear = getNextAcademicYear(fromYear);
      await createClassRecord({ schoolId: school._id, academicYear: fromYear, name: 'Class 1' });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .post('/api/promotions/new-academic-year')
        .set(headers)
        .send({
          fromAcademicYear: fromYear,
          toAcademicYear: toYear,
          copyClasses: true,
          copyFeeTemplates: false,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.classesCreated).toBeGreaterThanOrEqual(1);

      const newClasses = await Class.find({ schoolId: school._id, academicYear: toYear });
      expect(newClasses.length).toBeGreaterThanOrEqual(1);
    });

    it('returns 409 when target year classes already exist', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const fromYear = CURRENT_ACADEMIC_YEAR;
      const toYear = getNextAcademicYear(fromYear);
      await createClassRecord({ schoolId: school._id, academicYear: fromYear });
      await createClassRecord({ schoolId: school._id, academicYear: toYear });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app).post('/api/promotions/new-academic-year').set(headers).send({
        fromAcademicYear: fromYear,
        toAcademicYear: toYear,
        copyClasses: true,
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already exist/i);
    });

    it('returns 400 for invalid body', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .post('/api/promotions/new-academic-year')
        .set(headers)
        .send({ fromAcademicYear: 'bad' });

      expect(res.status).toBe(400);
    });
  });

  // ─── GET /promotions/rules ─────────────────────────────────────────────

  describe('GET /api/promotions/rules', () => {
    it('returns default rules when none are saved', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app).get('/api/promotions/rules').set(headers).expect(200);

      expect(res.body.minAttendancePercent).toBe(75);
      expect(res.body.feeRequirement).toBe('none');
    });

    it('returns saved rules', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      await PromotionRule.create({
        schoolId: school._id,
        minAttendancePercent: 80,
        feeRequirement: 'full',
      });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app).get('/api/promotions/rules').set(headers).expect(200);

      expect(res.body.minAttendancePercent).toBe(80);
      expect(res.body.feeRequirement).toBe('full');
    });
  });

  // ─── PUT /promotions/rules ─────────────────────────────────────────────

  describe('PUT /api/promotions/rules', () => {
    it('upserts promotion rules', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .put('/api/promotions/rules')
        .set(headers)
        .send({ minAttendancePercent: 85, feeRequirement: 'partial' })
        .expect(200);

      expect(res.body.minAttendancePercent).toBe(85);
      expect(res.body.feeRequirement).toBe('partial');

      const saved = await PromotionRule.findOne({ schoolId: school._id });
      expect(saved.minAttendancePercent).toBe(85);
    });

    it('returns 400 for invalid feeRequirement', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .put('/api/promotions/rules')
        .set(headers)
        .send({ feeRequirement: 'invalid' });

      expect(res.status).toBe(400);
    });
  });

  // ─── GET /promotions/check-year ────────────────────────────────────────

  describe('GET /api/promotions/check-year', () => {
    it('returns exists=false when no classes for year', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .get('/api/promotions/check-year')
        .set(headers)
        .query({ academicYear: '2099-2100' })
        .expect(200);

      expect(res.body.exists).toBe(false);
      expect(res.body.classCount).toBe(0);
    });

    it('returns exists=true when classes exist for year', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const year = '2025-2026';
      await createClassRecord({ schoolId: school._id, academicYear: year });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .get('/api/promotions/check-year')
        .set(headers)
        .query({ academicYear: year })
        .expect(200);

      expect(res.body.exists).toBe(true);
      expect(res.body.classCount).toBeGreaterThanOrEqual(1);
    });

    it('returns 400 when academicYear is missing', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app).get('/api/promotions/check-year').set(headers);

      expect(res.status).toBe(400);
    });
  });

  // ─── GET /promotions/preview-all ───────────────────────────────────────

  describe('GET /api/promotions/preview-all', () => {
    it('returns class mappings for year-end promotion', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const year = CURRENT_ACADEMIC_YEAR;
      await createClassRecord({ schoolId: school._id, academicYear: year, name: 'Class 10' });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .get('/api/promotions/preview-all')
        .set(headers)
        .query({ academicYear: year })
        .expect(200);

      expect(res.body).toHaveProperty('classMappings');
      expect(Array.isArray(res.body.classMappings)).toBe(true);
      expect(res.body).toHaveProperty('academicYear');
      expect(res.body).toHaveProperty('toAcademicYear');
    });
  });

  // ─── POST /promotions/execute-all ──────────────────────────────────────

  describe('POST /api/promotions/execute-all', () => {
    it('executes multi-class promotion', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const fromYear = CURRENT_ACADEMIC_YEAR;
      const toYear = getNextAcademicYear(fromYear);
      const clsFrom = await createClassRecord({
        schoolId: school._id,
        academicYear: fromYear,
        name: 'Class 5',
      });
      const clsTo = await createClassRecord({
        schoolId: school._id,
        academicYear: toYear,
        name: 'Class 6',
      });
      const student = await createStudentRecord({
        schoolId: school._id,
        classId: clsFrom._id,
        status: 'active',
        academicYear: fromYear,
      });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .post('/api/promotions/execute-all')
        .set(headers)
        .send({
          fromAcademicYear: fromYear,
          toAcademicYear: toYear,
          classMappings: [
            {
              fromClassId: clsFrom._id.toString(),
              toClassId: clsTo._id.toString(),
              studentDecisions: [{ studentId: student._id.toString(), decision: 'promoted' }],
            },
          ],
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.summary.promoted).toBe(1);
      expect(res.body).toHaveProperty('promotionRecordId');
    });

    it('returns 400 when target class capacity is exceeded', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const fromYear = CURRENT_ACADEMIC_YEAR;
      const toYear = getNextAcademicYear(fromYear);
      const clsFrom = await createClassRecord({
        schoolId: school._id,
        academicYear: fromYear,
        name: 'Class 5',
      });
      const clsTo = await Class.create({
        schoolId: school._id,
        academicYear: toYear,
        name: 'Class 6',
        section: 'A',
        strengthLimit: { current: 1, default: 1 },
      });
      // Fill target class to capacity
      await createStudentRecord({ schoolId: school._id, classId: clsTo._id, status: 'active' });

      const student = await createStudentRecord({
        schoolId: school._id,
        classId: clsFrom._id,
        status: 'active',
        academicYear: fromYear,
      });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .post('/api/promotions/execute-all')
        .set(headers)
        .send({
          fromAcademicYear: fromYear,
          toAcademicYear: toYear,
          classMappings: [
            {
              fromClassId: clsFrom._id.toString(),
              toClassId: clsTo._id.toString(),
              studentDecisions: [{ studentId: student._id.toString(), decision: 'promoted' }],
            },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/capacity/i);
    });

    it('returns 400 for invalid body', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      const res = await request(app)
        .post('/api/promotions/execute-all')
        .set(headers)
        .send({ fromAcademicYear: 'bad' });

      expect(res.status).toBe(400);
    });
  });

  // ─── MULTI-TENANCY ─────────────────────────────────────────────────────

  describe('multi-tenancy', () => {
    it('school A admin cannot see school B promotion records', async () => {
      const schoolA = await createSchoolRecord({ name: 'Promo School A', code: 'PR-A' });
      const schoolB = await createSchoolRecord({ name: 'Promo School B', code: 'PR-B' });
      const adminA = await createStaffUser({ schoolId: schoolA._id });

      await PromotionRecord.create({
        schoolId: schoolB._id,
        fromAcademicYear: '2024-2025',
        toAcademicYear: '2025-2026',
        studentSnapshots: [],
        summary: {
          totalStudents: 0,
          promoted: 0,
          detained: 0,
          transferred: 0,
          graduated: 0,
          errors: 0,
        },
      });

      const { app } = createTestApp();
      const headersA = authHeadersFor(adminA, 'admin');

      const res = await request(app).get('/api/promotions/records').set(headersA).expect(200);

      expect(res.body.records).toHaveLength(0);
    });

    it('school A admin cannot rollback school B promotion record', async () => {
      const schoolA = await createSchoolRecord({ name: 'Promo School A2', code: 'PR-A2' });
      const schoolB = await createSchoolRecord({ name: 'Promo School B2', code: 'PR-B2' });
      const adminA = await createStaffUser({ schoolId: schoolA._id });

      const record = await PromotionRecord.create({
        schoolId: schoolB._id,
        fromAcademicYear: '2024-2025',
        toAcademicYear: '2025-2026',
        studentSnapshots: [],
        summary: {
          totalStudents: 0,
          promoted: 0,
          detained: 0,
          transferred: 0,
          graduated: 0,
          errors: 0,
        },
      });

      const { app } = createTestApp();
      const headersA = authHeadersFor(adminA, 'admin');

      const res = await request(app)
        .post(`/api/promotions/rollback/${record._id}`)
        .set(headersA)
        .send({});

      expect(res.status).toBe(404);
    });
  });
});
