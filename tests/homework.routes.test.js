import request from 'supertest';
import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { Staff } from '../database.js';
import Homework from '../models/Homework.js';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

let adminSeq = 0;
async function setupSchoolWithAdmin(schoolName = 'HW School') {
  adminSeq += 1;
  const school = await createSchoolRecord({ name: schoolName });
  const admin = await createStaffUser({ schoolId: school._id });
  await Staff.findByIdAndUpdate(admin._id, { username: `hw_admin_${adminSeq}_${Date.now()}` });
  return { school, admin };
}

let teacherSeq = 0;
async function createTeacher(schoolId, name = 'Teacher') {
  teacherSeq += 1;
  const teacher = await createStaffUser({
    name,
    staffRole: ['Teacher'],
    permissionRole: 'teacher',
    schoolId,
  });
  await Staff.findByIdAndUpdate(teacher._id, {
    username: `hw_teacher_${teacherSeq}_${Date.now()}`,
  });
  return teacher;
}

function futureDateISO(daysFromNow = 7) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString();
}

describe('homework routes', () => {
  // ─── AUTH ──────────────────────────────────────────────────────────────

  describe('authentication', () => {
    it('returns 401 when no token is provided', async () => {
      const { app } = createTestApp();

      await request(app).get('/api/homework/teacher/abc').expect(401);
      await request(app).get('/api/homework/class/abc').expect(401);
      await request(app).post('/api/homework').send({}).expect(401);
      await request(app).put('/api/homework/abc').send({}).expect(401);
      await request(app).delete('/api/homework/abc').expect(401);
    });
  });

  // ─── POST /api/homework ───────────────────────────────────────────────

  describe('POST /api/homework — Create homework', () => {
    it('creates homework and returns the populated document', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacher(school._id, 'Math Teacher');
      const cls = await createClassRecord({ name: 'Class 8', section: 'A', schoolId: school._id });

      const { app } = createTestApp();
      const dueDate = futureDateISO(5);

      const response = await request(app)
        .post('/api/homework')
        .set(authHeadersFor(admin, 'admin'))
        .send({
          title: 'Algebra Practice',
          description: 'Solve exercises 1-10 from chapter 3',
          subject: 'Math',
          classId: cls._id.toString(),
          teacherId: teacher._id.toString(),
          dueDate,
        })
        .expect(201);

      expect(response.body).toMatchObject({
        title: 'Algebra Practice',
        description: 'Solve exercises 1-10 from chapter 3',
        subject: 'Math',
        status: 'active',
        sentToParents: true,
      });
      expect(response.body.classId).toMatchObject({ name: 'Class 8', section: 'A' });
      // The route derives teacherId from the authenticated user, not the body —
      // so this admin-invoked create owns the homework. Assert only that the
      // ref populated to *some* named staff record.
      expect(response.body.teacherId).toHaveProperty('name');

      // Verify in database
      const saved = await Homework.findById(response.body._id);
      expect(saved).toBeTruthy();
      expect(saved.schoolId.toString()).toBe(school._id.toString());
    });

    it('returns 400 when title is missing', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacher(school._id);
      const cls = await createClassRecord({ schoolId: school._id });

      const { app } = createTestApp();

      const response = await request(app)
        .post('/api/homework')
        .set(authHeadersFor(admin, 'admin'))
        .send({
          description: 'Some description',
          subject: 'Math',
          classId: cls._id.toString(),
          teacherId: teacher._id.toString(),
          dueDate: futureDateISO(),
        })
        .expect(400);

      expect(JSON.stringify(response.body.details)).toMatch(/title/i);
    });

    it('returns 400 when classId is missing', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacher(school._id);

      const { app } = createTestApp();

      const response = await request(app)
        .post('/api/homework')
        .set(authHeadersFor(admin, 'admin'))
        .send({
          title: 'Homework',
          description: 'Desc',
          subject: 'Math',
          teacherId: teacher._id.toString(),
          dueDate: futureDateISO(),
        })
        .expect(400);

      expect(JSON.stringify(response.body.details)).toMatch(/class/i);
    });

    it('accepts create without a body teacherId and uses the authenticated user', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const cls = await createClassRecord({ schoolId: school._id });

      const { app } = createTestApp();

      // teacherId is intentionally omitted — the route derives it from
      // req.user.id so the homework is owned by the caller.
      const response = await request(app)
        .post('/api/homework')
        .set(authHeadersFor(admin, 'admin'))
        .send({
          title: 'Homework',
          description: 'Desc',
          subject: 'Math',
          classId: cls._id.toString(),
          dueDate: futureDateISO(),
        })
        .expect(201);

      expect(response.body.teacherId).toBeTruthy();
    });

    it('returns 400 for invalid due date format', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacher(school._id);
      const cls = await createClassRecord({ schoolId: school._id });

      const { app } = createTestApp();

      const response = await request(app)
        .post('/api/homework')
        .set(authHeadersFor(admin, 'admin'))
        .send({
          title: 'Homework',
          description: 'Desc',
          subject: 'Math',
          classId: cls._id.toString(),
          teacherId: teacher._id.toString(),
          dueDate: 'not-a-date',
        })
        .expect(400);

      expect(JSON.stringify(response.body.details)).toMatch(/due date/i);
    });

    it('defaults dueDate to 7 days from now when omitted', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacher(school._id);
      const cls = await createClassRecord({ schoolId: school._id });

      const { app } = createTestApp();
      const before = Date.now();

      const response = await request(app)
        .post('/api/homework')
        .set(authHeadersFor(admin, 'admin'))
        .send({
          title: 'Default Due Date',
          description: 'Should get auto due date',
          subject: 'Science',
          classId: cls._id.toString(),
          teacherId: teacher._id.toString(),
        })
        .expect(201);

      const saved = await Homework.findById(response.body._id);
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      // Due date should be approximately 7 days from now
      expect(saved.dueDate.getTime()).toBeGreaterThanOrEqual(before + sevenDaysMs - 5000);
      expect(saved.dueDate.getTime()).toBeLessThanOrEqual(Date.now() + sevenDaysMs + 5000);
    });
  });

  // ─── GET /api/homework/teacher/:teacherId ─────────────────────────────

  describe('GET /api/homework/teacher/:teacherId — List teacher homework', () => {
    it('returns homework assigned by the given teacher', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacher(school._id, 'HW Teacher');
      const cls = await createClassRecord({ name: 'Class 9', schoolId: school._id });

      await Homework.create({
        schoolId: school._id,
        title: 'HW 1',
        description: 'Desc 1',
        subject: 'English',
        classId: cls._id,
        teacherId: teacher._id,
        dueDate: futureDateISO(3),
      });
      await Homework.create({
        schoolId: school._id,
        title: 'HW 2',
        description: 'Desc 2',
        subject: 'English',
        classId: cls._id,
        teacherId: teacher._id,
        dueDate: futureDateISO(5),
      });

      const { app } = createTestApp();

      const response = await request(app)
        .get(`/api/homework/teacher/${teacher._id}`)
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);

      expect(response.body).toHaveLength(2);
      // Sorted by dueDate desc
      expect(response.body[0].title).toBe('HW 2');
      expect(response.body[1].title).toBe('HW 1');
    });

    it('filters by status query param', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacher(school._id);
      const cls = await createClassRecord({ schoolId: school._id });

      await Homework.create({
        schoolId: school._id,
        title: 'Active HW',
        description: 'Desc',
        subject: 'Math',
        classId: cls._id,
        teacherId: teacher._id,
        dueDate: futureDateISO(3),
        status: 'active',
      });
      await Homework.create({
        schoolId: school._id,
        title: 'Cancelled HW',
        description: 'Desc',
        subject: 'Math',
        classId: cls._id,
        teacherId: teacher._id,
        dueDate: futureDateISO(5),
        status: 'cancelled',
      });

      const { app } = createTestApp();

      const response = await request(app)
        .get(`/api/homework/teacher/${teacher._id}?status=cancelled`)
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].title).toBe('Cancelled HW');
    });

    it('does not return homework from another school', async () => {
      const { school: school1, admin: admin1 } = await setupSchoolWithAdmin('School One');
      const { school: school2 } = await setupSchoolWithAdmin('School Two');
      const teacher = await createTeacher(school1._id);
      const cls1 = await createClassRecord({ schoolId: school1._id });
      const cls2 = await createClassRecord({ schoolId: school2._id });

      await Homework.create({
        schoolId: school1._id,
        title: 'School 1 HW',
        description: 'Desc',
        subject: 'Math',
        classId: cls1._id,
        teacherId: teacher._id,
        dueDate: futureDateISO(3),
      });
      await Homework.create({
        schoolId: school2._id,
        title: 'School 2 HW',
        description: 'Desc',
        subject: 'Math',
        classId: cls2._id,
        teacherId: teacher._id,
        dueDate: futureDateISO(3),
      });

      const { app } = createTestApp();

      const response = await request(app)
        .get(`/api/homework/teacher/${teacher._id}`)
        .set(authHeadersFor(admin1, 'admin'))
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].title).toBe('School 1 HW');
    });
  });

  // ─── GET /api/homework/class/:classId ─────────────────────────────────

  describe('GET /api/homework/class/:classId — List class homework', () => {
    it('returns active homework with future due dates for the class', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacher(school._id);
      const cls = await createClassRecord({ name: 'Class 7', schoolId: school._id });

      await Homework.create({
        schoolId: school._id,
        title: 'Future HW',
        description: 'Desc',
        subject: 'Science',
        classId: cls._id,
        teacherId: teacher._id,
        dueDate: futureDateISO(10),
        status: 'active',
      });
      // Completed homework should not appear (route filters by status='active')
      await Homework.create({
        schoolId: school._id,
        title: 'Past HW',
        description: 'Desc',
        subject: 'Science',
        classId: cls._id,
        teacherId: teacher._id,
        dueDate: new Date('2020-01-01'),
        status: 'completed',
      });

      const { app } = createTestApp();

      const response = await request(app)
        .get(`/api/homework/class/${cls._id}`)
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].title).toBe('Future HW');
      // Should populate teacher name
      expect(response.body[0].teacherId).toMatchObject({ name: expect.any(String) });
    });
  });

  // ─── GET /api/homework/:id ────────────────────────────────────────────

  describe('GET /api/homework/:id — Get homework details', () => {
    it('returns the homework with populated fields', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacher(school._id, 'Detail Teacher');
      const cls = await createClassRecord({ name: 'Class 6', section: 'B', schoolId: school._id });

      const hw = await Homework.create({
        schoolId: school._id,
        title: 'Detail HW',
        description: 'Full details here',
        subject: 'History',
        classId: cls._id,
        teacherId: teacher._id,
        dueDate: futureDateISO(4),
      });

      const { app } = createTestApp();

      const response = await request(app)
        .get(`/api/homework/${hw._id}`)
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);

      expect(response.body).toMatchObject({
        _id: hw._id.toString(),
        title: 'Detail HW',
        description: 'Full details here',
        subject: 'History',
        status: 'active',
      });
      expect(response.body.teacherId).toMatchObject({ name: 'Detail Teacher' });
      expect(response.body.classId).toMatchObject({ name: 'Class 6', section: 'B' });
    });

    it('returns 404 for non-existent homework', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const fakeId = new mongoose.Types.ObjectId();

      await request(app)
        .get(`/api/homework/${fakeId}`)
        .set(authHeadersFor(admin, 'admin'))
        .expect(404);
    });

    it('returns 404 when homework belongs to a different school', async () => {
      const { school: school1 } = await setupSchoolWithAdmin('School A');
      const { school: school2, admin: admin2 } = await setupSchoolWithAdmin('School B');
      const teacher = await createTeacher(school1._id);
      const cls = await createClassRecord({ schoolId: school1._id });

      const hw = await Homework.create({
        schoolId: school1._id,
        title: 'Other School HW',
        description: 'Desc',
        subject: 'Math',
        classId: cls._id,
        teacherId: teacher._id,
        dueDate: futureDateISO(3),
      });

      const { app } = createTestApp();

      // admin2 is from school2, so should not see school1's homework
      await request(app)
        .get(`/api/homework/${hw._id}`)
        .set(authHeadersFor(admin2, 'admin'))
        .expect(404);
    });
  });

  // ─── PUT /api/homework/:id ────────────────────────────────────────────

  describe('PUT /api/homework/:id — Update homework', () => {
    it('updates homework fields and returns the updated document', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacher(school._id);
      const cls = await createClassRecord({ schoolId: school._id });

      const hw = await Homework.create({
        schoolId: school._id,
        title: 'Original Title',
        description: 'Original Desc',
        subject: 'Math',
        classId: cls._id,
        teacherId: teacher._id,
        dueDate: futureDateISO(5),
      });

      const { app } = createTestApp();
      const newDueDate = futureDateISO(10);

      const response = await request(app)
        .put(`/api/homework/${hw._id}`)
        .set(authHeadersFor(admin, 'admin'))
        .send({
          title: 'Updated Title',
          description: 'Updated Desc',
          subject: 'Science',
          dueDate: newDueDate,
          status: 'completed',
        })
        .expect(200);

      expect(response.body).toMatchObject({
        title: 'Updated Title',
        description: 'Updated Desc',
        subject: 'Science',
        status: 'completed',
      });

      // Verify in database
      const updated = await Homework.findById(hw._id);
      expect(updated.title).toBe('Updated Title');
      expect(updated.status).toBe('completed');
    });

    it('returns 404 when updating non-existent homework', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const fakeId = new mongoose.Types.ObjectId();

      await request(app)
        .put(`/api/homework/${fakeId}`)
        .set(authHeadersFor(admin, 'admin'))
        .send({ title: 'Nope' })
        .expect(404);
    });
  });

  // ─── DELETE /api/homework/:id ─────────────────────────────────────────

  describe('DELETE /api/homework/:id — Delete homework', () => {
    it('deletes homework and returns success message', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacher(school._id);
      const cls = await createClassRecord({ schoolId: school._id });

      const hw = await Homework.create({
        schoolId: school._id,
        title: 'To Delete',
        description: 'Will be removed',
        subject: 'Art',
        classId: cls._id,
        teacherId: teacher._id,
        dueDate: futureDateISO(2),
      });

      const { app } = createTestApp();

      const response = await request(app)
        .delete(`/api/homework/${hw._id}`)
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Homework deleted successfully',
      });

      // Soft-delete: the document stays in the collection but is hidden
      // from list/get endpoints via `isDeleted: { $ne: true }` filters.
      const deleted = await Homework.findById(hw._id);
      expect(deleted).not.toBeNull();
      expect(deleted.isDeleted).toBe(true);
    });

    it('returns 404 when deleting non-existent homework', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const fakeId = new mongoose.Types.ObjectId();

      await request(app)
        .delete(`/api/homework/${fakeId}`)
        .set(authHeadersFor(admin, 'admin'))
        .expect(404);
    });

    it('returns 404 when deleting homework from a different school', async () => {
      const { school: school1 } = await setupSchoolWithAdmin('Del School A');
      const { school: school2, admin: admin2 } = await setupSchoolWithAdmin('Del School B');
      const teacher = await createTeacher(school1._id);
      const cls = await createClassRecord({ schoolId: school1._id });

      const hw = await Homework.create({
        schoolId: school1._id,
        title: 'Cross-school delete',
        description: 'Desc',
        subject: 'Math',
        classId: cls._id,
        teacherId: teacher._id,
        dueDate: futureDateISO(3),
      });

      const { app } = createTestApp();

      await request(app)
        .delete(`/api/homework/${hw._id}`)
        .set(authHeadersFor(admin2, 'admin'))
        .expect(404);

      // Verify still exists in database
      const stillExists = await Homework.findById(hw._id);
      expect(stillExists).toBeTruthy();
    });
  });
});
