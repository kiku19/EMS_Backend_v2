import request from 'supertest';
import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { Class, Staff, Timetable, TeacherTimetable, SchoolSettings } from '../database.js';
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

    it('rejects overlapping and out-of-order periods', () => {
      const overlap = zodSchemas.updatePeriods.safeParse({
        periods: [
          { name: 'P1', startTime: '09:00', endTime: '09:45', isBreak: false },
          { name: 'P2', startTime: '09:30', endTime: '10:15', isBreak: false },
        ],
      });
      const outOfOrder = zodSchemas.updatePeriods.safeParse({
        periods: [
          { name: 'P2', startTime: '10:00', endTime: '10:45', isBreak: false },
          { name: 'P1', startTime: '09:00', endTime: '09:45', isBreak: false },
        ],
      });
      expect(overlap.success).toBe(false);
      expect(outOfOrder.success).toBe(false);
    });

    it('accepts Sunday slots in the timetable contract', () => {
      const result = zodSchemas.updateTimetable.safeParse({
        schedule: {
          Sunday: [{ subject: 'Math', teacherId: null, room: 'A1' }],
        },
      });
      expect(result.success).toBe(true);
      expect(result.data.schedule.Sunday[0].subject).toBe('Math');
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

    it('generates only on configured working days, including Sunday', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const cls = await createClassRecord({
        schoolId: school._id,
        name: 'Sunday Class',
        section: 'A',
        subjects: ['Math'],
      });
      const teacher = await createTeacher(school._id, 'Sunday Teacher', [
        { subject: 'Math', classes: [cls._id] },
      ]);
      await SchoolSettings.create({ schoolId: school._id, workingDays: ['Sun'] });

      await request(app)
        .post('/api/timetable/generate-all')
        .set(authHeadersFor(admin))
        .send({ academicYear: CURRENT_ACADEMIC_YEAR })
        .expect(200);

      const timetable = await Timetable.findOne({
        schoolId: school._id,
        classId: cls._id,
        academicYear: CURRENT_ACADEMIC_YEAR,
      }).lean();
      expect(timetable.schedule.Sunday.some((slot) => slot.subject === 'Math')).toBe(true);
      expect(timetable.schedule.Monday.every((slot) => !slot.subject)).toBe(true);

      const teacherTimetable = await TeacherTimetable.findOne({
        schoolId: school._id,
        teacherId: teacher._id,
        academicYear: CURRENT_ACADEMIC_YEAR,
      }).lean();
      expect(teacherTimetable.schedule.Sunday).toHaveLength(1);
    });

    it('rejects the whole generation when any class has no subjects', async () => {
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

      expect(res.status).toBe(422);
      expect(res.body.classes).toHaveLength(1);
      expect(await Timetable.countDocuments({ schoolId: school._id })).toBe(0);
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

    it('rolls back earlier slots when a later slot is invalid', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const cls = await createClassRecord({
        schoolId: school._id,
        subjects: ['Math', 'Science'],
      });
      const teacher = await createTeacher(school._id, 'Atomic Teacher', [
        { subject: 'Math', classes: [cls._id] },
      ]);
      await Timetable.create({
        classId: cls._id,
        schoolId: school._id,
        academicYear: CURRENT_ACADEMIC_YEAR,
        periods: [
          { name: 'Period 1', startTime: '09:00', endTime: '09:45', isBreak: false },
          { name: 'Period 2', startTime: '09:45', endTime: '10:30', isBreak: false },
        ],
        schedule: {
          Monday: [{}, {}],
          Tuesday: [],
          Wednesday: [],
          Thursday: [],
          Friday: [],
          Saturday: [],
        },
      });

      await request(app)
        .post(`/api/timetable/${cls._id}/batch`)
        .set(authHeadersFor(admin))
        .send({
          academicYear: CURRENT_ACADEMIC_YEAR,
          slots: [
            {
              day: 'Monday',
              periodIndex: 0,
              subject: 'Math',
              teacherId: teacher._id.toString(),
            },
            { day: 'Monday', periodIndex: 1, subject: 'Chemistry' },
          ],
        })
        .expect(409);

      const unchanged = await Timetable.findOne({ classId: cls._id }).lean();
      expect(unchanged.schedule.Monday[0]?.subject || '').toBe('');
      expect(unchanged.schedule.Monday[0]?.teacherId ?? null).toBeNull();
      expect(await TeacherTimetable.countDocuments({ teacherId: teacher._id })).toBe(0);
    });
  });

  describe('PUT /api/timetable/:classId/periods — middle-period deletion', () => {
    it('removes the matching slot and remaps teacher period indexes', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const cls = await createClassRecord({
        schoolId: school._id,
        subjects: ['Math', 'Science', 'English'],
      });
      const teacher = await createTeacher(school._id, 'Period Teacher', [
        { subject: 'Math', classes: [cls._id] },
        { subject: 'Science', classes: [cls._id] },
        { subject: 'English', classes: [cls._id] },
      ]);
      const timetable = await Timetable.create({
        classId: cls._id,
        schoolId: school._id,
        academicYear: CURRENT_ACADEMIC_YEAR,
        periods: [
          { name: 'P1', startTime: '09:00', endTime: '09:40', isBreak: false },
          { name: 'P2', startTime: '09:40', endTime: '10:20', isBreak: false },
          { name: 'P3', startTime: '10:20', endTime: '11:00', isBreak: false },
        ],
        schedule: {
          Monday: [
            { subject: 'Math', teacherId: teacher._id },
            { subject: 'Science', teacherId: teacher._id },
            { subject: 'English', teacherId: teacher._id },
          ],
          Tuesday: [],
          Wednesday: [],
          Thursday: [],
          Friday: [],
          Saturday: [],
        },
      });
      await TeacherTimetable.create({
        schoolId: school._id,
        teacherId: teacher._id,
        academicYear: CURRENT_ACADEMIC_YEAR,
        schedule: {
          Monday: [
            { periodIndex: 0, classId: cls._id, subject: 'Math' },
            { periodIndex: 1, classId: cls._id, subject: 'Science' },
            { periodIndex: 2, classId: cls._id, subject: 'English' },
          ],
          Tuesday: [],
          Wednesday: [],
          Thursday: [],
          Friday: [],
          Saturday: [],
        },
        totalPeriodsPerWeek: 3,
      });

      const keepPeriods = [timetable.periods[0], timetable.periods[2]].map((period) => ({
        _id: period._id.toString(),
        name: period.name,
        startTime: period.startTime,
        endTime: period.endTime,
        isBreak: period.isBreak,
      }));
      await request(app)
        .put(`/api/timetable/${cls._id}/periods`)
        .set(authHeadersFor(admin))
        .send({ academicYear: CURRENT_ACADEMIC_YEAR, periods: keepPeriods })
        .expect(200);

      const updatedClass = await Timetable.findOne({ classId: cls._id }).lean();
      expect(updatedClass.periods.map((period) => period.name)).toEqual(['P1', 'P3']);
      expect(updatedClass.schedule.Monday.map((slot) => slot.subject)).toEqual(['Math', 'English']);
      const updatedTeacher = await TeacherTimetable.findOne({ teacherId: teacher._id }).lean();
      expect(updatedTeacher.schedule.Monday.map((slot) => slot.subject)).toEqual([
        'Math',
        'English',
      ]);
      expect(updatedTeacher.schedule.Monday.map((slot) => slot.periodIndex)).toEqual([0, 1]);
      expect(updatedTeacher.totalPeriodsPerWeek).toBe(2);
    });
  });

  describe('PUT /api/timetable/:classId — relationship validation', () => {
    it('rejects a teacher from another school without changing either timetable view', async () => {
      const schoolA = await createSchoolRecord({ name: 'Timetable School A', code: 'TT-SA' });
      const schoolB = await createSchoolRecord({ name: 'Timetable School B', code: 'TT-SB' });
      const adminA = await createStaffUser({ schoolId: schoolA._id });
      const cls = await createClassRecord({ schoolId: schoolA._id, subjects: ['Math'] });
      const foreignTeacher = await createTeacher(schoolB._id, 'Foreign Teacher');
      const { app } = createTestApp();

      await Timetable.create({
        schoolId: schoolA._id,
        classId: cls._id,
        academicYear: CURRENT_ACADEMIC_YEAR,
        periods: [{ name: 'P1', startTime: '09:00', endTime: '09:45', isBreak: false }],
        schedule: {
          Monday: [{}],
          Tuesday: [],
          Wednesday: [],
          Thursday: [],
          Friday: [],
          Saturday: [],
        },
      });

      await request(app)
        .put(`/api/timetable/${cls._id}`)
        .set(authHeadersFor(adminA))
        .send({
          academicYear: CURRENT_ACADEMIC_YEAR,
          schedule: {
            Monday: [{ subject: 'Math', teacherId: foreignTeacher._id.toString(), room: '' }],
            Tuesday: [],
            Wednesday: [],
            Thursday: [],
            Friday: [],
            Saturday: [],
          },
        })
        .expect(400);

      const unchanged = await Timetable.findOne({ schoolId: schoolA._id, classId: cls._id }).lean();
      expect(unchanged.schedule.Monday[0]?.teacherId ?? null).toBeNull();
      expect(await TeacherTimetable.countDocuments({ schoolId: schoolA._id })).toBe(0);
    });

    it('does not rewrite unrelated teacher timetables when one class is saved', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const cls = await createClassRecord({ schoolId: school._id, subjects: ['Math'] });
      const assignedTeacher = await createTeacher(school._id, 'Assigned Teacher', [
        { subject: 'Math', classes: [cls._id] },
      ]);
      const unrelatedTeacher = await createTeacher(school._id, 'Unrelated Teacher');
      await TeacherTimetable.create({
        schoolId: school._id,
        teacherId: unrelatedTeacher._id,
        academicYear: CURRENT_ACADEMIC_YEAR,
        schedule: {
          Monday: [],
          Tuesday: [],
          Wednesday: [],
          Thursday: [],
          Friday: [],
          Saturday: [],
          Sunday: [],
        },
        version: 7,
      });

      await request(app)
        .put(`/api/timetable/${cls._id}`)
        .set(authHeadersFor(admin))
        .send({
          academicYear: CURRENT_ACADEMIC_YEAR,
          periods: [{ name: 'P1', startTime: '09:00', endTime: '09:45', isBreak: false }],
          schedule: {
            Monday: [{ subject: 'Math', teacherId: assignedTeacher._id.toString(), room: 'A1' }],
            Tuesday: [],
            Wednesday: [],
            Thursday: [],
            Friday: [],
            Saturday: [],
            Sunday: [],
          },
        })
        .expect(200);

      const unrelated = await TeacherTimetable.findOne({ teacherId: unrelatedTeacher._id }).lean();
      expect(unrelated.version).toBe(7);
      expect(unrelated.totalPeriodsPerWeek).toBe(0);
      const assigned = await TeacherTimetable.findOne({ teacherId: assignedTeacher._id }).lean();
      expect(assigned.schedule.Monday).toHaveLength(1);
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

  describe('POST /api/teacher-timetable/:teacherId/switch-class', () => {
    it('moves class and teacher views together within the school and year', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const oldClass = await createClassRecord({
        schoolId: school._id,
        name: 'Switch Old',
        subjects: ['Math'],
      });
      const newClass = await createClassRecord({
        schoolId: school._id,
        name: 'Switch New',
        subjects: ['Math'],
      });
      const teacher = await createTeacher(school._id, 'Switch Teacher', [
        { subject: 'Math', classes: [oldClass._id, newClass._id] },
      ]);
      const { app } = createTestApp();
      const periods = [{ name: 'P1', startTime: '09:00', endTime: '09:45', isBreak: false }];
      await Timetable.create([
        {
          schoolId: school._id,
          classId: oldClass._id,
          academicYear: CURRENT_ACADEMIC_YEAR,
          periods,
          schedule: {
            Monday: [{ subject: 'Math', teacherId: teacher._id }],
            Tuesday: [],
            Wednesday: [],
            Thursday: [],
            Friday: [],
            Saturday: [],
          },
        },
        {
          schoolId: school._id,
          classId: newClass._id,
          academicYear: CURRENT_ACADEMIC_YEAR,
          periods,
          schedule: {
            Monday: [{}],
            Tuesday: [],
            Wednesday: [],
            Thursday: [],
            Friday: [],
            Saturday: [],
          },
        },
      ]);
      await TeacherTimetable.create({
        schoolId: school._id,
        teacherId: teacher._id,
        academicYear: CURRENT_ACADEMIC_YEAR,
        schedule: {
          Monday: [{ periodIndex: 0, classId: oldClass._id, subject: 'Math' }],
          Tuesday: [],
          Wednesday: [],
          Thursday: [],
          Friday: [],
          Saturday: [],
        },
        totalPeriodsPerWeek: 1,
      });

      await request(app)
        .post(`/api/teacher-timetable/${teacher._id}/switch-class`)
        .set(authHeadersFor(admin))
        .send({
          day: 'Monday',
          periodIndex: 0,
          oldClassId: oldClass._id.toString(),
          newClassId: newClass._id.toString(),
          subject: 'Math',
          academicYear: CURRENT_ACADEMIC_YEAR,
        })
        .expect(200);

      const [oldView, newView, teacherView] = await Promise.all([
        Timetable.findOne({ classId: oldClass._id }).lean(),
        Timetable.findOne({ classId: newClass._id }).lean(),
        TeacherTimetable.findOne({ teacherId: teacher._id }).lean(),
      ]);
      expect(oldView.schedule.Monday[0]?.teacherId ?? null).toBeNull();
      expect(String(newView.schedule.Monday[0].teacherId)).toBe(String(teacher._id));
      expect(String(teacherView.schedule.Monday[0].classId)).toBe(String(newClass._id));
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

// ─── PHASE: Duplicate prevention & dedup (SCH: timetable dupes) ──────────

describe('Timetable deduplication', () => {
  it('GET /api/timetable collapses duplicate docs per class to one row', async () => {
    const { school, admin } = await setupSchoolWithAdmin();
    const { app } = createTestApp();
    const cls = await createClassRecord({ schoolId: school._id, subjects: ['Math'] });

    // The unique index prevents true duplicates, so drop it to simulate the
    // pre-fix state (dupes that existed before the index was enforced), then
    // seed two docs for the same class+year.
    const coll = Timetable.collection;
    try {
      const indexes = await coll.listIndexes().toArray();
      await Promise.all(
        indexes
          .filter((i) => i.key && i.key.classId && i.key.academicYear)
          .map((i) => coll.dropIndex(i.name))
      );
    } catch {
      /* index may not exist; ignore */
    }

    await coll.insertMany([
      {
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
        lastSyncedAt: new Date('2024-01-01'),
      },
      {
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
        lastSyncedAt: new Date('2025-01-01'),
      },
    ]);

    const res = await request(app).get('/api/timetable').set(authHeadersFor(admin));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    // Keeps the newest (lastSyncedAt 2025).
    expect(new Date(res.body[0].lastSyncedAt).getFullYear()).toBe(2025);

    // Recreate the unique index so this test doesn't leave the collection
    // unguarded for any later test that depends on the index being enforced.
    await coll.createIndex(
      { schoolId: 1, classId: 1, academicYear: 1 },
      { unique: true, partialFilterExpression: { isDeleted: false } }
    );
  });

  it('concurrent PUT /api/timetable/:classId (createOrUpdate) does not create duplicates', async () => {
    const { school, admin } = await setupSchoolWithAdmin();
    const { app } = createTestApp();
    const cls = await createClassRecord({ schoolId: school._id, subjects: ['Math'] });
    const headers = authHeadersFor(admin);

    const body = {
      academicYear: CURRENT_ACADEMIC_YEAR,
      periods: [{ name: 'Period 1', startTime: '09:00', endTime: '09:45', isBreak: false }],
      schedule: {
        Monday: [{ subject: 'Math', teacherId: null, room: '' }],
        Tuesday: [],
        Wednesday: [],
        Thursday: [],
        Friday: [],
        Saturday: [],
      },
    };

    // Fire several createOrUpdate requests concurrently for the same class.
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(app).put(`/api/timetable/${cls._id}`).set(headers).send(body)
      )
    );

    // All should succeed (each either creates or updates the same doc).
    results.forEach((r) => expect([200, 201]).toContain(r.status));

    // Exactly ONE non-deleted timetable must exist for this class+year.
    const count = await Timetable.countDocuments({
      schoolId: school._id,
      classId: cls._id,
      academicYear: CURRENT_ACADEMIC_YEAR,
      isDeleted: { $ne: true },
    });
    expect(count).toBe(1);
  });

  it('persists an intentionally cleared schedule instead of ignoring an empty object', async () => {
    const { school, admin } = await setupSchoolWithAdmin();
    const { app } = createTestApp();
    const cls = await createClassRecord({ schoolId: school._id, subjects: ['Math'] });
    const headers = authHeadersFor(admin);
    const periods = [{ name: 'Period 1', startTime: '09:00', endTime: '09:45', isBreak: false }];

    await request(app)
      .put(`/api/timetable/${cls._id}`)
      .set(headers)
      .send({
        academicYear: CURRENT_ACADEMIC_YEAR,
        periods,
        schedule: { Monday: [{ subject: 'Math', teacherId: null, room: 'A1' }] },
      })
      .expect(200);

    await request(app)
      .put(`/api/timetable/${cls._id}`)
      .set(headers)
      .send({ academicYear: CURRENT_ACADEMIC_YEAR, periods, schedule: {} })
      .expect(200);

    const stored = await Timetable.findOne({
      schoolId: school._id,
      classId: cls._id,
      academicYear: CURRENT_ACADEMIC_YEAR,
    }).lean();
    expect(stored.schedule.Monday).toHaveLength(0);
    expect(stored.schedule.Sunday).toHaveLength(0);
  });

  it('POST /api/timetable returns 400 under concurrent create (no duplicate left behind)', async () => {
    const { school, admin } = await setupSchoolWithAdmin();
    const { app } = createTestApp();
    const cls = await createClassRecord({ schoolId: school._id, subjects: ['Math'] });
    const headers = authHeadersFor(admin);

    const body = {
      classId: cls._id.toString(),
      academicYear: CURRENT_ACADEMIC_YEAR,
      periods: [{ name: 'Period 1', startTime: '09:00', endTime: '09:45', isBreak: false }],
    };

    const results = await Promise.all(
      Array.from({ length: 3 }, () => request(app).post('/api/timetable').set(headers).send(body))
    );

    const successes = results.filter((r) => r.status === 201);
    const conflicts = results.filter((r) => r.status === 400);
    expect(successes.length).toBe(1);
    expect(conflicts.length).toBe(2);

    const count = await Timetable.countDocuments({
      schoolId: school._id,
      classId: cls._id,
      academicYear: CURRENT_ACADEMIC_YEAR,
      isDeleted: { $ne: true },
    });
    expect(count).toBe(1);
  });
});
