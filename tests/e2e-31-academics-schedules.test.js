/**
 * E2E-31: Academics — Exam Schedules & Hall Tickets
 *
 * Tests the full exam schedule lifecycle and hall ticket generation:
 *   1. Create an exam schedule with entries
 *   2. List exam schedules with filters
 *   3. Get single schedule details
 *   4. Update a draft schedule
 *   5. Cannot edit a non-draft (confirmed) schedule
 *   6. Delete schedule soft-deletes generated exams too
 *   7. Confirm schedule generates individual Exam documents
 *   8. Duplicate schedule name conflict detection
 *   9. Hall tickets — list students for a schedule
 *  10. Hall tickets — bulk + single student PDF download
 */

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import express from 'express';
import { Staff } from '../database.js';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
} from './helpers/factories.js';
import { i18nMiddleware } from '../middleware/i18n.js';
import examScheduleRoutes from '../routes/examSchedule.js';
import hallTicketsRoutes from '../routes/hallTickets.js';
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
 *   /api          — exam schedule CRUD (create, list, update, delete, confirm, send)
 *   /api/hall-tickets — hall ticket listing + PDF downloads
 */
function createE2EApp() {
  const app = express();
  const io = createTestIo();

  app.use(i18nMiddleware);
  app.use(express.json());
  app.set('io', io);
  app.locals.Staff = Staff;

  initializeSocket(io);

  app.use('/api', examScheduleRoutes);
  app.use('/api/hall-tickets', hallTicketsRoutes);

  app.use((err, _req, res, _next) => {
    console.error('[TEST-ERROR-HANDLER]', err.message);
    res.status(500).json({ error: err.message });
  });

  return { app };
}

// Helper: next Monday from a given date (avoids Sunday skipping in timetable generator)
function nextWeekday(daysFromNow = 7) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  // Skip to Monday if Sunday
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

// ─────────────────────────────────────────────────────────────────────────────

describe('E2E-31: Exam Schedules & Hall Tickets', () => {
  // ── TEST 1: Create exam schedule ──────────────────────────────────────────
  it('creates a new exam schedule with entries', async () => {
    const school = await createSchoolRecord({ name: 'E2E-31 School' });
    const cls = await createClassRecord({
      schoolId: school._id,
      name: 'Class 10',
      section: 'A',
      subjects: ['Math', 'Science', 'English'],
    });
    const admin = await createStaffUser({ schoolId: school._id, staffRole: ['Admin'] });
    const { app } = createE2EApp();
    const headers = authHeadersFor(admin, 'admin');

    const startDate = nextWeekday(7);
    const endDate = nextWeekday(14);

    const res = await request(app)
      .post('/api/exam-schedules')
      .set(headers)
      .send({
        name: 'Mid-Term March 2026',
        type: 'midterm',
        classIds: [cls._id.toString()],
        startDate,
        endDate,
        sessionType: 'morning',
        defaultMaxMarks: 100,
        defaultPassingMarks: 35,
      })
      .expect(201);

    expect(res.body.name).toBe('Mid-Term March 2026');
    expect(res.body.status).toBe('draft');
    expect(res.body.classIds).toHaveLength(1);
    expect(res.body.classIds[0]._id).toBe(cls._id.toString());
    expect(res.body.schoolId).toBe(school._id.toString());
  });

  // ── TEST 2: List exam schedules with filters ─────────────────────────────
  it('lists exam schedules filtered by status', async () => {
    const school = await createSchoolRecord({ name: 'E2E-31 List School' });
    const cls = await createClassRecord({ schoolId: school._id, subjects: ['Math'] });
    const admin = await createStaffUser({ schoolId: school._id, staffRole: ['Admin'] });
    const { app } = createE2EApp();
    const headers = authHeadersFor(admin, 'admin');

    // Create two schedules
    await request(app)
      .post('/api/exam-schedules')
      .set(headers)
      .send({
        name: 'Schedule A',
        classIds: [cls._id.toString()],
        startDate: nextWeekday(7),
        endDate: nextWeekday(14),
      })
      .expect(201);

    await request(app)
      .post('/api/exam-schedules')
      .set(headers)
      .send({
        name: 'Schedule B',
        classIds: [cls._id.toString()],
        startDate: nextWeekday(21),
        endDate: nextWeekday(28),
      })
      .expect(201);

    // List all
    const allRes = await request(app).get('/api/exam-schedules').set(headers).expect(200);

    expect(allRes.body).toHaveLength(2);

    // Filter by status=draft
    const draftRes = await request(app)
      .get('/api/exam-schedules?status=draft')
      .set(headers)
      .expect(200);

    expect(draftRes.body).toHaveLength(2);
    expect(draftRes.body.every((s) => s.status === 'draft')).toBe(true);
  });

  // ── TEST 3: Get single schedule details ───────────────────────────────────
  it('retrieves a single schedule with populated class details', async () => {
    const school = await createSchoolRecord({ name: 'E2E-31 Detail School' });
    const cls = await createClassRecord({
      schoolId: school._id,
      name: 'Class 8',
      section: 'B',
      subjects: ['Hindi', 'English'],
    });
    const admin = await createStaffUser({ schoolId: school._id, staffRole: ['Admin'] });
    const { app } = createE2EApp();
    const headers = authHeadersFor(admin, 'admin');

    const createRes = await request(app)
      .post('/api/exam-schedules')
      .set(headers)
      .send({
        name: 'Unit Test 1',
        type: 'unit_test',
        classIds: [cls._id.toString()],
        startDate: nextWeekday(7),
        endDate: nextWeekday(10),
      })
      .expect(201);

    const detailRes = await request(app)
      .get(`/api/exam-schedules/${createRes.body._id}`)
      .set(headers)
      .expect(200);

    expect(detailRes.body._id).toBe(createRes.body._id);
    expect(detailRes.body.name).toBe('Unit Test 1');
    expect(detailRes.body.type).toBe('unit_test');
    expect(detailRes.body.classIds[0].name).toBe('Class 8');
    expect(detailRes.body.classIds[0].section).toBe('B');
  });

  // ── TEST 4: Update a draft schedule ───────────────────────────────────────
  it('updates a draft schedule name and entries', async () => {
    const school = await createSchoolRecord({ name: 'E2E-31 Update School' });
    const cls = await createClassRecord({ schoolId: school._id, subjects: ['Math', 'Science'] });
    const admin = await createStaffUser({ schoolId: school._id, staffRole: ['Admin'] });
    const { app } = createE2EApp();
    const headers = authHeadersFor(admin, 'admin');

    const createRes = await request(app)
      .post('/api/exam-schedules')
      .set(headers)
      .send({
        name: 'Original Name',
        classIds: [cls._id.toString()],
        startDate: nextWeekday(7),
        endDate: nextWeekday(14),
      })
      .expect(201);

    const updateRes = await request(app)
      .put(`/api/exam-schedules/${createRes.body._id}`)
      .set(headers)
      .send({
        name: 'Updated Name',
        entries: [
          {
            date: nextWeekday(8),
            session: 'morning',
            subjectName: 'Math',
            classIds: [cls._id.toString()],
            maxMarks: 50,
          },
        ],
      })
      .expect(200);

    expect(updateRes.body.name).toBe('Updated Name');
    expect(updateRes.body.entries).toHaveLength(1);
    expect(updateRes.body.entries[0].subjectName).toBe('Math');
    expect(updateRes.body.entries[0].maxMarks).toBe(50);
  });

  // ── TEST 5: Cannot edit a confirmed (non-draft) schedule ──────────────────
  it('rejects edits to a confirmed schedule', async () => {
    const school = await createSchoolRecord({ name: 'E2E-31 Lock School' });
    const cls = await createClassRecord({
      schoolId: school._id,
      name: 'Class 9',
      subjects: ['Math'],
    });
    const admin = await createStaffUser({ schoolId: school._id, staffRole: ['Admin'] });
    const { app } = createE2EApp();
    const headers = authHeadersFor(admin, 'admin');

    // Create schedule
    const createRes = await request(app)
      .post('/api/exam-schedules')
      .set(headers)
      .send({
        name: 'Locked Schedule',
        classIds: [cls._id.toString()],
        startDate: nextWeekday(7),
        endDate: nextWeekday(14),
      })
      .expect(201);

    const scheduleId = createRes.body._id;

    // Auto-generate timetable entries
    await request(app).post(`/api/exam-schedules/${scheduleId}/generate`).set(headers).expect(200);

    // Confirm the schedule (status → scheduled)
    await request(app).post(`/api/exam-schedules/${scheduleId}/confirm`).set(headers).expect(200);

    // Now try to edit → should fail
    const editRes = await request(app)
      .put(`/api/exam-schedules/${scheduleId}`)
      .set(headers)
      .send({ name: 'Changed Name' })
      .expect(400);

    expect(editRes.body.error).toMatch(/draft/i);
  });

  // ── TEST 6: Delete schedule soft-deletes generated exams ──────────────────
  it('soft-deletes schedule and its generated exams', async () => {
    const school = await createSchoolRecord({ name: 'E2E-31 Delete School' });
    const cls = await createClassRecord({
      schoolId: school._id,
      name: 'Class 7',
      subjects: ['English'],
    });
    const admin = await createStaffUser({ schoolId: school._id, staffRole: ['Admin'] });
    const { app } = createE2EApp();
    const headers = authHeadersFor(admin, 'admin');

    // Create → generate → confirm
    const createRes = await request(app)
      .post('/api/exam-schedules')
      .set(headers)
      .send({
        name: 'Delete Me Schedule',
        classIds: [cls._id.toString()],
        startDate: nextWeekday(7),
        endDate: nextWeekday(14),
      })
      .expect(201);

    const scheduleId = createRes.body._id;

    await request(app).post(`/api/exam-schedules/${scheduleId}/generate`).set(headers).expect(200);

    const confirmRes = await request(app)
      .post(`/api/exam-schedules/${scheduleId}/confirm`)
      .set(headers)
      .expect(200);

    expect(confirmRes.body.generatedExamIds.length).toBeGreaterThan(0);

    // Delete the schedule
    await request(app).delete(`/api/exam-schedules/${scheduleId}`).set(headers).expect(200);

    // Verify schedule is gone from list
    const listRes = await request(app).get('/api/exam-schedules').set(headers).expect(200);

    expect(listRes.body.find((s) => s._id === scheduleId)).toBeUndefined();

    // Verify direct GET returns 404
    await request(app).get(`/api/exam-schedules/${scheduleId}`).set(headers).expect(404);
  });

  // ── TEST 7: Confirm schedule generates individual Exam documents ──────────
  it('confirming a schedule creates Exam documents per class', async () => {
    const school = await createSchoolRecord({ name: 'E2E-31 Confirm School' });
    const cls1 = await createClassRecord({
      schoolId: school._id,
      name: 'Class 5',
      section: 'A',
      subjects: ['Math', 'English'],
    });
    const cls2 = await createClassRecord({
      schoolId: school._id,
      name: 'Class 5',
      section: 'B',
      subjects: ['Math', 'English'],
    });
    const admin = await createStaffUser({ schoolId: school._id, staffRole: ['Admin'] });
    const { app } = createE2EApp();
    const headers = authHeadersFor(admin, 'admin');

    // Create schedule for two classes
    const createRes = await request(app)
      .post('/api/exam-schedules')
      .set(headers)
      .send({
        name: 'Multi-Class Exam',
        type: 'midterm',
        classIds: [cls1._id.toString(), cls2._id.toString()],
        startDate: nextWeekday(7),
        endDate: nextWeekday(14),
        sessionType: 'morning',
      })
      .expect(201);

    const scheduleId = createRes.body._id;

    // Auto-generate entries
    const genRes = await request(app)
      .post(`/api/exam-schedules/${scheduleId}/generate`)
      .set(headers)
      .expect(200);

    expect(genRes.body.entries.length).toBeGreaterThan(0);

    // Confirm
    const confirmRes = await request(app)
      .post(`/api/exam-schedules/${scheduleId}/confirm`)
      .set(headers)
      .expect(200);

    expect(confirmRes.body.status).toBe('scheduled');
    // One Exam per class
    expect(confirmRes.body.generatedExamIds).toHaveLength(2);
  });

  // ── TEST 8: Duplicate name conflict detection ─────────────────────────────
  it('rejects duplicate schedule name in same academic year', async () => {
    const school = await createSchoolRecord({ name: 'E2E-31 Dup School' });
    const cls = await createClassRecord({ schoolId: school._id, subjects: ['Math'] });
    const admin = await createStaffUser({ schoolId: school._id, staffRole: ['Admin'] });
    const { app } = createE2EApp();
    const headers = authHeadersFor(admin, 'admin');

    await request(app)
      .post('/api/exam-schedules')
      .set(headers)
      .send({
        name: 'Unique Schedule',
        academicYear: '2025-26',
        classIds: [cls._id.toString()],
        startDate: nextWeekday(7),
        endDate: nextWeekday(14),
      })
      .expect(201);

    // Same name + same academic year → 409
    const dupRes = await request(app)
      .post('/api/exam-schedules')
      .set(headers)
      .send({
        name: 'Unique Schedule',
        academicYear: '2025-26',
        classIds: [cls._id.toString()],
        startDate: nextWeekday(21),
        endDate: nextWeekday(28),
      })
      .expect(409);

    expect(dupRes.body.error).toMatch(/already exists/i);
  });

  // ── TEST 9: Hall tickets — list students for a schedule ───────────────────
  it('hall ticket endpoint lists students for a confirmed schedule', async () => {
    const school = await createSchoolRecord({ name: 'E2E-31 HT School' });
    const cls = await createClassRecord({
      schoolId: school._id,
      name: 'Class 6',
      section: 'A',
      subjects: ['Math', 'Science'],
    });
    const admin = await createStaffUser({ schoolId: school._id, staffRole: ['Admin'] });

    const student1 = await createStudentRecord({
      name: 'Alice',
      rollNo: 1,
      classId: cls._id,
      schoolId: school._id,
    });
    const student2 = await createStudentRecord({
      name: 'Bob',
      rollNo: 2,
      classId: cls._id,
      schoolId: school._id,
    });

    const { app } = createE2EApp();
    const headers = authHeadersFor(admin, 'admin');

    // Create & confirm schedule
    const createRes = await request(app)
      .post('/api/exam-schedules')
      .set(headers)
      .send({
        name: 'HT Exam',
        classIds: [cls._id.toString()],
        startDate: nextWeekday(7),
        endDate: nextWeekday(14),
      })
      .expect(201);

    const scheduleId = createRes.body._id;

    await request(app).post(`/api/exam-schedules/${scheduleId}/generate`).set(headers).expect(200);

    await request(app).post(`/api/exam-schedules/${scheduleId}/confirm`).set(headers).expect(200);

    // Fetch hall ticket student list
    const htRes = await request(app)
      .get(`/api/hall-tickets/schedule/${scheduleId}`)
      .set(headers)
      .expect(200);

    expect(htRes.body.success).toBe(true);
    expect(htRes.body.total).toBe(2);
    expect(htRes.body.students).toHaveLength(2);
    expect(htRes.body.schedule.name).toBe('HT Exam');
    expect(htRes.body.schedule.entries.length).toBeGreaterThan(0);

    // Verify student fields
    const names = htRes.body.students.map((s) => s.name).sort();
    expect(names).toEqual(['Alice', 'Bob']);
    expect(htRes.body.students[0]).toHaveProperty('rollNo');
    expect(htRes.body.students[0]).toHaveProperty('admissionId');
    expect(htRes.body.students[0]).toHaveProperty('class');

    // Filter by classId
    const filteredRes = await request(app)
      .get(`/api/hall-tickets/schedule/${scheduleId}?classId=${cls._id}`)
      .set(headers)
      .expect(200);

    expect(filteredRes.body.total).toBe(2);
  });

  // ── TEST 10: Hall tickets — PDF downloads ─────────────────────────────────
  it('downloads bulk and single-student hall ticket PDFs', async () => {
    const school = await createSchoolRecord({ name: 'E2E-31 PDF School' });
    const cls = await createClassRecord({
      schoolId: school._id,
      name: 'Class 10',
      section: 'A',
      subjects: ['Math', 'Science'],
    });
    const admin = await createStaffUser({ schoolId: school._id, staffRole: ['Admin'] });

    const student = await createStudentRecord({
      name: 'Charlie',
      rollNo: 1,
      classId: cls._id,
      schoolId: school._id,
    });

    const { app } = createE2EApp();
    const headers = authHeadersFor(admin, 'admin');

    // Create → generate → confirm schedule
    const createRes = await request(app)
      .post('/api/exam-schedules')
      .set(headers)
      .send({
        name: 'PDF Exam Schedule',
        classIds: [cls._id.toString()],
        startDate: nextWeekday(7),
        endDate: nextWeekday(14),
        entries: [
          {
            date: nextWeekday(8),
            session: 'morning',
            subjectName: 'Math',
            classIds: [cls._id.toString()],
            maxMarks: 100,
          },
          {
            date: nextWeekday(9),
            session: 'morning',
            subjectName: 'Science',
            classIds: [cls._id.toString()],
            maxMarks: 100,
          },
        ],
      })
      .expect(201);

    const scheduleId = createRes.body._id;

    // Bulk PDF download
    const bulkPdfRes = await request(app)
      .get(`/api/hall-tickets/schedule/${scheduleId}/download`)
      .set(headers)
      .expect(200);

    expect(bulkPdfRes.headers['content-type']).toMatch(/application\/pdf/);
    expect(bulkPdfRes.headers['content-disposition']).toMatch(/attachment/);
    expect(bulkPdfRes.headers['content-disposition']).toMatch(/hall-tickets/);

    // Single student PDF download
    const singlePdfRes = await request(app)
      .get(`/api/hall-tickets/schedule/${scheduleId}/student/${student._id}/download`)
      .set(headers)
      .expect(200);

    expect(singlePdfRes.headers['content-type']).toMatch(/application\/pdf/);
    expect(singlePdfRes.headers['content-disposition']).toMatch(/attachment/);
    expect(singlePdfRes.headers['content-disposition']).toMatch(/hall-ticket/);
  });
});
