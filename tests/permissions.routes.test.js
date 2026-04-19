import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { UserPermission } from '../database.js';
import PermissionRequest from '../models/PermissionRequest.js';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

describe('permissions routes', () => {
  // ── GET /api/permissions/user/:userId ──────────────────────────────

  it('returns existing permissions for a user', async () => {
    const school = await createSchoolRecord({ name: 'Perm School', code: 'PERM' });
    const admin = await createStaffUser({
      name: 'Perm Admin',
      email: 'perm.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    const teacher = await createStaffUser({
      name: 'Perm Teacher',
      email: 'perm.teacher@example.com',
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });

    const { app } = createTestApp();
    const response = await request(app)
      .get(`/api/permissions/user/${teacher._id}`)
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body).toMatchObject({
      userId: teacher._id.toString(),
      role: 'teacher',
    });
    expect(response.body.permissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ module: 'students', view: true, create: false }),
      ])
    );
  });

  it('auto-creates permissions when none exist for a staff member', async () => {
    const school = await createSchoolRecord({ name: 'AutoPerm School', code: 'AUTOPERM' });
    const admin = await createStaffUser({
      name: 'AutoPerm Admin',
      email: 'autoperm.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    const teacher = await createStaffUser({
      name: 'AutoPerm Teacher',
      email: 'autoperm.teacher@example.com',
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });

    // Remove the auto-created permission document so the route has to create one
    await UserPermission.deleteOne({ userId: teacher._id });

    const { app } = createTestApp();
    const response = await request(app)
      .get(`/api/permissions/user/${teacher._id}`)
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body).toMatchObject({
      userId: teacher._id.toString(),
      role: 'teacher',
      customPermissions: false,
    });
  });

  it('returns 404 when user does not exist', async () => {
    const school = await createSchoolRecord({ name: '404 School', code: 'NOTFOUND' });
    const admin = await createStaffUser({
      name: '404 Admin',
      email: 'notfound.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });

    const fakeUserId = '000000000000000000000000';

    // Remove any permission doc for the fake id just in case
    await UserPermission.deleteOne({ userId: fakeUserId });

    const { app } = createTestApp();
    const response = await request(app)
      .get(`/api/permissions/user/${fakeUserId}`)
      .set(authHeadersFor(admin, 'admin'))
      .expect(404);

    expect(response.body).toMatchObject({ error: 'User not found' });
  });

  // ── PUT /api/permissions/user/:userId ──────────────────────────────

  it('allows an admin to update user permissions', async () => {
    const school = await createSchoolRecord({ name: 'UpdatePerm School', code: 'UPDPERM' });
    const admin = await createStaffUser({
      name: 'UpdatePerm Admin',
      email: 'updperm.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    const teacher = await createStaffUser({
      name: 'UpdatePerm Teacher',
      email: 'updperm.teacher@example.com',
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });

    const newPermissions = [
      { module: 'students', view: true, create: true, edit: true, delete: false, publish: false },
      { module: 'attendance', view: true, create: true, edit: true, delete: false, publish: false },
    ];

    const { app } = createTestApp();
    const response = await request(app)
      .put(`/api/permissions/user/${teacher._id}`)
      .set(authHeadersFor(admin, 'admin'))
      .send({
        adminId: admin._id.toString(),
        permissions: newPermissions,
        role: 'teacher',
        customPermissions: true,
      })
      .expect(200);

    expect(response.body).toMatchObject({
      userId: teacher._id.toString(),
      role: 'teacher',
      customPermissions: true,
    });
    expect(response.body.permissions).toHaveLength(2);
    expect(response.body.permissions[0]).toMatchObject({
      module: 'students',
      view: true,
      create: true,
    });
  });

  it('rejects permission update from a non-admin user', async () => {
    const school = await createSchoolRecord({ name: 'NoAdmin School', code: 'NOADMIN' });
    const teacher1 = await createStaffUser({
      name: 'NoAdmin Teacher1',
      email: 'noadmin.teacher1@example.com',
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });
    const teacher2 = await createStaffUser({
      name: 'NoAdmin Teacher2',
      email: 'noadmin.teacher2@example.com',
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });

    const { app } = createTestApp();
    const response = await request(app)
      .put(`/api/permissions/user/${teacher2._id}`)
      .set(authHeadersFor(teacher1, 'teacher'))
      .send({
        adminId: teacher1._id.toString(),
        permissions: [],
        role: 'teacher',
        customPermissions: true,
      })
      .expect(403);

    expect(response.body).toMatchObject({ error: 'Admin access required' });
  });

  it('rejects cross-tenant permission writes (admin in School A cannot poison School B user)', async () => {
    const schoolA = await createSchoolRecord({ name: 'Tenant A', code: 'TNTA' });
    const schoolB = await createSchoolRecord({ name: 'Tenant B', code: 'TNTB' });

    const adminA = await createStaffUser({
      name: 'Admin A',
      email: 'admin.a@example.com',
      schoolId: schoolA._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    const teacherB = await createStaffUser({
      name: 'Teacher B',
      email: 'teacher.b@example.com',
      schoolId: schoolB._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });

    const { app } = createTestApp();

    // Admin A attempts to upsert a UserPermission for Teacher B (in School B).
    // Before the fix this silently created a poisoned row with {userId:
    // teacher-B, schoolId: school-A, role: 'admin'}.
    const response = await request(app)
      .put(`/api/permissions/user/${teacherB._id}`)
      .set(authHeadersFor(adminA, 'admin'))
      .send({
        permissions: [
          {
            module: 'students',
            view: true,
            create: true,
            edit: true,
            delete: true,
            publish: true,
          },
        ],
        role: 'admin',
        customPermissions: true,
      })
      .expect(404);

    expect(response.body.error).toBeDefined();

    // No UserPermission row should have been created in School A for Teacher B
    const poisoned = await UserPermission.findOne({
      userId: teacherB._id,
      schoolId: schoolA._id,
    });
    expect(poisoned).toBeNull();
  });

  it('rejects PUT /permissions/user/:userId with an invalid role enum', async () => {
    const school = await createSchoolRecord({ name: 'ZodPerm School', code: 'ZODPERM' });
    const admin = await createStaffUser({
      name: 'Zod Admin',
      email: 'zod.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    const teacher = await createStaffUser({
      name: 'Zod Teacher',
      email: 'zod.teacher@example.com',
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });

    const { app } = createTestApp();

    const response = await request(app)
      .put(`/api/permissions/user/${teacher._id}`)
      .set(authHeadersFor(admin, 'admin'))
      .send({
        permissions: [],
        role: 'superuser', // not in enum
        customPermissions: true,
      })
      .expect(400);

    expect(response.body.error).toBe('Validation Error');
    expect(response.body.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'role' })])
    );
  });

  // ── POST /api/permissions/request ──────────────────────────────────

  it('creates a permission request', async () => {
    const school = await createSchoolRecord({ name: 'ReqPerm School', code: 'REQPERM' });
    const teacher = await createStaffUser({
      name: 'ReqPerm Teacher',
      email: 'reqperm.teacher@example.com',
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });

    const { app } = createTestApp();
    const response = await request(app)
      .post('/api/permissions/request')
      .set(authHeadersFor(teacher, 'teacher'))
      .send({
        userId: teacher._id.toString(),
        userName: 'ReqPerm Teacher',
        userEmail: 'reqperm.teacher@example.com',
        module: 'fees',
        permissions: ['view', 'create'],
        reason: 'Need to manage fee collection for my class',
      })
      .expect(201);

    expect(response.body).toMatchObject({
      userId: teacher._id.toString(),
      userName: 'ReqPerm Teacher',
      module: 'fees',
      permissions: ['view', 'create'],
      reason: 'Need to manage fee collection for my class',
      status: 'pending',
    });
  });

  it('rejects duplicate pending request for the same module', async () => {
    const school = await createSchoolRecord({ name: 'DupReq School', code: 'DUPREQ' });
    const teacher = await createStaffUser({
      name: 'DupReq Teacher',
      email: 'dupreq.teacher@example.com',
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });

    // Create the first request directly in DB
    await PermissionRequest.create({
      schoolId: school._id,
      userId: teacher._id,
      userName: 'DupReq Teacher',
      module: 'fees',
      permissions: ['view'],
      reason: 'First request',
      status: 'pending',
    });

    const { app } = createTestApp();
    const response = await request(app)
      .post('/api/permissions/request')
      .set(authHeadersFor(teacher, 'teacher'))
      .send({
        userId: teacher._id.toString(),
        userName: 'DupReq Teacher',
        module: 'fees',
        permissions: ['view', 'create'],
        reason: 'Second request for same module',
      })
      .expect(400);

    expect(response.body).toMatchObject({
      error: 'A pending request already exists for this module',
    });
  });

  it('returns 400 when required fields are missing', async () => {
    const school = await createSchoolRecord({ name: 'MissingField School', code: 'MFIELD' });
    const teacher = await createStaffUser({
      name: 'MissingField Teacher',
      email: 'mfield.teacher@example.com',
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });

    const { app } = createTestApp();
    const response = await request(app)
      .post('/api/permissions/request')
      .set(authHeadersFor(teacher, 'teacher'))
      .send({
        userId: teacher._id.toString(),
        userName: 'MissingField Teacher',
        // missing module, permissions, reason
      })
      .expect(400);

    expect(response.body).toMatchObject({ error: 'Missing required fields' });
  });

  // ── GET /api/permissions/requests (admin only) ─────────────────────

  it('returns all permission requests for admin', async () => {
    const school = await createSchoolRecord({ name: 'ListReq School', code: 'LISTREQ' });
    const admin = await createStaffUser({
      name: 'ListReq Admin',
      email: 'listreq.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    const teacher = await createStaffUser({
      name: 'ListReq Teacher',
      email: 'listreq.teacher@example.com',
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });

    await PermissionRequest.create({
      schoolId: school._id,
      userId: teacher._id,
      userName: 'ListReq Teacher',
      module: 'academics',
      permissions: ['view', 'create'],
      reason: 'Need exam access',
      status: 'pending',
    });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/permissions/requests')
      .query({ adminId: admin._id.toString() })
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBeGreaterThanOrEqual(1);
    expect(response.body[0]).toMatchObject({
      module: 'academics',
      status: 'pending',
    });
  });

  it('filters permission requests by status', async () => {
    const school = await createSchoolRecord({ name: 'FilterReq School', code: 'FILTREQ' });
    const admin = await createStaffUser({
      name: 'FilterReq Admin',
      email: 'filtreq.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    const teacher = await createStaffUser({
      name: 'FilterReq Teacher',
      email: 'filtreq.teacher@example.com',
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });

    await PermissionRequest.create([
      {
        schoolId: school._id,
        userId: teacher._id,
        userName: 'FilterReq Teacher',
        module: 'fees',
        permissions: ['view'],
        reason: 'Approved one',
        status: 'approved',
      },
      {
        schoolId: school._id,
        userId: teacher._id,
        userName: 'FilterReq Teacher',
        module: 'attendance',
        permissions: ['view'],
        reason: 'Pending one',
        status: 'pending',
      },
    ]);

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/permissions/requests')
      .query({ adminId: admin._id.toString(), status: 'pending' })
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    for (const req of response.body) {
      expect(req.status).toBe('pending');
    }
  });

  it('rejects requests list access for non-admin users', async () => {
    const school = await createSchoolRecord({ name: 'NoListReq School', code: 'NOLISTREQ' });
    const teacher = await createStaffUser({
      name: 'NoListReq Teacher',
      email: 'nolistreq.teacher@example.com',
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/permissions/requests')
      .query({ adminId: teacher._id.toString() })
      .set(authHeadersFor(teacher, 'teacher'))
      .expect(403);

    expect(response.body).toMatchObject({ error: 'Admin access required' });
  });

  // ── GET /api/permissions/requests/count/pending ────────────────────

  it('returns the count of pending permission requests', async () => {
    const school = await createSchoolRecord({ name: 'CountReq School', code: 'CNTREQ' });
    const admin = await createStaffUser({
      name: 'CountReq Admin',
      email: 'cntreq.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    const teacher = await createStaffUser({
      name: 'CountReq Teacher',
      email: 'cntreq.teacher@example.com',
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });

    await PermissionRequest.create([
      {
        schoolId: school._id,
        userId: teacher._id,
        userName: 'CountReq Teacher',
        module: 'fees',
        permissions: ['view'],
        reason: 'Pending req 1',
        status: 'pending',
      },
      {
        schoolId: school._id,
        userId: teacher._id,
        userName: 'CountReq Teacher',
        module: 'reports',
        permissions: ['view'],
        reason: 'Pending req 2',
        status: 'pending',
      },
      {
        schoolId: school._id,
        userId: teacher._id,
        userName: 'CountReq Teacher',
        module: 'attendance',
        permissions: ['view'],
        reason: 'Approved req',
        status: 'approved',
      },
    ]);

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/permissions/requests/count/pending')
      .query({ adminId: admin._id.toString() })
      .set(authHeadersFor(admin, 'admin'))
      .expect(200);

    expect(response.body).toHaveProperty('count');
    expect(response.body.count).toBeGreaterThanOrEqual(2);
  });

  it('rejects pending count access for non-admin users', async () => {
    const school = await createSchoolRecord({ name: 'NoCntReq School', code: 'NOCNTREQ' });
    const teacher = await createStaffUser({
      name: 'NoCntReq Teacher',
      email: 'nocntreq.teacher@example.com',
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });

    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/permissions/requests/count/pending')
      .query({ adminId: teacher._id.toString() })
      .set(authHeadersFor(teacher, 'teacher'))
      .expect(403);

    expect(response.body).toMatchObject({ error: 'Admin access required' });
  });

  // ── PUT /api/permissions/requests/:requestId (approve/reject) ──────

  it('allows admin to approve a permission request and updates user permissions', async () => {
    const school = await createSchoolRecord({ name: 'Approve School', code: 'APPROVE' });
    const admin = await createStaffUser({
      name: 'Approve Admin',
      email: 'approve.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    const teacher = await createStaffUser({
      name: 'Approve Teacher',
      email: 'approve.teacher@example.com',
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });

    const permReq = await PermissionRequest.create({
      schoolId: school._id,
      userId: teacher._id,
      userName: 'Approve Teacher',
      userEmail: 'approve.teacher@example.com',
      module: 'fees',
      permissions: ['view', 'create'],
      reason: 'Need fee access',
      status: 'pending',
    });

    const { app } = createTestApp();
    const response = await request(app)
      .put(`/api/permissions/requests/${permReq._id}`)
      .set(authHeadersFor(admin, 'admin'))
      .send({
        status: 'approved',
        adminId: admin._id.toString(),
        adminName: 'Approve Admin',
        reviewNotes: 'Approved for this term',
      })
      .expect(200);

    expect(response.body).toMatchObject({
      status: 'approved',
      reviewerName: 'Admin',
      reviewNotes: 'Approved for this term',
    });

    // Verify the user's permissions were updated
    const updatedPerms = await UserPermission.findOne({ userId: teacher._id });
    const feesModule = updatedPerms.permissions.find((p) => p.module === 'fees');
    expect(feesModule).toBeTruthy();
    expect(feesModule.view).toBe(true);
    expect(feesModule.create).toBe(true);
  });

  it('allows admin to reject a permission request', async () => {
    const school = await createSchoolRecord({ name: 'Reject School', code: 'REJECT' });
    const admin = await createStaffUser({
      name: 'Reject Admin',
      email: 'reject.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    const teacher = await createStaffUser({
      name: 'Reject Teacher',
      email: 'reject.teacher@example.com',
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });

    const permReq = await PermissionRequest.create({
      schoolId: school._id,
      userId: teacher._id,
      userName: 'Reject Teacher',
      module: 'settings',
      permissions: ['view', 'edit'],
      reason: 'Want settings access',
      status: 'pending',
    });

    const { app } = createTestApp();
    const response = await request(app)
      .put(`/api/permissions/requests/${permReq._id}`)
      .set(authHeadersFor(admin, 'admin'))
      .send({
        status: 'rejected',
        adminId: admin._id.toString(),
        adminName: 'Reject Admin',
        reviewNotes: 'Not authorized for settings',
      })
      .expect(200);

    expect(response.body).toMatchObject({
      status: 'rejected',
      reviewerName: 'Admin',
      reviewNotes: 'Not authorized for settings',
    });
  });

  it('rejects an invalid status value', async () => {
    const school = await createSchoolRecord({ name: 'BadStatus School', code: 'BADSTAT' });
    const admin = await createStaffUser({
      name: 'BadStatus Admin',
      email: 'badstat.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });

    const permReq = await PermissionRequest.create({
      schoolId: school._id,
      userId: admin._id,
      userName: 'BadStatus Admin',
      module: 'fees',
      permissions: ['view'],
      reason: 'Test',
      status: 'pending',
    });

    const { app } = createTestApp();
    const response = await request(app)
      .put(`/api/permissions/requests/${permReq._id}`)
      .set(authHeadersFor(admin, 'admin'))
      .send({
        status: 'invalid-status',
        adminId: admin._id.toString(),
        adminName: 'BadStatus Admin',
      })
      .expect(400);

    expect(response.body).toMatchObject({ error: 'Invalid status' });
  });

  it('returns 404 when approving a non-existent request', async () => {
    const school = await createSchoolRecord({ name: 'NoReq School', code: 'NOREQ' });
    const admin = await createStaffUser({
      name: 'NoReq Admin',
      email: 'noreq.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });

    const fakeRequestId = '000000000000000000000000';

    const { app } = createTestApp();
    const response = await request(app)
      .put(`/api/permissions/requests/${fakeRequestId}`)
      .set(authHeadersFor(admin, 'admin'))
      .send({
        status: 'approved',
        adminId: admin._id.toString(),
        adminName: 'NoReq Admin',
      })
      .expect(404);

    expect(response.body).toMatchObject({ error: 'Request not found' });
  });

  it('rejects reviewing an already-reviewed request', async () => {
    const school = await createSchoolRecord({ name: 'AlreadyReviewed School', code: 'ALRREV' });
    const admin = await createStaffUser({
      name: 'AlreadyReviewed Admin',
      email: 'alrrev.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });

    const permReq = await PermissionRequest.create({
      schoolId: school._id,
      userId: admin._id,
      userName: 'AlreadyReviewed Admin',
      module: 'fees',
      permissions: ['view'],
      reason: 'Already reviewed',
      status: 'approved',
      reviewedAt: new Date(),
      reviewedBy: admin._id,
    });

    const { app } = createTestApp();
    const response = await request(app)
      .put(`/api/permissions/requests/${permReq._id}`)
      .set(authHeadersFor(admin, 'admin'))
      .send({
        status: 'rejected',
        adminId: admin._id.toString(),
        adminName: 'AlreadyReviewed Admin',
      })
      .expect(400);

    expect(response.body).toMatchObject({ error: 'Request has already been reviewed' });
  });

  it('rejects approve/reject from a non-admin user', async () => {
    const school = await createSchoolRecord({ name: 'NoAdminReview School', code: 'NOADMRV' });
    const teacher = await createStaffUser({
      name: 'NoAdminReview Teacher',
      email: 'noadmrv.teacher@example.com',
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });

    const permReq = await PermissionRequest.create({
      schoolId: school._id,
      userId: teacher._id,
      userName: 'NoAdminReview Teacher',
      module: 'fees',
      permissions: ['view'],
      reason: 'Test',
      status: 'pending',
    });

    const { app } = createTestApp();
    const response = await request(app)
      .put(`/api/permissions/requests/${permReq._id}`)
      .set(authHeadersFor(teacher, 'teacher'))
      .send({
        status: 'approved',
        adminId: teacher._id.toString(),
        adminName: 'NoAdminReview Teacher',
      })
      .expect(403);

    expect(response.body).toMatchObject({ error: 'Admin access required' });
  });
});
