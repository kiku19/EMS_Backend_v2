import { Class } from '../database.js';

/**
 * Resolve a class identifier to a MongoDB ObjectId.
 * Supports ObjectId strings and human-readable identifiers like "10-A".
 */
export async function resolveClassId(identifier) {
  if (!identifier) {
    return null;
  }

  const normalizedIdentifier = String(identifier).trim();
  if (!normalizedIdentifier) {
    return null;
  }

  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(normalizedIdentifier);
  if (isValidObjectId) {
    const classDoc = await Class.findById(normalizedIdentifier);
    if (classDoc) {
      return { classId: classDoc._id, classDoc };
    }
  }

  const classIdentifier = normalizedIdentifier.replace('-', ' ').replace('_', ' ');
  let classDoc = await Class.findOne({
    $or: [
      { name: normalizedIdentifier },
      { name: classIdentifier },
      { $expr: { $eq: [{ $concat: ['$name', '-', '$section'] }, normalizedIdentifier] } },
      { $expr: { $eq: [{ $concat: ['$name', ' ', '$section'] }, classIdentifier] } }
    ]
  });

  if (classDoc) {
    return { classId: classDoc._id, classDoc };
  }

  const parts = normalizedIdentifier.split(/[-_ ]/);
  if (parts.length >= 2) {
    const name = parts[0];
    const section = parts.slice(1).join('-');

    classDoc = await Class.findOne({ name, section });
    if (classDoc) {
      return { classId: classDoc._id, classDoc };
    }
  }

  return null;
}

export default resolveClassId;
