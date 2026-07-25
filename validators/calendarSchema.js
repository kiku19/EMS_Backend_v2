import { z } from 'zod';

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  }, 'Date must be a real calendar date');

const timeOrEmpty = z
  .union([z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM format'), z.literal('')])
  .refine((value) => {
    if (!value) return true;
    const [hours, minutes] = value.split(':').map(Number);
    return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
  }, 'Time must be a valid 24-hour time');

const academicYear = z
  .string()
  .regex(/^\d{4}-(?:\d{2}|\d{4})$/, 'Academic year must be YYYY-YY or YYYY-YYYY')
  .or(z.literal(''));

export const calendarRecurrenceSchema = z
  .object({
    freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
    interval: z.number().int().min(1).max(52).default(1),
    endDate: calendarDate.optional().nullable(),
    endCount: z.number().int().min(1).max(365).optional().nullable(),
  })
  .strip();

const calendarFields = {
  title: z.string().trim().min(1, 'Title is required').max(200),
  date: calendarDate,
  type: z.enum(['event', 'meeting', 'exam', 'holiday']),
  startTime: timeOrEmpty,
  endTime: timeOrEmpty,
  allDay: z.boolean(),
  description: z.string().max(1000),
  holidayType: z.enum(['National', 'Regional', 'School']).nullable(),
  recurrence: calendarRecurrenceSchema.nullable(),
  academicYear,
};

function validateEventRelationships(data, context) {
  if (!data.allDay && data.startTime && data.endTime && data.startTime >= data.endTime) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'startTime must be before endTime',
      path: ['endTime'],
    });
  }
  if (data.recurrence?.endDate && data.date && data.recurrence.endDate < data.date) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'recurrence endDate cannot be before the event date',
      path: ['recurrence', 'endDate'],
    });
  }
}

export const createCalendarEventSchema = z
  .object({
    ...calendarFields,
    type: calendarFields.type.default('event'),
    startTime: calendarFields.startTime.default(''),
    endTime: calendarFields.endTime.default(''),
    allDay: calendarFields.allDay.default(false),
    description: calendarFields.description.default(''),
    holidayType: calendarFields.holidayType.optional().default(null),
    recurrence: calendarFields.recurrence.optional().default(null),
    academicYear: calendarFields.academicYear.optional().default(''),
  })
  .strip()
  .superRefine(validateEventRelationships);

export const updateCalendarEventSchema = z
  .object({
    title: calendarFields.title.optional(),
    date: calendarFields.date.optional(),
    type: calendarFields.type.optional(),
    startTime: calendarFields.startTime.optional(),
    endTime: calendarFields.endTime.optional(),
    allDay: calendarFields.allDay.optional(),
    description: calendarFields.description.optional(),
    holidayType: calendarFields.holidayType.optional(),
    recurrence: calendarFields.recurrence.optional(),
    academicYear: calendarFields.academicYear.optional(),
  })
  .strip()
  .refine((data) => Object.keys(data).length > 0, 'At least one field must be provided')
  .superRefine(validateEventRelationships);

export const calendarEventsQuerySchema = z
  .object({
    startDate: calendarDate.optional(),
    endDate: calendarDate.optional(),
    academicYear: academicYear.optional(),
  })
  .strip()
  .refine((data) => Boolean(data.startDate) === Boolean(data.endDate), {
    message: 'startDate and endDate must be provided together',
    path: ['endDate'],
  })
  .refine((data) => !data.startDate || data.startDate <= data.endDate, {
    message: 'startDate must be on or before endDate',
    path: ['endDate'],
  });

export const calendarEventParamsSchema = z
  .object({
    id: z
      .string()
      .regex(
        /^[0-9a-fA-F]{24}(?:_\d{4}-\d{2}-\d{2})?$/,
        'Event ID must be a master ID or recurring occurrence ID'
      ),
  })
  .strip();

export const calendarEventOperationQuerySchema = z
  .object({
    scope: z.enum(['series', 'occurrence']).optional(),
    occurrenceDate: calendarDate.optional(),
  })
  .strip();
