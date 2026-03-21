import express from 'express';
import { FeeTemplate, FeeStructure } from '../database.js';
import School from '../models/School.js';
import SchoolGroup from '../models/SchoolGroup.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { extractSchoolId, ensureDefaultSchool } from '../utils/schoolContext.js';

const router = express.Router();

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

router.get('/', authenticate, checkPermission('fees', 'view'), async (req, res) => {
  try {
    const schoolId = extractSchoolId(req.user?.schoolId);
    const ownTemplates = await FeeTemplate.find(scopeBySchool(schoolId)).sort({ name: 1 });

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

router.get('/:id', authenticate, checkPermission('fees', 'view'), async (req, res) => {
  try {
    const template = await FeeTemplate.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    );
    if (!template) {
      return res.status(404).json({ error: 'Fee template not found' });
    }
    res.json(template);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', authenticate, checkPermission('fees', 'create'), async (req, res) => {
  try {
    const schoolId = await resolveRequestSchoolId(req);
    const template = new FeeTemplate({ ...req.body, schoolId });
    await template.save();
    res.status(201).json(template);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', authenticate, checkPermission('fees', 'edit'), async (req, res) => {
  try {
    const { schoolId: _ignore, ...updateData } = req.body;
    const template = await FeeTemplate.findOneAndUpdate(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id }),
      updateData,
      { new: true }
    );
    if (!template) {
      return res.status(404).json({ error: 'Fee template not found' });
    }
    res.json(template);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', authenticate, checkPermission('fees', 'delete'), async (req, res) => {
  try {
    const template = await FeeTemplate.findOneAndDelete(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    );
    if (!template) {
      return res.status(404).json({ error: 'Fee template not found' });
    }

    // Clear dangling templateId references in FeeStructure documents
    await FeeStructure.updateMany(scopeBySchool(req.user?.schoolId, { templateId: template._id }), {
      $unset: { templateId: 1 },
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
