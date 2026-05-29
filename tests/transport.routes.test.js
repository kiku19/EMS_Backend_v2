import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import Vehicle from '../models/Vehicle.js';
import TransportRoute from '../models/TransportRoute.js';
import {
  authHeadersFor,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
  createClassRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

vi.mock('../services/trashService.js', () => ({
  logToTrash: vi.fn().mockResolvedValue(undefined),
}));

let seq = 0;
function nextSeq() {
  return ++seq;
}

async function setup() {
  const school = await createSchoolRecord({
    name: `Transport School ${nextSeq()}`,
    code: `TR-${nextSeq()}`,
  });
  const admin = await createStaffUser({ schoolId: school._id });
  const { app } = createTestApp();
  const headers = authHeadersFor(admin, 'admin');
  return { school, admin, app, headers };
}

function buildVehiclePayload(overrides = {}) {
  return {
    registrationNumber: `REG-${nextSeq()}`,
    make: 'Toyota',
    model: 'Hiace',
    year: 2020,
    capacity: 30,
    color: 'White',
    status: 'active',
    ...overrides,
  };
}

function buildRoutePayload(overrides = {}) {
  return {
    routeName: 'Route A',
    routeNumber: `R-${nextSeq()}`,
    academicYear: '2025-26',
    stops: [{ name: 'Stop 1', order: 0 }],
    ...overrides,
  };
}

async function createVehicleDirect(schoolId, overrides = {}) {
  return Vehicle.create({
    schoolId,
    registrationNumber: `REG-${nextSeq()}`,
    make: 'Toyota',
    model: 'Hiace',
    capacity: 30,
    ...overrides,
  });
}

async function createRouteDirect(schoolId, overrides = {}) {
  return TransportRoute.create({
    schoolId,
    routeName: 'Route Direct',
    routeNumber: `RD-${nextSeq()}`,
    academicYear: '2025-26',
    students: [],
    ...overrides,
  });
}

describe('transport routes', () => {
  // ─── Auth ──────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('returns 401 when no auth token is provided', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/transport/vehicles').expect(401);
      await request(app).post('/api/transport/vehicles').send(buildVehiclePayload()).expect(401);
      await request(app).get('/api/transport/routes').expect(401);
    });
  });

  // ─── Vehicle Routes ────────────────────────────────────────────────────
  describe('GET /api/transport/vehicles', () => {
    it('returns all vehicles for the school', async () => {
      const { school, app, headers } = await setup();
      await createVehicleDirect(school._id, { registrationNumber: 'V1' });
      await createVehicleDirect(school._id, { registrationNumber: 'V2' });

      const res = await request(app).get('/api/transport/vehicles').set(headers).expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(2);
    });

    it('filters vehicles by status', async () => {
      const { school, app, headers } = await setup();
      await createVehicleDirect(school._id, { registrationNumber: 'VA', status: 'active' });
      await createVehicleDirect(school._id, { registrationNumber: 'VM', status: 'maintenance' });

      const res = await request(app)
        .get('/api/transport/vehicles')
        .query({ status: 'maintenance' })
        .set(headers)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].status).toBe('maintenance');
    });
  });

  describe('POST /api/transport/vehicles', () => {
    it('creates a new vehicle', async () => {
      const { school, app, headers } = await setup();
      const payload = buildVehiclePayload();

      const res = await request(app)
        .post('/api/transport/vehicles')
        .set(headers)
        .send(payload)
        .expect(201);

      expect(res.body.data.registrationNumber).toBe(payload.registrationNumber);
      expect(res.body.data.schoolId.toString()).toBe(school._id.toString());
    });

    it('returns 409 for duplicate registration number', async () => {
      const { school, app, headers } = await setup();
      const payload = buildVehiclePayload();
      await createVehicleDirect(school._id, { registrationNumber: payload.registrationNumber });

      const res = await request(app)
        .post('/api/transport/vehicles')
        .set(headers)
        .send(payload)
        .expect(409);

      expect(res.body.error).toBeTruthy();
    });

    it('returns 400 for invalid driverId', async () => {
      const { app, headers } = await setup();
      const payload = buildVehiclePayload({ driverId: 'invalid-id' });

      const res = await request(app)
        .post('/api/transport/vehicles')
        .set(headers)
        .send(payload)
        .expect(400);

      expect(res.body.error).toBeTruthy();
    });
  });

  describe('GET /api/transport/vehicles/:id', () => {
    it('returns a vehicle by id', async () => {
      const { school, app, headers } = await setup();
      const vehicle = await createVehicleDirect(school._id, { registrationNumber: 'VGET' });

      const res = await request(app)
        .get(`/api/transport/vehicles/${vehicle._id}`)
        .set(headers)
        .expect(200);

      expect(res.body.data.registrationNumber).toBe('VGET');
    });

    it('returns 404 for non-existent vehicle', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).get(`/api/transport/vehicles/${fakeId}`).set(headers).expect(404);
    });
  });

  describe('PUT /api/transport/vehicles/:id', () => {
    it('updates a vehicle', async () => {
      const { school, app, headers } = await setup();
      const vehicle = await createVehicleDirect(school._id);

      const res = await request(app)
        .put(`/api/transport/vehicles/${vehicle._id}`)
        .set(headers)
        .send({ color: 'Red' })
        .expect(200);

      expect(res.body.data.color).toBe('Red');
    });

    it('returns 409 for duplicate registration number on update', async () => {
      const { school, app, headers } = await setup();
      const v1 = await createVehicleDirect(school._id, { registrationNumber: 'DUP1' });
      await createVehicleDirect(school._id, { registrationNumber: 'DUP2' });

      const res = await request(app)
        .put(`/api/transport/vehicles/${v1._id}`)
        .set(headers)
        .send({ registrationNumber: 'DUP2' })
        .expect(409);

      expect(res.body.error).toBeTruthy();
    });

    it('returns 404 for non-existent vehicle', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app)
        .put(`/api/transport/vehicles/${fakeId}`)
        .set(headers)
        .send({ color: 'Red' })
        .expect(404);
    });
  });

  describe('DELETE /api/transport/vehicles/:id', () => {
    it('soft-deletes a vehicle', async () => {
      const { school, app, headers } = await setup();
      const vehicle = await createVehicleDirect(school._id);

      const res = await request(app)
        .delete(`/api/transport/vehicles/${vehicle._id}`)
        .set(headers)
        .expect(200);

      expect(res.body.message).toBeTruthy();
      const deleted = await Vehicle.findById(vehicle._id);
      expect(deleted.isDeleted).toBe(true);
    });

    it('returns 404 for non-existent vehicle', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).delete(`/api/transport/vehicles/${fakeId}`).set(headers).expect(404);
    });
  });

  describe('PATCH /api/transport/vehicles/:id/gps', () => {
    it('updates GPS location', async () => {
      const { school, app, headers } = await setup();
      const vehicle = await createVehicleDirect(school._id);

      const res = await request(app)
        .patch(`/api/transport/vehicles/${vehicle._id}/gps`)
        .set(headers)
        .send({ lat: 12.34, lng: 56.78 })
        .expect(200);

      expect(res.body.data.lastLocation).toMatchObject({ lat: 12.34, lng: 56.78 });
    });

    it('returns 400 when lat/lng are missing', async () => {
      const { school, app, headers } = await setup();
      const vehicle = await createVehicleDirect(school._id);

      const res = await request(app)
        .patch(`/api/transport/vehicles/${vehicle._id}/gps`)
        .set(headers)
        .send({})
        .expect(400);

      expect(res.body.error).toBeTruthy();
    });
  });

  // ─── Route Routes ──────────────────────────────────────────────────────
  describe('GET /api/transport/routes', () => {
    it('returns all transport routes', async () => {
      const { school, app, headers } = await setup();
      await createRouteDirect(school._id, { routeNumber: 'R1' });
      await createRouteDirect(school._id, { routeNumber: 'R2' });

      const res = await request(app).get('/api/transport/routes').set(headers).expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(2);
    });

    it('filters routes by academicYear', async () => {
      const { school, app, headers } = await setup();
      await createRouteDirect(school._id, { routeNumber: 'RY1', academicYear: '2024-25' });
      await createRouteDirect(school._id, { routeNumber: 'RY2', academicYear: '2025-26' });

      const res = await request(app)
        .get('/api/transport/routes')
        .query({ academicYear: '2025-26' })
        .set(headers)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].academicYear).toBe('2025-26');
    });
  });

  describe('POST /api/transport/routes', () => {
    it('creates a new route', async () => {
      const { school, app, headers } = await setup();
      const payload = buildRoutePayload();

      const res = await request(app)
        .post('/api/transport/routes')
        .set(headers)
        .send(payload)
        .expect(201);

      expect(res.body.data.routeName).toBe(payload.routeName);
    });

    it('returns 409 for duplicate routeNumber + academicYear', async () => {
      const { school, app, headers } = await setup();
      const payload = buildRoutePayload({ routeNumber: 'DUP-R' });
      await createRouteDirect(school._id, { routeNumber: 'DUP-R', academicYear: '2025-26' });

      const res = await request(app)
        .post('/api/transport/routes')
        .set(headers)
        .send(payload)
        .expect(409);

      expect(res.body.error).toBeTruthy();
    });
  });

  describe('GET /api/transport/routes/:id', () => {
    it('returns a route by id', async () => {
      const { school, app, headers } = await setup();
      const route = await createRouteDirect(school._id, { routeName: 'Route GET' });

      const res = await request(app)
        .get(`/api/transport/routes/${route._id}`)
        .set(headers)
        .expect(200);

      expect(res.body.data.routeName).toBe('Route GET');
    });

    it('returns 404 for non-existent route', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).get(`/api/transport/routes/${fakeId}`).set(headers).expect(404);
    });
  });

  describe('PUT /api/transport/routes/:id', () => {
    it('updates a route', async () => {
      const { school, app, headers } = await setup();
      const route = await createRouteDirect(school._id);

      const res = await request(app)
        .put(`/api/transport/routes/${route._id}`)
        .set(headers)
        .send({ routeName: 'Updated Route' })
        .expect(200);

      expect(res.body.data.routeName).toBe('Updated Route');
    });

    it('returns 404 for non-existent route', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app)
        .put(`/api/transport/routes/${fakeId}`)
        .set(headers)
        .send({ routeName: 'X' })
        .expect(404);
    });
  });

  describe('DELETE /api/transport/routes/:id', () => {
    it('soft-deletes a route', async () => {
      const { school, app, headers } = await setup();
      const route = await createRouteDirect(school._id);

      const res = await request(app)
        .delete(`/api/transport/routes/${route._id}`)
        .set(headers)
        .expect(200);

      expect(res.body.message).toBeTruthy();
      const deleted = await TransportRoute.findById(route._id);
      expect(deleted.isDeleted).toBe(true);
    });

    it('returns 404 for non-existent route', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).delete(`/api/transport/routes/${fakeId}`).set(headers).expect(404);
    });
  });

  // ─── Student Assignment Routes ─────────────────────────────────────────
  describe('POST /api/transport/routes/:id/students', () => {
    it('assigns a student to a route', async () => {
      const { school, app, headers } = await setup();
      const classRecord = await createClassRecord({ schoolId: school._id });
      const route = await createRouteDirect(school._id);
      const student = await createStudentRecord({
        schoolId: school._id,
        classId: classRecord._id,
        name: 'Student A',
      });

      const res = await request(app)
        .post(`/api/transport/routes/${route._id}/students`)
        .set(headers)
        .send({ studentId: student._id.toString() })
        .expect(200);

      expect(res.body.message).toBeTruthy();
      expect(res.body.data).toHaveLength(1);
    });

    it('returns 409 when student is already assigned', async () => {
      const { school, app, headers } = await setup();
      const classRecord = await createClassRecord({ schoolId: school._id });
      const route = await createRouteDirect(school._id);
      const student = await createStudentRecord({
        schoolId: school._id,
        classId: classRecord._id,
        name: 'Student B',
      });

      await request(app)
        .post(`/api/transport/routes/${route._id}/students`)
        .set(headers)
        .send({ studentId: student._id.toString() })
        .expect(200);

      const res = await request(app)
        .post(`/api/transport/routes/${route._id}/students`)
        .set(headers)
        .send({ studentId: student._id.toString() })
        .expect(409);

      expect(res.body.error).toMatch(/already assigned/i);
    });

    it('returns 404 for non-existent route', async () => {
      const { school, app, headers } = await setup();
      const classRecord = await createClassRecord({ schoolId: school._id });
      const student = await createStudentRecord({ schoolId: school._id, classId: classRecord._id });
      const fakeId = new mongoose.Types.ObjectId().toString();

      await request(app)
        .post(`/api/transport/routes/${fakeId}/students`)
        .set(headers)
        .send({ studentId: student._id.toString() })
        .expect(404);
    });
  });

  describe('DELETE /api/transport/routes/:routeId/students/:studentId', () => {
    it('removes a student from a route', async () => {
      const { school, app, headers } = await setup();
      const classRecord = await createClassRecord({ schoolId: school._id });
      const route = await createRouteDirect(school._id);
      const student = await createStudentRecord({ schoolId: school._id, classId: classRecord._id });

      await request(app)
        .post(`/api/transport/routes/${route._id}/students`)
        .set(headers)
        .send({ studentId: student._id.toString() })
        .expect(200);

      const res = await request(app)
        .delete(`/api/transport/routes/${route._id}/students/${student._id}`)
        .set(headers)
        .expect(200);

      expect(res.body.message).toBeTruthy();
    });

    it('returns 404 when student is not assigned to route', async () => {
      const { school, app, headers } = await setup();
      const classRecord = await createClassRecord({ schoolId: school._id });
      const route = await createRouteDirect(school._id);
      const student = await createStudentRecord({ schoolId: school._id, classId: classRecord._id });

      const res = await request(app)
        .delete(`/api/transport/routes/${route._id}/students/${student._id}`)
        .set(headers)
        .expect(404);

      expect(res.body.error).toMatch(/not assigned/i);
    });
  });

  describe('GET /api/transport/students/:studentId/route', () => {
    it('returns the route assigned to a student', async () => {
      const { school, app, headers } = await setup();
      const classRecord = await createClassRecord({ schoolId: school._id });
      const route = await createRouteDirect(school._id, { routeName: 'Assigned Route' });
      const student = await createStudentRecord({ schoolId: school._id, classId: classRecord._id });

      await request(app)
        .post(`/api/transport/routes/${route._id}/students`)
        .set(headers)
        .send({ studentId: student._id.toString() })
        .expect(200);

      const res = await request(app)
        .get(`/api/transport/students/${student._id}/route`)
        .set(headers)
        .expect(200);

      expect(res.body.data.routeName).toBe('Assigned Route');
    });

    it('returns null when student has no route', async () => {
      const { school, app, headers } = await setup();
      const classRecord = await createClassRecord({ schoolId: school._id });
      const student = await createStudentRecord({ schoolId: school._id, classId: classRecord._id });

      const res = await request(app)
        .get(`/api/transport/students/${student._id}/route`)
        .set(headers)
        .expect(200);

      expect(res.body.data).toBeNull();
    });
  });

  // ─── Reports ───────────────────────────────────────────────────────────
  describe('GET /api/transport/reports', () => {
    it('returns route utilization report', async () => {
      const { school, app, headers } = await setup();
      await createRouteDirect(school._id, { routeName: 'Report Route' });

      const res = await request(app).get('/api/transport/reports').set(headers).expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.summary).toMatchObject({
        totalRoutes: expect.any(Number),
        activeRoutes: expect.any(Number),
        totalStudents: expect.any(Number),
      });
    });
  });
});
