import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  authHeadersFor,
  createStaffUser,
  createStudentRecord,
  createClassRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

// ─── Admissions ─────────────────────────────────────────────────────────────

describe('front-desk admissions routes', () => {
  describe('GET /api/front-desk/admissions', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/front-desk/admissions').expect(401);
    });

    it('returns empty array when no admissions exist', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      const res = await request(app)
        .get('/api/front-desk/admissions')
        .set(authHeadersFor(admin))
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(0);
    });

    it('returns admissions scoped to the school', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();

      await request(app)
        .post('/api/front-desk/admissions')
        .set(authHeadersFor(admin))
        .send({ studentName: 'Alice Admission', source: 'walk-in' })
        .expect(201);

      const res = await request(app)
        .get('/api/front-desk/admissions')
        .set(authHeadersFor(admin))
        .expect(200);

      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0].studentName).toBe('Alice Admission');
    });

    it('filters admissions by status query param', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();

      await request(app)
        .post('/api/front-desk/admissions')
        .set(authHeadersFor(admin))
        .send({ studentName: 'Bob Status', source: 'call' })
        .expect(201);

      const res = await request(app)
        .get('/api/front-desk/admissions')
        .query({ status: 'form-sent' })
        .set(authHeadersFor(admin))
        .expect(200);

      // No admission has status 'form-sent' yet — should be empty
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(0);
    });
  });

  describe('GET /api/front-desk/admissions (paginated)', () => {
    async function seedAdmissions(app, admin, names) {
      for (const studentName of names) {
        await request(app)
          .post('/api/front-desk/admissions')
          .set(authHeadersFor(admin))
          .send({ studentName, source: 'walk-in' })
          .expect(201);
      }
    }

    it('returns the { data, pagination, statusCounts } envelope when a page is requested', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await seedAdmissions(app, admin, ['Alice Apple', 'Bob Banana', 'Carol Cherry']);

      const res = await request(app)
        .get('/api/front-desk/admissions')
        .query({ page: 1, limit: 2 })
        .set(authHeadersFor(admin))
        .expect(200);

      expect(Array.isArray(res.body)).toBe(false);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.pagination).toMatchObject({
        currentPage: 1,
        totalItems: 3,
        totalPages: 2,
        itemsPerPage: 2,
        hasNextPage: true,
        hasPrevPage: false,
      });
      // statusCounts is the whole-school breakdown, independent of the page.
      expect(res.body.statusCounts.all).toBe(3);
      expect(res.body.statusCounts['inquiry-logged']).toBe(3);
    });

    it('walks to the last page', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await seedAdmissions(app, admin, ['Alice Apple', 'Bob Banana', 'Carol Cherry']);

      const res = await request(app)
        .get('/api/front-desk/admissions')
        .query({ page: 2, limit: 2 })
        .set(authHeadersFor(admin))
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.pagination).toMatchObject({
        currentPage: 2,
        hasNextPage: false,
        hasPrevPage: true,
      });
    });

    it('caps the page size at 100', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await seedAdmissions(app, admin, ['Solo Student']);

      const res = await request(app)
        .get('/api/front-desk/admissions')
        .query({ page: 1, limit: 5000 })
        .set(authHeadersFor(admin))
        .expect(200);

      expect(res.body.pagination.itemsPerPage).toBe(100);
    });

    it('limit=0 returns every match without a cap', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await seedAdmissions(app, admin, ['Alice Apple', 'Bob Banana', 'Carol Cherry']);

      const res = await request(app)
        .get('/api/front-desk/admissions')
        .query({ limit: 0 })
        .set(authHeadersFor(admin))
        .expect(200);

      expect(res.body.data).toHaveLength(3);
      expect(res.body.pagination).toMatchObject({
        itemsPerPage: 3,
        totalItems: 3,
        hasNextPage: false,
      });
    });

    it('filters by search across name fields without affecting statusCounts', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await seedAdmissions(app, admin, ['Alice Apple', 'Bob Banana', 'Carol Cherry']);

      const res = await request(app)
        .get('/api/front-desk/admissions')
        .query({ search: 'alice', page: 1, limit: 10 })
        .set(authHeadersFor(admin))
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].studentName).toBe('Alice Apple');
      expect(res.body.pagination.totalItems).toBe(1);
      // Grand totals stay at 3 — the stage strip ignores the active search.
      expect(res.body.statusCounts.all).toBe(3);
    });

    it('filters by coarse stage key', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await seedAdmissions(app, admin, ['Alice Apple', 'Bob Banana']);

      const inquiry = await request(app)
        .get('/api/front-desk/admissions')
        .query({ stage: 'inquiry', limit: 10 })
        .set(authHeadersFor(admin))
        .expect(200);
      expect(inquiry.body.data).toHaveLength(2);

      const admitted = await request(app)
        .get('/api/front-desk/admissions')
        .query({ stage: 'admitted', limit: 10 })
        .set(authHeadersFor(admin))
        .expect(200);
      expect(admitted.body.data).toHaveLength(0);
    });

    it('treats a crafted operator query param as a literal (no NoSQL injection)', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await seedAdmissions(app, admin, ['Alice Apple']);

      const res = await request(app)
        .get('/api/front-desk/admissions')
        .query({ 'status[$ne]': 'nope', limit: 10 })
        .set(authHeadersFor(admin))
        .expect(200);

      // Coerced to the string "[object Object]" → matches nothing, rather than
      // leaking every record via a $ne operator.
      expect(res.body.data).toHaveLength(0);
    });
  });

  describe('POST /api/front-desk/admissions', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app)
        .post('/api/front-desk/admissions')
        .send({ studentName: 'Test' })
        .expect(401);
    });

    it('creates an admission inquiry with schoolId from auth token', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();

      const res = await request(app)
        .post('/api/front-desk/admissions')
        .set(authHeadersFor(admin))
        .send({
          studentName: 'Charlie New',
          dateOfBirth: '2012-06-15',
          parentName: 'Parent Charlie',
          phoneNumber: '9876543210',
          classApplyingFor: 'Grade 5',
          source: 'website',
        })
        .expect(201);

      expect(res.body.studentName).toBe('Charlie New');
      expect(res.body.source).toBe('website');
      expect(res.body.status).toBe('inquiry-logged');
      expect(res.body.schoolId).toBeDefined();
    });
  });

  describe('PUT /api/front-desk/admissions/:id', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).put('/api/front-desk/admissions/000000000000000000000001').expect(401);
    });

    it('returns 404 for non-existent admission', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app)
        .put('/api/front-desk/admissions/000000000000000000000001')
        .set(authHeadersFor(admin))
        .send({ status: 'form-sent' })
        .expect(404);
    });

    it('updates admission status', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();

      const createRes = await request(app)
        .post('/api/front-desk/admissions')
        .set(authHeadersFor(admin))
        .send({ studentName: 'Diana Update', source: 'call' })
        .expect(201);

      const admissionId = createRes.body._id;

      const updateRes = await request(app)
        .put(`/api/front-desk/admissions/${admissionId}`)
        .set(authHeadersFor(admin))
        .send({ status: 'form-sent' })
        .expect(200);

      expect(updateRes.body.status).toBe('form-sent');
    });
  });

  describe('DELETE /api/front-desk/admissions/:id', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).delete('/api/front-desk/admissions/000000000000000000000001').expect(401);
    });

    it('deletes an admission', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();

      const createRes = await request(app)
        .post('/api/front-desk/admissions')
        .set(authHeadersFor(admin))
        .send({ studentName: 'Eve Delete', source: 'walk-in' })
        .expect(201);

      await request(app)
        .delete(`/api/front-desk/admissions/${createRes.body._id}`)
        .set(authHeadersFor(admin))
        .expect(200);

      const listRes = await request(app)
        .get('/api/front-desk/admissions')
        .set(authHeadersFor(admin))
        .expect(200);

      expect(listRes.body.find((a) => a._id === createRes.body._id)).toBeUndefined();
    });
  });

  describe('GET /api/front-desk/admissions/:id/tracker', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app)
        .get('/api/front-desk/admissions/000000000000000000000001/tracker')
        .expect(401);
    });

    it('returns 404 for non-existent admission', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app)
        .get('/api/front-desk/admissions/000000000000000000000001/tracker')
        .set(authHeadersFor(admin))
        .expect(404);
    });

    it('returns admission tracker with timeline', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();

      const createRes = await request(app)
        .post('/api/front-desk/admissions')
        .set(authHeadersFor(admin))
        .send({ studentName: 'Frank Tracker', source: 'website' })
        .expect(201);

      const trackerRes = await request(app)
        .get(`/api/front-desk/admissions/${createRes.body._id}/tracker`)
        .set(authHeadersFor(admin))
        .expect(200);

      expect(trackerRes.body.timeline).toBeDefined();
      expect(Array.isArray(trackerRes.body.timeline)).toBe(true);
      expect(trackerRes.body.currentStage).toBe('inquiry-logged');
      expect(trackerRes.body.progress).toBeGreaterThan(0);
    });
  });
});

// ─── Visitors (via front-desk) ───────────────────────────────────────────────

describe('front-desk visitors routes', () => {
  describe('GET /api/visitors', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/visitors').expect(401);
    });

    it('returns empty array when no visitors exist', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      const res = await request(app).get('/api/visitors').set(authHeadersFor(admin)).expect(200);
      const list = res.body.data || res.body;
      expect(Array.isArray(list)).toBe(true);
    });
  });

  describe('POST /api/visitors', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).post('/api/visitors').send({}).expect(401);
    });

    it('creates a visitor with required fields', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();

      const res = await request(app)
        .post('/api/visitors')
        .set(authHeadersFor(admin))
        .send({
          name: 'Grace Visitor',
          phone: '9123456789',
          purpose: 'PARENT_MEETING',
          whomToMeet: 'Principal',
        })
        .expect(201);

      const visitor = res.body.data || res.body.visitor || res.body;
      expect(visitor.name).toBe('Grace Visitor');
      expect(visitor.schoolId).toBeDefined();
    });
  });

  describe('PUT /api/visitors/:id', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).put('/api/visitors/000000000000000000000001').expect(401);
    });

    it('returns 404 for non-existent visitor', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app)
        .put('/api/visitors/000000000000000000000001')
        .set(authHeadersFor(admin))
        .send({ notes: 'update' })
        .expect(404);
    });

    it('updates visitor notes', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();

      const createRes = await request(app)
        .post('/api/visitors')
        .set(authHeadersFor(admin))
        .send({
          name: 'Hank Visitor',
          phone: '9000000001',
          purpose: 'DELIVERY_VENDOR',
        })
        .expect(201);

      const visitor = createRes.body.data || createRes.body.visitor || createRes.body;
      const updateRes = await request(app)
        .put(`/api/visitors/${visitor._id}`)
        .set(authHeadersFor(admin))
        .send({ notes: 'Delivery completed' })
        .expect(200);

      const updated = updateRes.body.data || updateRes.body.visitor || updateRes.body;
      expect(updated.notes).toBe('Delivery completed');
    });
  });

  describe('DELETE /api/visitors/:id', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).delete('/api/visitors/000000000000000000000001').expect(401);
    });

    it('deletes a visitor', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();

      const createRes = await request(app)
        .post('/api/visitors')
        .set(authHeadersFor(admin))
        .send({
          name: 'Iris Visitor',
          phone: '9000000002',
          purpose: 'OTHER',
        })
        .expect(201);

      const visitor = createRes.body.data || createRes.body.visitor || createRes.body;
      const deleteRes = await request(app)
        .delete(`/api/visitors/${visitor._id}`)
        .set(authHeadersFor(admin))
        .expect(200);

      expect(deleteRes.body.success).toBe(true);
    });
  });
});

// ─── Gate Passes (via front-desk) ───────────────────────────────────────────

describe('front-desk gate-passes routes', () => {
  describe('GET /api/gate-passes', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/gate-passes').expect(401);
    });

    it('returns empty array when no gate passes exist', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      const res = await request(app).get('/api/gate-passes').set(authHeadersFor(admin)).expect(200);
      const list = res.body.data || res.body;
      expect(Array.isArray(list)).toBe(true);
    });
  });

  describe('POST /api/gate-passes', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).post('/api/gate-passes').send({}).expect(401);
    });

    it('returns 400 when required fields are missing', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();

      const res = await request(app)
        .post('/api/gate-passes')
        .set(authHeadersFor(admin))
        .send({ studentName: 'No StudentId' })
        .expect(400);

      expect(res.body.error || res.body.message).toMatch(/validation/i);
    });

    it('creates a gate pass with valid payload via /api/gate-passes', async () => {
      // The old duplicate route at /api/front-desk/gate-passes defaulted status to
      // an invalid value ('PENDING'); it has since been removed in favour of the
      // single `/api/gate-passes` router with proper Zod validation + default.
      const admin = await createStaffUser();
      const classRecord = await createClassRecord({ name: 'Grade 6', section: 'A' });
      const student = await createStudentRecord({ name: 'Jake Student', classId: classRecord._id });
      const { app } = createTestApp();

      const res = await request(app)
        .post('/api/gate-passes')
        .set(authHeadersFor(admin))
        .send({
          studentId: student._id.toString(),
          reason: 'MEDICAL_EMERGENCY',
          leavingDate: new Date().toISOString(),
          leavingTime: '10:00',
          leavingWith: 'PARENTS',
          parentType: 'FATHER',
          approvedBy: 'FRONT_OFFICE',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
    });
  });

  describe('PUT /api/gate-passes/:id', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).put('/api/gate-passes/000000000000000000000001').expect(401);
    });

    it('returns 404 for non-existent gate pass', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app)
        .put('/api/gate-passes/000000000000000000000001')
        .set(authHeadersFor(admin))
        .send({ notes: 'test' })
        .expect(404);
    });
  });

  describe('DELETE /api/gate-passes/:id', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).delete('/api/gate-passes/000000000000000000000001').expect(401);
    });

    it('returns 404 when deleting a non-existent gate pass', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();

      const deleteRes = await request(app)
        .delete('/api/gate-passes/000000000000000000000099')
        .set(authHeadersFor(admin))
        .expect(404);

      expect(deleteRes.body.success).toBe(false);
    });
  });
});

// ─── Appointments ────────────────────────────────────────────────────────────

describe('front-desk appointments routes', () => {
  describe('GET /api/front-desk/appointments', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/front-desk/appointments').expect(401);
    });

    it('returns empty array when no appointments exist', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      const res = await request(app)
        .get('/api/front-desk/appointments')
        .set(authHeadersFor(admin))
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('POST /api/front-desk/appointments', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).post('/api/front-desk/appointments').send({}).expect(401);
    });

    it('creates an appointment with schoolId', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();

      const res = await request(app)
        .post('/api/front-desk/appointments')
        .set(authHeadersFor(admin))
        .send({
          visitorName: 'Leo Visitor',
          phoneNumber: '9111111111',
          purpose: 'Meeting with teacher',
          fromDateTime: new Date('2026-04-01T10:00:00').toISOString(),
          toDateTime: new Date('2026-04-01T11:00:00').toISOString(),
          meetingWith: 'Class Teacher',
        })
        .expect(201);

      expect(res.body.visitorName).toBe('Leo Visitor');
      expect(res.body.schoolId).toBeDefined();
    });
  });

  describe('PUT /api/front-desk/appointments/:id', () => {
    it('returns 404 for non-existent appointment', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app)
        .put('/api/front-desk/appointments/000000000000000000000001')
        .set(authHeadersFor(admin))
        .send({ status: 'completed' })
        .expect(404);
    });

    it('updates appointment status', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();

      const createRes = await request(app)
        .post('/api/front-desk/appointments')
        .set(authHeadersFor(admin))
        .send({
          visitorName: 'Mia Appointment',
          fromDateTime: new Date('2026-04-02T09:00:00').toISOString(),
          toDateTime: new Date('2026-04-02T10:00:00').toISOString(),
        })
        .expect(201);

      const updateRes = await request(app)
        .put(`/api/front-desk/appointments/${createRes.body._id}`)
        .set(authHeadersFor(admin))
        .send({ status: 'completed' })
        .expect(200);

      expect(updateRes.body.status).toBe('completed');
    });
  });

  describe('DELETE /api/front-desk/appointments/:id', () => {
    it('deletes an appointment', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();

      const createRes = await request(app)
        .post('/api/front-desk/appointments')
        .set(authHeadersFor(admin))
        .send({
          visitorName: 'Ned Delete',
          fromDateTime: new Date('2026-04-03T10:00:00').toISOString(),
          toDateTime: new Date('2026-04-03T11:00:00').toISOString(),
        })
        .expect(201);

      const deleteRes = await request(app)
        .delete(`/api/front-desk/appointments/${createRes.body._id}`)
        .set(authHeadersFor(admin))
        .expect(200);

      expect(deleteRes.body.success).toBe(true);
    });
  });
});

// ─── Call Logs ───────────────────────────────────────────────────────────────

describe('front-desk call-logs routes', () => {
  describe('GET /api/front-desk/call-logs', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/front-desk/call-logs').expect(401);
    });

    it('returns empty array when no call logs exist', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      const res = await request(app)
        .get('/api/front-desk/call-logs')
        .set(authHeadersFor(admin))
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('POST /api/front-desk/call-logs', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).post('/api/front-desk/call-logs').send({}).expect(401);
    });

    it('creates a call log and sets loggedBy from auth token', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();

      const res = await request(app)
        .post('/api/front-desk/call-logs')
        .set(authHeadersFor(admin))
        .send({
          callerName: 'Oscar Caller',
          phoneNumber: '9222222222',
          dateTime: new Date().toISOString(),
          purpose: 'Fee enquiry',
          intent: 'inquiry',
          summary: 'Asked about fee structure',
        })
        .expect(201);

      expect(res.body.callerName).toBe('Oscar Caller');
      expect(res.body.loggedBy.toString()).toBe(admin._id.toString());
    });
  });

  describe('PUT /api/front-desk/call-logs/:id', () => {
    it('returns 404 for non-existent call log', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app)
        .put('/api/front-desk/call-logs/000000000000000000000001')
        .set(authHeadersFor(admin))
        .send({ summary: 'updated' })
        .expect(404);
    });

    it('updates call log summary', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();

      const createRes = await request(app)
        .post('/api/front-desk/call-logs')
        .set(authHeadersFor(admin))
        .send({
          callerName: 'Paula Log',
          phoneNumber: '9333333333',
          dateTime: new Date().toISOString(),
          purpose: 'Admission enquiry',
        })
        .expect(201);

      const updateRes = await request(app)
        .put(`/api/front-desk/call-logs/${createRes.body._id}`)
        .set(authHeadersFor(admin))
        .send({ summary: 'Updated summary' })
        .expect(200);

      expect(updateRes.body.summary).toBe('Updated summary');
    });
  });

  describe('DELETE /api/front-desk/call-logs/:id', () => {
    it('deletes a call log', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();

      const createRes = await request(app)
        .post('/api/front-desk/call-logs')
        .set(authHeadersFor(admin))
        .send({
          callerName: 'Quinn Delete',
          phoneNumber: '9444444444',
          dateTime: new Date().toISOString(),
        })
        .expect(201);

      const deleteRes = await request(app)
        .delete(`/api/front-desk/call-logs/${createRes.body._id}`)
        .set(authHeadersFor(admin))
        .expect(200);

      expect(deleteRes.body.success).toBe(true);
    });
  });
});

// ─── Feedbacks ───────────────────────────────────────────────────────────────

describe('front-desk feedbacks routes', () => {
  describe('GET /api/front-desk/feedbacks', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/front-desk/feedbacks').expect(401);
    });

    it('returns empty array when no feedbacks exist', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      const res = await request(app)
        .get('/api/front-desk/feedbacks')
        .set(authHeadersFor(admin))
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('POST /api/front-desk/feedbacks', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = createTestApp();
      await request(app).post('/api/front-desk/feedbacks').send({}).expect(401);
    });

    it('creates a feedback record', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();

      const res = await request(app)
        .post('/api/front-desk/feedbacks')
        .set(authHeadersFor(admin))
        .send({
          name: 'Rita Feedback',
          phoneNumber: '9555555555',
          category: 'COMPLAINT',
          notes: 'Noise during exam',
        })
        .expect(201);

      expect(res.body.name).toBe('Rita Feedback');
      expect(res.body.category).toBe('COMPLAINT');
    });
  });

  describe('PUT /api/front-desk/feedbacks/:id', () => {
    it('returns 404 for non-existent feedback', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();
      await request(app)
        .put('/api/front-desk/feedbacks/000000000000000000000001')
        .set(authHeadersFor(admin))
        .send({ status: 'resolved' })
        .expect(404);
    });

    it('updates feedback status', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();

      const createRes = await request(app)
        .post('/api/front-desk/feedbacks')
        .set(authHeadersFor(admin))
        .send({ name: 'Sam Status', phoneNumber: '9666666666', category: 'SUGGESTION' })
        .expect(201);

      const updateRes = await request(app)
        .put(`/api/front-desk/feedbacks/${createRes.body._id}`)
        .set(authHeadersFor(admin))
        .send({ status: 'resolved' })
        .expect(200);

      expect(updateRes.body.status).toBe('resolved');
    });
  });

  describe('DELETE /api/front-desk/feedbacks/:id', () => {
    it('deletes a feedback', async () => {
      const admin = await createStaffUser();
      const { app } = createTestApp();

      const createRes = await request(app)
        .post('/api/front-desk/feedbacks')
        .set(authHeadersFor(admin))
        .send({ name: 'Tina Delete', phoneNumber: '9777777777', category: 'OTHER' })
        .expect(201);

      const deleteRes = await request(app)
        .delete(`/api/front-desk/feedbacks/${createRes.body._id}`)
        .set(authHeadersFor(admin))
        .expect(200);

      expect(deleteRes.body.success).toBe(true);
    });
  });
});
