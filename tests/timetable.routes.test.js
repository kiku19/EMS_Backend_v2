import request from 'supertest';
import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { Class, Staff, Timetable, TeacherTimetable } from '../database.js';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';
import { zodSchemas } from '../middleware/validation.js';
import {
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  authHeadersFor,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

// ─── Helpers ─────────────────────────────────────────────────────────────

let adminSeq = 0;
async function setupSchoolWithAdmin(schoolName = 'Test School') {
  adminSeq += 1;
  const school = await createSchoolRecord({ name: schoolName });
  const admin = await createStaffUser({ schoolId: school._id });
  await Staff.findByIdAndUpdate(admin._id, { username: `tt_admin_${adminSeq}_${Date.now()}` });
  return { school, admin };
}

let teacherSeq = 0;
async function createTeacher(schoolId, name = 'Teacher', assignments = []) {
  teacherSeq += 1;
  const teacher = await createStaffUser({
    name,
    staffRole: ['Teacher'],
    permissionRole: 'teacher',
    schoolId,
  });
  if (assignments.length > 0) {
    await Staff.findByIdAndUpdate(teacher._id, {
      teacherAssignments: assignments,
      username: `tt_teacher_${teacherSeq}_${Date.now()}`,
    });
  } else {
    await Staff.findByIdAndUpdate(teacher._id, {
      username: `tt_teacher_${teacherSeq}_${Date.now()}`,
    });
  }
  return Staff.findById(teacher._id);
}

// ─── PHASE 1: Zod Schema Unit Tests ──────────────────────────────────────

describe('Timetable Zod Schemas', () => {
  describe('updateSlot', () => {
    it('accepts valid slot data', () => {
      const result = zodSchemas.updateSlot.safeParse({
        day: 'Monday',
        periodIndex: 0,
        subject: 'Math',
        teacherId: '507f1f77bcf86cd799439011',
        room: 'A1',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid day', () => {
      const result = zodSchemas.updateSlot.safeParse({
        day: 'Funday',
        periodIndex: 0,
      });
      expect(result.success).toBe(false);
      expect(result.error.issues[0].path).toContain('day');
    });

    it('rejects negative periodIndex', () => {
      const result = zodSchemas.updateSlot.safeParse({
        day: 'Monday',
        periodIndex: -1,
      });
      expect(result.success).toBe(false);
    });

    it('rejects periodIndex > 11', () => {
      const result = zodSchemas.updateSlot.safeParse({
        day: 'Monday',
        periodIndex: 12,
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid teacherId format', () => {
      const result = zodSchemas.updateSlot.safeParse({
        day: 'Monday',
        periodIndex: 0,
        teacherId: 'not-an-objectid',
      });
      expect(result.success).toBe(false);
    });

    it('allows empty subject and room', () => {
      const result = zodSchemas.updateSlot.safeParse({
        day: 'Friday',
        periodIndex: 5,
      });
      expect(result.success).toBe(true);
      expect(result.data.subject).toBe('');
      expect(result.data.room).toBe('');
    });
  });

  describe('generateAll', () => {
    it('accepts empty body', () => {
      const result = zodSchemas.generateAll.safeParse({});
      expect(result.success).toBe(true);
    });

    it('accepts valid periodRules', () => {
      const result = zodSchemas.generateAll.safeParse({
        academicYear: CURRENT_ACADEMIC_YEAR,
        periodRules: {
          maxPeriodsPerSubjectPerDay: 2,
          maxPeriodsPerSubjectPerWeek: 10,
          noConsecutiveSame: true,
        },
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid academicYear format', () => {
      const result = zodSchemas.generateAll.safeParse({
        academicYear: '2025',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('batchUpdateSlots', () => {
    it('accepts valid batch', () => {
      const result = zodSchemas.batchUpdateSlots.safeParse({
        slots: [
          { day: 'Monday', periodIndex: 0, subject: 'Math' },
          { day: 'Tuesday', periodIndex: 1, subject: 'Science' },
        ],
      });
      expect(result.success).toBe(true);
      expect(result.data.slots).toHaveLength(2);
    });

    it('rejects empty slots array', () => {
      const result = zodSchemas.batchUpdateSlots.safeParse({ slots: [] });
      expect(result.success).toBe(false);
    });
  });

  describe('updatePeriods', () => {
    it('accepts valid periods', () => {
      const result = zodSchemas.updatePeriods.safeParse({
        periods: [
          { name: 'Period 1', startTime: '09:00', endTime: '09:45', isBreak: false },
          { name: 'Break', startTime: '09:45', endTime: '10:00', isBreak: true },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid time format', () => {
      const result = zodSchemas.updatePeriods.safeParse({
        periods: [{ name: 'Period 1', startTime: '9am', endTime: '10am', isBreak: false }],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('teacherUpdateSlot', () => {
    it('accepts valid teacher slot data', () => {
      const result = zodSchemas.teacherUpdateSlot.safeParse({
        day: 'Wednesday',
        periodIndex: 3,
        classId: '507f1f77bcf86cd799439011',
        subject: 'English',
        room: 'B2',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('switchClass', () => {
    it('requires newClassId', () => {
      const result = zodSchemas.switchClass.safeParse({
        day: 'Monday',
        periodIndex: 0,
      });
      expect(result.success).toBe(false);
    });

    it('accepts valid switch data', () => {
      const result = zodSchemas.switchClass.safeParse({
        day: 'Monday',
        periodIndex: 0,
        newClassId: '507f1f77bcf86cd799439011',
        oldClassId: '507f1f77bcf86cd799439012',
        subject: 'Math',
      });
      expect(result.success).toBe(true);
    });
  });
});

// ─── PHASE 2: Route Integration Tests ────────────────────────────────────

describe('Timetable Routes', () => {
  describe('POST /api/timetable — Create timetable', () => {
    it('creates a timetable with schoolId', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const cls = await createClassRecord({ schoolId: school._id, subjects: ['Math', 'Science'] });

      const res = await request(app)
        .post('/api/timetable')
        .set(authHeadersFor(admin))
        .send({
          classId: cls._id.toString(),
          periods: [{ name: 'Period 1', startTime: '09:00', endTime: '09:45', isBreak: false }],
        });

      expect(res.status).toBe(201);
      expect(res.body.schoolId).toBeTruthy();
      expect(res.body.classId).toBeTruthy();
    });

    it('rejects invalid classId', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();

      const res = await request(app)
        .post('/api/timetable')
        .set(authHeadersFor(admin))
        .send({ classId: 'not-valid' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation Error');
    });
  });

  describe('PUT /api/timetable/:classId/slot — Update slot with sync', () => {
    it('updates a slot and validates input via Zod', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const cls = await createClassRecord({ schoolId: school._id, subjects: ['Math'] });

      // Create timetable first
      await Timetable.create({
        classId: cls._id,
        schoolId: school._id,
        academicYear: CURRENT_ACADEMIC_YEAR,
        periods: [{ name: 'Period 1', startTime: '09:00', endTime: '09:45', isBreak: false }],
        schedule: {
          Monday: [{}],
          Tuesday: [],
          Wednesday: [],
          Thursday: [],
          Friday: [],
          Saturday: [],
        },
      });

      const res = await request(app)
        .put(`/api/timetable/${cls._id}/slot`)
        .set(authHeadersFor(admin))
        .send({
          day: 'Monday',
          periodIndex: 0,
          subject: 'Math',
          room: 'A1',
        });

      expect(res.status).toBe(200);
    });

    it('rejects invalid day via Zod', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const cls = await createClassRecord({ schoolId: school._id });

      const res = await request(app)
        .put(`/api/timetable/${cls._id}/slot`)
        .set(authHeadersFor(admin))
        .send({ day: 'Funday', periodIndex: 0 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation Error');
    });
  });

  describe('POST /api/timetable/generate-all — Generate with teacher sync', () => {
    it('generates timetables for all classes and syncs teacher timetables', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();

      const cls1 = await createClassRecord({
        schoolId: school._id,
        name: 'Class 1',
        section: 'A',
        subjects: ['Math', 'Science', 'English'],
      });
      const cls2 = await createClassRecord({
        schoolId: school._id,
        name: 'Class 2',
        section: 'A',
        subjects: ['Math', 'Science'],
      });

      // Create a teacher assigned to Math for both classes
      const teacher = await createTeacher(school._id, 'Math Teacher', [
        { subject: 'Math', classes: [cls1._id, cls2._id] },
      ]);

      const res = await request(app)
        .post('/api/timetable/generate-all')
        .set(authHeadersFor(admin))
        .send({ academicYear: CURRENT_ACADEMIC_YEAR });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.generated).toBe(2);

      // Verify class timetables were created
      const timetables = await Timetable.find({ schoolId: school._id });
      expect(timetables).toHaveLength(2);

      // Verify teacher timetable was synced
      const teacherTT = await TeacherTimetable.findOne({
        teacherId: teacher._id,
        academicYear: CURRENT_ACADEMIC_YEAR,
      });
      expect(teacherTT).toBeTruthy();
      expect(teacherTT.totalPeriodsPerWeek).toBeGreaterThan(0);
    });

    it('skips classes without subjects', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();

      await createClassRecord({
        schoolId: school._id,
        name: 'Empty Class',
        section: 'A',
        subjects: [],
      });

      const res = await request(app)
        .post('/api/timetable/generate-all')
        .set(authHeadersFor(admin))
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.generated).toBe(0);
      expect(res.body.errors.length).toBeGreaterThan(0);
    });
  });

  describe('POST /api/timetable/:classId/batch — Batch update', () => {
    it('validates batch slots via Zod', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();

      const res = await request(app)
        .post(`/api/timetable/${new mongoose.Types.ObjectId()}/batch`)
        .set(authHeadersFor(admin))
        .send({ slots: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation Error');
    });

    it('rejects batch when a slot would double-book a teacher across classes', async () => {
      // Before this fix, /batch skipped conflictDetectionService entirely
      // and silently double-booked teachers. The same check runs on the
      // single-slot PUT /slot (returns 409) — batch should match.
      const { school, admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const clsA = await createClassRecord({
        schoolId: school._id,
        name: 'Class A',
        section: 'X',
        subjects: ['Math'],
      });
      const clsB = await createClassRecord({
        schoolId: school._id,
        name: 'Class B',
        section: 'X',
        subjects: ['Math'],
      });
      const teacher = await createTeacher(school._id, 'DB Teacher', [
        { subject: 'Math', classes: [clsA._id, clsB._id] },
      ]);

      // Pre-populate Class A timetable so the teacher is already booked Monday P0
      await Timetable.create({
        classId: clsA._id,
        schoolId: school._id,
        academicYear: CURRENT_ACADEMIC_YEAR,
        periods: [{ name: 'Period 1', startTime: '09:00', endTime: '09:45', isBreak: false }],
        schedule: {
          Monday: [
            { subject: 'Math', teacherId: teacher._id, room: 'A1', lastModified: new Date() },
          ],
          Tuesday: [],
          Wednesday: [],
          Thursday: [],
          Friday: [],
          Saturday: [],
        },
      });

      // Class B has its own timetable row
      await Timetable.create({
        classId: clsB._id,
        schoolId: school._id,
        academicYear: CURRENT_ACADEMIC_YEAR,
        periods: [{ name: 'Period 1', startTime: '09:00', endTime: '09:45', isBreak: false }],
        schedule: {
          Monday: [{}],
          Tuesday: [],
          Wednesday: [],
          Thursday: [],
          Friday: [],
          Saturday: [],
        },
      });

      // Attempt to assign the same teacher to Class B Monday P0 via batch
      const res = await request(app)
        .post(`/api/timetable/${clsB._id}/batch`)
        .set(authHeadersFor(admin))
        .send({
          slots: [
            {
              day: 'Monday',
              periodIndex: 0,
              subject: 'Math',
              teacherId: teacher._id.toString(),
              room: 'B1',
            },
          ],
          academicYear: CURRENT_ACADEMIC_YEAR,
        });

      expect(res.status).toBe(409);
      expect(Array.isArray(res.body.conflicts)).toBe(true);
      expect(res.body.conflicts.length).toBeGreaterThan(0);

      // Class B Monday P0 must remain untouched (teacher unassigned)
      const afterB = await Timetable.findOne({ classId: clsB._id }).lean();
      expect(afterB.schedule.Monday[0]?.teacherId ?? null).toBeNull();
    });
  });
});

// ─── PHASE 3: Staff Timetable Endpoint Tests ─────────────────────────────

describe('Staff Timetable Endpoints', () => {
  it('GET /:id/timetable/today returns schedule from TeacherTimetable', async () => {
    const { school, admin } = await setupSchoolWithAdmin();
    const { app } = createTestApp();
    const teacher = await createTeacher(school._id, 'Teacher Today');
    const cls = await createClassRecord({ schoolId: school._id, subjects: ['Math'] });

    // Create class timetable with periods (for time lookup)
    await Timetable.create({
      classId: cls._id,
      schoolId: school._id,
      academicYear: CURRENT_ACADEMIC_YEAR,
      periods: [{ name: 'Period 1', startTime: '09:00', endTime: '09:45', isBreak: false }],
      schedule: { Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [], Saturday: [] },
    });

    const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });

    // Create teacher timetable with today's slot
    await TeacherTimetable.create({
      teacherId: teacher._id,
      schoolId: school._id,
      academicYear: CURRENT_ACADEMIC_YEAR,
      schedule: {
        [today]: [{ periodIndex: 0, classId: cls._id, subject: 'Math', room: 'A1' }],
        ...Object.fromEntries(
          ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
            .filter((d) => d !== today)
            .map((d) => [d, []])
        ),
      },
    });

    const res = await request(app)
      .get(`/api/staff/${teacher._id}/timetable/today`)
      .set(authHeadersFor(admin));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    if (res.body.length > 0) {
      expect(res.body[0]).toHaveProperty('subject');
      expect(res.body[0]).toHaveProperty('startTime');
      expect(res.body[0]).toHaveProperty('class');
    }
  });

  it('GET /:id/timetable/week returns weekly schedule', async () => {
    const { school, admin } = await setupSchoolWithAdmin();
    const { app } = createTestApp();
    const teacher = await createTeacher(school._id, 'Teacher Week');

    // Create empty teacher timetable
    await TeacherTimetable.create({
      teacherId: teacher._id,
      schoolId: school._id,
      academicYear: CURRENT_ACADEMIC_YEAR,
      schedule: {
        Monday: [],
        Tuesday: [],
        Wednesday: [],
        Thursday: [],
        Friday: [],
        Saturday: [],
      },
    });

    const res = await request(app)
      .get(`/api/staff/${teacher._id}/timetable/week`)
      .set(authHeadersFor(admin));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('Monday');
    expect(res.body).toHaveProperty('Friday');
    expect(Array.isArray(res.body.Monday)).toBe(true);
  });
});

// ─── PHASE 4: Teacher Timetable Route Tests ──────────────────────────────

describe('Teacher Timetable Routes', () => {
  describe('PUT /api/teacher-timetable/:teacherId/slot', () => {
    it('rejects invalid day via Zod', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const teacher = await createTeacher(school._id, 'TT Teacher');

      const res = await request(app)
        .put(`/api/teacher-timetable/${teacher._id}/slot`)
        .set(authHeadersFor(admin))
        .send({ day: 'Badday', periodIndex: 0 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation Error');
    });
  });
});

// ─── PHASE 5: Schema schoolId Tests ─────────────────────────────────────

describe('Schema schoolId', () => {
  it('Timetable schema accepts schoolId', async () => {
    const { school } = await setupSchoolWithAdmin();
    const cls = await createClassRecord({ schoolId: school._id });

    const tt = await Timetable.create({
      classId: cls._id,
      schoolId: school._id,
      academicYear: CURRENT_ACADEMIC_YEAR,
      periods: [],
      schedule: {
        Monday: [],
        Tuesday: [],
        Wednesday: [],
        Thursday: [],
        Friday: [],
        Saturday: [],
      },
    });

    expect(tt.schoolId.toString()).toBe(school._id.toString());
  });

  it('Timetable unique index includes schoolId', async () => {
    const school1 = await createSchoolRecord({ name: 'School A' });
    const school2 = await createSchoolRecord({ name: 'School B' });
    const cls1 = await createClassRecord({ schoolId: school1._id, name: 'Class 1', section: 'A' });
    const cls2 = await createClassRecord({ schoolId: school2._id, name: 'Class 1', section: 'A' });

    // Same classId structure but different schools — should not conflict
    await Timetable.create({
      classId: cls1._id,
      schoolId: school1._id,
      academicYear: CURRENT_ACADEMIC_YEAR,
      periods: [],
      schedule: { Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [], Saturday: [] },
    });

    await Timetable.create({
      classId: cls2._id,
      schoolId: school2._id,
      academicYear: CURRENT_ACADEMIC_YEAR,
      periods: [],
      schedule: { Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [], Saturday: [] },
    });

    const count = await Timetable.countDocuments({});
    expect(count).toBe(2);
  });
});
