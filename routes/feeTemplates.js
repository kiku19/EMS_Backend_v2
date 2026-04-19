import express from 'express';
import { FeeTemplate, FeeStructure } from '../database.js';
import School from '../models/School.js';
import SchoolGroup from '../models/SchoolGroup.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { extractSchoolId, ensureDefaultSchool } from '../utils/schoolContext.js';
import { logToTrash } from '../services/trashService.js';
import {
  validateZod,
  createFeeTemplateSchema,
  updateFeeTemplateSchema,
} from '../validators/index.js';

const router = express.Router();
router.use(authenticate);

function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) throw new Error('schoolId is required for scoped queries');
  return { ...query, schoolId: normalizedSchoolId };
}

async function resolveRequestSchoolId(req) {
  if (req.user?.schoolId) return extractSchoolId(req.user.schoolId);
  const school = await ensureDefaultSchool();
  return extractSchoolId(school._id);
}

router.get('/', checkPermission('fees', 'view'), async (req, res) => {
  try {
    const schoolId = extractSchoolId(req.user?.schoolId);
    const query = scopeBySchool(schoolId);
    if (req.query.academicYear) query.academicYear = req.query.academicYear;
    const ownTemplates = await FeeTemplate.find(query).sort({ name: 1 });

    // Include group-level templates if school belongs to a group with sharedFeeTemplates=true
    let groupTemplates = [];
    if (schoolId) {
      const school = await School.findById(schoolId).select('groupId').lean();
      if (school?.groupId) {
        const group = await SchoolGroup.findById(school.groupId)
          .select('sharedFeeTemplates')
          .lean();
        if (group?.sharedFeeTemplates) {
          groupTemplates = await FeeTemplate.find({
            groupId: school.groupId,
            isGroupTemplate: true,
            isActive: true,
          })
            .sort({ name: 1 })
            .lean();
        }
      }
    }

    res.json([...ownTemplates, ...groupTemplates]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/usage', checkPermission('fees', 'view'), async (req, res) => {
  try {
    const schoolId = extractSchoolId(req.user?.schoolId);
    const structures = await FeeStructure.find(
      scopeBySchool(schoolId, { templateId: req.params.id })
    ).select('appliedTo').lean();
    const structureCount = structures.length;
    const studentCount = structures.reduce((sum, s) => sum + (s.appliedTo?.length || 0), 0);
    res.json({ structureCount, studentCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', checkPermission('fees', 'view'), async (req, res) => {
  try {
    const template = await FeeTemplate.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    );
    if (!template) {
      return res.status(404).json({ error: req.t('common:routes.feeTemplateNotFound') });
    }
    res.json(template);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post(
  '/',
  checkPermission('fees', 'create'),
  validateZod(createFeeTemplateSchema),
  async (req, res) => {
    try {
      const schoolId = await resolveRequestSchoolId(req);
      const {
        name,
        description,
        section,
        applicableFor,
        feeHeads,
        totalAnnualFee,
        discounts,
        isActive,
        academicYear,
      } = req.body;
      const template = new FeeTemplate({
        name,
        description,
        section,
        applicableFor,
        feeHeads,
        totalAnnualFee,
        discounts,
        isActive,
        academicYear,
        schoolId,
      });
      await template.save();
      res.status(201).json(template);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

router.put(
  '/:id',
  checkPermission('fees', 'edit'),
  validateZod(updateFeeTemplateSchema),
  async (req, res) => {
    try {
      // req.body is already validated and stripped by Zod — no raw fields leak through
      const template = await FeeTemplate.findOneAndUpdate(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id }),
        req.body,
        { new: true }
      );
      if (!template) {
        return res.status(404).json({ error: req.t('common:routes.feeTemplateNotFound') });
      }
      res.json(template);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

router.delete('/:id', checkPermission('fees', 'delete'), async (req, res) => {
  try {
    // Snapshot before deletion for trash logging
    const templateSnapshot = await FeeTemplate.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    ).lean();

    const template = await FeeTemplate.findOneAndDelete(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    );
    if (!template) {
      return res.status(404).json({ error: req.t('common:routes.feeTemplateNotFound') });
    }

    // Clear dangling templateId references in FeeStructure documents
    await FeeStructure.updateMany(scopeBySchool(req.user?.schoolId, { templateId: template._id }), {
      $unset: { templateId: 1 },
    });

    // Log to trash
    if (templateSnapshot) {
      logToTrash({
        itemType: 'FeeTemplate',
        itemId: templateSnapshot._id,
        itemName: templateSnapshot.name || 'Fee Template',
        originalData: templateSnapshot,
        deletedBy: req.user?.id || req.user?._id,
        schoolId: req.user?.schoolId,
      }).catch(() => {});
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
