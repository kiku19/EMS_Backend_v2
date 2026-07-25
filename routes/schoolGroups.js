import express from 'express';
import SchoolGroup from '../models/SchoolGroup.js';
import School from '../models/School.js';
import FeeTemplate from '../models/FeeTemplate.js';
import { Student, Staff } from '../database.js';
import {
  authenticate,
  requireSuperAdmin,
  requireGroupAdmin,
  requireGroupAdminOfGroup,
} from '../middleware/auth.js';
import dns from 'node:dns/promises';
import {
  validateZod,
  createSchoolGroupSchema,
  updateSchoolGroupSchema,
  groupBranchParamsSchema,
  transferStudentSchema,
  staffBranchAssignmentSchema,
  groupFeeTemplateSchema,
  updateGroupWhiteLabelSchema,
  mongoIdParamSchema,
} from '../validators/index.js';

const router = express.Router();

router.use(authenticate);

// ─── LIST ALL GROUPS (super-admin only) ───────────────────────────────────────
router.get('/', requireSuperAdmin, async (req, res) => {
  try {
    const groups = await SchoolGroup.find().sort({ createdAt: -1 }).lean();

    const groupIds = groups.map((g) => g._id);
    const branchCounts = await School.aggregate([
      { $match: { groupId: { $in: groupIds } } },
      { $group: { _id: '$groupId', count: { $sum: 1 } } },
    ]);

    const countMap = new Map(branchCounts.map((b) => [String(b._id), b.count]));

    const result = groups.map((g) => ({
      ...g,
      branchCount: countMap.get(String(g._id)) || 0,
    }));

    res.json({ groups: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CREATE GROUP (super-admin only) ──────────────────────────────────────────
router.post('/', requireSuperAdmin, validateZod(createSchoolGroupSchema), async (req, res) => {
  try {
    const { name, code, ...rest } = req.body;

    const groupCode = code || name.toUpperCase().replace(/\s+/g, '_').slice(0, 40);

    const existing = await SchoolGroup.findOne({ code: groupCode });
    if (existing) {
      return res.status(409).json({ error: 'Group code already exists' });
    }

    const group = await SchoolGroup.create({ name, code: groupCode, ...rest });
    res.status(201).json({ group });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET GROUP BY ID (super-admin or group admin of that group) ───────────────
router.get(
  '/:id',
  requireGroupAdminOfGroup(),
  validateZod(mongoIdParamSchema, 'params'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const group = await SchoolGroup.findById(id).lean();
      if (!group) {
        return res.status(404).json({ error: 'Group not found' });
      }

      const branches = await School.find({ groupId: id })
        .select(
          'name code status plan planStatus contactEmail contactPhone frontendUrl backendUrl createdAt'
        )
        .sort({ name: 1 })
        .lean();

      res.json({ group: { ...group, branches } });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── UPDATE GROUP ─────────────────────────────────────────────────────────────
router.put(
  '/:id',
  requireGroupAdminOfGroup(),
  validateZod(mongoIdParamSchema, 'params'),
  validateZod(updateSchoolGroupSchema),
  async (req, res) => {
    try {
      const { id } = req.params;

      const group = await SchoolGroup.findByIdAndUpdate(id, { $set: req.body }, { new: true });
      if (!group) {
        return res.status(404).json({ error: 'Group not found' });
      }

      res.json({ group });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── LIST BRANCHES IN GROUP ───────────────────────────────────────────────────
router.get(
  '/:id/branches',
  requireGroupAdminOfGroup(),
  validateZod(mongoIdParamSchema, 'params'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const branches = await School.find({ groupId: id })
        .select(
          'name code status plan planStatus contactEmail contactPhone frontendUrl backendUrl createdAt'
        )
        .sort({ name: 1 })
        .lean();

      res.json({ branches });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── ADD BRANCH TO GROUP (super-admin only) ───────────────────────────────────
router.post(
  '/:id/branches/:schoolId',
  requireSuperAdmin,
  validateZod(groupBranchParamsSchema, 'params'),
  async (req, res) => {
    try {
      const { id, schoolId } = req.params;

      const [group, school] = await Promise.all([
        SchoolGroup.findById(id),
        School.findById(schoolId),
      ]);

      if (!group) {
        return res.status(404).json({ error: 'Group not found' });
      }

      if (!school) {
        return res.status(404).json({ error: req.t('common:errors.schoolNotFound') });
      }

      if (school.groupId && String(school.groupId) !== id) {
        return res.status(409).json({ error: 'School already belongs to another group' });
      }

      school.groupId = id;
      await school.save();

      res.json({ message: 'Branch added to group', school });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── REMOVE BRANCH FROM GROUP (super-admin only) ──────────────────────────────
router.delete(
  '/:id/branches/:schoolId',
  requireSuperAdmin,
  validateZod(groupBranchParamsSchema, 'params'),
  async (req, res) => {
    try {
      const { id, schoolId } = req.params;

      const school = await School.findOne({ _id: schoolId, groupId: id });
      if (!school) {
        return res.status(404).json({ error: 'School not found in this group' });
      }

      school.groupId = null;
      await school.save();

      res.json({ message: 'Branch removed from group' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── TRANSFER STUDENT BETWEEN BRANCHES ────────────────────────────────────────
router.post(
  '/:id/transfer',
  requireGroupAdminOfGroup(),
  validateZod(mongoIdParamSchema, 'params'),
  validateZod(transferStudentSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { studentId, fromSchoolId, toSchoolId, reason } = req.body;

      // Verify both schools belong to the group
      const [fromSchool, toSchool] = await Promise.all([
        School.findOne({ _id: fromSchoolId, groupId: id }),
        School.findOne({ _id: toSchoolId, groupId: id }),
      ]);

      if (!fromSchool) {
        return res.status(400).json({ error: 'Source school is not in this group' });
      }

      if (!toSchool) {
        return res.status(400).json({ error: 'Destination school is not in this group' });
      }

      const student = await Student.findOne({ _id: studentId, schoolId: fromSchoolId });
      if (!student) {
        return res.status(404).json({ error: 'Student not found in source school' });
      }

      // Transfer: update schoolId, clear class-specific fields (must be re-assigned at new branch)
      student.schoolId = toSchoolId;
      student.classId = null;
      student.rollNo = null;
      await student.save();

      res.json({
        message: 'Student transferred successfully',
        student: { _id: student._id, name: student.name, schoolId: student.schoolId },
        transferReason: reason || null,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── GROUP-LEVEL ANALYTICS ────────────────────────────────────────────────────
router.get(
  '/:id/analytics',
  requireGroupAdminOfGroup(),
  validateZod(mongoIdParamSchema, 'params'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const branches = await School.find({ groupId: id }).select('_id name code status').lean();
      const branchIds = branches.map((b) => b._id);

      if (branchIds.length === 0) {
        return res.json({
          group: { _id: id, branchCount: 0 },
          branches: [],
          totals: { students: 0, staff: 0, classes: 0 },
        });
      }

      const { Staff, Class } = await import('../database.js');

      const [studentCounts, staffCounts, classCounts] = await Promise.all([
        Student.aggregate([
          { $match: { schoolId: { $in: branchIds }, isDeleted: { $ne: true } } },
          { $group: { _id: '$schoolId', count: { $sum: 1 } } },
        ]),
        Staff.aggregate([
          { $match: { schoolId: { $in: branchIds }, isDeleted: { $ne: true } } },
          { $group: { _id: '$schoolId', count: { $sum: 1 } } },
        ]),
        Class.aggregate([
          { $match: { schoolId: { $in: branchIds }, isDeleted: { $ne: true } } },
          { $group: { _id: '$schoolId', count: { $sum: 1 } } },
        ]),
      ]);

      const toMap = (arr) => new Map(arr.map((e) => [String(e._id), e.count]));
      const studentMap = toMap(studentCounts);
      const staffMap = toMap(staffCounts);
      const classMap = toMap(classCounts);

      const branchStats = branches.map((b) => ({
        schoolId: b._id,
        name: b.name,
        code: b.code,
        status: b.status,
        students: studentMap.get(String(b._id)) || 0,
        staff: staffMap.get(String(b._id)) || 0,
        classes: classMap.get(String(b._id)) || 0,
      }));

      const totals = branchStats.reduce(
        (acc, b) => ({
          students: acc.students + b.students,
          staff: acc.staff + b.staff,
          classes: acc.classes + b.classes,
        }),
        { students: 0, staff: 0, classes: 0 }
      );

      res.json({
        group: { _id: id, branchCount: branches.length },
        branches: branchStats,
        totals,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── ASSIGN STAFF TO ADDITIONAL BRANCH ───────────────────────────────────────
// Adds a school from this group to a staff member's additionalSchoolIds
router.post(
  '/:id/staff-assignments',
  requireGroupAdminOfGroup(),
  validateZod(mongoIdParamSchema, 'params'),
  validateZod(staffBranchAssignmentSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { staffId, targetSchoolId } = req.body;

      // Verify both source school (staff's primary) and target school belong to the group
      const [staff, targetSchool] = await Promise.all([
        Staff.findById(staffId).select('schoolId additionalSchoolIds name'),
        School.findOne({ _id: targetSchoolId, groupId: id }),
      ]);

      if (!staff) {
        return res.status(404).json({ error: req.t('common:errors.staffNotFound') });
      }

      if (!targetSchool) {
        return res.status(400).json({ error: 'Target school is not in this group' });
      }

      const sourceSchool = await School.findOne({ _id: staff.schoolId, groupId: id });
      if (!sourceSchool) {
        return res.status(400).json({ error: 'Staff primary school is not in this group' });
      }

      if (String(staff.schoolId) === String(targetSchoolId)) {
        return res.status(400).json({ error: 'Target school is already the staff primary school' });
      }

      if (staff.additionalSchoolIds.some((s) => String(s) === String(targetSchoolId))) {
        return res.status(409).json({ error: 'Staff is already assigned to this branch' });
      }

      staff.additionalSchoolIds.push(targetSchoolId);
      await staff.save();

      res.json({ message: 'Staff assigned to branch', staffId, targetSchoolId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── REMOVE STAFF FROM ADDITIONAL BRANCH ─────────────────────────────────────
router.delete(
  '/:id/staff-assignments/:staffId',
  requireGroupAdminOfGroup(),
  validateZod(mongoIdParamSchema, 'params'),
  async (req, res) => {
    try {
      const { staffId } = req.params;
      const { targetSchoolId } = req.body;

      if (!targetSchoolId) {
        return res.status(400).json({ error: 'targetSchoolId is required' });
      }

      const staff = await Staff.findById(staffId).select('additionalSchoolIds');
      if (!staff) {
        return res.status(404).json({ error: req.t('common:errors.staffNotFound') });
      }

      staff.additionalSchoolIds = staff.additionalSchoolIds.filter(
        (s) => String(s) !== String(targetSchoolId)
      );
      await staff.save();

      res.json({ message: 'Staff removed from branch', staffId, targetSchoolId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── CREATE GROUP-LEVEL FEE TEMPLATE ─────────────────────────────────────────
// Creates a fee template shared across all branches in the group (requires sharedFeeTemplates=true)
router.post(
  '/:id/fee-templates',
  requireGroupAdminOfGroup(),
  validateZod(mongoIdParamSchema, 'params'),
  validateZod(groupFeeTemplateSchema),
  async (req, res) => {
    try {
      const { id } = req.params;

      const group = await SchoolGroup.findById(id).select('sharedFeeTemplates').lean();
      if (!group) {
        return res.status(404).json({ error: 'Group not found' });
      }

      if (!group.sharedFeeTemplates) {
        return res.status(400).json({ error: 'Group does not have sharedFeeTemplates enabled' });
      }

      const template = await FeeTemplate.create({
        ...req.body,
        groupId: id,
        isGroupTemplate: true,
        schoolId: null,
      });

      res.status(201).json({ template });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── LIST GROUP-LEVEL FEE TEMPLATES ──────────────────────────────────────────
router.get(
  '/:id/fee-templates',
  requireGroupAdminOfGroup(),
  validateZod(mongoIdParamSchema, 'params'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const templates = await FeeTemplate.find({ groupId: id, isGroupTemplate: true })
        .sort({ name: 1 })
        .lean();

      res.json({ templates });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── WHITE-LABEL SETTINGS ─────────────────────────────────────────────────────

// GET /:id/white-label — get group white-label settings
router.get(
  '/:id/white-label',
  requireGroupAdminOfGroup(),
  validateZod(mongoIdParamSchema, 'params'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const group = await SchoolGroup.findById(id).select('whiteLabelSettings name').lean();
      if (!group) {
        return res.status(404).json({ error: 'Group not found' });
      }

      res.json({ whiteLabelSettings: group.whiteLabelSettings || {} });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// PUT /:id/white-label — update group white-label settings
router.put(
  '/:id/white-label',
  requireGroupAdminOfGroup(),
  validateZod(mongoIdParamSchema, 'params'),
  validateZod(updateGroupWhiteLabelSchema),
  async (req, res) => {
    try {
      const { id } = req.params;

      const group = await SchoolGroup.findById(id);
      if (!group) {
        return res.status(404).json({ error: 'Group not found' });
      }

      const { enabled, customDomain, branding } = req.body;

      // If domain changed, reset verification state
      const domainChanged =
        customDomain !== undefined && customDomain !== group.whiteLabelSettings?.customDomain;

      if (domainChanged) {
        group.whiteLabelSettings.domainVerified = false;
        // Generate new verification token
        group.whiteLabelSettings.domainVerificationToken = `ems-verify-${group._id}-${Date.now()}`;
      }

      if (enabled !== undefined) group.whiteLabelSettings.enabled = enabled;
      if (customDomain !== undefined)
        group.whiteLabelSettings.customDomain = customDomain.toLowerCase().trim();
      if (branding) {
        Object.assign(group.whiteLabelSettings.branding, branding);
      }

      group.markModified('whiteLabelSettings');
      await group.save();

      res.json({ whiteLabelSettings: group.whiteLabelSettings });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /:id/white-label/verify-domain — trigger DNS TXT record verification
router.post(
  '/:id/white-label/verify-domain',
  requireGroupAdminOfGroup(),
  validateZod(mongoIdParamSchema, 'params'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const group = await SchoolGroup.findById(id);
      if (!group) {
        return res.status(404).json({ error: 'Group not found' });
      }

      const { customDomain, domainVerificationToken } = group.whiteLabelSettings || {};

      if (!customDomain) {
        return res.status(400).json({ error: 'No custom domain configured' });
      }

      if (!domainVerificationToken) {
        return res
          .status(400)
          .json({ error: 'No verification token found. Save the domain first.' });
      }

      // Check DNS TXT record: _ems-verify.<customDomain> should contain the token
      let verified = false;
      try {
        const txtRecords = await dns.resolveTxt(`_ems-verify.${customDomain}`);
        verified = txtRecords.some((record) =>
          record.some((part) => part === domainVerificationToken)
        );
      } catch {
        // DNS lookup failed — domain not configured or no TXT record
        verified = false;
      }

      if (verified) {
        group.whiteLabelSettings.domainVerified = true;
        group.markModified('whiteLabelSettings');
        await group.save();
        return res.json({ verified: true, message: 'Domain verified successfully' });
      }

      res.json({
        verified: false,
        message: 'TXT record not found. Add the following TXT record to your DNS:',
        dnsRecord: {
          host: `_ems-verify.${customDomain}`,
          type: 'TXT',
          value: domainVerificationToken,
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── GET MY GROUP (for group admin - returns their own group) ─────────────────
router.get('/me/group', requireGroupAdmin, async (req, res) => {
  try {
    const groupId = req.user.groupId;
    if (!groupId) {
      return res.status(404).json({ error: 'No group assigned' });
    }

    const group = await SchoolGroup.findById(groupId).lean();
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const branches = await School.find({ groupId })
      .select(
        'name code status plan planStatus contactEmail contactPhone frontendUrl backendUrl createdAt'
      )
      .sort({ name: 1 })
      .lean();

    res.json({ group: { ...group, branches } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
