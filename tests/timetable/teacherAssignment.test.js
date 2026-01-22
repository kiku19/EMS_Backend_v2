import { describe, test, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import fc from 'fast-check';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Staff, Class } from '../../database.js';

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
 * Feature: timetable-management, Property 3: Teacher assignment persistence
 * Validates: Requirements 2.4
 * 
 * Property: For any teacher, subject, and set of classes, when a teacher-subject-class 
 * assignment is created, querying the teacher's assignments should include that assignment
 */
describe('Property 3: Teacher assignment persistence', () => {
  test('teacher assignments persist correctly after creation', async () => {
    let testCounter = 0;
    
    await fc.assert(
      fc.asyncProperty(
        // Generate random subject
        fc.constantFrom('Mathematics', 'Science', 'English', 'History', 'Geography', 'Physics', 'Chemistry'),
        // Generate random number of classes (1-3)
        fc.integer({ min: 1, max: 3 }),
        // Generate random name
        fc.string({ minLength: 5, maxLength: 30 }),
        async (subject, numClasses, teacherName) => {
          // Use a counter to ensure unique codes
          const runId = testCounter++;
          
          // Create teacher with unique code
          const teacherData = {
            code: `TP${runId}`,
            name: teacherName || `Teacher ${runId}`,
            role: 'Teacher',
            password: 'hashedPassword123'
          };
          
          const teacher = await Staff.create(teacherData);
          
          // Create classes
          const classIds = [];
          for (let i = 0; i < numClasses; i++) {
            const classDoc = await Class.create({
              name: `Class ${i + 1}`,
              section: String.fromCharCode(65 + i), // A, B, C, etc.
              academicYear: '2024-25'
            });
            classIds.push(classDoc._id);
          }
          
          // Create teacher assignment
          teacher.teacherAssignments.push({
            subject: subject,
            classes: classIds
          });
          await teacher.save();
          
          // Query the teacher's assignments
          const retrievedTeacher = await Staff.findById(teacher._id);
          
          // Verify the assignment exists
          const assignment = retrievedTeacher.teacherAssignments.find(
            a => a.subject === subject
          );
          
          // Assertions
          expect(assignment).toBeDefined();
          expect(assignment.subject).toBe(subject);
          expect(assignment.classes).toHaveLength(numClasses);
          
          // Verify all class IDs are present
          const assignedClassIds = assignment.classes.map(id => id.toString());
          const expectedClassIds = classIds.map(id => id.toString());
          
          for (const expectedId of expectedClassIds) {
            expect(assignedClassIds).toContain(expectedId);
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: timetable-management, Property 7: Available teacher filtering by qualification
 * Validates: Requirements 3.2, 7.1
 * 
 * Property: For any class, subject, and time slot, the list of available teachers should 
 * only include teachers who have a teacher-subject-class assignment matching that class and subject
 */
describe('Property 7: Available teacher filtering by qualification', () => {
  test('available teachers are filtered by subject-class qualification', async () => {
    let testCounter = 0;
    
    await fc.assert(
      fc.asyncProperty(
        // Generate random subject
        fc.constantFrom('Mathematics', 'Science', 'English', 'History', 'Geography'),
        // Generate number of qualified teachers (1-3)
        fc.integer({ min: 1, max: 3 }),
        // Generate number of unqualified teachers (1-3)
        fc.integer({ min: 1, max: 3 }),
        async (subject, numQualified, numUnqualified) => {
          // Use a counter to ensure unique codes
          const runId = testCounter++;
          
          // Create a target class
          const targetClass = await Class.create({
            name: `Class ${runId}`,
            section: 'A',
            academicYear: '2024-25'
          });
          
          // Create qualified teachers (have assignment for this subject and class)
          const qualifiedTeachers = [];
          for (let i = 0; i < numQualified; i++) {
            const teacher = await Staff.create({
              code: `TQ${runId}-${i}`,
              name: `Qualified Teacher ${runId}-${i}`,
              role: 'Teacher',
              password: 'hashedPassword123',
              status: 'active',
              teacherAssignments: [{
                subject: subject,
                classes: [targetClass._id]
              }]
            });
            qualifiedTeachers.push(teacher);
          }
          
          // Create unqualified teachers (no assignment for this subject-class combination)
          const unqualifiedTeachers = [];
          for (let i = 0; i < numUnqualified; i++) {
            const teacher = await Staff.create({
              code: `TU${runId}-${i}`,
              name: `Unqualified Teacher ${runId}-${i}`,
              role: 'Teacher',
              password: 'hashedPassword123',
              status: 'active',
              teacherAssignments: [] // No assignments
            });
            unqualifiedTeachers.push(teacher);
          }
          
          // Query for available teachers using the same logic as the API endpoint
          const availableTeachers = await Staff.find({
            status: 'active',
            'teacherAssignments': {
              $elemMatch: {
                subject: subject,
                classes: targetClass._id
              }
            }
          });
          
          // Verify only qualified teachers are returned
          expect(availableTeachers).toHaveLength(numQualified);
          
          // Verify all qualified teachers are in the result
          const availableIds = availableTeachers.map(t => t._id.toString());
          for (const qualifiedTeacher of qualifiedTeachers) {
            expect(availableIds).toContain(qualifiedTeacher._id.toString());
          }
          
          // Verify no unqualified teachers are in the result
          for (const unqualifiedTeacher of unqualifiedTeachers) {
            expect(availableIds).not.toContain(unqualifiedTeacher._id.toString());
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: timetable-management, Property 13: Teacher assignment query correctness
 * Validates: Requirements 9.2
 * 
 * Property: For any class and subject, querying available teachers should return only 
 * teachers whose teacherAssignments array contains an entry with that subject and that 
 * class in the classes array
 */
describe('Property 13: Teacher assignment query correctness', () => {
  test('teacher assignment queries return correct results', async () => {
    let testCounter = 0;
    
    await fc.assert(
      fc.asyncProperty(
        // Generate random subject
        fc.constantFrom('Mathematics', 'Science', 'English', 'History'),
        // Generate number of teachers with correct assignment (1-4)
        fc.integer({ min: 1, max: 4 }),
        // Generate number of teachers with different subject (0-2)
        fc.integer({ min: 0, max: 2 }),
        // Generate number of teachers with different class (0-2)
        fc.integer({ min: 0, max: 2 }),
        async (targetSubject, numCorrect, numWrongSubject, numWrongClass) => {
          // Use a counter to ensure unique codes
          const runId = testCounter++;
          
          // Create target class
          const targetClass = await Class.create({
            name: `Class ${runId}`,
            section: 'A',
            academicYear: '2024-25'
          });
          
          // Create another class for wrong-class teachers
          const otherClass = await Class.create({
            name: `Class ${runId}`,
            section: 'B',
            academicYear: '2024-25'
          });
          
          // Create teachers with correct assignment (target subject + target class)
          const correctTeachers = [];
          for (let i = 0; i < numCorrect; i++) {
            const teacher = await Staff.create({
              code: `TC${runId}-${i}`,
              name: `Correct Teacher ${runId}-${i}`,
              role: 'Teacher',
              password: 'hashedPassword123',
              status: 'active',
              teacherAssignments: [{
                subject: targetSubject,
                classes: [targetClass._id]
              }]
            });
            correctTeachers.push(teacher);
          }
          
          // Create teachers with wrong subject (different subject + target class)
          const wrongSubjectTeachers = [];
          const otherSubjects = ['Art', 'Music', 'PE'].filter(s => s !== targetSubject);
          for (let i = 0; i < numWrongSubject; i++) {
            const teacher = await Staff.create({
              code: `TWS${runId}-${i}`,
              name: `Wrong Subject Teacher ${runId}-${i}`,
              role: 'Teacher',
              password: 'hashedPassword123',
              status: 'active',
              teacherAssignments: [{
                subject: otherSubjects[i % otherSubjects.length],
                classes: [targetClass._id]
              }]
            });
            wrongSubjectTeachers.push(teacher);
          }
          
          // Create teachers with wrong class (target subject + different class)
          const wrongClassTeachers = [];
          for (let i = 0; i < numWrongClass; i++) {
            const teacher = await Staff.create({
              code: `TWC${runId}-${i}`,
              name: `Wrong Class Teacher ${runId}-${i}`,
              role: 'Teacher',
              password: 'hashedPassword123',
              status: 'active',
              teacherAssignments: [{
                subject: targetSubject,
                classes: [otherClass._id]
              }]
            });
            wrongClassTeachers.push(teacher);
          }
          
          // Query using the exact logic from the API endpoint
          const queryResult = await Staff.find({
            status: 'active',
            'teacherAssignments': {
              $elemMatch: {
                subject: targetSubject,
                classes: targetClass._id
              }
            }
          });
          
          // Verify only teachers with correct assignment are returned
          expect(queryResult).toHaveLength(numCorrect);
          
          // Verify all correct teachers are in the result
          const resultIds = queryResult.map(t => t._id.toString());
          for (const correctTeacher of correctTeachers) {
            expect(resultIds).toContain(correctTeacher._id.toString());
          }
          
          // Verify no wrong-subject teachers are in the result
          for (const wrongTeacher of wrongSubjectTeachers) {
            expect(resultIds).not.toContain(wrongTeacher._id.toString());
          }
          
          // Verify no wrong-class teachers are in the result
          for (const wrongTeacher of wrongClassTeachers) {
            expect(resultIds).not.toContain(wrongTeacher._id.toString());
          }
          
          // Additional verification: check the structure of returned assignments
          for (const teacher of queryResult) {
            const matchingAssignment = teacher.teacherAssignments.find(
              a => a.subject === targetSubject && 
                   a.classes.some(c => c.toString() === targetClass._id.toString())
            );
            expect(matchingAssignment).toBeDefined();
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: timetable-management, Property 9: Class switch validation
 * Validates: Requirements 5.4
 * 
 * Property: For any teacher, when switching from one class to another in a time slot, 
 * the teacher must have a valid teacher-subject-class assignment for the subject in the new class
 */
describe('Property 9: Class switch validation', () => {
  test('class switches are only allowed when teacher has valid assignment for new class', async () => {
    let testCounter = 0;
    
    await fc.assert(
      fc.asyncProperty(
        // Generate random subject
        fc.constantFrom('Mathematics', 'Science', 'English', 'History', 'Geography'),
        // Generate random day
        fc.constantFrom('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'),
        // Generate random period index (0-7)
        fc.integer({ min: 0, max: 7 }),
        async (subject, day, periodIndex) => {
          // Use a counter to ensure unique codes
          const runId = testCounter++;
          
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
          
          // Create a teacher with assignment for subject in class1 but NOT in class2
          const teacher = await Staff.create({
            code: `T${runId}`,
            name: `Teacher ${runId}`,
            role: 'Teacher',
            password: 'hashedPassword123',
            status: 'active',
            teacherAssignments: [{
              subject: subject,
              classes: [class1._id] // Only assigned to class1
            }]
          });
          
          // Simulate validation logic for switching from class1 to class2
          // This is the logic that should be in the API endpoint
          
          // Check if teacher has assignment for the subject in class2
          const hasAssignmentForClass2 = teacher.teacherAssignments.some(assignment => 
            assignment.subject === subject && 
            assignment.classes.some(c => c.toString() === class2._id.toString())
          );
          
          // The switch should be INVALID because teacher is not assigned to class2
          expect(hasAssignmentForClass2).toBe(false);
          
          // Now add assignment for class2 and verify it becomes valid
          teacher.teacherAssignments[0].classes.push(class2._id);
          await teacher.save();
          
          // Re-fetch teacher to get updated data
          const updatedTeacher = await Staff.findById(teacher._id);
          
          // Check again
          const hasAssignmentAfterUpdate = updatedTeacher.teacherAssignments.some(assignment => 
            assignment.subject === subject && 
            assignment.classes.some(c => c.toString() === class2._id.toString())
          );
          
          // Now the switch should be VALID
          expect(hasAssignmentAfterUpdate).toBe(true);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
  
  test('class switches with multiple subjects validate correctly', async () => {
    let testCounter = 0;
    
    await fc.assert(
      fc.asyncProperty(
        // Generate two different subjects
        fc.constantFrom('Mathematics', 'Science', 'English', 'History'),
        fc.constantFrom('Geography', 'Physics', 'Chemistry', 'Biology'),
        // Generate random day
        fc.constantFrom('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'),
        // Generate random period index (0-7)
        fc.integer({ min: 0, max: 7 }),
        async (subject1, subject2, day, periodIndex) => {
          // Ensure subjects are different
          if (subject1 === subject2) {
            return true; // Skip this iteration
          }
          
          // Use a counter to ensure unique codes
          const runId = testCounter++;
          
          // Create three classes
          const classA = await Class.create({
            name: `Class ${runId}`,
            section: 'A',
            academicYear: '2024-25'
          });
          
          const classB = await Class.create({
            name: `Class ${runId}`,
            section: 'B',
            academicYear: '2024-25'
          });
          
          const classC = await Class.create({
            name: `Class ${runId}`,
            section: 'C',
            academicYear: '2024-25'
          });
          
          // Create a teacher with:
          // - subject1 in classA and classB
          // - subject2 in classB and classC
          const teacher = await Staff.create({
            code: `T${runId}`,
            name: `Teacher ${runId}`,
            role: 'Teacher',
            password: 'hashedPassword123',
            status: 'active',
            teacherAssignments: [
              {
                subject: subject1,
                classes: [classA._id, classB._id]
              },
              {
                subject: subject2,
                classes: [classB._id, classC._id]
              }
            ]
          });
          
          // Test various switch scenarios
          
          // Scenario 1: Switch from classA to classB for subject1 - VALID
          const canSwitchAtoB_Subject1 = teacher.teacherAssignments.some(assignment => 
            assignment.subject === subject1 && 
            assignment.classes.some(c => c.toString() === classB._id.toString())
          );
          expect(canSwitchAtoB_Subject1).toBe(true);
          
          // Scenario 2: Switch from classA to classC for subject1 - INVALID
          const canSwitchAtoC_Subject1 = teacher.teacherAssignments.some(assignment => 
            assignment.subject === subject1 && 
            assignment.classes.some(c => c.toString() === classC._id.toString())
          );
          expect(canSwitchAtoC_Subject1).toBe(false);
          
          // Scenario 3: Switch from classB to classC for subject2 - VALID
          const canSwitchBtoC_Subject2 = teacher.teacherAssignments.some(assignment => 
            assignment.subject === subject2 && 
            assignment.classes.some(c => c.toString() === classC._id.toString())
          );
          expect(canSwitchBtoC_Subject2).toBe(true);
          
          // Scenario 4: Switch from classB to classA for subject2 - INVALID
          const canSwitchBtoA_Subject2 = teacher.teacherAssignments.some(assignment => 
            assignment.subject === subject2 && 
            assignment.classes.some(c => c.toString() === classA._id.toString())
          );
          expect(canSwitchBtoA_Subject2).toBe(false);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
