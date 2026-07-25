/**
 * Phase 2 — Unified cross-school activity feed.
 *
 * GET /api/v1/super-admin/activity merges AuditTrail + TrashItem +
 * FeatureFlagAuditLog into one chronological feed with filters + pagination.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { generateToken } from '../middleware/auth.js';
import { createTestApp } from './helpers/testApp.js';
import { createStaffUser, resetDefaultSchool } from './helpers/factories.js';
import AuditTrail from '../models/AuditTrail.js';
import TrashItem from '../models/TrashItem.js';
import FeatureFlagAuditLog from '../models/FeatureFlagAuditLog.js';
import School from '../models/School.js';

const { app } = createTestApp();

const SUPER_ADMIN_HEADERS = {
  Authorization: `Bearer ${generateToken('super-admin', ['Super Admin'], {
    userType: 'super-admin',
  })}`,
};

// A plain staff token (no Super Admin role) must be rejected.
function staffHeaders(staff) {
  return {
    Authorization: `Bearer ${generateToken(staff._id.toString(), 'Admin', {
      schoolId: staff.schoolId,
      userType: 'staff',
    })}`,
  };
}

function iso(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() + daysAgo);
  return d;
}

let schoolA, schoolB, staffA;

async function seed() {
  schoolA = await School.create({ name: 'Activity School A', code: 'ACTA', status: 'active' });
  schoolB = await School.create({ name: 'Activity School B', code: 'ACTB', status: 'active' });
  staffA = await createStaffUser({
    name: 'Asha Admin',
    email: 'asha@example.com',
    schoolId: schoolA._id,
    staffRole: ['Admin'],
    permissionRole: 'admin',
  });
}

describe('GET /api/v1/super-admin/activity', () => {
  beforeEach(async () => {
    resetDefaultSchool();
    // setup.js clears every collection natively before each test (bypassing
    // Mongoose's append-only hooks), so we only need to seed here.
    await seed();
  });

  it('rejects non-super-admin requests with 403', async () => {
    const res = await request(app).get('/api/v1/super-admin/activity').set(staffHeaders(staffA));
    expect(res.status).toBe(403);
  });

  it('merges audit, trash, and flag events into one chronological feed', async () => {
    await AuditTrail.create({
      schoolId: schoolA._id,
      userId: staffA._id,
      actorType: 'school-user',
      userName: 'Asha Admin',
      action: 'created',
      entity: 'student',
      entityId: 'abc123',
      method: 'POST',
      path: '/api/v1/students',
      createdAt: iso(-1),
    });
    await TrashItem.create({
      itemType: 'Exam',
      itemName: 'Midterm',
      schoolId: schoolB._id,
      restoreStrategy: 'soft-delete',
      deletedBy: staffA._id,
      deletedAt: iso(0),
      expiresAt: iso(30),
      originalData: { _id: 'x', name: 'Midterm' },
    });
    await FeatureFlagAuditLog.create({
      actorId: 'super-admin',
      actorEmail: 'ops@example.com',
      action: 'override_set',
      flagKey: 'advancedReports',
      createdAt: iso(-2),
      metadata: { schoolId: schoolA._id, enabled: true },
    });

    const res = await request(app).get('/api/v1/super-admin/activity').set(SUPER_ADMIN_HEADERS);
    expect(res.status).toBe(200);
    const sources = res.body.data.map((r) => r.source);
    expect(sources).toContain('audit');
    expect(sources).toContain('trash');
    expect(sources).toContain('flag');
    // chronological — most recent first (trash at day 0)
    expect(res.body.data[0].source).toBe('trash');
  });

  it('filters by source', async () => {
    await AuditTrail.create({
      schoolId: schoolA._id,
      userId: staffA._id,
      actorType: 'school-user',
      action: 'updated',
      entity: 'staff',
      method: 'PATCH',
      path: '/api/v1/staff/1',
      createdAt: iso(0),
    });
    await FeatureFlagAuditLog.create({
      actorId: 'super-admin',
      action: 'updated',
      flagKey: 'aiAssistant',
      createdAt: iso(0),
    });

    const res = await request(app)
      .get('/api/v1/super-admin/activity')
      .query({ source: 'flag' })
      .set(SUPER_ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.data.every((r) => r.source === 'flag')).toBe(true);
    expect(res.body.data.length).toBe(1);
  });

  it('filters by schoolId (including flag overrides for that school)', async () => {
    await AuditTrail.create({
      schoolId: schoolB._id,
      userId: staffA._id,
      actorType: 'school-user',
      action: 'created',
      entity: 'class',
      createdAt: iso(0),
    });
    await FeatureFlagAuditLog.create({
      actorId: 'super-admin',
      action: 'override_set',
      flagKey: 'advancedReports',
      createdAt: iso(0),
      metadata: { schoolId: schoolA._id, enabled: true },
    });

    const res = await request(app)
      .get('/api/v1/super-admin/activity')
      .query({ schoolId: schoolA._id.toString() })
      .set(SUPER_ADMIN_HEADERS);
    expect(res.status).toBe(200);
    // Only the flag override for schoolA should appear; schoolB audit excluded.
    expect(res.body.data.every((r) => String(r.schoolId) === String(schoolA._id))).toBe(true);
    expect(res.body.data.some((r) => r.source === 'flag')).toBe(true);
  });

  it('paginates and reports totals + bySource counts', async () => {
    for (let i = 0; i < 5; i += 1) {
      await AuditTrail.create({
        schoolId: schoolA._id,
        userId: staffA._id,
        actorType: 'school-user',
        action: 'updated',
        entity: 'staff',
        createdAt: iso(-i),
      });
    }
    const res = await request(app)
      .get('/api/v1/super-admin/activity')
      .query({ limit: 2, page: 1 })
      .set(SUPER_ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination.total).toBe(5);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBe(2);
    const auditBucket = res.body.bySource.find((b) => b.source === 'audit');
    expect(auditBucket.count).toBe(5);
  });

  it('validates query params and rejects bad input with 400', async () => {
    const res = await request(app)
      .get('/api/v1/super-admin/activity')
      .query({ limit: 999 })
      .set(SUPER_ADMIN_HEADERS);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });
});
