import { z } from 'zod';
import { objectId, dateString, optionalString } from './zodHelpers.js';

const attendanceStatusEnum = z.enum(['present', 'absent', 'late', 'leave', 'halfday']);

const attendanceRecordSchema = z.object({
  studentId: objectId,
  status: attendanceStatusEnum,
});

export const bulkAttendanceSchema = z.object({
  classId: objectId,
  date: dateString,
  attendance: z.array(attendanceRecordSchema).min(1, 'At least one attendance record is required'),
  clientTimestamp: z.string().datetime({ offset: true }).optional(),
});

export const singleAttendanceSchema = z.object({
  studentId: objectId,
  classId: objectId,
  date: dateString,
  status: attendanceStatusEnum,
  clientTimestamp: z.string().datetime({ offset: true }).optional(),
});

// ─── REGULARIZE STUDENT ATTENDANCE (bulk per-student) ─────────────
// Used by the dashboard's "Regularize Attendance" drawer on the student
// profile. Drawer sends one request per student with N selected dates,
// flipping each from absent → present (or another valid status) with a
// reason. Mirrors the staff regularize contract in staffAttendanceSchema.js
// but accepts an array because the drawer batches multiple days at once.
const regularizeStudentUpdateSchema = z.object({
  date: dateString,
  status: attendanceStatusEnum,
  reason: optionalString(500),
});

export const regularizeStudentAttendanceSchema = z
  .object({
    updates: z.array(regularizeStudentUpdateSchema).min(1, 'At least one update is required'),
  })
  .strip();
