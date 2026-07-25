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
  feeTemplateListQuerySchema,
} from '../validators/index.js';
import { validateObjectIdParam } from '../middleware/validation.js';
import { annualizedAmount } from '../utils/applyClassFeeStructure.js';

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

function calculateTemplateTotal(feeHeads = []) {
  return feeHeads.reduce((total, head) => total + annualizedAmount(head), 0);
}

async function findAccessibleTemplate(req, templateId) {
  const schoolId = extractSchoolId(req.user?.schoolId);
  const ownTemplate = await FeeTemplate.findOne(scopeBySchool(schoolId, { _id: templateId }));
  if (ownTemplate) return ownTemplate;
  const school = await School.findById(schoolId).select('groupId').lean();
  if (!school?.groupId) return null;
  const group = await SchoolGroup.findById(school.groupId).select('sharedFeeTemplates').lean();
  if (!group?.sharedFeeTemplates) return null;
  return FeeTemplate.findOne({
    _id: templateId,
    groupId: school.groupId,
    isGroupTemplate: true,
    isActive: true,
  });
}

router.get(
  '/',
  checkPermission('fees', 'view'),
  validateZod(feeTemplateListQuerySchema, 'query'),
  async (req, res) => {
    try {
      const schoolId = extractSchoolId(req.user?.schoolId);
      const ownStatusQuery =
        req.query.status === 'all'
          ? {}
          : req.query.status === 'inactive'
            ? { isActive: false }
            : { isActive: { $ne: false } };
      const query = scopeBySchool(schoolId, ownStatusQuery);
      if (req.query.academicYear) query.academicYear = req.query.academicYear;
      const ownTemplates = await FeeTemplate.find(query).sort({ name: 1 });

      // Include group-level templates if school belongs to a group with sharedFeeTemplates=true
      let groupTemplates = [];
      // Inactive group templates are not accessible to an individual school.
      // They are therefore omitted from both `inactive` and `all`; group owners
      // manage that lifecycle at the group level.
      if (schoolId && req.query.status !== 'inactive') {
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
              ...(req.query.academicYear ? { academicYear: req.query.academicYear } : {}),
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
  }
);

router.get(
  '/:id/usage',
  checkPermission('fees', 'view'),
  validateObjectIdParam('id'),
  async (req, res) => {
    try {
      const schoolId = extractSchoolId(req.user?.schoolId);
      const template = await findAccessibleTemplate(req, req.params.id);
      if (!template) {
        return res.status(404).json({ error: req.t('common:routes.feeTemplateNotFound') });
      }
      const structures = await FeeStructure.find(
        scopeBySchool(schoolId, { templateId: req.params.id })
      )
        .select('appliedTo')
        .lean();
      const structureCount = structures.length;
      const studentCount = structures.reduce((sum, s) => sum + (s.appliedTo?.length || 0), 0);
      res.json({ structureCount, studentCount });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

router.get(
  '/:id',
  checkPermission('fees', 'view'),
  validateObjectIdParam('id'),
  async (req, res) => {
    try {
      const template = await findAccessibleTemplate(req, req.params.id);
      if (!template) {
        return res.status(404).json({ error: req.t('common:routes.feeTemplateNotFound') });
      }
      res.json(template);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

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
      const calculatedTotal = calculateTemplateTotal(feeHeads);
      if (feeHeads.length && Math.abs(calculatedTotal - totalAnnualFee) > 0.01) {
        return res.status(400).json({
          error: `Total annual fee must equal the annualized fee-head total (${calculatedTotal}).`,
          code: 'TEMPLATE_TOTAL_MISMATCH',
        });
      }
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
  validateObjectIdParam('id'),
  validateZod(updateFeeTemplateSchema),
  async (req, res) => {
    try {
      const template = await FeeTemplate.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id })
      );
      if (!template) {
        return res.status(404).json({ error: req.t('common:routes.feeTemplateNotFound') });
      }
      const mergedHeads = req.body.feeHeads || template.feeHeads || [];
      const mergedTotal = req.body.totalAnnualFee ?? template.totalAnnualFee;
      const calculatedTotal = calculateTemplateTotal(mergedHeads);
      if (mergedHeads.length && Math.abs(calculatedTotal - mergedTotal) > 0.01) {
        return res.status(400).json({
          error: `Total annual fee must equal the annualized fee-head total (${calculatedTotal}).`,
          code: 'TEMPLATE_TOTAL_MISMATCH',
        });
      }
      Object.assign(template, req.body);
      await template.save();
      res.json(template);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

router.delete(
  '/:id',
  checkPermission('fees', 'delete'),
  validateObjectIdParam('id'),
  async (req, res) => {
    try {
      // Snapshot before deletion for trash logging
      const templateSnapshot = await FeeTemplate.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id })
      ).lean();

      const appliedStructure = await FeeStructure.exists(
        scopeBySchool(req.user?.schoolId, { templateId: req.params.id })
      );
      const template = appliedStructure
        ? await FeeTemplate.findOneAndUpdate(
            scopeBySchool(req.user?.schoolId, { _id: req.params.id }),
            { isActive: false },
            { new: true }
          )
        : await FeeTemplate.findOneAndDelete(
            scopeBySchool(req.user?.schoolId, { _id: req.params.id })
          );
      if (!template) {
        return res.status(404).json({ error: req.t('common:routes.feeTemplateNotFound') });
      }

      // Log to trash
      if (templateSnapshot && !appliedStructure) {
        logToTrash({
          itemType: 'FeeTemplate',
          itemId: templateSnapshot._id,
          itemName: templateSnapshot.name || 'Fee Template',
          originalData: templateSnapshot,
          deletedBy: req.user?.id || req.user?._id,
          schoolId: req.user?.schoolId,
        }).catch(() => {});
      }

      res.json({
        success: true,
        archived: Boolean(appliedStructure),
        message: appliedStructure
          ? 'Template archived. Existing class fee structures retain their source history.'
          : 'Template deleted.',
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

export default router;
