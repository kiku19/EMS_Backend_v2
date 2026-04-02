import express from 'express';
import {
  Class,
  Staff,
  Student,
  Timetable,
  TeacherTimetable,
  getNextStaffCode,
} from '../../database.js';
import UserPermission from '../../models/UserPermission.js';
import { authenticate } from '../../middleware/auth.js';
import { checkPermission } from '../../middleware/permissions.js';
import { validateZod, createStaffSchema, updateStaffSchema } from '../../validators/index.js';
import { syncUsageMetrics } from '../../services/billingService.js';
import { planLimitGate } from '../../middleware/auth/planLimitGate.js';
import PushToken from '../../models/PushToken.js';
import { cascadeDeleteStaffReferences } from '../../services/staffDeletionService.js';
import { dispatchWebhookEvent } from '../../services/webhookService.js';
import { piiMatch } from '../../utils/encryption.js';
import {
  scopeBySchool,
  resolveRequestSchoolId,
  buildPermissions,
  ensureUniqueUsername,
  formatStaffResponse,
  validateReporter,
  generatePassword,
} from './helpers.js';

const router = express.Router();
router.use(authenticate);

// Fix: Add isDeleted filter and schoolId to Class query
// Fix 3.15: Add pagination support with backward compatibility
router.get('/', authenticate, checkPermission('staff', 'view'), async (req, res) => {
  try {
    const query = scopeBySchool(req.user?.schoolId, { isDeleted: { $ne: true } });
    const isPaginated = req.query.page !== undefined;

    let staffList;
    let total;

    if (isPaginated) {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const skip = (page - 1) * limit;

      [staffList, total] = await Promise.all([
        Staff.find(query)
          .populate('reporterId', 'name')
          .sort({ createdAt: 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Staff.countDocuments(query),
      ]);

      const staffIds = staffList.map((staff) => staff._id);
      const assignedClasses =
        staffIds.length > 0
          ? await Class.find(
              scopeBySchool(req.user?.schoolId, {
                classTeacherId: { $in: staffIds },
              })
            )
              .select('name section classTeacherId')
              .lean()
          : [];

      const classMap = new Map(
        assignedClasses.map((classDoc) => [classDoc.classTeacherId.toString(), classDoc])
      );

      return res.json({
        data: staffList.map((staff) =>
          formatStaffResponse(staff, classMap.get(staff._id.toString()))
        ),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    }

    // Backward compatible: return plain array when no page param
    staffList = await Staff.find(query)
      .populate('reporterId', 'name')
      .sort({ createdAt: 1 })
      .lean();

    const staffIds = staffList.map((staff) => staff._id);
    const assignedClasses =
      staffIds.length > 0
        ? await Class.find(
            scopeBySchool(req.user?.schoolId, {
              classTeacherId: { $in: staffIds },
            })
          )
            .select('name section classTeacherId')
            .lean()
        : [];

    const classMap = new Map(
      assignedClasses.map((classDoc) => [classDoc.classTeacherId.toString(), classDoc])
    );

    res.json(
      staffList.map((staff) => formatStaffResponse(staff, classMap.get(staff._id.toString())))
    );
  } catch (error) {
    res.status(500).json({ error: req.t('common:routes.failedToFetchStaffList') });
  }
});

// Fix: Add isDeleted filter and schoolId to Class query
router.get('/:id', authenticate, checkPermission('staff', 'view'), async (req, res) => {
  try {
    const staff = await Staff.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
    ).populate('reporterId', 'name');
    if (!staff) {
      return res.status(404).json({ error: req.t('common:routes.staffNotFound') });
    }

    const assignedClass = await Class.findOne(
      scopeBySchool(req.user?.schoolId, { classTeacherId: staff._id })
    );
    res.json(formatStaffResponse(staff, assignedClass));
  } catch (error) {
    res.status(500).json({ error: req.t('common:routes.failedToFetchStaffDetails') });
  }
});

router.post(
  '/',
  authenticate,
  checkPermission('staff', 'create'),
  planLimitGate('staff'),
  validateZod(createStaffSchema),
  async (req, res) => {
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
        salaryBreakdown,
      } = req.body;

      const schoolId = await resolveRequestSchoolId(req);

      const reporterError = await validateReporter(reporterId, null, schoolId);
      if (reporterError) {
        return res.status(400).json({ error: reporterError });
      }

      // Fix 3.12: Lowercase email for duplicate check and save
      if (email) {
        const existingByEmail = await Staff.findOne(
          scopeBySchool(schoolId, {
            ...piiMatch('email', email.toLowerCase()),
            isDeleted: { $ne: true },
          })
        );
        if (existingByEmail) {
          return res.status(409).json({
            error: `Email already used by ${existingByEmail.name} (${existingByEmail.code})`,
          });
        }
      }

      // BUG-19: Check phone uniqueness within school
      if (phone) {
        const existingByPhone = await Staff.findOne(
          scopeBySchool(schoolId, { ...piiMatch('phone', phone), isDeleted: { $ne: true } })
        );
        if (existingByPhone) {
          return res.status(409).json({
            error: `Phone number already used by ${existingByPhone.name} (${existingByPhone.code})`,
          });
        }
      }

      // Fix 1.2/1.3: Pass schoolId for per-school atomic code generation
      const code = await getNextStaffCode(schoolId);
      const baseUsername = email ? email.split('@')[0].toLowerCase() : code.toLowerCase();
      const username = await ensureUniqueUsername(baseUsername, schoolId);
      const password = generatePassword(8);

      const staff = new Staff({
        schoolId,
        code,
        name,
        role: role || staffType,
        department: department || 'General',
        status: status || 'active',
        phone,
        email: email?.toLowerCase(),
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
        salaryBreakdown,
      });

      await staff.save();

      dispatchWebhookEvent(schoolId, 'staff.created', {
        id: staff._id,
        name: staff.name,
        role: staff.role,
        department: staff.department,
        code: staff.code,
      }).catch(() => {});

      await syncUsageMetrics(schoolId);
      const permissionRole = await buildPermissions(staff.role, staff._id, schoolId);

      // Fix 3.8: Add schoolId scoping to class teacher lookup
      if (isClassTeacher && classTeacherOf) {
        const classMatch = classTeacherOf.match(/^(\d+)-([A-Za-z]+)$/);
        if (classMatch) {
          const [, className, section] = classMatch;
          const targetClass = await Class.findOne(
            scopeBySchool(schoolId, { name: className, section: section.toUpperCase() })
          );
          if (targetClass) {
            await Class.findByIdAndUpdate(targetClass._id, { classTeacherId: staff._id });
          }
        }
      }

      const assignedClass =
        isClassTeacher && classTeacherOf
          ? await Class.findOne(
              scopeBySchool(schoolId, {
                name: classTeacherOf.split('-')[0],
                section: classTeacherOf.split('-')[1]?.toUpperCase(),
              })
            )
          : null;

      // Fix 3.10: Do not return password in response - credentials should be sent via email/SMS
      res.status(201).json({
        ...formatStaffResponse(staff, assignedClass),
        username,
      });
    } catch (error) {
      res.status(error.status || 500).json({
        error: error.message,
        details: error.details,
      });
    }
  }
);

// Fix 2.1: Add Joi validation middleware
// Fix 2.9: Add salary, panNumber, nationality, shift, designation, qualification, experience to destructuring
router.put(
  '/:id',
  authenticate,
  checkPermission('staff', 'edit'),
  validateZod(updateStaffSchema),
  async (req, res) => {
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
        panNumber,
        salary,
        salaryTemplate,
        salaryBreakdown,
        nationality,
        shift,
        designation,
        qualification,
        experience,
      } = req.body;

      const reporterError = await validateReporter(reporterId, req.params.id, req.user?.schoolId);
      if (reporterError) {
        return res.status(400).json({ error: reporterError });
      }

      // BUG-19: Check phone uniqueness within school on update
      if (phone) {
        const existingByPhone = await Staff.findOne(
          scopeBySchool(req.user?.schoolId, {
            ...piiMatch('phone', phone),
            _id: { $ne: req.params.id },
            isDeleted: { $ne: true },
          })
        );
        if (existingByPhone) {
          return res.status(400).json({
            error: `Phone number already used by ${existingByPhone.name} (${existingByPhone.code})`,
          });
        }
      }

      const updateData = {
        name,
        role,
        department,
        status,
        phone,
        email: email?.toLowerCase(),
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
        panNumber,
        salary,
        salaryTemplate,
        salaryBreakdown,
        nationality,
        shift,
        designation,
        qualification,
        experience,
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

      // Fix: Add isDeleted filter to update query
      const staff = await Staff.findOneAndUpdate(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
        updateData,
        { new: true }
      ).populate('reporterId', 'name');
      if (!staff) {
        return res.status(404).json({ error: req.t('common:routes.staffNotFound') });
      }

      if (role) {
        const permissionRole = await buildPermissions(
          role,
          staff._id,
          staff.schoolId || req.user?.schoolId || null
        );
      }

      // Fix 3.4: Only wipe class teacher assignments when assignedClassId is explicitly provided
      if (assignedClassId !== undefined) {
        await Class.updateMany(scopeBySchool(req.user?.schoolId, { classTeacherId: staff._id }), {
          $unset: { classTeacherId: 1 },
        });
        if (assignedClassId) {
          await Class.findOneAndUpdate(
            scopeBySchool(req.user?.schoolId, { _id: assignedClassId }),
            { classTeacherId: staff._id }
          );
        }
      }

      const assignedClass = await Class.findOne(
        scopeBySchool(req.user?.schoolId, { classTeacherId: staff._id })
      );
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
          timestamp: new Date(),
        });
      }

      res.json(formatStaffResponse(staff, assignedClass));
    } catch (error) {
      res.status(500).json({ error: req.t('common:routes.failedToUpdateStaffMember') });
    }
  }
);

// Fix 1.7/3.3: Soft delete instead of hard delete
router.delete('/:id', authenticate, checkPermission('staff', 'delete'), async (req, res) => {
  try {
    const staff = await Staff.findOneAndUpdate(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
          deletedBy: req.user.id,
          status: 'inactive',
        },
      },
      { new: true }
    );

    if (!staff) {
      return res.status(404).json({ error: req.t('common:routes.staffNotFound') });
    }

    // Fix 6.2: Clean up class teacher AFTER verifying school ownership
    await Class.updateMany(scopeBySchool(req.user?.schoolId, { classTeacherId: staff._id }), {
      $unset: { classTeacherId: 1 },
    });

    // Cascade: delete this staff member's teacher timetable document
    await TeacherTimetable.deleteMany(scopeBySchool(req.user?.schoolId, { teacherId: staff._id }));

    // Cascade: null out teacherId in class timetable schedule slots referencing this staff
    const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    await Promise.all(
      DAYS.map((day) =>
        Timetable.updateMany(
          scopeBySchool(req.user?.schoolId, { [`schedule.${day}.teacherId`]: staff._id }),
          { $set: { [`schedule.${day}.$[slot].teacherId`]: null } },
          { arrayFilters: [{ 'slot.teacherId': staff._id }] }
        )
      )
    );

    // Cascade: remove permissions and push tokens for deleted staff
    await Promise.all([
      UserPermission.deleteOne({ userId: staff._id }),
      PushToken.deleteMany({ user: staff._id, userModel: 'Staff' }),
    ]);

    // Cascade: clean up all orphan documents referencing this staff member
    await cascadeDeleteStaffReferences(staff._id);

    if (staff.schoolId) {
      await syncUsageMetrics(staff.schoolId);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: req.t('common:routes.failedToDeleteStaffMember') });
  }
});

export default router;
