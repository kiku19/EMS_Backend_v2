/**
 * E2E-07: Parent login → view child data → send message → teacher receives
 *
 * Tests the full cross-role flow:
 *   1. Parent authenticates via phone+password login
 *   2. Parent accesses published child results
 *   3. Parent sends a direct message to the class teacher
 *   4. Teacher can see the conversation and unread message in their inbox
 */

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import express from 'express';
import Parent from '../models/Parent.js';
import { Exam, Result, Staff } from '../database.js';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
} from './helpers/factories.js';
import { i18nMiddleware } from '../middleware/i18n.js';
import parentAuthRoutes from '../routes/parentAuth.js';
import parentDataRoutes from '../routes/parentData.js';
import parentMessagingRoutes from '../routes/parentMessaging.js';
import messageRoutes from '../routes/messages.js';
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
 *   /api/parent/auth     — parent login
 *   /api/parent          — parent data (results, attendance, etc.)
 *   /api/parent/messages — parent messaging (send/read)
 *   /api/messages        — staff/teacher conversation inbox
 */
function createE2EApp() {
  const app = express();
  const io = createTestIo();

  app.use(i18nMiddleware);
  app.use(express.json());
  app.set('io', io);
  app.locals.Staff = Staff;

  initializeSocket(io);

  // Mount auth before /api/parent so login isn't swallowed by parentDataRoutes
  app.use('/api/parent/auth', parentAuthRoutes);
  app.use('/api/parent', parentDataRoutes);
  app.use('/api/parent/messages', parentMessagingRoutes);
  app.use('/api/messages', messageRoutes);

  return { app };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('E2E-07: Parent login → view child data → send message → teacher receives', () => {
  it('completes the full parent→teacher messaging flow end-to-end', async () => {
    // ── Seed data ────────────────────────────────────────────────────────────
    const school = await createSchoolRecord({ name: 'E2E-07 School' });
    const classRecord = await createClassRecord({ schoolId: school._id });

    const teacher = await createStaffUser({
      schoolId: school._id,
      staffRole: ['Teacher'],
      name: 'Class Teacher',
    });

    const student = await createStudentRecord({
      name: 'Test Child',
      classId: classRecord._id,
      schoolId: school._id,
    });

    // Parent with password — pre-save hook will hash it
    const parent = await Parent.create({
      phone: '9876543210',
      name: 'Test Parent',
      schoolId: school._id,
      status: 'active',
      password: 'TestPass@123',
      children: [{ studentId: student._id, relationship: 'father', isPrimary: true }],
    });

    // Published exam result so parent can see child data
    const exam = await Exam.create({
      schoolId: school._id,
      name: 'Term 1 Exam',
      examType: 'midterm',
      classId: classRecord._id,
      academicYear: '2025-26',
      maxMarks: 100,
      status: 'results_published',
      isPublished: true,
    });

    await Result.create({
      schoolId: school._id,
      examId: exam._id,
      studentId: student._id,
      classId: classRecord._id,
      academicYear: '2025-26',
      marksObtained: 78,
      maxMarks: 100,
      percentage: 78,
      grade: 'B+',
      status: 'passed',
      isPublished: true,
    });

    const { app } = createE2EApp();

    // ── STEP 1: Parent login ──────────────────────────────────────────────────
    const loginRes = await request(app)
      .post('/api/parent/auth/login')
      .send({ identifier: '9876543210', password: 'TestPass@123' })
      .expect(200);

    expect(loginRes.body.success).toBe(true);
    expect(loginRes.body.data.parent.name).toBe('Test Parent');

    const { accessToken } = loginRes.body.data;
    expect(accessToken).toBeTruthy();

    const parentHeader = { Authorization: `Bearer ${accessToken}` };

    // ── STEP 2: Parent views child results ───────────────────────────────────
    const resultsRes = await request(app)
      .get(`/api/parent/students/${student._id}/results`)
      .set(parentHeader)
      .expect(200);

    expect(resultsRes.body.success).toBe(true);
    expect(resultsRes.body.data.results).toHaveLength(1);

    const result = resultsRes.body.data.results[0];
    expect(result.marksObtained).toBe(78);
    expect(result.isPublished).toBe(true);

    // ── STEP 3: Parent sends message to teacher ──────────────────────────────
    const messageContent = "Hello teacher, I wanted to discuss my child's progress.";

    const sendRes = await request(app)
      .post('/api/parent/messages')
      .set(parentHeader)
      .send({
        receiverId: teacher._id.toString(),
        receiverModel: 'staff',
        content: messageContent,
        type: 'text',
      })
      .expect(201);

    expect(sendRes.body.success).toBe(true);
    expect(sendRes.body.data.content).toBe(messageContent);

    const conversationId = sendRes.body.data.conversationId;
    expect(conversationId).toBeTruthy();

    // ── STEP 4: Teacher receives the message ─────────────────────────────────
    const teacherConvsRes = await request(app)
      .get(`/api/messages/conversations?userId=${teacher._id}&userType=staff`)
      .set(authHeadersFor(teacher, 'teacher'))
      .expect(200);

    expect(Array.isArray(teacherConvsRes.body)).toBe(true);

    const teacherConv = teacherConvsRes.body.find(
      (c) => c.id?.toString() === conversationId?.toString()
    );

    expect(teacherConv).toBeDefined();
    expect(teacherConv.unreadCount).toBe(1);
    expect(teacherConv.lastMessage.content).toBe(messageContent);
  });

  // ── Auth boundary tests ──────────────────────────────────────────────────

  it('returns 401 for child data without auth token', async () => {
    const classRecord = await createClassRecord();
    const student = await createStudentRecord({ classId: classRecord._id });
    const { app } = createE2EApp();

    await request(app).get(`/api/parent/students/${student._id}/results`).expect(401);
  });

  it('returns 401 for messaging without auth token', async () => {
    const { app } = createE2EApp();

    await request(app)
      .post('/api/parent/messages')
      .send({ content: 'hello', type: 'text' })
      .expect(401);
  });

  it("returns 403 when parent tries to access another parent's child data", async () => {
    const school = await createSchoolRecord({ name: 'E2E-07 Access School' });
    const classRecord = await createClassRecord({ schoolId: school._id });

    const ownChild = await createStudentRecord({
      name: 'Own Child',
      classId: classRecord._id,
      schoolId: school._id,
    });

    const otherChild = await createStudentRecord({
      name: 'Other Child',
      admissionId: 'ADM-E2E-9999',
      rollNo: 99,
      classId: classRecord._id,
      schoolId: school._id,
    });

    const parent = await Parent.create({
      phone: '9000000001',
      name: 'Limited Parent',
      schoolId: school._id,
      status: 'active',
      password: 'TestPass@123',
      children: [{ studentId: ownChild._id, relationship: 'mother', isPrimary: true }],
    });

    const { app } = createE2EApp();

    const loginRes = await request(app)
      .post('/api/parent/auth/login')
      .send({ identifier: '9000000001', password: 'TestPass@123' })
      .expect(200);

    const { accessToken } = loginRes.body.data;

    await request(app)
      .get(`/api/parent/students/${otherChild._id}/results`)
      .set({ Authorization: `Bearer ${accessToken}` })
      .expect(403);
  });

  it('returns 401 for invalid parent login credentials', async () => {
    const school = await createSchoolRecord({ name: 'E2E-07 Auth School' });

    await Parent.create({
      phone: '9111111111',
      name: 'Auth Test Parent',
      schoolId: school._id,
      status: 'active',
      password: 'CorrectPass@123',
      children: [],
    });

    const { app } = createE2EApp();

    const res = await request(app)
      .post('/api/parent/auth/login')
      .send({ identifier: '9111111111', password: 'WrongPassword' })
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});
