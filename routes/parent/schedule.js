import express from 'express';
import mongoose from 'mongoose';
import { Student } from '../../database.js';
import { validateParentChildAccess } from '../../middleware/parentAuth.js';
import PTMSession from '../../models/PTMSession.js';
import { extractSchoolId } from '../../utils/schoolContext.js';
import { scopeBySchool, resolveRequestSchoolId } from './helpers.js';

const router = express.Router();

// Normalize :studentId is already the correct param name for timetable route
// Normalize :id → req.params.studentId for validateParentChildAccess (not used in this router)

// GET /api/parent/announcements
router.get('/announcements', async (req, res) => {
  try {
    const parent = req.parent;
    const { limit = 20, skip = 0 } = req.query;
    const limitNum = parseInt(limit);
    const skipNum = parseInt(skip);

    const studentIds = parent.children.map((child) => child.studentId);

    const students = await Student.find({
      _id: { $in: studentIds },
      schoolId: extractSchoolId(req.parent?.schoolId),
    })
      .select('classId')
      .lean();

    const classIds = students.map((s) => s.classId).filter(Boolean);

    const { Announcement } = await import('../../database.js');

    const schoolId = extractSchoolId(req.parent?.schoolId);
    const announcementsQuery = {
      $or: [{ targetClasses: { $in: classIds } }, { targetType: 'all' }, { targetType: 'parents' }],
      status: 'published',
      publishedAt: { $lte: new Date() },
      ...(schoolId && { schoolId }),
    };
    const total = await Announcement.countDocuments(announcementsQuery);
    const announcements = await Announcement.find(announcementsQuery)
      .sort({ publishedAt: -1 })
      .skip(skipNum)
      .limit(limitNum)
      .lean();

    const announcementsHasMore = skipNum + announcements.length < total;
    res.json({
      success: true,
      data: {
        announcements,
        hasMore: announcementsHasMore,
        nextCursor: announcementsHasMore ? String(skipNum + limitNum) : undefined,
        total,
      },
    });
  } catch (error) {
    console.error('Get announcements error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to fetch announcements' },
    });
  }
});

// GET /api/parent/timetable/:studentId
router.get('/timetable/:studentId', validateParentChildAccess, async (req, res) => {
  try {
    const { studentId } = req.params;

    const student = await Student.findById(studentId)
      .select('name classId')
      .populate('classId', 'name section academicYear');

    if (!student || !student.classId) {
      return res.status(404).json({
        success: false,
        error: { code: 'CLASS_NOT_FOUND', message: 'Student class not found' },
      });
    }

    const { Timetable } = await import('../../database.js');

    const timetableDoc = await Timetable.findOne(
      scopeBySchool(req.parent?.schoolId, {
        classId: student.classId._id,
        academicYear: student.classId.academicYear,
      })
    )
      .select('periods schedule -_id')
      .populate(
        'schedule.Monday.teacherId schedule.Tuesday.teacherId schedule.Wednesday.teacherId schedule.Thursday.teacherId schedule.Friday.teacherId schedule.Saturday.teacherId',
        'name'
      )
      .lean();

    if (!timetableDoc) {
      return res.status(404).json({
        success: false,
        error: { code: 'TIMETABLE_NOT_FOUND', message: 'Timetable not found for this class' },
      });
    }

    // Transform to array-of-days format expected by parent app
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const periods = timetableDoc.periods || [];
    const timetable = dayNames.map((day) => {
      const daySlots = timetableDoc.schedule?.[day] || [];
      return {
        day,
        periods: periods.map((period, idx) => {
          const slot = daySlots[idx] || {};
          return {
            time: `${period.startTime || ''}-${period.endTime || ''}`,
            subject: period.isBreak ? null : slot.subject || null,
            teacher: slot.teacherId?.name || null,
          };
        }),
      };
    });

    res.json({
      success: true,
      data: { studentId, studentName: student.name, class: student.classId, timetable },
    });
  } catch (error) {
    console.error('Get timetable error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to fetch timetable' },
    });
  }
});

// GET /api/parent/ptm
router.get('/ptm', async (req, res) => {
  try {
    const parent = req.parent;
    if (!parent.children?.length) {
      return res.json({ success: true, data: [] });
    }

    const schoolId = await resolveRequestSchoolId(req);

    const studentIds = parent.children.map((c) => c.studentId).filter(Boolean);
    const students = await Student.find({ _id: { $in: studentIds } })
      .select('classId')
      .lean();
    const classIds = [...new Set(students.map((s) => s.classId?.toString()).filter(Boolean))];

    if (!classIds.length) {
      return res.json({ success: true, data: [] });
    }

    const { from, to, status } = req.query;
    const query = { schoolId, classId: { $in: classIds }, isDeleted: { $ne: true } };
    if (status) query.status = status;
    if (from || to) {
      query.sessionDate = {};
      if (from) query.sessionDate.$gte = new Date(from);
      if (to) query.sessionDate.$lte = new Date(to);
    }

    const sessions = await PTMSession.find(query)
      .sort({ sessionDate: 1 })
      .populate('classId', 'name section')
      .populate('staffId', 'name role')
      .lean();

    const enriched = sessions.map((session) => {
      const mySlots = session.slots.filter((slot) =>
        studentIds.some((id) => id.toString() === slot.studentId?.toString())
      );
      return { ...session, mySlots };
    });

    res.json({ success: true, data: enriched });
  } catch (error) {
    console.error('GET /parent/ptm error:', error);
    res
      .status(500)
      .json({ success: false, message: 'Failed to fetch PTM sessions', error: error.message });
  }
});

// POST /api/parent/ptm/:sessionId/book
router.post('/ptm/:sessionId/book', async (req, res) => {
  try {
    const { z } = await import('zod');
    const bookSchema = z.object({
      studentId: z.string().length(24, 'Invalid studentId'),
      scheduledTime: z.string().regex(/^\d{2}:\d{2}$/, 'scheduledTime must be HH:MM'),
      notes: z.string().max(500).optional().default(''),
    });

    const parsed = bookSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ success: false, message: 'Validation failed', errors: parsed.error.errors });
    }

    const parent = req.parent;
    const { studentId, scheduledTime, notes } = parsed.data;

    const isMyChild = parent.children?.some((c) => c.studentId?.toString() === studentId);
    if (!isMyChild) {
      return res
        .status(403)
        .json({ success: false, message: 'Access denied: student not linked to this parent' });
    }

    const schoolId = await resolveRequestSchoolId(req);
    const session = await PTMSession.findOne({
      _id: req.params.sessionId,
      schoolId,
      isDeleted: { $ne: true },
    });
    if (!session) return res.status(404).json({ success: false, message: 'PTM session not found' });

    if (session.status === 'cancelled' || session.status === 'completed') {
      return res
        .status(400)
        .json({ success: false, message: `Cannot book a slot for a ${session.status} session` });
    }

    const timeConflict = session.slots.some(
      (s) => s.scheduledTime === scheduledTime && s.status !== 'cancelled'
    );
    if (timeConflict) {
      return res
        .status(409)
        .json({ success: false, message: `Slot at ${scheduledTime} is already booked` });
    }

    const studentSlot = session.slots.find(
      (s) => s.studentId?.toString() === studentId && s.status !== 'cancelled'
    );
    if (studentSlot) {
      return res
        .status(409)
        .json({ success: false, message: 'A slot is already booked for this student' });
    }

    const student = await Student.findById(studentId).select('name').lean();
    const parentName = parent.name || 'Parent';

    session.slots.push({ studentId, parentName, scheduledTime, notes, status: 'booked' });
    await session.save();

    const newSlot = session.slots[session.slots.length - 1];
    res
      .status(201)
      .json({ success: true, data: { ...newSlot.toObject(), studentName: student?.name } });
  } catch (error) {
    console.error('POST /parent/ptm/:sessionId/book error:', error);
    res
      .status(500)
      .json({ success: false, message: 'Failed to book PTM slot', error: error.message });
  }
});

// DELETE /api/parent/ptm/:sessionId/slots/:slotId
router.delete('/ptm/:sessionId/slots/:slotId', async (req, res) => {
  try {
    const parent = req.parent;
    const schoolId = await resolveRequestSchoolId(req);

    const session = await PTMSession.findOne({
      _id: req.params.sessionId,
      schoolId,
      isDeleted: { $ne: true },
    });
    if (!session) return res.status(404).json({ success: false, message: 'PTM session not found' });

    const slot = session.slots.id(req.params.slotId);
    if (!slot) return res.status(404).json({ success: false, message: 'Slot not found' });

    const isMyChild = parent.children?.some(
      (c) => c.studentId?.toString() === slot.studentId?.toString()
    );
    if (!isMyChild) {
      return res
        .status(403)
        .json({ success: false, message: 'Access denied: cannot cancel this slot' });
    }

    slot.status = 'cancelled';
    await session.save();

    res.json({ success: true, message: 'Slot cancelled successfully' });
  } catch (error) {
    console.error('DELETE /parent/ptm/:sessionId/slots/:slotId error:', error);
    res
      .status(500)
      .json({ success: false, message: 'Failed to cancel slot', error: error.message });
  }
});

// GET /api/parent/calendar/events
router.get('/calendar/events', async (req, res) => {
  try {
    const schoolId = await resolveRequestSchoolId(req);
    const { startDate, endDate } = req.query;

    const CalendarEvent = mongoose.models.CalendarEvent;
    if (!CalendarEvent) {
      return res.json({ success: true, data: [] });
    }

    const query = {
      schoolId,
      type: { $in: ['holiday', 'exam'] },
    };

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = startDate;
      if (endDate) query.date.$lte = endDate;
    }

    const events = await CalendarEvent.find(query).sort({ date: 1 });

    res.json({
      success: true,
      data: events.map((e) => ({
        id: e._id.toString(),
        title: e.title,
        date: e.date,
        type: e.type,
        allDay: e.allDay,
        startTime: e.startTime || '',
        endTime: e.endTime || '',
        description: e.description || '',
        holidayType: e.holidayType || null,
      })),
    });
  } catch (error) {
    console.error('GET /parent/calendar/events error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch calendar events' });
  }
});

export default router;
