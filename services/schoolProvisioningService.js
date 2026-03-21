import crypto from 'crypto';
import { School, SchoolSettings, Staff, UserPermission, getNextStaffCode } from '../database.js';
import { PERMISSION_TEMPLATES } from '../models/UserPermission.js';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';
import { normalizeSchoolCode, serializeSchool } from '../utils/schoolContext.js';

function buildPermissionEntries(permissionRole) {
  const template = PERMISSION_TEMPLATES[permissionRole] || PERMISSION_TEMPLATES.teacher;

  return Object.entries(template).map(([module, permissions]) => ({
    module,
    ...permissions,
  }));
}

function sanitizeObject(input = {}) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function normalizeEmail(value) {
  return value ? String(value).trim().toLowerCase() : null;
}

function normalizeNullableString(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function generateTemporaryPassword() {
  return `Temp-${crypto.randomBytes(4).toString('hex')}A1`;
}

async function ensureUniqueUsername(baseUsername) {
  let username = baseUsername;
  let suffix = 1;

  while (await Staff.findOne({ username })) {
    username = `${baseUsername}${suffix}`;
    suffix += 1;
  }

  return username;
}

export async function generateUniqueSchoolCode(schoolName, preferredCode = null) {
  const baseCode = normalizeSchoolCode(preferredCode || schoolName) || 'SCHOOL';
  let candidate = baseCode;
  let suffix = 2;

  while (await School.findOne({ code: candidate })) {
    const suffixToken = `-${suffix}`;
    candidate = `${baseCode.slice(0, Math.max(1, 40 - suffixToken.length))}${suffixToken}`;
    suffix += 1;
  }

  return candidate;
}

export async function ensureSchoolSettingsForSchool({
  school,
  schoolSettings = {},
  contactEmail = null,
  contactPhone = null,
}) {
  let settings = await SchoolSettings.findOne({ schoolId: school._id });

  if (!settings) {
    settings = await SchoolSettings.create({
      schoolId: school._id,
      name: school.name,
      schoolName: school.name,
      email: contactEmail,
      phone: contactPhone,
      academicYear: CURRENT_ACADEMIC_YEAR,
      currentSession: CURRENT_ACADEMIC_YEAR,
      ...sanitizeObject(schoolSettings),
    });

    return settings;
  }

  settings.set({
    name: schoolSettings.name || settings.name || school.name,
    schoolName: schoolSettings.schoolName || settings.schoolName || school.name,
    ...(contactEmail ? { email: contactEmail } : {}),
    ...(contactPhone ? { phone: contactPhone } : {}),
    ...sanitizeObject(schoolSettings),
  });

  await settings.save();
  return settings;
}

export async function ensureAdminForSchool({
  school,
  adminName,
  adminEmail,
  adminPassword,
  contactPhone = null,
}) {
  const normalizedEmail = normalizeEmail(adminEmail);
  let admin =
    (normalizedEmail
      ? await Staff.findOne({ schoolId: school._id, email: normalizedEmail })
      : null) ||
    (await Staff.findOne({ schoolId: school._id, role: 'Admin' }).sort({ createdAt: 1 }));

  let temporaryPassword = null;
  let created = false;

  if (!admin) {
    const code = await getNextStaffCode(school._id);
    const baseUsername =
      normalizeNullableString(normalizedEmail?.split('@')[0]) || code.toLowerCase();
    const username = await ensureUniqueUsername(baseUsername.toLowerCase());
    temporaryPassword = adminPassword || generateTemporaryPassword();

    admin = await Staff.create({
      schoolId: school._id,
      code,
      name: normalizeNullableString(adminName) || `${school.name} Admin`,
      role: ['Admin'],
      department: 'Administration',
      status: 'active',
      email: normalizedEmail,
      phone: normalizeNullableString(contactPhone),
      username,
      password: temporaryPassword,
    });

    created = true;
  }

  if (!created) {
    let changed = false;

    if (normalizedEmail && admin.email !== normalizedEmail) {
      admin.email = normalizedEmail;
      changed = true;
    }

    const normalizedName = normalizeNullableString(adminName);
    if (normalizedName && admin.name !== normalizedName) {
      admin.name = normalizedName;
      changed = true;
    }

    const normalizedPhone = normalizeNullableString(contactPhone);
    if (normalizedPhone && admin.phone !== normalizedPhone) {
      admin.phone = normalizedPhone;
      changed = true;
    }

    if (changed) {
      await admin.save();
    }
  }

  await UserPermission.findOneAndUpdate(
    { schoolId: school._id, userId: admin._id },
    {
      schoolId: school._id,
      userId: admin._id,
      role: 'admin',
      permissions: buildPermissionEntries('admin'),
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );

  return {
    admin,
    created,
    temporaryPassword,
  };
}

export async function provisionSchoolResources({
  school,
  adminName,
  adminEmail,
  adminPassword,
  contactPhone = null,
  schoolSettings = {},
  provisionedBy = 'system',
  source = 'system',
}) {
  const settings = await ensureSchoolSettingsForSchool({
    school,
    schoolSettings,
    contactEmail: school.contactEmail || normalizeEmail(adminEmail),
    contactPhone: contactPhone || school.contactPhone,
  });

  const adminResult = await ensureAdminForSchool({
    school,
    adminName,
    adminEmail,
    adminPassword,
    contactPhone,
  });

  school.provisioning = {
    status: 'ready',
    lastProvisionedAt: new Date(),
    lastProvisionedBy: provisionedBy,
    notes: source,
  };

  school.metadata = {
    ...(school.metadata || {}),
    onboardingSource: source,
  };

  await school.save();

  return {
    school,
    settings,
    admin: adminResult.admin,
    temporaryPassword: adminResult.temporaryPassword,
    adminCreated: adminResult.created,
  };
}

export async function onboardSchool({
  schoolName,
  schoolCode = null,
  contactEmail = null,
  contactPhone = null,
  plan = 'starter',
  planStatus = 'trialing',
  trialEndsAt = null,
  frontendUrl = null,
  backendUrl = null,
  adminName,
  adminEmail,
  adminPassword,
  schoolSettings = {},
  provisionedBy = 'system',
  source = 'super-admin',
}) {
  const code = await generateUniqueSchoolCode(schoolName, schoolCode);

  const school = await School.create({
    name: schoolName.trim(),
    code,
    status: 'active',
    isDefault: false,
    plan,
    planStatus,
    trialEndsAt: trialEndsAt || null,
    contactEmail: normalizeEmail(contactEmail || adminEmail),
    contactPhone: normalizeNullableString(contactPhone),
    frontendUrl: normalizeNullableString(frontendUrl),
    backendUrl: normalizeNullableString(backendUrl),
    provisioning: {
      status: 'pending',
      lastProvisionedAt: null,
      lastProvisionedBy: null,
      notes: null,
    },
    metadata: {
      onboardingSource: source,
      ownerName: normalizeNullableString(adminName),
    },
  });

  return provisionSchoolResources({
    school,
    adminName,
    adminEmail,
    adminPassword,
    contactPhone,
    schoolSettings,
    provisionedBy,
    source,
  });
}

export function serializeProvisionedAdmin(admin) {
  if (!admin) {
    return null;
  }

  return {
    id: admin._id?.toString?.() || admin._id || null,
    name: admin.name || null,
    email: admin.email || null,
    phone: admin.phone || null,
    status: admin.status || null,
  };
}

export function serializeProvisioningResult(result) {
  return {
    school: serializeSchool(result.school),
    admin: serializeProvisionedAdmin(result.admin),
    temporaryPassword: result.temporaryPassword || null,
    adminCreated: Boolean(result.adminCreated),
  };
}
