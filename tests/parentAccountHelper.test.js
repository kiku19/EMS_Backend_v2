import { describe, expect, it } from 'vitest';
import { Student } from '../database.js';
import Parent from '../models/Parent.js';
import { createOrUpdateParentAccount, syncParentToStudent } from '../utils/parentAccountHelper.js';
import { createClassRecord, createSchoolRecord, createStudentRecord } from './helpers/factories.js';

describe('parentAccountHelper', () => {
  describe('createOrUpdateParentAccount', () => {
    it('links Student.parents entries to the Parent collection via parentId', async () => {
      const school = await createSchoolRecord({ name: 'Link School', code: 'LINK-001' });
      const classRecord = await createClassRecord({ schoolId: school._id });
      const student = await createStudentRecord({
        schoolId: school._id,
        classId: classRecord._id,
        dateOfBirth: '2010-05-15',
        admissionId: 'ADM-LINK-001',
        parents: [
          { name: 'Papa Smith', relationship: 'father', phone: '9111111111', isWhatsapp: true },
        ],
      });

      await createOrUpdateParentAccount(student);

      const reloaded = await Student.findById(student._id).lean();
      expect(reloaded.parents[0].parentId).toBeTruthy();

      const parent = await Parent.findById(reloaded.parents[0].parentId).lean();
      expect(parent).toBeTruthy();
      expect(parent.name).toBe('Papa Smith');
      expect(parent.children.map((c) => c.studentId.toString())).toContain(student._id.toString());
    });

    it('reuses an existing Parent record when phone matches and links the parentId', async () => {
      const school = await createSchoolRecord({ name: 'Reuse School', code: 'REUSE-001' });
      const classRecord = await createClassRecord({ schoolId: school._id });
      const sharedPhone = '9222222222';

      const firstStudent = await createStudentRecord({
        schoolId: school._id,
        classId: classRecord._id,
        dateOfBirth: '2010-05-15',
        admissionId: 'ADM-REUSE-001',
        parents: [{ name: 'Mama Doe', relationship: 'mother', phone: sharedPhone }],
      });
      await createOrUpdateParentAccount(firstStudent);

      const firstReloaded = await Student.findById(firstStudent._id).lean();
      const existingParentId = firstReloaded.parents[0].parentId;
      expect(existingParentId).toBeTruthy();

      const secondStudent = await createStudentRecord({
        schoolId: school._id,
        classId: classRecord._id,
        dateOfBirth: '2012-08-20',
        admissionId: 'ADM-REUSE-002',
        parents: [{ name: 'Mama Doe', relationship: 'mother', phone: sharedPhone }],
      });
      await createOrUpdateParentAccount(secondStudent);

      const secondReloaded = await Student.findById(secondStudent._id).lean();
      expect(secondReloaded.parents[0].parentId.toString()).toBe(existingParentId.toString());

      const parent = await Parent.findById(existingParentId).lean();
      expect(parent.children.length).toBe(2);
    });
  });

  describe('syncParentToStudent', () => {
    it('copies Parent name/phone/email to linked Student.parents entries', async () => {
      const school = await createSchoolRecord({ name: 'Sync School', code: 'SYNC-001' });
      const classRecord = await createClassRecord({ schoolId: school._id });
      const student = await createStudentRecord({
        schoolId: school._id,
        classId: classRecord._id,
        dateOfBirth: '2010-05-15',
        admissionId: 'ADM-SYNC-001',
        parents: [
          {
            name: 'Old Name',
            relationship: 'father',
            phone: '9333333333',
            email: 'old@example.com',
          },
        ],
      });

      await createOrUpdateParentAccount(student);
      const reloaded = await Student.findById(student._id).lean();
      const parentId = reloaded.parents[0].parentId;

      // Simulate an update made via the parent-management side
      await Parent.findByIdAndUpdate(parentId, {
        name: 'New Name',
        phone: '9444444444',
        email: 'new@example.com',
      });
      const parent = await Parent.findById(parentId).lean();

      await syncParentToStudent(parent);

      const synced = await Student.findById(student._id).lean();
      expect(synced.parents[0].name).toBe('New Name');
      expect(synced.parents[0].phone).toBe('9444444444');
      expect(synced.parents[0].email).toBe('new@example.com');
    });
  });
});
