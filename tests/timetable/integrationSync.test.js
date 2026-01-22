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
async function createTestData() {
  const teacher = await Staff.create({
    code: 'T001',
    name: 'Test Teacher',
    role: 'Teacher',
    password: 'hashedpassword',
    teacherAssignments: [{ subject: 'Math', classes: [] }]
  });

  const classDoc = await Class.create({
    name: 'Class 10',
    section: 'A',
    academicYear: '2024-25',
    assignedSubjects: ['Math']
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

  return { teacher, classDoc };
}

describe('Integration: Class to Teacher Timetable Sync', () => {
  it('should sync complete class timetable update to teacher timetable', async () => {
    const { teacher, classDoc } = await createTestData();

    await timetableService.syncTimetables({
      sourceType: 'class',
      sourceId: classDoc._id.toString(),
      day: 'Monday',
      periodIndex: 0,
      slotData: { subject: 'Math', teacherId: teacher._id, room: 'Room 101' },
      academicYear: '2024-25'
    });

    const teacherTimetable = await TeacherTimetable.findOne({
      teacherId: teacher._id,
      academicYear: '2024-25'
    });

    expect(teacherTimetable).toBeTruthy();
    expect(teacherTimetable.schedule.Monday.length).toBe(1);
    expect(teacherTimetable.schedule.Monday[0].classId.toString()).toBe(classDoc._id.toString());
    expect(teacherTimetable.schedule.Monday[0].subject).toBe('Math');
  });

  it('should handle updating slot with different teacher', async () => {
    const { teacher, classDoc } = await createTestData();

    const teacher2 = await Staff.create({
      code: 'T002',
      name: 'Teacher Two',
      role: 'Teacher',
      password: 'hashedpassword',
      teacherAssignments: [{ subject: 'Math', classes: [classDoc._id] }]
    });

    await timetableService.syncTimetables({
      sourceType: 'class',
      sourceId: classDoc._id.toString(),
      day: 'Monday',
      periodIndex: 0,
      slotData: { subject: 'Math', teacherId: teacher._id, room: 'Room 101' },
      academicYear: '2024-25'
    });

    await timetableService.syncTimetables({
      sourceType: 'class',
      sourceId: classDoc._id.toString(),
      day: 'Monday',
      periodIndex: 0,
      slotData: { subject: 'Math', teacherId: teacher2._id, room: 'Room 102' },
      academicYear: '2024-25'
    });

    const teacher1Timetable = await TeacherTimetable.findOne({ teacherId: teacher._id, academicYear: '2024-25' });
    const teacher1Slot = teacher1Timetable.schedule.Monday.find(s => s.periodIndex === 0);
    expect(teacher1Slot).toBeFalsy();

    const teacher2Timetable = await TeacherTimetable.findOne({ teacherId: teacher2._id, academicYear: '2024-25' });
    expect(teacher2Timetable.schedule.Monday[0].classId.toString()).toBe(classDoc._id.toString());
  });
});

describe('Integration: Teacher to Class Timetable Sync', () => {
  it('should sync complete teacher timetable update to class timetable', async () => {
    const { teacher, classDoc } = await createTestData();

    await timetableService.syncTimetables({
      sourceType: 'teacher',
      sourceId: teacher._id.toString(),
      day: 'Tuesday',
      periodIndex: 1,
      slotData: { classId: classDoc._id, subject: 'Math', room: 'Room 201' },
      academicYear: '2024-25'
    });

    const classTimetable = await Timetable.findOne({ classId: classDoc._id, academicYear: '2024-25' });
    expect(classTimetable.schedule.Tuesday[1].teacherId.toString()).toBe(teacher._id.toString());
    expect(classTimetable.schedule.Tuesday[1].subject).toBe('Math');
  });

  it('should sync teacher updates to multiple classes', async () => {
    const teacher = await Staff.create({
      code: 'T001',
      name: 'Multi Teacher',
      role: 'Teacher',
      password: 'hashedpassword',
      teacherAssignments: [{ subject: 'English', classes: [] }]
    });

    const class1 = await Class.create({ name: 'Class 8', section: 'A', academicYear: '2024-25' });
    const class2 = await Class.create({ name: 'Class 8', section: 'B', academicYear: '2024-25' });

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

    await timetableService.syncTimetables({
      sourceType: 'teacher',
      sourceId: teacher._id.toString(),
      day: 'Monday',
      periodIndex: 0,
      slotData: { classId: class1._id, subject: 'English', room: 'Room 301' },
      academicYear: '2024-25'
    });

    await timetableService.syncTimetables({
      sourceType: 'teacher',
      sourceId: teacher._id.toString(),
      day: 'Monday',
      periodIndex: 1,
      slotData: { classId: class2._id, subject: 'English', room: 'Room 302' },
      academicYear: '2024-25'
    });

    const class1Timetable = await Timetable.findOne({ classId: class1._id, academicYear: '2024-25' });
    expect(class1Timetable.schedule.Monday[0].teacherId.toString()).toBe(teacher._id.toString());

    const class2Timetable = await Timetable.findOne({ classId: class2._id, academicYear: '2024-25' });
    expect(class2Timetable.schedule.Monday[1].teacherId.toString()).toBe(teacher._id.toString());
  });
});

describe('Integration: Conflict Detection Across Multiple Operations', () => {
  it('should detect double booking conflicts', async () => {
    const teacher = await Staff.create({
      code: 'T001',
      name: 'Busy Teacher',
      role: 'Teacher',
      password: 'hashedpassword',
      teacherAssignments: [{ subject: 'Physics', classes: [] }]
    });

    const class1 = await Class.create({ name: 'Class 11', section: 'A', academicYear: '2024-25' });
    const class2 = await Class.create({ name: 'Class 11', section: 'B', academicYear: '2024-25' });

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

    await timetableService.syncTimetables({
      sourceType: 'class',
      sourceId: class1._id.toString(),
      day: 'Monday',
      periodIndex: 0,
      slotData: { subject: 'Physics', teacherId: teacher._id, room: 'Lab 1' },
      academicYear: '2024-25'
    });

    const validation = await conflictDetectionService.validateSlotAssignment(
      teacher._id.toString(),
      class2._id.toString(),
      'Physics',
      'Monday',
      0
    );

    expect(validation.isValid).toBe(false);
    expect(validation.error.type).toBe('double_booking');
    expect(validation.error.day).toBe('Monday');
    expect(validation.error.periodIndex).toBe(0);
  });

  it('should prevent unqualified teacher assignments', async () => {
    const teacher = await Staff.create({
      code: 'T001',
      name: 'Math Teacher',
      role: 'Teacher',
      password: 'hashedpassword',
      teacherAssignments: [{ subject: 'Math', classes: [] }]
    });

    const classDoc = await Class.create({ name: 'Class 10', section: 'A', academicYear: '2024-25' });

    teacher.teacherAssignments[0].classes = [classDoc._id];
    await teacher.save();

    const validation = await conflictDetectionService.validateSlotAssignment(
      teacher._id.toString(),
      classDoc._id.toString(),
      'Biology',
      'Monday',
      0
    );

    expect(validation.isValid).toBe(false);
    expect(validation.error.type).toBe('unqualified');
    expect(validation.error.subject).toBe('Biology');
  });

  it('should detect conflicts across multiple days', async () => {
    const teacher = await Staff.create({
      code: 'T001',
      name: 'Chemistry Teacher',
      role: 'Teacher',
      password: 'hashedpassword',
      teacherAssignments: [{ subject: 'Chemistry', classes: [] }]
    });

    const class1 = await Class.create({ name: 'Class 12', section: 'A', academicYear: '2024-25' });
    const class2 = await Class.create({ name: 'Class 12', section: 'B', academicYear: '2024-25' });

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

    await timetableService.syncTimetables({
      sourceType: 'class',
      sourceId: class1._id.toString(),
      day: 'Monday',
      periodIndex: 0,
      slotData: { subject: 'Chemistry', teacherId: teacher._id, room: 'Lab 1' },
      academicYear: '2024-25'
    });

    await timetableService.syncTimetables({
      sourceType: 'class',
      sourceId: class1._id.toString(),
      day: 'Tuesday',
      periodIndex: 1,
      slotData: { subject: 'Chemistry', teacherId: teacher._id, room: 'Lab 2' },
      academicYear: '2024-25'
    });

    const conflict1 = await conflictDetectionService.checkTeacherConflict(teacher._id.toString(), 'Monday', 0, class1._id.toString());
    expect(conflict1).toBeNull();

    const validation = await conflictDetectionService.validateSlotAssignment(
      teacher._id.toString(),
      class2._id.toString(),
      'Chemistry',
      'Monday',
      0
    );
    expect(validation.isValid).toBe(false);
  });
});

describe('Integration: Rollback Mechanism on Sync Failures', () => {
  it('should rollback when class switch validation fails', async () => {
    const teacher = await Staff.create({
      code: 'T001',
      name: 'History Teacher',
      role: 'Teacher',
      password: 'hashedpassword',
      teacherAssignments: [{ subject: 'History', classes: [] }]
    });

    const oldClass = await Class.create({ name: 'Class 9', section: 'A', academicYear: '2024-25' });
    const newClass = await Class.create({ name: 'Class 9', section: 'B', academicYear: '2024-25' });

    teacher.teacherAssignments[0].classes = [oldClass._id];
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

    await Timetable.create({ classId: oldClass._id, academicYear: '2024-25', periods, schedule: JSON.parse(JSON.stringify(schedule)) });
    await Timetable.create({ classId: newClass._id, academicYear: '2024-25', periods, schedule: JSON.parse(JSON.stringify(schedule)) });

    await timetableService.syncTimetables({
      sourceType: 'class',
      sourceId: oldClass._id.toString(),
      day: 'Monday',
      periodIndex: 0,
      slotData: { subject: 'History', teacherId: teacher._id, room: 'Room 301' },
      academicYear: '2024-25'
    });

    const oldClassBefore = await Timetable.findOne({ classId: oldClass._id, academicYear: '2024-25' });
    expect(oldClassBefore.schedule.Monday[0].teacherId.toString()).toBe(teacher._id.toString());

    let switchError;
    try {
      await timetableService.switchClass({
        teacherId: teacher._id.toString(),
        oldClassId: oldClass._id.toString(),
        newClassId: newClass._id.toString(),
        day: 'Monday',
        periodIndex: 0,
        subject: 'History',
        room: 'Room 302',
        academicYear: '2024-25'
      });
    } catch (error) {
      switchError = error;
    }

    expect(switchError).toBeDefined();
    expect(switchError.message).toContain('not qualified');

    const oldClassAfter = await Timetable.findOne({ classId: oldClass._id, academicYear: '2024-25' });
    expect(oldClassAfter.schedule.Monday[0].teacherId.toString()).toBe(teacher._id.toString());

    const newClassAfter = await Timetable.findOne({ classId: newClass._id, academicYear: '2024-25' });
    expect(newClassAfter.schedule.Monday[0].teacherId).toBeFalsy();
  });

  it('should successfully complete valid class switch', async () => {
    const teacher = await Staff.create({
      code: 'T001',
      name: 'Geography Teacher',
      role: 'Teacher',
      password: 'hashedpassword',
      teacherAssignments: [{ subject: 'Geography', classes: [] }]
    });

    const class1 = await Class.create({ name: 'Class 10', section: 'A', academicYear: '2024-25' });
    const class2 = await Class.create({ name: 'Class 10', section: 'B', academicYear: '2024-25' });

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

    await timetableService.syncTimetables({
      sourceType: 'class',
      sourceId: class1._id.toString(),
      day: 'Wednesday',
      periodIndex: 2,
      slotData: { subject: 'Geography', teacherId: teacher._id, room: 'Room 401' },
      academicYear: '2024-25'
    });

    const switchResult = await timetableService.switchClass({
      teacherId: teacher._id.toString(),
      oldClassId: class1._id.toString(),
      newClassId: class2._id.toString(),
      day: 'Wednesday',
      periodIndex: 2,
      subject: 'Geography',
      room: 'Room 402',
      academicYear: '2024-25'
    });

    expect(switchResult.success).toBe(true);

    const class1After = await Timetable.findOne({ classId: class1._id, academicYear: '2024-25' });
    expect(class1After.schedule.Wednesday[2].teacherId).toBeFalsy();

    const class2After = await Timetable.findOne({ classId: class2._id, academicYear: '2024-25' });
    expect(class2After.schedule.Wednesday[2].teacherId.toString()).toBe(teacher._id.toString());
    expect(class2After.schedule.Wednesday[2].room).toBe('Room 402');

    const teacherTimetable = await TeacherTimetable.findOne({ teacherId: teacher._id, academicYear: '2024-25' });
    const teacherSlot = teacherTimetable.schedule.Wednesday.find(s => s.periodIndex === 2);
    expect(teacherSlot.classId.toString()).toBe(class2._id.toString());
  });

  it('should handle complex multi-step operations with rollback', async () => {
    const teacher1 = await Staff.create({
      code: 'T001',
      name: 'Teacher One',
      role: 'Teacher',
      password: 'hashedpassword',
      teacherAssignments: [{ subject: 'Economics', classes: [] }]
    });

    const teacher2 = await Staff.create({
      code: 'T002',
      name: 'Teacher Two',
      role: 'Teacher',
      password: 'hashedpassword',
      teacherAssignments: [{ subject: 'Economics', classes: [] }]
    });

    const class1 = await Class.create({ name: 'Class 11', section: 'A', academicYear: '2024-25' });
    const class2 = await Class.create({ name: 'Class 11', section: 'B', academicYear: '2024-25' });

    teacher1.teacherAssignments[0].classes = [class1._id, class2._id];
    teacher2.teacherAssignments[0].classes = [class1._id];
    await teacher1.save();
    await teacher2.save();

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

    await timetableService.syncTimetables({
      sourceType: 'class',
      sourceId: class1._id.toString(),
      day: 'Thursday',
      periodIndex: 3,
      slotData: { subject: 'Economics', teacherId: teacher1._id, room: 'Room 501' },
      academicYear: '2024-25'
    });

    await timetableService.syncTimetables({
      sourceType: 'class',
      sourceId: class1._id.toString(),
      day: 'Thursday',
      periodIndex: 4,
      slotData: { subject: 'Economics', teacherId: teacher2._id, room: 'Room 502' },
      academicYear: '2024-25'
    });

    const switchResult = await timetableService.switchClass({
      teacherId: teacher1._id.toString(),
      oldClassId: class1._id.toString(),
      newClassId: class2._id.toString(),
      day: 'Thursday',
      periodIndex: 3,
      subject: 'Economics',
      room: 'Room 503',
      academicYear: '2024-25'
    });

    expect(switchResult.success).toBe(true);

    const class1Final = await Timetable.findOne({ classId: class1._id, academicYear: '2024-25' });
    expect(class1Final.schedule.Thursday[3].teacherId).toBeFalsy();
    expect(class1Final.schedule.Thursday[4].teacherId.toString()).toBe(teacher2._id.toString());

    const class2Final = await Timetable.findOne({ classId: class2._id, academicYear: '2024-25' });
    expect(class2Final.schedule.Thursday[3].teacherId.toString()).toBe(teacher1._id.toString());
  });
});

describe('Integration: Bidirectional Sync Consistency', () => {
  it('should maintain consistency across multiple bidirectional updates', async () => {
    const { teacher, classDoc } = await createTestData();

    await timetableService.syncTimetables({
      sourceType: 'class',
      sourceId: classDoc._id.toString(),
      day: 'Friday',
      periodIndex: 5,
      slotData: { subject: 'Math', teacherId: teacher._id, room: 'Lab 3' },
      academicYear: '2024-25'
    });

    let teacherTimetable = await TeacherTimetable.findOne({ teacherId: teacher._id, academicYear: '2024-25' });
    expect(teacherTimetable.schedule.Friday[0].classId.toString()).toBe(classDoc._id.toString());

    await timetableService.syncTimetables({
      sourceType: 'teacher',
      sourceId: teacher._id.toString(),
      day: 'Friday',
      periodIndex: 5,
      slotData: { classId: classDoc._id, subject: 'Math', room: 'Lab 4' },
      academicYear: '2024-25'
    });

    const classTimetable = await Timetable.findOne({ classId: classDoc._id, academicYear: '2024-25' });
    expect(classTimetable.schedule.Friday[5].room).toBe('Lab 4');
    expect(classTimetable.schedule.Friday[5].teacherId.toString()).toBe(teacher._id.toString());

    await timetableService.deleteClassSlot({
      classId: classDoc._id,
      day: 'Friday',
      periodIndex: 5,
      academicYear: '2024-25'
    });

    teacherTimetable = await TeacherTimetable.findOne({ teacherId: teacher._id, academicYear: '2024-25' });
    const deletedSlot = teacherTimetable.schedule.Friday.find(s => s.periodIndex === 5);
    expect(deletedSlot).toBeFalsy();
  });
});
