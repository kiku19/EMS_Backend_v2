import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import AuditTrail from '../models/AuditTrail.js';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const BASE = '/api/audit-logs';

async function setup() {
  const school = await createSchoolRecord({ name: 'Audit School', code: 'AUDIT' });
  const admin = await createStaffUser({
    name: 'Audit Admin',
    email: 'audit.admin@example.com',
    schoolId: school._id,
    staffRole: ['Admin'],
    permissionRole: 'admin',
  });
  const teacher = await createStaffUser({
    name: 'Audit Teacher',
    email: 'audit.teacher@example.com',
    schoolId: school._id,
    staffRole: ['Teacher'],
    permissionRole: 'teacher',
  });
  const { app } = createTestApp();
  const adminHeaders = authHeadersFor(admin, 'admin');
  const teacherHeaders = authHeadersFor(teacher, 'teacher');
  return { school, admin, teacher, app, adminHeaders, teacherHeaders };
}

function createAuditLog(overrides = {}) {
  return {
    action: 'created',
    entity: 'student',
    entityId: new mongoose.Types.ObjectId().toString(),
    method: 'POST',
    path: '/api/students',
    ipAddress: '127.0.0.1',
    ...overrides,
  };
}

// ─── Authentication ──────────────────────────────────────────────────────────

describe('authentication', () => {
  it('returns 401 without token for GET /api/audit-logs', async () => {
    const { app } = createTestApp();
    await request(app).get(BASE).expect(401);
  });

  it('returns 401 without token for GET /api/audit-logs/:id', async () => {
    const { app } = createTestApp();
    const fakeId = new mongoose.Types.ObjectId().toString();
    await request(app).get(`${BASE}/${fakeId}`).expect(401);
  });

  it('returns 401 without token for GET /api/audit-logs/export', async () => {
    const { app } = createTestApp();
    await request(app).get(`${BASE}/export`).expect(401);
  });

  it('returns 401 without token for POST /api/audit-logs/purge', async () => {
    const { app } = createTestApp();
    await request(app).post(`${BASE}/purge`).send({}).expect(401);
  });
});

// ─── Permission guards ───────────────────────────────────────────────────────

describe('permission guards', () => {
  it('returns 403 for non-admin teacher on GET /api/audit-logs', async () => {
    const { app, teacherHeaders } = await setup();
    const res = await request(app).get(BASE).set(teacherHeaders).expect(403);
    expect(res.body.error).toBeDefined();
  });

  it('returns 403 for non-admin teacher on GET /api/audit-logs/:id', async () => {
    const { app, teacherHeaders } = await setup();
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app).get(`${BASE}/${fakeId}`).set(teacherHeaders).expect(403);
    expect(res.body.error).toBeDefined();
  });

  it('returns 403 for non-admin teacher on GET /api/audit-logs/export', async () => {
    const { app, teacherHeaders } = await setup();
    const res = await request(app).get(`${BASE}/export`).set(teacherHeaders).expect(403);
    expect(res.body.error).toBeDefined();
  });

  it('returns 403 for non-admin teacher on POST /api/audit-logs/purge', async () => {
    const { app, teacherHeaders } = await setup();
    const res = await request(app).post(`${BASE}/purge`).set(teacherHeaders).send({}).expect(403);
    expect(res.body.error).toBeDefined();
  });
});

// ─── GET /api/audit-logs ─────────────────────────────────────────────────────

describe('GET /api/audit-logs', () => {
  it('returns paginated list of audit logs', async () => {
    const { school, admin, app, adminHeaders } = await setup();
    await AuditTrail.create([
      createAuditLog({
        schoolId: school._id,
        userId: admin._id,
        userName: admin.name,
        action: 'created',
        entity: 'student',
      }),
      createAuditLog({
        schoolId: school._id,
        userId: admin._id,
        userName: admin.name,
        action: 'updated',
        entity: 'staff',
      }),
      createAuditLog({
        schoolId: school._id,
        userId: admin._id,
        userName: admin.name,
        action: 'deleted',
        entity: 'class',
      }),
    ]);

    const res = await request(app).get(BASE).set(adminHeaders).expect(200);
    expect(res.body.logs).toHaveLength(3);
    expect(res.body.pagination).toMatchObject({
      page: 1,
      limit: 50,
      total: 3,
      totalPages: 1,
    });
  });

  it('filters by action', async () => {
    const { school, admin, app, adminHeaders } = await setup();
    await AuditTrail.create([
      createAuditLog({
        schoolId: school._id,
        userId: admin._id,
        userName: admin.name,
        action: 'created',
        entity: 'student',
      }),
      createAuditLog({
        schoolId: school._id,
        userId: admin._id,
        userName: admin.name,
        action: 'updated',
        entity: 'student',
      }),
    ]);

    const res = await request(app)
      .get(BASE)
      .set(adminHeaders)
      .query({ action: 'created' })
      .expect(200);
    expect(res.body.logs).toHaveLength(1);
    expect(res.body.logs[0].action).toBe('created');
    expect(res.body.pagination.total).toBe(1);
  });

  it('filters by entity', async () => {
    const { school, admin, app, adminHeaders } = await setup();
    await AuditTrail.create([
      createAuditLog({
        schoolId: school._id,
        userId: admin._id,
        userName: admin.name,
        action: 'created',
        entity: 'student',
      }),
      createAuditLog({
        schoolId: school._id,
        userId: admin._id,
        userName: admin.name,
        action: 'created',
        entity: 'staff',
      }),
    ]);

    const res = await request(app)
      .get(BASE)
      .set(adminHeaders)
      .query({ entity: 'staff' })
      .expect(200);
    expect(res.body.logs).toHaveLength(1);
    expect(res.body.logs[0].entity).toBe('staff');
  });

  it('filters by userId', async () => {
    const { school, admin, app, adminHeaders } = await setup();
    const otherStaff = await createStaffUser({
      name: 'Other Staff',
      email: 'other.staff@example.com',
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });
    await AuditTrail.create([
      createAuditLog({ schoolId: school._id, userId: admin._id, userName: admin.name }),
      createAuditLog({ schoolId: school._id, userId: otherStaff._id, userName: otherStaff.name }),
    ]);

    const res = await request(app)
      .get(BASE)
      .set(adminHeaders)
      .query({ userId: admin._id.toString() })
      .expect(200);
    expect(res.body.logs).toHaveLength(1);
    expect(res.body.logs[0].userId._id.toString()).toBe(admin._id.toString());
  });

  it('filters by date range', async () => {
    const { school, admin, app, adminHeaders } = await setup();
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 10);
    const recentDate = new Date();

    await AuditTrail.create([
      createAuditLog({
        schoolId: school._id,
        userId: admin._id,
        userName: admin.name,
        createdAt: oldDate,
      }),
      createAuditLog({
        schoolId: school._id,
        userId: admin._id,
        userName: admin.name,
        createdAt: recentDate,
      }),
    ]);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 5);
    const res = await request(app)
      .get(BASE)
      .set(adminHeaders)
      .query({ startDate: startDate.toISOString().split('T')[0] })
      .expect(200);
    expect(res.body.logs).toHaveLength(1);
  });

  it('supports pagination', async () => {
    const { school, admin, app, adminHeaders } = await setup();
    await AuditTrail.create(
      Array.from({ length: 5 }, (_, i) =>
        createAuditLog({
          schoolId: school._id,
          userId: admin._id,
          userName: admin.name,
          entity: `entity-${i}`,
        })
      )
    );

    const res = await request(app)
      .get(BASE)
      .set(adminHeaders)
      .query({ page: 1, limit: 2 })
      .expect(200);
    expect(res.body.logs).toHaveLength(2);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 2, total: 5, totalPages: 3 });

    const page2 = await request(app)
      .get(BASE)
      .set(adminHeaders)
      .query({ page: 2, limit: 2 })
      .expect(200);
    expect(page2.body.logs).toHaveLength(2);
    expect(page2.body.pagination.page).toBe(2);

    const page3 = await request(app)
      .get(BASE)
      .set(adminHeaders)
      .query({ page: 3, limit: 2 })
      .expect(200);
    expect(page3.body.logs).toHaveLength(1);
  });

  it('returns empty result set when no logs match', async () => {
    const { app, adminHeaders } = await setup();
    const res = await request(app).get(BASE).set(adminHeaders).expect(200);
    expect(res.body.logs).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
    expect(res.body.pagination.totalPages).toBe(0);
  });

  it('returns 400 for invalid userId format', async () => {
    const { app, adminHeaders } = await setup();
    const res = await request(app)
      .get(BASE)
      .set(adminHeaders)
      .query({ userId: 'invalid-id' })
      .expect(400);
    expect(res.body.error).toBe('Invalid query parameters');
    expect(res.body.details).toHaveProperty('userId');
  });

  it('returns 400 for page less than 1', async () => {
    const { app, adminHeaders } = await setup();
    const res = await request(app).get(BASE).set(adminHeaders).query({ page: 0 }).expect(400);
    expect(res.body.error).toBe('Invalid query parameters');
    expect(res.body.details).toHaveProperty('page');
  });

  it('returns 400 for limit less than 1', async () => {
    const { app, adminHeaders } = await setup();
    const res = await request(app).get(BASE).set(adminHeaders).query({ limit: 0 }).expect(400);
    expect(res.body.error).toBe('Invalid query parameters');
    expect(res.body.details).toHaveProperty('limit');
  });

  it('returns 400 for limit greater than 200', async () => {
    const { app, adminHeaders } = await setup();
    const res = await request(app).get(BASE).set(adminHeaders).query({ limit: 201 }).expect(400);
    expect(res.body.error).toBe('Invalid query parameters');
    expect(res.body.details).toHaveProperty('limit');
  });

  it('filters by free-text search across userName, entity, ip, path', async () => {
    const { school, admin, app, adminHeaders } = await setup();
    await AuditTrail.create([
      createAuditLog({
        schoolId: school._id,
        userId: admin._id,
        userName: 'Ananya Sharma',
        action: 'created',
        entity: 'student',
        ipAddress: '10.0.0.7',
        path: '/api/students',
      }),
      createAuditLog({
        schoolId: school._id,
        userId: admin._id,
        userName: 'Dinesh Admin',
        action: 'updated',
        entity: 'staff',
        ipAddress: '192.168.1.10',
        path: '/api/staff/staff-001',
      }),
      createAuditLog({
        schoolId: school._id,
        userId: admin._id,
        userName: 'Ravi Menon',
        action: 'deleted',
        entity: 'class',
        ipAddress: '203.0.113.5',
        path: '/api/classes/cls-12b',
      }),
    ]);

    const byUser = await request(app)
      .get(BASE)
      .set(adminHeaders)
      .query({ search: 'ananya' })
      .expect(200);
    expect(byUser.body.logs).toHaveLength(1);
    expect(byUser.body.logs[0].userName).toBe('Ananya Sharma');
    expect(byUser.body.pagination.total).toBe(1);

    const byIp = await request(app)
      .get(BASE)
      .set(adminHeaders)
      .query({ search: '203.0.113' })
      .expect(200);
    expect(byIp.body.logs).toHaveLength(1);
    expect(byIp.body.logs[0].ipAddress).toBe('203.0.113.5');

    const byPath = await request(app)
      .get(BASE)
      .set(adminHeaders)
      .query({ search: '/api/staff' })
      .expect(200);
    expect(byPath.body.logs).toHaveLength(1);
    expect(byPath.body.logs[0].entity).toBe('staff');

    const byEntity = await request(app)
      .get(BASE)
      .set(adminHeaders)
      .query({ search: 'class' })
      .expect(200);
    expect(byEntity.body.logs.map((l) => l.entity)).toContain('class');
  });

  it('search is case-insensitive', async () => {
    const { school, admin, app, adminHeaders } = await setup();
    await AuditTrail.create(
      createAuditLog({
        schoolId: school._id,
        userId: admin._id,
        userName: 'Ananya Sharma',
        action: 'created',
        entity: 'student',
      })
    );

    const res = await request(app)
      .get(BASE)
      .set(adminHeaders)
      .query({ search: 'ANANYA' })
      .expect(200);
    expect(res.body.logs).toHaveLength(1);
  });

  it('search escapes regex special characters (no ReDoS, literal match)', async () => {
    const { school, admin, app, adminHeaders } = await setup();
    await AuditTrail.create([
      createAuditLog({
        schoolId: school._id,
        userId: admin._id,
        userName: 'foo.*admin.*bar',
        ipAddress: '127.0.0.1',
      }),
      createAuditLog({
        schoolId: school._id,
        userId: admin._id,
        userName: 'admin.test',
        ipAddress: '127.0.0.2',
      }),
    ]);

    // The literal string ".*admin.*" should match the first log literally,
    // not act as a regex pattern that would otherwise match every record
    // containing "admin" (or be vulnerable to ReDoS).
    const res = await request(app)
      .get(BASE)
      .set(adminHeaders)
      .query({ search: '.*admin.*' })
      .expect(200);
    expect(res.body.logs).toHaveLength(1);
    expect(res.body.logs[0].userName).toBe('foo.*admin.*bar');
  });

  it('returns 400 when search is whitespace only', async () => {
    const { app, adminHeaders } = await setup();
    const res = await request(app).get(BASE).set(adminHeaders).query({ search: '   ' }).expect(400);
    expect(res.body.error).toBe('Invalid query parameters');
    expect(res.body.details).toHaveProperty('search');
  });

  it('returns 400 when search exceeds 100 chars', async () => {
    const { app, adminHeaders } = await setup();
    const res = await request(app)
      .get(BASE)
      .set(adminHeaders)
      .query({ search: 'a'.repeat(101) })
      .expect(400);
    expect(res.body.error).toBe('Invalid query parameters');
    expect(res.body.details).toHaveProperty('search');
  });

  it('search combines with filters and pagination', async () => {
    const { school, admin, app, adminHeaders } = await setup();
    await AuditTrail.create(
      Array.from({ length: 6 }, (_, i) =>
        createAuditLog({
          schoolId: school._id,
          userId: admin._id,
          userName: 'Ananya Sharma',
          entity: i % 2 === 0 ? 'student' : 'staff',
          action: 'created',
        })
      )
    );

    const res = await request(app)
      .get(BASE)
      .set(adminHeaders)
      .query({ search: 'ananya', entity: 'staff', page: 1, limit: 2 })
      .expect(200);
    expect(res.body.logs).toHaveLength(2);
    expect(res.body.logs.every((l) => l.entity === 'staff')).toBe(true);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 2, total: 3 });
  });

  it('defaults limit to 50 and page to 1', async () => {
    const { school, admin, app, adminHeaders } = await setup();
    await AuditTrail.create(
      createAuditLog({ schoolId: school._id, userId: admin._id, userName: admin.name })
    );

    const res = await request(app).get(BASE).set(adminHeaders).expect(200);
    expect(res.body.pagination.limit).toBe(50);
    expect(res.body.pagination.page).toBe(1);
  });

  it('enforces max limit of 200', async () => {
    const { school, admin, app, adminHeaders } = await setup();
    await AuditTrail.create(
      Array.from({ length: 5 }, () =>
        createAuditLog({ schoolId: school._id, userId: admin._id, userName: admin.name })
      )
    );

    const res = await request(app).get(BASE).set(adminHeaders).query({ limit: 200 }).expect(200);
    expect(res.body.logs).toHaveLength(5);
    expect(res.body.pagination.limit).toBe(200);
  });
});

// ─── GET /api/audit-logs/:id ─────────────────────────────────────────────────

describe('GET /api/audit-logs/:id', () => {
  it('returns a single audit log detail', async () => {
    const { school, admin, app, adminHeaders } = await setup();
    const log = await AuditTrail.create(
      createAuditLog({
        schoolId: school._id,
        userId: admin._id,
        userName: admin.name,
        action: 'login',
      })
    );

    const res = await request(app).get(`${BASE}/${log._id}`).set(adminHeaders).expect(200);
    expect(res.body._id.toString()).toBe(log._id.toString());
    expect(res.body.action).toBe('login');
    expect(res.body.userId).toBeDefined();
  });

  it('returns 404 for non-existent log', async () => {
    const { app, adminHeaders } = await setup();
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app).get(`${BASE}/${fakeId}`).set(adminHeaders).expect(404);
    expect(res.body.error).toBe('Audit log not found');
  });

  it('does not return audit logs from another school', async () => {
    const schoolA = await createSchoolRecord({ name: 'School A', code: 'AUDIT-A' });
    const schoolB = await createSchoolRecord({ name: 'School B', code: 'AUDIT-B' });
    const adminA = await createStaffUser({
      name: 'Admin A',
      email: 'admin.a@example.com',
      schoolId: schoolA._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    const adminB = await createStaffUser({
      name: 'Admin B',
      email: 'admin.b@example.com',
      schoolId: schoolB._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });

    const logA = await AuditTrail.create(
      createAuditLog({ schoolId: schoolA._id, userId: adminA._id, userName: adminA.name })
    );

    const { app } = createTestApp();
    await request(app).get(`${BASE}/${logA._id}`).set(authHeadersFor(adminB, 'admin')).expect(404);
  });
});

// ─── GET /api/audit-logs/export ──────────────────────────────────────────────

describe('GET /api/audit-logs/export', () => {
  it('exports audit logs as CSV with correct headers', async () => {
    const { school, admin, app, adminHeaders } = await setup();
    await AuditTrail.create(
      createAuditLog({
        schoolId: school._id,
        userId: admin._id,
        userName: admin.name,
        action: 'created',
        entity: 'student',
      })
    );

    const res = await request(app)
      .get(`${BASE}/export`)
      .set(adminHeaders)
      .query({ format: 'csv' })
      .expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="audit-logs-/);
    expect(res.text).toContain(
      'Date/Time,Action,Entity,Entity ID,Performed By,User Name,IP Address,Path,Method'
    );
    expect(res.text).toContain('created');
    expect(res.text).toContain('student');
  });

  it('exports audit logs as JSON with correct headers', async () => {
    const { school, admin, app, adminHeaders } = await setup();
    await AuditTrail.create(
      createAuditLog({
        schoolId: school._id,
        userId: admin._id,
        userName: admin.name,
        action: 'updated',
        entity: 'staff',
      })
    );

    const res = await request(app)
      .get(`${BASE}/export`)
      .set(adminHeaders)
      .query({ format: 'json' })
      .expect(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="audit-logs-/);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].action).toBe('updated');
  });

  it('defaults to CSV when no format is specified', async () => {
    const { school, admin, app, adminHeaders } = await setup();
    await AuditTrail.create(
      createAuditLog({ schoolId: school._id, userId: admin._id, userName: admin.name })
    );

    const res = await request(app).get(`${BASE}/export`).set(adminHeaders).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
  });

  it('returns 400 for invalid format', async () => {
    const { app, adminHeaders } = await setup();
    const res = await request(app)
      .get(`${BASE}/export`)
      .set(adminHeaders)
      .query({ format: 'xml' })
      .expect(400);
    expect(res.body.error).toBe('Invalid query parameters');
    expect(res.body.details).toHaveProperty('format');
  });

  it('respects filters during export', async () => {
    const { school, admin, app, adminHeaders } = await setup();
    await AuditTrail.create([
      createAuditLog({
        schoolId: school._id,
        userId: admin._id,
        userName: admin.name,
        action: 'created',
        entity: 'student',
      }),
      createAuditLog({
        schoolId: school._id,
        userId: admin._id,
        userName: admin.name,
        action: 'updated',
        entity: 'staff',
      }),
    ]);

    const res = await request(app)
      .get(`${BASE}/export`)
      .set(adminHeaders)
      .query({ format: 'json', action: 'created' })
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].action).toBe('created');
  });

  it('respects search during export', async () => {
    const { school, admin, app, adminHeaders } = await setup();
    await AuditTrail.create([
      createAuditLog({
        schoolId: school._id,
        userId: admin._id,
        userName: 'Ananya Sharma',
        ipAddress: '10.0.0.7',
      }),
      createAuditLog({
        schoolId: school._id,
        userId: admin._id,
        userName: 'Other User',
        ipAddress: '10.0.0.8',
      }),
    ]);

    const res = await request(app)
      .get(`${BASE}/export`)
      .set(adminHeaders)
      .query({ format: 'json', search: 'ananya' })
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].userName).toBe('Ananya Sharma');
  });

  it('returns empty CSV when no logs match', async () => {
    const { app, adminHeaders } = await setup();
    const res = await request(app)
      .get(`${BASE}/export`)
      .set(adminHeaders)
      .query({ format: 'csv' })
      .expect(200);
    expect(res.text).toContain(
      'Date/Time,Action,Entity,Entity ID,Performed By,User Name,IP Address,Path,Method'
    );
    const lines = res.text.split('\n').filter((l) => l.trim());
    expect(lines).toHaveLength(1); // only header
  });

  it('returns empty JSON array when no logs match', async () => {
    const { app, adminHeaders } = await setup();
    const res = await request(app)
      .get(`${BASE}/export`)
      .set(adminHeaders)
      .query({ format: 'json' })
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });
});

// ─── POST /api/audit-logs/purge ──────────────────────────────────────────────

describe('POST /api/audit-logs/purge', () => {
  it('purges audit logs older than retention period', async () => {
    const { school, admin, app, adminHeaders } = await setup();

    const oldDate = new Date();
    oldDate.setMonth(oldDate.getMonth() - 24);
    const recentDate = new Date();
    recentDate.setMonth(recentDate.getMonth() - 1);

    await AuditTrail.create([
      createAuditLog({
        schoolId: school._id,
        userId: admin._id,
        userName: admin.name,
        createdAt: oldDate,
      }),
      createAuditLog({
        schoolId: school._id,
        userId: admin._id,
        userName: admin.name,
        createdAt: recentDate,
      }),
    ]);

    const res = await request(app)
      .post(`${BASE}/purge`)
      .set(adminHeaders)
      .send({ retentionMonths: 12 })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.purged).toBe(1);
    expect(res.body.retentionMonths).toBe(12);
    expect(res.body.cutoffDate).toBeDefined();

    const remaining = await AuditTrail.countDocuments({ schoolId: school._id });
    expect(remaining).toBe(1);
  });

  it('uses default retention of 12 months when not provided', async () => {
    const { school, admin, app, adminHeaders } = await setup();
    const oldDate = new Date();
    oldDate.setMonth(oldDate.getMonth() - 24);
    await AuditTrail.create(
      createAuditLog({
        schoolId: school._id,
        userId: admin._id,
        userName: admin.name,
        createdAt: oldDate,
      })
    );

    const res = await request(app).post(`${BASE}/purge`).set(adminHeaders).send({}).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.retentionMonths).toBe(12);
  });

  it('returns 400 for retentionMonths less than 1', async () => {
    const { app, adminHeaders } = await setup();
    const res = await request(app)
      .post(`${BASE}/purge`)
      .set(adminHeaders)
      .send({ retentionMonths: 0 })
      .expect(400);
    expect(res.body.error).toBe('Invalid parameters');
    expect(res.body.details).toHaveProperty('retentionMonths');
  });

  it('returns 400 for retentionMonths greater than 120', async () => {
    const { app, adminHeaders } = await setup();
    const res = await request(app)
      .post(`${BASE}/purge`)
      .set(adminHeaders)
      .send({ retentionMonths: 121 })
      .expect(400);
    expect(res.body.error).toBe('Invalid parameters');
    expect(res.body.details).toHaveProperty('retentionMonths');
  });
});

// ─── Multi-tenancy ───────────────────────────────────────────────────────────

describe('multi-tenancy', () => {
  it('only returns audit logs for the admin school', async () => {
    const schoolA = await createSchoolRecord({ name: 'School A', code: 'MT-A' });
    const schoolB = await createSchoolRecord({ name: 'School B', code: 'MT-B' });
    const adminA = await createStaffUser({
      name: 'Admin A',
      email: 'mt.admin.a@example.com',
      schoolId: schoolA._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });

    await AuditTrail.create([
      createAuditLog({ schoolId: schoolA._id, userId: adminA._id, userName: adminA.name }),
      createAuditLog({ schoolId: schoolB._id, userId: adminA._id, userName: adminA.name }),
    ]);

    const { app } = createTestApp();
    const res = await request(app).get(BASE).set(authHeadersFor(adminA, 'admin')).expect(200);
    expect(res.body.logs).toHaveLength(1);
  });

  it('export only includes audit logs for the admin school', async () => {
    const schoolA = await createSchoolRecord({ name: 'School A', code: 'MT-EXP-A' });
    const schoolB = await createSchoolRecord({ name: 'School B', code: 'MT-EXP-B' });
    const adminA = await createStaffUser({
      name: 'Admin A',
      email: 'mt.exp.admin.a@example.com',
      schoolId: schoolA._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });

    await AuditTrail.create([
      createAuditLog({
        schoolId: schoolA._id,
        userId: adminA._id,
        userName: adminA.name,
        action: 'created',
      }),
      createAuditLog({
        schoolId: schoolB._id,
        userId: adminA._id,
        userName: adminA.name,
        action: 'updated',
      }),
    ]);

    const { app } = createTestApp();
    const res = await request(app)
      .get(`${BASE}/export`)
      .set(authHeadersFor(adminA, 'admin'))
      .query({ format: 'json' })
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].action).toBe('created');
  });
});
