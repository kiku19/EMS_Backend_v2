import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { extractSchoolId } from '../utils/schoolContext.js';
import PTMSession from '../models/PTMSession.js';
import { sendNotification } from './notifications.js';
import { Parent, Student } from '../database.js';

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

// ─── Status Transition Map ───────────────────────────────────────────────────
// Valid PTM session status transitions: scheduled → ongoing → completed
// Cancellation is allowed from scheduled or ongoing (not from completed).
// No backward transitions.
const VALID_STATUS_TRANSITIONS = {
  scheduled: ['ongoing', 'cancelled'],
  ongoing: ['completed', 'cancelled'],
  completed: [], // terminal state
  cancelled: [], // terminal state
};

function validateStatusTransition(currentStatus, newStatus) {
  if (currentStatus === newStatus) return null; // no-op is fine
  const allowed = VALID_STATUS_TRANSITIONS[currentStatus];
  if (!allowed || !allowed.includes(newStatus)) {
    return `Cannot transition PTM session from "${currentStatus}" to "${newStatus}". Allowed transitions from "${currentStatus}": ${allowed?.length ? allowed.join(', ') : 'none (terminal state)'}`;
  }
  return null;
}

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const createSessionBaseSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(1000).optional().default(''),
  sessionDate: z.string().refine((v) => !isNaN(Date.parse(v)), { message: 'Invalid date' }),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'startTime must be HH:MM'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'endTime must be HH:MM'),
  slotDuration: z.number().int().min(5).max(120).optional().default(15),
  classId: z.string().length(24, 'Invalid classId'),
  staffId: z.string().length(24, 'Invalid staffId'),
  venue: z.string().max(300).optional().default(''),
});

const createSessionSchema = createSessionBaseSchema.refine(
  (data) => data.startTime < data.endTime,
  {
    message: 'startTime must be before endTime',
    path: ['endTime'],
  }
);

const updateSessionSchema = createSessionBaseSchema
  .extend({
    status: z.enum(['scheduled', 'ongoing', 'completed', 'cancelled']).optional(),
  })
  .partial()
  .refine(
    (data) => {
      // Only validate time ordering when both times are provided
      if (data.startTime && data.endTime) {
        return data.startTime < data.endTime;
      }
      return true;
    },
    {
      message: 'startTime must be before endTime',
      path: ['endTime'],
    }
  );

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
router.get('/', checkPermission('ptm', 'view'), async (req, res) => {
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
router.post('/', checkPermission('ptm', 'create'), async (req, res) => {
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
      status: 'scheduled',
      schoolId,
    });

    const populated = await PTMSession.findById(session._id)
      .populate('classId', 'name section')
      .populate('staffId', 'name role');

    // Notify parents of students in this class about the scheduled PTM
    try {
      const className = populated.classId
        ? `${populated.classId.name}${populated.classId.section ? ' ' + populated.classId.section : ''}`
        : 'your class';
      const dateStr = new Date(data.sessionDate).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      const students = await Student.find({
        classId: data.classId,
        schoolId,
        isDeleted: { $ne: true },
      }).select('_id');
      const studentIds = students.map((s) => s._id);
      if (studentIds.length > 0) {
        const parents = await Parent.find({ 'children.studentId': { $in: studentIds } }).select(
          '_id'
        );
        for (const parent of parents) {
          sendNotification(
            parent._id,
            'Parent',
            'ptm',
            'PTM Session Scheduled',
            `A Parent-Teacher Meeting for ${className} has been scheduled on ${dateStr} (${data.startTime}–${data.endTime}).`,
            { relatedId: session._id, relatedType: 'PTMSession' }
          ).catch((err) =>
            console.error('[PTM] Notification error (parent scheduled):', err.message)
          );
        }
      }
    } catch (notifErr) {
      console.error('[PTM] Failed to send schedule notifications:', notifErr.message);
    }

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
router.get('/:id', checkPermission('ptm', 'view'), async (req, res) => {
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
router.put('/:id', checkPermission('ptm', 'edit'), async (req, res) => {
  try {
    const parsed = updateSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ success: false, message: 'Validation failed', errors: parsed.error.errors });
    }

    const update = { ...parsed.data };
    if (update.sessionDate) update.sessionDate = new Date(update.sessionDate);

    // Fetch existing session when we need to validate status transitions or conflicts
    const needsExisting =
      update.status ||
      update.sessionDate ||
      update.startTime ||
      update.endTime ||
      update.staffId ||
      update.classId;

    let existing;
    if (needsExisting) {
      existing = await PTMSession.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
      );
      if (!existing) {
        return res.status(404).json({ success: false, message: 'PTM session not found' });
      }
    }

    // Validate status transition
    if (update.status && existing) {
      const transitionError = validateStatusTransition(existing.status, update.status);
      if (transitionError) {
        return res.status(400).json({ success: false, message: transitionError });
      }
    }

    // If time/date/staff/class changed, check for conflicts
    if (
      existing &&
      (update.sessionDate || update.startTime || update.endTime || update.staffId || update.classId)
    ) {
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

    const session = await PTMSession.findOneAndUpdate(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
      { $set: update },
      { new: true }
    )
      .populate('classId', 'name section')
      .populate('staffId', 'name role');

    if (!session) return res.status(404).json({ success: false, message: 'PTM session not found' });

    // Notify booked parents when a session is cancelled
    if (update.status === 'cancelled') {
      try {
        const bookedSlots = session.slots?.filter((s) => s.status === 'booked') || [];
        const bookedStudentIds = bookedSlots.map((s) => s.studentId);
        if (bookedStudentIds.length > 0) {
          const className = session.classId
            ? `${session.classId.name}${session.classId.section ? ' ' + session.classId.section : ''}`
            : '';
          const parents = await Parent.find({
            'children.studentId': { $in: bookedStudentIds },
          }).select('_id');
          for (const parent of parents) {
            sendNotification(
              parent._id,
              'Parent',
              'ptm',
              'PTM Session Cancelled',
              `The PTM session "${session.title}"${className ? ` for ${className}` : ''} has been cancelled.`,
              { relatedId: session._id, relatedType: 'PTMSession' }
            ).catch((err) =>
              console.error('[PTM] Notification error (parent cancelled):', err.message)
            );
          }
        }
      } catch (notifErr) {
        console.error('[PTM] Failed to send cancellation notifications:', notifErr.message);
      }
    }

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
router.delete('/:id', checkPermission('ptm', 'delete'), async (req, res) => {
  try {
    const session = await PTMSession.findOneAndUpdate(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
      { $set: { isDeleted: true, status: 'cancelled' } },
      { new: true }
    );

    if (!session) return res.status(404).json({ success: false, message: 'PTM session not found' });

    // Notify booked parents about the cancellation
    try {
      const bookedSlots = session.slots?.filter((s) => s.status === 'booked') || [];
      const bookedStudentIds = bookedSlots.map((s) => s.studentId);
      if (bookedStudentIds.length > 0) {
        const parents = await Parent.find({
          'children.studentId': { $in: bookedStudentIds },
        }).select('_id');
        for (const parent of parents) {
          sendNotification(
            parent._id,
            'Parent',
            'ptm',
            'PTM Session Cancelled',
            `The PTM session "${session.title}" has been cancelled.`,
            { relatedId: session._id, relatedType: 'PTMSession' }
          ).catch((err) =>
            console.error('[PTM] Notification error (parent delete-cancelled):', err.message)
          );
        }
      }
    } catch (notifErr) {
      console.error('[PTM] Failed to send delete cancellation notifications:', notifErr.message);
    }

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
 *
 * Uses a MongoDB transaction to prevent the race condition where two
 * concurrent requests both pass the conflict check and book the same
 * time slot. The transaction ensures the read-check-write is atomic.
 */
router.post('/:id/slots', checkPermission('ptm', 'create'), async (req, res) => {
  try {
    const parsed = addSlotSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ success: false, message: 'Validation failed', errors: parsed.error.errors });
    }

    const mongoSession = await mongoose.startSession();
    let result;
    try {
      await mongoSession.withTransaction(async () => {
        const session = await PTMSession.findOne(
          scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
        ).session(mongoSession);
        if (!session) {
          throw Object.assign(new Error('PTM session not found'), { statusCode: 404 });
        }

        // Check for duplicate student booking in this PTM session
        const existingStudentBooking = session.slots.find(
          (s) => s.status !== 'cancelled' && String(s.studentId) === String(parsed.data.studentId)
        );
        if (existingStudentBooking) {
          throw Object.assign(
            new Error(
              `This student already has a booking for this PTM session at ${existingStudentBooking.scheduledTime}`
            ),
            { statusCode: 409 }
          );
        }

        // Check that slot time falls within session time range
        const newStart = timeToMinutes(parsed.data.scheduledTime);
        const newEnd = newStart + (session.slotDuration || 15);
        const sessionStart = timeToMinutes(session.startTime);
        const sessionEnd = timeToMinutes(session.endTime);
        if (newStart < sessionStart || newEnd > sessionEnd) {
          throw Object.assign(
            new Error(
              `Slot time must fall within session hours (${session.startTime}–${session.endTime})`
            ),
            { statusCode: 400 }
          );
        }

        // Check for overlapping slot (accounts for slotDuration)
        const timeConflict = session.slots.find((s) => {
          if (s.status === 'cancelled') return false;
          const slotStart = timeToMinutes(s.scheduledTime);
          const slotEnd = slotStart + (session.slotDuration || 15);
          return newStart < slotEnd && slotStart < newEnd;
        });
        if (timeConflict) {
          throw Object.assign(
            new Error(
              `Time slot overlaps with existing booking at ${timeConflict.scheduledTime} (${session.slotDuration} min slots)`
            ),
            { statusCode: 409 }
          );
        }

        session.slots.push(parsed.data);
        await session.save({ session: mongoSession });

        await session.populate('slots.studentId', 'name admissionNo rollNo');
        result = session.slots[session.slots.length - 1];
      });
    } finally {
      await mongoSession.endSession();
    }

    // Notify the teacher about the new slot booking (fire-and-forget)
    try {
      const ptmDoc = await PTMSession.findById(req.params.id).select('staffId title').lean();
      if (ptmDoc?.staffId) {
        const studentName = result?.studentId?.name || parsed.data.parentName;
        sendNotification(
          ptmDoc.staffId,
          'Staff',
          'ptm',
          'New PTM Slot Booked',
          `${studentName} has booked a PTM slot at ${parsed.data.scheduledTime} for "${ptmDoc.title}".`,
          { schoolId: req.user?.schoolId, relatedId: ptmDoc._id, relatedType: 'PTMSession' }
        ).catch((err) =>
          console.error('[PTM] Notification error (teacher slot booked):', err.message)
        );
      }
    } catch (notifErr) {
      console.error('[PTM] Failed to send slot booking notification:', notifErr.message);
    }

    res.status(201).json({ success: true, data: result });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    console.error('POST /ptm/:id/slots error:', error);
    res.status(500).json({ success: false, message: 'Failed to add slot', error: error.message });
  }
});

/**
 * PUT /api/ptm/:sessionId/slots/:slotId
 * Update a slot (status, notes, scheduledTime)
 *
 * When scheduledTime is changed, uses a MongoDB transaction to make the
 * conflict check and update atomic — preventing the race condition where
 * two concurrent reschedules both pass the overlap check.
 */
router.put('/:sessionId/slots/:slotId', checkPermission('ptm', 'edit'), async (req, res) => {
  try {
    const parsed = updateSlotSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ success: false, message: 'Validation failed', errors: parsed.error.errors });
    }

    // If scheduledTime is NOT being changed, no conflict check needed — do a simple update
    if (!parsed.data.scheduledTime) {
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
      return res.json({ success: true, data: updatedSlot });
    }

    // scheduledTime IS being changed — use a transaction to make
    // the conflict check and update atomic
    const mongoSession = await mongoose.startSession();
    let updatedSlot;
    try {
      await mongoSession.withTransaction(async () => {
        const session = await PTMSession.findOne(
          scopeBySchool(req.user?.schoolId, {
            _id: req.params.sessionId,
            isDeleted: { $ne: true },
          })
        ).session(mongoSession);

        if (!session || !session.slots.id(req.params.slotId)) {
          throw Object.assign(new Error('Session or slot not found'), { statusCode: 404 });
        }

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
          throw Object.assign(
            new Error(
              `Time slot overlaps with existing booking at ${timeConflict.scheduledTime} (${session.slotDuration} min slots)`
            ),
            { statusCode: 409 }
          );
        }

        // Apply all updates to the slot
        const slot = session.slots.id(req.params.slotId);
        for (const [key, val] of Object.entries(parsed.data)) {
          slot[key] = val;
        }
        await session.save({ session: mongoSession });

        await session.populate('slots.studentId', 'name admissionNo rollNo');
        updatedSlot = session.slots.id(req.params.slotId);
      });
    } finally {
      await mongoSession.endSession();
    }

    res.json({ success: true, data: updatedSlot });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    console.error('PUT /ptm/:sessionId/slots/:slotId error:', error);
    res
      .status(500)
      .json({ success: false, message: 'Failed to update slot', error: error.message });
  }
});

/**
 * DELETE /api/ptm/:sessionId/slots/:slotId
 * Cancel a slot
 */
router.delete('/:sessionId/slots/:slotId', checkPermission('ptm', 'delete'), async (req, res) => {
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
});

export default router;
