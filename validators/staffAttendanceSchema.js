import { z } from 'zod';
import { objectId, dateString, optionalString } from './zodHelpers.js';

const staffAttendanceStatusEnum = z.enum(['present', 'absent', 'leave', 'halfday', 'unmarked'], {
  errorMap: () => ({ message: 'Status must be present, absent, leave, halfday, or unmarked' }),
});

// ─── SINGLE STAFF ATTENDANCE (admin/manual) ─────────────────────
export const singleStaffAttendanceSchema = z
  .object({
    staffId: objectId,
    date: dateString,
    status: staffAttendanceStatusEnum,
    checkInTime: z.string().max(20).optional(),
    checkOutTime: z.string().max(20).optional(),
    reason: optionalString(500),
  })
  .strip();

// ─── BULK STAFF ATTENDANCE ──────────────────────────────────────
export const bulkStaffAttendanceSchema = z
  .object({
    date: dateString,
    staffIds: z.array(objectId).min(1, 'At least one staffId is required'),
    status: staffAttendanceStatusEnum,
    reason: optionalString(500),
    checkInTime: z.string().max(20).optional(),
    checkOutTime: z.string().max(20).optional(),
  })
  .strip();
