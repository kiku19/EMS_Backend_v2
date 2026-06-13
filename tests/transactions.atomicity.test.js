import request from 'supertest';
import mongoose from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Attendance, Result, Student, StudentFeeStructure } from '../database.js';
import ErasureRequest from '../models/ErasureRequest.js';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

// DK-831 — multi-document operations (student create + GDPR erasure) must be
// atomic. These tests prove the transaction ROLLS BACK: a happy-path suite
// alone cannot catch a transaction whose session is wired up incorrectly,
// because the writes still succeed individually — only the rollback guarantee
// distinguishes a real transaction from a sequence of independent writes.
describe('multi-document transaction atomicity (DK-831)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /api/students', () => {
    it('rolls back the student when a later in-transaction write fails', async () => {
      const admin = await createStaffUser();
      const classRecord = await createClassRecord();
      const { app } = createTestApp();
      const authHeaders = authHeadersFor(admin, 'admin');

      // Force the fee-structure save — which runs inside the transaction AFTER
      // student.save() and the usage-metric increment — to fail. The whole
      // student creation must unwind.
      const saveSpy = vi
        .spyOn(StudentFeeStructure.prototype, 'save')
        .mockRejectedValueOnce(new Error('induced fee-structure failure'));

      const res = await request(app)
        .post('/api/students')
        .set(authHeaders)
        .send({
          name: 'Rollback Student',
          admissionId: 'ROLLBACK01',
          academicYear: CURRENT_ACADEMIC_YEAR,
          rollNo: 9911,
          classId: classRecord._id.toString(),
          dateOfBirth: '2012-03-03',
          parents: [
            {
              name: 'Rollback Parent',
              relationship: 'mother',
              phone: '9123456780',
              isWhatsapp: true,
            },
          ],
        });

      expect(res.status).toBe(500);
      expect(saveSpy).toHaveBeenCalled();

      // The student saved before the failure must NOT survive — proving the
      // operation was transactional rather than a best-effort partial write.
      const persistedStudent = await Student.findOne({ admissionId: 'ROLLBACK01' }).lean();
      expect(persistedStudent).toBeNull();

      const persistedFee = await StudentFeeStructure.findOne({}).lean();
      expect(persistedFee).toBeNull();
    });
  });

  describe('POST /api/gdpr/erasure-requests/:id/execute', () => {
    it('rolls back cascade deletes and leaves the request re-runnable on failure', async () => {
      const school = await createSchoolRecord({ name: 'Atomic GDPR', code: 'ATOMICGDPR' });
      const cls = await createClassRecord({ schoolId: school._id, name: 'Class 2', section: 'B' });
      const admin = await createStaffUser({
        name: 'Atomic Admin',
        email: 'atomic.admin@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });
      const student = await createStudentRecord({
        schoolId: school._id,
        classId: cls._id,
        name: 'Erase Atomically',
      });
      const { app } = createTestApp();
      const headers = authHeadersFor(admin, 'admin');

      // Related records that the cascade would delete before the final
      // Student.deleteOne — they must all survive a rolled-back erasure.
      await Attendance.create({
        studentId: student._id,
        classId: cls._id,
        schoolId: school._id,
        date: '2025-02-01',
        status: 'present',
      });
      await Result.create({
        studentId: student._id,
        classId: cls._id,
        schoolId: school._id,
        examId: new mongoose.Types.ObjectId(),
        academicYear: CURRENT_ACADEMIC_YEAR,
      });

      const erasureRequest = await ErasureRequest.create({
        schoolId: school._id,
        entityType: 'Student',
        entityId: student._id,
        entityName: student.name,
        reason: 'Atomicity rollback check',
        status: 'approved',
        requestedBy: admin._id,
      });

      // Force the final hard-delete of the student to fail. Everything deleted
      // earlier in the cascade (attendance, results, etc.) must come back.
      const deleteSpy = vi
        .spyOn(Student, 'deleteOne')
        .mockRejectedValueOnce(new Error('induced student delete failure'));

      const res = await request(app)
        .post(`/api/gdpr/erasure-requests/${erasureRequest._id}/execute`)
        .set(headers);

      expect(res.status).toBe(500);
      expect(deleteSpy).toHaveBeenCalled();

      // Nothing should have been erased.
      expect(await Student.findById(student._id).lean()).not.toBeNull();
      expect(await Attendance.countDocuments({ studentId: student._id })).toBe(1);
      expect(await Result.countDocuments({ studentId: student._id })).toBe(1);

      // The request must remain 'approved' (re-runnable), not 'executed'.
      const reloaded = await ErasureRequest.findById(erasureRequest._id).lean();
      expect(reloaded.status).toBe('approved');
      expect(reloaded.executedAt).toBeFalsy();
    });
  });
});
