import mongoose from 'mongoose';
import School from '../models/School.js';

function toCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function normalizeSchoolCode(value) {
  return toCode(value);
}

export function getDefaultSchoolSeed() {
  const configuredName = process.env.DEFAULT_SCHOOL_NAME?.trim() || 'Default School';
  const configuredCode = normalizeSchoolCode(process.env.DEFAULT_SCHOOL_CODE);
  const code = configuredCode || normalizeSchoolCode(configuredName) || 'DEFAULT-SCHOOL';

  return {
    name: configuredName,
    code,
    status: 'active',
    isDefault: true,
  };
}

export function serializeSchool(school) {
  if (!school) {
    return null;
  }

  return {
    id: school._id?.toString?.() || school._id || null,
    name: school.name || null,
    code: school.code || null,
    status: school.status || null,
    plan: school.plan || 'starter',
    planStatus: school.planStatus || 'trialing',
    trialEndsAt: school.trialEndsAt || null,
    isDefault: Boolean(school.isDefault),
    contactEmail: school.contactEmail || null,
    contactPhone: school.contactPhone || null,
    frontendUrl: school.frontendUrl || null,
    backendUrl: school.backendUrl || null,
    provisioning: school.provisioning || {
      status: 'pending',
      lastProvisionedAt: null,
      lastProvisionedBy: null,
      notes: null,
    },
  };
}

export function extractSchoolId(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'object' && value._id) {
    return value._id?.toString?.() || value._id || null;
  }

  return value?.toString?.() || value;
}

export function buildSchoolScopedQuery(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) {
    return { ...query };
  }

  return {
    ...query,
    schoolId: normalizedSchoolId,
  };
}

export async function ensureDefaultSchool() {
  let school = await School.findOne({ isDefault: true });

  if (!school) {
    school = await School.findOne().sort({ createdAt: 1 });
  }

  if (!school) {
    school = await School.create(getDefaultSchoolSeed());
    return school;
  }

  let changed = false;
  const defaults = getDefaultSchoolSeed();

  if (!school.name) {
    school.name = defaults.name;
    changed = true;
  }

  if (!school.code) {
    school.code = defaults.code;
    changed = true;
  }

  if (!school.status) {
    school.status = 'active';
    changed = true;
  }

  const hasAnyDefaultSchool = await School.exists({
    isDefault: true,
    _id: { $ne: school._id },
  });

  if (!school.isDefault && !hasAnyDefaultSchool) {
    school.isDefault = true;
    changed = true;
  }

  if (changed) {
    await school.save();
  }

  return school;
}

export async function resolveSchool({ schoolId, schoolCode, fallbackToDefault = false } = {}) {
  if (schoolId) {
    if (!mongoose.Types.ObjectId.isValid(String(schoolId))) {
      return null;
    }

    const school = await School.findById(schoolId);
    if (school) {
      return school;
    }
  }

  if (schoolCode) {
    const school = await School.findOne({ code: normalizeSchoolCode(schoolCode) });
    if (school) {
      return school;
    }
  }

  if (fallbackToDefault) {
    return ensureDefaultSchool();
  }

  return null;
}

export async function ensureDocumentSchool(document) {
  if (!document) {
    return null;
  }

  if (document.schoolId) {
    return extractSchoolId(document.schoolId);
  }

  const school = await ensureDefaultSchool();
  document.schoolId = school._id;

  if (typeof document.save === 'function') {
    await document.save({ validateModifiedOnly: true });
  }

  return extractSchoolId(school._id);
}
