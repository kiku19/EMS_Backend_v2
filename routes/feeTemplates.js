import express from 'express';
import { FeeTemplate } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { extractSchoolId, ensureDefaultSchool } from '../utils/schoolContext.js';

const router = express.Router();

function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) return { ...query };
  return { ...query, schoolId: normalizedSchoolId };
}

async function resolveRequestSchoolId(req) {
  if (req.user?.schoolId) return extractSchoolId(req.user.schoolId);
  const school = await ensureDefaultSchool();
  return extractSchoolId(school._id);
}

router.get('/', authenticate, checkPermission('fees', 'view'), async (req, res) => {
  try {
    const templates = await FeeTemplate.find(
      scopeBySchool(req.user?.schoolId)
    ).sort({ name: 1 });
    res.json(templates);
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
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
