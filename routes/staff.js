import express from 'express';
import { Class, Staff, Student, Timetable, getNextStaffCode } from '../database.js';
import UserPermission, { PERMISSION_TEMPLATES } from '../models/UserPermission.js';
import { authenticate, requireAdmin as authRequireAdmin } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { validate, schemas } from '../middleware/validation.js';
import { ensureDefaultSchool, extractSchoolId } from '../utils/schoolContext.js';

const router = express.Router();

const ROLE_MAPPING = {
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
  Teaching: 'teacher'
};

function generatePassword(length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  for (let index = 0; index < length; index += 1) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

function getPermissionRole(role) {
  const staffRoles = Array.isArray(role) ? role : [role];
  return ROLE_MAPPING[staffRoles[0]] || 'teacher';
}

function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);

  if (!normalizedSchoolId) {
    return { ...query };
  }

  return {
    ...query,
    schoolId: normalizedSchoolId,
  };
}

async function resolveRequestSchoolId(req) {
  if (req.user?.schoolId) {
    return extractSchoolId(req.user.schoolId);
  }

  const school = await ensureDefaultSchool();
  return extractSchoolId(school._id);
}

async function buildPermissions(role, userId, schoolId = null) {
  const permissionRole = getPermissionRole(role);
  const template = PERMISSION_TEMPLATES[permissionRole] || PERMISSION_TEMPLATES.teacher;
  const permissions = Object.entries(template).map(([module, perms]) => ({
    module,
    ...perms
  }));

  await UserPermission.findOneAndUpdate(
    { userId },
    { schoolId, role: permissionRole, permissions },
    { upsert: true, new: true }
  );

  return permissionRole;
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

function formatStaffResponse(staff, assignedClass = null) {
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
    designation: staff.role,
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
    panNumber: staff.panNumber || (staff.accountNumber ? 'ABCDE1234F' : ''),
    salary: staff.salary || 0,
    salaryTemplate: staff.salaryTemplate,
    salaryBreakdown: staff.salaryBreakdown,
    assignedClass: assignedClass ? `${assignedClass.name} ${assignedClass.section}` : null,
    assignedClassId: assignedClass?._id,
    reporterId: staff.reporterId?._id || staff.reporterId || null,
    reporterName: staff.reporterId?.name || null,
  };
}

async function validateReporter(reporterId, currentStaffId = null, schoolId = null) {
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
      throw new Error('Maximum hierarchy depth exceeded. Cannot create hierarchy deeper than 10 levels.');
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

router.get('/public', async (req, res) => {
  try {
    const staff = await Staff.find({ status: 'active' })
      .select('name role department')
      .sort({ name: 1 });

    res.json(staff);
  } catch (error) {
    console.error('Error fetching public staff list:', error);
    res.status(500).json({ error: 'Failed to fetch staff list' });
  }
});

router.get('/validate/:id', async (req, res) => {
  try {
    const staff = await Staff.findOne({ _id: req.params.id, status: 'active' });
    if (!staff) {
      return res.json({ valid: false, reason: 'Staff member not found or inactive' });
    }

    res.json({
      valid: true,
      staff: {
        id: staff._id,
        name: staff.name,
        role: staff.role,
        email: staff.email,
        phone: staff.phone,
        status: staff.status
      }
    });
  } catch (error) {
    console.error('Error validating staff member:', error);
    res.json({ valid: false, reason: 'Validation failed' });
  }
});

router.get('/me', authenticate, async (req, res) => {
  try {
    const staff = await Staff.findOne(scopeBySchool(req.user?.schoolId, { _id: req.user.id }))
      .populate('reporterId', 'name');
    if (!staff) {
      return res.status(404).json({ error: 'Staff not found' });
    }

    res.json({
      id: staff._id,
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
      emergencyContact: staff.emergencyContact,
      emergencyPhone: staff.emergencyPhone,
      emergencyContacts: staff.emergencyContacts,
      whatsappNumber: staff.whatsappNumber,
      isWhatsapp: staff.isWhatsapp,
      picture: staff.picture,
      photo: staff.photo || staff.picture,
      qualification: staff.qualification,
      experience: staff.experience,
      professionalQualifications: staff.professionalQualifications,
      totalExperience: staff.totalExperience,
      designation: staff.designation,
      staffNumber: staff.staffNumber,
      staffType: staff.staffType,
    });
  } catch (error) {
    console.error('Error fetching own profile:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/timetable/today', authenticate, async (req, res) => {
  try {
    const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const timetable = await Timetable.find({
      teacherId: req.params.id,
      day: dayName
    }).populate('classId', 'name section strength');

    const schedule = timetable.map((entry) => ({
      id: entry._id,
      subject: entry.subject,
      topic: entry.topic || '',
      startTime: entry.startTime,
      endTime: entry.endTime,
      room: entry.room || '',
      class: entry.classId ? `${entry.classId.name}-${entry.classId.section}` : '',
      students: entry.classId?.strength || 0,
      notes: entry.notes || ''
    }));

    schedule.sort((a, b) => {
      const [aH, aM] = a.startTime.split(':').map(Number);
      const [bH, bM] = b.startTime.split(':').map(Number);
      return (aH * 60 + aM) - (bH * 60 + bM);
    });

    res.json(schedule);
  } catch (error) {
    console.error('Error fetching today timetable:', error);
    res.status(500).json({ error: 'Failed to fetch timetable' });
  }
});

router.get('/:id/timetable/week', authenticate, async (req, res) => {
  try {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const timetable = await Timetable.find({ teacherId: req.params.id })
      .populate('classId', 'name section strength');

    const weekSchedule = {};
    days.forEach((day) => {
      weekSchedule[day] = timetable
        .filter((entry) => entry.day === day)
        .map((entry) => ({
          id: entry._id,
          subject: entry.subject,
          topic: entry.topic || '',
          startTime: entry.startTime,
          endTime: entry.endTime,
          room: entry.room || '',
          class: entry.classId ? `${entry.classId.name}-${entry.classId.section}` : '',
          students: entry.classId?.strength || 0,
          notes: entry.notes || ''
        }))
        .sort((a, b) => {
          const [aH, aM] = a.startTime.split(':').map(Number);
          const [bH, bM] = b.startTime.split(':').map(Number);
          return (aH * 60 + aM) - (bH * 60 + bM);
        });
    });

    res.json(weekSchedule);
  } catch (error) {
    console.error('Error fetching weekly timetable:', error);
    res.status(500).json({ error: 'Failed to fetch timetable' });
  }
});

router.get('/', authenticate, checkPermission('staff', 'view'), async (req, res) => {
  try {
    const staffList = await Staff.find(scopeBySchool(req.user?.schoolId))
      .populate('reporterId', 'name')
      .sort({ createdAt: 1 })
      .lean();
    const staffIds = staffList.map((staff) => staff._id);
    const assignedClasses = staffIds.length > 0
      ? await Class.find({
          classTeacherId: { $in: staffIds }
        })
          .select('name section classTeacherId')
          .lean()
      : [];

    const classMap = new Map(
      assignedClasses.map((classDoc) => [classDoc.classTeacherId.toString(), classDoc])
    );

    res.json(staffList.map((staff) => formatStaffResponse(staff, classMap.get(staff._id.toString()))));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/classes', authenticate, checkPermission('staff', 'view'), async (req, res) => {
  try {
    const staff = await Staff.findOne(scopeBySchool(req.user?.schoolId, { _id: req.params.id }));
    if (!staff) {
      return res.status(404).json({ error: 'Staff not found' });
    }

    const { role } = req.query;
    let allClassIds = [];

    if (role === 'classTeacher') {
      const classTeacherClasses = await Class.find({ classTeacherId: staff._id }).select('_id');
      allClassIds = classTeacherClasses.map((cls) => cls._id.toString());
    } else {
      const assignedClassIds = staff.assignedClasses || [];
      const teacherAssignmentClasses = (staff.teacherAssignments || []).flatMap((assignment) => assignment.classes || []);
      const classTeacherClasses = await Class.find({ classTeacherId: staff._id }).select('_id');
      const classTeacherClassIds = classTeacherClasses.map((cls) => cls._id.toString());
      allClassIds = [...new Set([
        ...assignedClassIds,
        ...teacherAssignmentClasses.map((classId) => classId.toString()),
        ...classTeacherClassIds
      ])];
    }

    const isValidObjectId = (value) => /^[a-f\d]{24}$/i.test(value);
    const classDetails = await Promise.all(allClassIds.map(async (classId) => {
      const classIdStr = classId.toString();
      let classData = null;

      if (isValidObjectId(classIdStr)) {
        classData = await Class.findById(classIdStr);
      }

      if (!classData) {
        const parts = classIdStr.split('-');
        if (parts.length >= 2) {
          classData = await Class.findOne({ name: parts[0], section: parts[1] });
        } else {
          classData = await Class.findOne({ name: classIdStr });
        }
      }

      if (!classData) {
        return null;
      }

      let studentCount = 0;
      try {
        studentCount = await Student.countDocuments({
          classId: classData._id,
          status: 'active',
          isDeleted: { $ne: true }
        });
      } catch (countError) {
        console.error('Error counting students for class:', classData._id, countError);
      }

      const isClassTeacher = classData.classTeacherId?.toString() === req.params.id;
      return {
        id: classData._id,
        name: `${classData.name}-${classData.section}`,
        className: classData.name,
        section: classData.section,
        subject: isClassTeacher ? `Class Teacher - ${classData.name}` : (staff.department || 'General'),
        studentCount,
        students: studentCount,
        isClassTeacher
      };
    }));

    res.json(classDetails.filter(Boolean));
  } catch (error) {
    console.error('Error fetching staff classes:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', authenticate, checkPermission('staff', 'view'), async (req, res) => {
  try {
    const staff = await Staff.findOne(scopeBySchool(req.user?.schoolId, { _id: req.params.id }))
      .populate('reporterId', 'name');
    if (!staff) {
      return res.status(404).json({ error: 'Staff not found' });
    }

    const assignedClass = await Class.findOne({ classTeacherId: staff._id });
    res.json(formatStaffResponse(staff, assignedClass));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', authenticate, checkPermission('staff', 'create'), validate(schemas.createStaff), async (req, res) => {
  try {
    const {
      name,
      role,
      department,
      status,
      phone,
      email,
      joinDate,
      address,
      reporterId,
      dob,
      gender,
      fatherName,
      bloodGroup,
      maritalStatus,
      employmentType,
      emergencyContact,
      emergencyPhone,
      emergencyContacts,
      whatsappNumber,
      isWhatsapp,
      picture,
      idDocuments,
      professionalQualifications,
      totalExperience,
      previousOrganization,
      roleInOrganization,
      qualificationDocs,
      customDocuments,
      staffNumber,
      staffType,
      assignedClasses,
      isClassTeacher,
      classTeacherOf,
      accountNumber,
      ifscCode,
      bankName,
      branchName,
      salary,
      salaryTemplate,
      salaryBreakdown
    } = req.body;

    const schoolId = await resolveRequestSchoolId(req);
    const reporterError = await validateReporter(reporterId, null, schoolId);
    if (reporterError) {
      return res.status(400).json({ error: reporterError });
    }

    if (email) {
      const existingByEmail = await Staff.findOne(scopeBySchool(schoolId, { email: email.toLowerCase() }));
      if (existingByEmail) {
        return res.status(400).json({ error: `Email already used by ${existingByEmail.name} (${existingByEmail.code})` });
      }
    }

    const code = await getNextStaffCode();
    const baseUsername = email ? email.split('@')[0].toLowerCase() : code.toLowerCase();
    const username = await ensureUniqueUsername(baseUsername);
    const password = generatePassword(8);

    const staff = new Staff({
      schoolId,
      code,
      name,
      role: role || staffType,
      department: department || 'General',
      status: status || 'active',
      phone,
      email,
      joinDate,
      address,
      username,
      password,
      reporterId: reporterId || null,
      dob,
      gender,
      fatherName,
      bloodGroup,
      maritalStatus,
      employmentType,
      emergencyContact,
      emergencyPhone,
      emergencyContacts,
      whatsappNumber,
      isWhatsapp,
      picture,
      photo: picture,
      idDocuments,
      professionalQualifications,
      totalExperience,
      previousOrganization,
      roleInOrganization,
      qualificationDocs,
      customDocuments,
      staffNumber,
      staffType,
      assignedClasses,
      isClassTeacher,
      classTeacherOf,
      accountNumber,
      ifscCode,
      bankName,
      branchName,
      salary,
      salaryTemplate,
      salaryBreakdown
    });

    await staff.save();
    const permissionRole = await buildPermissions(staff.role, staff._id, schoolId);
    console.log(`Created ${permissionRole} permissions for staff ${staff.name}`);

    if (isClassTeacher && classTeacherOf) {
      const classMatch = classTeacherOf.match(/^(\d+)-([A-Za-z]+)$/);
      if (classMatch) {
        const [, className, section] = classMatch;
        const targetClass = await Class.findOne({ name: className, section: section.toUpperCase() });
        if (targetClass) {
          await Class.findByIdAndUpdate(targetClass._id, { classTeacherId: staff._id });
        }
      }
    }

    const assignedClass = (isClassTeacher && classTeacherOf)
      ? await Class.findOne({
        name: classTeacherOf.split('-')[0],
        section: classTeacherOf.split('-')[1]?.toUpperCase()
      })
      : null;

    res.status(201).json({
      ...formatStaffResponse(staff, assignedClass),
      username,
      password
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', authenticate, checkPermission('staff', 'edit'), async (req, res) => {
  try {
    const {
      name,
      role,
      department,
      status,
      phone,
      email,
      joinDate,
      address,
      assignedClassId,
      username,
      password,
      reporterId,
      dob,
      gender,
      fatherName,
      bloodGroup,
      maritalStatus,
      employmentType,
      emergencyContact,
      emergencyPhone,
      emergencyContacts,
      whatsappNumber,
      isWhatsapp,
      picture,
      idDocuments,
      customDocuments,
      professionalQualifications,
      totalExperience,
      previousOrganization,
      roleInOrganization,
      qualificationDocs,
      staffNumber,
      staffType,
      assignedClasses,
      isClassTeacher,
      classTeacherOf,
      accountNumber,
      ifscCode,
      bankName,
      branchName,
      salaryTemplate,
      salaryBreakdown
    } = req.body;

    const reporterError = await validateReporter(reporterId, req.params.id, req.user?.schoolId);
    if (reporterError) {
      return res.status(400).json({ error: reporterError });
    }

    const updateData = {
      name,
      role,
      department,
      status,
      phone,
      email,
      joinDate,
      address,
      dob,
      gender,
      fatherName,
      bloodGroup,
      maritalStatus,
      employmentType,
      emergencyContact,
      emergencyPhone,
      emergencyContacts,
      whatsappNumber,
      isWhatsapp,
      picture,
      photo: picture,
      idDocuments,
      customDocuments,
      professionalQualifications,
      totalExperience,
      previousOrganization,
      roleInOrganization,
      qualificationDocs,
      staffNumber,
      staffType,
      assignedClasses,
      isClassTeacher,
      classTeacherOf,
      accountNumber,
      ifscCode,
      bankName,
      branchName,
      salaryTemplate,
      salaryBreakdown
    };

    if (username) {
      updateData.username = username;
    }
    if (reporterId !== undefined) {
      updateData.reporterId = reporterId || null;
    }

    Object.keys(updateData).forEach((key) => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    if (password) {
      const bcrypt = await import('bcrypt');
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(password, salt);
    }

    const staff = await Staff.findOneAndUpdate(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id }),
      updateData,
      { new: true }
    )
      .populate('reporterId', 'name');
    if (!staff) {
      return res.status(404).json({ error: 'Staff not found' });
    }

    if (role) {
      const permissionRole = await buildPermissions(role, staff._id, staff.schoolId || req.user?.schoolId || null);
      console.log(`Updated ${permissionRole} permissions for staff ${staff.name}`);
    }

    await Class.updateMany({ classTeacherId: staff._id }, { $unset: { classTeacherId: 1 } });
    if (assignedClassId) {
      await Class.findByIdAndUpdate(assignedClassId, { classTeacherId: staff._id });
    }

    const assignedClass = await Class.findOne({ classTeacherId: staff._id });
    const io = req.app.get('io');
    if (io) {
      io.emit('staff_updated', {
        staffId: staff._id.toString(),
        name: staff.name,
        role: staff.role,
        department: staff.department,
        status: staff.status,
        phone: staff.phone,
        email: staff.email,
        picture: staff.picture,
        photo: staff.photo || staff.picture,
        timestamp: new Date()
      });
    }

    res.json(formatStaffResponse(staff, assignedClass));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id/credentials', authenticate, authRequireAdmin, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username && !password) {
      return res.status(400).json({ error: 'Username or password required' });
    }

    const updateData = {};
    if (username) {
      updateData.username = username;
    }
    if (password) {
      const bcrypt = await import('bcrypt');
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(password, salt);
    }

    const staff = await Staff.findOneAndUpdate(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id }),
      updateData,
      { new: true }
    );
    if (!staff) {
      return res.status(404).json({ error: 'Staff not found' });
    }

    res.json({ success: true, username: staff.username });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id/change-password', authenticate, async (req, res) => {
  try {
    if (req.params.id.toString() !== req.user.id.toString()) {
      return res.status(403).json({ error: 'You can only change your own password' });
    }

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    const staff = await Staff.findOne(scopeBySchool(req.user?.schoolId, { _id: req.params.id }));
    if (!staff) {
      return res.status(404).json({ error: 'Staff not found' });
    }

    const bcrypt = await import('bcrypt');
    const isMatch = await bcrypt.compare(currentPassword, staff.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    staff.password = newPassword;
    staff.markModified('password');
    await staff.save();

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id/profile', authenticate, async (req, res) => {
  try {
    if (req.params.id !== req.user.id) {
      return res.status(403).json({ error: 'You can only update your own profile' });
    }

    const updateData = {
      name: req.body.name,
      phone: req.body.phone,
      email: req.body.email,
      address: req.body.address,
      emergencyContact: req.body.emergencyContact,
      emergencyPhone: req.body.emergencyPhone,
      emergencyContacts: req.body.emergencyContacts,
      whatsappNumber: req.body.whatsappNumber,
      isWhatsapp: req.body.isWhatsapp,
      picture: req.body.picture,
      photo: req.body.picture,
      qualification: req.body.qualification,
      experience: req.body.experience,
      designation: req.body.designation,
      department: req.body.department
    };

    Object.keys(updateData).forEach((key) => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    if (updateData.experience !== undefined) {
      updateData.experience = parseInt(updateData.experience, 10) || 0;
    }

    const staff = await Staff.findOneAndUpdate(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id }),
      updateData,
      { new: true }
    );
    if (!staff) {
      return res.status(404).json({ error: 'Staff not found' });
    }

    res.json(staff);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', authenticate, checkPermission('staff', 'delete'), async (req, res) => {
  try {
    await Class.updateMany({ classTeacherId: req.params.id }, { $unset: { classTeacherId: 1 } });
    const result = await Staff.findOneAndDelete(scopeBySchool(req.user?.schoolId, { _id: req.params.id }));
    if (!result) {
      return res.status(404).json({ error: 'Staff not found' });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
