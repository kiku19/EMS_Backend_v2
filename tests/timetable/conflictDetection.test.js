import { describe, test, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import fc from 'fast-check';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Staff, Class, Timetable } from '../../database.js';
import conflictDetectionService from '../../services/conflictDetectionService.js';

let mongoServer;

beforeAll(async () => {
  // Create in-memory MongoDB instance
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  
  // Connect to the in-memory database
  await mongoose.connect(mongoUri);
});

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
});

beforeEach(async () => {
  // Clean up database between tests
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

/**
 * Feature: timetable-management, Property 6: Conflict detection for double booking
 * Validates: Requirements 6.1, 6.2, 6.3
 * 
 * Property: For any teacher and time slot, if the teacher is already assigned to a class 
 * in that time slot, attempting to assign the teacher to a different class in the same 
 * time slot should be rejected with a conflict error
 */
describe('Property 6: Conflict detection for double booking', () => {
  test('detects and rejects double booking conflicts', async () => {
    let testCounter = 0;
    
    await fc.assert(
      fc.asyncProperty(
        // Generate random day
        fc.constantFrom('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'),
        // Generate random period index (0-7)
        fc.integer({ min: 0, max: 7 }),
        // Generate random subject
        fc.constantFrom('Mathematics', 'Science', 'English', 'History', 'Geography'),
        async (day, periodIndex, subject) => {
          // Use a counter to ensure unique codes
          const runId = testCounter++;
          
          // Create a teacher
          const teacher = await Staff.create({
            code: `T${runId}`,
            name: `Teacher ${runId}`,
            role: 'Teacher',
            password: 'hashedPassword123',
            status: 'active'
          });
          
          // Create two classes
          const class1 = await Class.create({
            name: `Class ${runId}`,
            section: 'A',
            academicYear: '2024-25'
          });
          
          const class2 = await Class.create({
            name: `Class ${runId}`,
            section: 'B',
            academicYear: '2024-25'
          });
          
          // Add teacher assignments for both classes
          teacher.teacherAssignments.push({
            subject: subject,
            classes: [class1._id, class2._id]
          });
          await teacher.save();
          
          // Create timetable for class1 with periods
          const periods = Array.from({ length: 8 }, (_, i) => ({
            name: `Period ${i + 1}`,
            startTime: `${8 + i}:00`,
            endTime: `${9 + i}:00`,
            isBreak: false
          }));
          
          // Initialize schedule for all days
          const schedule = {};
          const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          for (const d of days) {
            schedule[d] = Array.from({ length: 8 }, () => ({
              subject: '',
              teacherId: null,
              room: ''
            }));
          }
          
          // Assign teacher to class1 at the specific time slot
          schedule[day][periodIndex] = {
            subject: subject,
            teacherId: teacher._id,
            room: 'Room 101'
          };
          
          const timetable1 = await Timetable.create({
            classId: class1._id,
            academicYear: '2024-25',
            periods: periods,
            schedule: schedule
          });
          
          // Now try to check if there's a conflict when assigning the same teacher to class2
          const conflict = await conflictDetectionService.checkTeacherConflict(
            teacher._id.toString(),
            day,
            periodIndex,
            class2._id.toString() // Exclude class2 from the check (we're trying to assign to it)
          );
          
          // Verify conflict is detected
          expect(conflict).not.toBeNull();
          expect(conflict.type).toBe('double_booking');
          expect(conflict.teacherId.toString()).toBe(teacher._id.toString());
          expect(conflict.day).toBe(day);
          expect(conflict.periodIndex).toBe(periodIndex);
          expect(conflict.conflicts).toHaveLength(1);
          expect(conflict.conflicts[0].classId.toString()).toBe(class1._id.toString());
          
          // Verify the validation also rejects it
          const validation = await conflictDetectionService.validateSlotAssignment(
            teacher._id.toString(),
            class2._id.toString(),
            subject,
            day,
            periodIndex
          );
          
          expect(validation.isValid).toBe(false);
          expect(validation.error.type).toBe('double_booking');
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
  
  test('allows assignment when no conflict exists', async () => {
    let testCounter = 0;
    
    await fc.assert(
      fc.asyncProperty(
        // Generate random day
        fc.constantFrom('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'),
        // Generate two different period indexes
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 1, max: 7 }),
        // Generate random subject
        fc.constantFrom('Mathematics', 'Science', 'English', 'History'),
        async (day, period1, period2Offset, subject) => {
          // Ensure periods are different
          const period2 = (period1 + period2Offset) % 8;
          if (period1 === period2) return true; // Skip if same period
          
          // Use a counter to ensure unique codes
          const runId = testCounter++;
          
          // Create a teacher
          const teacher = await Staff.create({
            code: `T${runId}`,
            name: `Teacher ${runId}`,
            role: 'Teacher',
            password: 'hashedPassword123',
            status: 'active'
          });
          
          // Create two classes
          const class1 = await Class.create({
            name: `Class ${runId}`,
            section: 'A',
            academicYear: '2024-25'
          });
          
          const class2 = await Class.create({
            name: `Class ${runId}`,
            section: 'B',
            academicYear: '2024-25'
          });
          
          // Add teacher assignments for both classes
          teacher.teacherAssignments.push({
            subject: subject,
            classes: [class1._id, class2._id]
          });
          await teacher.save();
          
          // Create timetable for class1 with teacher at period1
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
          
          // Assign teacher to class1 at period1
          schedule[day][period1] = {
            subject: subject,
            teacherId: teacher._id,
            room: 'Room 101'
          };
          
          await Timetable.create({
            classId: class1._id,
            academicYear: '2024-25',
            periods: periods,
            schedule: schedule
          });
          
          // Check if there's a conflict when assigning to class2 at period2 (different period)
          const conflict = await conflictDetectionService.checkTeacherConflict(
            teacher._id.toString(),
            day,
            period2,
            class2._id.toString()
          );
          
          // Verify no conflict is detected
          expect(conflict).toBeNull();
          
          // Verify the validation allows it
          const validation = await conflictDetectionService.validateSlotAssignment(
            teacher._id.toString(),
            class2._id.toString(),
            subject,
            day,
            period2
          );
          
          expect(validation.isValid).toBe(true);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: timetable-management, Property 12: Conflict error details
 * Validates: Requirements 6.4
 * 
 * Property: For any detected conflict, the error message should include the teacher name, 
 * conflicting class name, day, and period information
 */
describe('Property 12: Conflict error details', () => {
  test('conflict errors contain all required details', async () => {
    let testCounter = 0;
    
    await fc.assert(
      fc.asyncProperty(
        // Generate random day
        fc.constantFrom('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'),
        // Generate random period index (0-7)
        fc.integer({ min: 0, max: 7 }),
        // Generate random subject
        fc.constantFrom('Mathematics', 'Science', 'English', 'History', 'Geography'),
        // Generate random teacher name
        fc.string({ minLength: 5, maxLength: 20 }),
        // Generate random class name
        fc.constantFrom('Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5'),
        fc.constantFrom('A', 'B', 'C', 'D'),
        async (day, periodIndex, subject, teacherName, className, section) => {
          // Use a counter to ensure unique codes
          const runId = testCounter++;
          
          // Create a teacher with the generated name
          const teacher = await Staff.create({
            code: `T${runId}`,
            name: teacherName,
            role: 'Teacher',
            password: 'hashedPassword123',
            status: 'active'
          });
          
          // Create two classes
          const class1 = await Class.create({
            name: className,
            section: section,
            academicYear: '2024-25'
          });
          
          const class2 = await Class.create({
            name: className,
            section: section === 'A' ? 'B' : 'A',
            academicYear: '2024-25'
          });
          
          // Add teacher assignments
          teacher.teacherAssignments.push({
            subject: subject,
            classes: [class1._id, class2._id]
          });
          await teacher.save();
          
          // Create timetable with teacher assigned to class1
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
          
          schedule[day][periodIndex] = {
            subject: subject,
            teacherId: teacher._id,
            room: 'Room 101'
          };
          
          await Timetable.create({
            classId: class1._id,
            academicYear: '2024-25',
            periods: periods,
            schedule: schedule
          });
          
          // Check for conflict
          const conflict = await conflictDetectionService.checkTeacherConflict(
            teacher._id.toString(),
            day,
            periodIndex,
            class2._id.toString()
          );
          
          // Verify conflict contains all required details
          expect(conflict).not.toBeNull();
          
          // Check teacher information
          expect(conflict.teacherName).toBe(teacherName);
          expect(conflict.teacherId.toString()).toBe(teacher._id.toString());
          
          // Check time slot information
          expect(conflict.day).toBe(day);
          expect(conflict.periodIndex).toBe(periodIndex);
          
          // Check conflicting class information
          expect(conflict.conflicts).toHaveLength(1);
          expect(conflict.conflicts[0].className).toContain(className);
          expect(conflict.conflicts[0].className).toContain(section);
          expect(conflict.conflicts[0].classId.toString()).toBe(class1._id.toString());
          
          // Check message contains key information
          expect(conflict.message).toContain(teacherName);
          expect(conflict.message).toContain(day);
          expect(conflict.message).toContain(`Period ${periodIndex + 1}`);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: timetable-management, Property 8: Available teacher filtering by availability
 * Validates: Requirements 3.3, 7.2
 * 
 * Property: For any class, subject, and time slot, the list of available teachers should 
 * exclude teachers who are already assigned to another class in that time slot
 */
describe('Property 8: Available teacher filtering by availability', () => {
  test('available teachers exclude those with time conflicts', async () => {
    let testCounter = 0;
    
    await fc.assert(
      fc.asyncProperty(
        // Generate random day
        fc.constantFrom('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'),
        // Generate random period index (0-7)
        fc.integer({ min: 0, max: 7 }),
        // Generate random subject
        fc.constantFrom('Mathematics', 'Science', 'English', 'History'),
        // Generate number of available teachers (1-3)
        fc.integer({ min: 1, max: 3 }),
        // Generate number of busy teachers (1-3)
        fc.integer({ min: 1, max: 3 }),
        async (day, periodIndex, subject, numAvailable, numBusy) => {
          // Use a counter to ensure unique codes
          const runId = testCounter++;
          
          // Create target class
          const targetClass = await Class.create({
            name: `Class ${runId}`,
            section: 'A',
            academicYear: '2024-25'
          });
          
          // Create available teachers (qualified and not busy at this time)
          const availableTeachers = [];
          for (let i = 0; i < numAvailable; i++) {
            const teacher = await Staff.create({
              code: `TA${runId}-${i}`,
              name: `Available Teacher ${runId}-${i}`,
              role: 'Teacher',
              password: 'hashedPassword123',
              status: 'active',
              teacherAssignments: [{
                subject: subject,
                classes: [targetClass._id]
              }]
            });
            availableTeachers.push(teacher);
          }
          
          // Create busy teachers (qualified but already assigned at this time)
          // We need to create separate classes for each busy teacher to avoid duplicate key errors
          const busyTeachers = [];
          for (let i = 0; i < numBusy; i++) {
            // Create a separate class for each busy teacher
            const busyClass = await Class.create({
              name: `Class ${runId}`,
              section: String.fromCharCode(67 + i), // C, D, E, etc.
              academicYear: '2024-25'
            });
            
            const teacher = await Staff.create({
              code: `TB${runId}-${i}`,
              name: `Busy Teacher ${runId}-${i}`,
              role: 'Teacher',
              password: 'hashedPassword123',
              status: 'active',
              teacherAssignments: [{
                subject: subject,
                classes: [targetClass._id, busyClass._id]
              }]
            });
            busyTeachers.push(teacher);
            
            // Assign this teacher to their busy class at the target time slot
            const periods = Array.from({ length: 8 }, (_, idx) => ({
              name: `Period ${idx + 1}`,
              startTime: `${8 + idx}:00`,
              endTime: `${9 + idx}:00`,
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
            
            schedule[day][periodIndex] = {
              subject: subject,
              teacherId: teacher._id,
              room: 'Room 101'
            };
            
            await Timetable.create({
              classId: busyClass._id,
              academicYear: '2024-25',
              periods: periods,
              schedule: schedule
            });
          }
          
          // Query for qualified teachers
          const qualifiedTeachers = await Staff.find({
            status: 'active',
            'teacherAssignments': {
              $elemMatch: {
                subject: subject,
                classes: targetClass._id
              }
            }
          });
          
          // Filter out busy teachers using conflict detection
          const actuallyAvailable = [];
          for (const teacher of qualifiedTeachers) {
            const conflict = await conflictDetectionService.checkTeacherConflict(
              teacher._id.toString(),
              day,
              periodIndex,
              targetClass._id.toString()
            );
            
            if (!conflict) {
              actuallyAvailable.push(teacher);
            }
          }
          
          // Verify only available teachers are in the result
          expect(actuallyAvailable).toHaveLength(numAvailable);
          
          // Verify all available teachers are in the result
          const availableIds = actuallyAvailable.map(t => t._id.toString());
          for (const teacher of availableTeachers) {
            expect(availableIds).toContain(teacher._id.toString());
          }
          
          // Verify no busy teachers are in the result
          for (const teacher of busyTeachers) {
            expect(availableIds).not.toContain(teacher._id.toString());
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
