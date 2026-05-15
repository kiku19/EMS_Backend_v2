import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { SchoolSettings, DocumentConfig } from '../database.js';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

describe('settings routes', () => {
  // ============================================================
  // AUTH: 401 without token
  // ============================================================

  describe('authentication', () => {
    it('returns 401 for GET /api/settings/school without auth', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/settings/school').expect(401);
    });

    it('returns 401 for PUT /api/settings/school without auth', async () => {
      const { app } = createTestApp();
      await request(app).put('/api/settings/school').send({ name: 'X' }).expect(401);
    });

    it('returns 401 for GET /api/settings/academic-year without auth', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/settings/academic-year').expect(401);
    });

    it('returns 401 for PUT /api/settings/academic-year without auth', async () => {
      const { app } = createTestApp();
      await request(app)
        .put('/api/settings/academic-year')
        .send({ academicYear: '2025-26' })
        .expect(401);
    });

    it('returns 401 for GET /api/settings/holidays without auth', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/settings/holidays').expect(401);
    });

    it('returns 401 for POST /api/settings/holidays without auth', async () => {
      const { app } = createTestApp();
      await request(app)
        .post('/api/settings/holidays')
        .send({ name: 'Holiday', date: '2025-12-25' })
        .expect(401);
    });

    it('returns 401 for GET /api/settings/leave-types without auth', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/settings/leave-types').expect(401);
    });

    it('returns 401 for GET /api/settings/subjects without auth', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/settings/subjects').expect(401);
    });

    it('returns 401 for PUT /api/settings/document-config/atomic without auth', async () => {
      const { app } = createTestApp();
      await request(app)
        .put('/api/settings/document-config/atomic')
        .send({ configs: [] })
        .expect(401);
    });
  });

  // ============================================================
  // GET /api/settings/school
  // ============================================================

  describe('GET /api/settings/school', () => {
    it('returns school settings (auto-creates if none exist)', async () => {
      const school = await createSchoolRecord({
        name: 'Settings School',
        code: 'SETTINGS1',
      });
      const admin = await createStaffUser({
        name: 'Settings Admin',
        email: 'settings.admin1@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      const { app } = createTestApp();
      const response = await request(app)
        .get('/api/settings/school')
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);

      expect(response.body).toMatchObject({
        schoolId: school._id.toString(),
      });
      expect(response.body).toHaveProperty('academicYear');
      expect(response.body).toHaveProperty('schoolStartTime');
      expect(response.body).toHaveProperty('schoolEndTime');
    });

    it('returns existing settings when they already exist', async () => {
      const school = await createSchoolRecord({
        name: 'Existing Settings School',
        code: 'EXISTSET',
      });
      const admin = await createStaffUser({
        name: 'Existing Admin',
        email: 'existing.settings@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      await SchoolSettings.create({
        schoolId: school._id,
        name: 'My Custom School',
        schoolName: 'My Custom School',
        phone: '1234567890',
      });

      const { app } = createTestApp();
      const response = await request(app)
        .get('/api/settings/school')
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);

      expect(response.body).toMatchObject({
        schoolId: school._id.toString(),
        name: 'My Custom School',
        phone: '1234567890',
      });
    });
  });

  // ============================================================
  // PUT /api/settings/school
  // ============================================================

  describe('PUT /api/settings/school', () => {
    it('updates school settings', async () => {
      const school = await createSchoolRecord({
        name: 'Update School',
        code: 'UPDSET',
      });
      const admin = await createStaffUser({
        name: 'Update Admin',
        email: 'update.settings@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      // Ensure settings exist first
      await SchoolSettings.create({
        schoolId: school._id,
        name: 'Old Name',
        schoolName: 'Old Name',
      });

      const { app } = createTestApp();
      const response = await request(app)
        .put('/api/settings/school')
        .set(authHeadersFor(admin, 'admin'))
        .send({
          name: 'Updated School Name',
          phone: '9998887777',
          email: 'school@example.com',
          address: '123 Main St',
        })
        .expect(200);

      expect(response.body).toMatchObject({
        name: 'Updated School Name',
        schoolName: 'Updated School Name',
        phone: '9998887777',
        email: 'school@example.com',
        address: '123 Main St',
      });
    });

    it('creates settings if they do not exist on update', async () => {
      const school = await createSchoolRecord({
        name: 'New Settings School',
        code: 'NEWSET',
      });
      const admin = await createStaffUser({
        name: 'New Settings Admin',
        email: 'new.settings@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      const { app } = createTestApp();
      const response = await request(app)
        .put('/api/settings/school')
        .set(authHeadersFor(admin, 'admin'))
        .send({
          name: 'Brand New School',
          phone: '5554443333',
        })
        .expect(200);

      expect(response.body).toMatchObject({
        name: 'Brand New School',
        schoolName: 'Brand New School',
        phone: '5554443333',
      });
    });

    it('syncs academicYear to currentSession', async () => {
      const school = await createSchoolRecord({
        name: 'Sync AY School',
        code: 'SYNCAY',
      });
      const admin = await createStaffUser({
        name: 'Sync Admin',
        email: 'sync.ay@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      await SchoolSettings.create({
        schoolId: school._id,
        name: 'Sync School',
      });

      const { app } = createTestApp();
      // academicYear is not writable through PUT /school anymore — the dedicated
      // PUT /academic-year route is the single entry point and syncs
      // currentSession on the settings document at save time.
      await request(app)
        .put('/api/settings/academic-year')
        .set(authHeadersFor(admin, 'admin'))
        .send({ academicYear: '2026-27', confirm: true })
        .expect(200);

      const saved = await SchoolSettings.findOne({ schoolId: school._id }).lean();
      expect(saved.academicYear).toBe('2026-27');
      expect(saved.currentSession).toBe('2026-27');
    });
  });

  // ============================================================
  // GET /api/settings/academic-year
  // ============================================================

  describe('GET /api/settings/academic-year', () => {
    it('returns academic year settings', async () => {
      const school = await createSchoolRecord({
        name: 'AY School',
        code: 'AYSCH',
      });
      const admin = await createStaffUser({
        name: 'AY Admin',
        email: 'ay.admin@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      const { app } = createTestApp();
      const response = await request(app)
        .get('/api/settings/academic-year')
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);

      expect(response.body).toHaveProperty('academicYear');
      expect(response.body).toHaveProperty('academicYearStart');
      expect(response.body).toHaveProperty('academicYearEnd');
    });
  });

  // ============================================================
  // PUT /api/settings/academic-year
  // ============================================================

  describe('PUT /api/settings/academic-year', () => {
    it('updates academic year settings', async () => {
      const school = await createSchoolRecord({
        name: 'AY Update School',
        code: 'AYUPD',
      });
      const admin = await createStaffUser({
        name: 'AY Update Admin',
        email: 'ay.update@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      const { app } = createTestApp();
      const response = await request(app)
        .put('/api/settings/academic-year')
        .set(authHeadersFor(admin, 'admin'))
        .send({
          academicYear: '2026-27',
          academicYearStart: '2026-04-01',
          academicYearEnd: '2027-03-31',
          confirm: true,
        })
        .expect(200);

      expect(response.body).toMatchObject({
        academicYear: '2026-27',
        academicYearStart: '2026-04-01',
        academicYearEnd: '2027-03-31',
      });
    });

    it('returns 400 when academicYear is missing', async () => {
      const school = await createSchoolRecord({
        name: 'AY Missing School',
        code: 'AYMIS',
      });
      const admin = await createStaffUser({
        name: 'AY Missing Admin',
        email: 'ay.missing@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      const { app } = createTestApp();
      await request(app)
        .put('/api/settings/academic-year')
        .set(authHeadersFor(admin, 'admin'))
        .send({})
        .expect(400);
    });

    it('defaults academicYearStart and academicYearEnd from parsed year', async () => {
      const school = await createSchoolRecord({
        name: 'AY Defaults School',
        code: 'AYDEF',
      });
      const admin = await createStaffUser({
        name: 'AY Defaults Admin',
        email: 'ay.defaults@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      const { app } = createTestApp();
      const response = await request(app)
        .put('/api/settings/academic-year')
        .set(authHeadersFor(admin, 'admin'))
        .send({ academicYear: '2025-26', confirm: true })
        .expect(200);

      expect(response.body.academicYear).toBe('2025-26');
      expect(response.body.academicYearStart).toBe('2025-04-01');
      expect(response.body.academicYearEnd).toBe('2026-03-31');
    });
  });

  // ============================================================
  // HOLIDAYS CRUD
  // ============================================================

  describe('holidays CRUD', () => {
    it('GET /api/settings/holidays returns empty array when no settings exist', async () => {
      const school = await createSchoolRecord({
        name: 'Holiday Empty School',
        code: 'HOLEMP',
      });
      const admin = await createStaffUser({
        name: 'Holiday Empty Admin',
        email: 'holiday.empty@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      const { app } = createTestApp();
      const response = await request(app)
        .get('/api/settings/holidays')
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('POST /api/settings/holidays adds a holiday', async () => {
      const school = await createSchoolRecord({
        name: 'Holiday Add School',
        code: 'HOLADD',
      });
      const admin = await createStaffUser({
        name: 'Holiday Add Admin',
        email: 'holiday.add@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      // Pre-create settings so holidays array is initialized
      await SchoolSettings.create({
        schoolId: school._id,
        name: 'Holiday School',
      });

      const { app } = createTestApp();
      const response = await request(app)
        .post('/api/settings/holidays')
        .set(authHeadersFor(admin, 'admin'))
        .send({
          name: 'Christmas',
          date: '2025-12-25',
          type: 'National',
          description: 'Christmas Day',
        })
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      expect(response.body).toHaveLength(1);
      expect(response.body[0]).toMatchObject({
        name: 'Christmas',
        date: '2025-12-25',
        type: 'National',
      });
    });

    it('POST /api/settings/holidays creates settings if they do not exist', async () => {
      const school = await createSchoolRecord({
        name: 'Holiday NoSettings School',
        code: 'HOLNOS',
      });
      const admin = await createStaffUser({
        name: 'Holiday NoSettings Admin',
        email: 'holiday.nosettings@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      const { app } = createTestApp();
      const response = await request(app)
        .post('/api/settings/holidays')
        .set(authHeadersFor(admin, 'admin'))
        .send({
          name: 'New Year',
          date: '2026-01-01',
          type: 'General',
        })
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].name).toBe('New Year');
    });

    it('PUT /api/settings/holidays/:id updates a holiday', async () => {
      const school = await createSchoolRecord({
        name: 'Holiday Update School',
        code: 'HOLUPD',
      });
      const admin = await createStaffUser({
        name: 'Holiday Update Admin',
        email: 'holiday.update@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      const settings = await SchoolSettings.create({
        schoolId: school._id,
        name: 'Holiday Update School',
        holidays: [{ name: 'Diwali', date: '2025-10-20', type: 'National' }],
      });
      const holidayId = settings.holidays[0]._id.toString();

      const { app } = createTestApp();
      const response = await request(app)
        .put(`/api/settings/holidays/${holidayId}`)
        .set(authHeadersFor(admin, 'admin'))
        .send({ name: 'Diwali Festival', date: '2025-10-21' })
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      const updated = response.body.find((h) => h.name === 'Diwali Festival');
      expect(updated).toBeTruthy();
      expect(updated.date).toBe('2025-10-21');
    });

    it('PUT /api/settings/holidays/:id returns 404 for non-existent holiday', async () => {
      const school = await createSchoolRecord({
        name: 'Holiday 404 School',
        code: 'HOL404',
      });
      const admin = await createStaffUser({
        name: 'Holiday 404 Admin',
        email: 'holiday.404@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      await SchoolSettings.create({
        schoolId: school._id,
        name: 'Holiday 404 School',
        holidays: [],
      });

      const { app } = createTestApp();
      await request(app)
        .put('/api/settings/holidays/64a1b2c3d4e5f6a7b8c9d0e1')
        .set(authHeadersFor(admin, 'admin'))
        .send({ name: 'Ghost Holiday' })
        .expect(404);
    });

    it('DELETE /api/settings/holidays/:id removes a holiday', async () => {
      const school = await createSchoolRecord({
        name: 'Holiday Delete School',
        code: 'HOLDEL',
      });
      const admin = await createStaffUser({
        name: 'Holiday Delete Admin',
        email: 'holiday.delete@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      const settings = await SchoolSettings.create({
        schoolId: school._id,
        name: 'Holiday Delete School',
        holidays: [
          { name: 'Republic Day', date: '2026-01-26', type: 'National' },
          { name: 'Independence Day', date: '2025-08-15', type: 'National' },
        ],
      });
      const deleteId = settings.holidays[0]._id.toString();

      const { app } = createTestApp();
      const response = await request(app)
        .delete(`/api/settings/holidays/${deleteId}`)
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].name).toBe('Independence Day');
    });
  });

  // ============================================================
  // LEAVE TYPES CRUD
  // ============================================================

  describe('leave types CRUD', () => {
    it('GET /api/settings/leave-types returns empty array when no settings exist', async () => {
      const school = await createSchoolRecord({
        name: 'Leave Empty School',
        code: 'LVEMPT',
      });
      const admin = await createStaffUser({
        name: 'Leave Empty Admin',
        email: 'leave.empty@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      const { app } = createTestApp();
      const response = await request(app)
        .get('/api/settings/leave-types')
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('POST /api/settings/leave-types adds a leave type', async () => {
      const school = await createSchoolRecord({
        name: 'Leave Add School',
        code: 'LVADD',
      });
      const admin = await createStaffUser({
        name: 'Leave Add Admin',
        email: 'leave.add@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      await SchoolSettings.create({
        schoolId: school._id,
        name: 'Leave Add School',
      });

      const { app } = createTestApp();
      const response = await request(app)
        .post('/api/settings/leave-types')
        .set(authHeadersFor(admin, 'admin'))
        .send({
          name: 'Casual Leave',
          quota: 12,
          applicableTo: 'both',
          requiresApproval: true,
          paid: true,
          color: '#4CAF50',
        })
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      expect(response.body).toHaveLength(1);
      expect(response.body[0]).toMatchObject({
        name: 'Casual Leave',
        quota: 12,
        applicableTo: 'both',
        requiresApproval: true,
        paid: true,
      });
    });

    it('POST /api/settings/leave-types creates settings if they do not exist', async () => {
      const school = await createSchoolRecord({
        name: 'Leave NoSettings School',
        code: 'LVNOS',
      });
      const admin = await createStaffUser({
        name: 'Leave NoSettings Admin',
        email: 'leave.nosettings@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      const { app } = createTestApp();
      const response = await request(app)
        .post('/api/settings/leave-types')
        .set(authHeadersFor(admin, 'admin'))
        .send({
          name: 'Sick Leave',
          quota: 10,
        })
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].name).toBe('Sick Leave');
    });

    it('PUT /api/settings/leave-types/:id updates a leave type', async () => {
      const school = await createSchoolRecord({
        name: 'Leave Update School',
        code: 'LVUPD',
      });
      const admin = await createStaffUser({
        name: 'Leave Update Admin',
        email: 'leave.update@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      const settings = await SchoolSettings.create({
        schoolId: school._id,
        name: 'Leave Update School',
        leaveTypes: [
          {
            name: 'Earned Leave',
            quota: 15,
            applicableTo: 'both',
            requiresApproval: true,
            paid: true,
          },
        ],
      });
      const leaveTypeId = settings.leaveTypes[0]._id.toString();

      const { app } = createTestApp();
      const response = await request(app)
        .put(`/api/settings/leave-types/${leaveTypeId}`)
        .set(authHeadersFor(admin, 'admin'))
        .send({ name: 'Earned Leave Updated', quota: 20 })
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      const updated = response.body.find((lt) => lt.name === 'Earned Leave Updated');
      expect(updated).toBeTruthy();
      expect(updated.quota).toBe(20);
    });

    it('PUT /api/settings/leave-types/:id returns 404 for non-existent leave type', async () => {
      const school = await createSchoolRecord({
        name: 'Leave 404 School',
        code: 'LV404',
      });
      const admin = await createStaffUser({
        name: 'Leave 404 Admin',
        email: 'leave.404@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      await SchoolSettings.create({
        schoolId: school._id,
        name: 'Leave 404 School',
        leaveTypes: [],
      });

      const { app } = createTestApp();
      await request(app)
        .put('/api/settings/leave-types/64a1b2c3d4e5f6a7b8c9d0e1')
        .set(authHeadersFor(admin, 'admin'))
        .send({ name: 'Ghost Leave' })
        .expect(404);
    });

    it('DELETE /api/settings/leave-types/:id removes a leave type', async () => {
      const school = await createSchoolRecord({
        name: 'Leave Delete School',
        code: 'LVDEL',
      });
      const admin = await createStaffUser({
        name: 'Leave Delete Admin',
        email: 'leave.delete@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      const settings = await SchoolSettings.create({
        schoolId: school._id,
        name: 'Leave Delete School',
        leaveTypes: [
          {
            name: 'Casual Leave',
            quota: 12,
            applicableTo: 'both',
            requiresApproval: true,
            paid: true,
          },
          {
            name: 'Sick Leave',
            quota: 10,
            applicableTo: 'both',
            requiresApproval: true,
            paid: true,
          },
        ],
      });
      const deleteId = settings.leaveTypes[0]._id.toString();

      const { app } = createTestApp();
      const response = await request(app)
        .delete(`/api/settings/leave-types/${deleteId}`)
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].name).toBe('Sick Leave');
    });
  });

  // ============================================================
  // SUBJECTS CRUD
  // ============================================================

  describe('subjects CRUD', () => {
    it('GET /api/settings/subjects returns empty array when no settings exist', async () => {
      const school = await createSchoolRecord({
        name: 'Subject Empty School',
        code: 'SUBEMP',
      });
      const admin = await createStaffUser({
        name: 'Subject Empty Admin',
        email: 'subject.empty@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      const { app } = createTestApp();
      const response = await request(app)
        .get('/api/settings/subjects')
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('POST /api/settings/subjects adds a subject', async () => {
      const school = await createSchoolRecord({
        name: 'Subject Add School',
        code: 'SUBADD',
      });
      const admin = await createStaffUser({
        name: 'Subject Add Admin',
        email: 'subject.add@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      await SchoolSettings.create({
        schoolId: school._id,
        name: 'Subject Add School',
      });

      const { app } = createTestApp();
      const response = await request(app)
        .post('/api/settings/subjects')
        .set(authHeadersFor(admin, 'admin'))
        .send({
          name: 'Mathematics',
          code: 'MATH',
          description: 'Core mathematics subject',
        })
        .expect(200);

      const subjects = response.body.subjects || response.body;
      expect(Array.isArray(subjects)).toBe(true);
      expect(subjects).toHaveLength(1);
      expect(subjects[0]).toMatchObject({
        name: 'Mathematics',
        code: 'MATH',
        description: 'Core mathematics subject',
      });
    });

    it('POST /api/settings/subjects creates settings if they do not exist', async () => {
      const school = await createSchoolRecord({
        name: 'Subject NoSettings School',
        code: 'SUBNOS',
      });
      const admin = await createStaffUser({
        name: 'Subject NoSettings Admin',
        email: 'subject.nosettings@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      const { app } = createTestApp();
      const response = await request(app)
        .post('/api/settings/subjects')
        .set(authHeadersFor(admin, 'admin'))
        .send({
          name: 'English',
          code: 'ENG',
        })
        .expect(200);

      const subjects = response.body.subjects || response.body;
      expect(Array.isArray(subjects)).toBe(true);
      expect(subjects).toHaveLength(1);
      expect(subjects[0].name).toBe('English');
    });

    it('PUT /api/settings/subjects/:id updates a subject', async () => {
      const school = await createSchoolRecord({
        name: 'Subject Update School',
        code: 'SUBUPD',
      });
      const admin = await createStaffUser({
        name: 'Subject Update Admin',
        email: 'subject.update@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      const settings = await SchoolSettings.create({
        schoolId: school._id,
        name: 'Subject Update School',
        subjects: [{ name: 'Science', code: 'SCI', description: 'General science' }],
      });
      const subjectId = settings.subjects[0]._id.toString();

      const { app } = createTestApp();
      const response = await request(app)
        .put(`/api/settings/subjects/${subjectId}`)
        .set(authHeadersFor(admin, 'admin'))
        .send({ name: 'General Science', code: 'GSCI' })
        .expect(200);

      const subjects = response.body.subjects || response.body;
      expect(Array.isArray(subjects)).toBe(true);
      const updated = subjects.find((s) => s.name === 'General Science');
      expect(updated).toBeTruthy();
      expect(updated.code).toBe('GSCI');
    });

    it('PUT /api/settings/subjects/:id returns 404 for non-existent subject', async () => {
      const school = await createSchoolRecord({
        name: 'Subject 404 School',
        code: 'SUB404',
      });
      const admin = await createStaffUser({
        name: 'Subject 404 Admin',
        email: 'subject.404@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      await SchoolSettings.create({
        schoolId: school._id,
        name: 'Subject 404 School',
        subjects: [],
      });

      const { app } = createTestApp();
      await request(app)
        .put('/api/settings/subjects/64a1b2c3d4e5f6a7b8c9d0e1')
        .set(authHeadersFor(admin, 'admin'))
        .send({ name: 'Ghost Subject' })
        .expect(404);
    });

    it('DELETE /api/settings/subjects/:id removes a subject', async () => {
      const school = await createSchoolRecord({
        name: 'Subject Delete School',
        code: 'SUBDEL',
      });
      const admin = await createStaffUser({
        name: 'Subject Delete Admin',
        email: 'subject.delete@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      const settings = await SchoolSettings.create({
        schoolId: school._id,
        name: 'Subject Delete School',
        subjects: [
          { name: 'Hindi', code: 'HIN' },
          { name: 'Telugu', code: 'TEL' },
        ],
      });
      const deleteId = settings.subjects[0]._id.toString();

      const { app } = createTestApp();
      const response = await request(app)
        .delete(`/api/settings/subjects/${deleteId}`)
        .set(authHeadersFor(admin, 'admin'))
        .expect(200);

      const subjects = response.body.subjects || response.body;
      expect(Array.isArray(subjects)).toBe(true);
      expect(subjects).toHaveLength(1);
      expect(subjects[0].name).toBe('Telugu');
    });
  });

  // ============================================================
  // DOCUMENT CONFIG ATOMIC SAVE
  // ============================================================

  describe('PUT /api/settings/document-config/atomic', () => {
    it('replaces all existing document configs atomically', async () => {
      const school = await createSchoolRecord({
        name: 'Doc Atomic School',
        code: 'DOCATOM',
      });
      const admin = await createStaffUser({
        name: 'Doc Atomic Admin',
        email: 'doc.atomic@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      // Seed some existing configs
      await DocumentConfig.create([
        {
          schoolId: school._id,
          documentName: 'Old Doc 1',
          isRequired: true,
          uploadType: 'single',
          allowedFormats: ['pdf'],
          maxFileSize: 5242880,
          displayOrder: 1,
          description: 'old',
        },
        {
          schoolId: school._id,
          documentName: 'Old Doc 2',
          isRequired: false,
          uploadType: 'multiple',
          allowedFormats: ['pdf'],
          maxFileSize: 5242880,
          displayOrder: 2,
          description: 'old',
        },
      ]);

      const { app } = createTestApp();
      const response = await request(app)
        .put('/api/settings/document-config/atomic')
        .set(authHeadersFor(admin, 'admin'))
        .send({
          configs: [
            {
              documentName: 'Birth Certificate',
              isRequired: true,
              uploadType: 'single',
              allowedFormats: ['pdf', 'jpg'],
              maxFileSize: 5242880,
              displayOrder: 1,
              description: 'New desc',
            },
            {
              documentName: 'Transfer Certificate',
              isRequired: false,
              uploadType: 'single',
              allowedFormats: ['pdf'],
              maxFileSize: 2097152,
              displayOrder: 2,
            },
          ],
        })
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].documentName).toBe('Birth Certificate');
      expect(response.body[1].documentName).toBe('Transfer Certificate');

      // Verify old docs are gone
      const remaining = await DocumentConfig.find({ schoolId: school._id }).lean();
      expect(remaining).toHaveLength(2);
      const names = remaining.map((r) => r.documentName);
      expect(names).not.toContain('Old Doc 1');
      expect(names).not.toContain('Old Doc 2');
    });

    it('clears all configs when sent an empty array', async () => {
      const school = await createSchoolRecord({
        name: 'Doc Clear School',
        code: 'DOCCLEAR',
      });
      const admin = await createStaffUser({
        name: 'Doc Clear Admin',
        email: 'doc.clear@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      await DocumentConfig.create({
        schoolId: school._id,
        documentName: 'To Be Deleted',
        isRequired: true,
        uploadType: 'single',
        allowedFormats: ['pdf'],
        maxFileSize: 5242880,
        displayOrder: 1,
      });

      const { app } = createTestApp();
      const response = await request(app)
        .put('/api/settings/document-config/atomic')
        .set(authHeadersFor(admin, 'admin'))
        .send({ configs: [] })
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      expect(response.body).toHaveLength(0);

      const remaining = await DocumentConfig.find({ schoolId: school._id }).lean();
      expect(remaining).toHaveLength(0);
    });

    it('returns 400 when configs is not an array', async () => {
      const school = await createSchoolRecord({
        name: 'Doc BadReq School',
        code: 'DOCBAD',
      });
      const admin = await createStaffUser({
        name: 'Doc BadReq Admin',
        email: 'doc.badreq@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      const { app } = createTestApp();
      await request(app)
        .put('/api/settings/document-config/atomic')
        .set(authHeadersFor(admin, 'admin'))
        .send({ configs: 'not-an-array' })
        .expect(400);
    });

    it('returns 400 when a config is missing documentName', async () => {
      const school = await createSchoolRecord({
        name: 'Doc MissingName School',
        code: 'DOCMISS',
      });
      const admin = await createStaffUser({
        name: 'Doc MissingName Admin',
        email: 'doc.missingname@example.com',
        schoolId: school._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      const { app } = createTestApp();
      await request(app)
        .put('/api/settings/document-config/atomic')
        .set(authHeadersFor(admin, 'admin'))
        .send({
          configs: [
            { documentName: 'Valid Doc', isRequired: true },
            { isRequired: false }, // missing documentName
          ],
        })
        .expect(400);
    });

    it('does not affect document configs of another school', async () => {
      const schoolA = await createSchoolRecord({
        name: 'Doc Atomic School A',
        code: 'DOCATA',
      });
      const schoolB = await createSchoolRecord({
        name: 'Doc Atomic School B',
        code: 'DOCATB',
      });
      const adminA = await createStaffUser({
        name: 'Doc Atomic Admin A',
        email: 'doc.atomic.a@example.com',
        schoolId: schoolA._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      await DocumentConfig.create({
        schoolId: schoolB._id,
        documentName: 'School B Doc',
        isRequired: true,
        uploadType: 'single',
        allowedFormats: ['pdf'],
        maxFileSize: 5242880,
        displayOrder: 1,
      });

      const { app } = createTestApp();
      await request(app)
        .put('/api/settings/document-config/atomic')
        .set(authHeadersFor(adminA, 'admin'))
        .send({
          configs: [{ documentName: 'School A Doc', isRequired: false }],
        })
        .expect(200);

      const schoolBDocs = await DocumentConfig.find({ schoolId: schoolB._id }).lean();
      expect(schoolBDocs).toHaveLength(1);
      expect(schoolBDocs[0].documentName).toBe('School B Doc');
    });
  });

  // ============================================================
  // MULTI-TENANCY: settings scoped by school
  // ============================================================

  describe('multi-tenancy isolation', () => {
    it('school A cannot see school B settings', async () => {
      const schoolA = await createSchoolRecord({
        name: 'Tenant School A',
        code: 'TENA',
      });
      const schoolB = await createSchoolRecord({
        name: 'Tenant School B',
        code: 'TENB',
      });

      const adminA = await createStaffUser({
        name: 'Admin A',
        email: 'tenant.a@example.com',
        schoolId: schoolA._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });
      const adminB = await createStaffUser({
        name: 'Admin B',
        email: 'tenant.b@example.com',
        schoolId: schoolB._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      // Create settings for school A with holidays
      await SchoolSettings.create({
        schoolId: schoolA._id,
        name: 'School A Settings',
        holidays: [{ name: 'School A Holiday', date: '2025-12-25', type: 'General' }],
        subjects: [{ name: 'School A Subject', code: 'SA1' }],
      });

      // Create settings for school B with different holidays
      await SchoolSettings.create({
        schoolId: schoolB._id,
        name: 'School B Settings',
        holidays: [{ name: 'School B Holiday', date: '2025-11-01', type: 'General' }],
        subjects: [{ name: 'School B Subject', code: 'SB1' }],
      });

      const { app } = createTestApp();

      // Admin A should see school A holidays
      const holidaysA = await request(app)
        .get('/api/settings/holidays')
        .set(authHeadersFor(adminA, 'admin'))
        .expect(200);

      expect(holidaysA.body).toHaveLength(1);
      expect(holidaysA.body[0].name).toBe('School A Holiday');

      // Admin B should see school B holidays
      const holidaysB = await request(app)
        .get('/api/settings/holidays')
        .set(authHeadersFor(adminB, 'admin'))
        .expect(200);

      expect(holidaysB.body).toHaveLength(1);
      expect(holidaysB.body[0].name).toBe('School B Holiday');

      // Admin A should see school A subjects
      const subjectsA = await request(app)
        .get('/api/settings/subjects')
        .set(authHeadersFor(adminA, 'admin'))
        .expect(200);

      expect(subjectsA.body).toHaveLength(1);
      expect(subjectsA.body[0].name).toBe('School A Subject');

      // Admin B should see school B subjects
      const subjectsB = await request(app)
        .get('/api/settings/subjects')
        .set(authHeadersFor(adminB, 'admin'))
        .expect(200);

      expect(subjectsB.body).toHaveLength(1);
      expect(subjectsB.body[0].name).toBe('School B Subject');
    });

    it('school A holiday mutation does not affect school B', async () => {
      const schoolA = await createSchoolRecord({
        name: 'Mutate School A',
        code: 'MUTA',
      });
      const schoolB = await createSchoolRecord({
        name: 'Mutate School B',
        code: 'MUTB',
      });

      const adminA = await createStaffUser({
        name: 'Mutate Admin A',
        email: 'mutate.a@example.com',
        schoolId: schoolA._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });
      const adminB = await createStaffUser({
        name: 'Mutate Admin B',
        email: 'mutate.b@example.com',
        schoolId: schoolB._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });

      await SchoolSettings.create({
        schoolId: schoolA._id,
        name: 'Mutate School A',
        holidays: [],
      });
      await SchoolSettings.create({
        schoolId: schoolB._id,
        name: 'Mutate School B',
        holidays: [{ name: 'B Only Holiday', date: '2025-09-05', type: 'General' }],
      });

      const { app } = createTestApp();

      // Admin A adds a holiday
      await request(app)
        .post('/api/settings/holidays')
        .set(authHeadersFor(adminA, 'admin'))
        .send({ name: 'A Only Holiday', date: '2025-10-02', type: 'National' })
        .expect(200);

      // School B should still have only its original holiday
      const holidaysB = await request(app)
        .get('/api/settings/holidays')
        .set(authHeadersFor(adminB, 'admin'))
        .expect(200);

      expect(holidaysB.body).toHaveLength(1);
      expect(holidaysB.body[0].name).toBe('B Only Holiday');
    });
  });
});
