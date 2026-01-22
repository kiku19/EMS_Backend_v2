import { describe, test, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import fc from 'fast-check';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Class, Timetable, Staff, TeacherTimetable } from '../../database.js';
import validationService from '../../services/validationService.js';

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
 * Feature: timetable-management, Property 14: Empty slot identification
 * Validates: Requirements 10.1
 * 
 * Property: For any class timetable, querying for empty slots should return all time slots 
 * where the subject field is empty or null
 */
describe('Property 14: Empty slot identification', () => {
  test('identifies all empty slots in class timetable', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate random timetable configuration
        fc.record({
          // Random number of periods (4-8)
          numPeriods: fc.integer({ min: 4, max: 8 }),
          // Random days to populate (1-6 days)
          daysToPopulate: fc.uniqueArray(
            fc.constantFrom('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'),
            { minLength: 1, maxLength: 6 }
          ),
          // For each day, randomly decide which periods to fill (array of period indices)
          filledPeriods: fc.array(
            fc.integer({ min: 0, max: 7 }),
            { minLength: 0, maxLength: 8 }
          )
        }),
        async ({ numPeriods, daysToPopulate, filledPeriods }) => {
          // Clean up from previous iterations
          await Timetable.deleteMany({});
          await Class.deleteMany({});
          await Staff.deleteMany({});

          // Create a class
          const classDoc = await Class.create({
            name: 'Class 10',
            section: 'A',
            academicYear: '2024-25'
          });

          // Create a teacher
          const teacher = await Staff.create({
            code: `T${Date.now()}${Math.random()}`,
            name: 'Test Teacher',
            role: 'Teacher',
            password: 'hashedpassword',
            teacherAssignments: []
          });

          // Create periods
          const periods = Array.from({ length: numPeriods }, (_, i) => ({
            name: `Period ${i + 1}`,
            startTime: `${8 + i}:00`,
            endTime: `${9 + i}:00`,
            isBreak: false
          }));

          // Create schedule with some filled and some empty slots
          const schedule = {};
          const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          const expectedEmptySlots = [];

          for (const day of days) {
            schedule[day] = Array.from({ length: numPeriods }, (_, periodIndex) => {
              // Determine if this slot should be filled
              const shouldFill = daysToPopulate.includes(day) && 
                                filledPeriods.includes(periodIndex) &&
                                periodIndex < numPeriods;

              if (shouldFill) {
                // Fill the slot
                return {
                  subject: 'Math',
                  teacherId: teacher._id,
                  room: 'Room 101'
                };
              } else {
                // Leave the slot empty
                expectedEmptySlots.push({ day, periodIndex });
                return {
                  subject: '',
                  teacherId: null,
                  room: ''
                };
              }
            });
          }

          // Create timetable
          await Timetable.create({
            classId: classDoc._id,
            academicYear: '2024-25',
            periods,
            schedule
          });

          // Call the validation service
          const emptySlots = await validationService.identifyEmptySlots(classDoc._id, '2024-25');

          // Verify: All expected empty slots are identified
          expect(emptySlots).toHaveLength(expectedEmptySlots.length);

          // Check each expected empty slot is in the result
          for (const expectedSlot of expectedEmptySlots) {
            const found = emptySlots.some(
              slot => slot.day === expectedSlot.day && slot.periodIndex === expectedSlot.periodIndex
            );
            expect(found).toBe(true);
          }

          // Verify: No filled slots are incorrectly identified as empty
          for (const emptySlot of emptySlots) {
            const actualSlot = schedule[emptySlot.day][emptySlot.periodIndex];
            expect(!actualSlot.subject || actualSlot.subject === '' || !actualSlot.teacherId).toBe(true);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: timetable-management, Property 15: Teacher schedule gap identification
 * Validates: Requirements 10.2
 * 
 * Property: For any teacher timetable, querying for unassigned periods should return all time slots 
 * where no class is assigned
 */
describe('Property 15: Teacher schedule gap identification', () => {
  test('identifies all unassigned periods in teacher timetable', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate random timetable configuration
        fc.record({
          // Random number of periods (4-8)
          numPeriods: fc.integer({ min: 4, max: 8 }),
          // Random days to populate (1-6 days)
          daysToPopulate: fc.uniqueArray(
            fc.constantFrom('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'),
            { minLength: 1, maxLength: 6 }
          ),
          // For each day, randomly decide which periods to assign (array of unique period indices)
          assignedPeriods: fc.uniqueArray(
            fc.integer({ min: 0, max: 7 }),
            { minLength: 0, maxLength: 8 }
          )
        }),
        async ({ numPeriods, daysToPopulate, assignedPeriods }) => {
          // Clean up from previous iterations
          await Timetable.deleteMany({});
          await TeacherTimetable.deleteMany({});
          await Class.deleteMany({});
          await Staff.deleteMany({});

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

          // Create periods (reference timetable)
          const periods = Array.from({ length: numPeriods }, (_, i) => ({
            name: `Period ${i + 1}`,
            startTime: `${8 + i}:00`,
            endTime: `${9 + i}:00`,
            isBreak: false
          }));

          // Create a reference class timetable (needed for period structure)
          const schedule = {};
          const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          
          for (const day of days) {
            schedule[day] = Array.from({ length: numPeriods }, () => ({
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

          // Create teacher schedule with some assigned and some unassigned periods
          const teacherSchedule = {};
          const expectedGaps = [];

          // Filter assignedPeriods to only include valid period indices
          const validAssignedPeriods = assignedPeriods.filter(p => p >= 0 && p < numPeriods);

          for (const day of days) {
            teacherSchedule[day] = [];

            for (let periodIndex = 0; periodIndex < numPeriods; periodIndex++) {
              // Determine if this period should be assigned
              const shouldAssign = daysToPopulate.includes(day) && 
                                  validAssignedPeriods.includes(periodIndex);

              if (shouldAssign) {
                // Assign the period
                teacherSchedule[day].push({
                  periodIndex,
                  classId: classDoc._id,
                  subject: 'Math',
                  room: 'Room 101'
                });
              } else {
                // This is a gap (unassigned period)
                expectedGaps.push({ day, periodIndex });
              }
            }
          }

          // Create teacher timetable
          await TeacherTimetable.create({
            teacherId: teacher._id,
            academicYear: '2024-25',
            schedule: teacherSchedule
          });

          // Call the validation service
          const gaps = await validationService.identifyTeacherScheduleGaps(teacher._id, '2024-25');

          // Verify: All expected gaps are identified
          expect(gaps).toHaveLength(expectedGaps.length);

          // Check each expected gap is in the result
          for (const expectedGap of expectedGaps) {
            const found = gaps.some(
              gap => gap.day === expectedGap.day && gap.periodIndex === expectedGap.periodIndex
            );
            expect(found).toBe(true);
          }

          // Verify: No assigned periods are incorrectly identified as gaps
          for (const gap of gaps) {
            const daySchedule = teacherSchedule[gap.day] || [];
            const hasAssignment = daySchedule.some(
              slot => slot.periodIndex === gap.periodIndex && slot.classId
            );
            expect(hasAssignment).toBe(false);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
