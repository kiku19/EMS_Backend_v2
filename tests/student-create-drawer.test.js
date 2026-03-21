/**
 * Comprehensive test suite for the Create New Student drawer.
 *
 * Covers:
 *  1. Zod input validation (required fields, types, enums, boundaries)
 *  2. Authentication & authorization
 *  3. Multi-tenancy (schoolId scoping)
 *  4. Database persistence & field mapping
 *  5. Parent account auto-creation
 *  6. Cross-module visibility (list, detail, filter, search)
 *  7. Uniqueness constraints (admissionId, rollNo)
 *  8. Edge cases (special characters, max lengths, optional fields)
 */

import request from 'supertest';
import { describe, expect, it, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Student } from '../database.js';
import Parent from '../models/Parent.js';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import {
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  authHeadersFor,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

// ── Helpers ──────────────────────────────────────────────────

const defaultParent = [
  {
    name: 'Default Parent',
    relationship: 'father',
    phone: '9000000001',
    isWhatsapp: true,
  },
];

function validStudentPayload(classId, overrides = {}) {
  return {
    name: 'Test Student',
    admissionId: `ADM-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    academicYear: '2025-26',
    classId: classId.toString(),
    parents: defaultParent,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════
// 1. ZOD INPUT VALIDATION
// ══════════════════════════════════════════════════════════════

describe('Student Create Drawer — Zod Validation', () => {
  let app, authHeaders, classId;

  beforeEach(async () => {
    const admin = await createStaffUser();
    const classRecord = await createClassRecord();
    ({ app } = createTestApp());
    authHeaders = authHeadersFor(admin, 'admin');
    classId = classRecord._id.toString();
  });

  // ── Required fields ──

  it('rejects when name is missing', async () => {
    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { name: undefined }))
      .expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it('rejects when name is shorter than 2 characters', async () => {
    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { name: 'A' }))
      .expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it('rejects when name exceeds 100 characters', async () => {
    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { name: 'A'.repeat(101) }))
      .expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it('rejects when admissionId is missing', async () => {
    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { admissionId: undefined }))
      .expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it('rejects when academicYear is missing', async () => {
    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { academicYear: undefined }))
      .expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it('rejects when academicYear has invalid format (not YYYY-YY)', async () => {
    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { academicYear: '2025' }))
      .expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it('rejects when classId is missing', async () => {
    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { classId: undefined }))
      .expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it('rejects when classId is not a valid ObjectId', async () => {
    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { classId: 'not-an-objectid' }))
      .expect(400);
    expect(res.body.error).toBeTruthy();
  });

  // ── Optional field type validation ──

  it('rejects when rollNo is not a positive integer', async () => {
    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { rollNo: -1 }))
      .expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it('rejects when rollNo is zero', async () => {
    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { rollNo: 0 }))
      .expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it('rejects when gender is not in the allowed enum', async () => {
    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { gender: 'Unknown' }))
      .expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it('accepts Male gender', async () => {
    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { gender: 'Male' }));
    expect(res.status).toBe(201);
  });

  it('accepts Female gender', async () => {
    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { gender: 'Female' }));
    expect(res.status).toBe(201);
  });

  it('accepts Other gender', async () => {
    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { gender: 'Other' }));
    expect(res.status).toBe(201);
  });

  it('rejects invalid blood group', async () => {
    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { bloodGroup: 'X+' }))
      .expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it('accepts valid blood group values', async () => {
    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { bloodGroup: 'AB+' }))
      .expect(201);
    expect(res.body.name).toBe('Test Student');
  });

  it('rejects aadhaar number that is not exactly 12 digits', async () => {
    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { aadhaarNumber: '12345' }))
      .expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it('accepts valid 12-digit aadhaar number', async () => {
    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { aadhaarNumber: '123456789012' }))
      .expect(201);
    expect(res.body).toBeTruthy();
  });

  it('rejects invalid phone number (not 10 digits)', async () => {
    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { phone: '12345' }))
      .expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it('rejects invalid email format', async () => {
    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { email: 'not-an-email' }))
      .expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it('rejects invalid feeStatus enum', async () => {
    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { feeStatus: 'overdue' }))
      .expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it('rejects invalid status enum', async () => {
    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { status: 'expelled' }))
      .expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it('strips unknown fields from the request body', async () => {
    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { unknownField: 'should be stripped', hackField: true }))
      .expect(201);

    const student = await Student.findById(res.body.id).lean();
    expect(student.unknownField).toBeUndefined();
    expect(student.hackField).toBeUndefined();
  });

  // ── Parent subdocument validation ──

  it('rejects parent without a name', async () => {
    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(
        validStudentPayload(classId, {
          parents: [{ name: '', relationship: 'father', phone: '9000000001' }],
        })
      )
      .expect(400);
    expect(res.body.error).toBeTruthy();
  });
});

// ══════════════════════════════════════════════════════════════
// 2. AUTHENTICATION & AUTHORIZATION
// ══════════════════════════════════════════════════════════════

describe('Student Create Drawer — Auth', () => {
  it('returns 401 when no auth token is provided', async () => {
    const classRecord = await createClassRecord();
    const { app } = createTestApp();

    await request(app).post('/api/students').send(validStudentPayload(classRecord._id)).expect(401);
  });

  it('returns 401 with an invalid/expired token', async () => {
    const classRecord = await createClassRecord();
    const { app } = createTestApp();

    await request(app)
      .post('/api/students')
      .set({ Authorization: 'Bearer invalid.jwt.token' })
      .send(validStudentPayload(classRecord._id))
      .expect(401);
  });
});

// ══════════════════════════════════════════════════════════════
// 3. MULTI-TENANCY — schoolId SCOPING
// ══════════════════════════════════════════════════════════════

describe('Student Create Drawer — Multi-tenancy', () => {
  it('sets schoolId from req.user, not from request body', async () => {
    const school = await createSchoolRecord({ name: 'Tenant School' });
    const admin = await createStaffUser({ schoolId: school._id });
    const classRecord = await createClassRecord();
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(admin, 'admin');

    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(
        validStudentPayload(classRecord._id, {
          schoolId: new mongoose.Types.ObjectId().toString(), // attempt to inject schoolId
        })
      )
      .expect(201);

    const student = await Student.findById(res.body.id).lean();
    expect(student.schoolId.toString()).toBe(school._id.toString());
  });

  it('created student is only visible to its own school', async () => {
    const schoolA = await createSchoolRecord({ name: 'School Alpha' });
    const schoolB = await createSchoolRecord({ name: 'School Beta' });
    const adminA = await createStaffUser({ schoolId: schoolA._id });
    const adminB = await createStaffUser({ schoolId: schoolB._id });
    const classRecord = await createClassRecord();
    const { app } = createTestApp();

    // Create student under school A
    const res = await request(app)
      .post('/api/students')
      .set(authHeadersFor(adminA, 'admin'))
      .send(validStudentPayload(classRecord._id, { admissionId: 'ADM-CROSS-TENANT' }))
      .expect(201);

    const studentId = res.body.id;

    // Admin A can see the student
    await request(app)
      .get(`/api/students/${studentId}`)
      .set(authHeadersFor(adminA, 'admin'))
      .expect(200);

    // Admin B from a different school cannot see it
    await request(app)
      .get(`/api/students/${studentId}`)
      .set(authHeadersFor(adminB, 'admin'))
      .expect(404);

    // Admin B cannot see it in the list
    const listRes = await request(app)
      .get('/api/students')
      .set(authHeadersFor(adminB, 'admin'))
      .expect(200);

    const names = listRes.body.data.map((s) => s.admissionId);
    expect(names).not.toContain('ADM-CROSS-TENANT');
  });
});

// ══════════════════════════════════════════════════════════════
// 4. DATABASE PERSISTENCE & FIELD MAPPING
// ══════════════════════════════════════════════════════════════

describe('Student Create Drawer — DB Persistence', () => {
  let app, authHeaders, classId, school;

  beforeEach(async () => {
    school = await createSchoolRecord({ name: 'Persistence School' });
    const admin = await createStaffUser({ schoolId: school._id });
    const classRecord = await createClassRecord();
    ({ app } = createTestApp());
    authHeaders = authHeadersFor(admin, 'admin');
    classId = classRecord._id.toString();
  });

  it('saves all provided fields correctly to the database', async () => {
    const payload = {
      name: 'Priya Sharma',
      admissionId: 'ADM-FULL-001',
      academicYear: '2025-26',
      classId,
      rollNo: 15,
      gender: 'Female',
      dateOfBirth: '2012-03-25',
      bloodGroup: 'B+',
      nationality: 'Indian',
      religion: 'Hindu',
      category: 'General',
      motherTongue: 'Hindi',
      aadhaarNumber: '123456789012',
      phone: '9876543210',
      email: 'priya@example.com',
      address: '123 Main St',
      city: 'Delhi',
      state: 'Delhi',
      zipCode: '110001',
      isWhatsapp: true,
      whatsappNumber: '9876543210',
      parentName: 'Rajesh Sharma',
      parentPhone: '9876543211',
      parentEmail: 'rajesh@example.com',
      parentRelationship: 'Father',
      parentOccupation: 'Engineer',
      parents: [
        {
          name: 'Rajesh Sharma',
          relationship: 'Father',
          phone: '9876543211',
          email: 'rajesh@example.com',
          occupation: 'Engineer',
          isWhatsapp: true,
        },
      ],
      previousSchool: 'ABC Public School',
      tcNumber: 'TC-2025-001',
      medicalConditions: 'None',
      emergencyContactName: 'Uncle Raj',
      emergencyContactPhone: '9876543222',
      transportRequired: true,
      hostelRequired: false,
    };

    const res = await request(app).post('/api/students').set(authHeaders).send(payload).expect(201);

    const student = await Student.findById(res.body.id).lean();

    expect(student.name).toBe('Priya Sharma');
    expect(student.admissionId).toBe('ADM-FULL-001');
    expect(student.rollNo).toBe(15);
    expect(student.gender).toBe('Female');
    expect(student.bloodGroup).toBe('B+');
    expect(student.nationality).toBe('Indian');
    expect(student.religion).toBe('Hindu');
    expect(student.category).toBe('General');
    expect(student.motherTongue).toBe('Hindi');
    expect(student.aadhaarNumber).toBe('123456789012');
    expect(student.phone).toBe('9876543210');
    expect(student.email).toBe('priya@example.com');
    expect(student.address).toBe('123 Main St');
    expect(student.city).toBe('Delhi');
    expect(student.state).toBe('Delhi');
    expect(student.zipCode).toBe('110001');
    expect(student.isWhatsapp).toBe(true);
    expect(student.parentName).toBe('Rajesh Sharma');
    expect(student.parentPhone).toBe('9876543211');
    expect(student.parentEmail).toBe('rajesh@example.com');
    expect(student.parentRelationship).toBe('Father');
    expect(student.previousSchool).toBe('ABC Public School');
    expect(student.tcNumber).toBe('TC-2025-001');
    expect(student.medicalConditions).toBe('None');
    expect(student.emergencyContactName).toBe('Uncle Raj');
    expect(student.emergencyContactPhone).toBe('9876543222');
    expect(student.transportRequired).toBe(true);
    expect(student.hostelRequired).toBe(false);
    expect(student.schoolId.toString()).toBe(school._id.toString());
    expect(student.status).toBe('active');
    expect(student.feeStatus).toBe('pending');
    expect(student.isDeleted).toBeFalsy();
  });

  it('defaults status to active and feeStatus to pending when not provided', async () => {
    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId))
      .expect(201);

    const student = await Student.findById(res.body.id).lean();
    expect(student.status).toBe('active');
    expect(student.feeStatus).toBe('pending');
  });

  it('stores parents array with correct structure', async () => {
    const parents = [
      { name: 'Father Name', relationship: 'father', phone: '9111111111', isWhatsapp: true },
      { name: 'Mother Name', relationship: 'mother', phone: '9222222222', email: 'mom@test.com' },
    ];

    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { parents }))
      .expect(201);

    const student = await Student.findById(res.body.id).lean();
    expect(student.parents).toHaveLength(2);
    expect(student.parents[0].name).toBe('Father Name');
    expect(student.parents[1].name).toBe('Mother Name');
    expect(student.parents[1].email).toBe('mom@test.com');
  });

  it('stores timestamps (createdAt, updatedAt)', async () => {
    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId))
      .expect(201);

    const student = await Student.findById(res.body.id).lean();
    expect(student.createdAt).toBeDefined();
    expect(student.updatedAt).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════
// 5. PARENT ACCOUNT AUTO-CREATION
// ══════════════════════════════════════════════════════════════

describe('Student Create Drawer — Parent Account Sync', () => {
  it('auto-creates a Parent account when a student is created', async () => {
    const admin = await createStaffUser();
    const classRecord = await createClassRecord();
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(admin, 'admin');

    const uniquePhone = '9888800001';

    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(
        validStudentPayload(classRecord._id, {
          parentName: 'Auto Parent',
          parentPhone: uniquePhone,
          parents: [
            {
              name: 'Auto Parent',
              relationship: 'father',
              phone: uniquePhone,
              isWhatsapp: true,
            },
          ],
        })
      )
      .expect(201);

    const parent = await Parent.findOne({ phone: uniquePhone }).lean();
    expect(parent).toBeTruthy();
    expect(parent.name).toBe('Auto Parent');
    expect(parent.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          studentId: new mongoose.Types.ObjectId(res.body.id),
        }),
      ])
    );
  });

  it('links to existing parent account if phone already exists', async () => {
    const admin = await createStaffUser();
    const classRecord = await createClassRecord();
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(admin, 'admin');
    const sharedPhone = '9888800002';

    // Create first student with parent
    await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(
        validStudentPayload(classRecord._id, {
          admissionId: 'ADM-SIB-001',
          parentPhone: sharedPhone,
          parents: [
            { name: 'Shared Parent', relationship: 'father', phone: sharedPhone, isWhatsapp: true },
          ],
        })
      )
      .expect(201);

    // Create second student with same parent phone
    const res2 = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(
        validStudentPayload(classRecord._id, {
          admissionId: 'ADM-SIB-002',
          rollNo: 2,
          parentPhone: sharedPhone,
          parents: [
            { name: 'Shared Parent', relationship: 'father', phone: sharedPhone, isWhatsapp: true },
          ],
        })
      )
      .expect(201);

    // Only one parent account should exist
    const parents = await Parent.find({ phone: sharedPhone }).lean();
    expect(parents).toHaveLength(1);
    // It should have 2 children linked
    expect(parents[0].children.length).toBeGreaterThanOrEqual(2);
  });
});

// ══════════════════════════════════════════════════════════════
// 6. UNIQUENESS CONSTRAINTS
// ══════════════════════════════════════════════════════════════

describe('Student Create Drawer — Uniqueness', () => {
  let app, authHeaders, classId;

  beforeEach(async () => {
    const admin = await createStaffUser();
    const classRecord = await createClassRecord();
    ({ app } = createTestApp());
    authHeaders = authHeadersFor(admin, 'admin');
    classId = classRecord._id.toString();
  });

  it('rejects duplicate admissionId within the same school', async () => {
    await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { admissionId: 'ADM-UNIQUE-001' }))
      .expect(201);

    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { admissionId: 'ADM-UNIQUE-001', rollNo: 2 }))
      .expect(409);

    expect(res.body.field).toBe('admissionId');
  });

  it('rejects duplicate rollNo in the same class and academic year', async () => {
    await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { admissionId: 'ADM-ROLL-A', rollNo: 42 }))
      .expect(201);

    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { admissionId: 'ADM-ROLL-B', rollNo: 42 }))
      .expect(409);

    expect(res.body.field).toBe('rollNo');
  });

  it('allows same rollNo in different classes', async () => {
    const classB = await createClassRecord({ name: 'Class 9', section: 'B' });

    await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { admissionId: 'ADM-DIFFCLASS-A', rollNo: 1 }))
      .expect(201);

    await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classB._id, { admissionId: 'ADM-DIFFCLASS-B', rollNo: 1 }))
      .expect(201);
  });

  it('rejects when classId does not exist in the database', async () => {
    const fakeClassId = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(fakeClassId))
      .expect(400);

    expect(res.body.field).toBe('classId');
  });
});

// ══════════════════════════════════════════════════════════════
// 7. CROSS-MODULE VISIBILITY (List, Detail, Filters)
// ══════════════════════════════════════════════════════════════

describe('Student Create Drawer — Cross-module Visibility', () => {
  let app, authHeaders, classId, school;

  beforeEach(async () => {
    school = await createSchoolRecord({ name: 'Visibility School' });
    const admin = await createStaffUser({ schoolId: school._id });
    const classRecord = await createClassRecord();
    ({ app } = createTestApp());
    authHeaders = authHeadersFor(admin, 'admin');
    classId = classRecord._id.toString();
  });

  it('newly created student appears in the list endpoint', async () => {
    const createRes = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(
        validStudentPayload(classId, { name: 'Listable Student', admissionId: 'ADM-LIST-VIS-001' })
      )
      .expect(201);

    const listRes = await request(app).get('/api/students').set(authHeaders).expect(200);

    const found = listRes.body.data.find((s) => s.id === createRes.body.id);
    expect(found).toBeTruthy();
    expect(found.name).toBe('Listable Student');
  });

  it('newly created student appears in detail endpoint with class info', async () => {
    const createRes = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { name: 'Detail Student', admissionId: 'ADM-DETAIL-001' }))
      .expect(201);

    const detailRes = await request(app)
      .get(`/api/students/${createRes.body.id}`)
      .set(authHeaders)
      .expect(200);

    expect(detailRes.body.name).toBe('Detail Student');
    expect(detailRes.body.class).toBeTruthy(); // Should have formatted class string
    expect(detailRes.body.className).toBeTruthy(); // Should have full class name
  });

  it('newly created student is filterable by classId', async () => {
    const classB = await createClassRecord({ name: 'Class 8', section: 'B' });

    await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { name: 'Class A Student', admissionId: 'ADM-FILT-A' }))
      .expect(201);

    await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classB._id, { name: 'Class B Student', admissionId: 'ADM-FILT-B' }))
      .expect(201);

    const filteredRes = await request(app)
      .get(`/api/students?classId=${classId}`)
      .set(authHeaders)
      .expect(200);

    const names = filteredRes.body.data.map((s) => s.name);
    expect(names).toContain('Class A Student');
    expect(names).not.toContain('Class B Student');
  });

  it('newly created student is searchable by name', async () => {
    await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { name: 'Aishwarya Patel', admissionId: 'ADM-SRCH-001' }))
      .expect(201);

    const searchRes = await request(app)
      .get('/api/students?search=Aishwarya')
      .set(authHeaders)
      .expect(200);

    expect(searchRes.body.data.length).toBeGreaterThanOrEqual(1);
    expect(searchRes.body.data.some((s) => s.name.includes('Aishwarya'))).toBe(true);
  });

  it('newly created student is filterable by status', async () => {
    await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(
        validStudentPayload(classId, {
          name: 'Active Student',
          admissionId: 'ADM-STAT-001',
          status: 'active',
        })
      )
      .expect(201);

    const activeRes = await request(app)
      .get('/api/students?status=active')
      .set(authHeaders)
      .expect(200);

    expect(activeRes.body.data.some((s) => s.name === 'Active Student')).toBe(true);
  });

  it('deleted student does not appear in list endpoint', async () => {
    const createRes = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { name: 'Soon Deleted', admissionId: 'ADM-DEL-VIS' }))
      .expect(201);

    await request(app).delete(`/api/students/${createRes.body.id}`).set(authHeaders).expect(200);

    const listRes = await request(app).get('/api/students').set(authHeaders).expect(200);

    const found = listRes.body.data.find((s) => s.id === createRes.body.id);
    expect(found).toBeFalsy();
  });

  it('response includes pagination metadata', async () => {
    await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(validStudentPayload(classId, { admissionId: 'ADM-PAGE-001' }))
      .expect(201);

    const listRes = await request(app).get('/api/students').set(authHeaders).expect(200);

    expect(listRes.body.pagination).toBeDefined();
    expect(listRes.body.pagination.currentPage).toBe(1);
    expect(listRes.body.pagination.itemsPerPage).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════
// 8. EDGE CASES
// ══════════════════════════════════════════════════════════════

describe('Student Create Drawer — Edge Cases', () => {
  let app, authHeaders, classId;

  beforeEach(async () => {
    const admin = await createStaffUser();
    const classRecord = await createClassRecord();
    ({ app } = createTestApp());
    authHeaders = authHeadersFor(admin, 'admin');
    classId = classRecord._id.toString();
  });

  it('handles special characters in name correctly', async () => {
    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(
        validStudentPayload(classId, {
          name: "O'Brien-Smith Jr.",
          admissionId: 'ADM-SPECIAL-001',
        })
      )
      .expect(201);

    const student = await Student.findById(res.body.id).lean();
    expect(student.name).toBe("O'Brien-Smith Jr.");
  });

  it('trims whitespace from name field', async () => {
    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(
        validStudentPayload(classId, {
          name: '  Padded Name  ',
          admissionId: 'ADM-TRIM-001',
        })
      )
      .expect(201);

    const student = await Student.findById(res.body.id).lean();
    expect(student.name).toBe('Padded Name');
  });

  it('accepts a student with only required fields (minimal payload)', async () => {
    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send({
        name: 'Minimal Student',
        admissionId: 'ADM-MIN-001',
        academicYear: '2025-26',
        classId,
        parents: [{ name: 'Minimal Parent', relationship: 'father', phone: '9000000099' }],
      })
      .expect(201);

    expect(res.body.name).toBe('Minimal Student');
    expect(res.body.status).toBe('active');
  });

  it('accepts a student with all optional fields populated', async () => {
    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(
        validStudentPayload(classId, {
          admissionId: 'ADM-FULL-OPT',
          rollNo: 99,
          gender: 'Female',
          dateOfBirth: '2011-06-15',
          bloodGroup: 'O+',
          nationality: 'Indian',
          religion: 'Sikh',
          category: 'General',
          motherTongue: 'Punjabi',
          aadhaarNumber: '999999999999',
          phone: '9111111111',
          email: 'full@example.com',
          address: 'Full Address Line',
          city: 'Mumbai',
          state: 'Maharashtra',
          zipCode: '400001',
          isWhatsapp: true,
          whatsappNumber: '9111111111',
          parentName: 'Full Parent',
          parentPhone: '9222222222',
          parentEmail: 'parent@example.com',
          parentRelationship: 'Mother',
          parentOccupation: 'Doctor',
          alternatePhone: '9333333333',
          previousSchool: 'Old School',
          tcNumber: 'TC-FULL-001',
          medicalConditions: 'Asthma',
          emergencyContactName: 'Neighbor',
          emergencyContactPhone: '9444444444',
          transportRequired: true,
          hostelRequired: true,
        })
      )
      .expect(201);

    expect(res.body.name).toBe('Test Student');
  });

  it('accepts empty string for optional fields without error', async () => {
    const res = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send(
        validStudentPayload(classId, {
          admissionId: 'ADM-EMPTY-OPT',
          gender: '',
          bloodGroup: '',
          phone: '',
          email: '',
          aadhaarNumber: '',
        })
      )
      .expect(201);

    expect(res.body).toBeTruthy();
  });

  it('sequential creation of multiple students succeeds', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/students')
        .set(authHeaders)
        .send(
          validStudentPayload(classId, {
            admissionId: `ADM-MULTI-${i}`,
            rollNo: i + 1,
            name: `Multi Student ${i}`,
          })
        );
      expect(res.status).toBe(201);
    }

    // Verify all 5 are in the database
    const count = await Student.countDocuments({ admissionId: /^ADM-MULTI-/ });
    expect(count).toBe(5);
  });
});
