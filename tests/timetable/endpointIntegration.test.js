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
  // Clear all collections before each test
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

describe('Timetable API Endpoint Integration', () => {
  it('should detect conflicts when updating a slot with a conflicting teacher', async () => {
    // Create test data
    const teacher = await Staff.create({
      name: 'John Doe',
      code: 'T001',
      role: 'Teacher',
      password: 'hashedPassword123',
      teacherAssignments: [
        {
          subject: 'Mathematics',
          classes: []
        }
      ]
    });

    const class1 = await Class.create({
      name: 'Class 10',
      section: 'A',
      classTag: 'Science',
      assignedSubjects: ['Mathematics', 'Physics']
    });

    const class2 = await Class.create({
      name: 'Class 10',
      section: 'B',
      classTag: 'Science',
      assignedSubjects: ['Mathematics', 'Physics']
    });

    // Add classes to teacher assignments
    teacher.teacherAssignments[0].classes = [class1._id, class2._id];
    await teacher.save();

    // Create timetable for class1 with teacher assigned
    const timetable1 = await Timetable.create({
      classId: class1._id,
      academicYear: '2024-25',
      periods: [
        { name: 'Period 1', startTime: '09:00', endTime: '10:00' }
      ],
      schedule: {
        Monday: [
          {
            subject: 'Mathematics',
            teacherId: teacher._id,
            room: 'Room 101'
          }
        ]
      }
    });

    // Sync to teacher timetable
    await timetableService.syncTimetables({
      sourceType: 'class',
      sourceId: class1._id.toString(),
      day: 'Monday',
      periodIndex: 0,
      slotData: {
        subject: 'Mathematics',
        teacherId: teacher._id.toString(),
        room: 'Room 101'
      },
      academicYear: '2024-25'
    });

    // Try to assign the same teacher to class2 at the same time - should detect conflict
    const validation = await conflictDetectionService.validateSlotAssignment(
      teacher._id.toString(),
      class2._id.toString(),
      'Mathematics',
      'Monday',
      0
    );

    expect(validation.isValid).toBe(false);
    expect(validation.error.type).toBe('double_booking');
    expect(validation.error.message).toContain('already assigned');
  });

  it('should successfully sync when updating a slot without conflicts', async () => {
    // Create test data
    const teacher = await Staff.create({
      name: 'Jane Smith',
      code: 'T002',
      role: 'Teacher',
      password: 'hashedPassword123',
      teacherAssignments: [
        {
          subject: 'Physics',
          classes: []
        }
      ]
    });

    const classObj = await Class.create({
      name: 'Class 9',
      section: 'A',
      classTag: 'Science',
      assignedSubjects: ['Physics', 'Chemistry']
    });

    // Add class to teacher assignments
    teacher.teacherAssignments[0].classes = [classObj._id];
    await teacher.save();

    // Create timetable
    const timetable = await Timetable.create({
      classId: classObj._id,
      academicYear: '2024-25',
      periods: [
        { name: 'Period 1', startTime: '09:00', endTime: '10:00' }
      ],
      schedule: {
        Monday: [{}]
      }
    });

    // Validate assignment (should pass)
    const validation = await conflictDetectionService.validateSlotAssignment(
      teacher._id.toString(),
      classObj._id.toString(),
      'Physics',
      'Monday',
      0
    );

    expect(validation.isValid).toBe(true);

    // Sync the assignment
    const syncResult = await timetableService.syncTimetables({
      sourceType: 'class',
      sourceId: classObj._id.toString(),
      day: 'Monday',
      periodIndex: 0,
      slotData: {
        subject: 'Physics',
        teacherId: teacher._id.toString(),
        room: 'Lab 1'
      },
      academicYear: '2024-25'
    });

    expect(syncResult.success).toBe(true);

    // Verify teacher timetable was updated
    const teacherTimetable = await TeacherTimetable.findOne({
      teacherId: teacher._id,
      academicYear: '2024-25'
    });

    expect(teacherTimetable).toBeDefined();
    expect(teacherTimetable.schedule.Monday).toBeDefined();
    expect(teacherTimetable.schedule.Monday.length).toBe(1);
    expect(teacherTimetable.schedule.Monday[0].classId.toString()).toBe(classObj._id.toString());
    expect(teacherTimetable.schedule.Monday[0].subject).toBe('Physics');
  });

  it('should handle POST /api/timetable with synchronization', async () => {
    // Create test data
    const teacher = await Staff.create({
      name: 'Bob Johnson',
      code: 'T003',
      role: 'Teacher',
      password: 'hashedPassword123',
      teacherAssignments: [
        {
          subject: 'Chemistry',
          classes: []
        }
      ]
    });

    const classObj = await Class.create({
      name: 'Class 11',
      section: 'A',
      classTag: 'Science',
      assignedSubjects: ['Chemistry', 'Biology']
    });

    // Add class to teacher assignments
    teacher.teacherAssignments[0].classes = [classObj._id];
    await teacher.save();

    // Simulate POST /api/timetable behavior
    const schedule = {
      Monday: [
        {
          subject: 'Chemistry',
          teacherId: teacher._id,
          room: 'Lab 2'
        }
      ],
      Tuesday: [],
      Wednesday: [],
      Thursday: [],
      Friday: [],
      Saturday: []
    };

    const timetable = await Timetable.findOneAndUpdate(
      { classId: classObj._id, academicYear: '2024-25' },
      {
        classId: classObj._id,
        academicYear: '2024-25',
        periods: [{ name: 'Period 1', startTime: '09:00', endTime: '10:00' }],
        schedule: schedule
      },
      { upsert: true, new: true }
    );

    // Trigger synchronization for all slots with teachers
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const syncResults = [];

    for (const day of days) {
      if (schedule[day]) {
        for (let periodIndex = 0; periodIndex < schedule[day].length; periodIndex++) {
          const slot = schedule[day][periodIndex];
          if (slot && slot.teacherId) {
            const syncResult = await timetableService.syncTimetables({
              sourceType: 'class',
              sourceId: classObj._id.toString(),
              day: day,
              periodIndex: periodIndex,
              slotData: slot,
              academicYear: '2024-25'
            });
            syncResults.push({ day, periodIndex, success: syncResult.success });
          }
        }
      }
    }

    expect(syncResults.length).toBe(1);
    expect(syncResults[0].success).toBe(true);

    // Verify teacher timetable was created
    const teacherTimetable = await TeacherTimetable.findOne({
      teacherId: teacher._id,
      academicYear: '2024-25'
    });

    expect(teacherTimetable).toBeDefined();
    expect(teacherTimetable.schedule.Monday[0].classId.toString()).toBe(classObj._id.toString());
  });
});
