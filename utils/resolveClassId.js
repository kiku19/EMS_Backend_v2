import { Class } from '../database.js';

/**
 * Resolve a class identifier to a MongoDB ObjectId.
 * Supports ObjectId strings and human-readable identifiers like "10-A".
 * @param {string} identifier - Class ID, name, or "name-section" format
 * @param {string|ObjectId} schoolId - School ID for multi-tenant scoping (required)
 */
export async function resolveClassId(identifier, schoolId) {
  if (!identifier) {
    return null;
  }

  const normalizedIdentifier = String(identifier).trim();
  if (!normalizedIdentifier) {
    return null;
  }

  // Build base filter with schoolId and soft-delete scoping
  const baseFilter = {
    ...(schoolId ? { schoolId } : {}),
    isDeleted: { $ne: true },
  };

  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(normalizedIdentifier);
  if (isValidObjectId) {
    const classDoc = await Class.findOne({ _id: normalizedIdentifier, ...baseFilter });
    if (classDoc) {
      return { classId: classDoc._id, classDoc };
    }
  }

  const classIdentifier = normalizedIdentifier.replace('-', ' ').replace('_', ' ');
  let classDoc = await Class.findOne({
    ...baseFilter,
    $or: [
      { name: normalizedIdentifier },
      { name: classIdentifier },
      { $expr: { $eq: [{ $concat: ['$name', '-', '$section'] }, normalizedIdentifier] } },
      { $expr: { $eq: [{ $concat: ['$name', ' ', '$section'] }, classIdentifier] } },
    ],
  });

  if (classDoc) {
    return { classId: classDoc._id, classDoc };
  }

  const parts = normalizedIdentifier.split(/[-_ ]/);
  if (parts.length >= 2) {
    const name = parts[0];
    const section = parts.slice(1).join('-');

    classDoc = await Class.findOne({ name, section, ...baseFilter });
    if (classDoc) {
      return { classId: classDoc._id, classDoc };
    }
  }

  return null;
}

export default resolveClassId;
