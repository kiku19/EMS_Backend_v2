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

// ─── REGULARIZE ATTENDANCE ─────────────────────────────────────
export const regularizeAttendanceSchema = z
  .object({
    date: dateString,
    status: staffAttendanceStatusEnum,
    checkInTime: z.string().max(20).optional(),
    checkOutTime: z.string().max(20).optional(),
    reason: optionalString(500),
  })
  .strip();

// ─── MOBILE ATTENDANCE MARK ───────────────────────────────────
export const mobileAttendanceMarkSchema = z
  .object({
    status: z.enum(['present', 'absent', 'leave', 'halfday'], {
      errorMap: () => ({ message: 'Status must be present, absent, leave, or halfday' }),
    }),
    reason: optionalString(500),
    location: z
      .object({
        latitude: z.number().optional(),
        longitude: z.number().optional(),
      })
      .optional(),
  })
  .strip();

// ─── MOBILE LEAVE APPLICATION ──────────────────────────────────
export const mobileLeaveApplySchema = z
  .object({
    leaveType: z.enum(['casual', 'sick', 'earned', 'maternity', 'paternity', 'unpaid', 'other'], {
      errorMap: () => ({ message: 'Leave type must be casual, sick, earned, maternity, paternity, unpaid, or other' }),
    }),
    startDate: dateString,
    endDate: dateString,
    reason: optionalString(500),
  })
  .strip();

// ─── LEAVE APPROVAL/REJECTION ──────────────────────────────────
export const leaveApprovalSchema = z
  .object({
    approvalStatus: z.enum(['approved', 'rejected'], {
      errorMap: () => ({ message: 'Approval status must be approved or rejected' }),
    }),
    rejectionReason: optionalString(500),
  })
  .strip();
