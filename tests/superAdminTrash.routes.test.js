/**
 * Phase 3 — Super-admin cross-school recycle bin.
 *
 * GET/POST/DELETE /api/v1/super-admin/trash let the operator see and restore
 * deleted items across ALL schools (within the 60-day retention window).
 */

import request from 'supertest';
import { describe, expect, it, beforeEach } from 'vitest';
import TrashItem from '../models/TrashItem.js';
import { Class } from '../database.js';
import { generateToken } from '../middleware/auth.js';
import {
  resetDefaultSchool,
  createSchoolRecord,
  createStaffUser,
  createClassRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const BASE = '/api/v1/super-admin/trash';
const { app } = createTestApp();

const SUPER_ADMIN_HEADERS = {
  Authorization: `Bearer ${generateToken('super-admin', ['Super Admin'], {
    userType: 'super-admin',
  })}`,
};

function staffHeaders(staff) {
  return {
    Authorization: `Bearer ${generateToken(staff._id.toString(), 'Admin', {
      schoolId: staff.schoolId,
      userType: 'staff',
    })}`,
  };
}

async function trashForClass({
  classId,
  deletedBy,
  schoolId,
  itemName = 'Test Class',
  daysLeft = 30,
}) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + daysLeft);
  return TrashItem.create({
    itemType: 'Class',
    itemId: classId,
    itemName,
    deletedBy,
    schoolId,
    restoreStrategy: 'soft-delete',
    modelName: 'Class',
    softDeleteField: 'isDeleted',
    expiresAt,
    originalData: { _id: classId, name: itemName },
  });
}

describe('super-admin cross-school trash', () => {
  let schoolA, schoolB, adminA, classA, classB;

  beforeEach(async () => {
    resetDefaultSchool();
    schoolA = await createSchoolRecord({ name: 'Trash School A', code: 'TRSA' });
    schoolB = await createSchoolRecord({ name: 'Trash School B', code: 'TRSB' });
    adminA = await createStaffUser({
      name: 'Admin A',
      email: 'admin.a@example.com',
      schoolId: schoolA._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    classA = await createClassRecord({ name: 'Grade 1', section: 'A', schoolId: schoolA._id });
    classB = await createClassRecord({ name: 'Grade 2', section: 'B', schoolId: schoolB._id });
    // Both classes are "deleted" (soft) so restore can flip them back.
    await Class.findByIdAndUpdate(classA._id, { isDeleted: true });
    await Class.findByIdAndUpdate(classB._id, { isDeleted: true });
  });

  it('rejects non-super-admin staff with 403', async () => {
    const res = await request(app).get(BASE).set(staffHeaders(adminA));
    expect(res.status).toBe(403);
  });

  it('lists trash across all schools with school + actor populated', async () => {
    await trashForClass({
      classId: classA._id,
      deletedBy: adminA._id,
      schoolId: schoolA._id,
      itemName: 'Grade 1',
    });
    await trashForClass({
      classId: classB._id,
      deletedBy: adminA._id,
      schoolId: schoolB._id,
      itemName: 'Grade 2',
    });

    const res = await request(app).get(BASE).set(SUPER_ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination.total).toBe(2);
    // Each row carries the owning school + actor for the cross-school view.
    const schools = res.body.data.map((r) => r.school?.name).sort();
    expect(schools).toEqual(['Trash School A', 'Trash School B'].sort());
    expect(res.body.data[0].deletedBy?.name).toBe('Admin A');
  });

  it('filters by schoolId', async () => {
    await trashForClass({ classId: classA._id, deletedBy: adminA._id, schoolId: schoolA._id });
    await trashForClass({ classId: classB._id, deletedBy: adminA._id, schoolId: schoolB._id });

    const res = await request(app)
      .get(BASE)
      .query({ schoolId: schoolA._id.toString() })
      .set(SUPER_ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(String(res.body.data[0].school._id)).toBe(String(schoolA._id));
  });

  it('returns stats with byType, bySchool, and expiringSoon', async () => {
    await trashForClass({ classId: classA._id, deletedBy: adminA._id, schoolId: schoolA._id });
    await trashForClass({
      classId: classB._id,
      deletedBy: adminA._id,
      schoolId: schoolB._id,
      daysLeft: 3,
    });

    const res = await request(app).get(`${BASE}/stats`).set(SUPER_ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.retentionDays).toBe(60);
    const classBucket = res.body.byType.find((b) => b.type === 'Class');
    expect(classBucket.count).toBe(2);
    expect(res.body.bySchool).toHaveLength(2);
    expect(res.body.expiringSoon).toBeGreaterThanOrEqual(1); // the 3-days-left item
  });

  it('restores a soft-deleted item on a school’s behalf and clears the trash record', async () => {
    const trash = await trashForClass({
      classId: classA._id,
      deletedBy: adminA._id,
      schoolId: schoolA._id,
    });

    const res = await request(app).post(`${BASE}/${trash._id}/restore`).set(SUPER_ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Source doc is restored (isDeleted flipped back)…
    const restored = await Class.findById(classA._id).lean();
    expect(restored.isDeleted).toBe(false);
    // …and the trash record is gone.
    const remaining = await TrashItem.findById(trash._id);
    expect(remaining).toBeNull();
  });

  it('permanently deletes an item across tenants', async () => {
    const trash = await trashForClass({
      classId: classB._id,
      deletedBy: adminA._id,
      schoolId: schoolB._id,
    });

    const res = await request(app).delete(`${BASE}/${trash._id}`).set(SUPER_ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Soft-deleted source doc is hard-removed, and the trash record is gone.
    const gone = await Class.findById(classB._id);
    expect(gone).toBeNull();
    const remaining = await TrashItem.findById(trash._id);
    expect(remaining).toBeNull();
  });

  it('returns 404 for a non-existent trash item', async () => {
    const fake = 'aaaaaaaaaaaaaaaaaaaaaaaa'; // 24 hex chars
    const [restoreRes, deleteRes] = await Promise.all([
      request(app).post(`${BASE}/${fake}/restore`).set(SUPER_ADMIN_HEADERS),
      request(app).delete(`${BASE}/${fake}`).set(SUPER_ADMIN_HEADERS),
    ]);
    expect(restoreRes.status).toBe(404);
    expect(deleteRes.status).toBe(404);
  });

  it('rejects an invalid trashItemId with 400', async () => {
    const res = await request(app).post(`${BASE}/not-an-id/restore`).set(SUPER_ADMIN_HEADERS);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });
});
