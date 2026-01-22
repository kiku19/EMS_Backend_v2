import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fc from 'fast-check';
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

/**
 * Feature: timetable-management, Property 4: Bidirectional synchronization - class to teacher
 * Validates: Requirements 8.1
 * 
 * Property: For any class timetable update where a teacher is assigned to a time slot,
 * the teacher's timetable should reflect the same assignment in the corresponding time slot
 */
describe('Property 4: Bidirectional synchronization - class to teacher', () => {
  it('should sync class timetable updates to teacher timetable', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          day: fc.constantFrom('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'),
          periodIndex: fc.integer({ min: 0, max: 7 }),
          subject: fc.constantFrom('Math', 'Science', 'English', 'History', 'Geography', 'Physics'),
          room: fc.string({ minLength: 1, maxLength: 10 })
        }),
        async ({ day, periodIndex, subject, room }) => {
          // Create a teacher
          const teacher = await Staff.create({
            code: `T${Date.now()}${Math.random()}`,
            name: 'Test Teacher',
            role: 'Teacher',
            password: 'hashedpassword',
            teacherAssignments: []
          });

          // Create a class
          const classDoc = await Class.create({
            name: 'Class 10',
            section: 'A',
            academicYear: '2024-25'
          });

          // Create class timetable with periods
          const periods = Array.from({ length: 8 }, (_, i) => ({
            name: `Period ${i + 1}`,
            startTime: `${8 + i}:00`,
            endTime: `${9 + i}:00`,
            isBreak: false
          }));

          const schedule = {};
          const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          for (const d of days) {
            schedule[d] = Array.from({ length: 8 }, () => ({
              subject: '',
              teacherId: null,
              room: ''
            }));
          }

          await Timetable.create({
            classId: classDoc._id,
            academicYear: '2024-25',
            periods,
            schedule
          });

          // Sync: Assign teacher to class timetable slot
          await timetableService.syncTimetables({
            sourceType: 'class',
            sourceId: classDoc._id.toString(),
            day,
            periodIndex,
            slotData: {
              subject,
              teacherId: teacher._id,
              room
            },
            academicYear: '2024-25'
          });

          // Verify: Check teacher timetable has the assignment
          const teacherTimetable = await TeacherTimetable.findOne({
            teacherId: teacher._id,
            academicYear: '2024-25'
          }).populate('schedule.' + day + '.classId');

          // Teacher timetable should exist
          expect(teacherTimetable).toBeTruthy();

          // Find the slot in teacher's schedule
          const teacherSlot = teacherTimetable.schedule[day]?.find(
            slot => slot.periodIndex === periodIndex
          );

          // Teacher should have this slot assigned
          expect(teacherSlot).toBeTruthy();
          expect(teacherSlot.classId._id.toString()).toBe(classDoc._id.toString());
          expect(teacherSlot.subject).toBe(subject);
          expect(teacherSlot.room).toBe(room);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: timetable-management, Property 5: Bidirectional synchronization - teacher to class
 * Validates: Requirements 8.2
 * 
 * Property: For any teacher timetable update where a class is assigned to a time slot,
 * the class timetable should reflect the same teacher assignment in the corresponding time slot
 */
describe('Property 5: Bidirectional synchronization - teacher to class', () => {
  it('should sync teacher timetable updates to class timetable', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          day: fc.constantFrom('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'),
          periodIndex: fc.integer({ min: 0, max: 7 }),
          subject: fc.constantFrom('Math', 'Science', 'English', 'History', 'Geography', 'Physics'),
          room: fc.string({ minLength: 1, maxLength: 10 })
        }),
        async ({ day, periodIndex, subject, room }) => {
          // Create a teacher
          const teacher = await Staff.create({
            code: `T${Date.now()}${Math.random()}`,
            name: 'Test Teacher',
            role: 'Teacher',
            password: 'hashedpassword',
            teacherAssignments: []
          });

          // Create a class
          const classDoc = await Class.create({
            name: 'Class 10',
            section: 'A',
            academicYear: '2024-25'
          });

          // Create class timetable with periods
          const periods = Array.from({ length: 8 }, (_, i) => ({
            name: `Period ${i + 1}`,
            startTime: `${8 + i}:00`,
            endTime: `${9 + i}:00`,
            isBreak: false
          }));

          const schedule = {};
          const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          for (const d of days) {
            schedule[d] = Array.from({ length: 8 }, () => ({
              subject: '',
              teacherId: null,
              room: ''
            }));
          }

          await Timetable.create({
            classId: classDoc._id,
            academicYear: '2024-25',
            periods,
            schedule
          });

          // Sync: Assign class to teacher timetable slot
          await timetableService.syncTimetables({
            sourceType: 'teacher',
            sourceId: teacher._id.toString(),
            day,
            periodIndex,
            slotData: {
              classId: classDoc._id,
              subject,
              room
            },
            academicYear: '2024-25'
          });

          // Verify: Check class timetable has the teacher assignment
          const classTimetable = await Timetable.findOne({
            classId: classDoc._id,
            academicYear: '2024-25'
          }).populate('schedule.' + day + '.teacherId');

          // Class timetable should exist
          expect(classTimetable).toBeTruthy();

          // Check the slot in class schedule
          const classSlot = classTimetable.schedule[day][periodIndex];

          // Class should have this teacher assigned
          expect(classSlot).toBeTruthy();
          expect(classSlot.teacherId._id.toString()).toBe(teacher._id.toString());
          expect(classSlot.subject).toBe(subject);
          expect(classSlot.room).toBe(room);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: timetable-management, Property 10: Deletion synchronization - class side
 * Validates: Requirements 8.3
 * 
 * Property: For any class timetable slot, when a teacher assignment is removed from a class time slot,
 * the corresponding entry should be removed from the teacher's timetable
 */
describe('Property 10: Deletion synchronization - class side', () => {
  it('should remove teacher assignment from teacher timetable when deleted from class', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          day: fc.constantFrom('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'),
          periodIndex: fc.integer({ min: 0, max: 7 }),
          subject: fc.constantFrom('Math', 'Science', 'English', 'History', 'Geography', 'Physics'),
          room: fc.string({ minLength: 1, maxLength: 10 })
        }),
        async ({ day, periodIndex, subject, room }) => {
          // Create a teacher
          const teacher = await Staff.create({
            code: `T${Date.now()}${Math.random()}`,
            name: 'Test Teacher',
            role: 'Teacher',
            password: 'hashedpassword',
            teacherAssignments: []
          });

          // Create a class
          const classDoc = await Class.create({
            name: 'Class 10',
            section: 'A',
            academicYear: '2024-25'
          });

          // Create class timetable with periods
          const periods = Array.from({ length: 8 }, (_, i) => ({
            name: `Period ${i + 1}`,
            startTime: `${8 + i}:00`,
            endTime: `${9 + i}:00`,
            isBreak: false
          }));

          const schedule = {};
          const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          for (const d of days) {
            schedule[d] = Array.from({ length: 8 }, () => ({
              subject: '',
              teacherId: null,
              room: ''
            }));
          }

          await Timetable.create({
            classId: classDoc._id,
            academicYear: '2024-25',
            periods,
            schedule
          });

          // First, assign teacher to class timetable slot
          await timetableService.syncTimetables({
            sourceType: 'class',
            sourceId: classDoc._id.toString(),
            day,
            periodIndex,
            slotData: {
              subject,
              teacherId: teacher._id,
              room
            },
            academicYear: '2024-25'
          });

          // Verify teacher has the assignment
          let teacherTimetable = await TeacherTimetable.findOne({
            teacherId: teacher._id,
            academicYear: '2024-25'
          });
          let teacherSlot = teacherTimetable.schedule[day]?.find(
            slot => slot.periodIndex === periodIndex
          );
          expect(teacherSlot).toBeTruthy();

          // Now delete the assignment from class timetable
          await timetableService.deleteClassSlot({
            classId: classDoc._id,
            day,
            periodIndex,
            academicYear: '2024-25'
          });

          // Verify: Teacher timetable should no longer have this assignment
          teacherTimetable = await TeacherTimetable.findOne({
            teacherId: teacher._id,
            academicYear: '2024-25'
          });

          teacherSlot = teacherTimetable.schedule[day]?.find(
            slot => slot.periodIndex === periodIndex
          );

          // Teacher should NOT have this slot anymore
          expect(teacherSlot).toBeFalsy();

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: timetable-management, Property 11: Deletion synchronization - teacher side
 * Validates: Requirements 8.4
 * 
 * Property: For any teacher timetable slot, when a class assignment is removed from a teacher time slot,
 * the corresponding teacher entry should be removed from the class timetable
 */
describe('Property 11: Deletion synchronization - teacher side', () => {
  it('should remove class assignment from class timetable when deleted from teacher', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          day: fc.constantFrom('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'),
          periodIndex: fc.integer({ min: 0, max: 7 }),
          subject: fc.constantFrom('Math', 'Science', 'English', 'History', 'Geography', 'Physics'),
          room: fc.string({ minLength: 1, maxLength: 10 })
        }),
        async ({ day, periodIndex, subject, room }) => {
          // Create a teacher
          const teacher = await Staff.create({
            code: `T${Date.now()}${Math.random()}`,
            name: 'Test Teacher',
            role: 'Teacher',
            password: 'hashedpassword',
            teacherAssignments: []
          });

          // Create a class
          const classDoc = await Class.create({
            name: 'Class 10',
            section: 'A',
            academicYear: '2024-25'
          });

          // Create class timetable with periods
          const periods = Array.from({ length: 8 }, (_, i) => ({
            name: `Period ${i + 1}`,
            startTime: `${8 + i}:00`,
            endTime: `${9 + i}:00`,
            isBreak: false
          }));

          const schedule = {};
          const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          for (const d of days) {
            schedule[d] = Array.from({ length: 8 }, () => ({
              subject: '',
              teacherId: null,
              room: ''
            }));
          }

          await Timetable.create({
            classId: classDoc._id,
            academicYear: '2024-25',
            periods,
            schedule
          });

          // First, assign class to teacher timetable slot
          await timetableService.syncTimetables({
            sourceType: 'teacher',
            sourceId: teacher._id.toString(),
            day,
            periodIndex,
            slotData: {
              classId: classDoc._id,
              subject,
              room
            },
            academicYear: '2024-25'
          });

          // Verify class has the teacher assignment
          let classTimetable = await Timetable.findOne({
            classId: classDoc._id,
            academicYear: '2024-25'
          });
          let classSlot = classTimetable.schedule[day][periodIndex];
          expect(classSlot.teacherId).toBeTruthy();
          expect(classSlot.teacherId.toString()).toBe(teacher._id.toString());

          // Now delete the assignment from teacher timetable
          await timetableService.deleteTeacherSlot({
            teacherId: teacher._id,
            day,
            periodIndex,
            academicYear: '2024-25'
          });

          // Verify: Class timetable should no longer have this teacher
          classTimetable = await Timetable.findOne({
            classId: classDoc._id,
            academicYear: '2024-25'
          });

          classSlot = classTimetable.schedule[day][periodIndex];

          // Class should NOT have this teacher anymore
          expect(classSlot.teacherId).toBeFalsy();

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
