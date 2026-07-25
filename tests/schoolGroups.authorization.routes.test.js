/**
 * C2 — Cross-tenant authorization bypass in School Groups.
 *
 * Reproduces the launch-readiness blocker: every `/:id*` route in
 * routes/schoolGroups.js guarded with the inline check
 *   `if (req.user.userType === 'group-admin' && String(req.user.groupId) !== id) return 403`
 * which is ALWAYS false for a normal school-staff token (userType 'staff',
 * groupId null) — so a teacher in School A could read/modify ANY school group,
 * enumerate branch schools, and alter group configuration. SchoolGroup is a
 * global root entity (no schoolId) — these are platform-admin capabilities.
 *
 * Fix: all `/:id*` routes are gated by `requireGroupAdminOfGroup()`, which
 * admits only super-admins and a group-admin scoped to that exact group, and
 * rejects everyone else (including normal staff) with 403.
 *
 * These tests authenticate as a normal `userType:'staff'` JWT and assert 403 on
 * every `/:id*` route, then confirm a super-admin (and a matching group-admin)
 * still get through.
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp } from './helpers/testApp.js';
import { createStaffUser } from './helpers/factories.js';
import { generateToken } from '../middleware/auth.js';
import SchoolGroup from '../models/SchoolGroup.js';

const VALID_GROUP_ID = '507f1f77bcf86cd799439011'; // fixed, well-formed ObjectId

async function seedGroup() {
  await SchoolGroup.create({
    _id: VALID_GROUP_ID,
    name: 'Test Group',
    code: 'TEST-GROUP',
    sharedFeeTemplates: true,
    whiteLabelSettings: { enabled: false, branding: {} },
  });
}

// Normal school staff — userType 'staff', groupId null. This is the principal
// the bypass affected: the old inline guard was always false for these tokens.
function staffHeaders(staff) {
  return {
    Authorization: `Bearer ${generateToken(staff._id.toString(), 'admin', {
      schoolId: String(staff.schoolId),
      userType: 'staff',
    })}`,
  };
}

// Super-admin token (role 'Super Admin' → isSuperAdminUser true).
function superAdminHeaders() {
  return {
    Authorization: `Bearer ${generateToken('super-admin', ['Super Admin'], {
      userType: 'super-admin',
      email: 'superid@test.com',
    })}`,
  };
}

// Group-admin scoped to the seeded group.
function groupAdminHeaders(groupId) {
  return {
    Authorization: `Bearer ${generateToken('group-admin-user', ['Group Admin'], {
      userType: 'group-admin',
      groupId,
    })}`,
  };
}

describe('C2 — School Groups /:id* authorization', () => {
  it('rejects a normal staff token with 403 on every /:id* route', async () => {
    const { app } = createTestApp();
    await seedGroup();
    const staff = await createStaffUser({ name: 'Teacher', staffRole: ['Teacher'] });
    const headers = staffHeaders(staff);

    // GET /:id
    await request(app).get(`/api/v1/school-groups/${VALID_GROUP_ID}`).set(headers).expect(403);
    // PUT /:id
    await request(app)
      .put(`/api/v1/school-groups/${VALID_GROUP_ID}`)
      .set(headers)
      .send({ name: 'Hacked Group' })
      .expect(403);
    // GET /:id/branches
    await request(app)
      .get(`/api/v1/school-groups/${VALID_GROUP_ID}/branches`)
      .set(headers)
      .expect(403);
    // GET /:id/analytics
    await request(app)
      .get(`/api/v1/school-groups/${VALID_GROUP_ID}/analytics`)
      .set(headers)
      .expect(403);
    // GET /:id/fee-templates
    await request(app)
      .get(`/api/v1/school-groups/${VALID_GROUP_ID}/fee-templates`)
      .set(headers)
      .expect(403);
    // POST /:id/fee-templates
    await request(app)
      .post(`/api/v1/school-groups/${VALID_GROUP_ID}/fee-templates`)
      .set(headers)
      .send({ name: 'T1', frequency: 'one-time', components: [] })
      .expect(403);
    // GET /:id/white-label
    await request(app)
      .get(`/api/v1/school-groups/${VALID_GROUP_ID}/white-label`)
      .set(headers)
      .expect(403);
    // PUT /:id/white-label
    await request(app)
      .put(`/api/v1/school-groups/${VALID_GROUP_ID}/white-label`)
      .set(headers)
      .send({ enabled: true })
      .expect(403);
    // POST /:id/white-label/verify-domain
    await request(app)
      .post(`/api/v1/school-groups/${VALID_GROUP_ID}/white-label/verify-domain`)
      .set(headers)
      .expect(403);
    // POST /:id/staff-assignments
    await request(app)
      .post(`/api/v1/school-groups/${VALID_GROUP_ID}/staff-assignments`)
      .set(headers)
      .send({ staffId: '507f1f77bcf86cd799439099', targetSchoolId: '507f1f77bcf86cd799439088' })
      .expect(403);
    // DELETE /:id/staff-assignments/:staffId
    await request(app)
      .delete(`/api/v1/school-groups/${VALID_GROUP_ID}/staff-assignments/507f1f77bcf86cd799439099`)
      .set(headers)
      .send({ targetSchoolId: '507f1f77bcf86cd799439088' })
      .expect(403);
  });

  it('allows a super-admin to read the group (GET /:id → 200)', async () => {
    const { app } = createTestApp();
    await seedGroup();

    const res = await request(app)
      .get(`/api/v1/school-groups/${VALID_GROUP_ID}`)
      .set(superAdminHeaders())
      .expect(200);

    expect(res.body.group).toMatchObject({ name: 'Test Group', code: 'TEST-GROUP' });
  });

  it('allows a matching group-admin and rejects a non-matching one', async () => {
    const { app } = createTestApp();
    await seedGroup();

    // Group-admin whose groupId matches the route :id → 200
    await request(app)
      .get(`/api/v1/school-groups/${VALID_GROUP_ID}`)
      .set(groupAdminHeaders(VALID_GROUP_ID))
      .expect(200);

    // Group-admin scoped to a DIFFERENT group → 403 (no lateral movement)
    const otherGroupId = '507f1f77bcf86cd799439022';
    await request(app)
      .get(`/api/v1/school-groups/${VALID_GROUP_ID}`)
      .set(groupAdminHeaders(otherGroupId))
      .expect(403);
  });

  it('still requires authentication on /:id* routes (no token → 401)', async () => {
    const { app } = createTestApp();
    await seedGroup();

    await request(app).get(`/api/v1/school-groups/${VALID_GROUP_ID}`).expect(401);
  });
});
