import request from 'supertest';
import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { Staff } from '../database.js';
import { createSchoolRecord, createStaffUser, authHeadersFor } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

/**
 * Helper: create a school with an admin user, returning both.
 * Sets a unique username on the admin to avoid compound unique index
 * collision on { schoolId, username }.
 */
let adminSeq = 0;
async function setupSchoolWithAdmin(schoolName = 'Staff Test School') {
  adminSeq += 1;
  const school = await createSchoolRecord({ name: schoolName });
  const admin = await createStaffUser({ schoolId: school._id });
  await Staff.findByIdAndUpdate(admin._id, {
    username: `staff_admin_${adminSeq}_${Date.now()}`,
  });
  return { school, admin };
}

/**
 * Helper: create a teacher in the given school with a unique username.
 */
let teacherSeq = 0;
async function createTeacherInSchool(schoolId, overrides = {}) {
  teacherSeq += 1;
  const teacher = await createStaffUser({
    name: overrides.name || `Teacher ${teacherSeq}`,
    staffRole: ['Teacher'],
    permissionRole: 'teacher',
    schoolId,
    ...overrides,
  });
  await Staff.findByIdAndUpdate(teacher._id, {
    username: `teacher_${teacherSeq}_${Date.now()}`,
  });
  return teacher;
}

describe('staff routes', () => {
  // ─── AUTH: 401 without token ──────────────────────────────────────

  describe('Authentication — 401 without token', () => {
    it('GET /api/staff returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/staff').expect(401);
    });

    it('GET /api/staff/:id returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).get(`/api/staff/${fakeId}`).expect(401);
    });

    it('POST /api/staff returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app)
        .post('/api/staff')
        .send({ name: 'Ghost Staff', role: ['Teacher'] })
        .expect(401);
    });

    it('PUT /api/staff/:id returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).put(`/api/staff/${fakeId}`).send({ name: 'Updated Name' }).expect(401);
    });

    it('DELETE /api/staff/:id returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).delete(`/api/staff/${fakeId}`).expect(401);
    });

    it('GET /api/staff/me returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/staff/me').expect(401);
    });
  });

  // ─── GET /api/staff/me — Current staff profile ────────────────────

  describe('GET /api/staff/me — Current staff profile', () => {
    it('returns the authenticated staff member profile', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app).get('/api/staff/me').set(authHeaders).expect(200);

      expect(response.body).toMatchObject({
        id: admin._id.toString(),
        name: admin.name,
        role: admin.role,
      });
      expect(response.body).toHaveProperty('email');
      expect(response.body).toHaveProperty('code');
    });

    it('returns 404 if the staff member does not exist (stale token)', async () => {
      const { school } = await setupSchoolWithAdmin();
      // Create a staff user then delete it from DB
      const tempStaff = await createStaffUser({
        name: 'Vanished Staff',
        schoolId: school._id,
      });
      await Staff.findByIdAndUpdate(tempStaff._id, {
        username: `vanished_${Date.now()}`,
      });
      const authHeaders = authHeadersFor(tempStaff, 'admin');
      await Staff.deleteOne({ _id: tempStaff._id });

      const { app } = createTestApp();
      const response = await request(app).get('/api/staff/me').set(authHeaders).expect(404);

      expect(response.body.error).toMatch(/not found/i);
    });
  });

  // ─── GET /api/staff — List staff ──────────────────────────────────

  describe('GET /api/staff — List staff', () => {
    it('returns all staff for the school as an array (non-paginated)', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      await createTeacherInSchool(school._id, { name: 'Teacher Alpha' });
      await createTeacherInSchool(school._id, { name: 'Teacher Beta' });

      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app).get('/api/staff').set(authHeaders).expect(200);

      // Non-paginated returns a plain array
      expect(Array.isArray(response.body)).toBe(true);
      // Admin + 2 teachers = 3
      expect(response.body.length).toBe(3);
      expect(response.body[0]).toHaveProperty('id');
      expect(response.body[0]).toHaveProperty('name');
      expect(response.body[0]).toHaveProperty('role');
    });

    it('returns paginated results when page param is provided', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      // Create 5 additional staff members
      for (let i = 0; i < 5; i++) {
        await createTeacherInSchool(school._id, { name: `Paged Teacher ${i + 1}` });
      }

      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app)
        .get('/api/staff?page=1&limit=3')
        .set(authHeaders)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('pagination');
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBe(3);
      expect(response.body.pagination).toMatchObject({
        page: 1,
        limit: 3,
        total: 6, // admin + 5 teachers
        totalPages: 2,
      });
    });

    it('does not return soft-deleted staff in the list', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacherInSchool(school._id, { name: 'Deleted Teacher' });
      await Staff.findByIdAndUpdate(teacher._id, {
        isDeleted: true,
        deletedAt: new Date(),
      });

      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app).get('/api/staff').set(authHeaders).expect(200);

      const names = response.body.map((s) => s.name);
      expect(names).not.toContain('Deleted Teacher');
    });
  });

  // ─── GET /api/staff/:id — Get staff by ID ─────────────────────────

  describe('GET /api/staff/:id — Get staff by ID', () => {
    it('returns the staff member with expected fields', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacherInSchool(school._id, { name: 'Detail Teacher' });

      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app)
        .get(`/api/staff/${teacher._id}`)
        .set(authHeaders)
        .expect(200);

      expect(response.body).toMatchObject({
        id: teacher._id.toString(),
        name: 'Detail Teacher',
        role: ['Teacher'],
      });
      expect(response.body).toHaveProperty('email');
      expect(response.body).toHaveProperty('code');
      expect(response.body).toHaveProperty('status');
    });

    it('returns 404 for a non-existent staff ID', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');
      const fakeId = new mongoose.Types.ObjectId().toString();

      await request(app).get(`/api/staff/${fakeId}`).set(authHeaders).expect(404);
    });

    it('returns 404 for a soft-deleted staff member', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacherInSchool(school._id);
      await Staff.findByIdAndUpdate(teacher._id, {
        isDeleted: true,
        deletedAt: new Date(),
      });

      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      await request(app).get(`/api/staff/${teacher._id}`).set(authHeaders).expect(404);
    });
  });

  // ─── POST /api/staff — Create staff ───────────────────────────────

  describe('POST /api/staff — Create staff', () => {
    it('creates a new staff member and returns it with an id and code', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app)
        .post('/api/staff')
        .set(authHeaders)
        .send({
          name: 'New Teacher',
          role: ['Teacher'],
          email: 'new.teacher@example.com',
          phone: '9876543210',
          department: 'Science',
        })
        .expect(201);

      expect(response.body).toMatchObject({
        name: 'New Teacher',
        role: ['Teacher'],
        department: 'Science',
      });
      expect(response.body.id).toBeTruthy();
      expect(response.body.code).toBeTruthy();
      expect(response.body.username).toBeTruthy();
      // Password should NOT be returned
      expect(response.body.password).toBeUndefined();
    });

    it('creates staff with minimal required fields (name + role)', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app)
        .post('/api/staff')
        .set(authHeaders)
        .send({
          name: 'Minimal Staff',
          role: ['Admin'],
        })
        .expect(201);

      expect(response.body.name).toBe('Minimal Staff');
      expect(response.body.id).toBeTruthy();
    });

    it('rejects duplicate email within the same school', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      await request(app)
        .post('/api/staff')
        .set(authHeaders)
        .send({
          name: 'First Staff',
          role: ['Teacher'],
          email: 'duplicate@example.com',
        })
        .expect(201);

      const response = await request(app)
        .post('/api/staff')
        .set(authHeaders)
        .send({
          name: 'Second Staff',
          role: ['Teacher'],
          email: 'duplicate@example.com',
        })
        .expect(400);

      expect(response.body.error).toMatch(/email already used/i);
    });

    // ─── Zod validation tests ───────────────────────────────────

    describe('Zod validation', () => {
      it('returns 400 when name is missing', async () => {
        const { admin } = await setupSchoolWithAdmin();
        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app)
          .post('/api/staff')
          .set(authHeaders)
          .send({ role: ['Teacher'] })
          .expect(400);

        expect(response.body.error || response.body.errors).toBeTruthy();
      });

      it('returns 400 when role is missing', async () => {
        const { admin } = await setupSchoolWithAdmin();
        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app)
          .post('/api/staff')
          .set(authHeaders)
          .send({ name: 'No Role Staff' })
          .expect(400);

        expect(response.body.error || response.body.errors).toBeTruthy();
      });

      it('returns 400 when name is too short (less than 2 chars)', async () => {
        const { admin } = await setupSchoolWithAdmin();
        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app)
          .post('/api/staff')
          .set(authHeaders)
          .send({ name: 'A', role: ['Teacher'] })
          .expect(400);

        expect(response.body.error || response.body.errors).toBeTruthy();
      });

      it('returns 400 for invalid email format', async () => {
        const { admin } = await setupSchoolWithAdmin();
        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app)
          .post('/api/staff')
          .set(authHeaders)
          .send({
            name: 'Bad Email Staff',
            role: ['Teacher'],
            email: 'not-an-email',
          })
          .expect(400);

        expect(response.body.error || response.body.errors).toBeTruthy();
      });

      it('returns 400 for invalid status enum value', async () => {
        const { admin } = await setupSchoolWithAdmin();
        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app)
          .post('/api/staff')
          .set(authHeaders)
          .send({
            name: 'Bad Status Staff',
            role: ['Teacher'],
            status: 'fired',
          })
          .expect(400);

        expect(response.body.error || response.body.errors).toBeTruthy();
      });

      it('returns 400 for invalid IFSC code format', async () => {
        const { admin } = await setupSchoolWithAdmin();
        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app)
          .post('/api/staff')
          .set(authHeaders)
          .send({
            name: 'Bad IFSC Staff',
            role: ['Teacher'],
            ifscCode: 'INVALID',
          })
          .expect(400);

        expect(response.body.error || response.body.errors).toBeTruthy();
      });

      it('returns 400 for invalid PAN number format', async () => {
        const { admin } = await setupSchoolWithAdmin();
        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app)
          .post('/api/staff')
          .set(authHeaders)
          .send({
            name: 'Bad PAN Staff',
            role: ['Teacher'],
            panNumber: '12345',
          })
          .expect(400);

        expect(response.body.error || response.body.errors).toBeTruthy();
      });

      it('returns 400 for negative salary value', async () => {
        const { admin } = await setupSchoolWithAdmin();
        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app)
          .post('/api/staff')
          .set(authHeaders)
          .send({
            name: 'Negative Salary Staff',
            role: ['Teacher'],
            salary: -5000,
          })
          .expect(400);

        expect(response.body.error || response.body.errors).toBeTruthy();
      });

      it('accepts role as a string and normalizes to array', async () => {
        const { admin } = await setupSchoolWithAdmin();
        const { app } = createTestApp();
        const authHeaders = authHeadersFor(admin, 'admin');

        const response = await request(app)
          .post('/api/staff')
          .set(authHeaders)
          .send({
            name: 'String Role Staff',
            role: 'Teacher',
          })
          .expect(201);

        expect(Array.isArray(response.body.role)).toBe(true);
        expect(response.body.role).toContain('Teacher');
      });
    });
  });

  // ─── PUT /api/staff/:id — Update staff ────────────────────────────

  describe('PUT /api/staff/:id — Update staff', () => {
    it('updates staff fields and returns updated data', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacherInSchool(school._id, { name: 'Before Update' });

      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app)
        .put(`/api/staff/${teacher._id}`)
        .set(authHeaders)
        .send({
          name: 'After Update',
          department: 'Mathematics',
          phone: '9111222333',
        })
        .expect(200);

      expect(response.body).toMatchObject({
        id: teacher._id.toString(),
        name: 'After Update',
        department: 'Mathematics',
        phone: '9111222333',
      });
    });

    it('returns 404 when updating a non-existent staff member', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');
      const fakeId = new mongoose.Types.ObjectId().toString();

      await request(app)
        .put(`/api/staff/${fakeId}`)
        .set(authHeaders)
        .send({ name: 'Ghost Update' })
        .expect(404);
    });

    it('returns 404 when updating a soft-deleted staff member', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacherInSchool(school._id);
      await Staff.findByIdAndUpdate(teacher._id, {
        isDeleted: true,
        deletedAt: new Date(),
      });

      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      await request(app)
        .put(`/api/staff/${teacher._id}`)
        .set(authHeaders)
        .send({ name: 'Zombie Update' })
        .expect(404);
    });

    it('lowercases email on update', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacherInSchool(school._id);

      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app)
        .put(`/api/staff/${teacher._id}`)
        .set(authHeaders)
        .send({ email: 'UPPER@EXAMPLE.COM' })
        .expect(200);

      expect(response.body.email).toBe('upper@example.com');
    });

    it("does NOT desync Staff↔Class when caller sends isClassTeacher/classTeacherOf alone", async () => {
      // Before the fix, sending `{isClassTeacher: true, classTeacherOf:
      // 'Class 5-A'}` wrote those flags to the Staff doc without ever
      // updating Class.classTeacherId — the two collections drifted.
      // Now those fields are server-derived; the legacy shape is resolved
      // to an assignedClassId and both sides of the relationship update.
      const { Class } = await import('../database.js');
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacherInSchool(school._id, { name: 'CT Candidate' });

      const targetClass = await Class.create({
        schoolId: school._id,
        name: 'Class 5',
        section: 'A',
      });

      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      await request(app)
        .put(`/api/staff/${teacher._id}`)
        .set(authHeaders)
        .send({
          isClassTeacher: true,
          classTeacherOf: 'Class 5-A',
        })
        .expect(200);

      // Staff side updated
      const updatedTeacher = await Staff.findById(teacher._id).lean();
      expect(updatedTeacher.isClassTeacher).toBe(true);
      expect(updatedTeacher.classTeacherOf).toBe('Class 5-A');

      // Class side MUST also be updated — this is the fix
      const updatedClass = await Class.findById(targetClass._id).lean();
      expect(updatedClass.classTeacherId?.toString()).toBe(teacher._id.toString());
    });

    it('validates update payload with Zod (rejects invalid status)', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacherInSchool(school._id);

      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app)
        .put(`/api/staff/${teacher._id}`)
        .set(authHeaders)
        .send({ status: 'nonexistent-status' })
        .expect(400);

      expect(response.body.error || response.body.errors).toBeTruthy();
    });
  });

  // ─── DELETE /api/staff/:id — Soft delete ──────────────────────────

  describe('DELETE /api/staff/:id — Soft delete', () => {
    it('soft-deletes a staff member and returns success', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacherInSchool(school._id, { name: 'To Delete' });

      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app)
        .delete(`/api/staff/${teacher._id}`)
        .set(authHeaders)
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify in DB: isDeleted is true, status is inactive
      const deleted = await Staff.findById(teacher._id).lean();
      expect(deleted).toBeTruthy();
      expect(deleted.isDeleted).toBe(true);
      expect(deleted.deletedAt).toBeTruthy();
      expect(deleted.status).toBe('inactive');
    });

    it('returns 404 when deleting a non-existent staff member', async () => {
      const { admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');
      const fakeId = new mongoose.Types.ObjectId().toString();

      await request(app).delete(`/api/staff/${fakeId}`).set(authHeaders).expect(404);
    });

    it('returns 404 when deleting an already-deleted staff member', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacherInSchool(school._id);
      await Staff.findByIdAndUpdate(teacher._id, {
        isDeleted: true,
        deletedAt: new Date(),
      });

      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      await request(app).delete(`/api/staff/${teacher._id}`).set(authHeaders).expect(404);
    });

    it('soft-deleted staff no longer appears in GET /api/staff list', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const teacher = await createTeacherInSchool(school._id, { name: 'Vanishing Staff' });

      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      // Delete
      await request(app).delete(`/api/staff/${teacher._id}`).set(authHeaders).expect(200);

      // Verify not in list
      const listResponse = await request(app).get('/api/staff').set(authHeaders).expect(200);

      const names = listResponse.body.map((s) => s.name);
      expect(names).not.toContain('Vanishing Staff');
    });
  });

  // ─── Multi-tenancy ────────────────────────────────────────────────

  describe('Multi-tenancy', () => {
    it('School A admin cannot see School B staff in the list', async () => {
      const schoolA = await createSchoolRecord({ name: 'Tenant School A' });
      const schoolB = await createSchoolRecord({ name: 'Tenant School B' });

      const adminA = await createStaffUser({ schoolId: schoolA._id, name: 'Admin A' });
      await Staff.findByIdAndUpdate(adminA._id, { username: `tenantA_admin_${Date.now()}` });

      await createTeacherInSchool(schoolA._id, { name: 'Teacher in A' });
      await createTeacherInSchool(schoolB._id, { name: 'Teacher in B' });

      const { app } = createTestApp();
      const authHeadersA = authHeadersFor(adminA, 'admin');

      const response = await request(app).get('/api/staff').set(authHeadersA).expect(200);

      const names = response.body.map((s) => s.name);
      expect(names).toContain('Teacher in A');
      expect(names).not.toContain('Teacher in B');
    });

    it('School A admin cannot access School B staff by ID', async () => {
      const schoolA = await createSchoolRecord({ name: 'ISO School A' });
      const schoolB = await createSchoolRecord({ name: 'ISO School B' });

      const adminA = await createStaffUser({ schoolId: schoolA._id, name: 'ISO Admin A' });
      await Staff.findByIdAndUpdate(adminA._id, { username: `iso_admin_${Date.now()}` });

      const teacherB = await createTeacherInSchool(schoolB._id, { name: 'Secret Teacher B' });

      const { app } = createTestApp();
      const authHeadersA = authHeadersFor(adminA, 'admin');

      await request(app).get(`/api/staff/${teacherB._id}`).set(authHeadersA).expect(404);
    });

    it('School A admin cannot update School B staff', async () => {
      const schoolA = await createSchoolRecord({ name: 'Update ISO A' });
      const schoolB = await createSchoolRecord({ name: 'Update ISO B' });

      const adminA = await createStaffUser({ schoolId: schoolA._id, name: 'Update Admin A' });
      await Staff.findByIdAndUpdate(adminA._id, { username: `update_iso_admin_${Date.now()}` });

      const teacherB = await createTeacherInSchool(schoolB._id, { name: 'B Only Teacher' });

      const { app } = createTestApp();
      const authHeadersA = authHeadersFor(adminA, 'admin');

      await request(app)
        .put(`/api/staff/${teacherB._id}`)
        .set(authHeadersA)
        .send({ name: 'Hacked Name' })
        .expect(404);

      // Verify the name was NOT changed
      const unchanged = await Staff.findById(teacherB._id).lean();
      expect(unchanged.name).toBe('B Only Teacher');
    });

    it('School A admin cannot delete School B staff', async () => {
      const schoolA = await createSchoolRecord({ name: 'Delete ISO A' });
      const schoolB = await createSchoolRecord({ name: 'Delete ISO B' });

      const adminA = await createStaffUser({ schoolId: schoolA._id, name: 'Delete Admin A' });
      await Staff.findByIdAndUpdate(adminA._id, { username: `delete_iso_admin_${Date.now()}` });

      const teacherB = await createTeacherInSchool(schoolB._id, { name: 'Protected Teacher B' });

      const { app } = createTestApp();
      const authHeadersA = authHeadersFor(adminA, 'admin');

      await request(app).delete(`/api/staff/${teacherB._id}`).set(authHeadersA).expect(404);

      // Verify the staff is still active and not deleted
      const stillExists = await Staff.findById(teacherB._id).lean();
      expect(stillExists.isDeleted).toBeFalsy();
    });

    it('staff created via POST has correct schoolId from auth context', async () => {
      const { school, admin } = await setupSchoolWithAdmin();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      const response = await request(app)
        .post('/api/staff')
        .set(authHeaders)
        .send({
          name: 'Scoped Staff',
          role: ['Teacher'],
        })
        .expect(201);

      expect(response.body.schoolId).toBe(school._id.toString());

      // Verify in DB
      const dbStaff = await Staff.findById(response.body.id).lean();
      expect(dbStaff.schoolId.toString()).toBe(school._id.toString());
    });
  });
});
