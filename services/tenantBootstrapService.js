import { Parent, SchoolSettings, Staff } from '../database.js';
import UserPermission from '../models/UserPermission.js';
import { ensureDefaultSchool, serializeSchool } from '../utils/schoolContext.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('TenantBootstrap');

function missingSchoolQuery() {
  return {
    $or: [
      { schoolId: { $exists: false } },
      { schoolId: null },
    ],
  };
}

async function backfillSchoolId(model, schoolId) {
  const result = await model.updateMany(missingSchoolQuery(), {
    $set: { schoolId },
  });

  return {
    matched: result.matchedCount || 0,
    modified: result.modifiedCount || 0,
  };
}

export async function bootstrapTenantContext() {
  const school = await ensureDefaultSchool();
  const schoolId = school._id;

  const [staff, parents, permissions, settings] = await Promise.all([
    backfillSchoolId(Staff, schoolId),
    backfillSchoolId(Parent, schoolId),
    backfillSchoolId(UserPermission, schoolId),
    backfillSchoolId(SchoolSettings, schoolId),
  ]);

  const summary = {
    school: serializeSchool(school),
    backfill: {
      staff,
      parents,
      permissions,
      settings,
    },
  };

  logger.info(summary, 'Tenant bootstrap completed');
  return summary;
}
