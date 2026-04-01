import express from 'express';
import { z } from 'zod';
import { Substitution, Staff, Class } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { extractSchoolId, ensureDefaultSchool } from '../utils/schoolContext.js';

// Zod schemas for substitution validation
const createSubstitutionSchema = z.object({
  date: z.string().min(1, 'Date is required'),
  classId: z.string().min(1, 'Class ID is required'),
  period: z.union([z.string(), z.number()]).transform((val) => String(val)),
  absentTeacherId: z.string().optional().nullable(),
  substituteTeacherId: z.string().min(1, 'Substitute teacher ID is required'),
  reason: z.string().optional(),
  // AUDIT-7: Match Mongoose enum exactly: ['auto', 'manual']
  type: z.enum(['auto', 'manual']).default('manual'),
  notes: z.string().optional(),
});

const updateSubstitutionSchema = z.object({
  date: z.string().optional(),
  classId: z.string().optional(),
  period: z
    .union([z.string(), z.number()])
    .transform((val) => String(val))
    .optional(),
  absentTeacherId: z.string().optional().nullable(),
  substituteTeacherId: z.string().optional(),
  reason: z.string().optional(),
  // AUDIT-7: Match Mongoose enum exactly: ['auto', 'manual']
  type: z.enum(['auto', 'manual']).optional(),
  // AUDIT-7: Match Mongoose enum exactly: ['pending', 'confirmed', 'completed', 'declined']
  status: z.enum(['pending', 'confirmed', 'completed', 'declined']).optional(),
  notes: z.string().optional(),
});

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

    const substitutions = await Substitution.find(scopeBySchool(req.user?.schoolId, query))
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
 * GET /api/substitutions/my-alerts
 * Get pending substitution alerts for the authenticated teacher
 * Returns substitutions where substituteTeacherId === current user and teacherResponse === 'pending'
 * IMPORTANT: This route MUST be defined before /:id to prevent route shadowing
 */
router.get('/my-alerts', authenticate, async (req, res) => {
  try {
    const schoolId = await resolveRequestSchoolId(req);
    const staffId = req.user?.id || req.user?.userId;
    const today = new Date().toISOString().split('T')[0];

    const substitutions = await Substitution.find(
      scopeBySchool(schoolId, {
        substituteTeacherId: staffId,
        date: { $gte: today },
        teacherResponse: 'pending',
      })
    )
      .populate('classId', 'name section')
      .populate('absentTeacherId', 'name role')
      .sort({ date: 1, period: 1 });

    res.json({ success: true, substitutions });
  } catch (error) {
    console.error('Error fetching substitution alerts:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * AUDIT-42: /date/:date and /teacher/:teacherId MUST be defined BEFORE /:id
 * to prevent Express route shadowing (/:id would match "date" and "teacher" as IDs).
 */

/**
 * GET /api/substitutions/date/:date
 * Get all substitutions for a specific date
 */
router.get('/date/:date', authenticate, checkPermission('classes', 'view'), async (req, res) => {
  try {
    const { date } = req.params;

    const substitutions = await Substitution.find(scopeBySchool(req.user?.schoolId, { date }))
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
router.get(
  '/teacher/:teacherId',
  authenticate,
  checkPermission('classes', 'view'),
  async (req, res) => {
    try {
      const { teacherId } = req.params;
      const { startDate, endDate } = req.query;

      // Build query - teacher is either absent or substitute
      const query = {
        $or: [{ absentTeacherId: teacherId }, { substituteTeacherId: teacherId }],
      };

      // Add date range if provided
      if (startDate || endDate) {
        query.date = {};
        if (startDate) query.date.$gte = startDate;
        if (endDate) query.date.$lte = endDate;
      }

      const substitutions = await Substitution.find(scopeBySchool(req.user?.schoolId, query))
        .populate('classId', 'name section')
        .populate('absentTeacherId', 'name role')
        .populate('substituteTeacherId', 'name role')
        .sort({ date: -1, period: 1 });

      res.json(substitutions);
    } catch (error) {
      console.error('Error fetching teacher substitutions:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * GET /api/substitutions/:id
 * Get a single substitution by ID
 */
router.get('/:id', authenticate, checkPermission('classes', 'view'), async (req, res) => {
  try {
    const substitution = await Substitution.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    )
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
    const data = createSubstitutionSchema.parse(req.body);

    const schoolId = req.user?.schoolId ? extractSchoolId(req.user.schoolId) : undefined;

    // Validate class exists and belongs to the same school
    const classData = await Class.findOne(scopeBySchool(schoolId, { _id: data.classId }));
    if (!classData) {
      return res.status(404).json({ error: req.t('common:errors.classNotFound') });
    }

    // Validate substitute teacher exists and belongs to the same school
    const substituteTeacher = await Staff.findOne(
      scopeBySchool(schoolId, { _id: data.substituteTeacherId })
    );
    if (!substituteTeacher) {
      return res.status(404).json({ error: 'Substitute teacher not found' });
    }

    // Validate absent teacher if provided and belongs to the same school
    if (data.absentTeacherId) {
      const absentTeacher = await Staff.findOne(
        scopeBySchool(schoolId, { _id: data.absentTeacherId })
      );
      if (!absentTeacher) {
        return res.status(404).json({ error: 'Absent teacher not found' });
      }
    }

    // Check if substitution already exists for this date, class, and period
    const existing = await Substitution.findOne(
      scopeBySchool(req.user?.schoolId, {
        date: data.date,
        classId: data.classId,
        period: data.period,
      })
    );
    if (existing) {
      return res
        .status(400)
        .json({ error: 'Substitution already exists for this date, class, and period' });
    }

    // AUDIT-41: Check for substitute teacher conflict (double-booking)
    const teacherConflict = await Substitution.findOne(
      scopeBySchool(schoolId, {
        date: data.date,
        period: data.period,
        substituteTeacherId: data.substituteTeacherId,
        status: { $nin: ['declined'] },
      })
    );
    if (teacherConflict) {
      return res.status(409).json({
        error: 'Substitute teacher is already assigned to another class for this date and period',
        conflictingSubstitution: {
          id: teacherConflict._id,
          classId: teacherConflict.classId,
          date: teacherConflict.date,
          period: teacherConflict.period,
        },
      });
    }

    const substitution = new Substitution({
      ...data,
      absentTeacherId: data.absentTeacherId || null,
      status: 'confirmed',
      schoolId: req.user?.schoolId ? extractSchoolId(req.user.schoolId) : undefined,
    });

    await substitution.save();

    // Populate for response
    await substitution.populate('classId', 'name section');
    await substitution.populate('absentTeacherId', 'name role');
    await substitution.populate('substituteTeacherId', 'name role');

    res.status(201).json(substitution);
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
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
    const data = updateSubstitutionSchema.parse(req.body);

    // Find existing substitution
    const substitution = await Substitution.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    );
    if (!substitution) {
      return res.status(404).json({ error: 'Substitution not found' });
    }

    // AUDIT-5: Validate class with schoolId scoping
    if (data.classId) {
      const classData = await Class.findOne(
        scopeBySchool(req.user?.schoolId, { _id: data.classId })
      );
      if (!classData) {
        return res.status(404).json({ error: req.t('common:errors.classNotFound') });
      }
    }

    // AUDIT-5: Validate absent teacher with schoolId scoping
    if (data.absentTeacherId) {
      const absentTeacher = await Staff.findOne(
        scopeBySchool(req.user?.schoolId, { _id: data.absentTeacherId })
      );
      if (!absentTeacher) {
        return res.status(404).json({ error: 'Absent teacher not found' });
      }
    }

    // AUDIT-5: Validate substitute teacher with schoolId scoping
    if (data.substituteTeacherId) {
      const substituteTeacher = await Staff.findOne(
        scopeBySchool(req.user?.schoolId, { _id: data.substituteTeacherId })
      );
      if (!substituteTeacher) {
        return res.status(404).json({ error: 'Substitute teacher not found' });
      }
    }

    // Update substitution
    Object.assign(substitution, data);
    await substitution.save();

    // Populate for response
    await substitution.populate('classId', 'name section');
    await substitution.populate('absentTeacherId', 'name role');
    await substitution.populate('substituteTeacherId', 'name role');

    res.json(substitution);
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
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
    const substitution = await Substitution.findOneAndDelete(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    );
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
 * PATCH /api/substitutions/:id/respond
 * Teacher accepts or declines their substitution assignment
 * Body: { response: 'accepted' | 'declined', reason? }
 */
router.patch('/:id/respond', authenticate, async (req, res) => {
  try {
    const { response, reason } = req.body;

    if (!response || !['accepted', 'declined'].includes(response)) {
      return res.status(400).json({ error: "response must be 'accepted' or 'declined'" });
    }

    const schoolId = await resolveRequestSchoolId(req);
    const staffId = req.user?.id || req.user?.userId;

    const substitution = await Substitution.findOne(
      scopeBySchool(schoolId, { _id: req.params.id })
    );
    if (!substitution) {
      return res.status(404).json({ error: 'Substitution not found' });
    }

    if (substitution.substituteTeacherId.toString() !== staffId) {
      return res.status(403).json({ error: 'Only the assigned substitute teacher can respond' });
    }

    substitution.teacherResponse = response;
    if (response === 'declined') {
      substitution.status = 'declined';
    }
    if (reason) substitution.notes = reason;
    await substitution.save();

    await substitution.populate('classId', 'name section');
    await substitution.populate('absentTeacherId', 'name role');
    await substitution.populate('substituteTeacherId', 'name role');

    res.json({ success: true, substitution });
  } catch (error) {
    console.error('Error responding to substitution:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
