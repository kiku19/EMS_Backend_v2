import express from 'express';
import TeacherLeave from '../models/TeacherLeave.js';
import Staff from '../models/Staff.js';
import { SchoolSettings } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { extractSchoolId } from '../utils/schoolContext.js';
import { EVENTS, emitEvent } from '../utils/socketEvents.js';
import { checkPermission } from '../middleware/permissions.js';
import { applyLeaveSchema, updateLeaveStatusSchema } from '../validators/leaveSchema.js';
import { DEFAULT_WORKING_DAY_CODES, DAY_CODE_TO_INDEX } from '../utils/weekdays.js';
// P8: best-effort LOP recompute trigger. payroll.js does NOT import this file,
// so a static import is safe (no circular dependency).
import { recomputeLOPForStaff } from './payroll.js';

const router = express.Router();
router.use(authenticate);

// P8: Fire-and-forget LOP recompute after a leave approval/cancellation
// mutates a month that already has a generated (unpaid) PayrollRecord. If the
// leave spans multiple months, every month in [start, end] is recomputed so a
// multi-month unpaid leave is reflected on each period's record. Never throws
// to the caller; a payroll failure must not break the leave operation.
// recomputeLOPForStaff itself skips paid/locked records, so this is safe to
// call optimistically.
function triggerLOPRecomputeForLeave(employeeId, startDate, endDate, schoolId, performedBy) {
  if (!employeeId || !startDate || !schoolId) return;
  try {
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : start;
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
    // Clamp end to start in case of malformed input.
    const lo = start <= end ? start : end;
    const hi = start <= end ? end : start;

    // Iterate over each calendar month from lo to hi (inclusive).
    let cursor = new Date(Date.UTC(lo.getUTCFullYear(), lo.getUTCMonth(), 1));
    const stop = new Date(Date.UTC(hi.getUTCFullYear(), hi.getUTCMonth(), 1));
    // Guard against an absurd range (e.g. bad data) producing a huge loop.
    let safety = 0;
    while (cursor <= stop && safety < 24) {
      const month = cursor.getUTCMonth() + 1;
      const year = cursor.getUTCFullYear();
      recomputeLOPForStaff(employeeId, month, year, { schoolId, performedBy }).catch((err) =>
        console.error('[TeacherLeaves] LOP recompute failed:', err)
      );
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
      safety += 1;
    }
  } catch (err) {
    console.error('[TeacherLeaves] LOP recompute threw synchronously:', err);
  }
}

// Fix 5.6: Helper to scope all queries by schoolId for multi-tenancy isolation
function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) {
    throw new Error('schoolId is required for scoped queries');
  }
  return { ...query, schoolId: normalizedSchoolId };
}

/**
 * ST6: count the WORKING days in [startDate, endDate] using the school's
 * configured working days and holiday calendar. The previous calc used naive
 * UTC date math (`(end-start)/day + 1`) which counted weekends and holidays as
 * leave days. Dates are parsed in LOCAL time (`new Date(date + 'T00:00:00')`)
 * so the day-of-week is stable regardless of server timezone. Falls back to
 * Mon–Sat when no SchoolSettings row exists.
 */
async function countWorkingLeaveDays(startDateStr, endDateStr, schoolId) {
  const start = new Date(`${startDateStr}T00:00:00`);
  const end = new Date(`${endDateStr}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return null; // let the caller fall back to the client-supplied/naive value
  }

  let workingDayCodes = DEFAULT_WORKING_DAY_CODES;
  const holidayDates = new Set();
  let secondFourthSaturdayOff = false;
  try {
    const settings = await SchoolSettings.findOne(scopeBySchool(schoolId, {})).lean();
    if (settings) {
      if (Array.isArray(settings.workingDays) && settings.workingDays.length > 0) {
        workingDayCodes = settings.workingDays;
      }
      secondFourthSaturdayOff = !!settings.secondFourthSaturdayOff;
      for (const h of settings.holidays || []) {
        if (h?.date) holidayDates.add(String(h.date));
      }
    }
  } catch {
    // No settings → assume Mon–Sat with no holidays.
  }

  const workingDayIndexes = new Set(
    workingDayCodes.map((code) => DAY_CODE_TO_INDEX[code]).filter((v) => v !== undefined)
  );

  let count = 0;
  const cursor = new Date(start);
  // Track which Saturdays in the current month have been seen, to support the
  // CBSE-style 2nd/4th-Saturday-off rule.
  let trackedYear = -1;
  let trackedMonth = -1;
  let saturdayOrdinal = 0;
  for (cursor.setTime(start.getTime()); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const yyyymmdd = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
    if (holidayDates.has(yyyymmdd)) continue;

    if (cursor.getMonth() !== trackedMonth || cursor.getFullYear() !== trackedYear) {
      trackedYear = cursor.getFullYear();
      trackedMonth = cursor.getMonth();
      saturdayOrdinal = 0;
    }

    const dow = cursor.getDay(); // 0=Sun..6=Sat
    if (!workingDayIndexes.has(dow)) continue;

    if (dow === 6 && secondFourthSaturdayOff) {
      // 1-indexed ordinal of this Saturday within its month.
      saturdayOrdinal += 1;
      if (saturdayOrdinal === 2 || saturdayOrdinal === 4) continue;
    }

    count += 1;
  }

  return count > 0 ? count : 1; // a leave always spans at least one working day
}

/**
 * ST4: set Staff.status. If an approved/cancelled/rejected leave no longer
 * covers today, restore the staff to 'active' (only when they are currently
 * marked 'on-leave', so we never clobber a deliberate 'suspended'/'terminated').
 */
function dateRangeCoversToday(leave) {
  if (!leave?.startDate || !leave?.endDate) return false;
  const now = new Date();
  const start = new Date(leave.startDate);
  const end = new Date(leave.endDate);
  end.setHours(23, 59, 59, 999);
  return now >= start && now <= end;
}

// Get all leaves for a teacher
router.get('/teacher/:teacherId', async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { status, year, skip: skipStr, limit: limitStr } = req.query;

    // Non-admins can only view their own leaves
    const isAdmin =
      req.user.role === 'admin' ||
      (Array.isArray(req.user.role) &&
        req.user.role.some((r) => ['admin', 'Admin', 'Principal', 'principal'].includes(r)));
    if (!isAdmin && req.user.id.toString() !== teacherId) {
      return res.status(403).json({ error: "Not authorized to view another teacher's leaves" });
    }

    const query = scopeBySchool(req.user.schoolId, { teacherId });
    if (status) query.status = status;
    if (year) {
      query.startDate = {
        $gte: new Date(`${year}-01-01`),
        $lte: new Date(`${year}-12-31`),
      };
    }

    const skip = parseInt(skipStr) || 0;
    const limit = Math.min(parseInt(limitStr) || 20, 100);

    const leaves = await TeacherLeave.find(query)
      .populate('approvedBy', 'name')
      .sort({ appliedAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json(leaves);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all pending leaves (for admin)
router.get('/pending', checkPermission('staff', 'view'), async (req, res) => {
  try {
    const leaves = await TeacherLeave.find(scopeBySchool(req.user.schoolId, { status: 'pending' }))
      .populate('teacherId', 'name code email phone')
      .sort({ appliedAt: -1 });

    res.json(leaves);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get leave by ID
router.get('/:id', async (req, res) => {
  try {
    const leave = await TeacherLeave.findOne(
      scopeBySchool(req.user.schoolId, { _id: req.params.id })
    )
      .populate('teacherId', 'name code email phone')
      .populate('approvedBy', 'name')
      .populate('substitutions.substituteTeacherId', 'name');

    if (!leave) {
      return res.status(404).json({ error: 'Leave not found' });
    }

    res.json(leave);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Apply for leave (teacher)
router.post('/', async (req, res) => {
  try {
    const parsed = applyLeaveSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const { leaveType, reason, startDate, endDate, days, attachments } = parsed.data;
    // Always use authenticated user's ID — never trust client-supplied teacherId
    const teacherId = req.user.id;

    // ST6: calculate days if not provided. Reuse the school's working-day /
    // holiday configuration (SchoolSettings) instead of naive UTC date math,
    // which previously counted weekends and holidays as leave days. Dates are
    // parsed in local time so the weekday is timezone-stable.
    let calculatedDays = days;
    if (!calculatedDays) {
      const workingDays = await countWorkingLeaveDays(
        startDate,
        endDate,
        extractSchoolId(req.user.schoolId)
      );
      if (workingDays) {
        calculatedDays = workingDays;
      } else {
        const start = new Date(`${startDate}T00:00:00`);
        const end = new Date(`${endDate}T00:00:00`);
        calculatedDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
      }
    }

    const schoolId = extractSchoolId(req.user.schoolId);
    const leave = new TeacherLeave({
      schoolId,
      teacherId,
      leaveType,
      reason,
      startDate,
      endDate,
      days: calculatedDays,
      attachments: attachments || [],
    });

    await leave.save();

    // Emit socket event for real-time notification
    const io = req.app.get('io');
    emitEvent(io, EVENTS.LEAVE_APPLIED, {
      schoolId,
      leaveId: leave._id.toString(),
      teacherId: teacherId?.toString(),
      leaveType,
      startDate,
      endDate,
      days: calculatedDays,
    });

    const populatedLeave = await TeacherLeave.findById(leave._id).populate(
      'teacherId',
      'name code'
    );

    res.status(201).json(populatedLeave);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Approve/Reject leave (admin)
router.put('/:id/status', async (req, res) => {
  try {
    // Only admins and principals can approve/reject
    const userRole = req.user.role;
    const isAdmin =
      userRole === 'admin' ||
      (Array.isArray(userRole) &&
        userRole.some((r) => ['admin', 'Admin', 'Principal', 'principal'].includes(r)));
    if (!isAdmin) {
      return res
        .status(403)
        .json({ error: 'Only admins or principals can approve or reject leave requests' });
    }

    const parsed = updateLeaveStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const { status, rejectionReason, substitutions } = parsed.data;

    const updateData = {
      status,
      approvedBy: req.user.id,
      approvedAt: new Date(),
    };

    if (status === 'rejected' && rejectionReason) {
      updateData.rejectionReason = rejectionReason;
    }

    if (substitutions) {
      updateData.substitutions = substitutions;
    }

    const leave = await TeacherLeave.findOneAndUpdate(
      scopeBySchool(req.user.schoolId, { _id: req.params.id }),
      updateData,
      { new: true }
    )
      .populate('teacherId', 'name code email')
      .populate('approvedBy', 'name');

    if (!leave) {
      return res.status(404).json({ error: 'Leave not found' });
    }

    // P8: an approval changes unpaid-leave (LOP) exposure, so best-effort
    // recompute the affected month(s) of any generated PayrollRecord.
    if (status === 'approved') {
      const teacherIdForPayroll = leave.teacherId?._id || leave.teacherId;
      triggerLOPRecomputeForLeave(
        teacherIdForPayroll,
        leave.startDate,
        leave.endDate,
        req.user?.schoolId,
        req.user?._id || req.user?.id
      );
    }

    // ST4: keep Staff.status in sync with approved leave. Only flip to
    // 'on-leave' when the approved range covers today; on rejection, restore an
    // 'on-leave' teacher back to 'active' (never override suspended/terminated).
    try {
      const teacherId = leave.teacherId?._id || leave.teacherId;
      if (status === 'approved' && dateRangeCoversToday(leave)) {
        await Staff.updateOne(scopeBySchool(req.user.schoolId, { _id: teacherId }), {
          $set: { status: 'on-leave' },
        });
      } else if (status === 'rejected') {
        await Staff.updateOne(
          scopeBySchool(req.user.schoolId, { _id: teacherId, status: 'on-leave' }),
          { $set: { status: 'active' } }
        );
      }
    } catch (staffErr) {
      console.error('Failed to sync Staff status with leave approval:', staffErr);
    }

    // Emit socket event
    const io = req.app.get('io');
    emitEvent(io, EVENTS.LEAVE_STATUS_UPDATED, {
      schoolId: req.user.schoolId?.toString(),
      leaveId: leave._id.toString(),
      teacherId: leave.teacherId._id.toString(),
      status,
    });

    // Send push notification to teacher
    try {
      const { default: pushNotificationService } =
        await import('../services/pushNotificationService.js');

      await pushNotificationService.sendToUser(
        leave.teacherId.toString(),
        status === 'approved' ? 'Leave Approved' : 'Leave Update',
        status === 'approved'
          ? `Your leave request has been approved`
          : `Your leave request has been ${status}: ${rejectionReason || ''}`,
        {
          type: 'leave',
          leaveId: leave._id,
          status,
        }
      );
    } catch (error) {
      console.error('Error sending push notification:', error);
    }

    res.json(leave);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cancel leave (teacher - can only cancel own leave, or admin can cancel any)
router.put('/:id/cancel', async (req, res) => {
  try {
    const leave = await TeacherLeave.findOne(
      scopeBySchool(req.user.schoolId, { _id: req.params.id })
    ).populate('teacherId', 'name');

    if (!leave) {
      return res.status(404).json({ error: 'Leave not found' });
    }

    // Authorization: only the leave owner or an admin can cancel
    const isOwner = leave.teacherId._id.toString() === req.user.id.toString();
    const isAdmin =
      req.user.role === 'admin' ||
      (Array.isArray(req.user.role) &&
        req.user.role.some((r) => ['Admin', 'Principal'].includes(r)));
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Not authorized to cancel this leave' });
    }

    // Only allow cancellation if leave is pending or approved
    if (!['pending', 'approved'].includes(leave.status)) {
      return res.status(400).json({
        error: `Cannot cancel a leave that is already '${leave.status}'`,
      });
    }

    leave.status = 'cancelled';
    leave.updatedAt = new Date();
    await leave.save();

    // ST4: a cancellation ends the leave — restore an 'on-leave' teacher to
    // 'active'. Scoped by status so a deliberately suspended/terminated account
    // is never reactivated here.
    try {
      await Staff.updateOne(
        scopeBySchool(req.user.schoolId, {
          _id: leave.teacherId._id,
          status: 'on-leave',
        }),
        { $set: { status: 'active' } }
      );
    } catch (staffErr) {
      console.error('Failed to restore Staff status on leave cancellation:', staffErr);
    }

    // P8: cancelling an approved leave removes its unpaid-leave (LOP)
    // contribution, so best-effort recompute the affected month(s) of any
    // generated PayrollRecord.
    triggerLOPRecomputeForLeave(
      leave.teacherId._id,
      leave.startDate,
      leave.endDate,
      req.user?.schoolId,
      req.user?._id || req.user?.id
    );

    // Emit socket event
    const io = req.app.get('io');
    emitEvent(io, EVENTS.LEAVE_CANCELLED, {
      schoolId: req.user.schoolId?.toString(),
      leaveId: leave._id.toString(),
      teacherId: leave.teacherId._id.toString(),
    });

    res.json(leave);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get leave statistics for a teacher
router.get('/teacher/:teacherId/stats', async (req, res) => {
  try {
    const { teacherId } = req.params;
    const year = parseInt(req.query.year) || new Date().getFullYear();

    // Non-admins can only view their own stats
    const isAdmin =
      req.user.role === 'admin' ||
      (Array.isArray(req.user.role) &&
        req.user.role.some((r) => ['admin', 'Admin', 'Principal', 'principal'].includes(r)));
    if (!isAdmin && req.user.id.toString() !== teacherId) {
      return res
        .status(403)
        .json({ error: "Not authorized to view another teacher's leave statistics" });
    }

    const startDate = new Date(`${year}-01-01`);
    const endDate = new Date(`${year}-12-31`);

    // ST5: overlap query. The previous `startDate: { $gte, $lte }` filter
    // dropped any leave whose start fell outside the window — e.g. a Dec 20 →
    // Jan 5 leave was invisible to a January-year stats lookup even though half
    // of it sat inside the year. Match any leave whose [start,end] range
    // intersects [yearStart, yearEnd].
    const leaves = await TeacherLeave.find(
      scopeBySchool(req.user.schoolId, {
        teacherId,
        startDate: { $lte: endDate },
        endDate: { $gte: startDate },
      })
    );

    // Dynamically aggregate approved days by leave type name (matches HR settings enum values)
    const byType = {};
    leaves
      .filter((l) => l.status === 'approved')
      .forEach((l) => {
        if (l.leaveType) {
          byType[l.leaveType] = (byType[l.leaveType] || 0) + l.days;
        }
      });

    const stats = {
      total: leaves.length,
      approved: leaves.filter((l) => l.status === 'approved').length,
      pending: leaves.filter((l) => l.status === 'pending').length,
      rejected: leaves.filter((l) => l.status === 'rejected').length,
      cancelled: leaves.filter((l) => l.status === 'cancelled').length,
      byType,
      totalDays: leaves.filter((l) => l.status === 'approved').reduce((sum, l) => sum + l.days, 0),
    };

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
