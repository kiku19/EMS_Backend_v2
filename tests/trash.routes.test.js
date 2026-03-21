import request from 'supertest';
import { describe, expect, it, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import TrashItem from '../models/TrashItem.js';
import { Student, Staff, Class } from '../database.js';
import {
  authHeadersFor,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
  createClassRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const BASE = '/api/trash';

/** Create a trash item record for a student. */
async function createStudentTrashItem({ studentId, deletedBy, itemName = 'Test Student' }) {
  return TrashItem.create({
    itemType: 'Student',
    itemId: studentId,
    itemName,
    deletedBy,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    originalData: { _id: studentId, name: itemName },
  });
}

/** Create a trash item record for a class. */
async function createClassTrashItem({ classId, deletedBy, itemName = 'Test Class' }) {
  return TrashItem.create({
    itemType: 'Class',
    itemId: classId,
    itemName,
    deletedBy,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    originalData: { _id: classId, name: itemName },
  });
}

describe('trash routes', () => {
  let app, school, admin, headers, defaultClass;

  beforeEach(async () => {
    school = await createSchoolRecord({ name: 'Trash School', code: 'TRS' });
    admin = await createStaffUser({
      name: 'Trash Admin',
      email: 'trash.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    headers = authHeadersFor(admin, 'admin');
    defaultClass = await createClassRecord({
      name: 'Trash Class',
      section: 'A',
      schoolId: school._id,
    });
    ({ app } = createTestApp());
  });

  // ───────────────────────────────────────────────────────────────
  // Auth
  // ───────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('GET / returns 401 without token', async () => {
      await request(app).get(BASE).expect(401);
    });

    it('GET /stats returns 401 without token', async () => {
      await request(app).get(`${BASE}/stats`).expect(401);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET / — list trash items
  // ───────────────────────────────────────────────────────────────
  describe('GET /', () => {
    it('returns an empty list when no trash items exist', async () => {
      const res = await request(app).get(BASE).set(headers).expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(0);
      expect(res.body).toHaveProperty('total', 0);
    });

    it('returns trash items with pagination info', async () => {
      const student = await createStudentRecord({
        schoolId: school._id,
        classId: defaultClass._id,
        rollNo: 1,
      });
      await createStudentTrashItem({ studentId: student._id, deletedBy: admin._id });

      const res = await request(app).get(BASE).set(headers).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].itemType).toBe('Student');
      expect(res.body.pagination).toHaveProperty('page', 1);
      expect(res.body.pagination).toHaveProperty('limit', 50);
    });

    it('filters by type query param', async () => {
      const student = await createStudentRecord({
        schoolId: school._id,
        classId: defaultClass._id,
        rollNo: 2,
      });
      const cls = await createClassRecord({ schoolId: school._id, name: 'Class Trash' });

      await createStudentTrashItem({
        studentId: student._id,
        deletedBy: admin._id,
        itemName: 'Filtered Student',
      });
      await createClassTrashItem({
        classId: cls._id,
        deletedBy: admin._id,
        itemName: 'Filtered Class',
      });

      const res = await request(app).get(`${BASE}?type=Student`).set(headers).expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].itemType).toBe('Student');
    });

    it('filters by search query param on itemName', async () => {
      const student1 = await createStudentRecord({
        schoolId: school._id,
        classId: defaultClass._id,
        rollNo: 3,
        name: 'Alice Smith',
      });
      const student2 = await createStudentRecord({
        schoolId: school._id,
        classId: defaultClass._id,
        rollNo: 4,
        name: 'Bob Jones',
      });

      await createStudentTrashItem({
        studentId: student1._id,
        deletedBy: admin._id,
        itemName: 'Alice Smith',
      });
      await createStudentTrashItem({
        studentId: student2._id,
        deletedBy: admin._id,
        itemName: 'Bob Jones',
      });

      const res = await request(app).get(`${BASE}?search=Alice`).set(headers).expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].itemName).toBe('Alice Smith');
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /stats — statistics
  // ───────────────────────────────────────────────────────────────
  describe('GET /stats', () => {
    it('returns stats when trash is empty', async () => {
      const res = await request(app).get(`${BASE}/stats`).set(headers).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.byType).toBeDefined();
      expect(typeof res.body.totalExpiring).toBe('number');
    });

    it('returns correct counts by type', async () => {
      const s1 = await createStudentRecord({
        schoolId: school._id,
        classId: defaultClass._id,
        rollNo: 5,
      });
      const s2 = await createStudentRecord({
        schoolId: school._id,
        classId: defaultClass._id,
        rollNo: 6,
      });
      const cls = await createClassRecord({ schoolId: school._id, name: 'Stats Class' });

      await createStudentTrashItem({ studentId: s1._id, deletedBy: admin._id });
      await createStudentTrashItem({ studentId: s2._id, deletedBy: admin._id });
      await createClassTrashItem({ classId: cls._id, deletedBy: admin._id });

      const res = await request(app).get(`${BASE}/stats`).set(headers).expect(200);

      expect(res.body.byType.Student.count).toBe(2);
      expect(res.body.byType.Class.count).toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // POST /:trashItemId/restore — restore item
  // ───────────────────────────────────────────────────────────────
  describe('POST /:trashItemId/restore', () => {
    it('restores a soft-deleted student by removing isDeleted flag', async () => {
      const student = await createStudentRecord({
        schoolId: school._id,
        classId: defaultClass._id,
        rollNo: 7,
      });

      // Mark the student as soft-deleted
      await Student.findByIdAndUpdate(student._id, { isDeleted: true, deletedAt: new Date() });

      const trashItem = await createStudentTrashItem({
        studentId: student._id,
        deletedBy: admin._id,
        itemName: student.name,
      });

      const res = await request(app)
        .post(`${BASE}/${trashItem._id}/restore`)
        .set(headers)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/student/i);

      // Verify student is restored
      const restored = await Student.findById(student._id);
      expect(restored.isDeleted).toBe(false);
      expect(restored.deletedAt).toBeNull();

      // Verify trash item is removed
      const trashGone = await TrashItem.findById(trashItem._id);
      expect(trashGone).toBeNull();
    });

    it('restores a soft-deleted class', async () => {
      const cls = await createClassRecord({ schoolId: school._id, name: 'Restore Me Class' });

      await Class.findByIdAndUpdate(cls._id, { isDeleted: true, deletedAt: new Date() });

      const trashItem = await createClassTrashItem({
        classId: cls._id,
        deletedBy: admin._id,
        itemName: cls.name,
      });

      const res = await request(app)
        .post(`${BASE}/${trashItem._id}/restore`)
        .set(headers)
        .expect(200);

      expect(res.body.success).toBe(true);

      const restored = await Class.findById(cls._id);
      expect(restored.isDeleted).toBe(false);
    });

    it('returns 404 for a non-existent trash item', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      await request(app).post(`${BASE}/${fakeId}/restore`).set(headers).expect(404);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // DELETE /:trashItemId — permanent delete
  // ───────────────────────────────────────────────────────────────
  describe('DELETE /:trashItemId', () => {
    it('permanently deletes a staff member from the trash', async () => {
      const staffMember = await createStaffUser({
        name: 'Perm Delete Staff',
        email: 'perm.delete@example.com',
        schoolId: school._id,
        staffRole: ['Teacher'],
        permissionRole: 'teacher',
      });

      const trashItem = await TrashItem.create({
        itemType: 'Staff',
        itemId: staffMember._id,
        itemName: staffMember.name,
        deletedBy: admin._id,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        originalData: { _id: staffMember._id, name: staffMember.name },
      });

      const res = await request(app).delete(`${BASE}/${trashItem._id}`).set(headers).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/staff/i);

      // Staff is permanently deleted
      const staffGone = await Staff.findById(staffMember._id);
      expect(staffGone).toBeNull();

      // Trash item is removed
      const trashGone = await TrashItem.findById(trashItem._id);
      expect(trashGone).toBeNull();
    });

    it('returns 404 for a non-existent trash item', async () => {
      await request(app)
        .delete(`${BASE}/${new mongoose.Types.ObjectId()}`)
        .set(headers)
        .expect(404);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // POST /bulk-restore — bulk restore
  // ───────────────────────────────────────────────────────────────
  describe('POST /bulk-restore', () => {
    it('returns 400 when trashItemIds is empty', async () => {
      await request(app)
        .post(`${BASE}/bulk-restore`)
        .set(headers)
        .send({ trashItemIds: [] })
        .expect(400);
    });

    it('returns 400 when trashItemIds is missing', async () => {
      await request(app).post(`${BASE}/bulk-restore`).set(headers).send({}).expect(400);
    });

    it('bulk restores multiple students', async () => {
      const s1 = await createStudentRecord({
        schoolId: school._id,
        classId: defaultClass._id,
        rollNo: 20,
      });
      const s2 = await createStudentRecord({
        schoolId: school._id,
        classId: defaultClass._id,
        rollNo: 21,
      });

      await Student.findByIdAndUpdate(s1._id, { isDeleted: true, deletedAt: new Date() });
      await Student.findByIdAndUpdate(s2._id, { isDeleted: true, deletedAt: new Date() });

      const t1 = await createStudentTrashItem({
        studentId: s1._id,
        deletedBy: admin._id,
        itemName: 'Bulk S1',
      });
      const t2 = await createStudentTrashItem({
        studentId: s2._id,
        deletedBy: admin._id,
        itemName: 'Bulk S2',
      });

      const res = await request(app)
        .post(`${BASE}/bulk-restore`)
        .set(headers)
        .send({ trashItemIds: [t1._id.toString(), t2._id.toString()] })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.restored).toHaveLength(2);
      expect(res.body.failed).toHaveLength(0);

      const r1 = await Student.findById(s1._id);
      expect(r1.isDeleted).toBe(false);
    });

    it('reports partial failure when some items do not exist', async () => {
      const student = await createStudentRecord({
        schoolId: school._id,
        classId: defaultClass._id,
        rollNo: 22,
      });
      await Student.findByIdAndUpdate(student._id, { isDeleted: true });
      const trashItem = await createStudentTrashItem({
        studentId: student._id,
        deletedBy: admin._id,
      });

      const fakeId = new mongoose.Types.ObjectId().toString();

      const res = await request(app)
        .post(`${BASE}/bulk-restore`)
        .set(headers)
        .send({ trashItemIds: [trashItem._id.toString(), fakeId] })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.restored).toHaveLength(1);
      expect(res.body.failed).toHaveLength(1);
    });
  });
});
