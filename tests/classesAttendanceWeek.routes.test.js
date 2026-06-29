import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Attendance } from '../database.js';
import SchoolSettings from '../models/SchoolSettings.js';
import { localTodayString } from '../utils/dateTimezone.js';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

/**
 * Helpers
 *
 * `today()` and the Monday of the current ISO week are recomputed per-test
 * via the same timezone the route uses, so the assertions are stable whether
 * the test runs at UTC or in IST.
 */
function todayIso() {
  return localTodayString();
}

function mondayOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = d.getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayName(dateStr) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][
    new Date(`${dateStr}T00:00:00Z`).getUTCDay()
  ];
}

describe('GET /api/classes/attendance/week — SCH-191', () => {
  let admin;
  let school;
  let authHeaders;
  let classA;
  let classB;
  let studentA;
  let studentA2;
  let studentB;

  beforeEach(async () => {
    school = await createSchoolRecord({ name: 'Week Calendar School' });
    admin = await createStaffUser({
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    // Staff.findOneAndUpdate isn't used by setupSchoolWithAdmin — admin was
    // created with no username, which the compound unique index tolerates as
    // null-sparse. No-op here; placeholder for future username fix.
    authHeaders = authHeadersFor(admin, 'admin');

    classA = await createClassRecord({ schoolId: school._id, name: 'Class A', section: 'A' });
    classB = await createClassRecord({ schoolId: school._id, name: 'Class B', section: 'A' });
    // classC used implicitly — third active class for the `total` assertions.
    await createClassRecord({ schoolId: school._id, name: 'Class C', section: 'A' });

    studentA = await createStudentRecord({ schoolId: school._id, classId: classA._id, rollNo: 1 });
    studentA2 = await createStudentRecord({
      schoolId: school._id,
      classId: classA._id,
      rollNo: 2,
      admissionId: 'ADMWA2',
    });
    studentB = await createStudentRecord({ schoolId: school._id, classId: classB._id, rollNo: 1 });
  });

  afterEach(async () => {
    // Clean up attendance rows created during the test so consecutive tests
    // don't see leftover data; SchoolSettings are torn down by the global
    // test DB reset between files.
    await Attendance.deleteMany({ schoolId: school._id });
    await SchoolSettings.deleteMany({ schoolId: school._id });
  });

  it('returns the current week with one entry per past school day', async () => {
    const { app } = createTestApp();
    const today = todayIso();
    const monday = mondayOf(today);

    const response = await request(app)
      .get('/api/classes/attendance/week')
      .set(authHeaders)
      .expect(200);

    expect(response.body.weekStart).toBe(monday);

    const dates = response.body.days.map((d) => d.date);
    // Every returned date must be ≤ today and be a Mon–Sat working day.
    for (const dateStr of dates) {
      expect(dateStr <= today).toBe(true);
      expect(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']).toContain(dayName(dateStr));
      expect(dayName(dateStr)).not.toBe('Sun');
    }

    // Every eligible day carries `total` = active class count.
    for (const d of response.body.days) {
      expect(d.total).toBe(3);
      expect(d.covered).toBe(0);
    }

    // The week must not include dates after today.
    expect(dates.every((d) => d <= today)).toBe(true);
  });

  it('counts distinct classes as covered when attendance was marked', async () => {
    const { app } = createTestApp();
    const today = todayIso();

    // Find the most recent past weekday to seed attendance on. We need at
    // least one past working day; if today is Mon, use today itself.
    let target = today;
    if (dayName(target) === 'Sun') {
      // Sunday → seed on Friday (today - 2) for determinism.
      target = addDays(today, -2);
    }

    // Two distinct classes have attendance recorded → covered=2.
    await Attendance.create({
      schoolId: school._id,
      studentId: studentA._id,
      classId: classA._id,
      date: target,
      status: 'present',
    });
    await Attendance.create({
      schoolId: school._id,
      studentId: studentB._id,
      classId: classB._id,
      date: target,
      status: 'absent',
    });
    // A second record for classA on the same day should NOT inflate the
    // covered count (we count distinct classes, not records). Different
    // student within the same class, different status.
    await Attendance.create({
      schoolId: school._id,
      studentId: studentA2._id,
      classId: classA._id,
      date: target,
      status: 'late',
    });

    const response = await request(app)
      .get('/api/classes/attendance/week')
      .set(authHeaders)
      .expect(200);

    const targetRow = response.body.days.find((d) => d.date === target);
    expect(targetRow).toBeDefined();
    expect(targetRow.covered).toBe(2);
    expect(targetRow.total).toBe(3);
  });

  it('omits holidays and weekends from the response', async () => {
    const { app } = createTestApp();
    const today = todayIso();
    const monday = mondayOf(today);

    // Build a list of candidate dates for the week and mark every day as a
    // holiday — the response must then contain zero day entries (assuming
    // today is on or after monday). The week window is still returned.
    const weekDates = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

    await SchoolSettings.create({
      schoolId: school._id,
      holidays: weekDates.map((d) => ({ date: d, name: 'Closed', type: 'General' })),
      workingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    });

    const response = await request(app)
      .get('/api/classes/attendance/week')
      .set(authHeaders)
      .expect(200);

    expect(response.body.weekStart).toBe(monday);
    expect(response.body.days).toEqual([]);
  });

  it('honours a custom workingDays config (Sat excluded)', async () => {
    const { app } = createTestApp();

    await SchoolSettings.create({
      schoolId: school._id,
      workingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], // no Sat
      holidays: [],
    });

    const response = await request(app)
      .get('/api/classes/attendance/week')
      .set(authHeaders)
      .expect(200);

    for (const d of response.body.days) {
      expect(dayName(d.date)).not.toBe('Sat');
      expect(dayName(d.date)).not.toBe('Sun');
    }
  });

  it('respects an explicit weekStart query param', async () => {
    const { app } = createTestApp();
    // Use a known Monday regardless of today's actual date.
    const knownMonday = '2024-01-01'; // Jan 1 2024 is a Monday.
    const knownSunday = '2024-01-07';

    await SchoolSettings.create({
      schoolId: school._id,
      workingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      holidays: [],
    });

    const response = await request(app)
      .get(`/api/classes/attendance/week?weekStart=${knownMonday}`)
      .set(authHeaders)
      .expect(200);

    expect(response.body.weekStart).toBe(knownMonday);
    expect(response.body.days.length).toBeGreaterThan(0);
    // Last day in window is the Sunday.
    const lastDate = response.body.days[response.body.days.length - 1].date;
    expect(lastDate <= knownSunday).toBe(true);
  });

  it('excludes attendance records for soft-deleted rows', async () => {
    const { app } = createTestApp();
    const today = todayIso();
    let target = today;
    if (dayName(target) === 'Sun') target = addDays(today, -2);

    await Attendance.create({
      schoolId: school._id,
      studentId: studentA._id,
      classId: classA._id,
      date: target,
      status: 'present',
      isDeleted: true,
      deletedAt: new Date(),
    });

    const response = await request(app)
      .get('/api/classes/attendance/week')
      .set(authHeaders)
      .expect(200);

    const targetRow = response.body.days.find((d) => d.date === target);
    if (targetRow) {
      expect(targetRow.covered).toBe(0);
    }
  });

  it('returns 400 on invalid weekStart format', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .get('/api/classes/attendance/week?weekStart=not-a-date')
      .set(authHeaders);

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/validation/i);
  });

  it('returns 401 when unauthenticated', async () => {
    const { app } = createTestApp();
    await request(app).get('/api/classes/attendance/week').expect(401);
  });

  it("scopes results to the caller's school only", async () => {
    const { app } = createTestApp();
    const otherSchool = await createSchoolRecord({ name: 'Other School' });
    const otherClass = await createClassRecord({
      schoolId: otherSchool._id,
      name: 'Other Class',
      section: 'A',
    });
    const otherStudent = await createStudentRecord({
      schoolId: otherSchool._id,
      classId: otherClass._id,
      rollNo: 1,
    });

    const today = todayIso();
    let target = today;
    if (dayName(target) === 'Sun') target = addDays(today, -2);

    await Attendance.create({
      schoolId: otherSchool._id,
      studentId: otherStudent._id,
      classId: otherClass._id,
      date: target,
      status: 'present',
    });

    const response = await request(app)
      .get('/api/classes/attendance/week')
      .set(authHeaders)
      .expect(200);

    // Other school's attendance must not appear in this school's totals.
    const targetRow = response.body.days.find((d) => d.date === target);
    if (targetRow) {
      expect(targetRow.covered).toBe(0);
      expect(targetRow.total).toBe(3); // only this school's 3 classes
    }

    // Cleanup other school's seeded attendance.
    await Attendance.deleteMany({ schoolId: otherSchool._id });
  });
});
