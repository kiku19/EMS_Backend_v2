import request from 'supertest';
import { describe, expect, it } from 'vitest';
import Parent from '../models/Parent.js';
import TrashItem from '../models/TrashItem.js';
import { Student } from '../database.js';
import { createClassRecord, createStaffUser, authHeadersFor } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

describe('students routes', () => {
  it('supports create, read, update, and soft delete for a student', async () => {
    const admin = await createStaffUser();
    const classRecord = await createClassRecord();
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(admin, 'admin');

    const createResponse = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send({
        name: 'Jane Student',
        admissionId: 'ADM9001',
        academicYear: '2025-26',
        rollNo: 7,
        classId: classRecord._id.toString(),
        dateOfBirth: '2010-05-15',
        parentName: 'Mary Parent',
        parentPhone: '9876543210',
        parents: [{
          name: 'Mary Parent',
          relationship: 'mother',
          phone: '9876543210',
          isWhatsapp: true,
        }],
      })
      .expect(201);

    const studentId = createResponse.body.id;

    expect(createResponse.body).toMatchObject({
      name: 'Jane Student',
      admissionId: 'ADM9001',
      class: '10-A',
      status: 'active',
    });

    const parent = await Parent.findOne({ phone: '9876543210' }).lean();
    expect(parent).toBeTruthy();
    expect(parent.children[0].studentId.toString()).toBe(studentId);

    const getResponse = await request(app)
      .get(`/api/students/${studentId}`)
      .set(authHeaders)
      .expect(200);

    expect(getResponse.body).toMatchObject({
      id: studentId,
      class: '10-A',
      className: 'Class 10 A',
    });

    const updateResponse = await request(app)
      .put(`/api/students/${studentId}`)
      .set(authHeaders)
      .send({
        parentName: 'Updated Parent',
        status: 'inactive',
      })
      .expect(200);

    expect(updateResponse.body).toMatchObject({
      id: studentId,
      parentName: 'Updated Parent',
      status: 'inactive',
    });

    const deleteResponse = await request(app)
      .delete(`/api/students/${studentId}`)
      .set(authHeaders)
      .expect(200);

    expect(deleteResponse.body.success).toBe(true);

    const deletedStudent = await Student.findById(studentId).lean();
    const trashItem = await TrashItem.findOne({ itemId: studentId }).lean();

    expect(deletedStudent.isDeleted).toBe(true);
    expect(trashItem).toBeTruthy();
    expect(trashItem.itemName).toBe('Jane Student');
  });
});
