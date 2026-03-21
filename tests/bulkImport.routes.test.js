import request from 'supertest';
import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Student } from '../database.js';
import ImportJob from '../models/ImportJob.js';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const BASE = '/api/bulk-import';

// Build a CSV buffer from an array of row objects.
// Headers are camelCase (ExcelJS will lowercase them during parsing).
function makeCsvBuffer(rows) {
  const headers = 'name,admissionId,academicYear,className,section,rollNo,parentName,parentPhone';
  const lines = [
    headers,
    ...rows.map((r) =>
      [
        r.name ?? '',
        r.admissionId ?? '',
        r.academicYear ?? '2025-26',
        r.className ?? '10',
        r.section ?? 'A',
        r.rollNo ?? '',
        r.parentName ?? '',
        r.parentPhone ?? '',
      ].join(',')
    ),
  ];
  return Buffer.from(lines.join('\n'));
}

describe('bulk import routes', () => {
  let app, school, admin, headers, classRecord;

  beforeEach(async () => {
    school = await createSchoolRecord({ name: 'Bulk Import School', code: 'BLK' });
    admin = await createStaffUser({
      name: 'Bulk Admin',
      email: 'bulk.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    headers = authHeadersFor(admin, 'admin');
    classRecord = await createClassRecord({
      name: 'Class 10',
      section: 'A',
      schoolId: school._id,
    });
    ({ app } = createTestApp());
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  describe('authentication', () => {
    it('returns 401 without auth token', async () => {
      await request(app).post(`${BASE}/students`).expect(401);
    });
  });

  // ── POST /bulk-import/students ────────────────────────────────────────────

  describe('POST /bulk-import/students', () => {
    it('returns 400 when no file is attached', async () => {
      const res = await request(app).post(`${BASE}/students`).set(headers).expect(400);

      expect(res.body.error).toMatch(/no file/i);
    });

    it('returns 400 for an empty file (header-only CSV)', async () => {
      const csv = Buffer.from('name,admissionId,academicYear,className,section,parentName\n');

      const res = await request(app)
        .post(`${BASE}/students`)
        .set(headers)
        .attach('file', csv, { filename: 'empty.csv', contentType: 'text/csv' })
        .expect(400);

      expect(res.body.error).toMatch(/empty/i);
    });

    it('imports valid students, persists them, and creates a completed import job', async () => {
      const csv = makeCsvBuffer([
        {
          name: 'John Doe',
          admissionId: 'ADM001',
          className: '10',
          section: 'A',
          rollNo: 1,
          parentName: 'Jane Doe',
          parentPhone: '9876543210',
        },
        {
          name: 'Jane Smith',
          admissionId: 'ADM002',
          className: '10',
          section: 'A',
          rollNo: 2,
          parentName: 'Bob Smith',
          parentPhone: '9876543211',
        },
      ]);

      const res = await request(app)
        .post(`${BASE}/students`)
        .set(headers)
        .attach('file', csv, { filename: 'students.csv', contentType: 'text/csv' })
        .expect(200);

      expect(res.body.imported).toBe(2);
      expect(res.body.failed).toHaveLength(0);
      expect(res.body.skipped).toBe(0);
      expect(res.body.dryRun).toBe(false);

      // Students persisted with correct schoolId
      const count = await Student.countDocuments({
        schoolId: school._id,
        isDeleted: { $ne: true },
      });
      expect(count).toBe(2);

      // Import job created and finalised
      const job = await ImportJob.findOne({ schoolId: school._id, type: 'students' }).lean();
      expect(job).not.toBeNull();
      expect(job.status).toBe('completed');
      expect(job.importedCount).toBe(2);
      expect(job.failedCount).toBe(0);
      expect(job.createdIds).toHaveLength(2);
    });

    it('rejects rows that fail Zod validation and reports structured errors', async () => {
      // CSV with no name column and no parentName column — both are required by the schema
      const csv = Buffer.from('admissionId,academicYear,className,section\nADM003,2025-26,10,A');

      const res = await request(app)
        .post(`${BASE}/students`)
        .set(headers)
        .attach('file', csv, { filename: 'bad.csv', contentType: 'text/csv' })
        .expect(200);

      expect(res.body.failed).toHaveLength(1);
      expect(res.body.imported).toBe(0);
      expect(res.body.failed[0].row).toBe(2);
      expect(res.body.failed[0].error).toBeTruthy();
    });

    it('handles a mixed batch: valid rows imported, invalid rows reported', async () => {
      // Row 1: valid; Row 2: missing name and parentName → Zod error
      const csv = Buffer.from(
        [
          'name,admissionId,academicYear,className,section,rollNo,parentName,parentPhone',
          'Alice Green,ADM004,2025-26,10,A,4,Carol Green,9876543212',
          ',ADM005,2025-26,10,A,5,,',
        ].join('\n')
      );

      const res = await request(app)
        .post(`${BASE}/students`)
        .set(headers)
        .attach('file', csv, { filename: 'mixed.csv', contentType: 'text/csv' })
        .expect(200);

      expect(res.body.imported).toBe(1);
      expect(res.body.failed).toHaveLength(1);
      expect(res.body.failed[0].admissionId).toBe('ADM005');

      const count = await Student.countDocuments({ schoolId: school._id });
      expect(count).toBe(1);
    });

    it('rejects a row when the class does not exist for the school', async () => {
      const csv = makeCsvBuffer([
        {
          name: 'Bob Jones',
          admissionId: 'ADM006',
          className: '99',
          section: 'Z',
          rollNo: 6,
          parentName: 'Parent',
          parentPhone: '9876543213',
        },
      ]);

      const res = await request(app)
        .post(`${BASE}/students`)
        .set(headers)
        .attach('file', csv, { filename: 'noclass.csv', contentType: 'text/csv' })
        .expect(200);

      expect(res.body.failed).toHaveLength(1);
      expect(res.body.failed[0].error).toMatch(/not found/i);
    });

    it('rejects a duplicate admissionId with a descriptive error', async () => {
      await createStudentRecord({
        name: 'Existing Student',
        admissionId: 'ADM007',
        schoolId: school._id,
        classId: classRecord._id,
      });

      const csv = makeCsvBuffer([
        {
          name: 'Duplicate Student',
          admissionId: 'ADM007',
          className: '10',
          section: 'A',
          rollNo: 7,
          parentName: 'Parent',
          parentPhone: '9876543214',
        },
      ]);

      const res = await request(app)
        .post(`${BASE}/students`)
        .set(headers)
        .attach('file', csv, { filename: 'dup.csv', contentType: 'text/csv' })
        .expect(200);

      expect(res.body.failed).toHaveLength(1);
      expect(res.body.failed[0].error).toMatch(/already exists/i);
    });

    it('dry run: reports would-be imports without persisting students or creating a job', async () => {
      const csv = makeCsvBuffer([
        {
          name: 'Ghost Student',
          admissionId: 'ADM008',
          className: '10',
          section: 'A',
          rollNo: 8,
          parentName: 'Ghost Parent',
          parentPhone: '9876543215',
        },
      ]);

      const res = await request(app)
        .post(`${BASE}/students?dryRun=true`)
        .set(headers)
        .attach('file', csv, { filename: 'dryrun.csv', contentType: 'text/csv' })
        .expect(200);

      expect(res.body.dryRun).toBe(true);
      expect(res.body.imported).toBe(1);
      expect(res.body.failed).toHaveLength(0);

      // No students persisted
      const count = await Student.countDocuments({ schoolId: school._id });
      expect(count).toBe(0);

      // No import job created for dry runs
      const job = await ImportJob.findOne({ schoolId: school._id });
      expect(job).toBeNull();
    });
  });

  // ── POST /bulk-import/history/:jobId/rollback ─────────────────────────────

  describe('POST /bulk-import/history/:jobId/rollback', () => {
    it('rolls back a completed import: hard-deletes created students and marks job as rolled_back', async () => {
      const csv = makeCsvBuffer([
        {
          name: 'Rollback Student',
          admissionId: 'ADM009',
          className: '10',
          section: 'A',
          rollNo: 9,
          parentName: 'Parent',
          parentPhone: '9876543216',
        },
      ]);

      await request(app)
        .post(`${BASE}/students`)
        .set(headers)
        .attach('file', csv, { filename: 'rb.csv', contentType: 'text/csv' })
        .expect(200);

      const job = await ImportJob.findOne({ schoolId: school._id, type: 'students' });
      expect(job).not.toBeNull();
      expect(job.createdIds).toHaveLength(1);

      const res = await request(app)
        .post(`${BASE}/history/${job._id}/rollback`)
        .set(headers)
        .expect(200);

      expect(res.body.deletedCount).toBe(1);
      expect(res.body.message).toMatch(/rollback complete/i);

      // Job status updated
      const updated = await ImportJob.findById(job._id);
      expect(updated.status).toBe('rolled_back');

      // Students removed from DB
      const studentCount = await Student.countDocuments({ schoolId: school._id });
      expect(studentCount).toBe(0);
    });

    it('returns 404 for an unknown jobId', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      await request(app).post(`${BASE}/history/${fakeId}/rollback`).set(headers).expect(404);
    });

    it('returns 400 when rolling back a dry-run job', async () => {
      const dryJob = await ImportJob.create({
        schoolId: school._id,
        type: 'students',
        status: 'completed',
        dryRun: true,
        totalRows: 1,
        importedCount: 1,
        createdIds: [],
      });

      const res = await request(app)
        .post(`${BASE}/history/${dryJob._id}/rollback`)
        .set(headers)
        .expect(400);

      expect(res.body.error).toMatch(/dry.run/i);
    });

    it('returns 400 when job is not completed (e.g. still running)', async () => {
      const runningJob = await ImportJob.create({
        schoolId: school._id,
        type: 'students',
        status: 'running',
        dryRun: false,
        totalRows: 5,
      });

      const res = await request(app)
        .post(`${BASE}/history/${runningJob._id}/rollback`)
        .set(headers)
        .expect(400);

      expect(res.body.error).toMatch(/completed/i);
    });

    it('returns 400 when the job has no createdIds to roll back', async () => {
      const emptyJob = await ImportJob.create({
        schoolId: school._id,
        type: 'students',
        status: 'completed',
        dryRun: false,
        totalRows: 0,
        importedCount: 0,
        createdIds: [],
      });

      const res = await request(app)
        .post(`${BASE}/history/${emptyJob._id}/rollback`)
        .set(headers)
        .expect(400);

      expect(res.body.error).toMatch(/no rollback data/i);
    });

    it('returns 404 for a job belonging to a different school (school isolation)', async () => {
      const otherSchool = await createSchoolRecord({ name: 'Other School', code: 'OTH2' });
      const otherStudent = await createStudentRecord({
        name: 'Other Student',
        admissionId: 'ADM099',
        schoolId: otherSchool._id,
        classId: classRecord._id,
      });

      const otherJob = await ImportJob.create({
        schoolId: otherSchool._id,
        type: 'students',
        status: 'completed',
        dryRun: false,
        totalRows: 1,
        importedCount: 1,
        createdIds: [otherStudent._id],
      });

      // Admin from school A cannot access a job from school B
      await request(app).post(`${BASE}/history/${otherJob._id}/rollback`).set(headers).expect(404);

      // Other school's student untouched
      const count = await Student.countDocuments({ schoolId: otherSchool._id });
      expect(count).toBe(1);
    });
  });

  // ── GET /bulk-import/history ──────────────────────────────────────────────

  describe('GET /bulk-import/history', () => {
    it('returns import job history scoped to the authenticated school', async () => {
      await ImportJob.create({
        schoolId: school._id,
        type: 'students',
        status: 'completed',
        dryRun: false,
        totalRows: 3,
        importedCount: 3,
      });

      const res = await request(app).get(`${BASE}/history`).set(headers).expect(200);

      expect(res.body.jobs).toHaveLength(1);
      expect(res.body.total).toBe(1);
    });

    it('does not return jobs from other schools', async () => {
      const otherSchool = await createSchoolRecord({ name: 'Hidden School', code: 'HDN' });
      await ImportJob.create({
        schoolId: otherSchool._id,
        type: 'students',
        status: 'completed',
        dryRun: false,
        totalRows: 1,
      });

      const res = await request(app).get(`${BASE}/history`).set(headers).expect(200);

      expect(res.body.jobs).toHaveLength(0);
    });

    it('returns 401 without auth token', async () => {
      await request(app).get(`${BASE}/history`).expect(401);
    });
  });

  // ── GET /bulk-import/history/:jobId ──────────────────────────────────────

  describe('GET /bulk-import/history/:jobId', () => {
    it('retrieves a specific import job by id', async () => {
      const job = await ImportJob.create({
        schoolId: school._id,
        type: 'students',
        status: 'completed',
        dryRun: false,
        totalRows: 2,
        importedCount: 2,
      });

      const res = await request(app).get(`${BASE}/history/${job._id}`).set(headers).expect(200);

      expect(res.body.job._id.toString()).toBe(job._id.toString());
      expect(res.body.job.importedCount).toBe(2);
    });

    it('returns 404 for a job from another school', async () => {
      const otherSchool = await createSchoolRecord({ name: 'Another School', code: 'ANO2' });
      const otherJob = await ImportJob.create({
        schoolId: otherSchool._id,
        type: 'students',
        status: 'completed',
        dryRun: false,
        totalRows: 1,
      });

      await request(app).get(`${BASE}/history/${otherJob._id}`).set(headers).expect(404);
    });
  });

  // ── GET /bulk-import/template/:type ─────────────────────────────────────

  describe('GET /bulk-import/template/:type', () => {
    it('returns a CSV template for students', async () => {
      const res = await request(app).get(`${BASE}/template/students`).set(headers).expect(200);

      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.text).toContain('name');
      expect(res.text).toContain('admissionId');
    });

    it('returns 400 for an unknown template type', async () => {
      const res = await request(app).get(`${BASE}/template/unknown`).set(headers).expect(400);

      expect(res.body.error).toMatch(/invalid template type/i);
    });
  });
});
