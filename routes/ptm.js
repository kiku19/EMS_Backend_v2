import express from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { extractSchoolId } from '../utils/schoolContext.js';
import PTMSession from '../models/PTMSession.js';

const router = express.Router();
router.use(authenticate);

function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) throw new Error('schoolId is required for scoped queries');
  return { ...query, schoolId: normalizedSchoolId };
}

/** Convert "HH:MM" to total minutes for comparison */
function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Check if two time ranges overlap (both in "HH:MM" format) */
function timesOverlap(startA, endA, startB, endB) {
  return timeToMinutes(startA) < timeToMinutes(endB) && timeToMinutes(startB) < timeToMinutes(endA);
}

/**
 * Check for session-level conflicts (same staff or class on the same date with overlapping times).
 * Returns a conflict message string or null.
 */
async function checkSessionConflict(
  schoolId,
  sessionDate,
  startTime,
  endTime,
  staffId,
  classId,
  excludeId
) {
  const dateStart = new Date(sessionDate);
  dateStart.setHours(0, 0, 0, 0);
  const dateEnd = new Date(sessionDate);
  dateEnd.setHours(23, 59, 59, 999);

  const filter = scopeBySchool(schoolId, {
    isDeleted: { $ne: true },
    status: { $ne: 'cancelled' },
    sessionDate: { $gte: dateStart, $lte: dateEnd },
    $or: [{ staffId }, { classId }],
  });
  if (excludeId) filter._id = { $ne: excludeId };

  const conflicts = await PTMSession.find(filter)
    .populate('classId', 'name section')
    .populate('staffId', 'name');
  for (const s of conflicts) {
    if (!timesOverlap(startTime, endTime, s.startTime, s.endTime)) continue;
    const sid = String(s.staffId?._id || s.staffId);
    const cid = String(s.classId?._id || s.classId);
    if (sid === String(staffId)) {
      return `Teacher ${s.staffId?.name || ''} already has a PTM session (${s.startTime}–${s.endTime}) on this date`;
    }
    if (cid === String(classId)) {
      const label = s.classId?.name
        ? `${s.classId.name}${s.classId.section ? ' ' + s.classId.section : ''}`
        : 'Class';
      return `${label} already has a PTM session (${s.startTime}–${s.endTime}) on this date`;
    }
  }
  return null;
}

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const createSessionSchema = z
  .object({
    title: z.string().min(2).max(200),
    description: z.string().max(1000).optional().default(''),
    sessionDate: z.string().refine((v) => !isNaN(Date.parse(v)), { message: 'Invalid date' }),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, 'startTime must be HH:MM'),
    endTime: z.string().regex(/^\d{2}:\d{2}$/, 'endTime must be HH:MM'),
    slotDuration: z.number().int().min(5).max(120).optional().default(15),
    classId: z.string().length(24, 'Invalid classId'),
    staffId: z.string().length(24, 'Invalid staffId'),
    venue: z.string().max(300).optional().default(''),
    status: z
      .enum(['scheduled', 'ongoing', 'completed', 'cancelled'])
      .optional()
      .default('scheduled'),
  })
  .refine((data) => data.startTime < data.endTime, {
    message: 'startTime must be before endTime',
    path: ['endTime'],
  });

const updateSessionSchema = createSessionSchema.partial();

const addSlotSchema = z.object({
  studentId: z.string().length(24, 'Invalid studentId'),
  parentName: z.string().min(2).max(100),
  parentPhone: z
    .string()
    .regex(/^[0-9]{10}$/)
    .optional(),
  scheduledTime: z.string().regex(/^\d{2}:\d{2}$/, 'scheduledTime must be HH:MM'),
  notes: z.string().max(500).optional().default(''),
});

const updateSlotSchema = z.object({
  status: z.enum(['booked', 'completed', 'cancelled', 'no-show']).optional(),
  notes: z.string().max(500).optional(),
  parentName: z.string().min(2).max(100).optional(),
  parentPhone: z
    .string()
    .regex(/^[0-9]{10}$/)
    .optional(),
  scheduledTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
});

// ─── Session Routes ───────────────────────────────────────────────────────────

/**
 * GET /api/ptm
 * List all PTM sessions for the school (not deleted)
 */
router.get('/', authenticate, checkPermission('ptm', 'view'), async (req, res) => {
  try {
    const { classId, staffId, status, from, to } = req.query;
    const query = scopeBySchool(req.user?.schoolId, { isDeleted: { $ne: true } });

    if (classId) query.classId = classId;
    if (staffId) query.staffId = staffId;
    if (status) query.status = status;
    if (from || to) {
      query.sessionDate = {};
      if (from) query.sessionDate.$gte = new Date(from);
      if (to) query.sessionDate.$lte = new Date(to);
    }

    const sessions = await PTMSession.find(query)
      .sort({ sessionDate: -1 })
      .populate('classId', 'name section')
      .populate('staffId', 'name role');

    res.json({ success: true, data: sessions });
  } catch (error) {
    console.error('❌ GET /ptm error:', error);
    res
      .status(500)
      .json({ success: false, message: 'Failed to fetch PTM sessions', error: error.message });
  }
});

/**
 * POST /api/ptm
 * Create a new PTM session
 */
router.post('/', authenticate, checkPermission('ptm', 'create'), async (req, res) => {
  try {
    const parsed = createSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ success: false, message: 'Validation failed', errors: parsed.error.errors });
    }

    const schoolId = extractSchoolId(req.user?.schoolId);
    if (!schoolId)
      return res.status(401).json({ success: false, message: req.t('common:errors.unauthorized') });

    const data = parsed.data;

    // Check for overlapping sessions (same staff or class on same date)
    const conflict = await checkSessionConflict(
      schoolId,
      data.sessionDate,
      data.startTime,
      data.endTime,
      data.staffId,
      data.classId
    );
    if (conflict) {
      return res.status(409).json({ success: false, message: conflict });
    }

    const session = await PTMSession.create({
      ...data,
      sessionDate: new Date(data.sessionDate),
      schoolId,
    });

    const populated = await PTMSession.findById(session._id)
      .populate('classId', 'name section')
      .populate('staffId', 'name role');

    res.status(201).json({ success: true, data: populated });
  } catch (error) {
    console.error('❌ POST /ptm error:', error);
    res
      .status(500)
      .json({ success: false, message: 'Failed to create PTM session', error: error.message });
  }
});

/**
 * GET /api/ptm/:id
 * Get a single PTM session with all slots
 */
router.get('/:id', authenticate, checkPermission('ptm', 'view'), async (req, res) => {
  try {
    const session = await PTMSession.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
    )
      .populate('classId', 'name section')
      .populate('staffId', 'name role')
      .populate('slots.studentId', 'name admissionNo rollNo');

    if (!session) return res.status(404).json({ success: false, message: 'PTM session not found' });

    res.json({ success: true, data: session });
  } catch (error) {
    console.error('❌ GET /ptm/:id error:', error);
    res
      .status(500)
      .json({ success: false, message: 'Failed to fetch PTM session', error: error.message });
  }
});

/**
 * PUT /api/ptm/:id
 * Update a PTM session
 */
router.put('/:id', authenticate, checkPermission('ptm', 'edit'), async (req, res) => {
  try {
    const parsed = updateSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ success: false, message: 'Validation failed', errors: parsed.error.errors });
    }

    const update = { ...parsed.data };
    if (update.sessionDate) update.sessionDate = new Date(update.sessionDate);

    // If time/date/staff/class changed, check for conflicts
    if (
      update.sessionDate ||
      update.startTime ||
      update.endTime ||
      update.staffId ||
      update.classId
    ) {
      const existing = await PTMSession.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
      );
      if (existing) {
        const conflict = await checkSessionConflict(
          req.user?.schoolId,
          update.sessionDate || existing.sessionDate,
          update.startTime || existing.startTime,
          update.endTime || existing.endTime,
          update.staffId || existing.staffId,
          update.classId || existing.classId,
          existing._id
        );
        if (conflict) {
          return res.status(409).json({ success: false, message: conflict });
        }
      }
    }

    const session = await PTMSession.findOneAndUpdate(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
      { $set: update },
      { new: true }
    )
      .populate('classId', 'name section')
      .populate('staffId', 'name role');

    if (!session) return res.status(404).json({ success: false, message: 'PTM session not found' });

    res.json({ success: true, data: session });
  } catch (error) {
    console.error('❌ PUT /ptm/:id error:', error);
    res
      .status(500)
      .json({ success: false, message: 'Failed to update PTM session', error: error.message });
  }
});

/**
 * DELETE /api/ptm/:id
 * Soft-delete a PTM session
 */
router.delete('/:id', authenticate, checkPermission('ptm', 'delete'), async (req, res) => {
  try {
    const session = await PTMSession.findOneAndUpdate(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
      { $set: { isDeleted: true, status: 'cancelled' } },
      { new: true }
    );

    if (!session) return res.status(404).json({ success: false, message: 'PTM session not found' });

    res.json({ success: true, message: 'PTM session cancelled successfully' });
  } catch (error) {
    console.error('❌ DELETE /ptm/:id error:', error);
    res
      .status(500)
      .json({ success: false, message: 'Failed to cancel PTM session', error: error.message });
  }
});

// ─── Slot Routes ─────────────────────────────────────────────────────────────

/**
 * POST /api/ptm/:id/slots
 * Add a slot booking to a PTM session
 */
router.post('/:id/slots', authenticate, checkPermission('ptm', 'create'), async (req, res) => {
  try {
    const parsed = addSlotSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ success: false, message: 'Validation failed', errors: parsed.error.errors });
    }

    const session = await PTMSession.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
    );
    if (!session) return res.status(404).json({ success: false, message: 'PTM session not found' });

    // Check for duplicate student booking in this PTM session
    const existingStudentBooking = session.slots.find(
      (s) => s.status !== 'cancelled' && String(s.studentId) === String(parsed.data.studentId)
    );
    if (existingStudentBooking) {
      return res.status(409).json({
        success: false,
        message: `This student already has a booking for this PTM session at ${existingStudentBooking.scheduledTime}`,
      });
    }

    // Check that slot time falls within session time range
    const newStart = timeToMinutes(parsed.data.scheduledTime);
    const newEnd = newStart + (session.slotDuration || 15);
    const sessionStart = timeToMinutes(session.startTime);
    const sessionEnd = timeToMinutes(session.endTime);
    if (newStart < sessionStart || newEnd > sessionEnd) {
      return res.status(400).json({
        success: false,
        message: `Slot time must fall within session hours (${session.startTime}–${session.endTime})`,
      });
    }

    // Check for overlapping slot (accounts for slotDuration)
    const timeConflict = session.slots.find((s) => {
      if (s.status === 'cancelled') return false;
      const slotStart = timeToMinutes(s.scheduledTime);
      const slotEnd = slotStart + (session.slotDuration || 15);
      return newStart < slotEnd && slotStart < newEnd;
    });
    if (timeConflict) {
      return res.status(409).json({
        success: false,
        message: `Time slot overlaps with existing booking at ${timeConflict.scheduledTime} (${session.slotDuration} min slots)`,
      });
    }

    session.slots.push(parsed.data);
    await session.save();

    await session.populate('slots.studentId', 'name admissionNo rollNo');

    res.status(201).json({ success: true, data: session.slots[session.slots.length - 1] });
  } catch (error) {
    console.error('❌ POST /ptm/:id/slots error:', error);
    res.status(500).json({ success: false, message: 'Failed to add slot', error: error.message });
  }
});

/**
 * PUT /api/ptm/:sessionId/slots/:slotId
 * Update a slot (status, notes)
 */
router.put(
  '/:sessionId/slots/:slotId',
  authenticate,
  checkPermission('ptm', 'edit'),
  async (req, res) => {
    try {
      const parsed = updateSlotSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ success: false, message: 'Validation failed', errors: parsed.error.errors });
      }

      // If scheduledTime is being changed, check for overlap before updating
      if (parsed.data.scheduledTime) {
        const session = await PTMSession.findOne(
          scopeBySchool(req.user?.schoolId, { _id: req.params.sessionId, isDeleted: { $ne: true } })
        );
        if (!session)
          return res.status(404).json({ success: false, message: 'Session or slot not found' });

        const newStart = timeToMinutes(parsed.data.scheduledTime);
        const newEnd = newStart + (session.slotDuration || 15);
        const timeConflict = session.slots.find((s) => {
          if (String(s._id) === req.params.slotId) return false; // skip self
          if (s.status === 'cancelled') return false;
          const slotStart = timeToMinutes(s.scheduledTime);
          const slotEnd = slotStart + (session.slotDuration || 15);
          return newStart < slotEnd && slotStart < newEnd;
        });
        if (timeConflict) {
          return res.status(409).json({
            success: false,
            message: `Time slot overlaps with existing booking at ${timeConflict.scheduledTime} (${session.slotDuration} min slots)`,
          });
        }
      }

      const updateFields = {};
      for (const [key, val] of Object.entries(parsed.data)) {
        updateFields[`slots.$.${key}`] = val;
      }

      const session = await PTMSession.findOneAndUpdate(
        scopeBySchool(req.user?.schoolId, {
          _id: req.params.sessionId,
          'slots._id': req.params.slotId,
          isDeleted: { $ne: true },
        }),
        { $set: updateFields },
        { new: true }
      ).populate('slots.studentId', 'name admissionNo rollNo');

      if (!session)
        return res.status(404).json({ success: false, message: 'Session or slot not found' });

      const updatedSlot = session.slots.id(req.params.slotId);
      res.json({ success: true, data: updatedSlot });
    } catch (error) {
      console.error('❌ PUT /ptm/:sessionId/slots/:slotId error:', error);
      res
        .status(500)
        .json({ success: false, message: 'Failed to update slot', error: error.message });
    }
  }
);

/**
 * DELETE /api/ptm/:sessionId/slots/:slotId
 * Cancel a slot
 */
router.delete(
  '/:sessionId/slots/:slotId',
  authenticate,
  checkPermission('ptm', 'delete'),
  async (req, res) => {
    try {
      const session = await PTMSession.findOneAndUpdate(
        scopeBySchool(req.user?.schoolId, {
          _id: req.params.sessionId,
          'slots._id': req.params.slotId,
          isDeleted: { $ne: true },
        }),
        { $set: { 'slots.$.status': 'cancelled' } },
        { new: true }
      );

      if (!session)
        return res.status(404).json({ success: false, message: 'Session or slot not found' });

      res.json({ success: true, message: 'Slot cancelled successfully' });
    } catch (error) {
      console.error('❌ DELETE /ptm/:sessionId/slots/:slotId error:', error);
      res
        .status(500)
        .json({ success: false, message: 'Failed to cancel slot', error: error.message });
    }
  }
);

export default router;
