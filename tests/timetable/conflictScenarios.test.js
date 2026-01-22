import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Staff, Class, Timetable, TeacherTimetable } from '../../database.js';
import timetableService from '../../services/timetableService.js';
import conflictDetectionService from '../../services/conflictDetectionService.js';

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

// Helper function to create test data
async function createTestSetup() {
  const teacher = await Staff.create({
    code: 'T001',
    name: 'Test Teacher',
    role: 'Teacher',
    password: 'hashedpassword',
    teacherAssignments: [{ subject: 'Math', classes: [] }]
  });

  const class1 = await Class.create({
    name: 'Class 10',
    section: 'A',
    academicYear: '2024-25',
    assignedSubjects: ['Math']
  });

  const class2 = await Class.create({
    name: 'Class 10',
    section: 'B',
    academicYear: '2024-25',
    assignedSubjects: ['Math']
  });

  teacher.teacherAssignments[0].classes = [class1._id, class2._id];
  await teacher.save();

  const periods = Array.from({ length: 8 }, (_, i) => ({
    name: `Period ${i + 1}`,
    startTime: `${8 + i}:00`,
    endTime: `${9 + i}:00`,
    isBreak: false
  }));

  const schedule = {};
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  for (const d of days) {
    schedule[d] = Array.from({ length: 8 }, () => ({ subject: '', teacherId: null, room: '' }));
  }

  await Timetable.create({ classId: class1._id, academicYear: '2024-25', periods, schedule: JSON.parse(JSON.stringify(schedule)) });
  await Timetable.create({ classId: class2._id, academicYear: '2024-25', periods, schedule: JSON.parse(JSON.stringify(schedule)) });

  return { teacher, class1, class2, periods };
}

describe('Integration: Double Booking Prevention', () => {
  it('should prevent double booking when assigning teacher to two classes at same time', async () => {
    const { teacher, class1, class2 } = await createTestSetup();

    // Assign teacher to class1 at Monday Period 1
    await timetableService.syncTimetables({
      sourceType: 'class',
      sourceId: class1._id.toString(),
      day: 'Monday',
      periodIndex: 0,
      slotData: { subject: 'Math', teacherId: teacher._id, room: 'Room 101' },
      academicYear: '2024-25'
    });

    // Verify assignment succeeded
    const class1Timetable = await Timetable.findOne({ classId: class1._id });
    expect(class1Timetable.schedule.Monday[0].teacherId.toString()).toBe(teacher._id.toString());

    // Try to assign same teacher to class2 at same time - should detect conflict
    const validation = await conflictDetectionService.validateSlotAssignment(
      teacher._id.toString(),
      class2._id.toString(),
      'Math',
      'Monday',
      0
    );

    expect(validation.isValid).toBe(false);
    expect(validation.error.type).toBe('double_booking');
    expect(validation.error.teacherId.toString()).toBe(teacher._id.toString());
    expect(validation.error.day).toBe('Monday');
    expect(validation.error.periodIndex).toBe(0);
  });

  it('should prevent double booking across different days', async () => {
    const { teacher, class1, class2 } = await createTestSetup();

    // Assign teacher to multiple slots
    await timetableService.syncTimetables({
      sourceType: 'class',
      sourceId: class1._id.toString(),
      day: 'Monday',
      periodIndex: 0,
      slotData: { subject: 'Math', teacherId: teacher._id, room: 'Room 101' },
      academicYear: '2024-25'
    });

    await timetableService.syncTimetables({
      sourceType: 'class',
      sourceId: class1._id.toString(),
      day: 'Tuesday',
      periodIndex: 1,
      slotData: { subject: 'Math', teacherId: teacher._id, room: 'Room 102' },
      academicYear: '2024-25'
    });

    // Try to assign to class2 at Tuesday Period 2 (should succeed - different period)
    const validation1 = await conflictDetectionService.validateSlotAssignment(
      teacher._id.toString(),
      class2._id.toString(),
      'Math',
      'Tuesday',
      2
    );
    expect(validation1.isValid).toBe(true);

    // Try to assign to class2 at Tuesday Period 1 (should fail - same period)
    const validation2 = await conflictDetectionService.validateSlotAssignment(
      teacher._id.toString(),
      class2._id.toString(),
      'Math',
      'Tuesday',
      1
    );
    expect(validation2.isValid).toBe(false);
    expect(validation2.error.type).toBe('double_booking');
  });

  it('should allow same teacher in different periods on same day', async () => {
    const { teacher, class1, class2 } = await createTestSetup();

    // Assign teacher to class1 at Monday Period 1
    await timetableService.syncTimetables({
      sourceType: 'class',
      sourceId: class1._id.toString(),
      day: 'Monday',
      periodIndex: 0,
      slotData: { subject: 'Math', teacherId: teacher._id, room: 'Room 101' },
      academicYear: '2024-25'
    });

    // Assign same teacher to class2 at Monday Period 2 (different period - should succeed)
    const validation = await conflictDetectionService.validateSlotAssignment(
      teacher._id.toString(),
      class2._id.toString(),
      'Math',
      'Monday',
      1
    );

    expect(validation.isValid).toBe(true);

    await timetableService.syncTimetables({
      sourceType: 'class',
      sourceId: class2._id.toString(),
      day: 'Monday',
      periodIndex: 1,
      slotData: { subject: 'Math', teacherId: teacher._id, room: 'Room 102' },
      academicYear: '2024-25'
    });

    // Verify both assignments exist
    const class1Timetable = await Timetable.findOne({ classId: class1._id });
    const class2Timetable = await Timetable.findOne({ classId: class2._id });
    
    expect(class1Timetable.schedule.Monday[0].teacherId.toString()).toBe(teacher._id.toString());
    expect(class2Timetable.schedule.Monday[1].teacherId.toString()).toBe(teacher._id.toString());
  });

  it('should detect conflict when updating existing slot with conflicting teacher', async () => {
    const { teacher, class1, class2 } = await createTestSetup();

    const teacher2 = await Staff.create({
      code: 'T002',
      name: 'Teacher Two',
      role: 'Teacher',
      password: 'hashedpassword',
      teacherAssignments: [{ subject: 'Math', classes: [class2._id] }]
    });

    // Assign teacher to class1
    await timetableService.syncTimetables({
      sourceType: 'class',
      sourceId: class1._id.toString(),
      day: 'Wednesday',
      periodIndex: 2,
      slotData: { subject: 'Math', teacherId: teacher._id, room: 'Room 201' },
      academicYear: '2024-25'
    });

    // Assign teacher2 to class2
    await timetableService.syncTimetables({
      sourceType: 'class',
      sourceId: class2._id.toString(),
      day: 'Wednesday',
      periodIndex: 2,
      slotData: { subject: 'Math', teacherId: teacher2._id, room: 'Room 202' },
      academicYear: '2024-25'
    });

    // Try to update class2 slot to use teacher (who is already in class1) - should fail
    const validation = await conflictDetectionService.validateSlotAssignment(
      teacher._id.toString(),
      class2._id.toString(),
      'Math',
      'Wednesday',
      2
    );

    expect(validation.isValid).toBe(false);
    expect(validation.error.type).toBe('double_booking');
  });
});

describe('Integration: Unqualified Teacher Assignment Prevention', () => {
  it('should prevent assigning teacher to subject they are not qualified for', async () => {
    const teacher = await Staff.create({
      code: 'T001',
      name: 'Math Teacher',
      role: 'Teacher',
      password: 'hashedpassword',
      teacherAssignments: [{ subject: 'Math', classes: [] }]
    });

    const classDoc = await Class.create({
      name: 'Class 10',
      section: 'A',
      academicYear: '2024-25',
      assignedSubjects: ['Math', 'Physics']
    });

    teacher.teacherAssignments[0].classes = [classDoc._id];
    await teacher.save();

    const periods = Array.from({ length: 8 }, (_, i) => ({
      name: `Period ${i + 1}`,
      startTime: `${8 + i}:00`,
      endTime: `${9 + i}:00`,
      isBreak: false
    }));

    const schedule = {};
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    for (const d of days) {
      schedule[d] = Array.from({ length: 8 }, () => ({ subject: '', teacherId: null, room: '' }));
    }

    await Timetable.create({ classId: classDoc._id, academicYear: '2024-25', periods, schedule });

    // Try to assign teacher to Physics (not qualified) - should fail
    const validation = await conflictDetectionService.validateSlotAssignment(
      teacher._id.toString(),
      classDoc._id.toString(),
      'Physics',
      'Monday',
      0
    );

    expect(validation.isValid).toBe(false);
    expect(validation.error.type).toBe('unqualified');
    expect(validation.error.subject).toBe('Physics');
    expect(validation.error.teacherId.toString()).toBe(teacher._id.toString());
  });

  it('should prevent assigning teacher to class they are not assigned to', async () => {
    const teacher = await Staff.create({
      code: 'T001',
      name: 'Science Teacher',
      role: 'Teacher',
      password: 'hashedpassword',
      teacherAssignments: [{ subject: 'Science', classes: [] }]
    });

    const class1 = await Class.create({
      name: 'Class 9',
      section: 'A',
      academicYear: '2024-25',
      assignedSubjects: ['Science']
    });

    const class2 = await Class.create({
      name: 'Class 9',
      section: 'B',
      academicYear: '2024-25',
      assignedSubjects: ['Science']
    });

    // Only assign teacher to class1
    teacher.teacherAssignments[0].classes = [class1._id];
    await teacher.save();

    const periods = Array.from({ length: 8 }, (_, i) => ({
      name: `Period ${i + 1}`,
      startTime: `${8 + i}:00`,
      endTime: `${9 + i}:00`,
      isBreak: false
    }));

    const schedule = {};
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    for (const d of days) {
      schedule[d] = Array.from({ length: 8 }, () => ({ subject: '', teacherId: null, room: '' }));
    }

    await Timetable.create({ classId: class2._id, academicYear: '2024-25', periods, schedule });

    // Try to assign teacher to class2 (not assigned) - should fail
    const validation = await conflictDetectionService.validateSlotAssignment(
      teacher._id.toString(),
      class2._id.toString(),
      'Science',
      'Monday',
      0
    );

    expect(validation.isValid).toBe(false);
    expect(validation.error.type).toBe('unqualified');
  });

  it('should allow assignment when teacher is qualified for subject and class', async () => {
    const teacher = await Staff.create({
      code: 'T001',
      name: 'English Teacher',
      role: 'Teacher',
      password: 'hashedpassword',
      teacherAssignments: [{ subject: 'English', classes: [] }]
    });

    const classDoc = await Class.create({
      name: 'Class 8',
      section: 'A',
      academicYear: '2024-25',
      assignedSubjects: ['English']
    });

    teacher.teacherAssignments[0].classes = [classDoc._id];
    await teacher.save();

    const periods = Array.from({ length: 8 }, (_, i) => ({
      name: `Period ${i + 1}`,
      startTime: `${8 + i}:00`,
      endTime: `${9 + i}:00`,
      isBreak: false
    }));

    const schedule = {};
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    for (const d of days) {
      schedule[d] = Array.from({ length: 8 }, () => ({ subject: '', teacherId: null, room: '' }));
    }

    await Timetable.create({ classId: classDoc._id, academicYear: '2024-25', periods, schedule });

    // Should succeed - teacher is qualified
    const validation = await conflictDetectionService.validateSlotAssignment(
      teacher._id.toString(),
      classDoc._id.toString(),
      'English',
      'Monday',
      0
    );

    expect(validation.isValid).toBe(true);
  });
});

describe('Integration: Conflict Resolution Workflows', () => {
  it('should resolve conflict by removing one assignment', async () => {
    const { teacher, class1, class2 } = await createTestSetup();

    // Create conflicting assignments
    await timetableService.syncTimetables({
      sourceType: 'class',
      sourceId: class1._id.toString(),
      day: 'Thursday',
      periodIndex: 3,
      slotData: { subject: 'Math', teacherId: teacher._id, room: 'Room 301' },
      academicYear: '2024-25'
    });

    // Detect conflict
    const conflict = await conflictDetectionService.checkTeacherConflict(
      teacher._id.toString(),
      'Thursday',
      3,
      class2._id.toString()
    );

    expect(conflict).not.toBeNull();
    expect(conflict.type).toBe('double_booking');

    // Resolution: Remove teacher from class1
    await timetableService.deleteClassSlot({
      classId: class1._id,
      day: 'Thursday',
      periodIndex: 3,
      academicYear: '2024-25'
    });

    // Now assignment to class2 should succeed
    const validation = await conflictDetectionService.validateSlotAssignment(
      teacher._id.toString(),
      class2._id.toString(),
      'Math',
      'Thursday',
      3
    );

    expect(validation.isValid).toBe(true);

    await timetableService.syncTimetables({
      sourceType: 'class',
      sourceId: class2._id.toString(),
      day: 'Thursday',
      periodIndex: 3,
      slotData: { subject: 'Math', teacherId: teacher._id, room: 'Room 302' },
      academicYear: '2024-25'
    });

    // Verify resolution
    const class1Timetable = await Timetable.findOne({ classId: class1._id });
    const class2Timetable = await Timetable.findOne({ classId: class2._id });

    expect(class1Timetable.schedule.Thursday[3].teacherId).toBeFalsy();
    expect(class2Timetable.schedule.Thursday[3].teacherId.toString()).toBe(teacher._id.toString());
  });

  it('should resolve conflict by choosing different teacher', async () => {
    const { teacher, class1, class2 } = await createTestSetup();

    const teacher2 = await Staff.create({
      code: 'T002',
      name: 'Alternative Teacher',
      role: 'Teacher',
      password: 'hashedpassword',
      teacherAssignments: [{ subject: 'Math', classes: [class2._id] }]
    });

    // Assign teacher to class1
    await timetableService.syncTimetables({
      sourceType: 'class',
      sourceId: class1._id.toString(),
      day: 'Friday',
      periodIndex: 4,
      slotData: { subject: 'Math', teacherId: teacher._id, room: 'Room 401' },
      academicYear: '2024-25'
    });

    // Detect conflict if trying to use same teacher
    const conflict = await conflictDetectionService.checkTeacherConflict(
      teacher._id.toString(),
      'Friday',
      4,
      class2._id.toString()
    );

    expect(conflict).not.toBeNull();

    // Resolution: Use different teacher for class2
    const validation = await conflictDetectionService.validateSlotAssignment(
      teacher2._id.toString(),
      class2._id.toString(),
      'Math',
      'Friday',
      4
    );

    expect(validation.isValid).toBe(true);

    await timetableService.syncTimetables({
      sourceType: 'class',
      sourceId: class2._id.toString(),
      day: 'Friday',
      periodIndex: 4,
      slotData: { subject: 'Math', teacherId: teacher2._id, room: 'Room 402' },
      academicYear: '2024-25'
    });

    // Verify both classes have different teachers
    const class1Timetable = await Timetable.findOne({ classId: class1._id });
    const class2Timetable = await Timetable.findOne({ classId: class2._id });

    expect(class1Timetable.schedule.Friday[4].teacherId.toString()).toBe(teacher._id.toString());
    expect(class2Timetable.schedule.Friday[4].teacherId.toString()).toBe(teacher2._id.toString());
  });

  it('should handle conflict resolution through class switching', async () => {
    const { teacher, class1, class2 } = await createTestSetup();

    // Assign teacher to class1
    await timetableService.syncTimetables({
      sourceType: 'class',
      sourceId: class1._id.toString(),
      day: 'Monday',
      periodIndex: 5,
      slotData: { subject: 'Math', teacherId: teacher._id, room: 'Room 501' },
      academicYear: '2024-25'
    });

    // Switch teacher from class1 to class2
    const switchResult = await timetableService.switchClass({
      teacherId: teacher._id.toString(),
      oldClassId: class1._id.toString(),
      newClassId: class2._id.toString(),
      day: 'Monday',
      periodIndex: 5,
      subject: 'Math',
      room: 'Room 502',
      academicYear: '2024-25'
    });

    expect(switchResult.success).toBe(true);

    // Verify switch completed
    const class1Timetable = await Timetable.findOne({ classId: class1._id });
    const class2Timetable = await Timetable.findOne({ classId: class2._id });

    expect(class1Timetable.schedule.Monday[5].teacherId).toBeFalsy();
    expect(class2Timetable.schedule.Monday[5].teacherId.toString()).toBe(teacher._id.toString());

    // Verify teacher timetable updated
    const teacherTimetable = await TeacherTimetable.findOne({ teacherId: teacher._id });
    const teacherSlot = teacherTimetable.schedule.Monday.find(s => s.periodIndex === 5);
    expect(teacherSlot.classId.toString()).toBe(class2._id.toString());
  });

  it('should provide detailed conflict information for resolution', async () => {
    const { teacher, class1, class2 } = await createTestSetup();

    // Create conflict
    await timetableService.syncTimetables({
      sourceType: 'class',
      sourceId: class1._id.toString(),
      day: 'Tuesday',
      periodIndex: 6,
      slotData: { subject: 'Math', teacherId: teacher._id, room: 'Room 601' },
      academicYear: '2024-25'
    });

    // Get detailed conflict information
    const conflict = await conflictDetectionService.checkTeacherConflict(
      teacher._id.toString(),
      'Tuesday',
      6,
      class2._id.toString()
    );

    // Verify conflict details include all necessary information for resolution
    expect(conflict).not.toBeNull();
    expect(conflict.teacherName).toBe('Test Teacher');
    expect(conflict.teacherId.toString()).toBe(teacher._id.toString());
    expect(conflict.day).toBe('Tuesday');
    expect(conflict.periodIndex).toBe(6);
    expect(conflict.conflicts).toHaveLength(1);
    expect(conflict.conflicts[0].classId.toString()).toBe(class1._id.toString());
    expect(conflict.conflicts[0].className).toContain('Class 10');
    expect(conflict.conflicts[0].className).toContain('A');
    expect(conflict.message).toContain('Test Teacher');
    expect(conflict.message).toContain('Tuesday');
    expect(conflict.message).toContain('Period 7');
  });
});

describe('Integration: Concurrent Modification Handling', () => {
  it('should handle concurrent updates to same slot', async () => {
    const { teacher, class1 } = await createTestSetup();

    const teacher2 = await Staff.create({
      code: 'T002',
      name: 'Concurrent Teacher',
      role: 'Teacher',
      password: 'hashedpassword',
      teacherAssignments: [{ subject: 'Math', classes: [class1._id] }]
    });

    // Simulate concurrent updates
    const update1 = timetableService.syncTimetables({
      sourceType: 'class',
      sourceId: class1._id.toString(),
      day: 'Wednesday',
      periodIndex: 0,
      slotData: { subject: 'Math', teacherId: teacher._id, room: 'Room 101' },
      academicYear: '2024-25'
    });

    const update2 = timetableService.syncTimetables({
      sourceType: 'class',
      sourceId: class1._id.toString(),
      day: 'Wednesday',
      periodIndex: 0,
      slotData: { subject: 'Math', teacherId: teacher2._id, room: 'Room 102' },
      academicYear: '2024-25'
    });

    // Wait for both to complete
    const [result1, result2] = await Promise.all([update1, update2]);

    // Both should succeed (last write wins)
    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);

    // Verify final state
    const classTimetable = await Timetable.findOne({ classId: class1._id });
    expect(classTimetable.schedule.Wednesday[0].teacherId).toBeDefined();
  });

  it('should handle concurrent class switches', async () => {
    const { teacher, class1, class2 } = await createTestSetup();

    const class3 = await Class.create({
      name: 'Class 10',
      section: 'C',
      academicYear: '2024-25',
      assignedSubjects: ['Math']
    });

    teacher.teacherAssignments[0].classes.push(class3._id);
    await teacher.save();

    const periods = Array.from({ length: 8 }, (_, i) => ({
      name: `Period ${i + 1}`,
      startTime: `${8 + i}:00`,
      endTime: `${9 + i}:00`,
      isBreak: false
    }));

    const schedule = {};
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    for (const d of days) {
      schedule[d] = Array.from({ length: 8 }, () => ({ subject: '', teacherId: null, room: '' }));
    }

    await Timetable.create({ classId: class3._id, academicYear: '2024-25', periods, schedule });

    // Assign teacher to class1
    await timetableService.syncTimetables({
      sourceType: 'class',
      sourceId: class1._id.toString(),
      day: 'Thursday',
      periodIndex: 1,
      slotData: { subject: 'Math', teacherId: teacher._id, room: 'Room 201' },
      academicYear: '2024-25'
    });

    // Simulate concurrent switches
    const switch1 = timetableService.switchClass({
      teacherId: teacher._id.toString(),
      oldClassId: class1._id.toString(),
      newClassId: class2._id.toString(),
      day: 'Thursday',
      periodIndex: 1,
      subject: 'Math',
      room: 'Room 202',
      academicYear: '2024-25'
    });

    const switch2 = timetableService.switchClass({
      teacherId: teacher._id.toString(),
      oldClassId: class1._id.toString(),
      newClassId: class3._id.toString(),
      day: 'Thursday',
      periodIndex: 1,
      subject: 'Math',
      room: 'Room 203',
      academicYear: '2024-25'
    });

    // Wait for both
    const results = await Promise.allSettled([switch1, switch2]);

    // At least one should succeed
    const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    expect(successCount).toBeGreaterThanOrEqual(1);
  });

  it('should maintain consistency during rapid updates', async () => {
    const { teacher, class1 } = await createTestSetup();

    // Perform rapid sequential updates (not parallel to avoid race conditions)
    for (let i = 0; i < 5; i++) {
      await timetableService.syncTimetables({
        sourceType: 'class',
        sourceId: class1._id.toString(),
        day: 'Friday',
        periodIndex: 2,
        slotData: { subject: 'Math', teacherId: teacher._id, room: `Room ${100 + i}` },
        academicYear: '2024-25'
      });
    }

    // Verify final state is consistent
    const classTimetable = await Timetable.findOne({ classId: class1._id });
    const teacherTimetable = await TeacherTimetable.findOne({ teacherId: teacher._id });

    expect(classTimetable.schedule.Friday[2].teacherId.toString()).toBe(teacher._id.toString());
    expect(classTimetable.schedule.Friday[2].room).toBe('Room 104'); // Last update
    
    const teacherSlot = teacherTimetable.schedule.Friday.find(s => s.periodIndex === 2);
    expect(teacherSlot).toBeDefined();
    expect(teacherSlot.classId.toString()).toBe(class1._id.toString());
  });

  it('should handle version conflicts gracefully', async () => {
    const { teacher, class1 } = await createTestSetup();

    // Get initial timetable
    const initialTimetable = await Timetable.findOne({ classId: class1._id });
    const initialVersion = initialTimetable.version || 1;

    // Update timetable
    await timetableService.syncTimetables({
      sourceType: 'class',
      sourceId: class1._id.toString(),
      day: 'Saturday',
      periodIndex: 3,
      slotData: { subject: 'Math', teacherId: teacher._id, room: 'Room 301' },
      academicYear: '2024-25'
    });

    // Verify version incremented
    const updatedTimetable = await Timetable.findOne({ classId: class1._id });
    expect(updatedTimetable.version).toBeGreaterThan(initialVersion);
  });
});
