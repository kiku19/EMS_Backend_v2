import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Student } from '../database.js';
import Parent from '../models/Parent.js';
import { piiMatch } from '../utils/encryption.js';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';
import { createClassRecord, createStaffUser, authHeadersFor } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

// Regression tests for the data-loss-leak fixes (DATA_LOSS_AUDIT_2026-07-06):
// S1 admissionDate, S2 allergies, S3 alternatePhone, S5 academicYear on
// update, S6 destructive parents $set, S8 sibling metadata, S7 document
// size/date. These exercise the full UI-capture → handler → Mongo path that
// was silently dropping fields.

const baseParent = (overrides = {}) => ({
  name: 'Reg Parent',
  relationship: 'father',
  phone: '9000000099',
  isWhatsapp: true,
  ...overrides,
});

describe('student leak fixes', () => {
  it('S1/S2/S3: persists admissionDate, allergies, alternatePhone on create + update', async () => {
    const admin = await createStaffUser();
    const classRecord = await createClassRecord();
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(admin, 'admin');

    const createRes = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send({
        name: 'Leak Student',
        academicYear: CURRENT_ACADEMIC_YEAR,
        classId: classRecord._id.toString(),
        // S1
        admissionDate: '2024-06-01',
        // S2 — legacy top-level allergies list
        allergies: ['peanuts', 'shellfish'],
        // S3
        alternatePhone: '+919000000077',
        parents: [baseParent()],
      })
      .expect(201);

    const studentId = createRes.body.id;
    const fetched = await Student.findById(studentId).lean();
    expect(fetched.admissionDate).toEqual(new Date('2024-06-01'));
    expect(fetched.allergies).toEqual(['peanuts', 'shellfish']);
    expect(fetched.alternatePhone).toBe('+919000000077');

    // Update path — fields must round-trip, not be stripped by the update
    // handler's field-pick.
    await request(app)
      .put(`/api/students/${studentId}`)
      .set(authHeaders)
      .send({
        allergies: ['latex'],
        alternatePhone: '+919000000088',
      })
      .expect(200);

    const afterUpdate = await Student.findById(studentId).lean();
    expect(afterUpdate.allergies).toEqual(['latex']);
    expect(afterUpdate.alternatePhone).toBe('+919000000088');
  });

  it('S6: editing one parent does not delete the other or strip parentId', async () => {
    const admin = await createStaffUser();
    const classRecord = await createClassRecord();
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(admin, 'admin');

    // Create with two parents.
    const createRes = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send({
        name: 'Two Parents',
        academicYear: CURRENT_ACADEMIC_YEAR,
        classId: classRecord._id.toString(),
        parents: [
          baseParent({ name: 'Dad Original', phone: '9111111111', relationship: 'father' }),
          baseParent({ name: 'Mom Original', phone: '9222222222', relationship: 'mother' }),
        ],
      })
      .expect(201);

    const studentId = createRes.body.id;
    const created = await Student.findById(studentId).lean();
    expect(created.parents).toHaveLength(2);

    // Edit only the father's occupation — same identity (name+phone+rel).
    // The AboutTab rebuild sends only the edited parent; the merge must keep
    // the mother too.
    await request(app)
      .put(`/api/students/${studentId}`)
      .set(authHeaders)
      .send({
        parents: [
          {
            name: 'Dad Original',
            phone: '9111111111',
            relationship: 'father',
            occupation: 'Engineer',
          },
        ],
      })
      .expect(200);

    const after = await Student.findById(studentId).lean();
    // Both parents survive (partial edit matched the father by identity).
    expect(after.parents).toHaveLength(2);
    const dad = after.parents.find((p) => p.name === 'Dad Original');
    const mom = after.parents.find((p) => p.name === 'Mom Original');
    expect(dad).toBeTruthy();
    expect(dad.occupation).toBe('Engineer');
    expect(mom).toBeTruthy();
    expect(mom.phone).toBe('9222222222');
  });

  it('S6: a brand-new parent identity replaces the existing parent (not merged)', async () => {
    // Mirrors the existing parent-account-sync test: when the incoming parent
    // has a totally new identity, the merge treats it as a replacement.
    const admin = await createStaffUser();
    const classRecord = await createClassRecord();
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(admin, 'admin');

    const createRes = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send({
        name: 'Replace Student',
        academicYear: CURRENT_ACADEMIC_YEAR,
        classId: classRecord._id.toString(),
        parents: [baseParent({ name: 'Old Guard', phone: '9333333333', relationship: 'father' })],
      })
      .expect(201);

    const studentId = createRes.body.id;

    await request(app)
      .put(`/api/students/${studentId}`)
      .set(authHeaders)
      .send({
        parents: [
          baseParent({
            name: 'New Guard',
            phone: '9444444444',
            relationship: 'mother',
            email: 'new.guard@example.com',
          }),
        ],
      })
      .expect(200);

    const after = await Student.findById(studentId).lean();
    // Replacement semantics — the old parent is dropped.
    expect(after.parents).toHaveLength(1);
    expect(after.parents[0].name).toBe('New Guard');

    // The old parent account loses the child link (this is the existing
    // parent-account-sync behavior we must not regress).
    const oldParent = await Parent.findOne(piiMatch('phone', '9333333333')).lean();
    expect(oldParent?.children.some((c) => c.studentId.toString() === studentId)).toBe(false);
  });

  it('S8: sibling age/class/school survive an edit', async () => {
    const admin = await createStaffUser();
    const classRecord = await createClassRecord();
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(admin, 'admin');

    const createRes = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send({
        name: 'Sibling Student',
        academicYear: CURRENT_ACADEMIC_YEAR,
        classId: classRecord._id.toString(),
        parents: [baseParent()],
        siblings: [
          { name: 'Sib One', age: 12, class: '7', school: 'Other School', inSameSchool: false },
        ],
      })
      .expect(201);

    const studentId = createRes.body.id;

    // Simulate the AboutTab/form-state rebuild that previously dropped
    // age/class/school — it sends only {name, inSameSchool}. The backend
    // merge must carry the dropped fields forward.
    await request(app)
      .put(`/api/students/${studentId}`)
      .set(authHeaders)
      .send({
        siblings: [{ name: 'Sib One', inSameSchool: false }],
      })
      .expect(200);

    const after = await Student.findById(studentId).lean();
    expect(after.siblings).toHaveLength(1);
    expect(after.siblings[0].age).toBe(12);
    expect(after.siblings[0].class).toBe('7');
    expect(after.siblings[0].school).toBe('Other School');
  });

  it('S7: document size/date persist on create', async () => {
    const admin = await createStaffUser();
    const classRecord = await createClassRecord();
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(admin, 'admin');

    const createRes = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send({
        name: 'Doc Student',
        academicYear: CURRENT_ACADEMIC_YEAR,
        classId: classRecord._id.toString(),
        parents: [baseParent()],
        documents: [
          {
            id: 'doc-1',
            name: 'Birth Certificate',
            type: 'birthCertificate',
            url: 'https://example.com/bc.pdf',
            size: '245KB',
            date: '2024-01-15',
          },
        ],
      })
      .expect(201);

    const fetched = await Student.findById(createRes.body.id).lean();
    expect(fetched.documents[0].size).toBe('245KB');
    expect(fetched.documents[0].date).toBe('2024-01-15');
  });

  it('S5: academicYear can be changed on update (re-validates roll uniqueness)', async () => {
    const admin = await createStaffUser();
    const classRecord = await createClassRecord();
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(admin, 'admin');

    const createRes = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send({
        name: 'Year Student',
        academicYear: CURRENT_ACADEMIC_YEAR,
        classId: classRecord._id.toString(),
        parents: [baseParent()],
      })
      .expect(201);

    // Change academicYear — previously stripped by updateStudentSchema.omit.
    const nextYear = '2099-00'.replace(
      '00',
      String(Number(CURRENT_ACADEMIC_YEAR.slice(5)) + 1).padStart(2, '0')
    );
    const targetYear = `${Number(CURRENT_ACADEMIC_YEAR.slice(0, 4)) + 1}-${nextYear.slice(-2)}`;
    const targetClass = await createClassRecord({
      name: classRecord.name,
      section: classRecord.section,
      academicYear: targetYear,
      schoolId: classRecord.schoolId,
    });
    await request(app)
      .put(`/api/students/${createRes.body.id}`)
      .set(authHeaders)
      .send({ academicYear: targetYear, classId: targetClass._id.toString() })
      .expect(200);

    const after = await Student.findById(createRes.body.id).lean();
    expect(after.academicYear).toBe(targetYear);
    expect(after.classId.toString()).toBe(targetClass._id.toString());
  });
});
