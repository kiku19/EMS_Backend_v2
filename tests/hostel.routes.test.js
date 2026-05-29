import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import Hostel from '../models/Hostel.js';
import HostelRoom from '../models/HostelRoom.js';
import HostelAllocation from '../models/HostelAllocation.js';
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
    name: `Hostel School ${nextSeq()}`,
    code: `HS-${nextSeq()}`,
  });
  const admin = await createStaffUser({ schoolId: school._id });
  const classRecord = await createClassRecord({ schoolId: school._id });
  const { app } = createTestApp();
  const headers = authHeadersFor(admin, 'admin');
  return { school, admin, classRecord, app, headers };
}

function buildHostelPayload(overrides = {}) {
  return {
    name: `Hostel ${nextSeq()}`,
    type: 'boys',
    address: 'Test Address',
    description: 'Test Description',
    ...overrides,
  };
}

function buildRoomPayload(hostelId, overrides = {}) {
  return {
    hostelId: hostelId.toString(),
    roomNumber: `R${nextSeq()}`,
    floor: 1,
    type: 'double',
    capacity: 2,
    monthlyFee: 1000,
    amenities: ['AC', 'WiFi'],
    description: 'Test Room',
    ...overrides,
  };
}

function buildAllocationPayload(hostelId, roomId, studentId, overrides = {}) {
  return {
    hostelId: hostelId.toString(),
    roomId: roomId.toString(),
    studentId: studentId.toString(),
    bedNumber: 'A1',
    startDate: '2025-06-01',
    academicYear: '2025-26',
    monthlyFee: 1000,
    notes: 'Test allocation',
    ...overrides,
  };
}

async function createHostelDirect(schoolId, overrides = {}) {
  return Hostel.create({
    schoolId,
    name: `Hostel Direct ${nextSeq()}`,
    type: 'boys',
    ...overrides,
  });
}

async function createRoomDirect(schoolId, hostelId, overrides = {}) {
  return HostelRoom.create({
    schoolId,
    hostelId,
    roomNumber: `RD${nextSeq()}`,
    capacity: 2,
    ...overrides,
  });
}

async function createAllocationDirect(schoolId, hostelId, roomId, studentId, overrides = {}) {
  return HostelAllocation.create({
    schoolId,
    hostelId,
    roomId,
    studentId,
    startDate: new Date('2025-06-01'),
    status: 'active',
    ...overrides,
  });
}

describe('hostel routes', () => {
  // ─── Auth ──────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('returns 401 when no auth token is provided', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/hostel/hostels').expect(401);
      await request(app).post('/api/hostel/hostels').send(buildHostelPayload()).expect(401);
      await request(app).get('/api/hostel/rooms').expect(401);
      await request(app).get('/api/hostel/allocations').expect(401);
      await request(app).get('/api/hostel/stats').expect(401);
    });
  });

  // ─── Hostels ───────────────────────────────────────────────────────────
  describe('GET /api/hostel/hostels', () => {
    it('returns paginated hostels', async () => {
      const { school, app, headers, classRecord } = await setup();
      await createHostelDirect(school._id, { name: 'Hostel A' });
      await createHostelDirect(school._id, { name: 'Hostel B' });

      const res = await request(app).get('/api/hostel/hostels').set(headers).expect(200);

      expect(Array.isArray(res.body.hostels)).toBe(true);
      expect(res.body.hostels.length).toBe(2);
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('page');
      expect(res.body).toHaveProperty('pages');
    });

    it('filters hostels by type', async () => {
      const { school, app, headers, classRecord } = await setup();
      await createHostelDirect(school._id, { name: 'Boys Hostel', type: 'boys' });
      await createHostelDirect(school._id, { name: 'Girls Hostel', type: 'girls' });

      const res = await request(app)
        .get('/api/hostel/hostels')
        .query({ type: 'girls' })
        .set(headers)
        .expect(200);

      expect(res.body.hostels).toHaveLength(1);
      expect(res.body.hostels[0].type).toBe('girls');
    });

    it('searches hostels by name', async () => {
      const { school, app, headers, classRecord } = await setup();
      await createHostelDirect(school._id, { name: 'Alpha Hostel' });
      await createHostelDirect(school._id, { name: 'Beta Hostel' });

      const res = await request(app)
        .get('/api/hostel/hostels')
        .query({ search: 'Alpha' })
        .set(headers)
        .expect(200);

      expect(res.body.hostels).toHaveLength(1);
      expect(res.body.hostels[0].name).toBe('Alpha Hostel');
    });

    it('respects pagination params', async () => {
      const { school, app, headers, classRecord } = await setup();
      for (let i = 0; i < 5; i++) {
        await createHostelDirect(school._id, { name: `Hostel ${i}` });
      }

      const res = await request(app)
        .get('/api/hostel/hostels')
        .query({ page: 1, limit: 2 })
        .set(headers)
        .expect(200);

      expect(res.body.hostels).toHaveLength(2);
      expect(res.body.total).toBe(5);
      expect(res.body.pages).toBe(3);
    });
  });

  describe('GET /api/hostel/hostels/:id', () => {
    it('returns a hostel by id', async () => {
      const { school, app, headers, classRecord } = await setup();
      const hostel = await createHostelDirect(school._id, { name: 'Detail Hostel' });

      const res = await request(app)
        .get(`/api/hostel/hostels/${hostel._id}`)
        .set(headers)
        .expect(200);

      expect(res.body.hostel.name).toBe('Detail Hostel');
    });

    it('returns 404 for non-existent hostel', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).get(`/api/hostel/hostels/${fakeId}`).set(headers).expect(404);
    });
  });

  describe('POST /api/hostel/hostels', () => {
    it('creates a new hostel', async () => {
      const { school, app, headers, classRecord } = await setup();
      const payload = buildHostelPayload();

      const res = await request(app)
        .post('/api/hostel/hostels')
        .set(headers)
        .send(payload)
        .expect(201);

      expect(res.body.hostel.name).toBe(payload.name);
      expect(res.body.hostel.type).toBe(payload.type);
      expect(res.body.hostel.schoolId.toString()).toBe(school._id.toString());
    });

    it('returns 409 for duplicate hostel name', async () => {
      const { school, app, headers, classRecord } = await setup();
      const payload = buildHostelPayload({ name: 'Duplicate Hostel' });
      await createHostelDirect(school._id, { name: 'Duplicate Hostel' });

      const res = await request(app)
        .post('/api/hostel/hostels')
        .set(headers)
        .send(payload)
        .expect(409);

      expect(res.body.error).toBeTruthy();
    });

    it('returns 400 for invalid payload', async () => {
      const { app, headers } = await setup();
      const res = await request(app)
        .post('/api/hostel/hostels')
        .set(headers)
        .send({ name: '' })
        .expect(400);

      expect(res.body.error).toBeTruthy();
    });
  });

  describe('PUT /api/hostel/hostels/:id', () => {
    it('updates a hostel', async () => {
      const { school, app, headers, classRecord } = await setup();
      const hostel = await createHostelDirect(school._id);

      const res = await request(app)
        .put(`/api/hostel/hostels/${hostel._id}`)
        .set(headers)
        .send({ name: 'Updated Hostel', address: 'New Address' })
        .expect(200);

      expect(res.body.hostel.name).toBe('Updated Hostel');
      expect(res.body.hostel.address).toBe('New Address');
    });

    it('returns 404 for non-existent hostel', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app)
        .put(`/api/hostel/hostels/${fakeId}`)
        .set(headers)
        .send({ name: 'X' })
        .expect(404);
    });
  });

  describe('DELETE /api/hostel/hostels/:id', () => {
    it('soft-deletes a hostel without active allocations', async () => {
      const { school, app, headers, classRecord } = await setup();
      const hostel = await createHostelDirect(school._id);

      const res = await request(app)
        .delete(`/api/hostel/hostels/${hostel._id}`)
        .set(headers)
        .expect(200);

      expect(res.body.message).toBeTruthy();
      const deleted = await Hostel.findById(hostel._id);
      expect(deleted.isActive).toBe(false);
    });

    it('returns 400 when hostel has active allocations', async () => {
      const { school, app, headers, classRecord } = await setup();
      const hostel = await createHostelDirect(school._id);
      const room = await createRoomDirect(school._id, hostel._id);
      const student = await createStudentRecord({ schoolId: school._id, classId: classRecord._id });
      await createAllocationDirect(school._id, hostel._id, room._id, student._id);

      const res = await request(app)
        .delete(`/api/hostel/hostels/${hostel._id}`)
        .set(headers)
        .expect(400);

      expect(res.body.error).toMatch(/active allocations/i);
    });

    it('returns 404 for non-existent hostel', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).delete(`/api/hostel/hostels/${fakeId}`).set(headers).expect(404);
    });
  });

  // ─── Rooms ─────────────────────────────────────────────────────────────
  describe('GET /api/hostel/rooms', () => {
    it('returns paginated rooms', async () => {
      const { school, app, headers, classRecord } = await setup();
      const hostel = await createHostelDirect(school._id);
      await createRoomDirect(school._id, hostel._id, { roomNumber: '101' });
      await createRoomDirect(school._id, hostel._id, { roomNumber: '102' });

      const res = await request(app).get('/api/hostel/rooms').set(headers).expect(200);

      expect(Array.isArray(res.body.rooms)).toBe(true);
      expect(res.body.rooms.length).toBe(2);
      expect(res.body).toHaveProperty('total');
    });

    it('filters rooms by hostelId', async () => {
      const { school, app, headers, classRecord } = await setup();
      const hostel1 = await createHostelDirect(school._id);
      const hostel2 = await createHostelDirect(school._id);
      await createRoomDirect(school._id, hostel1._id, { roomNumber: 'H1-R1' });
      await createRoomDirect(school._id, hostel2._id, { roomNumber: 'H2-R1' });

      const res = await request(app)
        .get('/api/hostel/rooms')
        .query({ hostelId: hostel1._id.toString() })
        .set(headers)
        .expect(200);

      expect(res.body.rooms).toHaveLength(1);
      expect(res.body.rooms[0].roomNumber).toBe('H1-R1');
    });

    it('filters available rooms', async () => {
      const { school, app, headers, classRecord } = await setup();
      const hostel = await createHostelDirect(school._id);
      await createRoomDirect(school._id, hostel._id, {
        roomNumber: 'Full',
        capacity: 1,
        occupiedBeds: 1,
      });
      await createRoomDirect(school._id, hostel._id, {
        roomNumber: 'Avail',
        capacity: 2,
        occupiedBeds: 0,
      });

      const res = await request(app)
        .get('/api/hostel/rooms')
        .query({ available: 'true' })
        .set(headers)
        .expect(200);

      expect(res.body.rooms).toHaveLength(1);
      expect(res.body.rooms[0].roomNumber).toBe('Avail');
    });
  });

  describe('GET /api/hostel/rooms/:id', () => {
    it('returns a room by id', async () => {
      const { school, app, headers, classRecord } = await setup();
      const hostel = await createHostelDirect(school._id);
      const room = await createRoomDirect(school._id, hostel._id, { roomNumber: 'R-GET' });

      const res = await request(app).get(`/api/hostel/rooms/${room._id}`).set(headers).expect(200);

      expect(res.body.room.roomNumber).toBe('R-GET');
    });

    it('returns 404 for non-existent room', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).get(`/api/hostel/rooms/${fakeId}`).set(headers).expect(404);
    });
  });

  describe('POST /api/hostel/rooms', () => {
    it('creates a new room and updates hostel totals', async () => {
      const { school, app, headers, classRecord } = await setup();
      const hostel = await createHostelDirect(school._id);
      const payload = buildRoomPayload(hostel._id);

      const res = await request(app)
        .post('/api/hostel/rooms')
        .set(headers)
        .send(payload)
        .expect(201);

      expect(res.body.room.roomNumber).toBe(payload.roomNumber);
      expect(res.body.room.hostelId.toString()).toBe(hostel._id.toString());

      const updatedHostel = await Hostel.findById(hostel._id);
      expect(updatedHostel.totalRooms).toBe(1);
      expect(updatedHostel.totalCapacity).toBe(payload.capacity);
    });

    it('returns 404 for non-existent hostel', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      const payload = buildRoomPayload(fakeId);

      await request(app).post('/api/hostel/rooms').set(headers).send(payload).expect(404);
    });

    it('returns 409 for duplicate room number in same hostel', async () => {
      const { school, app, headers, classRecord } = await setup();
      const hostel = await createHostelDirect(school._id);
      await createRoomDirect(school._id, hostel._id, { roomNumber: 'DUP' });
      const payload = buildRoomPayload(hostel._id, { roomNumber: 'DUP' });

      const res = await request(app)
        .post('/api/hostel/rooms')
        .set(headers)
        .send(payload)
        .expect(409);

      expect(res.body.error).toMatch(/already exists/i);
    });
  });

  describe('PUT /api/hostel/rooms/:id', () => {
    it('updates a room', async () => {
      const { school, app, headers, classRecord } = await setup();
      const hostel = await createHostelDirect(school._id);
      const room = await createRoomDirect(school._id, hostel._id);

      const res = await request(app)
        .put(`/api/hostel/rooms/${room._id}`)
        .set(headers)
        .send({ monthlyFee: 1500, description: 'Updated' })
        .expect(200);

      expect(res.body.room.monthlyFee).toBe(1500);
      expect(res.body.room.description).toBe('Updated');
    });

    it('returns 400 when reducing capacity below occupancy', async () => {
      const { school, app, headers, classRecord } = await setup();
      const hostel = await createHostelDirect(school._id);
      const room = await createRoomDirect(school._id, hostel._id, { capacity: 3, occupiedBeds: 2 });

      const res = await request(app)
        .put(`/api/hostel/rooms/${room._id}`)
        .set(headers)
        .send({ capacity: 1 })
        .expect(400);

      expect(res.body.error).toMatch(/cannot reduce capacity/i);
    });

    it('returns 404 for non-existent room', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app)
        .put(`/api/hostel/rooms/${fakeId}`)
        .set(headers)
        .send({ monthlyFee: 100 })
        .expect(404);
    });
  });

  describe('DELETE /api/hostel/rooms/:id', () => {
    it('soft-deletes a room without active allocations', async () => {
      const { school, app, headers, classRecord } = await setup();
      const hostel = await createHostelDirect(school._id);
      const room = await createRoomDirect(school._id, hostel._id);

      const res = await request(app)
        .delete(`/api/hostel/rooms/${room._id}`)
        .set(headers)
        .expect(200);

      expect(res.body.message).toBeTruthy();
      const deleted = await HostelRoom.findById(room._id);
      expect(deleted.isActive).toBe(false);
    });

    it('returns 400 when room has active allocations', async () => {
      const { school, app, headers, classRecord } = await setup();
      const hostel = await createHostelDirect(school._id);
      const room = await createRoomDirect(school._id, hostel._id);
      const student = await createStudentRecord({ schoolId: school._id, classId: classRecord._id });
      await createAllocationDirect(school._id, hostel._id, room._id, student._id);

      const res = await request(app)
        .delete(`/api/hostel/rooms/${room._id}`)
        .set(headers)
        .expect(400);

      expect(res.body.error).toMatch(/active allocations/i);
    });

    it('returns 404 for non-existent room', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).delete(`/api/hostel/rooms/${fakeId}`).set(headers).expect(404);
    });
  });

  // ─── Allocations ───────────────────────────────────────────────────────
  describe('GET /api/hostel/allocations', () => {
    it('returns paginated allocations', async () => {
      const { school, app, headers, classRecord } = await setup();
      const hostel = await createHostelDirect(school._id);
      const room = await createRoomDirect(school._id, hostel._id);
      const student = await createStudentRecord({ schoolId: school._id, classId: classRecord._id });
      await createAllocationDirect(school._id, hostel._id, room._id, student._id);

      const res = await request(app).get('/api/hostel/allocations').set(headers).expect(200);

      expect(Array.isArray(res.body.allocations)).toBe(true);
      expect(res.body.allocations.length).toBe(1);
      expect(res.body).toHaveProperty('total');
    });

    it('filters allocations by status', async () => {
      const { school, app, headers, classRecord } = await setup();
      const hostel = await createHostelDirect(school._id);
      const room = await createRoomDirect(school._id, hostel._id);
      const student1 = await createStudentRecord({
        schoolId: school._id,
        classId: classRecord._id,
        name: 'S1',
      });
      const student2 = await createStudentRecord({
        schoolId: school._id,
        classId: classRecord._id,
        name: 'S2',
      });
      await createAllocationDirect(school._id, hostel._id, room._id, student1._id, {
        status: 'active',
      });
      await createAllocationDirect(school._id, hostel._id, room._id, student2._id, {
        status: 'vacated',
        startDate: new Date('2024-01-01'),
      });

      const res = await request(app)
        .get('/api/hostel/allocations')
        .query({ status: 'vacated' })
        .set(headers)
        .expect(200);

      expect(res.body.allocations).toHaveLength(1);
    });
  });

  describe('GET /api/hostel/allocations/:id', () => {
    it('returns an allocation by id', async () => {
      const { school, app, headers, classRecord } = await setup();
      const hostel = await createHostelDirect(school._id);
      const room = await createRoomDirect(school._id, hostel._id);
      const student = await createStudentRecord({ schoolId: school._id, classId: classRecord._id });
      const allocation = await createAllocationDirect(
        school._id,
        hostel._id,
        room._id,
        student._id
      );

      const res = await request(app)
        .get(`/api/hostel/allocations/${allocation._id}`)
        .set(headers)
        .expect(200);

      expect(res.body.allocation).toBeTruthy();
    });

    it('returns 404 for non-existent allocation', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).get(`/api/hostel/allocations/${fakeId}`).set(headers).expect(404);
    });
  });

  describe('POST /api/hostel/allocations', () => {
    it('allocates a student to a room', async () => {
      const { school, app, headers, classRecord } = await setup();
      const hostel = await createHostelDirect(school._id);
      const room = await createRoomDirect(school._id, hostel._id);
      const student = await createStudentRecord({ schoolId: school._id, classId: classRecord._id });
      const payload = buildAllocationPayload(hostel._id, room._id, student._id);

      const res = await request(app)
        .post('/api/hostel/allocations')
        .set(headers)
        .send(payload)
        .expect(201);

      expect(res.body.allocation.studentId.toString()).toBe(student._id.toString());
      expect(res.body.allocation.status).toBe('active');

      const updatedRoom = await HostelRoom.findById(room._id);
      expect(updatedRoom.occupiedBeds).toBe(1);
    });

    it('returns 400 when student already has active allocation', async () => {
      const { school, app, headers, classRecord } = await setup();
      const hostel = await createHostelDirect(school._id);
      const room1 = await createRoomDirect(school._id, hostel._id);
      const room2 = await createRoomDirect(school._id, hostel._id);
      const student = await createStudentRecord({ schoolId: school._id, classId: classRecord._id });
      await createAllocationDirect(school._id, hostel._id, room1._id, student._id);

      const payload = buildAllocationPayload(hostel._id, room2._id, student._id);
      const res = await request(app)
        .post('/api/hostel/allocations')
        .set(headers)
        .send(payload)
        .expect(400);

      expect(res.body.error).toMatch(/already has an active/i);
    });

    it('returns 400 when room is at full capacity', async () => {
      const { school, app, headers, classRecord } = await setup();
      const hostel = await createHostelDirect(school._id);
      const room = await createRoomDirect(school._id, hostel._id, { capacity: 1, occupiedBeds: 1 });
      const student = await createStudentRecord({ schoolId: school._id, classId: classRecord._id });
      const payload = buildAllocationPayload(hostel._id, room._id, student._id);

      const res = await request(app)
        .post('/api/hostel/allocations')
        .set(headers)
        .send(payload)
        .expect(400);

      expect(res.body.error).toMatch(/full capacity/i);
    });

    it('returns 404 for non-existent room', async () => {
      const { school, app, headers, classRecord } = await setup();
      const hostel = await createHostelDirect(school._id);
      const fakeRoomId = new mongoose.Types.ObjectId().toString();
      const student = await createStudentRecord({ schoolId: school._id, classId: classRecord._id });
      const payload = buildAllocationPayload(hostel._id, fakeRoomId, student._id);

      await request(app).post('/api/hostel/allocations').set(headers).send(payload).expect(404);
    });
  });

  describe('PUT /api/hostel/allocations/:id/vacate', () => {
    it('vacates an active allocation', async () => {
      const { school, app, headers, classRecord } = await setup();
      const hostel = await createHostelDirect(school._id);
      const room = await createRoomDirect(school._id, hostel._id, { capacity: 2, occupiedBeds: 1 });
      const student = await createStudentRecord({ schoolId: school._id, classId: classRecord._id });
      const allocation = await createAllocationDirect(
        school._id,
        hostel._id,
        room._id,
        student._id
      );

      const res = await request(app)
        .put(`/api/hostel/allocations/${allocation._id}/vacate`)
        .set(headers)
        .send({ endDate: '2025-12-01', notes: 'Left school' })
        .expect(200);

      expect(res.body.allocation.status).toBe('vacated');

      const updatedRoom = await HostelRoom.findById(room._id);
      expect(updatedRoom.occupiedBeds).toBe(0);
    });

    it('returns 404 for non-existent allocation', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app)
        .put(`/api/hostel/allocations/${fakeId}/vacate`)
        .set(headers)
        .send({})
        .expect(404);
    });
  });

  describe('GET /api/hostel/students/:studentId/allocation', () => {
    it('returns active allocation for a student', async () => {
      const { school, app, headers, classRecord } = await setup();
      const hostel = await createHostelDirect(school._id);
      const room = await createRoomDirect(school._id, hostel._id);
      const student = await createStudentRecord({ schoolId: school._id, classId: classRecord._id });
      await createAllocationDirect(school._id, hostel._id, room._id, student._id);

      const res = await request(app)
        .get(`/api/hostel/students/${student._id}/allocation`)
        .set(headers)
        .expect(200);

      expect(res.body.allocation).toBeTruthy();
      expect(res.body.allocation.studentId.toString()).toBe(student._id.toString());
    });

    it('returns null when student has no active allocation', async () => {
      const { school, app, headers, classRecord } = await setup();
      const student = await createStudentRecord({ schoolId: school._id, classId: classRecord._id });

      const res = await request(app)
        .get(`/api/hostel/students/${student._id}/allocation`)
        .set(headers)
        .expect(200);

      expect(res.body.allocation).toBeNull();
    });
  });

  // ─── Stats ─────────────────────────────────────────────────────────────
  describe('GET /api/hostel/stats', () => {
    it('returns hostel statistics', async () => {
      const { school, app, headers, classRecord } = await setup();
      const hostel = await createHostelDirect(school._id);
      const room = await createRoomDirect(school._id, hostel._id, { capacity: 4, occupiedBeds: 1 });
      const student = await createStudentRecord({ schoolId: school._id, classId: classRecord._id });
      await createAllocationDirect(school._id, hostel._id, room._id, student._id);

      const res = await request(app).get('/api/hostel/stats').set(headers).expect(200);

      expect(res.body).toHaveProperty('totalHostels');
      expect(res.body).toHaveProperty('totalRooms');
      expect(res.body).toHaveProperty('totalCapacity');
      expect(res.body).toHaveProperty('occupiedBeds');
      expect(res.body).toHaveProperty('availableBeds');
      expect(res.body).toHaveProperty('activeAllocations');
      expect(res.body).toHaveProperty('occupancyRate');
      expect(res.body.totalHostels).toBe(1);
      expect(res.body.totalRooms).toBe(1);
      expect(res.body.totalCapacity).toBe(4);
    });
  });

  // ─── Multi-tenancy ─────────────────────────────────────────────────────
  describe('Multi-tenancy', () => {
    it('School A admin cannot see School B hostels', async () => {
      const schoolA = await createSchoolRecord({ name: 'Tenant A' });
      const schoolB = await createSchoolRecord({ name: 'Tenant B' });
      const adminA = await createStaffUser({ schoolId: schoolA._id });
      await createHostelDirect(schoolA._id, { name: 'Hostel A' });
      await createHostelDirect(schoolB._id, { name: 'Hostel B' });

      const { app } = createTestApp();
      const headersA = authHeadersFor(adminA, 'admin');

      const res = await request(app).get('/api/hostel/hostels').set(headersA).expect(200);
      const names = res.body.hostels.map((h) => h.name);
      expect(names).toContain('Hostel A');
      expect(names).not.toContain('Hostel B');
    });

    it('School A admin cannot access School B hostel by ID', async () => {
      const schoolA = await createSchoolRecord({ name: 'ISO A' });
      const schoolB = await createSchoolRecord({ name: 'ISO B' });
      const adminA = await createStaffUser({ schoolId: schoolA._id });
      const hostelB = await createHostelDirect(schoolB._id);

      const { app } = createTestApp();
      const headersA = authHeadersFor(adminA, 'admin');

      await request(app).get(`/api/hostel/hostels/${hostelB._id}`).set(headersA).expect(404);
    });
  });
});
