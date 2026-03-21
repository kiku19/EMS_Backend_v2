/**
 * E2E-03: Attendance marking → parent notification → dashboard stats update
 *
 * Tests the full cross-system flow end-to-end:
 *   1. Teacher marks bulk attendance for a class with an absent student
 *   2. Parent of the absent student receives an in-app attendance notification
 *   3. Teacher's dashboard stats reflect attendanceMarked: true for that class
 */

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import express from 'express';
import { Staff } from '../database.js';
import Parent from '../models/Parent.js';
import Notification from '../models/Notification.js';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
} from './helpers/factories.js';
import { i18nMiddleware } from '../middleware/i18n.js';
import attendanceRoutes from '../routes/attendance.js';
import dashboardRoutes from '../routes/dashboard.js';
import { initializeSocket } from '../utils/socketEmitter.js';

function createTestIo() {
  return {
    emit() {},
    to() {
      return { emit() {} };
    },
  };
}

/**
 * Minimal app mounting only the routes required for this E2E flow:
 *   /api/attendance  — mark attendance (POST /class)
 *   /api/dashboard   — dashboard stats (GET /stats)
 */
function createE2EApp() {
  const app = express();
  const io = createTestIo();

  app.use(i18nMiddleware);
  app.use(express.json());
  app.set('io', io);
  app.locals.Staff = Staff;

  initializeSocket(io);

  app.use('/api/attendance', attendanceRoutes);
  app.use('/api/dashboard', dashboardRoutes);

  app.use((err, req, res, _next) => {
    console.error('[E2E-03-ERROR]', err.message);
    res.status(500).json({ error: err.message });
  });

  return { app };
}

/**
 * Poll the DB until a parent attendance notification appears or timeout expires.
 * notifyParentsOfAbsent() is fire-and-forget in the route handler, so the
 * notification may land slightly after the HTTP response returns.
 */
async function waitForAttendanceNotification(parentId, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const notification = await Notification.findOne({ userId: parentId, type: 'attendance' });
    if (notification) return notification;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('E2E-03: Attendance marking → parent notification → dashboard stats update', () => {
  it('completes the full attendance → notification → dashboard flow end-to-end', async () => {
    // ── Seed data ────────────────────────────────────────────────────────────
    const school = await createSchoolRecord({ name: 'E2E-03 School' });

    // Teacher with admin-level permissions (so checkPermission('students','edit') passes)
    // but JWT role 'teacher' so the dashboard uses the teacher branch
    const teacher = await createStaffUser({
      schoolId: school._id,
      name: 'Class Teacher E2E-03',
      staffRole: ['Teacher'],
      permissionRole: 'admin',
    });

    const classRecord = await createClassRecord({
      schoolId: school._id,
      classTeacherId: teacher._id,
      name: 'Class 8',
      section: 'B',
    });

    const absentStudent = await createStudentRecord({
      name: 'Absent Student',
      rollNo: 1,
      classId: classRecord._id,
      schoolId: school._id,
    });

    const presentStudent = await createStudentRecord({
      name: 'Present Student',
      rollNo: 2,
      classId: classRecord._id,
      schoolId: school._id,
    });

    // Parent linked to the absent student — notifyParentsOfAbsent queries
    // Parent by children.studentId
    const parent = await Parent.create({
      phone: '9000300003',
      name: 'Absent Student Parent',
      schoolId: school._id,
      status: 'active',
      password: 'TestPass@123',
      children: [{ studentId: absentStudent._id, relationship: 'father', isPrimary: true }],
    });

    const { app } = createE2EApp();

    // Use today's date — dashboard uses new Date().toISOString().split('T')[0]
    const today = new Date().toISOString().split('T')[0];

    // ── STEP 1: Teacher marks attendance with one absent student ─────────────
    // authHeadersFor(teacher, 'teacher') works because:
    //   - JWT role 'teacher' → dashboard uses teacher branch
    //   - UserPermission has admin template → checkPermission('students','edit') passes
    const markRes = await request(app)
      .post('/api/attendance/class')
      .set(authHeadersFor(teacher, 'teacher'))
      .send({
        classId: classRecord._id.toString(),
        date: today,
        attendance: [
          { studentId: absentStudent._id.toString(), status: 'absent' },
          { studentId: presentStudent._id.toString(), status: 'present' },
        ],
      })
      .expect(200);

    expect(markRes.body.success).toBe(true);
    expect(markRes.body.results).toHaveLength(2);

    // ── STEP 2: Parent receives an in-app attendance notification ────────────
    // notifyParentsOfAbsent() is not awaited in the route, so we poll until
    // the notification document lands in the DB.
    const notification = await waitForAttendanceNotification(parent._id);

    expect(notification).not.toBeNull();
    expect(notification.type).toBe('attendance');
    expect(notification.userModel).toBe('Parent');
    expect(notification.priority).toBe('high');
    expect(notification.message).toContain(today);

    // ── STEP 3: Teacher dashboard reflects attendanceMarked: true ────────────
    // Dashboard checks Attendance.distinct('classId', { schoolId, date: today })
    const dashRes = await request(app)
      .get('/api/dashboard/stats')
      .set(authHeadersFor(teacher, 'teacher'))
      .expect(200);

    expect(dashRes.body.role).toBe('teacher');
    expect(dashRes.body.myClassesCount).toBe(1);

    const markedClass = dashRes.body.myClasses.find((c) => c.id === classRecord._id.toString());
    expect(markedClass).toBeDefined();
    expect(markedClass.attendanceMarked).toBe(true);
  });

  it('does not notify parent when all students are marked present', async () => {
    const school = await createSchoolRecord({ name: 'E2E-03 All-Present School' });

    const teacher = await createStaffUser({
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'admin',
    });

    const classRecord = await createClassRecord({
      schoolId: school._id,
      classTeacherId: teacher._id,
    });

    const student = await createStudentRecord({
      classId: classRecord._id,
      schoolId: school._id,
    });

    const parent = await Parent.create({
      phone: '9000300099',
      name: 'Present Student Parent',
      schoolId: school._id,
      status: 'active',
      password: 'TestPass@123',
      children: [{ studentId: student._id, relationship: 'mother', isPrimary: true }],
    });

    const { app } = createE2EApp();
    const today = new Date().toISOString().split('T')[0];

    await request(app)
      .post('/api/attendance/class')
      .set(authHeadersFor(teacher, 'teacher'))
      .send({
        classId: classRecord._id.toString(),
        date: today,
        attendance: [{ studentId: student._id.toString(), status: 'present' }],
      })
      .expect(200);

    // Brief wait to confirm no notification is created
    await new Promise((resolve) => setTimeout(resolve, 300));

    const notification = await Notification.findOne({ userId: parent._id, type: 'attendance' });
    expect(notification).toBeNull();
  });

  it('dashboard shows attendanceMarked: false before attendance is marked', async () => {
    const school = await createSchoolRecord({ name: 'E2E-03 Pre-Mark School' });

    const teacher = await createStaffUser({
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });

    await createClassRecord({
      schoolId: school._id,
      classTeacherId: teacher._id,
      name: 'Class 9',
      section: 'A',
    });

    const { app } = createE2EApp();

    const dashRes = await request(app)
      .get('/api/dashboard/stats')
      .set(authHeadersFor(teacher, 'teacher'))
      .expect(200);

    expect(dashRes.body.role).toBe('teacher');
    expect(dashRes.body.myClassesCount).toBe(1);
    expect(dashRes.body.myClasses[0].attendanceMarked).toBe(false);
  });

  // ── Auth boundary tests ───────────────────────────────────────────────────

  it('returns 401 when marking attendance without auth token', async () => {
    const { app } = createE2EApp();
    const today = new Date().toISOString().split('T')[0];

    await request(app)
      .post('/api/attendance/class')
      .send({ classId: 'abc123', date: today, attendance: [] })
      .expect(401);
  });

  it('returns 401 when fetching dashboard stats without auth token', async () => {
    const { app } = createE2EApp();

    await request(app).get('/api/dashboard/stats').expect(401);
  });
});
