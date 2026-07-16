import express from 'express';
import mongoose from 'mongoose';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { extractSchoolId } from '../utils/schoolContext.js';
import { validateZod } from '../validators/zodHelpers.js';
import {
  calendarEventOperationQuerySchema,
  calendarEventParamsSchema,
  calendarEventsQuerySchema,
  createCalendarEventSchema,
  updateCalendarEventSchema,
} from '../validators/calendarSchema.js';

const router = express.Router();
router.use(authenticate);

function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) {
    throw new Error('schoolId is required for scoped queries');
  }
  return { ...query, schoolId: normalizedSchoolId };
}

// Calendar Event Schema - enhanced with recurring events, description, holidayType
const calendarEventSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    academicYear: {
      type: String,
      default: '',
      validate: /^\d{4}-(?:\d{2}|\d{4})$|^$/,
    },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    type: { type: String, enum: ['event', 'meeting', 'exam', 'holiday'], default: 'event' },
    startTime: { type: String, default: '' },
    endTime: { type: String, default: '' },
    allDay: { type: Boolean, default: false },
    description: { type: String, default: '', maxlength: 1000 },
    holidayType: { type: String, enum: ['National', 'Regional', 'School'], default: null },
    recurrence: {
      freq: { type: String, enum: ['daily', 'weekly', 'monthly', 'yearly'] },
      interval: { type: Number, default: 1, min: 1, max: 52 },
      endDate: { type: String },
      endCount: { type: Number, min: 1, max: 365 },
      excludedDates: [{ type: String }],
    },
    recurrenceParentId: { type: mongoose.Schema.Types.ObjectId, ref: 'CalendarEvent' },
    originalOccurrenceDate: { type: String },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

calendarEventSchema.index({ schoolId: 1, date: 1, isDeleted: 1 });
calendarEventSchema.index({ schoolId: 1, academicYear: 1, isDeleted: 1, date: 1 });
calendarEventSchema.index({
  schoolId: 1,
  academicYear: 1,
  isDeleted: 1,
  'recurrence.freq': 1,
  date: 1,
  'recurrence.endDate': 1,
});
calendarEventSchema.index(
  { schoolId: 1, recurrenceParentId: 1, originalOccurrenceDate: 1 },
  {
    unique: true,
    partialFilterExpression: { recurrenceParentId: { $exists: true }, isDeleted: false },
  }
);

const transformEvent = (doc, dateOverride, { recurrenceInstance = false } = {}) => {
  if (!doc) return null;
  const obj = doc.toObject ? doc.toObject() : doc;
  const documentId = obj._id.toString();
  const occurrenceDate = dateOverride || obj.date;
  const masterEventId = obj.recurrenceParentId?.toString?.() || documentId;
  return {
    id: recurrenceInstance ? `${documentId}_${occurrenceDate}` : documentId,
    title: obj.title,
    date: occurrenceDate,
    type: obj.type || 'event',
    startTime: obj.startTime || '',
    endTime: obj.endTime || '',
    allDay: obj.allDay || false,
    description: obj.description || '',
    holidayType: obj.holidayType || null,
    academicYear: obj.academicYear || '',
    recurrence: obj.recurrence?.freq ? obj.recurrence : null,
    source: 'calendar-event',
    masterEventId,
    seriesStartDate: obj.recurrence?.freq ? obj.date : null,
    occurrenceDate: recurrenceInstance ? occurrenceDate : obj.originalOccurrenceDate || null,
    isRecurrenceInstance: recurrenceInstance || Boolean(obj.recurrenceParentId),
    isRecurrenceOverride: Boolean(obj.recurrenceParentId),
  };
};

function parseDateUtc(date) {
  return new Date(`${date}T00:00:00Z`);
}

function formatDateUtc(date) {
  return date.toISOString().split('T')[0];
}

function daysInUtcMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function advanceOccurrence(current, frequency, interval, anchorDay, anchorMonth) {
  const next = new Date(current);
  if (frequency === 'daily') {
    next.setUTCDate(next.getUTCDate() + interval);
  } else if (frequency === 'weekly') {
    next.setUTCDate(next.getUTCDate() + 7 * interval);
  } else if (frequency === 'monthly') {
    const targetMonth = next.getUTCMonth() + interval;
    next.setUTCDate(1);
    next.setUTCMonth(targetMonth);
    next.setUTCDate(Math.min(anchorDay, daysInUtcMonth(next.getUTCFullYear(), next.getUTCMonth())));
  } else if (frequency === 'yearly') {
    const targetYear = next.getUTCFullYear() + interval;
    next.setUTCDate(1);
    next.setUTCFullYear(targetYear);
    next.setUTCMonth(anchorMonth);
    next.setUTCDate(Math.min(anchorDay, daysInUtcMonth(targetYear, anchorMonth)));
  }
  return next;
}

/**
 * Expand a single recurring event into occurrences within [rangeStart, rangeEnd].
 * Returns an array of transformed event objects (one per occurrence).
 */
function expandRecurringEvent(event, rangeStart, rangeEnd) {
  const rec = event.recurrence;
  if (!rec || !rec.freq) return [transformEvent(event)];

  // Guard: skip expansion if base date is missing or invalid
  if (!event.date) return [transformEvent(event)];
  let current = parseDateUtc(event.date);
  if (isNaN(current.getTime())) return [transformEvent(event)];

  const occurrences = [];
  const interval = rec.interval || 1;
  const recEndDate = rec.endDate || rangeEnd;
  const effectiveEnd = recEndDate < rangeEnd ? recEndDate : rangeEnd;
  const maxIterations = rec.endCount || 10000;
  const excludedDates = new Set(rec.excludedDates || []);
  const anchorDay = current.getUTCDate();
  const anchorMonth = current.getUTCMonth();

  let occurrenceNumber = 0;
  let iterations = 0;

  // All frequencies can jump directly near the requested window.
  // Without this, a long-running daily/monthly/yearly series was replayed one
  // occurrence at a time from its original start on every month navigation.
  // Preserve the absolute occurrence number so endCount semantics remain
  // unchanged across the skip.
  if (rec.freq === 'daily' || rec.freq === 'weekly') {
    const rangeStartDate = parseDateUtc(rangeStart);
    const stepDays = interval * (rec.freq === 'weekly' ? 7 : 1);
    const diffDays = Math.floor((rangeStartDate.getTime() - current.getTime()) / 86400000);
    const skippedOccurrences = Math.max(0, Math.floor(diffDays / stepDays));
    if (skippedOccurrences > 0) {
      current.setUTCDate(current.getUTCDate() + skippedOccurrences * stepDays);
      occurrenceNumber = skippedOccurrences;
      iterations = skippedOccurrences;
    }
  } else if (rec.freq === 'monthly' || rec.freq === 'yearly') {
    // Count whole intervals between the series start and the window start so
    // we advance `current` by that many occurrences rather than iterating them
    // one at a time. Whole-interval math keeps the occurrence counter accurate.
    const rangeStartUtc = parseDateUtc(rangeStart);
    if (rangeStartUtc.getTime() > current.getTime()) {
      const elapsedIntervals =
        rec.freq === 'monthly'
          ? (rangeStartUtc.getUTCFullYear() - current.getUTCFullYear()) * 12 +
            (rangeStartUtc.getUTCMonth() - current.getUTCMonth())
          : rangeStartUtc.getUTCFullYear() - current.getUTCFullYear();
      const skippedOccurrences = Math.max(0, Math.floor(elapsedIntervals / interval));
      if (skippedOccurrences > 0) {
        current = advanceOccurrence(
          current,
          rec.freq,
          interval * skippedOccurrences,
          anchorDay,
          anchorMonth
        );
        occurrenceNumber = skippedOccurrences;
        iterations = skippedOccurrences;
      }
    }
  }

  while (iterations < maxIterations) {
    iterations += 1;
    occurrenceNumber += 1;
    const dateStr = formatDateUtc(current);

    if (dateStr > effectiveEnd) break;
    if (rec.endCount && occurrenceNumber > rec.endCount) break;

    if (dateStr >= rangeStart && !excludedDates.has(dateStr)) {
      occurrences.push(transformEvent(event, dateStr, { recurrenceInstance: true }));
    }

    current = advanceOccurrence(current, rec.freq, interval, anchorDay, anchorMonth);
  }

  return occurrences;
}

function parseEventReference(rawId, explicitOccurrenceDate) {
  const syntheticMatch = String(rawId).match(/^([0-9a-fA-F]{24})_(\d{4}-\d{2}-\d{2})$/);
  if (syntheticMatch) {
    return {
      masterId: syntheticMatch[1],
      occurrenceDate: explicitOccurrenceDate || syntheticMatch[2],
      isSynthetic: true,
    };
  }
  if (!mongoose.Types.ObjectId.isValid(String(rawId))) return null;
  return {
    masterId: String(rawId),
    occurrenceDate: explicitOccurrenceDate || null,
    isSynthetic: false,
  };
}

function isOccurrenceDate(event, occurrenceDate) {
  if (!event?.recurrence?.freq || !occurrenceDate) return false;
  return expandRecurringEvent(event, occurrenceDate, occurrenceDate).some(
    (occurrence) => occurrence.date === occurrenceDate
  );
}

const CalendarEvent =
  mongoose.models.CalendarEvent || mongoose.model('CalendarEvent', calendarEventSchema);

// ─── Calendar Templates (static data for Indian school boards) ───────────────
// monthDay format: MM-DD. Academic year spans April (year) to March (year+1).
// April–December uses `academicStartYear`; January–March uses `academicStartYear + 1`.
const CALENDAR_TEMPLATES = {
  cbse: {
    name: 'CBSE Standard Calendar',
    description: 'National holidays and key events for CBSE-affiliated schools',
    board: 'CBSE',
    events: [
      { title: 'Republic Day', monthDay: '01-26', type: 'holiday', holidayType: 'National' },
      { title: 'Independence Day', monthDay: '08-15', type: 'holiday', holidayType: 'National' },
      { title: 'Gandhi Jayanti', monthDay: '10-02', type: 'holiday', holidayType: 'National' },
      { title: 'Ambedkar Jayanti', monthDay: '04-14', type: 'holiday', holidayType: 'National' },
      { title: 'Labour Day', monthDay: '05-01', type: 'holiday', holidayType: 'National' },
      { title: 'Eid ul-Fitr', monthDay: '04-10', type: 'holiday', holidayType: 'National' },
      { title: 'Good Friday', monthDay: '04-18', type: 'holiday', holidayType: 'National' },
      { title: 'Holi', monthDay: '03-14', type: 'holiday', holidayType: 'National' },
      { title: 'Dussehra', monthDay: '10-12', type: 'holiday', holidayType: 'National' },
      { title: 'Diwali', monthDay: '11-01', type: 'holiday', holidayType: 'National' },
      { title: 'Guru Nanak Jayanti', monthDay: '11-15', type: 'holiday', holidayType: 'National' },
      { title: 'Christmas Day', monthDay: '12-25', type: 'holiday', holidayType: 'National' },
    ],
  },
  icse: {
    name: 'ICSE Standard Calendar',
    description: 'National holidays and exam windows for ICSE-affiliated schools',
    board: 'ICSE',
    events: [
      { title: 'Republic Day', monthDay: '01-26', type: 'holiday', holidayType: 'National' },
      { title: 'Independence Day', monthDay: '08-15', type: 'holiday', holidayType: 'National' },
      { title: 'Gandhi Jayanti', monthDay: '10-02', type: 'holiday', holidayType: 'National' },
      { title: 'Ambedkar Jayanti', monthDay: '04-14', type: 'holiday', holidayType: 'National' },
      { title: 'Labour Day', monthDay: '05-01', type: 'holiday', holidayType: 'National' },
      { title: 'Eid ul-Fitr', monthDay: '04-10', type: 'holiday', holidayType: 'National' },
      { title: 'Good Friday', monthDay: '04-18', type: 'holiday', holidayType: 'National' },
      { title: 'Holi', monthDay: '03-14', type: 'holiday', holidayType: 'National' },
      { title: 'Dussehra', monthDay: '10-12', type: 'holiday', holidayType: 'National' },
      { title: 'Diwali', monthDay: '11-01', type: 'holiday', holidayType: 'National' },
      { title: 'Guru Nanak Jayanti', monthDay: '11-15', type: 'holiday', holidayType: 'National' },
      { title: 'Christmas Day', monthDay: '12-25', type: 'holiday', holidayType: 'National' },
      { title: 'Mid-Year Exams Start', monthDay: '09-01', type: 'exam', holidayType: null },
      { title: 'Annual Exams Start', monthDay: '02-15', type: 'exam', holidayType: null },
    ],
  },
  state: {
    name: 'State Board General Calendar',
    description: 'National holidays plus standard vacation windows for state board schools',
    board: 'State Board',
    events: [
      { title: 'Republic Day', monthDay: '01-26', type: 'holiday', holidayType: 'National' },
      { title: 'Independence Day', monthDay: '08-15', type: 'holiday', holidayType: 'National' },
      { title: 'Gandhi Jayanti', monthDay: '10-02', type: 'holiday', holidayType: 'National' },
      { title: 'Ambedkar Jayanti', monthDay: '04-14', type: 'holiday', holidayType: 'National' },
      { title: 'Labour Day', monthDay: '05-01', type: 'holiday', holidayType: 'National' },
      { title: 'Eid ul-Fitr', monthDay: '04-10', type: 'holiday', holidayType: 'National' },
      { title: 'Good Friday', monthDay: '04-18', type: 'holiday', holidayType: 'National' },
      { title: 'Holi', monthDay: '03-14', type: 'holiday', holidayType: 'National' },
      { title: 'Dussehra', monthDay: '10-12', type: 'holiday', holidayType: 'National' },
      { title: 'Diwali', monthDay: '11-01', type: 'holiday', holidayType: 'National' },
      { title: 'Guru Nanak Jayanti', monthDay: '11-15', type: 'holiday', holidayType: 'National' },
      { title: 'Christmas Day', monthDay: '12-25', type: 'holiday', holidayType: 'National' },
      { title: 'Summer Vacation Start', monthDay: '04-25', type: 'event', holidayType: null },
      { title: 'Summer Vacation End', monthDay: '06-14', type: 'event', holidayType: null },
      { title: 'Winter Vacation Start', monthDay: '12-20', type: 'event', holidayType: null },
      { title: 'Winter Vacation End', monthDay: '01-02', type: 'event', holidayType: null },
    ],
  },
};

// ─── GET /calendar/templates ─────────────────────────────────────────────────
router.get('/calendar/templates', async (req, res) => {
  try {
    const templates = Object.entries(CALENDAR_TEMPLATES).map(([id, t]) => ({
      id,
      name: t.name,
      description: t.description,
      board: t.board,
      eventCount: t.events.length,
    }));
    res.json({ templates });
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// ─── POST /calendar/templates/:templateId/import ─────────────────────────────
// Import a template's events for a given academic start year.
// `year` = the April-start year (e.g., 2025 for the 2025-26 academic year).
router.post(
  '/calendar/templates/:templateId/import',
  checkPermission('timetable', 'create'),
  async (req, res) => {
    try {
      const { templateId } = req.params;
      const { year, skipExisting = true } = req.body;

      const template = CALENDAR_TEMPLATES[templateId];
      if (!template) {
        return res.status(404).json({ error: 'Template not found' });
      }

      const academicStartYear = parseInt(year) || new Date().getFullYear();
      if (isNaN(academicStartYear) || academicStartYear < 2020 || academicStartYear > 2035) {
        return res.status(400).json({ error: 'year must be between 2020 and 2035' });
      }

      const schoolId = extractSchoolId(req.user?.schoolId);
      const created = [];
      const skipped = [];

      for (const event of template.events) {
        // April–December → academicStartYear; January–March → academicStartYear + 1
        const month = parseInt(event.monthDay.split('-')[0], 10);
        const eventYear = month >= 4 ? academicStartYear : academicStartYear + 1;
        const fullDate = `${eventYear}-${event.monthDay}`;

        if (skipExisting) {
          const exists = await CalendarEvent.findOne(
            scopeBySchool(schoolId, {
              title: event.title,
              date: fullDate,
              isDeleted: { $ne: true },
            })
          );
          if (exists) {
            skipped.push(event.title);
            continue;
          }
        }

        const newEvent = new CalendarEvent({
          schoolId,
          title: event.title,
          date: fullDate,
          type: event.type || 'holiday',
          allDay: true,
          startTime: '',
          endTime: '',
          holidayType: event.holidayType || null,
        });

        await newEvent.save();
        created.push(transformEvent(newEvent));
      }

      res.json({
        message: `Imported ${created.length} events (${skipped.length} skipped as duplicates)`,
        created,
        skipped,
      });
    } catch (error) {
      console.error('Error importing template:', error);
      res.status(500).json({ error: 'Failed to import template' });
    }
  }
);

// ─── POST /calendar/conflict-check ───────────────────────────────────────────
// Returns events of specified types that fall within the given date range.
// `types` defaults to ['holiday'] for backward compatibility.
// Also returns exam conflicts (scheduled exams from Exam model) when 'exam' is included.
router.post('/calendar/conflict-check', async (req, res) => {
  try {
    const { startDate, endDate, types } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return res.status(400).json({ error: 'Dates must be YYYY-MM-DD format' });
    }
    if (startDate > endDate) {
      return res.status(400).json({ error: 'startDate must be on or before endDate' });
    }

    const checkTypes = Array.isArray(types) && types.length > 0 ? types : ['holiday'];

    // Query calendar events matching the requested types
    const calendarConflicts = await CalendarEvent.find(
      scopeBySchool(req.user?.schoolId, {
        isDeleted: { $ne: true },
        type: { $in: checkTypes },
        date: { $gte: startDate, $lte: endDate },
      })
    ).sort({ date: 1 });

    const result = {
      hasConflicts: calendarConflicts.length > 0,
      conflicts: calendarConflicts.map(transformEvent),
      count: calendarConflicts.length,
    };

    // If 'exam' is requested, also check the Exam model for scheduled exams in range
    if (checkTypes.includes('exam')) {
      const Exam = mongoose.models.Exam;
      if (Exam) {
        const schoolId = extractSchoolId(req.user?.schoolId);
        const examConflicts = await Exam.find({
          schoolId,
          isDeleted: { $ne: true },
          status: { $in: ['scheduled', 'ongoing'] },
          $or: [
            { startDate: { $gte: new Date(startDate), $lte: new Date(endDate) } },
            { endDate: { $gte: new Date(startDate), $lte: new Date(endDate) } },
          ],
        })
          .select('name startDate endDate classId status')
          .populate('classId', 'name')
          .sort({ startDate: 1 });

        result.examConflicts = examConflicts.map((e) => ({
          id: e._id.toString(),
          title: e.name,
          startDate: e.startDate?.toISOString().split('T')[0] || null,
          endDate: e.endDate?.toISOString().split('T')[0] || null,
          className: e.classId?.name || null,
          status: e.status,
        }));
        result.hasConflicts = result.hasConflicts || result.examConflicts.length > 0;
      }
    }

    res.json(result);
  } catch (error) {
    console.error('Error checking conflicts:', error);
    res.status(500).json({ error: 'Failed to check conflicts' });
  }
});

// ─── GET /calendar/exam-suggestions ──────────────────────────────────────────
// Suggests exam dates based on available working days, avoiding holidays and
// maintaining a minimum gap between suggestions.
// Query params: startDate (YYYY-MM-DD), endDate (YYYY-MM-DD),
//               examCount (default 3), gapDays (min working days between exams, default 7)
router.get('/calendar/exam-suggestions', async (req, res) => {
  try {
    const { startDate, endDate, examCount = 3, gapDays = 7 } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate query params are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return res.status(400).json({ error: 'Dates must be YYYY-MM-DD format' });
    }
    if (startDate >= endDate) {
      return res.status(400).json({ error: 'endDate must be after startDate' });
    }

    const count = Math.min(Math.max(parseInt(examCount) || 3, 1), 10);
    const gap = Math.max(parseInt(gapDays) || 7, 1);
    const schoolId = extractSchoolId(req.user?.schoolId);

    // Load working days config
    let workingDayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    const SchoolSettings = mongoose.models.SchoolSettings;
    if (SchoolSettings) {
      const settings = await SchoolSettings.findOne({ schoolId });
      if (settings?.workingDays?.length > 0) workingDayNames = settings.workingDays;
    }
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const workingDayIndexes = new Set(
      workingDayNames.map((d) => dayMap[d]).filter((d) => d !== undefined)
    );

    // Fetch holidays in range
    const holidays = await CalendarEvent.find(
      scopeBySchool(schoolId, {
        isDeleted: { $ne: true },
        type: 'holiday',
        date: { $gte: startDate, $lte: endDate },
      })
    ).select('date');
    const holidaySet = new Set(holidays.map((h) => h.date));

    // Fetch existing exam events in range (to avoid suggesting already-occupied dates)
    const existingExamEvents = await CalendarEvent.find(
      scopeBySchool(schoolId, {
        isDeleted: { $ne: true },
        type: 'exam',
        date: { $gte: startDate, $lte: endDate },
      })
    ).select('date');
    const existingExamDates = new Set(existingExamEvents.map((e) => e.date));

    // Build list of all valid candidate working days
    const candidates = [];
    const cur = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    while (cur <= end) {
      const dateStr = cur.toISOString().split('T')[0];
      if (
        workingDayIndexes.has(cur.getDay()) &&
        !holidaySet.has(dateStr) &&
        !existingExamDates.has(dateStr)
      ) {
        candidates.push(dateStr);
      }
      cur.setDate(cur.getDate() + 1);
    }

    if (candidates.length === 0) {
      return res.json({ suggestions: [], message: 'No available working days in the given range' });
    }

    // Pick `count` dates distributed evenly with minimum `gap` working days between them
    const suggestions = [];
    let lastPickedIdx = -1;

    // Distribute evenly: divide candidates into `count` equal segments and pick midpoint of each
    const segmentSize = Math.floor(candidates.length / count);

    for (let i = 0; i < count; i++) {
      const segStart = i * segmentSize;
      const segEnd = i === count - 1 ? candidates.length - 1 : (i + 1) * segmentSize - 1;
      const midIdx = Math.floor((segStart + segEnd) / 2);

      // Find nearest valid candidate from midpoint respecting gap constraint
      let chosen = null;
      for (let offset = 0; offset <= segEnd - segStart; offset++) {
        for (const direction of [0, 1, -1]) {
          const idx = midIdx + (direction === 0 ? offset : direction * offset);
          if (idx < segStart || idx > segEnd || idx < 0 || idx >= candidates.length) continue;
          // Enforce minimum gap from last picked index
          if (lastPickedIdx >= 0 && idx - lastPickedIdx < gap) continue;
          chosen = { idx, date: candidates[idx] };
          break;
        }
        if (chosen) break;
      }

      if (chosen) {
        suggestions.push({
          date: chosen.date,
          dayOfWeek: new Date(chosen.date + 'T00:00:00').toLocaleDateString('en-US', {
            weekday: 'long',
          }),
        });
        lastPickedIdx = chosen.idx;
      }
    }

    res.json({
      suggestions,
      totalCandidateDays: candidates.length,
      message:
        suggestions.length < count
          ? `Only ${suggestions.length} suitable dates found (${count} requested). Try a wider date range or smaller gap.`
          : `Found ${suggestions.length} suggested exam dates`,
    });
  } catch (error) {
    console.error('Error generating exam suggestions:', error);
    res.status(500).json({ error: 'Failed to generate exam suggestions' });
  }
});

// ─── GET /calendar/working-days ──────────────────────────────────────────────
// Calculates working days between startDate and endDate, excluding weekends and
// holidays. Uses the school's workingDays config from SchoolSettings if available.
router.get('/calendar/working-days', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate query params are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return res.status(400).json({ error: 'Dates must be YYYY-MM-DD format' });
    }
    if (startDate > endDate) {
      return res.status(400).json({ error: 'startDate must be on or before endDate' });
    }

    const schoolId = extractSchoolId(req.user?.schoolId);

    // Load working days config from SchoolSettings (default Mon–Fri)
    let workingDayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    const SchoolSettings = mongoose.models.SchoolSettings;
    if (SchoolSettings) {
      const settings = await SchoolSettings.findOne({ schoolId });
      if (settings?.workingDays?.length > 0) {
        workingDayNames = settings.workingDays;
      }
    }

    // Fetch holidays in range
    const holidays = await CalendarEvent.find(
      scopeBySchool(schoolId, {
        isDeleted: { $ne: true },
        type: 'holiday',
        date: { $gte: startDate, $lte: endDate },
      })
    ).select('date');

    const holidaySet = new Set(holidays.map((h) => h.date));

    // JS getDay() indexes: Sun=0, Mon=1, …, Sat=6
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const workingDayIndexes = new Set(
      workingDayNames.map((d) => dayMap[d]).filter((d) => d !== undefined)
    );

    const current = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    let totalDays = 0;
    let workingDays = 0;
    let holidayCount = 0;

    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      const dayOfWeek = current.getDay();
      totalDays++;

      if (workingDayIndexes.has(dayOfWeek)) {
        if (holidaySet.has(dateStr)) {
          holidayCount++;
        } else {
          workingDays++;
        }
      }

      current.setDate(current.getDate() + 1);
    }

    res.json({
      startDate,
      endDate,
      totalDays,
      workingDays,
      holidayCount,
      weekendDays: totalDays - workingDays - holidayCount,
    });
  } catch (error) {
    console.error('Error calculating working days:', error);
    res.status(500).json({ error: 'Failed to calculate working days' });
  }
});

// ─── GET /calendar/events/export.ics ─────────────────────────────────────────
// Exports school calendar events as an iCalendar (.ics) file.
router.get('/calendar/events/export.ics', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const query = scopeBySchool(req.user?.schoolId, { isDeleted: { $ne: true } });

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = startDate;
      if (endDate) query.date.$lte = endDate;
    }

    const events = await CalendarEvent.find(query).sort({ date: 1 });

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//EMS//CalendarExport//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
    ];

    for (const event of events) {
      if (!event.date) continue; // skip events with missing dates
      const dateStr = event.date.replace(/-/g, '');
      let dtStart, dtEnd;
      if (event.allDay) {
        dtStart = `DTSTART;VALUE=DATE:${dateStr}`;
        // iCalendar spec: DTEND for all-day events must be the *next* day (exclusive)
        const nextDay = new Date(event.date + 'T00:00:00');
        nextDay.setDate(nextDay.getDate() + 1);
        const nextDayStr = nextDay.toISOString().split('T')[0].replace(/-/g, '');
        dtEnd = `DTEND;VALUE=DATE:${nextDayStr}`;
      } else {
        dtStart = `DTSTART:${dateStr}T${(event.startTime || '00:00').replace(':', '')}00`;
        dtEnd = `DTEND:${dateStr}T${(event.endTime || event.startTime || '00:00').replace(':', '')}00`;
      }

      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${event._id}@ems-calendar`);
      lines.push(dtStart);
      lines.push(dtEnd);
      lines.push(`SUMMARY:${event.title.replace(/[,;\\]/g, '\\$&')}`);
      if (event.description) {
        lines.push(`DESCRIPTION:${event.description.replace(/[,;\\]/g, '\\$&')}`);
      }
      lines.push(`CATEGORIES:${event.type.toUpperCase()}`);
      lines.push('END:VEVENT');
    }

    lines.push('END:VCALENDAR');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="school-calendar.ics"');
    res.send(lines.join('\r\n'));
  } catch (error) {
    console.error('Error exporting calendar:', error);
    res.status(500).json({ error: 'Failed to export calendar' });
  }
});

// ─── GET /calendar/events ────────────────────────────────────────────────────
// Accepts optional query params: startDate, endDate (YYYY-MM-DD) to filter & expand recurring events
router.get(
  '/calendar/events',
  checkPermission('timetable', 'view'),
  validateZod(calendarEventsQuerySchema, 'query'),
  async (req, res) => {
    try {
      const { startDate, endDate, academicYear } = req.query;
      const query = scopeBySchool(req.user?.schoolId, { isDeleted: { $ne: true } });

      if (academicYear) {
        query.academicYear = { $in: [academicYear, ''] };
      }

      // When a date range is provided, fetch events whose base date falls in range
      // OR have recurrence (may generate occurrences in range even if base date is earlier)
      if (startDate && endDate) {
        query.$or = [
          { date: { $gte: startDate, $lte: endDate } },
          {
            'recurrence.freq': { $exists: true, $ne: null },
            date: { $lte: endDate },
            $or: [
              { 'recurrence.endDate': { $exists: false } },
              { 'recurrence.endDate': null },
              { 'recurrence.endDate': '' },
              { 'recurrence.endDate': { $gte: startDate } },
            ],
          },
        ];
      }

      const events = await CalendarEvent.find(query).sort({ date: 1, startTime: 1 }).lean();

      // A moved occurrence can fall outside its series' bounded end date. Load
      // only the missing parent documents so the occurrence retains recurrence
      // metadata without reverting to the former "fetch every series" query.
      const loadedIds = new Set(events.map((event) => event._id.toString()));
      const missingParentIds = [
        ...new Set(
          events
            .map((event) => event.recurrenceParentId?.toString?.())
            .filter((id) => id && !loadedIds.has(id))
        ),
      ];
      if (missingParentIds.length > 0) {
        const parentQuery = scopeBySchool(req.user?.schoolId, {
          _id: { $in: missingParentIds },
          isDeleted: { $ne: true },
          ...(academicYear ? { academicYear: { $in: [academicYear, ''] } } : {}),
        });
        events.push(...(await CalendarEvent.find(parentQuery).lean()));
      }

      // Default range for expansion: if no range provided, use current year +/- 6 months
      const rangeStart =
        startDate || new Date(Date.now() - 180 * 86400000).toISOString().split('T')[0];
      const rangeEnd = endDate || new Date(Date.now() + 180 * 86400000).toISOString().split('T')[0];

      // Expand recurring events into individual occurrences
      const expanded = [];
      const masterEventMap = new Map(
        events
          .filter((event) => event.recurrence?.freq)
          .map((event) => [event._id.toString(), event])
      );
      for (const event of events) {
        if (event.recurrence?.freq) {
          expanded.push(...expandRecurringEvent(event, rangeStart, rangeEnd));
        } else {
          const transformed = transformEvent(event);
          const parent = event.recurrenceParentId
            ? masterEventMap.get(event.recurrenceParentId.toString())
            : null;
          if (parent) {
            transformed.recurrence = parent.recurrence;
            transformed.seriesStartDate = parent.date;
          }
          expanded.push(transformed);
        }
      }

      // Sort by date after expansion — guard against null/undefined dates
      expanded.sort(
        (a, b) =>
          (a.date || '').localeCompare(b.date || '') ||
          (a.startTime || '').localeCompare(b.startTime || '')
      );

      res.json(expanded);
    } catch (error) {
      console.error('Error fetching calendar events:', error);
      res.status(500).json({ error: 'Failed to fetch calendar events' });
    }
  }
);

// ─── POST /calendar/events ───────────────────────────────────────────────────
router.post(
  '/calendar/events',
  checkPermission('timetable', 'create'),
  validateZod(createCalendarEventSchema),
  async (req, res) => {
    try {
      const {
        title,
        date,
        type,
        startTime,
        endTime,
        allDay,
        description,
        holidayType,
        recurrence,
        academicYear,
      } = req.body;

      const event = new CalendarEvent({
        schoolId: extractSchoolId(req.user?.schoolId),
        academicYear: academicYear || '',
        title,
        date,
        type: type || 'event',
        startTime: startTime || '',
        endTime: endTime || '',
        allDay: allDay || false,
        description: description || '',
        holidayType: holidayType || null,
        recurrence: recurrence?.freq ? recurrence : undefined,
      });

      await event.save();
      res.json(transformEvent(event));
    } catch (error) {
      console.error('Error creating calendar event:', error);
      res.status(500).json({ error: 'Failed to create calendar event' });
    }
  }
);

// ─── PUT /calendar/events/:id ────────────────────────────────────────────────
router.put(
  '/calendar/events/:id',
  checkPermission('timetable', 'edit'),
  validateZod(calendarEventParamsSchema, 'params'),
  validateZod(calendarEventOperationQuerySchema, 'query'),
  validateZod(updateCalendarEventSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const reference = parseEventReference(id, req.query.occurrenceDate);
      if (!reference) {
        return res.status(400).json({ error: 'Invalid event reference' });
      }
      const schoolId = extractSchoolId(req.user?.schoolId);
      const requestedScope = req.query.scope || (reference.isSynthetic ? 'occurrence' : null);
      const target = await CalendarEvent.findOne(
        scopeBySchool(schoolId, { _id: reference.masterId, isDeleted: { $ne: true } })
      );

      if (!target) {
        return res.status(404).json({ error: 'Event not found' });
      }

      const effectiveScope =
        requestedScope || (target.recurrenceParentId ? 'occurrence' : 'series');

      if (effectiveScope === 'occurrence' && target.recurrenceParentId) {
        const overrideData = {
          title: req.body.title ?? target.title,
          date: req.body.date ?? target.date,
          type: req.body.type ?? target.type,
          startTime: req.body.startTime ?? target.startTime ?? '',
          endTime: req.body.endTime ?? target.endTime ?? '',
          allDay: req.body.allDay ?? target.allDay ?? false,
          description: req.body.description ?? target.description ?? '',
          holidayType:
            req.body.holidayType !== undefined
              ? req.body.holidayType
              : (target.holidayType ?? null),
          recurrence: null,
          academicYear: req.body.academicYear ?? target.academicYear ?? '',
        };
        const validatedOverride = createCalendarEventSchema.safeParse(overrideData);
        if (!validatedOverride.success) {
          return res.status(400).json({ error: 'Validation failed' });
        }
        const updatedOverride = await CalendarEvent.findOneAndUpdate(
          scopeBySchool(schoolId, { _id: target._id, isDeleted: { $ne: true } }),
          { $set: { ...validatedOverride.data, recurrence: undefined, updatedAt: new Date() } },
          { new: true, runValidators: true }
        );
        return res.json(transformEvent(updatedOverride));
      }

      if (effectiveScope === 'occurrence') {
        if (!reference.occurrenceDate || !isOccurrenceDate(target, reference.occurrenceDate)) {
          return res.status(400).json({
            error: 'The requested date is not an active occurrence of this recurring event.',
          });
        }

        const overrideData = {
          title: req.body.title ?? target.title,
          date: req.body.date ?? reference.occurrenceDate,
          type: req.body.type ?? target.type,
          startTime: req.body.startTime ?? target.startTime ?? '',
          endTime: req.body.endTime ?? target.endTime ?? '',
          allDay: req.body.allDay ?? target.allDay ?? false,
          description: req.body.description ?? target.description ?? '',
          holidayType:
            req.body.holidayType !== undefined
              ? req.body.holidayType
              : (target.holidayType ?? null),
          recurrence: null,
          academicYear: req.body.academicYear ?? target.academicYear ?? '',
        };
        const validatedOverride = createCalendarEventSchema.safeParse(overrideData);
        if (!validatedOverride.success) {
          return res.status(400).json({
            error: 'Validation failed',
            details: validatedOverride.error.issues.map((issue) => ({
              field: issue.path.join('.'),
              message: issue.message,
            })),
          });
        }

        const session = await mongoose.startSession();
        let override;
        try {
          await session.withTransaction(async () => {
            await CalendarEvent.updateOne(
              scopeBySchool(schoolId, { _id: target._id, isDeleted: { $ne: true } }),
              {
                $addToSet: { 'recurrence.excludedDates': reference.occurrenceDate },
                $set: { updatedAt: new Date() },
              },
              { session }
            );
            override = await CalendarEvent.findOneAndUpdate(
              scopeBySchool(schoolId, {
                recurrenceParentId: target._id,
                originalOccurrenceDate: reference.occurrenceDate,
                isDeleted: { $ne: true },
              }),
              {
                $set: {
                  ...validatedOverride.data,
                  recurrence: undefined,
                  updatedAt: new Date(),
                },
                $setOnInsert: {
                  schoolId,
                  recurrenceParentId: target._id,
                  originalOccurrenceDate: reference.occurrenceDate,
                  isDeleted: false,
                },
              },
              { new: true, upsert: true, runValidators: true, session }
            );
          });
        } finally {
          await session.endSession();
        }

        return res.json(transformEvent(override));
      }

      const seriesTarget = target.recurrenceParentId
        ? await CalendarEvent.findOne(
            scopeBySchool(schoolId, {
              _id: target.recurrenceParentId,
              isDeleted: { $ne: true },
            })
          )
        : target;
      if (!seriesTarget) {
        return res.status(404).json({ error: 'Recurring series not found' });
      }

      const updates = { ...req.body, updatedAt: new Date() };
      if (updates.recurrence?.freq && seriesTarget.recurrence?.freq) {
        updates.recurrence = {
          ...seriesTarget.recurrence.toObject(),
          ...updates.recurrence,
          excludedDates: seriesTarget.recurrence.excludedDates || [],
        };
      }

      const mergedSeries = createCalendarEventSchema.safeParse({
        title: updates.title ?? seriesTarget.title,
        date: updates.date ?? seriesTarget.date,
        type: updates.type ?? seriesTarget.type,
        startTime: updates.startTime ?? seriesTarget.startTime ?? '',
        endTime: updates.endTime ?? seriesTarget.endTime ?? '',
        allDay: updates.allDay ?? seriesTarget.allDay ?? false,
        description: updates.description ?? seriesTarget.description ?? '',
        holidayType:
          updates.holidayType !== undefined
            ? updates.holidayType
            : (seriesTarget.holidayType ?? null),
        recurrence:
          updates.recurrence !== undefined
            ? updates.recurrence
            : seriesTarget.recurrence?.freq
              ? seriesTarget.recurrence.toObject()
              : null,
        academicYear: updates.academicYear ?? seriesTarget.academicYear ?? '',
      });
      if (!mergedSeries.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: mergedSeries.error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        });
      }

      const event = await CalendarEvent.findOneAndUpdate(
        scopeBySchool(schoolId, { _id: seriesTarget._id, isDeleted: { $ne: true } }),
        { $set: updates },
        { new: true, runValidators: true }
      );

      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      res.json(transformEvent(event));
    } catch (error) {
      console.error('Error updating calendar event:', error);
      res.status(500).json({ error: 'Failed to update calendar event' });
    }
  }
);

// ─── DELETE /calendar/events/:id ─────────────────────────────────────────────
router.delete(
  '/calendar/events/:id',
  checkPermission('timetable', 'delete'),
  validateZod(calendarEventParamsSchema, 'params'),
  validateZod(calendarEventOperationQuerySchema, 'query'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const reference = parseEventReference(id, req.query.occurrenceDate);
      if (!reference) {
        return res.status(400).json({ error: 'Invalid event reference' });
      }
      const schoolId = extractSchoolId(req.user?.schoolId);
      const requestedScope = req.query.scope || (reference.isSynthetic ? 'occurrence' : null);
      const target = await CalendarEvent.findOne(
        scopeBySchool(schoolId, { _id: reference.masterId, isDeleted: { $ne: true } })
      );

      if (!target) {
        return res.status(404).json({ error: 'Event not found' });
      }

      const effectiveScope =
        requestedScope || (target.recurrenceParentId ? 'occurrence' : 'series');

      if (effectiveScope === 'occurrence' && target.recurrenceParentId) {
        await CalendarEvent.updateOne(
          scopeBySchool(schoolId, { _id: target._id, isDeleted: { $ne: true } }),
          { $set: { isDeleted: true, updatedAt: new Date() } }
        );
        return res.json({
          message: 'Recurring occurrence deleted successfully',
          scope: 'occurrence',
          occurrenceDate: target.originalOccurrenceDate || target.date,
        });
      }

      if (effectiveScope === 'occurrence') {
        if (!reference.occurrenceDate || !isOccurrenceDate(target, reference.occurrenceDate)) {
          return res.status(400).json({
            error: 'The requested date is not an active occurrence of this recurring event.',
          });
        }
        await CalendarEvent.updateOne(
          scopeBySchool(schoolId, { _id: target._id, isDeleted: { $ne: true } }),
          {
            $addToSet: { 'recurrence.excludedDates': reference.occurrenceDate },
            $set: { updatedAt: new Date() },
          }
        );
        return res.json({
          message: 'Recurring occurrence deleted successfully',
          scope: 'occurrence',
          occurrenceDate: reference.occurrenceDate,
        });
      }

      const seriesTargetId = target.recurrenceParentId || target._id;
      const session = await mongoose.startSession();
      let event;
      try {
        await session.withTransaction(async () => {
          event = await CalendarEvent.findOneAndUpdate(
            scopeBySchool(schoolId, { _id: seriesTargetId, isDeleted: { $ne: true } }),
            { $set: { isDeleted: true, updatedAt: new Date() } },
            { new: true, session }
          );
          if (event?.recurrence?.freq) {
            await CalendarEvent.updateMany(
              scopeBySchool(schoolId, {
                recurrenceParentId: event._id,
                isDeleted: { $ne: true },
              }),
              { $set: { isDeleted: true, updatedAt: new Date() } },
              { session }
            );
          }
        });
      } finally {
        await session.endSession();
      }

      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      res.json({ message: 'Event series deleted successfully', scope: 'series' });
    } catch (error) {
      console.error('Error deleting calendar event:', error);
      res.status(500).json({ error: 'Failed to delete calendar event' });
    }
  }
);

export default router;
