import mongoose from 'mongoose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Attendance, ChapterProgress, Class, Result, Student } from '../database.js';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import { createTestApp } from './helpers/testApp.js';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
} from './helpers/factories.js';

async function setup(label) {
  const school = await createSchoolRecord({
    name: `Phase 2 ${label}`,
    code: `P2-${label}-${new mongoose.Types.ObjectId().toString().slice(-5)}`,
  });
  const admin = await createStaffUser({ schoolId: school._id });
  return { school, admin, headers: authHeadersFor(admin, 'admin'), app: createTestApp().app };
}

describe('Students and Classes phase 2 flows', () => {
  it('validates siblings without crashing and allows external-school siblings', async () => {
    const { school, headers, app } = await setup('SIBLINGS');
    const classDoc = await createClassRecord({ schoolId: school._id });
    const payload = {
      name: 'Sibling Student',
      admissionId: 'SIB-001',
      academicYear: '2026-27',
      classId: classDoc._id.toString(),
      parents: [{ name: 'Parent', relationship: 'father', phone: '9876543210' }],
    };

    const invalid = await request(app)
      .post('/api/students')
      .set(headers)
      .send({ ...payload, siblings: [{ name: 'Same School', inSameSchool: true }] })
      .expect(400);
    expect(invalid.body.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'siblings.0.classId' })])
    );

    await request(app)
      .post('/api/students')
      .set(headers)
      .send({
        ...payload,
        admissionId: 'SIB-002',
        siblings: [{ name: 'Elsewhere', inSameSchool: false }],
      })
      .expect(201);
  });

  it('accepts numeric document sizes and a single uploaded Aadhaar side', async () => {
    const { school, headers, app } = await setup('DOCS');
    const classDoc = await createClassRecord({ schoolId: school._id });
    const response = await request(app)
      .post('/api/students')
      .set(headers)
      .send({
        name: 'Document Student',
        admissionId: 'DOC-001',
        academicYear: '2026-27',
        classId: classDoc._id.toString(),
        parents: [{ name: 'Parent', relationship: 'mother', phone: '9876543210' }],
        documents: [
          {
            id: 'aadhaar-front',
            name: 'Aadhaar Card',
            type: 'image/jpeg',
            category: 'aadhaarCard',
            size: 2048,
            front: { url: 'https://example.com/aadhaar-front.jpg' },
          },
        ],
      })
      .expect(201);

    const saved = await Student.findById(response.body.id).lean();
    expect(saved.documents[0].size).toBe(2048);
    expect(saved.documents[0].front.url).toContain('aadhaar-front');
  });

  it('supports comma-separated status, year, and fee filters', async () => {
    const { school, headers, app } = await setup('FILTERS');
    const classDoc = await createClassRecord({ schoolId: school._id });
    const graduated = await createStudentRecord({
      schoolId: school._id,
      classId: classDoc._id,
      academicYear: '2025-26',
      status: 'graduated',
    });
    const transferred = await createStudentRecord({
      schoolId: school._id,
      classId: classDoc._id,
      academicYear: '2026-27',
      status: 'transferred',
    });
    await StudentFeeStructure.create([
      {
        schoolId: school._id,
        studentId: graduated._id,
        classId: classDoc._id,
        academicYear: '2025-26',
        overallStatus: 'paid',
      },
      {
        schoolId: school._id,
        studentId: transferred._id,
        classId: classDoc._id,
        academicYear: '2026-27',
        overallStatus: 'overdue',
      },
    ]);

    const response = await request(app)
      .get(
        '/api/students?status=graduated,transferred&academicYear=2025-26,2026-27&feeStatus=paid,overdue'
      )
      .set(headers)
      .expect(200);
    expect(response.body.data.map((student) => student.status).sort()).toEqual([
      'graduated',
      'transferred',
    ]);

    await request(app).get('/api/students?status=unknown').set(headers).expect(400);
  });

  it('merges nested partial edits instead of erasing omitted health fields', async () => {
    const { school, headers, app } = await setup('NESTED');
    const classDoc = await createClassRecord({ schoolId: school._id });
    const student = await createStudentRecord({ schoolId: school._id, classId: classDoc._id });
    student.healthInfo = {
      allergies: [{ name: 'Dust' }],
      medications: [{ name: 'Inhaler', dosage: '1 puff' }],
      emergencyContacts: [{ name: 'Guardian', phone: '9876543210' }],
    };
    await student.save();

    await request(app)
      .put(`/api/students/${student._id}`)
      .set(headers)
      .send({ healthInfo: { allergies: [{ name: 'Pollen' }] } })
      .expect(200);

    const saved = await Student.findById(student._id).lean();
    expect(saved.healthInfo.allergies[0].name).toBe('Pollen');
    expect(saved.healthInfo.medications[0].name).toBe('Inhaler');
    expect(saved.healthInfo.emergencyContacts[0].name).toBe('Guardian');
  });

  it('moves the student and same-year attendance atomically on a class change', async () => {
    const { school, admin, headers, app } = await setup('CLASS-MOVE');
    const sourceClass = await createClassRecord({ schoolId: school._id });
    const targetClass = await createClassRecord({
      schoolId: school._id,
      name: 'Class 11',
    });
    const student = await createStudentRecord({ schoolId: school._id, classId: sourceClass._id });
    const attendance = await Attendance.create({
      schoolId: school._id,
      classId: sourceClass._id,
      studentId: student._id,
      date: '2025-07-10',
      status: 'present',
      markedBy: admin._id,
    });

    await request(app)
      .put(`/api/students/${student._id}`)
      .set(headers)
      .send({ classId: targetClass._id.toString() })
      .expect(200);

    expect((await Student.findById(student._id)).classId.toString()).toBe(
      targetClass._id.toString()
    );
    expect((await Attendance.findById(attendance._id)).classId.toString()).toBe(
      targetClass._id.toString()
    );
  });

  it('returns complete paginated class rosters beyond 50 students', async () => {
    const { school, headers, app } = await setup('ROSTER');
    const classDoc = await createClassRecord({ schoolId: school._id });
    const rows = Array.from({ length: 55 }, (_, index) => ({
      schoolId: school._id,
      classId: classDoc._id,
      name: `Student ${index + 1}`,
      admissionId: `ROSTER-${index + 1}`,
      academicYear: '2026-27',
      rollNo: index + 1,
      parents: [{ name: 'Parent', relationship: 'parent' }],
      status: 'active',
    }));
    await Student.insertMany(rows);

    const first = await request(app)
      .get(`/api/classes/${classDoc._id}/students?skip=0&limit=50`)
      .set(headers)
      .expect(200);
    const second = await request(app)
      .get(`/api/classes/${classDoc._id}/students?skip=50&limit=50`)
      .set(headers)
      .expect(200);
    expect(first.body.students).toHaveLength(50);
    expect(first.body.hasMore).toBe(true);
    expect(second.body.students).toHaveLength(5);
    expect(second.body.hasMore).toBe(false);
  });

  it("reports today's attendance snapshot even when the rate is zero", async () => {
    const { school, admin, headers, app } = await setup('TODAY');
    const classDoc = await createClassRecord({ schoolId: school._id });
    const student = await createStudentRecord({ schoolId: school._id, classId: classDoc._id });
    await Attendance.create({
      schoolId: school._id,
      classId: classDoc._id,
      studentId: student._id,
      date: '2026-03-31',
      status: 'absent',
      markedBy: admin._id,
    });

    const response = await request(app).get('/api/classes').set(headers).expect(200);
    expect(response.body[0]).toMatchObject({
      attendanceMarkedToday: true,
      averageAttendance: 0,
      attendanceMarkedCount: 1,
    });
  });

  it('keeps class performance scoped to the requested academic year', async () => {
    const { school, headers, app } = await setup('CLASS-PERFORMANCE-YEAR');
    const classDoc = await createClassRecord({ schoolId: school._id, academicYear: '2026-27' });
    const student = await createStudentRecord({
      schoolId: school._id,
      classId: classDoc._id,
      academicYear: '2026-27',
    });
    await Result.create([
      {
        schoolId: school._id,
        examId: new mongoose.Types.ObjectId(),
        studentId: student._id,
        classId: classDoc._id,
        academicYear: '2026-27',
        marksObtained: 80,
        maxMarks: 100,
        isPublished: true,
      },
      {
        schoolId: school._id,
        examId: new mongoose.Types.ObjectId(),
        studentId: student._id,
        classId: classDoc._id,
        academicYear: '2025-26',
        marksObtained: 20,
        maxMarks: 100,
        isPublished: true,
      },
    ]);

    const response = await request(app)
      .get('/api/classes?academicYear=2026-27')
      .set(headers)
      .expect(200);
    expect(response.body[0].averageAcademicPerformance).toBe(80);

    await request(app).get('/api/classes?academicYear=2026').set(headers).expect(400);
    await request(app).get('/api/classes?teacherId=not-an-object-id').set(headers).expect(400);
  });

  it('updates and deletes the intended nested chapter entry', async () => {
    const { school, admin, headers, app } = await setup('CHAPTERS');
    const classDoc = await createClassRecord({ schoolId: school._id });
    const progress = await ChapterProgress.create({
      schoolId: school._id,
      classId: classDoc._id,
      subjectName: 'Science',
      teacherId: admin._id,
      academicYear: '2026-27',
      chapters: [
        { chapterName: 'Cells', chapterNumber: 1, progressPercentage: 10 },
        { chapterName: 'Plants', chapterNumber: 2, progressPercentage: 20 },
      ],
    });
    const chapterId = progress.chapters[0]._id;

    await request(app)
      .put(`/api/classes-enhanced/chapters/${progress._id}`)
      .set(headers)
      .send({ chapterEntryId: chapterId.toString(), progressPercentage: 80, status: 'completed' })
      .expect(200);
    let saved = await ChapterProgress.findById(progress._id);
    expect(saved.chapters.id(chapterId).progressPercentage).toBe(80);
    expect(saved.toObject()).not.toHaveProperty('status');

    await request(app)
      .delete(`/api/classes-enhanced/chapters/${progress._id}/${chapterId}`)
      .set(headers)
      .expect(200);
    saved = await ChapterProgress.findById(progress._id);
    expect(saved.chapters.id(chapterId)).toBeNull();
    expect(saved.chapters).toHaveLength(1);
  });

  it('rolls back every section when a bulk class create contains a conflict', async () => {
    const { school, headers, app } = await setup('CLASS-BULK');
    await createClassRecord({
      schoolId: school._id,
      name: 'Class 9',
      section: 'B',
      academicYear: '2026-27',
    });
    const teacherA = await createStaffUser({ schoolId: school._id, staffRole: ['Teacher'] });
    const teacherB = await createStaffUser({ schoolId: school._id, staffRole: ['Teacher'] });

    await request(app)
      .post('/api/classes/bulk')
      .set(headers)
      .send({
        classes: [
          {
            name: 'Class 9',
            section: 'A',
            academicYear: '2026-27',
            classTeacherId: teacherA._id.toString(),
            subjects: [],
          },
          {
            name: 'Class 9',
            section: 'B',
            academicYear: '2026-27',
            classTeacherId: teacherB._id.toString(),
            subjects: [],
          },
        ],
      })
      .expect(409);

    expect(
      await Class.countDocuments({
        schoolId: school._id,
        name: 'Class 9',
        section: 'A',
        academicYear: '2026-27',
      })
    ).toBe(0);
  });
});
