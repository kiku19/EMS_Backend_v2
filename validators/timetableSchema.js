import { z } from 'zod';
import { objectId } from './zodHelpers.js';

// --- Period schema ---
const periodSchema = z
  .object({
    _id: objectId.optional(),
    name: z.string().min(1, 'Period name is required').max(50),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Start time must be HH:MM format'),
    endTime: z.string().regex(/^\d{2}:\d{2}$/, 'End time must be HH:MM format'),
    isBreak: z.boolean().optional().default(false),
  })
  .strip()
  .refine((period) => period.startTime < period.endTime, {
    message: 'Period startTime must be before endTime',
    path: ['endTime'],
  });

// --- Slot schema (one class period) ---
const slotSchema = z
  .object({
    subject: z.string().max(100).optional(),
    teacherId: objectId.optional().nullable(),
    room: z.string().max(50).optional(),
  })
  .strip();

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Build schedule object: { Monday: slotSchema[], ... }
const scheduleShape = {};
for (const day of DAYS) {
  scheduleShape[day] = z.array(slotSchema).optional().default([]);
}
const scheduleSchema = z.object(scheduleShape).strip();

// --- Update periods ---
export const updatePeriodsSchema = z
  .object({
    periods: z.array(periodSchema).min(1, 'At least one period is required').max(15),
    academicYear: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional(),
  })
  .strip()
  .refine(
    (data) => {
      // Validate no time overlaps between non-break periods
      const nonBreak = data.periods.filter((p) => !p.isBreak);
      for (let i = 0; i < nonBreak.length; i++) {
        for (let j = i + 1; j < nonBreak.length; j++) {
          if (
            nonBreak[i].startTime < nonBreak[j].endTime &&
            nonBreak[j].startTime < nonBreak[i].endTime
          ) {
            return false;
          }
        }
      }
      return true;
    },
    { message: 'Period times must not overlap' }
  );

// --- Update schedule (single day or full week) ---
export const updateScheduleSchema = z
  .object({
    schedule: scheduleSchema,
  })
  .strip();

// --- Update single slot ---
export const updateSlotSchema = z
  .object({
    day: z.enum(DAYS),
    periodIndex: z.number().int().min(0).max(14),
    subject: z.string().max(100).optional(),
    teacherId: objectId.optional().nullable(),
    room: z.string().max(50).optional(),
  })
  .strip();

// --- Auto-generate request ---
export const autoGenerateSchema = z
  .object({
    classId: objectId,
    subjects: z
      .array(
        z
          .object({
            name: z.string().min(1),
            teacherId: objectId.optional(),
            periodsPerWeek: z.number().int().min(1).max(30),
          })
          .strip()
      )
      .min(1, 'At least one subject is required'),
    constraints: z
      .object({
        maxPeriodsPerDay: z.number().int().min(1).max(10).optional(),
        avoidConsecutiveSameSubject: z.boolean().optional(),
      })
      .strip()
      .optional(),
  })
  .strip();
