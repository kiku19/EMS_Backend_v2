import { extractSchoolId, ensureDefaultSchool } from '../../utils/schoolContext.js';

export function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) throw new Error('schoolId is required for scoped queries');
  return { ...query, schoolId: normalizedSchoolId };
}

export async function resolveRequestSchoolId(req) {
  if (req.parent?.schoolId) return extractSchoolId(req.parent.schoolId);
  const school = await ensureDefaultSchool();
  return extractSchoolId(school._id);
}
