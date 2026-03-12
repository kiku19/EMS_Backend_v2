import { Student, Class } from '../database.js';
import { extractSchoolId } from './schoolContext.js';

function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) return { ...query };
  return { ...query, schoolId: normalizedSchoolId };
}

/**
 * Count active students in a class using consistent filters.
 * Always uses { classId, status: 'active', isDeleted: { $ne: true } }.
 *
 * @param {string|ObjectId} classId - The class to count students for
 * @param {string|ObjectId|null} schoolId - Optional schoolId for multi-tenancy scoping
 * @returns {Promise<number>} Active student count
 */
export async function countActiveStudents(classId, schoolId) {
  return Student.countDocuments(
    scopeBySchool(schoolId, {
      classId,
      status: 'active',
      isDeleted: { $ne: true },
    })
  );
}

/**
 * Check whether a class has capacity for more students.
 *
 * @param {string|ObjectId} classId - The class to check
 * @param {string|ObjectId|null} schoolId - Optional schoolId for multi-tenancy scoping
 * @returns {Promise<{ currentCount: number, capacity: number, available: number, isFull: boolean }>}
 */
export async function checkClassCapacity(classId, schoolId) {
  const classData = await Class.findOne(scopeBySchool(schoolId, { _id: classId }));
  if (!classData) {
    return null;
  }

  const currentCount = await countActiveStudents(classId, schoolId);
  const capacity = classData.strengthLimit?.current || classData.strengthLimit?.default || 40;
  const available = capacity - currentCount;
  const isFull = currentCount >= capacity;

  return { currentCount, capacity, available, isFull, classData };
}
