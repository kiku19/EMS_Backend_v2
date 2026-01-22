import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Staff, Class, Timetable, TeacherTimetable } from '../../database.js';
import timetableService from '../../services/timetableService.js';

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
  // Clear all collections before each test
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

describe('Class Switching Functionality', () => {
  let teacher1, teacher2, class1, class2, class3;
  let timetable1, timetable2, timetable3;
  const academicYear = '2024-25';

  beforeEach(async () => {

    // Create test teachers
    teacher1 = await Staff.create({
      code: 'T001',
      name: 'John Doe',
      role: 'Teacher',
      password: 'password123',
      teacherAssignments: [
        {
          subject: 'Mathematics',
          classes: []
        },
        {
          subject: 'Physics',
          classes: []
        }
      ]
    });

    teacher2 = await Staff.create({
      code: 'T002',
      name: 'Jane Smith',
      role: 'Teacher',
      password: 'password123',
      teacherAssignments: [
        {
          subject: 'English',
          classes: []
        }
      ]
    });

    // Create test classes
    class1 = await Class.create({
      name: 'Class 10',
      section: 'A',
      subjects: ['Mathematics', 'Physics', 'English'],
      academicYear
    });

    class2 = await Class.create({
      name: 'Class 10',
      section: 'B',
      subjects: ['Mathematics', 'Physics', 'English'],
      academicYear
    });

    class3 = await Class.create({
      name: 'Class 9',
      section: 'A',
      subjects: ['Mathematics', 'Physics', 'English'],
      academicYear
    });

    // Update teacher assignments with class references
    teacher1.teacherAssignments[0].classes = [class1._id, class2._id, class3._id];
    teacher1.teacherAssignments[1].classes = [class1._id, class2._id];
    await teacher1.save();

    teacher2.teacherAssignments[0].classes = [class1._id, class2._id];
    await teacher2.save();

    // Create timetables for classes
    timetable1 = await Timetable.create({
      classId: class1._id,
      academicYear,
      periods: [
        { name: 'Period 1', startTime: '09:00', endTime: '09:45' },
        { name: 'Period 2', startTime: '09:45', endTime: '10:30' },
        { name: 'Period 3', startTime: '10:30', endTime: '11:15' }
      ],
      schedule: {
        Monday: [
          { subject: 'Mathematics', teacherId: teacher1._id, room: 'R101' },
          { subject: '', teacherId: null, room: '' },
          { subject: '', teacherId: null, room: '' }
        ],
        Tuesday: [],
        Wednesday: [],
        Thursday: [],
        Friday: [],
        Saturday: []
      }
    });

    timetable2 = await Timetable.create({
      classId: class2._id,
      academicYear,
      periods: [
        { name: 'Period 1', startTime: '09:00', endTime: '09:45' },
        { name: 'Period 2', startTime: '09:45', endTime: '10:30' },
        { name: 'Period 3', startTime: '10:30', endTime: '11:15' }
      ],
      schedule: {
        Monday: [
          { subject: '', teacherId: null, room: '' },
          { subject: '', teacherId: null, room: '' },
          { subject: '', teacherId: null, room: '' }
        ],
        Tuesday: [],
        Wednesday: [],
        Thursday: [],
        Friday: [],
        Saturday: []
      }
    });

    timetable3 = await Timetable.create({
      classId: class3._id,
      academicYear,
      periods: [
        { name: 'Period 1', startTime: '09:00', endTime: '09:45' },
        { name: 'Period 2', startTime: '09:45', endTime: '10:30' },
        { name: 'Period 3', startTime: '10:30', endTime: '11:15' }
      ],
      schedule: {
        Monday: [
          { subject: '', teacherId: null, room: '' },
          { subject: '', teacherId: null, room: '' },
          { subject: '', teacherId: null, room: '' }
        ],
        Tuesday: [],
        Wednesday: [],
        Thursday: [],
        Friday: [],
        Saturday: []
      }
    });

    // Create teacher timetable
    await TeacherTimetable.create({
      teacherId: teacher1._id,
      academicYear,
      schedule: {
        Monday: [
          { periodIndex: 0, classId: class1._id, subject: 'Mathematics', room: 'R101' }
        ],
        Tuesday: [],
        Wednesday: [],
        Thursday: [],
        Friday: [],
        Saturday: []
      }
    });
  });

  describe('switchClass', () => {
    it('should successfully switch teacher from one class to another', async () => {
      const result = await timetableService.switchClass({
        teacherId: teacher1._id,
        oldClassId: class1._id,
        newClassId: class2._id,
        day: 'Monday',
        periodIndex: 0,
        subject: 'Mathematics',
        room: 'R102',
        academicYear
      });

      expect(result.success).toBe(true);
      expect(result.oldClassId.toString()).toBe(class1._id.toString());
      expect(result.newClassId.toString()).toBe(class2._id.toString());

      // Verify old class timetable - teacher should be removed
      const oldClassTimetable = await Timetable.findOne({ classId: class1._id, academicYear });
      expect(oldClassTimetable.schedule.Monday[0].teacherId).toBeNull();
      expect(oldClassTimetable.schedule.Monday[0].subject).toBe('');

      // Verify new class timetable - teacher should be added
      const newClassTimetable = await Timetable.findOne({ classId: class2._id, academicYear });
      expect(newClassTimetable.schedule.Monday[0].teacherId.toString()).toBe(teacher1._id.toString());
      expect(newClassTimetable.schedule.Monday[0].subject).toBe('Mathematics');
      expect(newClassTimetable.schedule.Monday[0].room).toBe('R102');

      // Verify teacher timetable - class should be updated
      const teacherTimetable = await TeacherTimetable.findOne({ teacherId: teacher1._id, academicYear });
      const mondaySlot = teacherTimetable.schedule.Monday.find(slot => slot.periodIndex === 0);
      expect(mondaySlot.classId.toString()).toBe(class2._id.toString());
      expect(mondaySlot.subject).toBe('Mathematics');
      expect(mondaySlot.room).toBe('R102');
    });

    it('should switch class without oldClassId (adding to new class only)', async () => {
      const result = await timetableService.switchClass({
        teacherId: teacher1._id,
        oldClassId: null,
        newClassId: class3._id,
        day: 'Monday',
        periodIndex: 1,
        subject: 'Mathematics',
        room: 'R103',
        academicYear
      });

      expect(result.success).toBe(true);

      // Verify new class timetable - teacher should be added
      const newClassTimetable = await Timetable.findOne({ classId: class3._id, academicYear });
      expect(newClassTimetable.schedule.Monday[1].teacherId.toString()).toBe(teacher1._id.toString());
      expect(newClassTimetable.schedule.Monday[1].subject).toBe('Mathematics');

      // Verify teacher timetable
      const teacherTimetable = await TeacherTimetable.findOne({ teacherId: teacher1._id, academicYear });
      const mondaySlot = teacherTimetable.schedule.Monday.find(slot => slot.periodIndex === 1);
      expect(mondaySlot.classId.toString()).toBe(class3._id.toString());
    });

    it('should reject switch if teacher is not qualified for the subject in new class', async () => {
      // Try to switch to a subject the teacher is not qualified for
      await expect(
        timetableService.switchClass({
          teacherId: teacher1._id,
          oldClassId: class1._id,
          newClassId: class2._id,
          day: 'Monday',
          periodIndex: 0,
          subject: 'English', // Teacher1 is not qualified for English
          room: 'R102',
          academicYear
        })
      ).rejects.toThrow(/not qualified/);

      // Verify no changes were made (rollback worked)
      const oldClassTimetable = await Timetable.findOne({ classId: class1._id, academicYear });
      expect(oldClassTimetable.schedule.Monday[0].teacherId.toString()).toBe(teacher1._id.toString());

      const newClassTimetable = await Timetable.findOne({ classId: class2._id, academicYear });
      expect(newClassTimetable.schedule.Monday[0].teacherId).toBeNull();
    });

    it('should reject switch if new class does not exist', async () => {
      const fakeClassId = new mongoose.Types.ObjectId();

      await expect(
        timetableService.switchClass({
          teacherId: teacher1._id,
          oldClassId: class1._id,
          newClassId: fakeClassId,
          day: 'Monday',
          periodIndex: 0,
          subject: 'Mathematics',
          room: 'R102',
          academicYear
        })
      ).rejects.toThrow(/not found/);
    });

    it('should reject switch if teacher does not exist', async () => {
      const fakeTeacherId = new mongoose.Types.ObjectId();

      await expect(
        timetableService.switchClass({
          teacherId: fakeTeacherId,
          oldClassId: class1._id,
          newClassId: class2._id,
          day: 'Monday',
          periodIndex: 0,
          subject: 'Mathematics',
          room: 'R102',
          academicYear
        })
      ).rejects.toThrow(/not found/);
    });

    it('should reject switch with invalid day', async () => {
      await expect(
        timetableService.switchClass({
          teacherId: teacher1._id,
          oldClassId: class1._id,
          newClassId: class2._id,
          day: 'InvalidDay',
          periodIndex: 0,
          subject: 'Mathematics',
          room: 'R102',
          academicYear
        })
      ).rejects.toThrow(/Invalid day/);
    });

    it('should reject switch with missing required parameters', async () => {
      await expect(
        timetableService.switchClass({
          teacherId: teacher1._id,
          newClassId: class2._id,
          // Missing day, periodIndex, subject
          academicYear
        })
      ).rejects.toThrow(/Missing required parameters/);
    });

    it('should handle rollback correctly on failure', async () => {
      // Store original states
      const originalOldTimetable = await Timetable.findOne({ classId: class1._id, academicYear });
      const originalOldSchedule = JSON.parse(JSON.stringify(originalOldTimetable.schedule));

      // Try to switch with invalid subject (should trigger rollback)
      try {
        await timetableService.switchClass({
          teacherId: teacher1._id,
          oldClassId: class1._id,
          newClassId: class2._id,
          day: 'Monday',
          periodIndex: 0,
          subject: 'InvalidSubject',
          room: 'R102',
          academicYear
        });
      } catch (error) {
        // Expected to fail
      }

      // Verify rollback - old class should be unchanged
      const rolledBackTimetable = await Timetable.findOne({ classId: class1._id, academicYear });
      expect(rolledBackTimetable.schedule.Monday[0].teacherId.toString()).toBe(teacher1._id.toString());
      expect(rolledBackTimetable.schedule.Monday[0].subject).toBe('Mathematics');
    });
  });

  describe('removeTeacherFromSlot', () => {
    it('should successfully remove teacher from a class slot', async () => {
      const result = await timetableService.removeTeacherFromSlot({
        classId: class1._id,
        teacherId: teacher1._id,
        day: 'Monday',
        periodIndex: 0,
        academicYear
      });

      expect(result.success).toBe(true);

      // Verify teacher was removed
      const classTimetable = await Timetable.findOne({ classId: class1._id, academicYear });
      expect(classTimetable.schedule.Monday[0].teacherId).toBeNull();
      expect(classTimetable.schedule.Monday[0].subject).toBe('');
    });

    it('should return success if slot is already empty', async () => {
      const result = await timetableService.removeTeacherFromSlot({
        classId: class1._id,
        teacherId: teacher1._id,
        day: 'Monday',
        periodIndex: 1, // Empty slot
        academicYear
      });

      expect(result.success).toBe(true);
      // Empty slot means teacher is not assigned, so either message is acceptable
      expect(result.message).toMatch(/already empty|not assigned/);
    });

    it('should return success if teacher is not assigned to the slot', async () => {
      const result = await timetableService.removeTeacherFromSlot({
        classId: class1._id,
        teacherId: teacher2._id, // Different teacher
        day: 'Monday',
        periodIndex: 0,
        academicYear
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('not assigned');
    });

    it('should reject with missing parameters', async () => {
      await expect(
        timetableService.removeTeacherFromSlot({
          classId: class1._id,
          // Missing teacherId, day, periodIndex
          academicYear
        })
      ).rejects.toThrow(/Missing required parameters/);
    });
  });

  describe('addTeacherToSlot', () => {
    it('should successfully add teacher to a class slot', async () => {
      const result = await timetableService.addTeacherToSlot({
        classId: class2._id,
        teacherId: teacher1._id,
        day: 'Monday',
        periodIndex: 0,
        subject: 'Mathematics',
        room: 'R201',
        academicYear
      });

      expect(result.success).toBe(true);

      // Verify teacher was added
      const classTimetable = await Timetable.findOne({ classId: class2._id, academicYear });
      expect(classTimetable.schedule.Monday[0].teacherId.toString()).toBe(teacher1._id.toString());
      expect(classTimetable.schedule.Monday[0].subject).toBe('Mathematics');
      expect(classTimetable.schedule.Monday[0].room).toBe('R201');
    });

    it('should overwrite existing slot when adding teacher', async () => {
      // First add a teacher
      await timetableService.addTeacherToSlot({
        classId: class1._id,
        teacherId: teacher2._id,
        day: 'Monday',
        periodIndex: 1,
        subject: 'English',
        room: 'R101',
        academicYear
      });

      // Now overwrite with different teacher
      const result = await timetableService.addTeacherToSlot({
        classId: class1._id,
        teacherId: teacher1._id,
        day: 'Monday',
        periodIndex: 1,
        subject: 'Physics',
        room: 'R102',
        academicYear
      });

      expect(result.success).toBe(true);

      // Verify new teacher replaced old one
      const classTimetable = await Timetable.findOne({ classId: class1._id, academicYear });
      expect(classTimetable.schedule.Monday[1].teacherId.toString()).toBe(teacher1._id.toString());
      expect(classTimetable.schedule.Monday[1].subject).toBe('Physics');
    });

    it('should reject with missing parameters', async () => {
      await expect(
        timetableService.addTeacherToSlot({
          classId: class1._id,
          teacherId: teacher1._id,
          // Missing day, periodIndex, subject
          academicYear
        })
      ).rejects.toThrow(/Missing required parameters/);
    });

    it('should handle room as optional parameter', async () => {
      const result = await timetableService.addTeacherToSlot({
        classId: class2._id,
        teacherId: teacher1._id,
        day: 'Monday',
        periodIndex: 0,
        subject: 'Mathematics',
        // No room specified
        academicYear
      });

      expect(result.success).toBe(true);

      const classTimetable = await Timetable.findOne({ classId: class2._id, academicYear });
      expect(classTimetable.schedule.Monday[0].room).toBe('');
    });
  });
});
