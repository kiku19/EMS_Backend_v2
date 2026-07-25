import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  authHeadersFor,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
  createClassRecord,
  createParentUser,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

let seq = 0;
function nextSeq() {
  return ++seq;
}

async function setup(role = 'admin', staffRole = ['Admin']) {
  const school = await createSchoolRecord({
    name: `Parent Contacts School ${nextSeq()}`,
    code: `PC-${nextSeq()}`,
  });
  const user = await createStaffUser({
    schoolId: school._id,
    staffRole,
    permissionRole: role,
  });
  const { app } = createTestApp();
  const headers = authHeadersFor(user, role);
  return { school, user, app, headers };
}

describe('GET /api/messages/parent-contacts (M-2)', () => {
  it('returns 401 when no auth token is provided', async () => {
    const { app } = createTestApp();
    await request(app).get('/api/messages/parent-contacts').expect(401);
  });

  it('returns an empty contact list when no parents exist', async () => {
    const { app, headers } = await setup('admin', ['Admin']);

    const res = await request(app).get('/api/messages/parent-contacts').set(headers).expect(200);

    expect(res.body).toHaveProperty('contacts');
    expect(Array.isArray(res.body.contacts)).toBe(true);
    expect(res.body.contacts).toHaveLength(0);
  });

  it('returns active parents with children as parent-type contacts', async () => {
    const { school, app, headers } = await setup('admin', ['Admin']);
    const classRecord = await createClassRecord({
      schoolId: school._id,
      name: 'Class 3',
      section: 'B',
    });
    const student = await createStudentRecord({
      schoolId: school._id,
      classId: classRecord._id,
      name: 'Ward One',
    });

    await createParentUser({
      schoolId: school._id,
      name: 'Asha Verma',
      children: [{ studentId: student._id, relationship: 'mother', isPrimary: true }],
    });

    const res = await request(app).get('/api/messages/parent-contacts').set(headers).expect(200);

    expect(res.body.contacts).toHaveLength(1);
    const contact = res.body.contacts[0];
    expect(contact.name).toBe('Asha Verma');
    expect(contact.type).toBe('parent');
    // The subtitle should reference the child's class + relationship.
    expect(contact.role).toMatch(/Class 3/);
    expect(contact.role).toMatch(/mother/i);
    expect(contact.id).toBeTruthy();
  });

  it('excludes inactive parents and parents without children', async () => {
    const { school, app, headers } = await setup('admin', ['Admin']);
    const classRecord = await createClassRecord({ schoolId: school._id });
    const student = await createStudentRecord({ schoolId: school._id, classId: classRecord._id });

    // Active parent WITH a child — included.
    await createParentUser({
      schoolId: school._id,
      name: 'Included Parent',
      children: [{ studentId: student._id }],
    });
    // Inactive parent — excluded.
    await createParentUser({
      schoolId: school._id,
      name: 'Inactive Parent',
      status: 'inactive',
      children: [{ studentId: student._id }],
    });
    // Parent with NO children — excluded.
    await createParentUser({
      schoolId: school._id,
      name: 'Childless Parent',
      children: [],
    });

    const res = await request(app).get('/api/messages/parent-contacts').set(headers).expect(200);

    const names = res.body.contacts.map((c) => c.name);
    expect(names).toContain('Included Parent');
    expect(names).not.toContain('Inactive Parent');
    expect(names).not.toContain('Childless Parent');
  });

  it("scopes contacts to the caller's school", async () => {
    const { school, app, headers } = await setup('admin', ['Admin']);
    const otherSchool = await createSchoolRecord({
      name: `Other School ${nextSeq()}`,
      code: `OX-${nextSeq()}`,
    });
    const myStudent = await createStudentRecord({
      schoolId: school._id,
      classId: (await createClassRecord({ schoolId: school._id }))._id,
    });
    const foreignStudent = await createStudentRecord({
      schoolId: otherSchool._id,
      classId: (await createClassRecord({ schoolId: otherSchool._id }))._id,
    });

    await createParentUser({
      schoolId: school._id,
      name: 'My Parent',
      children: [{ studentId: myStudent._id }],
    });
    await createParentUser({
      schoolId: otherSchool._id,
      name: 'Foreign Parent',
      children: [{ studentId: foreignStudent._id }],
    });

    const res = await request(app).get('/api/messages/parent-contacts').set(headers).expect(200);

    const names = res.body.contacts.map((c) => c.name);
    expect(names).toContain('My Parent');
    expect(names).not.toContain('Foreign Parent');
  });
});
