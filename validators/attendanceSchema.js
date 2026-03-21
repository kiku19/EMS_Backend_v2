import { z } from 'zod';
import { objectId, dateString } from './zodHelpers.js';

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
