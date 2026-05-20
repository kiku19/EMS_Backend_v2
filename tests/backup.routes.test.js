import request from 'supertest';
import { describe, expect, it } from 'vitest';
import BackupRecord from '../models/BackupRecord.js';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function setupSchoolAndAdmin() {
  const school = await createSchoolRecord({});
  const admin = await createStaffUser({ schoolId: school._id });
  return { school, admin };
}

function headers(staff) {
  return authHeadersFor(staff);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('backup routes', () => {
  // ── Authentication ─────────────────────────────────────────────────────────

  describe('authentication', () => {
    it('returns 401 for POST /api/backup/create without auth', async () => {
      const { app } = createTestApp();
      await request(app).post('/api/backup/create').send({}).expect(401);
    });

    it('returns 401 for GET /api/backup/list without auth', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/backup/list').expect(401);
    });

    it('returns 401 for GET /api/backup/schedule without auth', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/backup/schedule').expect(401);
    });

    it('returns 401 for PUT /api/backup/schedule without auth', async () => {
      const { app } = createTestApp();
      await request(app)
        .put('/api/backup/schedule')
        .send({ enabled: true, frequency: 'daily' })
        .expect(401);
    });
  });

  // ── POST /api/backup/create ────────────────────────────────────────────────

  describe('POST /api/backup/create', () => {
    it('creates a backup and returns a summary', async () => {
      const { app } = createTestApp();
      const { admin } = await setupSchoolAndAdmin();

      const res = await request(app)
        .post('/api/backup/create')
        .set(headers(admin))
        .send({ label: 'test backup' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.backup).toMatchObject({
        label: 'test backup',
        status: 'completed',
      });
      expect(res.body.backup._id).toBeDefined();
      expect(res.body.backup.sizeBytes).toBeGreaterThan(0);
      // data payload must NOT be exposed in the summary
      expect(res.body.backup.data).toBeUndefined();
    });

    it('creates a backup with no label (default empty string)', async () => {
      const { app } = createTestApp();
      const { admin } = await setupSchoolAndAdmin();

      const res = await request(app)
        .post('/api/backup/create')
        .set(headers(admin))
        .send({})
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.backup.label).toBe('');
    });

    it('rejects a label that is too long', async () => {
      const { app } = createTestApp();
      const { admin } = await setupSchoolAndAdmin();

      await request(app)
        .post('/api/backup/create')
        .set(headers(admin))
        .send({ label: 'x'.repeat(101) })
        .expect(400);
    });

    it('scopes the backup to the authenticated school', async () => {
      const { app } = createTestApp();
      const schoolA = await createSchoolRecord({});
      const schoolB = await createSchoolRecord({});
      const adminA = await createStaffUser({ schoolId: schoolA._id });
      const adminB = await createStaffUser({ schoolId: schoolB._id });

      await request(app).post('/api/backup/create').set(headers(adminA)).send({}).expect(200);

      // adminB should see 0 backups (different schoolId)
      const listRes = await request(app).get('/api/backup/list').set(headers(adminB)).expect(200);

      expect(listRes.body.backups).toHaveLength(0);
    });
  });

  // ── GET /api/backup/list ───────────────────────────────────────────────────

  describe('GET /api/backup/list', () => {
    it('returns an empty list when no backups exist', async () => {
      const { app } = createTestApp();
      const { admin } = await setupSchoolAndAdmin();

      const res = await request(app).get('/api/backup/list').set(headers(admin)).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.backups).toEqual([]);
    });

    it('lists backups in descending creation order without data payload', async () => {
      const { app } = createTestApp();
      const { school, admin } = await setupSchoolAndAdmin();

      // Create two backups with a small delay so createdAt timestamps differ
      await request(app).post('/api/backup/create').set(headers(admin)).send({ label: 'first' });
      await new Promise((r) => setTimeout(r, 50));
      await request(app).post('/api/backup/create').set(headers(admin)).send({ label: 'second' });

      const res = await request(app).get('/api/backup/list').set(headers(admin)).expect(200);

      expect(res.body.backups).toHaveLength(2);
      expect(res.body.backups[0].label).toBe('second');
      // data must be stripped from list response
      expect(res.body.backups[0].data).toBeUndefined();
    });
  });

  // ── GET /api/backup/:id/download ───────────────────────────────────────────

  describe('GET /api/backup/:id/download', () => {
    it('streams backup JSON as a file download', async () => {
      const { app } = createTestApp();
      const { admin } = await setupSchoolAndAdmin();

      const createRes = await request(app)
        .post('/api/backup/create')
        .set(headers(admin))
        .send({ label: 'dl-test' });

      const backupId = createRes.body.backup._id;

      const res = await request(app)
        .get(`/api/backup/${backupId}/download`)
        .set(headers(admin))
        .expect(200);

      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.headers['content-disposition']).toMatch(/attachment/);
      const body = JSON.parse(res.text);
      expect(body.version).toBe('1.0');
      expect(body.collections).toBeDefined();
    });

    it('returns 404 for a backup that belongs to another school', async () => {
      const { app } = createTestApp();
      const schoolA = await createSchoolRecord({});
      const schoolB = await createSchoolRecord({});
      const adminA = await createStaffUser({ schoolId: schoolA._id });
      const adminB = await createStaffUser({ schoolId: schoolB._id });

      const createRes = await request(app).post('/api/backup/create').set(headers(adminA)).send({});

      const backupId = createRes.body.backup._id;

      await request(app).get(`/api/backup/${backupId}/download`).set(headers(adminB)).expect(404);
    });
  });

  // ── POST /api/backup/:id/restore ───────────────────────────────────────────

  describe('POST /api/backup/:id/restore', () => {
    it('returns 400 when confirmText is missing', async () => {
      const { app } = createTestApp();
      const { admin } = await setupSchoolAndAdmin();

      const createRes = await request(app).post('/api/backup/create').set(headers(admin)).send({});

      const backupId = createRes.body.backup._id;

      await request(app)
        .post(`/api/backup/${backupId}/restore`)
        .set(headers(admin))
        .send({})
        .expect(400);
    });

    it('returns 400 when confirmText is not exactly "RESTORE"', async () => {
      const { app } = createTestApp();
      const { admin } = await setupSchoolAndAdmin();

      const createRes = await request(app).post('/api/backup/create').set(headers(admin)).send({});

      const backupId = createRes.body.backup._id;

      await request(app)
        .post(`/api/backup/${backupId}/restore`)
        .set(headers(admin))
        .send({ confirmText: 'restore' })
        .expect(400);
    });

    it('restores a backup when confirmText is "RESTORE"', async () => {
      const { app } = createTestApp();
      const { admin } = await setupSchoolAndAdmin();

      const createRes = await request(app).post('/api/backup/create').set(headers(admin)).send({});

      const backupId = createRes.body.backup._id;

      const res = await request(app)
        .post(`/api/backup/${backupId}/restore`)
        .set(headers(admin))
        .send({ confirmText: 'RESTORE' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.restored).toBeDefined();
    });

    it('returns 404 when restoring a backup from another school', async () => {
      const { app } = createTestApp();
      const schoolA = await createSchoolRecord({});
      const schoolB = await createSchoolRecord({});
      const adminA = await createStaffUser({ schoolId: schoolA._id });
      const adminB = await createStaffUser({ schoolId: schoolB._id });

      const createRes = await request(app).post('/api/backup/create').set(headers(adminA)).send({});

      const backupId = createRes.body.backup._id;

      await request(app)
        .post(`/api/backup/${backupId}/restore`)
        .set(headers(adminB))
        .send({ confirmText: 'RESTORE' })
        .expect(404);
    });
  });

  // ── GET /api/backup/schedule ───────────────────────────────────────────────

  describe('GET /api/backup/schedule', () => {
    it('returns empty schedule when none configured', async () => {
      const { app } = createTestApp();
      const { admin } = await setupSchoolAndAdmin();

      const res = await request(app).get('/api/backup/schedule').set(headers(admin)).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.schedule).toBeDefined();
    });
  });

  // ── PUT /api/backup/schedule ───────────────────────────────────────────────

  describe('PUT /api/backup/schedule', () => {
    it('saves a valid daily schedule', async () => {
      const { app } = createTestApp();
      const { admin } = await setupSchoolAndAdmin();

      const res = await request(app)
        .put('/api/backup/schedule')
        .set(headers(admin))
        .send({ enabled: true, frequency: 'daily' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.schedule.enabled).toBe(true);
      expect(res.body.schedule.frequency).toBe('daily');
    });

    it('saves a valid weekly schedule with dayOfWeek', async () => {
      const { app } = createTestApp();
      const { admin } = await setupSchoolAndAdmin();

      const res = await request(app)
        .put('/api/backup/schedule')
        .set(headers(admin))
        .send({ enabled: true, frequency: 'weekly', dayOfWeek: 0 })
        .expect(200);

      expect(res.body.schedule.frequency).toBe('weekly');
      expect(res.body.schedule.dayOfWeek).toBe(0);
    });

    it('rejects an invalid frequency enum', async () => {
      const { app } = createTestApp();
      const { admin } = await setupSchoolAndAdmin();

      await request(app)
        .put('/api/backup/schedule')
        .set(headers(admin))
        .send({ enabled: true, frequency: 'hourly' })
        .expect(400);
    });

    it('rejects a dayOfWeek out of range', async () => {
      const { app } = createTestApp();
      const { admin } = await setupSchoolAndAdmin();

      await request(app)
        .put('/api/backup/schedule')
        .set(headers(admin))
        .send({ enabled: true, frequency: 'weekly', dayOfWeek: 7 })
        .expect(400);
    });

    it('rejects an invalid notifyEmail', async () => {
      const { app } = createTestApp();
      const { admin } = await setupSchoolAndAdmin();

      await request(app)
        .put('/api/backup/schedule')
        .set(headers(admin))
        .send({ enabled: true, frequency: 'daily', notifyEmail: 'not-an-email' })
        .expect(400);
    });

    it('accepts an empty notifyEmail', async () => {
      const { app } = createTestApp();
      const { admin } = await setupSchoolAndAdmin();

      const res = await request(app)
        .put('/api/backup/schedule')
        .set(headers(admin))
        .send({ enabled: false, frequency: 'monthly', notifyEmail: '' })
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  // ── DELETE /api/backup/:id ─────────────────────────────────────────────────

  describe('DELETE /api/backup/:id', () => {
    it('deletes an existing backup record', async () => {
      const { app } = createTestApp();
      const { admin } = await setupSchoolAndAdmin();

      const createRes = await request(app).post('/api/backup/create').set(headers(admin)).send({});

      const backupId = createRes.body.backup._id;

      await request(app).delete(`/api/backup/${backupId}`).set(headers(admin)).expect(200);

      // Should no longer appear in list
      const listRes = await request(app).get('/api/backup/list').set(headers(admin));

      expect(listRes.body.backups.find((b) => b._id === backupId)).toBeUndefined();
    });

    it('returns 404 when deleting a backup from another school', async () => {
      const { app } = createTestApp();
      const schoolA = await createSchoolRecord({});
      const schoolB = await createSchoolRecord({});
      const adminA = await createStaffUser({ schoolId: schoolA._id });
      const adminB = await createStaffUser({ schoolId: schoolB._id });

      const createRes = await request(app).post('/api/backup/create').set(headers(adminA)).send({});

      const backupId = createRes.body.backup._id;

      await request(app).delete(`/api/backup/${backupId}`).set(headers(adminB)).expect(404);
    });

    it('returns 401 without auth', async () => {
      const { app } = createTestApp();
      await request(app).delete('/api/backup/000000000000000000000001').expect(401);
    });
  });
});
