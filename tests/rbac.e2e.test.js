import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

/**
 * E2E-09: Role-based access control
 * Verifies that a teacher cannot access admin-only endpoints across multiple modules.
 */
describe('RBAC E2E - teacher cannot access admin-only endpoints', () => {
  async function setup(code) {
    const school = await createSchoolRecord({ name: `${code} School`, code });
    const admin = await createStaffUser({
      name: `${code} Admin`,
      email: `${code.toLowerCase()}.admin@example.com`,
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    const teacher = await createStaffUser({
      name: `${code} Teacher`,
      email: `${code.toLowerCase()}.teacher@example.com`,
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });
    return { school, admin, teacher, app: createTestApp().app };
  }

  // ── Staff module ───────────────────────────────────────────────────────────

  it('teacher cannot update staff credentials', async () => {
    const { admin, teacher, app } = await setup('RBAC-S1');

    const res = await request(app)
      .put(`/api/staff/${admin._id}/credentials`)
      .set(authHeadersFor(teacher, 'teacher'))
      .send({ password: 'newpassword123' })
      .expect(403);

    expect(res.body.error).toBe('Admin access required');
  });

  it('admin can update staff credentials', async () => {
    const { teacher, admin, app } = await setup('RBAC-S2');

    const res = await request(app)
      .put(`/api/staff/${teacher._id}/credentials`)
      .set(authHeadersFor(admin, 'admin'))
      .send({ password: 'newpassword123' })
      .expect(200);

    expect(res.body).toMatchObject({ success: true });
  });

  // ── Payroll module ─────────────────────────────────────────────────────────

  it('teacher cannot run payroll', async () => {
    const { teacher, app } = await setup('RBAC-P1');

    const res = await request(app)
      .post('/api/payroll/run')
      .set(authHeadersFor(teacher, 'teacher'))
      .send({ month: 3, year: 2026 })
      .expect(403);

    expect(res.body.error).toBe('Admin access required');
  });

  it('teacher cannot mark a payroll record as paid', async () => {
    const { teacher, app } = await setup('RBAC-P2');
    const fakeId = '000000000000000000000001';

    const res = await request(app)
      .put(`/api/payroll/records/${fakeId}/pay`)
      .set(authHeadersFor(teacher, 'teacher'))
      .send({ paymentMethod: 'bank_transfer' })
      .expect(403);

    expect(res.body.error).toBe('Admin access required');
  });

  it('teacher cannot reverse a payroll payment', async () => {
    const { teacher, app } = await setup('RBAC-P3');
    const fakeId = '000000000000000000000001';

    const res = await request(app)
      .put(`/api/payroll/records/${fakeId}/reverse`)
      .set(authHeadersFor(teacher, 'teacher'))
      .send({ reason: 'test' })
      .expect(403);

    expect(res.body.error).toBe('Admin access required');
  });

  it('teacher cannot bulk-pay payroll records', async () => {
    const { teacher, app } = await setup('RBAC-P4');

    const res = await request(app)
      .post('/api/payroll/records/bulk-pay')
      .set(authHeadersFor(teacher, 'teacher'))
      .send({ recordIds: [] })
      .expect(403);

    expect(res.body.error).toBe('Admin access required');
  });

  it('teacher cannot access payroll audit logs', async () => {
    const { teacher, app } = await setup('RBAC-P5');

    const res = await request(app)
      .get('/api/payroll/audit-logs')
      .set(authHeadersFor(teacher, 'teacher'))
      .expect(403);

    expect(res.body.error).toBe('Admin access required');
  });

  it('teacher cannot add a payroll adjustment', async () => {
    const { teacher, app } = await setup('RBAC-P6');

    const res = await request(app)
      .post('/api/payroll/adjustments')
      .set(authHeadersFor(teacher, 'teacher'))
      .send({ employeeId: '000000000000000000000001', type: 'bonus', amount: 500 })
      .expect(403);

    expect(res.body.error).toBe('Admin access required');
  });

  // ── Notifications module ───────────────────────────────────────────────────

  it('teacher cannot access SMS notification stats', async () => {
    const { teacher, app } = await setup('RBAC-N1');

    const res = await request(app)
      .get('/api/notifications/sms-stats')
      .set(authHeadersFor(teacher, 'teacher'))
      .expect(403);

    expect(res.body.error).toBe('Admin access required');
  });

  it('admin can access SMS notification stats', async () => {
    const { admin, app } = await setup('RBAC-N2');

    const res = await request(app)
      .get('/api/notifications/sms-stats')
      .set(authHeadersFor(admin, 'admin'));

    // 200 on success, 404 if no SMS config exists – both are acceptable; 403 is not
    expect(res.status).not.toBe(403);
  });

  // ── Permissions module ─────────────────────────────────────────────────────

  it("teacher cannot update another user's permissions", async () => {
    const { admin, teacher, app } = await setup('RBAC-PM1');

    const res = await request(app)
      .put(`/api/permissions/user/${admin._id}`)
      .set(authHeadersFor(teacher, 'teacher'))
      .send({
        adminId: teacher._id.toString(),
        permissions: [],
        role: 'teacher',
        customPermissions: false,
      })
      .expect(403);

    expect(res.body.error).toBe('Admin access required');
  });

  it('teacher cannot list permission requests', async () => {
    const { teacher, app } = await setup('RBAC-PM2');

    const res = await request(app)
      .get('/api/permissions/requests')
      .query({ adminId: teacher._id.toString() })
      .set(authHeadersFor(teacher, 'teacher'))
      .expect(403);

    expect(res.body.error).toBe('Admin access required');
  });

  it('teacher cannot approve or reject a permission request', async () => {
    const { teacher, app } = await setup('RBAC-PM3');
    const fakeRequestId = '000000000000000000000001';

    const res = await request(app)
      .put(`/api/permissions/requests/${fakeRequestId}`)
      .set(authHeadersFor(teacher, 'teacher'))
      .send({ status: 'approved', adminId: teacher._id.toString(), adminName: 'Teacher' })
      .expect(403);

    expect(res.body.error).toBe('Admin access required');
  });

  it('teacher cannot access the pending permission request count', async () => {
    const { teacher, app } = await setup('RBAC-PM4');

    const res = await request(app)
      .get('/api/permissions/requests/count/pending')
      .query({ adminId: teacher._id.toString() })
      .set(authHeadersFor(teacher, 'teacher'))
      .expect(403);

    expect(res.body.error).toBe('Admin access required');
  });

  // ── Unauthenticated requests ───────────────────────────────────────────────

  it('unauthenticated request to admin-only staff credentials endpoint returns 401', async () => {
    const { admin, app } = await setup('RBAC-UA1');

    await request(app)
      .put(`/api/staff/${admin._id}/credentials`)
      .send({ password: 'newpassword123' })
      .expect(401);
  });

  it('unauthenticated request to admin-only payroll run endpoint returns 401', async () => {
    const { app } = await setup('RBAC-UA2');

    await request(app).post('/api/payroll/run').send({ month: 3, year: 2026 }).expect(401);
  });
});
