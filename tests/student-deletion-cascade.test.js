import request from 'supertest';
import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import {
  Attendance,
  ChapterProgress,
  ClassAnnouncement,
  Conversation,
  Exam,
  FeePayment,
  FeeRefund,
  FeeStructure,
  FormSubmission,
  GatePass,
  Message,
  Notification,
  Remark,
  Result,
  Student,
  StudentFeeStructure,
  TransportRoute,
  Visitor,
} from '../database.js';
import BookIssue from '../models/BookIssue.js';
import ConsentRecord from '../models/ConsentRecord.js';
import Homework from '../models/Homework.js';
import NotificationPreference from '../models/NotificationPreference.js';
import Parent from '../models/Parent.js';
import PTMSession from '../models/PTMSession.js';
import TrashItem from '../models/TrashItem.js';
import {
  authHeadersFor,
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';
import { piiMatch } from '../utils/encryption.js';

describe('E2E-12: Student deletion → cascade cleanup → data consistency', () => {
  it('permanently deletes student and all associated records across all collections', async () => {
    const school = await createSchoolRecord({ name: 'Cascade Test School' });
    const admin = await createStaffUser({ schoolId: school._id });
    const classRecord = await createClassRecord({ schoolId: school._id });
    const feeClass = await createClassRecord({
      name: 'Class 11',
      section: 'B',
      schoolId: school._id,
    });
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(admin, 'admin');

    const createRes = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send({
        name: 'Cascade Student',
        admissionId: 'ADM-CASCADE-001',
        academicYear: '2025-26',
        rollNo: 1,
        classId: classRecord._id.toString(),
        parents: [
          { name: 'Cascade Parent', relationship: 'mother', phone: '9900000001', isWhatsapp: true },
        ],
      })
      .expect(201);

    const studentId = createRes.body.id;
    const sid = new mongoose.Types.ObjectId(studentId);

    // Attendance
    await Attendance.create({
      studentId: sid,
      classId: classRecord._id,
      date: '2025-03-01',
      status: 'present',
    });

    // Result (requires an Exam)
    const exam = await Exam.create({
      schoolId: school._id,
      name: 'Unit Test 1',
      classId: classRecord._id,
    });
    await Result.create({
      schoolId: school._id,
      examId: exam._id,
      studentId: sid,
      classId: classRecord._id,
      academicYear: '2025-26',
    });

    // Remark
    await Remark.create({
      schoolId: school._id,
      studentId: sid,
      title: 'Good behaviour',
      description: 'Excellent student',
      category: 'general',
      authorId: admin._id,
      authorName: admin.name,
    });

    // StudentFeeStructure
    await StudentFeeStructure.create({
      studentId: sid,
      classId: classRecord._id,
      academicYear: '2025-26',
      feeHeads: [],
      schoolId: school._id,
    });

    // FeePayment
    await FeePayment.create({
      schoolId: school._id,
      studentId: sid,
      classId: classRecord._id,
      academicYear: '2025-26',
      receiptNumber: 'RCP-CASCADE-001',
      paymentDate: '2025-03-01',
      amount: 5000,
      paymentMode: 'cash',
    });

    // FeeRefund
    await FeeRefund.create({
      schoolId: school._id,
      studentId: sid,
      classId: classRecord._id,
      academicYear: '2025-26',
      refundNumber: 'RFD-CASCADE-001',
      refundDate: '2025-03-02',
      amount: 500,
      reason: 'Overpaid',
      refundMode: 'cash',
    });

    // FormSubmission (studentId is optional reference field — no required fields block it)
    await FormSubmission.create({
      assignmentId: new mongoose.Types.ObjectId(),
      formId: new mongoose.Types.ObjectId(),
      studentId: sid,
      submissionData: { name: 'Cascade Student' },
    });

    // GatePass
    await GatePass.create({
      schoolId: school._id,
      studentId: sid,
      studentName: 'Cascade Student',
      class: '10',
      section: 'A',
      reason: 'MEDICAL_EMERGENCY',
      leavingDate: new Date(),
      leavingTime: '10:00',
      leavingWith: 'PARENTS',
      approvedBy: 'CLASS_TEACHER',
      approvedByStaffId: admin._id,
      approvedByName: admin.name,
      requestedById: admin._id,
      requestedByName: admin.name,
    });

    // Visitor log
    await Visitor.create({
      schoolId: school._id,
      studentId: sid,
      visitorName: 'Visitor Person',
      phoneNumber: '9000000099',
      reasonForVisit: 'STUDENT_PICKUP_DROP_OFF',
      checkedInBy: admin._id,
    });

    // Conversation + Message
    const conversation = await Conversation.create({
      schoolId: school._id,
      participants: [
        { userId: sid, userModel: 'Student', name: 'Cascade Student' },
        { userId: admin._id, userModel: 'Staff', name: admin.name },
      ],
      type: 'direct',
    });
    await Message.create({
      schoolId: school._id,
      conversationId: conversation._id,
      senderId: sid,
      senderModel: 'Student',
      receiverId: admin._id,
      receiverModel: 'Staff',
      content: 'Hello',
    });

    // Homework submission (embedded array)
    await Homework.create({
      schoolId: school._id,
      title: 'Cascade HW',
      description: 'Do it',
      subject: 'Math',
      classId: classRecord._id,
      teacherId: admin._id,
      dueDate: new Date('2025-04-01'),
      submissions: [{ studentId: sid, remarks: 'Done' }],
    });

    // ClassAnnouncement recipient (embedded array)
    await ClassAnnouncement.create({
      schoolId: school._id,
      classId: classRecord._id,
      title: 'Cascade Notice',
      description: 'Test announcement',
      sentBy: admin._id,
      recipients: [{ studentId: sid }],
    });

    // ChapterProgress assignedStudents (embedded array)
    await ChapterProgress.create({
      schoolId: school._id,
      classId: classRecord._id,
      subjectName: 'Science',
      teacherId: admin._id,
      assignedStudents: [sid],
    });

    // FeeStructure appliedTo (embedded array) — uses a separate class to avoid unique index conflict
    await FeeStructure.create({
      schoolId: school._id,
      classId: feeClass._id,
      academicYear: '2025-26',
      appliedTo: [sid],
      feeHeads: [],
    });

    // Notification
    await Notification.create({
      userId: sid,
      userModel: 'Student',
      type: 'attendance',
      title: 'Attendance Alert',
      message: 'You were absent today',
    });

    // NotificationPreference
    await NotificationPreference.create({
      userId: sid,
      userModel: 'Student',
      role: 'student',
      preferences: [],
    });

    // BookIssue
    await BookIssue.create({
      schoolId: school._id,
      bookId: new mongoose.Types.ObjectId(),
      bookTitle: 'Test Book',
      studentId: sid,
      studentName: 'Cascade Student',
      issueDate: new Date(),
      dueDate: new Date('2025-04-30'),
    });

    // TransportRoute student assignment (embedded array)
    await TransportRoute.create({
      schoolId: school._id,
      routeName: 'Route 1',
      routeNumber: 'R-CASCADE-01',
      academicYear: '2025-26',
      students: [{ studentId: sid }],
    });

    // PTMSession slot (embedded array)
    await PTMSession.create({
      schoolId: school._id,
      title: 'PTM March',
      sessionDate: new Date('2025-03-10'),
      startTime: '09:00',
      endTime: '13:00',
      classId: classRecord._id,
      staffId: admin._id,
      slots: [{ studentId: sid, parentName: 'Cascade Parent', scheduledTime: '09:30' }],
    });

    // ConsentRecord
    await ConsentRecord.create({
      schoolId: school._id,
      entityType: 'Student',
      entityId: sid,
      consentType: 'data_collection',
      granted: true,
      grantedAt: new Date(),
    });

    // TrashItem
    await TrashItem.create({
      itemType: 'Student',
      itemId: sid,
      itemName: 'Cascade Student',
      deletedBy: admin._id,
      schoolId: school._id,
      restoreStrategy: 'soft-delete',
      modelName: 'Student',
      softDeleteField: 'isDeleted',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      originalData: { name: 'Cascade Student' },
    });

    // --- Delete the student ---
    const deleteRes = await request(app)
      .delete(`/api/students/${studentId}`)
      .set(authHeaders)
      .expect(200);

    expect(deleteRes.body.success).toBe(true);
    expect(deleteRes.body.deletedStudentId).toBe(studentId);

    // --- Verify direct deletions ---
    expect(await Student.findById(sid).lean()).toBeNull();
    expect(await Attendance.countDocuments({ studentId: sid })).toBe(0);
    expect(await Result.countDocuments({ studentId: sid })).toBe(0);
    expect(await Remark.countDocuments({ studentId: sid })).toBe(0);
    expect(await StudentFeeStructure.countDocuments({ studentId: sid })).toBe(0);
    expect(await FeePayment.countDocuments({ studentId: sid })).toBe(0);
    expect(await FeeRefund.countDocuments({ studentId: sid })).toBe(0);
    expect(await FormSubmission.countDocuments({ studentId: sid })).toBe(0);
    expect(await GatePass.countDocuments({ studentId: sid })).toBe(0);
    expect(await Visitor.countDocuments({ studentId: sid })).toBe(0);
    expect(await Message.countDocuments({ senderId: sid, senderModel: 'Student' })).toBe(0);
    expect(await Conversation.countDocuments({ 'participants.userId': sid })).toBe(0);
    expect(await Notification.countDocuments({ userId: sid, userModel: 'Student' })).toBe(0);
    expect(await NotificationPreference.countDocuments({ userId: sid, userModel: 'Student' })).toBe(
      0
    );
    expect(await BookIssue.countDocuments({ studentId: sid })).toBe(0);
    expect(await ConsentRecord.countDocuments({ entityId: sid, entityType: 'Student' })).toBe(0);
    expect(await TrashItem.countDocuments({ itemId: sid, itemType: 'Student' })).toBe(0);

    // --- Verify $pull operations (student reference removed from embedded arrays) ---
    const homework = await Homework.findOne({ title: 'Cascade HW' }).lean();
    expect(homework?.submissions).toHaveLength(0);

    const announcement = await ClassAnnouncement.findOne({ title: 'Cascade Notice' }).lean();
    expect(announcement?.recipients).toHaveLength(0);

    const chapter = await ChapterProgress.findOne({
      subjectName: 'Science',
      classId: classRecord._id,
    }).lean();
    expect(chapter?.assignedStudents).toHaveLength(0);

    const feeStructure = await FeeStructure.findOne({ classId: feeClass._id }).lean();
    expect(feeStructure?.appliedTo).toHaveLength(0);

    const transport = await TransportRoute.findOne({ routeNumber: 'R-CASCADE-01' }).lean();
    expect(transport?.students).toHaveLength(0);

    const ptm = await PTMSession.findOne({ title: 'PTM March' }).lean();
    expect(ptm?.slots).toHaveLength(0);

    // --- Verify orphaned parent account is deleted ---
    expect(await Parent.findOne(piiMatch('phone', '9900000001')).lean()).toBeNull();
  });

  it('retains parent account when parent still has other children after deletion', async () => {
    const school = await createSchoolRecord({ name: 'Multi-Child School' });
    const admin = await createStaffUser({ schoolId: school._id });
    const classRecord = await createClassRecord({ schoolId: school._id });
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(admin, 'admin');

    const sharedParent = [
      { name: 'Shared Parent', relationship: 'father', phone: '9900000002', isWhatsapp: true },
    ];

    const res1 = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send({
        name: 'Child One',
        admissionId: 'ADM-CHILD-001',
        academicYear: '2025-26',
        rollNo: 1,
        classId: classRecord._id.toString(),
        parents: sharedParent,
      })
      .expect(201);

    const res2 = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send({
        name: 'Child Two',
        admissionId: 'ADM-CHILD-002',
        academicYear: '2025-26',
        rollNo: 2,
        classId: classRecord._id.toString(),
        parents: sharedParent,
      })
      .expect(201);

    const parentBefore = await Parent.findOne(piiMatch('phone', '9900000002')).lean();
    expect(parentBefore?.children).toHaveLength(2);

    // Delete only Child One
    const deleteRes = await request(app)
      .delete(`/api/students/${res1.body.id}`)
      .set(authHeaders)
      .expect(200);

    expect(deleteRes.body.deletedRecords.parentAccountsDeleted).toBe(0);

    // Parent retained with Child Two still linked
    const parentAfter = await Parent.findOne(piiMatch('phone', '9900000002')).lean();
    expect(parentAfter).not.toBeNull();
    expect(parentAfter?.children).toHaveLength(1);
    expect(parentAfter?.children[0].studentId.toString()).toBe(res2.body.id);

    // Child Two still exists
    expect(await Student.findById(res2.body.id).lean()).not.toBeNull();
  });

  it('returns 404 when a cross-school admin attempts to delete another school student', async () => {
    const schoolA = await createSchoolRecord({ name: 'School Alpha' });
    const schoolB = await createSchoolRecord({ name: 'School Beta' });
    const adminB = await createStaffUser({ schoolId: schoolB._id });
    const classRecord = await createClassRecord({ schoolId: schoolA._id });
    const { app } = createTestApp();
    const authHeadersB = authHeadersFor(adminB, 'admin');

    const studentA = await createStudentRecord({ classId: classRecord._id, schoolId: schoolA._id });

    await request(app)
      .delete(`/api/students/${studentA._id.toString()}`)
      .set(authHeadersB)
      .expect(404);

    // Student from School A is untouched
    expect(await Student.findById(studentA._id).lean()).not.toBeNull();
  });

  it('returns 404 when attempting to delete an already-deleted student', async () => {
    const admin = await createStaffUser();
    const classRecord = await createClassRecord();
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(admin, 'admin');

    const student = await createStudentRecord({ classId: classRecord._id });
    const studentId = student._id.toString();

    await request(app).delete(`/api/students/${studentId}`).set(authHeaders).expect(200);
    await request(app).delete(`/api/students/${studentId}`).set(authHeaders).expect(404);
  });

  it('deletedRecords counts accurately reflect number of records removed', async () => {
    const school = await createSchoolRecord({ name: 'Count Verification School' });
    const admin = await createStaffUser({ schoolId: school._id });
    const classRecord = await createClassRecord({ schoolId: school._id });
    const { app } = createTestApp();
    const authHeaders = authHeadersFor(admin, 'admin');

    const createRes = await request(app)
      .post('/api/students')
      .set(authHeaders)
      .send({
        name: 'Count Student',
        admissionId: 'ADM-COUNT-001',
        academicYear: '2025-26',
        rollNo: 1,
        classId: classRecord._id.toString(),
        parents: [
          { name: 'Count Parent', relationship: 'father', phone: '9900000003', isWhatsapp: true },
        ],
      })
      .expect(201);

    const studentId = createRes.body.id;
    const sid = new mongoose.Types.ObjectId(studentId);

    // Create exactly 2 attendance records
    await Attendance.create([
      { studentId: sid, classId: classRecord._id, date: '2025-03-01', status: 'present' },
      { studentId: sid, classId: classRecord._id, date: '2025-03-02', status: 'absent' },
    ]);

    // Create exactly 3 remarks
    await Remark.create([
      {
        schoolId: school._id,
        studentId: sid,
        title: 'Remark 1',
        description: 'Good',
        category: 'general',
        authorId: admin._id,
        authorName: admin.name,
      },
      {
        schoolId: school._id,
        studentId: sid,
        title: 'Remark 2',
        description: 'Better',
        category: 'general',
        authorId: admin._id,
        authorName: admin.name,
      },
      {
        schoolId: school._id,
        studentId: sid,
        title: 'Remark 3',
        description: 'Best',
        category: 'general',
        authorId: admin._id,
        authorName: admin.name,
      },
    ]);

    // Create 2 fee payments
    await FeePayment.create([
      {
        schoolId: school._id,
        studentId: sid,
        classId: classRecord._id,
        academicYear: '2025-26',
        receiptNumber: 'RCP-CNT-001',
        paymentDate: '2025-03-01',
        amount: 1000,
        paymentMode: 'cash',
      },
      {
        schoolId: school._id,
        studentId: sid,
        classId: classRecord._id,
        academicYear: '2025-26',
        receiptNumber: 'RCP-CNT-002',
        paymentDate: '2025-03-02',
        amount: 2000,
        paymentMode: 'online',
      },
    ]);

    const deleteRes = await request(app)
      .delete(`/api/students/${studentId}`)
      .set(authHeaders)
      .expect(200);

    const { deletedRecords } = deleteRes.body;
    expect(deletedRecords.students).toBe(1);
    expect(deletedRecords.attendance).toBe(2);
    expect(deletedRecords.remarks).toBe(3);
    expect(deletedRecords.feePayments).toBe(2);
    expect(deletedRecords.parentAccountsDeleted).toBe(1);
  });
});
