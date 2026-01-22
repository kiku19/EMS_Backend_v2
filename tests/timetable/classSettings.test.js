import { describe, test, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import fc from 'fast-check';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Class } from '../../database.js';

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
 * Feature: timetable-management, Property 1: Class tag persistence
 * Validates: Requirements 1.4
 * 
 * Property: For any class, when a class tag is saved, retrieving the class settings 
 * should return the same tag value
 */
describe('Property 1: Class tag persistence', () => {
  test('class tags persist correctly after saving', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate random class data
        fc.record({
          name: fc.constantFrom('Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 
                                'Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10'),
          section: fc.constantFrom('A', 'B', 'C', 'D', 'E'),
          academicYear: fc.constant('2024-25')
        }),
        // Generate random class tag (including empty strings and special characters)
        fc.string({ minLength: 0, maxLength: 50 }),
        async (classData, classTag) => {
          // Create class
          const classDoc = await Class.create(classData);
          
          // Update class tag
          classDoc.classTag = classTag;
          await classDoc.save();
          
          // Retrieve the class
          const retrievedClass = await Class.findById(classDoc._id);
          
          // Verify the tag persisted correctly
          expect(retrievedClass.classTag).toBe(classTag);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: timetable-management, Property 2: Subject association persistence
 * Validates: Requirements 1.3
 * 
 * Property: For any class and set of subjects, when subjects are assigned to a class, 
 * retrieving the class should return the same set of subjects
 */
describe('Property 2: Subject association persistence', () => {
  test('subject associations persist correctly after assignment', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate random class data
        fc.record({
          name: fc.constantFrom('Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 
                                'Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10'),
          section: fc.constantFrom('A', 'B', 'C', 'D', 'E'),
          academicYear: fc.constant('2024-25')
        }),
        // Generate random set of subjects (0-8 subjects)
        fc.uniqueArray(
          fc.constantFrom('Mathematics', 'Science', 'English', 'History', 'Geography', 
                         'Physics', 'Chemistry', 'Biology', 'Computer Science', 'Art'),
          { minLength: 0, maxLength: 8 }
        ),
        async (classData, subjects) => {
          // Create class
          const classDoc = await Class.create(classData);
          
          // Assign subjects
          classDoc.assignedSubjects = subjects;
          await classDoc.save();
          
          // Retrieve the class
          const retrievedClass = await Class.findById(classDoc._id);
          
          // Verify the subjects persisted correctly
          expect(retrievedClass.assignedSubjects).toHaveLength(subjects.length);
          
          // Verify all subjects are present (order doesn't matter)
          for (const subject of subjects) {
            expect(retrievedClass.assignedSubjects).toContain(subject);
          }
          
          // Verify no extra subjects were added
          for (const subject of retrievedClass.assignedSubjects) {
            expect(subjects).toContain(subject);
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
