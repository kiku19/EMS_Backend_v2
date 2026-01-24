import express from 'express';
import { Substitution, Staff, Class } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';

const router = express.Router();

/**
 * GET /api/substitutions
 * Get all substitutions
 * Query params: date (optional filter), classId (optional filter), status (optional filter)
 */
router.get('/', authenticate, checkPermission('classes', 'view'), async (req, res) => {
  try {
    const { date, classId, status } = req.query;

    // Build query
    const query = {};
    if (date) query.date = date;
    if (classId) query.classId = classId;
    if (status) query.status = status;

    const substitutions = await Substitution.find(query)
      .populate('classId', 'name section')
      .populate('absentTeacherId', 'name role')
      .populate('substituteTeacherId', 'name role')
      .sort({ date: -1, period: 1 });

    res.json(substitutions);
  } catch (error) {
    console.error('Error fetching substitutions:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/substitutions/:id
 * Get a single substitution by ID
 */
router.get('/:id', authenticate, checkPermission('classes', 'view'), async (req, res) => {
  try {
    const substitution = await Substitution.findById(req.params.id)
      .populate('classId', 'name section')
      .populate('absentTeacherId', 'name role')
      .populate('substituteTeacherId', 'name role');

    if (!substitution) {
      return res.status(404).json({ error: 'Substitution not found' });
    }

    res.json(substitution);
  } catch (error) {
    console.error('Error fetching substitution:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/substitutions
 * Create new substitution
 * Body: { date, classId, period, absentTeacherId, substituteTeacherId, reason, type, notes }
 */
router.post('/', authenticate, checkPermission('classes', 'edit'), async (req, res) => {
  try {
    const { date, classId, period, absentTeacherId, substituteTeacherId, reason, type = 'manual', notes } = req.body;

    // Validate required fields
    if (!date || !classId || !period || !substituteTeacherId) {
      return res.status(400).json({ error: 'date, classId, period, and substituteTeacherId are required' });
    }

    // Validate class exists
    const classData = await Class.findById(classId);
    if (!classData) {
      return res.status(404).json({ error: 'Class not found' });
    }

    // Validate substitute teacher exists
    const substituteTeacher = await Staff.findById(substituteTeacherId);
    if (!substituteTeacher) {
      return res.status(404).json({ error: 'Substitute teacher not found' });
    }

    // Validate absent teacher if provided
    if (absentTeacherId) {
      const absentTeacher = await Staff.findById(absentTeacherId);
      if (!absentTeacher) {
        return res.status(404).json({ error: 'Absent teacher not found' });
      }
    }

    // Check if substitution already exists for this date, class, and period
    const existing = await Substitution.findOne({ date, classId, period });
    if (existing) {
      return res.status(400).json({ error: 'Substitution already exists for this date, class, and period' });
    }

    const substitution = new Substitution({
      date,
      classId,
      period,
      absentTeacherId: absentTeacherId || null,
      substituteTeacherId,
      reason,
      type,
      notes,
      status: 'confirmed'
    });

    await substitution.save();

    // Populate for response
    await substitution.populate('classId', 'name section');
    await substitution.populate('absentTeacherId', 'name role');
    await substitution.populate('substituteTeacherId', 'name role');

    res.status(201).json(substitution);
  } catch (error) {
    console.error('Error creating substitution:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/substitutions/:id
 * Update substitution
 * Body: { date, classId, period, absentTeacherId, substituteTeacherId, reason, type, status, notes }
 */
router.put('/:id', authenticate, checkPermission('classes', 'edit'), async (req, res) => {
  try {
    const { date, classId, period, absentTeacherId, substituteTeacherId, reason, type, status, notes } = req.body;

    // Find existing substitution
    const substitution = await Substitution.findById(req.params.id);
    if (!substitution) {
      return res.status(404).json({ error: 'Substitution not found' });
    }

    // Build update object
    const updateData = {};
    if (date !== undefined) updateData.date = date;
    if (classId !== undefined) {
      const classData = await Class.findById(classId);
      if (!classData) {
        return res.status(404).json({ error: 'Class not found' });
      }
      updateData.classId = classId;
    }
    if (period !== undefined) updateData.period = period;
    if (absentTeacherId !== undefined) {
      if (absentTeacherId) {
        const absentTeacher = await Staff.findById(absentTeacherId);
        if (!absentTeacher) {
          return res.status(404).json({ error: 'Absent teacher not found' });
        }
      }
      updateData.absentTeacherId = absentTeacherId;
    }
    if (substituteTeacherId !== undefined) {
      const substituteTeacher = await Staff.findById(substituteTeacherId);
      if (!substituteTeacher) {
        return res.status(404).json({ error: 'Substitute teacher not found' });
      }
      updateData.substituteTeacherId = substituteTeacherId;
    }
    if (reason !== undefined) updateData.reason = reason;
    if (type !== undefined) updateData.type = type;
    if (status !== undefined) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;

    // Update substitution
    Object.assign(substitution, updateData);
    await substitution.save();

    // Populate for response
    await substitution.populate('classId', 'name section');
    await substitution.populate('absentTeacherId', 'name role');
    await substitution.populate('substituteTeacherId', 'name role');

    res.json(substitution);
  } catch (error) {
    console.error('Error updating substitution:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/substitutions/:id
 * Delete substitution
 */
router.delete('/:id', authenticate, checkPermission('classes', 'delete'), async (req, res) => {
  try {
    const substitution = await Substitution.findByIdAndDelete(req.params.id);

    if (!substitution) {
      return res.status(404).json({ error: 'Substitution not found' });
    }

    res.json({ success: true, message: 'Substitution deleted successfully' });
  } catch (error) {
    console.error('Error deleting substitution:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/substitutions/date/:date
 * Get all substitutions for a specific date
 */
router.get('/date/:date', authenticate, checkPermission('classes', 'view'), async (req, res) => {
  try {
    const { date } = req.params;

    const substitutions = await Substitution.find({ date })
      .populate('classId', 'name section')
      .populate('absentTeacherId', 'name role')
      .populate('substituteTeacherId', 'name role')
      .sort({ period: 1 });

    res.json(substitutions);
  } catch (error) {
    console.error('Error fetching substitutions by date:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/substitutions/teacher/:teacherId
 * Get all substitutions for a teacher (either as absent or substitute)
 */
router.get('/teacher/:teacherId', authenticate, checkPermission('classes', 'view'), async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { startDate, endDate } = req.query;

    // Build query - teacher is either absent or substitute
    const query = {
      $or: [
        { absentTeacherId: teacherId },
        { substituteTeacherId: teacherId }
      ]
    };

    // Add date range if provided
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = startDate;
      if (endDate) query.date.$lte = endDate;
    }

    const substitutions = await Substitution.find(query)
      .populate('classId', 'name section')
      .populate('absentTeacherId', 'name role')
      .populate('substituteTeacherId', 'name role')
      .sort({ date: -1, period: 1 });

    res.json(substitutions);
  } catch (error) {
    console.error('Error fetching teacher substitutions:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
