import request from 'supertest';
import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Class, Staff } from '../database.js';
import {
  authHeadersFor,
  createSchoolRecord,
  createStaffUser,
  createClassRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const BASE = '/api/validation';

describe('validation routes (timetable/class-teacher checks)', () => {
  let app, school, admin, headers;

  beforeEach(async () => {
    school = await createSchoolRecord({ name: 'Validation School', code: 'VAL' });
    admin = await createStaffUser({
      name: 'Validation Admin',
      email: 'val.admin@example.com',
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
    it('GET /class-teachers/check-duplicates returns 401 without token', async () => {
      await request(app).get(`${BASE}/class-teachers/check-duplicates`).expect(401);
    });

    it('GET /class-teachers/check-consistency returns 401 without token', async () => {
      await request(app).get(`${BASE}/class-teachers/check-consistency`).expect(401);
    });

    it('POST /class-teachers/fix-duplicates returns 401 without token', async () => {
      await request(app).post(`${BASE}/class-teachers/fix-duplicates`).expect(401);
    });

    it('GET /classes/comprehensive returns 401 without token', async () => {
      await request(app).get(`${BASE}/classes/comprehensive`).expect(401);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /class-teachers/check-duplicates
  // ───────────────────────────────────────────────────────────────
  describe('GET /class-teachers/check-duplicates', () => {
    it('returns no violations when each teacher is assigned to one class', async () => {
      const teacher = await createStaffUser({
        name: 'Teacher One',
        email: 'teacher.one.val@example.com',
        schoolId: school._id,
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
      });
      await createClassRecord({
        name: 'Class 1',
        section: 'A',
        classTeacherId: teacher._id,
        schoolId: school._id,
      });

      const res = await request(app)
        .get(`${BASE}/class-teachers/check-duplicates`)
        .set(headers)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.hasViolations).toBe(false);
      expect(res.body.violations).toHaveLength(0);
    });

    it('detects a duplicate class-teacher assignment', async () => {
      const teacher = await createStaffUser({
        name: 'Dup Teacher',
        email: 'dup.teacher.val@example.com',
        schoolId: school._id,
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
      });

      // Assign same teacher to two classes (bypassing model-level uniqueness for test)
      await Class.create({
        name: 'Class Dup A',
        section: 'A',
        classTeacherId: teacher._id,
        schoolId: school._id,
        subjects: ['Math'],
        academicYear: '2025-26',
      });
      await Class.create({
        name: 'Class Dup B',
        section: 'B',
        classTeacherId: teacher._id,
        schoolId: school._id,
        subjects: ['Math'],
        academicYear: '2025-26',
      });

      const res = await request(app)
        .get(`${BASE}/class-teachers/check-duplicates`)
        .set(headers)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.hasViolations).toBe(true);
      expect(res.body.violations.length).toBeGreaterThan(0);
      expect(res.body.violations[0].classCount).toBe(2);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /class-teachers/check-consistency
  // ───────────────────────────────────────────────────────────────
  describe('GET /class-teachers/check-consistency', () => {
    it('returns no inconsistencies when data is clean', async () => {
      const res = await request(app)
        .get(`${BASE}/class-teachers/check-consistency`)
        .set(headers)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body).toHaveProperty('hasInconsistencies');
      expect(res.body).toHaveProperty('inconsistencies');
    });
  });

  // ───────────────────────────────────────────────────────────────
  // POST /class-teachers/fix-duplicates
  // ───────────────────────────────────────────────────────────────
  describe('POST /class-teachers/fix-duplicates', () => {
    it('returns success with no fixes needed when no duplicates exist', async () => {
      const res = await request(app)
        .post(`${BASE}/class-teachers/fix-duplicates`)
        .set(headers)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.fixesApplied).toBe(0);
    });

    it('removes extra class-teacher assignments when duplicates exist', async () => {
      const teacher = await createStaffUser({
        name: 'Fix Teacher',
        email: 'fix.teacher.val@example.com',
        schoolId: school._id,
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
      });

      await Class.create({
        name: 'Fix Class A',
        section: 'A',
        classTeacherId: teacher._id,
        schoolId: school._id,
        subjects: ['Math'],
        academicYear: '2025-26',
      });
      await Class.create({
        name: 'Fix Class B',
        section: 'B',
        classTeacherId: teacher._id,
        schoolId: school._id,
        subjects: ['Math'],
        academicYear: '2025-26',
      });

      const res = await request(app)
        .post(`${BASE}/class-teachers/fix-duplicates`)
        .set(headers)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.fixesApplied).toBeGreaterThan(0);

      // Verify only one class still has this teacher assigned
      const classesWithTeacher = await Class.find({ classTeacherId: teacher._id });
      expect(classesWithTeacher).toHaveLength(1);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /class/:classId/empty-slots  (via validationService)
  // ───────────────────────────────────────────────────────────────
  describe('GET /class/:classId/empty-slots', () => {
    it('returns 401 without token', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      await request(app).get(`${BASE}/class/${fakeId}/empty-slots`).expect(401);
    });

    it('returns 500 with error message when no timetable exists for the class', async () => {
      // validationService.identifyEmptySlots throws when no timetable is found;
      // the route catches this and returns 500 with success: false.
      const cls = await createClassRecord({ schoolId: school._id, name: 'Slot Class' });

      const res = await request(app)
        .get(`${BASE}/class/${cls._id}/empty-slots`)
        .set(headers)
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/timetable not found/i);
    });
  });
});
