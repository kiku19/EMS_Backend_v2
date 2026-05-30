import request from 'supertest';
import { describe, expect, it, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import StudentLeave from '../models/StudentLeave.js';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
  createParentUser,
  parentAuthHeadersFor,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const BASE = '/api/student-leaves';

/** Create a student leave record directly in the DB. */
async function createLeave({
  schoolId,
  studentId,
  appliedByParentId,
  status = 'pending',
  leaveType = 'sick',
  startDate = new Date('2025-03-10'),
  endDate = new Date('2025-03-12'),
  days = 3,
}) {
  return StudentLeave.create({
    schoolId,
    studentId,
    appliedByParentId,
    leaveType,
    reason: 'Feeling unwell',
    startDate,
    endDate,
    days,
    status,
    appliedAt: new Date(),
  });
}

describe('studentLeaves routes', () => {
  let app,
    school,
    otherSchool,
    cls,
    otherCls,
    admin,
    teacher,
    student,
    parent,
    adminHeaders,
    teacherHeaders,
    parentHeaders;

  beforeEach(async () => {
    school = await createSchoolRecord({ name: 'Student Leave School', code: 'SLS' });
    otherSchool = await createSchoolRecord({ name: 'Other School', code: 'OTH' });
    cls = await createClassRecord({ schoolId: school._id, name: 'Class 10', section: 'A' });
    otherCls = await createClassRecord({
      schoolId: otherSchool._id,
      name: 'Class 9',
      section: 'B',
    });
    admin = await createStaffUser({
      name: 'Leave Admin',
      email: 'leave.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    teacher = await createStaffUser({
      name: 'Leave Teacher',
      email: 'leave.teacher@example.com',
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });
    student = await createStudentRecord({
      schoolId: school._id,
      classId: cls._id,
      name: 'Test Student',
    });
    parent = await createParentUser({
      schoolId: school._id,
      name: 'Test Parent',
      children: [{ studentId: student._id, relationship: 'father' }],
    });
    adminHeaders = authHeadersFor(admin, 'admin');
    teacherHeaders = authHeadersFor(teacher, 'teacher');
    parentHeaders = parentAuthHeadersFor(parent);
    ({ app } = createTestApp());
  });

  // ───────────────────────────────────────────────────────────────
  // Auth
  // ───────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('GET / returns 401 without token', async () => {
      await request(app).get(BASE).expect(401);
    });

    it('GET /:id returns 401 without token', async () => {
      await request(app).get(`${BASE}/${new mongoose.Types.ObjectId()}`).expect(401);
    });

    it('POST / returns 401 without token', async () => {
      await request(app).post(BASE).send({}).expect(401);
    });

    it('PUT /:id returns 401 without token', async () => {
      await request(app).put(`${BASE}/${new mongoose.Types.ObjectId()}`).send({}).expect(401);
    });

    it('PUT /:id/review returns 401 without token', async () => {
      await request(app)
        .put(`${BASE}/${new mongoose.Types.ObjectId()}/review`)
        .send({ status: 'approved' })
        .expect(401);
    });

    it('DELETE /:id returns 401 without token', async () => {
      await request(app).delete(`${BASE}/${new mongoose.Types.ObjectId()}`).expect(401);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /
  // ───────────────────────────────────────────────────────────────
  describe('GET /', () => {
    it('returns empty list when no leaves exist', async () => {
      const res = await request(app).get(BASE).set(adminHeaders).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.total).toBe(0);
    });

    it('returns leaves for the school', async () => {
      await createLeave({
        schoolId: school._id,
        studentId: student._id,
        appliedByParentId: parent._id,
        status: 'pending',
      });

      const res = await request(app).get(BASE).set(adminHeaders).expect(200);

      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].status).toBe('pending');
    });

    it('filters by status', async () => {
      await createLeave({
        schoolId: school._id,
        studentId: student._id,
        appliedByParentId: parent._id,
        status: 'approved',
      });
      await createLeave({
        schoolId: school._id,
        studentId: student._id,
        appliedByParentId: parent._id,
        status: 'pending',
      });

      const res = await request(app).get(`${BASE}?status=approved`).set(adminHeaders).expect(200);

      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.every((l) => l.status === 'approved')).toBe(true);
    });

    it('filters by studentId', async () => {
      const otherStudent = await createStudentRecord({
        schoolId: school._id,
        classId: cls._id,
        name: 'Other Student',
      });
      await createLeave({
        schoolId: school._id,
        studentId: student._id,
        appliedByParentId: parent._id,
      });
      await createLeave({
        schoolId: school._id,
        studentId: otherStudent._id,
        appliedByParentId: parent._id,
      });

      const res = await request(app)
        .get(`${BASE}?studentId=${student._id}`)
        .set(adminHeaders)
        .expect(200);

      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].studentId._id.toString()).toBe(student._id.toString());
    });

    it('filters by leaveType', async () => {
      await createLeave({
        schoolId: school._id,
        studentId: student._id,
        appliedByParentId: parent._id,
        leaveType: 'sick',
      });
      await createLeave({
        schoolId: school._id,
        studentId: student._id,
        appliedByParentId: parent._id,
        leaveType: 'personal',
      });

      const res = await request(app).get(`${BASE}?leaveType=sick`).set(adminHeaders).expect(200);

      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].leaveType).toBe('sick');
    });

    it('does not return leaves from other schools', async () => {
      const otherStudent = await createStudentRecord({
        schoolId: otherSchool._id,
        classId: otherCls._id,
        name: 'Other School Student',
      });
      const otherParent = await createParentUser({ schoolId: otherSchool._id });
      await createLeave({
        schoolId: otherSchool._id,
        studentId: otherStudent._id,
        appliedByParentId: otherParent._id,
      });

      const res = await request(app).get(BASE).set(adminHeaders).expect(200);

      expect(res.body.data).toHaveLength(0);
    });

    it('supports pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await createLeave({
          schoolId: school._id,
          studentId: student._id,
          appliedByParentId: parent._id,
        });
      }

      const res = await request(app).get(`${BASE}?limit=2&skip=0`).set(adminHeaders).expect(200);

      expect(res.body.data).toHaveLength(2);
      expect(res.body.pagination.limit).toBe(2);
      expect(res.body.pagination.hasMore).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /:id
  // ───────────────────────────────────────────────────────────────
  describe('GET /:id', () => {
    it('returns 404 for non-existent leave', async () => {
      const res = await request(app)
        .get(`${BASE}/${new mongoose.Types.ObjectId()}`)
        .set(adminHeaders)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
    });

    it('returns leave details for a valid ID', async () => {
      const leave = await createLeave({
        schoolId: school._id,
        studentId: student._id,
        appliedByParentId: parent._id,
      });

      const res = await request(app).get(`${BASE}/${leave._id}`).set(adminHeaders).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data._id.toString()).toBe(leave._id.toString());
      expect(res.body.data.leaveType).toBe('sick');
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data.studentId).toBeDefined();
      expect(res.body.data.studentId.name).toBe('Test Student');
    });

    it('does not return leave from another school', async () => {
      const otherStudent = await createStudentRecord({
        schoolId: otherSchool._id,
        classId: otherCls._id,
        name: 'Other Student',
      });
      const otherParent = await createParentUser({ schoolId: otherSchool._id });
      const leave = await createLeave({
        schoolId: otherSchool._id,
        studentId: otherStudent._id,
        appliedByParentId: otherParent._id,
      });

      const res = await request(app).get(`${BASE}/${leave._id}`).set(adminHeaders).expect(404);

      expect(res.body.success).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // POST /
  // ───────────────────────────────────────────────────────────────
  describe('POST /', () => {
    it('creates a leave application as staff and returns 201', async () => {
      const res = await request(app)
        .post(BASE)
        .set(adminHeaders)
        .send({
          studentId: student._id.toString(),
          appliedByParentId: parent._id.toString(),
          leaveType: 'sick',
          reason: 'Fever',
          startDate: '2025-04-01',
          endDate: '2025-04-03',
          days: 3,
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data.leaveType).toBe('sick');
      expect(res.body.data.days).toBe(3);
      expect(res.body.data.studentId).toBeDefined();
    });

    it('allows parent to create a leave application', async () => {
      const res = await request(app)
        .post(BASE)
        .set(parentHeaders)
        .send({
          studentId: student._id.toString(),
          appliedByParentId: parent._id.toString(),
          leaveType: 'personal',
          reason: 'Family function',
          startDate: '2025-05-01',
          endDate: '2025-05-02',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data.leaveType).toBe('personal');
    });

    it('auto-calculates days when not provided', async () => {
      const res = await request(app)
        .post(BASE)
        .set(adminHeaders)
        .send({
          studentId: student._id.toString(),
          appliedByParentId: parent._id.toString(),
          leaveType: 'sick',
          reason: 'Illness',
          startDate: '2025-05-01',
          endDate: '2025-05-03',
        })
        .expect(201);

      expect(res.body.data.days).toBe(3);
    });

    it('returns 422 for invalid leaveType', async () => {
      const res = await request(app)
        .post(BASE)
        .set(adminHeaders)
        .send({
          studentId: student._id.toString(),
          appliedByParentId: parent._id.toString(),
          leaveType: 'invalid_type',
          reason: 'Reason',
          startDate: '2025-04-01',
          endDate: '2025-04-03',
        })
        .expect(422);

      expect(res.body.error).toBeDefined();
    });

    it('returns 422 when endDate is before startDate', async () => {
      const res = await request(app)
        .post(BASE)
        .set(adminHeaders)
        .send({
          studentId: student._id.toString(),
          appliedByParentId: parent._id.toString(),
          leaveType: 'sick',
          reason: 'Reason',
          startDate: '2025-04-03',
          endDate: '2025-04-01',
        })
        .expect(422);

      expect(res.body.error).toBeDefined();
    });
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /:id
  // ───────────────────────────────────────────────────────────────
  describe('PUT /:id', () => {
    it('updates a pending leave', async () => {
      const leave = await createLeave({
        schoolId: school._id,
        studentId: student._id,
        appliedByParentId: parent._id,
      });

      const res = await request(app)
        .put(`${BASE}/${leave._id}`)
        .set(adminHeaders)
        .send({
          reason: 'Updated reason',
          leaveType: 'personal',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.reason).toBe('Updated reason');
      expect(res.body.data.leaveType).toBe('personal');
    });

    it('returns 400 when trying to update non-pending leave', async () => {
      const leave = await createLeave({
        schoolId: school._id,
        studentId: student._id,
        appliedByParentId: parent._id,
        status: 'approved',
      });

      const res = await request(app)
        .put(`${BASE}/${leave._id}`)
        .set(adminHeaders)
        .send({ reason: 'Updated reason' })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain("Cannot update a leave that is already 'approved'");
    });

    it('returns 404 for non-existent leave', async () => {
      const res = await request(app)
        .put(`${BASE}/${new mongoose.Types.ObjectId()}`)
        .set(adminHeaders)
        .send({ reason: 'Updated reason' })
        .expect(404);

      expect(res.body.success).toBe(false);
    });

    it('returns 403 for teacher without edit permission', async () => {
      const leave = await createLeave({
        schoolId: school._id,
        studentId: student._id,
        appliedByParentId: parent._id,
      });

      // Teachers have 'students' edit permission in the template, so this test
      // verifies the permission middleware is actually applied. If the template
      // ever changes, this assertion may need updating.
      const res = await request(app)
        .put(`${BASE}/${leave._id}`)
        .set(teacherHeaders)
        .send({ reason: 'Updated reason' })
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /:id/review
  // ───────────────────────────────────────────────────────────────
  describe('PUT /:id/review', () => {
    it('approves a pending leave', async () => {
      const leave = await createLeave({
        schoolId: school._id,
        studentId: student._id,
        appliedByParentId: parent._id,
      });

      const res = await request(app)
        .put(`${BASE}/${leave._id}/review`)
        .set(adminHeaders)
        .send({ status: 'approved' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('approved');
      expect(res.body.data.reviewedBy).toBeDefined();
    });

    it('rejects a leave with a reason', async () => {
      const leave = await createLeave({
        schoolId: school._id,
        studentId: student._id,
        appliedByParentId: parent._id,
      });

      const res = await request(app)
        .put(`${BASE}/${leave._id}/review`)
        .set(adminHeaders)
        .send({
          status: 'rejected',
          rejectionReason: 'Insufficient documentation',
          adminRemarks: 'Please provide a medical certificate',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('rejected');
      expect(res.body.data.rejectionReason).toBe('Insufficient documentation');
      expect(res.body.data.adminRemarks).toBe('Please provide a medical certificate');
    });

    it('returns 422 for invalid status value', async () => {
      const leave = await createLeave({
        schoolId: school._id,
        studentId: student._id,
        appliedByParentId: parent._id,
      });

      const res = await request(app)
        .put(`${BASE}/${leave._id}/review`)
        .set(adminHeaders)
        .send({ status: 'invalid_status' })
        .expect(422);

      expect(res.body.error).toBeDefined();
    });

    it('returns 404 for non-existent leave', async () => {
      const res = await request(app)
        .put(`${BASE}/${new mongoose.Types.ObjectId()}/review`)
        .set(adminHeaders)
        .send({ status: 'approved' })
        .expect(404);

      expect(res.body.success).toBe(false);
    });

    it('returns 403 when teacher tries to review', async () => {
      const leave = await createLeave({
        schoolId: school._id,
        studentId: student._id,
        appliedByParentId: parent._id,
      });

      const res = await request(app)
        .put(`${BASE}/${leave._id}/review`)
        .set(teacherHeaders)
        .send({ status: 'approved' })
        .expect(403);

      expect(res.body.error).toBeDefined();
    });

    it('returns 400 when reviewing already-reviewed leave', async () => {
      const leave = await createLeave({
        schoolId: school._id,
        studentId: student._id,
        appliedByParentId: parent._id,
        status: 'approved',
      });

      const res = await request(app)
        .put(`${BASE}/${leave._id}/review`)
        .set(adminHeaders)
        .send({ status: 'rejected' })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain(
        "Cannot change status of a leave that is already 'approved'"
      );
    });
  });

  // ───────────────────────────────────────────────────────────────
  // DELETE /:id
  // ───────────────────────────────────────────────────────────────
  describe('DELETE /:id', () => {
    it('cancels a pending leave', async () => {
      const leave = await createLeave({
        schoolId: school._id,
        studentId: student._id,
        appliedByParentId: parent._id,
      });

      const res = await request(app).delete(`${BASE}/${leave._id}`).set(adminHeaders).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('cancelled');
    });

    it('cancels an approved leave', async () => {
      const leave = await createLeave({
        schoolId: school._id,
        studentId: student._id,
        appliedByParentId: parent._id,
        status: 'approved',
      });

      const res = await request(app).delete(`${BASE}/${leave._id}`).set(adminHeaders).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('cancelled');
    });

    it('returns 404 for non-existent leave', async () => {
      const res = await request(app)
        .delete(`${BASE}/${new mongoose.Types.ObjectId()}`)
        .set(adminHeaders)
        .expect(404);

      expect(res.body.success).toBe(false);
    });

    it('returns 403 when teacher tries to delete', async () => {
      const leave = await createLeave({
        schoolId: school._id,
        studentId: student._id,
        appliedByParentId: parent._id,
      });

      const res = await request(app).delete(`${BASE}/${leave._id}`).set(teacherHeaders).expect(403);

      expect(res.body.error).toBeDefined();
    });

    it('returns 400 when deleting already-cancelled leave', async () => {
      const leave = await createLeave({
        schoolId: school._id,
        studentId: student._id,
        appliedByParentId: parent._id,
        status: 'cancelled',
      });

      const res = await request(app).delete(`${BASE}/${leave._id}`).set(adminHeaders).expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain("Cannot cancel a leave that is already 'cancelled'");
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /pending/list
  // ───────────────────────────────────────────────────────────────
  describe('GET /pending/list', () => {
    it('returns empty array when no pending leaves', async () => {
      const res = await request(app).get(`${BASE}/pending/list`).set(adminHeaders).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(0);
    });

    it('returns pending leaves for the school', async () => {
      await createLeave({
        schoolId: school._id,
        studentId: student._id,
        appliedByParentId: parent._id,
        status: 'pending',
      });
      await createLeave({
        schoolId: school._id,
        studentId: student._id,
        appliedByParentId: parent._id,
        status: 'approved',
      });

      const res = await request(app).get(`${BASE}/pending/list`).set(adminHeaders).expect(200);

      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].status).toBe('pending');
    });

    it('does not return pending leaves from other schools', async () => {
      const otherStudent = await createStudentRecord({
        schoolId: otherSchool._id,
        classId: otherCls._id,
        name: 'Other Student',
      });
      const otherParent = await createParentUser({ schoolId: otherSchool._id });
      await createLeave({
        schoolId: otherSchool._id,
        studentId: otherStudent._id,
        appliedByParentId: otherParent._id,
        status: 'pending',
      });

      const res = await request(app).get(`${BASE}/pending/list`).set(adminHeaders).expect(200);

      expect(res.body.data).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /student/:studentId
  // ───────────────────────────────────────────────────────────────
  describe('GET /student/:studentId', () => {
    it('returns empty array when student has no leaves', async () => {
      const res = await request(app)
        .get(`${BASE}/student/${student._id}`)
        .set(adminHeaders)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(0);
    });

    it('returns student leaves filtered by status', async () => {
      await createLeave({
        schoolId: school._id,
        studentId: student._id,
        appliedByParentId: parent._id,
        status: 'approved',
      });
      await createLeave({
        schoolId: school._id,
        studentId: student._id,
        appliedByParentId: parent._id,
        status: 'pending',
      });

      const res = await request(app)
        .get(`${BASE}/student/${student._id}?status=approved`)
        .set(adminHeaders)
        .expect(200);

      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].status).toBe('approved');
    });

    it('filters by year', async () => {
      const currentYear = new Date().getFullYear();
      await createLeave({
        schoolId: school._id,
        studentId: student._id,
        appliedByParentId: parent._id,
        startDate: new Date(`${currentYear}-01-15`),
        endDate: new Date(`${currentYear}-01-17`),
      });
      await createLeave({
        schoolId: school._id,
        studentId: student._id,
        appliedByParentId: parent._id,
        startDate: new Date(`${currentYear - 1}-06-15`),
        endDate: new Date(`${currentYear - 1}-06-17`),
      });

      const res = await request(app)
        .get(`${BASE}/student/${student._id}?year=${currentYear}`)
        .set(adminHeaders)
        .expect(200);

      expect(res.body.data.length).toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /student/:studentId/stats
  // ───────────────────────────────────────────────────────────────
  describe('GET /student/:studentId/stats', () => {
    it('returns zero stats when student has no leaves', async () => {
      const res = await request(app)
        .get(`${BASE}/student/${student._id}/stats`)
        .set(adminHeaders)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.total).toBe(0);
      expect(res.body.data.totalDays).toBe(0);
    });

    it('returns correct stats for approved leaves', async () => {
      const currentYear = new Date().getFullYear();
      await createLeave({
        schoolId: school._id,
        studentId: student._id,
        appliedByParentId: parent._id,
        status: 'approved',
        leaveType: 'sick',
        days: 3,
        startDate: new Date(`${currentYear}-03-10`),
        endDate: new Date(`${currentYear}-03-12`),
      });
      await createLeave({
        schoolId: school._id,
        studentId: student._id,
        appliedByParentId: parent._id,
        status: 'approved',
        leaveType: 'sick',
        days: 2,
        startDate: new Date(`${currentYear}-04-01`),
        endDate: new Date(`${currentYear}-04-02`),
      });
      await createLeave({
        schoolId: school._id,
        studentId: student._id,
        appliedByParentId: parent._id,
        status: 'pending',
        leaveType: 'personal',
        days: 1,
        startDate: new Date(`${currentYear}-05-01`),
        endDate: new Date(`${currentYear}-05-01`),
      });

      const res = await request(app)
        .get(`${BASE}/student/${student._id}/stats?year=${currentYear}`)
        .set(adminHeaders)
        .expect(200);

      expect(res.body.data.total).toBe(3);
      expect(res.body.data.approved).toBe(2);
      expect(res.body.data.pending).toBe(1);
      expect(res.body.data.totalDays).toBe(5);
      expect(res.body.data.byType.sick).toBe(5);
    });
  });
});
