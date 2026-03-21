import crypto from 'node:crypto';
import { Staff } from '../../database.js';
import UserPermission, { PERMISSION_TEMPLATES } from '../../models/UserPermission.js';
import { ensureDefaultSchool, extractSchoolId } from '../../utils/schoolContext.js';

export const ROLE_MAPPING = {
  Admin: 'admin',
  Principal: 'principal',
  'Vice Principal': 'vice-principal',
  Teacher: 'teacher',
  Accountant: 'accountant',
  Librarian: 'librarian',
  'Lab Assistant': 'lab-assistant',
  Receptionist: 'receptionist',
  Administrative: 'admin',
  Administration: 'admin',
  Teaching: 'teacher',
};

// Fix 3.19: Use crypto.randomInt() instead of Math.random() for cryptographically secure password generation
export function generatePassword(length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  for (let index = 0; index < length; index += 1) {
    password += chars.charAt(crypto.randomInt(chars.length));
  }
  return password;
}

export function getPermissionRole(role) {
  const staffRoles = Array.isArray(role) ? role : [role];
  return ROLE_MAPPING[staffRoles[0]] || 'teacher';
}

// Fix 3.11: scopeBySchool throws when schoolId is missing instead of silently dropping filter
export function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);

  if (!normalizedSchoolId) {
    throw new Error('schoolId is required for scoped queries');
  }

  return {
    ...query,
    schoolId: normalizedSchoolId,
  };
}

export async function resolveRequestSchoolId(req) {
  if (req.user?.schoolId) {
    return extractSchoolId(req.user.schoolId);
  }

  const school = await ensureDefaultSchool();
  return extractSchoolId(school._id);
}

export async function buildPermissions(role, userId, schoolId = null) {
  const permissionRole = getPermissionRole(role);
  const template = PERMISSION_TEMPLATES[permissionRole] || PERMISSION_TEMPLATES.teacher;
  const permissions = Object.entries(template).map(([module, perms]) => ({
    module,
    ...perms,
  }));

  await UserPermission.findOneAndUpdate(
    { userId },
    { schoolId, role: permissionRole, permissions },
    { upsert: true, new: true }
  );

  return permissionRole;
}

export async function ensureUniqueUsername(baseUsername, schoolId) {
  let username = baseUsername;
  let suffix = 1;

  while (await Staff.findOne(scopeBySchool(schoolId, { username, isDeleted: { $ne: true } }))) {
    username = `${baseUsername}${suffix}`;
    suffix += 1;
  }

  return username;
}

// Fix 2.15: Remove hardcoded fake PAN 'ABCDE1234F'
// Fix 3.18: designation maps to staff.designation instead of staff.role
export function formatStaffResponse(staff, assignedClass = null) {
  return {
    id: staff._id,
    schoolId: extractSchoolId(staff.schoolId),
    code: staff.code,
    name: staff.name,
    role: staff.role,
    department: staff.department,
    status: staff.status,
    phone: staff.phone,
    email: staff.email,
    joinDate: staff.joinDate,
    address: staff.address,
    username: staff.username,
    dob: staff.dob,
    dateOfBirth: staff.dob,
    gender: staff.gender,
    fatherName: staff.fatherName,
    bloodGroup: staff.bloodGroup,
    maritalStatus: staff.maritalStatus,
    employmentType: staff.employmentType,
    nationality: staff.nationality || 'Indian',
    emergencyContact: staff.emergencyContact,
    emergencyPhone: staff.emergencyPhone,
    emergencyContacts: staff.emergencyContacts || [],
    whatsappNumber: staff.whatsappNumber,
    isWhatsapp: staff.isWhatsapp || false,
    picture: staff.picture,
    photo: staff.photo || staff.picture,
    idDocuments: staff.idDocuments,
    professionalQualifications: staff.professionalQualifications,
    qualification: staff.professionalQualifications?.map((item) => item.name).join(', ') || '',
    totalExperience: staff.totalExperience,
    experience: parseInt(staff.totalExperience, 10) || 0,
    previousOrganization: staff.previousOrganization,
    roleInOrganization: staff.roleInOrganization,
    qualificationDocs: staff.qualificationDocs,
    customDocuments: staff.customDocuments,
    staffNumber: staff.staffNumber,
    staffType: staff.staffType,
    designation: staff.designation || staff.role,
    assignedClasses: staff.assignedClasses,
    isClassTeacher: staff.isClassTeacher,
    classTeacherOf: staff.classTeacherOf,
    classes: staff.assignedClasses,
    shift: staff.shift || 'Morning',
    accountNumber: staff.accountNumber,
    accountHolder: staff.name,
    ifscCode: staff.ifscCode,
    bankName: staff.bankName,
    branchName: staff.branchName,
    panNumber: staff.panNumber || '',
    salary: staff.salary || 0,
    salaryTemplate: staff.salaryTemplate,
    salaryBreakdown: staff.salaryBreakdown,
    assignedClass: assignedClass ? `${assignedClass.name} ${assignedClass.section}` : null,
    assignedClassId: assignedClass?._id,
    reporterId: staff.reporterId?._id || staff.reporterId || null,
    reporterName: staff.reporterId?.name || null,
  };
}

export async function validateReporter(reporterId, currentStaffId = null, schoolId = null) {
  if (reporterId === undefined || reporterId === null || reporterId === '') {
    return null;
  }

  const reporter = await Staff.findOne(scopeBySchool(schoolId, { _id: reporterId }));
  if (!reporter) {
    return 'Reporter not found';
  }

  if (!currentStaffId) {
    return null;
  }

  const MAX_HIERARCHY_DEPTH = 10;
  const checkCircular = async (currentId, targetId, visited = new Set(), depth = 0) => {
    if (depth > MAX_HIERARCHY_DEPTH) {
      throw new Error(
        'Maximum hierarchy depth exceeded. Cannot create hierarchy deeper than 10 levels.'
      );
    }

    if (currentId === targetId) {
      return true;
    }
    if (visited.has(currentId)) {
      return false;
    }

    visited.add(currentId);
    const current = await Staff.findById(currentId);
    if (!current?.reporterId) {
      return false;
    }

    return checkCircular(current.reporterId.toString(), targetId, visited, depth + 1);
  };

  const hasCircular = await checkCircular(reporterId, currentStaffId);
  return hasCircular ? 'Cannot assign reporter: This would create a circular reference' : null;
}
