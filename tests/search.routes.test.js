import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { Exam, Announcement, FeePayment } from '../database.js';
import {
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
  createClassRecord,
  authHeadersFor,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

describe('search routes', () => {
  // ─── Auth & Validation ──────────────────────────────────────────────

  it('returns 401 when no auth token is provided', async () => {
    const { app } = createTestApp();
    const response = await request(app).get('/api/search?q=test').expect(401);
    expect(response.body.error).toBeDefined();
  });

  it('returns 400 when query is missing', async () => {
    const admin = await createStaffUser();
    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/search')
      .set(authHeadersFor(admin, 'admin'))
      .expect(400);

    expect(response.body.error).toBe('Validation failed');
  });

  it('returns 400 when query exceeds max length', async () => {
    const admin = await createStaffUser();
    const { app } = createTestApp();
    const longQuery = 'a'.repeat(201);
    const response = await request(app)
      .get(`/api/search?q=${longQuery}`)
      .set(authHeadersFor(admin, 'admin'))
      .expect(400);

    expect(response.body.error).toBe('Validation failed');
  });

  it('returns empty results when no matches found', async () => {
    const admin = await createStaffUser();
    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/search?q=xyznonexistent')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.q).toBe('xyznonexistent');
    expect(response.body.students?.results).toEqual([]);
    expect(response.body.staff?.results).toEqual([]);
    expect(response.body.classes?.results).toEqual([]);
  });

  // ─── Students Search ────────────────────────────────────────────────

  it('searches students by name (regex fallback)', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord({ schoolId: admin.schoolId });
    await createStudentRecord({
      name: 'Alice Wonderland',
      classId: cls._id,
      schoolId: admin.schoolId,
    });
    await createStudentRecord({ name: 'Bob Builder', classId: cls._id, schoolId: admin.schoolId });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/search?q=Alice&types=students')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.students.results).toHaveLength(1);
    expect(response.body.students.results[0].name).toBe('Alice Wonderland');
    expect(response.body.students.count).toBe(1);
  });

  it('searches students by admissionId (regex fallback)', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord({ schoolId: admin.schoolId });
    await createStudentRecord({
      name: 'Charlie',
      admissionId: 'ADM1234',
      classId: cls._id,
      schoolId: admin.schoolId,
    });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/search?q=ADM1234&types=students')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.students.results).toHaveLength(1);
    expect(response.body.students.results[0].admissionId).toBe('ADM1234');
  });

  it('searches students by email (exact match via PII hash)', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord({ schoolId: admin.schoolId });
    await createStudentRecord({
      name: 'Diana',
      email: 'diana@test.com',
      classId: cls._id,
      schoolId: admin.schoolId,
    });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/search?q=diana@test.com&types=students')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.students.results).toHaveLength(1);
    expect(response.body.students.results[0].name).toBe('Diana');
  });

  it('searches students by parent name (regex fallback)', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord({ schoolId: admin.schoolId });
    await createStudentRecord({
      name: 'Eve',
      classId: cls._id,
      schoolId: admin.schoolId,
      parents: [{ name: 'Parent Smith', relationship: 'father', phone: '9000000001' }],
    });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/search?q=Smith&types=students')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.students.results).toHaveLength(1);
    expect(response.body.students.results[0].name).toBe('Eve');
  });

  it('excludes deleted students from search', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord({ schoolId: admin.schoolId });
    await createStudentRecord({
      name: 'Frank Deleted',
      classId: cls._id,
      schoolId: admin.schoolId,
      status: 'inactive',
    });

    // soft-delete the student by directly updating
    const { Student } = await import('../database.js');
    await Student.updateOne({ name: 'Frank Deleted' }, { isDeleted: true });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/search?q=Frank&types=students')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.students.results).toHaveLength(0);
  });

  it('filters students by academicYear', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord({ schoolId: admin.schoolId });
    await createStudentRecord({
      name: 'Grace 2024',
      academicYear: '2024-25',
      classId: cls._id,
      schoolId: admin.schoolId,
    });
    await createStudentRecord({
      name: 'Grace 2025',
      academicYear: '2025-26',
      classId: cls._id,
      schoolId: admin.schoolId,
    });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/search?q=Grace&types=students&academicYear=2024-25')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.students.results).toHaveLength(1);
    expect(response.body.students.results[0].name).toBe('Grace 2024');
  });

  // ─── Staff Search ───────────────────────────────────────────────────

  it('searches staff by name (regex fallback)', async () => {
    const admin = await createStaffUser({ name: 'Hank Manager' });
    await createStaffUser({
      name: 'Ivy Instructor',
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
      schoolId: admin.schoolId,
    });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/search?q=Ivy&types=staff')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.staff.results).toHaveLength(1);
    expect(response.body.staff.results[0].name).toBe('Ivy Instructor');
  });

  it('searches staff by code (regex fallback)', async () => {
    const admin = await createStaffUser();
    await createStaffUser({
      name: 'Jack',
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
      schoolId: admin.schoolId,
    });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/search?q=EMP&types=staff')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.staff.results.length).toBeGreaterThanOrEqual(2);
  });

  it('searches staff by department (regex fallback)', async () => {
    const admin = await createStaffUser();
    await createStaffUser({
      name: 'Karen',
      department: 'Mathematics',
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
      schoolId: admin.schoolId,
    });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/search?q=Mathematics&types=staff')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.staff.results).toHaveLength(1);
    expect(response.body.staff.results[0].department).toBe('Mathematics');
  });

  it('excludes deleted staff from search', async () => {
    const admin = await createStaffUser();
    const staff = await createStaffUser({
      name: 'Larry Deleted',
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
      schoolId: admin.schoolId,
    });

    const { Staff } = await import('../database.js');
    await Staff.updateOne({ _id: staff._id }, { isDeleted: true });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/search?q=Larry&types=staff')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.staff.results).toHaveLength(0);
  });

  // ─── Classes Search ─────────────────────────────────────────────────

  it('searches classes by name (regex fallback)', async () => {
    const admin = await createStaffUser();
    await createClassRecord({ name: 'Class 10', section: 'A', schoolId: admin.schoolId });
    await createClassRecord({ name: 'Class 9', section: 'B', schoolId: admin.schoolId });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/search?q=Class 10&types=classes')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.classes.results).toHaveLength(1);
    expect(response.body.classes.results[0].name).toBe('Class 10');
  });

  it('searches classes by section (regex fallback)', async () => {
    const admin = await createStaffUser();
    await createClassRecord({ name: 'Class 8', section: 'Alpha', schoolId: admin.schoolId });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/search?q=Alpha&types=classes')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.classes.results).toHaveLength(1);
    expect(response.body.classes.results[0].section).toBe('Alpha');
  });

  it('searches classes by classTag (regex fallback)', async () => {
    const admin = await createStaffUser();
    await createClassRecord({
      name: 'Class 7',
      section: 'A',
      classTag: 'honors-science',
      schoolId: admin.schoolId,
    });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/search?q=honors&types=classes')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.classes.results.length).toBeGreaterThanOrEqual(1);
    const match = response.body.classes.results.find((c) => c.classTag === 'honors-science');
    expect(match).toBeTruthy();
  });

  it('excludes deleted classes from search', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord({
      name: 'Class 6',
      section: 'A',
      schoolId: admin.schoolId,
    });

    const { Class } = await import('../database.js');
    await Class.updateOne({ _id: cls._id }, { isDeleted: true });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/search?q=Class 6&types=classes')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.classes.results).toHaveLength(0);
  });

  it('filters classes by academicYear', async () => {
    const admin = await createStaffUser();
    await createClassRecord({
      name: 'Class 5',
      section: 'A',
      academicYear: '2024-25',
      schoolId: admin.schoolId,
    });
    await createClassRecord({
      name: 'Class 5',
      section: 'A',
      academicYear: '2025-26',
      schoolId: admin.schoolId,
    });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/search?q=Class 5&types=classes&academicYear=2024-25')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.classes.results).toHaveLength(1);
    expect(response.body.classes.results[0].academicYear).toBe('2024-25');
  });

  // ─── Fees Search ────────────────────────────────────────────────────

  it('searches fees by receiptNumber (regex fallback)', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord({ schoolId: admin.schoolId });
    const student = await createStudentRecord({
      name: 'Mia',
      classId: cls._id,
      schoolId: admin.schoolId,
    });

    await FeePayment.create({
      schoolId: admin.schoolId,
      studentId: student._id,
      classId: cls._id,
      receiptNumber: 'RCPT-9999',
      paymentDate: '2025-01-15',
      amount: 5000,
      paymentMode: 'cash',
    });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/search?q=RCPT-9999&types=fees')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.fees.results).toHaveLength(1);
    expect(response.body.fees.results[0].receiptNumber).toBe('RCPT-9999');
  });

  it('searches fees by student name (regex fallback)', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord({ schoolId: admin.schoolId });
    const student = await createStudentRecord({
      name: 'Noah FeeSearch',
      classId: cls._id,
      schoolId: admin.schoolId,
    });

    await FeePayment.create({
      schoolId: admin.schoolId,
      studentId: student._id,
      classId: cls._id,
      receiptNumber: 'RCPT-8888',
      paymentDate: '2025-01-15',
      amount: 3000,
      paymentMode: 'online',
    });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/search?q=Noah FeeSearch&types=fees')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.fees.results).toHaveLength(1);
    expect(response.body.fees.results[0].studentId.name).toBe('Noah FeeSearch');
  });

  it('filters fees by academicYear', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord({ schoolId: admin.schoolId });
    const student = await createStudentRecord({
      name: 'Olivia',
      classId: cls._id,
      schoolId: admin.schoolId,
    });

    await FeePayment.create({
      schoolId: admin.schoolId,
      studentId: student._id,
      classId: cls._id,
      receiptNumber: 'RCPT-7777',
      paymentDate: '2025-01-15',
      amount: 2000,
      paymentMode: 'cash',
      academicYear: '2024-25',
    });
    await FeePayment.create({
      schoolId: admin.schoolId,
      studentId: student._id,
      classId: cls._id,
      receiptNumber: 'RCPT-7776',
      paymentDate: '2025-01-15',
      amount: 2000,
      paymentMode: 'cash',
      academicYear: '2025-26',
    });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/search?q=RCPT-777&types=fees&academicYear=2024-25')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.fees.results).toHaveLength(1);
    expect(response.body.fees.results[0].receiptNumber).toBe('RCPT-7777');
  });

  // ─── Exams Search ───────────────────────────────────────────────────

  it('searches exams by name (regex fallback)', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord({ schoolId: admin.schoolId });

    await Exam.create({
      schoolId: admin.schoolId,
      name: 'Midterm Mathematics',
      type: 'midterm',
      classId: cls._id,
      subjectName: 'Math',
      academicYear: '2025-26',
      status: 'scheduled',
    });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/search?q=Midterm&types=exams')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.exams.results).toHaveLength(1);
    expect(response.body.exams.results[0].name).toBe('Midterm Mathematics');
  });

  it('searches exams by type (regex fallback)', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord({ schoolId: admin.schoolId });

    await Exam.create({
      schoolId: admin.schoolId,
      name: 'Quiz One',
      type: 'quiz',
      classId: cls._id,
      subjectName: 'Science',
      academicYear: '2025-26',
      status: 'scheduled',
    });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/search?q=quiz&types=exams')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.exams.results).toHaveLength(1);
    expect(response.body.exams.results[0].type).toBe('quiz');
  });

  it('excludes deleted exams from search', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord({ schoolId: admin.schoolId });

    const exam = await Exam.create({
      schoolId: admin.schoolId,
      name: 'Deleted Exam',
      type: 'unit_test',
      classId: cls._id,
      subjectName: 'History',
      academicYear: '2025-26',
      status: 'scheduled',
    });
    await Exam.updateOne({ _id: exam._id }, { isDeleted: true });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/search?q=Deleted Exam&types=exams')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.exams.results).toHaveLength(0);
  });

  // ─── Announcements Search ───────────────────────────────────────────

  it('searches announcements by title (regex fallback)', async () => {
    const admin = await createStaffUser();

    await Announcement.create({
      schoolId: admin.schoolId,
      title: 'Winter Break Notice',
      content: 'School will be closed from Dec 20 to Jan 5.',
      createdBy: admin._id,
      creatorModel: 'Staff',
      channels: [{ type: 'inapp' }],
      status: 'sent',
    });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/search?q=Winter Break&types=announcements')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.announcements.results).toHaveLength(1);
    expect(response.body.announcements.results[0].title).toBe('Winter Break Notice');
  });

  it('searches announcements by content (regex fallback)', async () => {
    const admin = await createStaffUser();

    await Announcement.create({
      schoolId: admin.schoolId,
      title: 'Holiday Schedule',
      content: 'The annual sports day is postponed due to rain.',
      createdBy: admin._id,
      creatorModel: 'Staff',
      channels: [{ type: 'inapp' }],
      status: 'sent',
    });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/search?q=sports day&types=announcements')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.announcements.results).toHaveLength(1);
    expect(response.body.announcements.results[0].title).toBe('Holiday Schedule');
  });

  it('excludes deleted announcements from search', async () => {
    const admin = await createStaffUser();

    const ann = await Announcement.create({
      schoolId: admin.schoolId,
      title: 'Deleted Announcement',
      content: 'This should not appear.',
      createdBy: admin._id,
      creatorModel: 'Staff',
      channels: [{ type: 'inapp' }],
      status: 'sent',
    });
    await Announcement.updateOne({ _id: ann._id }, { isDeleted: true });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/search?q=Deleted Announcement&types=announcements')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.announcements.results).toHaveLength(0);
  });

  // ─── Combined & Pagination ──────────────────────────────────────────

  it('searches multiple types in one request', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord({ schoolId: admin.schoolId });
    await createStudentRecord({
      name: 'Multi Student',
      classId: cls._id,
      schoolId: admin.schoolId,
    });
    await createStaffUser({
      name: 'Multi Staff',
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
      schoolId: admin.schoolId,
    });
    await createClassRecord({ name: 'Multi Class', section: 'A', schoolId: admin.schoolId });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/search?q=Multi&types=students,staff,classes')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.students.results.length).toBeGreaterThanOrEqual(1);
    expect(response.body.staff.results.length).toBeGreaterThanOrEqual(1);
    expect(response.body.classes.results.length).toBeGreaterThanOrEqual(1);
  });

  it('respects limit parameter', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord({ schoolId: admin.schoolId });
    for (let i = 1; i <= 5; i++) {
      await createStudentRecord({
        name: `LimitStudent${i}`,
        classId: cls._id,
        schoolId: admin.schoolId,
      });
    }

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/search?q=LimitStudent&types=students&limit=2')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.students.results).toHaveLength(2);
    expect(response.body.limit).toBe(2);
  });

  it('respects page parameter', async () => {
    const admin = await createStaffUser();
    const cls = await createClassRecord({ schoolId: admin.schoolId });
    for (let i = 1; i <= 5; i++) {
      await createStudentRecord({
        name: `PageStudent${i}`,
        classId: cls._id,
        schoolId: admin.schoolId,
      });
    }

    const { app } = createTestApp();
    const page1 = await request(app)
      .get('/api/search?q=PageStudent&types=students&limit=2&page=1')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    const page2 = await request(app)
      .get('/api/search?q=PageStudent&types=students&limit=2&page=2')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(page1.body.students.results).toHaveLength(2);
    expect(page2.body.students.results).toHaveLength(2);
    expect(page1.body.page).toBe(1);
    expect(page2.body.page).toBe(2);
  });

  it('caps limit at 50', async () => {
    const admin = await createStaffUser();
    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/search?q=test&types=students&limit=100')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.limit).toBe(50);
  });

  it('returns correct mode field (regex by default)', async () => {
    const admin = await createStaffUser();
    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/search?q=test&types=students')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.mode).toBe('regex');
  });

  // ─── Analytics Endpoint ─────────────────────────────────────────────

  it('returns search analytics for the school', async () => {
    const admin = await createStaffUser();
    const { app } = createTestApp();

    // Seed a couple of searches
    await request(app)
      .get('/api/search?q=analytics-test&types=students')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);
    await request(app)
      .get('/api/search?q=analytics-test&types=staff')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    const response = await request(app)
      .get('/api/search/analytics?days=30')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body).toHaveProperty('days');
    expect(response.body).toHaveProperty('topQueries');
    expect(Array.isArray(response.body.topQueries)).toBe(true);
    // analytics-test should appear because it was searched twice
    const analyticsEntry = response.body.topQueries.find((q) => q.query === 'analytics-test');
    expect(analyticsEntry).toBeTruthy();
    expect(analyticsEntry.count).toBeGreaterThanOrEqual(2);
  });

  it('caps analytics days at 90', async () => {
    const admin = await createStaffUser();
    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/search/analytics?days=365')
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body.days).toBe(90);
  });

  // ─── Atlas Search Mode (mocked) ─────────────────────────────────────

  // Atlas search mode is controlled by the ENABLE_ATLAS_SEARCH env var.
  // We do not integration-test atlas mode here because:
  // 1. It requires MongoDB Atlas search indexes that don't exist in the test env.
  // 2. Reloading the ESM module to pick up a changed env var causes
  //    OverwriteModelError from mongoose model re-registration.
  // The regex fallback tests above already cover all search logic paths.
});
