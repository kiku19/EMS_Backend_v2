import { Class, School, Staff, Student, UserPermission } from '../../database.js';
import { generateToken } from '../../middleware/auth.js';
import { PERMISSION_TEMPLATES } from '../../models/UserPermission.js';
import { extractSchoolId } from '../../utils/schoolContext.js';
import { CURRENT_ACADEMIC_YEAR } from '../../utils/constants.js';
import Parent from '../../models/Parent.js';

let sequence = 0;
let defaultSchool = null;

function nextSequence() {
  sequence += 1;
  return sequence;
}

async function getDefaultSchool() {
  if (!defaultSchool) {
    defaultSchool = await School.create({
      name: 'Test School',
      code: 'TEST-DEFAULT',
      isDefault: true,
      status: 'active',
    });
  }
  return defaultSchool;
}

export function resetDefaultSchool() {
  defaultSchool = null;
}

function toPermissionsArray(template) {
  return Object.entries(template).map(([module, actions]) => ({
    module,
    view: Boolean(actions.view),
    create: Boolean(actions.create),
    edit: Boolean(actions.edit),
    delete: Boolean(actions.delete),
    publish: Boolean(actions.publish),
  }));
}

export async function createStaffUser({
  name = 'Admin User',
  email,
  phone,
  password = 'Password123',
  staffRole = ['Admin'],
  permissionRole = 'admin',
  status = 'active',
  schoolId,
  department,
} = {}) {
  const id = nextSequence();
  if (!schoolId) {
    const school = await getDefaultSchool();
    schoolId = school._id;
  }
  const staff = await Staff.create({
    schoolId,
    code: `EMP${String(id).padStart(4, '0')}`,
    name,
    email: email || `user${id}@example.com`,
    phone: phone || `9${String(id).padStart(9, '0')}`,
    password,
    role: Array.isArray(staffRole) ? staffRole : [staffRole],
    status,
    ...(department ? { department } : {}),
  });

  // Upsert guards against duplicate-key races when the same worker/database
  // is reused across test files or when a previous test left a row behind.
  await UserPermission.findOneAndUpdate(
    { schoolId, userId: staff._id },
    {
      schoolId,
      userId: staff._id,
      role: permissionRole,
      permissions: toPermissionsArray(PERMISSION_TEMPLATES[permissionRole]),
    },
    { upsert: true }
  );

  return staff;
}

export function authHeadersFor(staff, jwtRole = 'admin') {
  return {
    Authorization: `Bearer ${generateToken(staff._id.toString(), jwtRole, {
      schoolId: extractSchoolId(staff.schoolId),
      userType: 'staff',
    })}`,
  };
}

export async function createParentUser({
  name = 'Parent User',
  phone,
  email,
  schoolId,
  status = 'active',
  children = [],
} = {}) {
  const id = nextSequence();
  if (!schoolId) {
    const school = await getDefaultSchool();
    schoolId = school._id;
  }
  const normalizedChildren = children.map((child) => ({
    relationship: 'father',
    ...child,
  }));
  return Parent.create({
    schoolId,
    name: name || `Parent ${id}`,
    phone: phone || `7${String(id).padStart(9, '0')}`,
    email: email || `parent${id}@example.com`,
    status,
    children: normalizedChildren,
  });
}

export function parentAuthHeadersFor(parent) {
  return {
    Authorization: `Bearer ${generateToken(parent._id.toString(), 'parent', {
      schoolId: extractSchoolId(parent.schoolId),
      userType: 'parent',
    })}`,
  };
}

export async function createSchoolRecord({
  name = 'Default School',
  code = `SCHOOL-${String(nextSequence()).padStart(3, '0')}`,
  isDefault = false,
} = {}) {
  return School.create({
    name,
    code,
    isDefault,
    status: 'active',
  });
}

export async function createClassRecord({
  name = 'Class 10',
  section = 'A',
  classTeacherId = null,
  subjects = ['Math'],
  academicYear = CURRENT_ACADEMIC_YEAR,
  schoolId,
  classTag,
} = {}) {
  if (!schoolId) {
    const school = await getDefaultSchool();
    schoolId = school._id;
  }
  return Class.create({
    name,
    section,
    classTeacherId,
    subjects,
    academicYear,
    schoolId,
    ...(classTag ? { classTag } : {}),
  });
}

export async function createStudentRecord({
  name = 'Student One',
  admissionId,
  academicYear = CURRENT_ACADEMIC_YEAR,
  rollNo = nextSequence(),
  classId,
  schoolId,
  parentName = 'Parent One',
  parentPhone = '9876543210',
  dateOfBirth = '2010-05-15',
  feeStatus = 'pending',
  status = 'active',
  parents,
  feeDetails = undefined,
  email,
} = {}) {
  const id = nextSequence();
  if (!schoolId) {
    const school = await getDefaultSchool();
    schoolId = school._id;
  }
  const normalizedParents = parents || [
    {
      name: parentName,
      relationship: 'father',
      phone: parentPhone,
      isWhatsapp: true,
    },
  ];

  return Student.create({
    name,
    admissionId: admissionId || `ADM${String(id).padStart(4, '0')}`,
    academicYear,
    rollNo,
    classId,
    schoolId,
    parents: normalizedParents,
    dateOfBirth,
    feeStatus,
    status,
    ...(email ? { email } : {}),
    ...(feeDetails ? { feeDetails } : {}),
  });
}
