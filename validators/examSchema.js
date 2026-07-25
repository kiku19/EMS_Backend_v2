import { z } from 'zod';
import { objectId, optionalObjectId, academicYear, optionalString } from './zodHelpers.js';

const timeString = z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format');

// Subject entry within an Exam (mirrors Mongoose subdocument)
const examSubjectSchema = z.object({
  subjectId: optionalObjectId,
  subjectName: z.string().max(100).optional(),
  date: z.coerce.date().optional(),
  startTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format')
    .optional(),
  endTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format')
    .optional(),
  maxMarks: z.number().min(1).max(1000).default(100),
  passingMarks: z.number().min(0).max(1000).default(35),
});

const examTypeEnum = z
  .enum([
    'unit_test',
    'quiz',
    'midterm',
    'final',
    'quarterly',
    'half_yearly',
    'annual',
    'practice',
    'class_test',
    'assignment',
    // Staff-app exam categories (CreateExamScreen segmented control). The
    // staff-app sends these as `examType`; the route handler maps examType →
    // type. Kept in sync with models/Exam.js enum.
    'written',
    'practical',
    'oral',
  ])
  .nullish()
  .or(z.literal(''));
const gradingTypeEnum = z.enum(['numerical', 'grades', 'cgpa']);
const termEnum = z.enum(['term_1', 'term_2', 'term_3', 'final']).nullish().or(z.literal(''));

// ─── Helpers ─────────────────────────────────────────────────────
// startOfToday returns midnight in the school's local timezone (default
// Asia/Kolkata) so exam creation from the dashboard doesn't bounce off
// "cannot be in the past" when the server clock runs UTC and the user
// is 5:30h ahead.
const startOfToday = () => {
  const now = new Date();
  const tz = process.env.DEFAULT_SCHOOL_TIMEZONE || 'Asia/Kolkata';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  // Construct a Date at local-midnight of the school's timezone as seen
  // from UTC. Since z.coerce.date parses incoming strings as UTC, we
  // compare against the UTC-equivalent of local midnight and subtract a
  // small fudge (12h) to be forgiving near the day boundary.
  const localMidnightUTC = new Date(`${get('year')}-${get('month')}-${get('day')}T00:00:00Z`);
  return new Date(localMidnightUTC.getTime() - 12 * 60 * 60 * 1000);
};

// ─── CREATE EXAM ─────────────────────────────────────────────────
export const createExamSchema = z
  .object({
    name: z
      .string()
      .min(2, 'Exam name must be at least 2 characters')
      .max(200, 'Exam name must not exceed 200 characters')
      .trim(),
    type: examTypeEnum,
    examType: optionalString(100), // legacy field from staff app
    classId: objectId,
    subjectId: optionalObjectId,
    subjectName: optionalString(100),
    academicYear: academicYear.nullish().or(z.literal('')),
    startDate: z.coerce
      .date({
        required_error: 'Start date is required',
        invalid_type_error: 'Start date must be a valid date',
      })
      .refine((d) => d >= startOfToday(), { message: 'Start date cannot be in the past' }),
    endDate: z.coerce
      .date({ invalid_type_error: 'End date must be a valid date' })
      .nullable()
      .optional(),
    maxMarks: z
      .number()
      .min(1, 'Maximum marks must be at least 1')
      .max(1000, 'Maximum marks cannot exceed 1000')
      .default(100),
    passingMarks: z.number().min(0, 'Passing marks cannot be negative').default(35),
    weightage: z
      .number()
      .min(0, 'Weightage cannot be negative')
      .max(100, 'Weightage cannot exceed 100')
      .default(10),
    gradingType: gradingTypeEnum.default('numerical'),
    instructions: optionalString(2000),
    createdBy: optionalObjectId,
    status: z.enum(['scheduled', 'ongoing', 'completed', 'results_published']).nullish(),
    term: termEnum,
    duration: z
      .number()
      .min(1, 'Duration must be at least 1 minute')
      .max(600, 'Duration cannot exceed 600 minutes')
      .nullable()
      .optional(),
    subjects: z.array(examSubjectSchema).optional(),
  })
  .strip()
  .refine((data) => data.passingMarks <= data.maxMarks, {
    message: 'Passing marks cannot exceed maximum marks',
    path: ['passingMarks'],
  })
  .refine(
    (data) => {
      if (data.endDate && data.startDate) {
        return data.endDate >= data.startDate;
      }
      return true;
    },
    {
      message: 'End date must be on or after start date',
      path: ['endDate'],
    }
  );

// ─── UPDATE EXAM (all fields optional) ───────────────────────────
export const updateExamSchema = z
  .object({
    name: z
      .string()
      .min(2, 'Exam name must be at least 2 characters')
      .max(200, 'Exam name must not exceed 200 characters')
      .trim()
      .optional(),
    type: examTypeEnum,
    examType: optionalString(100),
    classId: objectId.optional(),
    subjectId: optionalObjectId,
    subjectName: optionalString(100),
    academicYear: academicYear.nullish().or(z.literal('')),
    startDate: z.coerce.date({ invalid_type_error: 'Start date must be a valid date' }).optional(),
    endDate: z.coerce
      .date({ invalid_type_error: 'End date must be a valid date' })
      .nullable()
      .optional(),
    maxMarks: z
      .number()
      .min(1, 'Maximum marks must be at least 1')
      .max(1000, 'Maximum marks cannot exceed 1000')
      .optional(),
    passingMarks: z.number().min(0, 'Passing marks cannot be negative').optional(),
    weightage: z
      .number()
      .min(0, 'Weightage cannot be negative')
      .max(100, 'Weightage cannot exceed 100')
      .optional(),
    gradingType: gradingTypeEnum.optional(),
    instructions: optionalString(2000),
    // Publishing is a guarded lifecycle action. Keeping results_published out
    // of the generic edit schema prevents callers with edit-only permission
    // from bypassing result-completeness and publish-permission checks.
    status: z.enum(['scheduled', 'ongoing', 'completed']).optional(),
    term: termEnum,
    duration: z
      .number()
      .min(1, 'Duration must be at least 1 minute')
      .max(600, 'Duration cannot exceed 600 minutes')
      .nullable()
      .optional(),
    subjects: z.array(examSubjectSchema).optional(),
  })
  .strip()
  .refine(
    (data) => {
      if (data.passingMarks != null && data.maxMarks != null) {
        return data.passingMarks <= data.maxMarks;
      }
      return true;
    },
    {
      message: 'Passing marks cannot exceed maximum marks',
      path: ['passingMarks'],
    }
  )
  .refine(
    (data) => {
      if (data.endDate && data.startDate) {
        return data.endDate >= data.startDate;
      }
      return true;
    },
    {
      message: 'End date must be on or after start date',
      path: ['endDate'],
    }
  );

// Empty-body actions still use Zod so unexpected input cannot silently alter
// confirmation/generation semantics in a future handler change.
export const emptyExamActionSchema = z.object({}).strict();
export const emptyExamScheduleActionSchema = emptyExamActionSchema;

// Query validation is deliberately strict and bounded. In addition to making
// pagination deterministic, this prevents raw objects/query operators from
// reaching MongoDB through Express query parsing.
export const examListQuerySchema = z
  .object({
    academicYear: academicYear.optional(),
    classId: objectId.optional(),
    status: z.enum(['scheduled', 'ongoing', 'completed', 'results_published']).optional(),
    q: z.string().trim().max(100, 'Search must not exceed 100 characters').optional(),
    skip: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

// ─── BULK CREATE EXAMS ───────────────────────────────────────────
// Generates one Exam per (subject × date) for a single class.
// `subjects` is either the literal string 'all' (use every subject on the
// class) or an explicit list of subject names. `dates` is either a single
// date (every subject on the same day) or a per-subject mapping.
export const bulkCreateExamsSchema = z
  .object({
    classId: objectId,
    name: z
      .string()
      .min(2, 'Exam name must be at least 2 characters')
      .max(200, 'Exam name must not exceed 200 characters')
      .trim(),
    type: examTypeEnum,
    subjects: z.union([
      z.literal('all'),
      z.array(z.string().min(1).max(100)).min(1, 'Select at least one subject'),
    ]),
    dates: z.union([
      z.coerce.date({ invalid_type_error: 'Date must be a valid date' }),
      z
        .array(
          z.object({
            subjectName: z.string().min(1).max(100),
            date: z.coerce.date({ invalid_type_error: 'Date must be a valid date' }),
          })
        )
        .min(1, 'At least one date is required'),
    ]),
    maxMarks: z
      .number()
      .min(1, 'Maximum marks must be at least 1')
      .max(1000, 'Maximum marks cannot exceed 1000')
      .default(100),
    passingMarks: z.number().min(0, 'Passing marks cannot be negative').default(35),
    weightage: z
      .number()
      .min(0, 'Weightage cannot be negative')
      .max(100, 'Weightage cannot exceed 100')
      .default(10),
    academicYear: academicYear.nullish().or(z.literal('')),
  })
  .strip()
  .refine((data) => data.passingMarks <= data.maxMarks, {
    message: 'Passing marks cannot exceed maximum marks',
    path: ['passingMarks'],
  });

// ─── BULK RESULTS ─────────────────────────────────────────────────
export const bulkResultsSchema = z
  .object({
    examId: objectId,
    classId: optionalObjectId,
    loadedAt: z.coerce.date().nullable().optional(),
    forceOverwrite: z.boolean().optional(),
    results: z
      .array(
        z.object({
          studentId: objectId,
          marksObtained: z
            .number()
            .min(0, 'Marks obtained cannot be negative')
            .max(1000, 'Marks obtained cannot exceed 1000'),
          // 'absent' must survive validation: the route has explicit logic to
          // keep it ('result.status === "absent" ? "absent" : ...'), but
          // without this field the Zod .strip() below dropped it and every
          // absentee was saved as 'failed'.
          status: z.enum(['passed', 'failed', 'absent']).optional(),
          remarks: optionalString(500),
        })
      )
      .min(1, 'At least one result entry is required'),
  })
  .strip();

// ─── SINGLE RESULT CREATE / UPDATE ───────────────────────────────
export const createResultSchema = z
  .object({
    examId: objectId,
    studentId: objectId,
    classId: optionalObjectId,
    marksObtained: z.number().min(0, 'Marks cannot be negative').max(1000).optional(),
    maxMarks: z.number().min(1, 'maxMarks must be at least 1').max(1000).optional(),
    remarks: optionalString(500),
    academicYear: academicYear.optional(),
    status: z.enum(['passed', 'failed', 'absent']).optional(),
  })
  .strip()
  .superRefine((data, ctx) => {
    if (data.status !== 'absent' && data.marksObtained === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['marksObtained'],
        message: 'Marks are required unless the student is absent',
      });
    }
  });

export const updateResultSchema = z
  .object({
    marksObtained: z.number().min(0, 'Marks cannot be negative').max(1000).optional(),
    maxMarks: z.number().min(1, 'maxMarks must be at least 1').max(1000).optional(),
    remarks: optionalString(500),
    // passed/failed are always derived from marks + the exam threshold.
    status: z.enum(['absent', 'pending']).optional(),
  })
  .strip();

// ─── TIME SLOT ────────────────────────────────────────────────────
const timeSlotSchema = z
  .object({
    startTime: timeString.optional(),
    endTime: timeString.optional(),
  })
  .nullable()
  .optional();

// ─── EXAM SCHEDULE ENTRY ─────────────────────────────────────────
const examScheduleEntrySchema = z
  .object({
    date: z.coerce.date({
      required_error: 'Entry date is required',
      invalid_type_error: 'Entry date must be a valid date',
    }),
    session: z.enum(['morning', 'afternoon'], {
      errorMap: () => ({ message: "Session must be 'morning' or 'afternoon'" }),
    }),
    subjectName: z
      .string()
      .min(1, 'Subject name is required')
      .max(100, 'Subject name must not exceed 100 characters'),
    classIds: z
      .array(z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid 24-character ID'))
      .optional(),
    maxMarks: z
      .number()
      .min(1, 'Maximum marks must be at least 1')
      .max(1000, 'Maximum marks cannot exceed 1000')
      .optional(),
    passingMarks: z.number().min(0, 'Passing marks cannot be negative').optional(),
  })
  .refine(
    (entry) =>
      entry.passingMarks == null || entry.maxMarks == null || entry.passingMarks <= entry.maxMarks,
    {
      message: 'Entry passing marks cannot exceed maximum marks',
      path: ['passingMarks'],
    }
  );

// ─── CREATE EXAM SCHEDULE ─────────────────────────────────────────
export const createExamScheduleSchema = z
  .object({
    name: z
      .string()
      .min(2, 'Schedule name must be at least 2 characters')
      .max(200, 'Schedule name must not exceed 200 characters')
      .trim(),
    type: examTypeEnum,
    academicYear: academicYear.nullish().or(z.literal('')),
    classIds: z.array(objectId).min(1, 'At least one class must be selected'),
    startDate: z.coerce
      .date({
        required_error: 'Start date is required',
        invalid_type_error: 'Start date must be a valid date',
      })
      .refine((d) => d >= startOfToday(), { message: 'Start date cannot be in the past' }),
    endDate: z.coerce.date({
      required_error: 'End date is required',
      invalid_type_error: 'End date must be a valid date',
    }),
    sessionType: z.enum(['morning', 'afternoon', 'both']).default('morning'),
    morningSlot: timeSlotSchema,
    afternoonSlot: timeSlotSchema,
    defaultMaxMarks: z
      .number()
      .min(1, 'Default maximum marks must be at least 1')
      .max(1000, 'Default maximum marks cannot exceed 1000')
      .default(100),
    defaultPassingMarks: z.number().min(0, 'Default passing marks cannot be negative').default(35),
    entries: z.array(examScheduleEntrySchema).nullable().optional(),
    createdBy: optionalObjectId,
  })
  .strip()
  .refine((data) => data.endDate >= data.startDate, {
    message: 'End date must be on or after start date',
    path: ['endDate'],
  })
  .refine((data) => data.defaultPassingMarks <= data.defaultMaxMarks, {
    message: 'Default passing marks cannot exceed default maximum marks',
    path: ['defaultPassingMarks'],
  });

// ─── UPDATE EXAM SCHEDULE (all fields optional) ───────────────────
export const updateExamScheduleSchema = z
  .object({
    name: z
      .string()
      .min(2, 'Schedule name must be at least 2 characters')
      .max(200, 'Schedule name must not exceed 200 characters')
      .trim()
      .optional(),
    type: examTypeEnum,
    classIds: z.array(objectId).min(1, 'At least one class must be selected').optional(),
    startDate: z.coerce.date({ invalid_type_error: 'Start date must be a valid date' }).optional(),
    endDate: z.coerce.date({ invalid_type_error: 'End date must be a valid date' }).optional(),
    sessionType: z.enum(['morning', 'afternoon', 'both']).optional(),
    morningSlot: timeSlotSchema,
    afternoonSlot: timeSlotSchema,
    defaultMaxMarks: z
      .number()
      .min(1, 'Default maximum marks must be at least 1')
      .max(1000, 'Default maximum marks cannot exceed 1000')
      .optional(),
    defaultPassingMarks: z.number().min(0, 'Default passing marks cannot be negative').optional(),
    entries: z.array(examScheduleEntrySchema).nullable().optional(),
  })
  .strip()
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return data.endDate >= data.startDate;
      }
      return true;
    },
    {
      message: 'End date must be on or after start date',
      path: ['endDate'],
    }
  )
  .refine(
    (data) => {
      if (data.defaultPassingMarks != null && data.defaultMaxMarks != null) {
        return data.defaultPassingMarks <= data.defaultMaxMarks;
      }
      return true;
    },
    {
      message: 'Default passing marks cannot exceed default maximum marks',
      path: ['defaultPassingMarks'],
    }
  );

// POST /exam-schedules/:id/seat — optional seating options in the request body.
export const seatExamScheduleSchema = z
  .object({
    // Allow double-seater benches to hold two students. Default: one per bench.
    shareBenches: z.coerce.boolean().optional().default(false),
  })
  .strip();
