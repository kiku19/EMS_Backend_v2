import express from 'express';
import { ExamHall } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { validateZod } from '../middleware/validation.js';
import { createExamHallSchema, updateExamHallSchema } from '../validators/index.js';
import { extractSchoolId, ensureDefaultSchool } from '../utils/schoolContext.js';
import { logToTrash } from '../services/trashService.js';

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

// GET /exam-halls — list active halls for the school
router.get('/exam-halls', checkPermission('settings', 'view'), async (req, res) => {
  try {
    const schoolId = await resolveRequestSchoolId(req);
    const halls = await ExamHall.find(scopeBySchool(schoolId, { isDeleted: { $ne: true } }))
      .sort({ block: 1, name: 1 })
      .lean();
    res.json(halls);
  } catch (error) {
    console.error('Error fetching exam halls:', error);
    res.status(500).json({ error: 'An internal error occurred. Please try again.' });
  }
});

// GET /exam-halls/:id
router.get('/exam-halls/:id', checkPermission('settings', 'view'), async (req, res) => {
  try {
    const schoolId = await resolveRequestSchoolId(req);
    const hall = await ExamHall.findOne(
      scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
    ).lean();
    if (!hall) return res.status(404).json({ error: 'Exam hall not found' });
    res.json(hall);
  } catch (error) {
    console.error('Error fetching exam hall:', error);
    res.status(500).json({ error: 'An internal error occurred. Please try again.' });
  }
});

// POST /exam-halls
router.post(
  '/exam-halls',
  checkPermission('settings', 'create'),
  validateZod(createExamHallSchema),
  async (req, res) => {
    try {
      const schoolId = await resolveRequestSchoolId(req);
      const hall = new ExamHall({ ...req.body, schoolId });
      await hall.save();
      res.status(201).json(hall.toObject());
    } catch (error) {
      console.error('Error creating exam hall:', error);
      if (error.code === 11000) {
        return res.status(409).json({ error: 'An exam hall with this name already exists' });
      }
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

// PUT /exam-halls/:id
router.put(
  '/exam-halls/:id',
  checkPermission('settings', 'edit'),
  validateZod(updateExamHallSchema),
  async (req, res) => {
    try {
      const schoolId = await resolveRequestSchoolId(req);
      const hall = await ExamHall.findOne(
        scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
      );
      if (!hall) return res.status(404).json({ error: 'Exam hall not found' });

      const allowed = [
        'name',
        'block',
        'capacity',
        'benchCapacity',
        'rows',
        'columns',
        'notes',
        'isActive',
      ];
      for (const field of allowed) {
        if (req.body[field] !== undefined) hall[field] = req.body[field];
      }
      await hall.save();
      res.json(hall.toObject());
    } catch (error) {
      console.error('Error updating exam hall:', error);
      if (error.code === 11000) {
        return res.status(409).json({ error: 'An exam hall with this name already exists' });
      }
      res.status(500).json({ error: 'An internal error occurred. Please try again.' });
    }
  }
);

// DELETE /exam-halls/:id (soft)
router.delete('/exam-halls/:id', checkPermission('settings', 'delete'), async (req, res) => {
  try {
    const schoolId = await resolveRequestSchoolId(req);
    const hall = await ExamHall.findOne(
      scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
    );
    if (!hall) return res.status(404).json({ error: 'Exam hall not found' });

    const snapshot = hall.toObject();
    hall.isDeleted = true;
    hall.deletedAt = new Date();
    await hall.save();

    logToTrash({
      itemType: 'ExamHall',
      itemId: hall._id,
      itemName: snapshot.name,
      originalData: snapshot,
      deletedBy: req.user?.id || req.user?._id,
      schoolId,
    }).catch(() => {});

    res.json({ message: 'Exam hall deleted successfully' });
  } catch (error) {
    console.error('Error deleting exam hall:', error);
    res.status(500).json({ error: 'An internal error occurred. Please try again.' });
  }
});

export default router;
