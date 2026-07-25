import request from 'supertest';
import { describe, expect, it, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const BASE = '/api/calendar/events';

describe('calendar events routes', () => {
  let app, school, admin, headers;

  beforeEach(async () => {
    school = await createSchoolRecord({ name: 'Calendar School', code: 'CAL' });
    admin = await createStaffUser({
      name: 'Cal Admin',
      email: 'cal.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    headers = authHeadersFor(admin, 'admin');
    ({ app } = createTestApp());
  });

  // ───────────────────────────────────────────────────────────────
  // Auth
  // ───────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('GET /calendar/events returns 401 without token', async () => {
      await request(app).get(BASE).expect(401);
    });

    it('POST /calendar/events returns 401 without token', async () => {
      await request(app).post(BASE).send({ title: 'Test', date: '2025-06-15' }).expect(401);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // POST /calendar/events — create
  // ───────────────────────────────────────────────────────────────
  describe('POST /calendar/events', () => {
    it('creates a calendar event and returns it', async () => {
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .send({
          title: 'Annual Day',
          date: '2025-12-15',
          type: 'event',
          startTime: '09:00',
          endTime: '17:00',
          allDay: false,
        })
        .expect(200);

      expect(res.body.title).toBe('Annual Day');
      expect(res.body.date).toBe('2025-12-15');
      expect(res.body.type).toBe('event');
      expect(res.body.startTime).toBe('09:00');
      expect(res.body.id).toBeTruthy();
    });

    it('creates an all-day event', async () => {
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .send({
          title: 'School Holiday',
          date: '2025-10-02',
          type: 'holiday',
          allDay: true,
        })
        .expect(200);

      expect(res.body.allDay).toBe(true);
      expect(res.body.type).toBe('holiday');
    });

    it('defaults type to "event" when not provided', async () => {
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .send({ title: 'Staff Meeting', date: '2025-11-10' })
        .expect(200);

      expect(res.body.type).toBe('event');
    });

    it('returns 400 when title is missing', async () => {
      await request(app).post(BASE).set(headers).send({ date: '2025-11-10' }).expect(400);
    });

    it('returns 400 when date is missing', async () => {
      await request(app).post(BASE).set(headers).send({ title: 'No Date Event' }).expect(400);
    });

    it('persists all event fields and accepts the UI daily recurrence option', async () => {
      const response = await request(app)
        .post(BASE)
        .set(headers)
        .send({
          title: 'Daily planning',
          date: '2025-07-01',
          type: 'holiday',
          allDay: true,
          description: 'Planning notes',
          holidayType: 'School',
          academicYear: '2025-26',
          recurrence: { freq: 'daily', interval: 2, endCount: 3 },
        })
        .expect(200);

      expect(response.body).toMatchObject({
        title: 'Daily planning',
        description: 'Planning notes',
        holidayType: 'School',
        academicYear: '2025-26',
        recurrence: expect.objectContaining({ freq: 'daily', interval: 2, endCount: 3 }),
      });
    });

    it('rejects invalid recurrence and academic-year values through Zod', async () => {
      await request(app)
        .post(BASE)
        .set(headers)
        .send({
          title: 'Invalid recurrence',
          date: '2025-07-01',
          academicYear: '2025',
          recurrence: { freq: 'hourly' },
        })
        .expect(400);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /calendar/events — list
  // ───────────────────────────────────────────────────────────────
  describe('GET /calendar/events', () => {
    it('returns all calendar events for the school', async () => {
      // Create two events via API
      await request(app).post(BASE).set(headers).send({ title: 'Event One', date: '2025-06-01' });

      await request(app).post(BASE).set(headers).send({ title: 'Event Two', date: '2025-06-15' });

      const res = await request(app).get(BASE).set(headers).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);

      const titles = res.body.map((e) => e.title);
      expect(titles).toContain('Event One');
      expect(titles).toContain('Event Two');
    });

    it('returns empty array when no events exist', async () => {
      const res = await request(app).get(BASE).set(headers).expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('returns events in date+startTime ascending order', async () => {
      await request(app).post(BASE).set(headers).send({ title: 'Late Event', date: '2025-12-31' });

      await request(app).post(BASE).set(headers).send({ title: 'Early Event', date: '2025-01-01' });

      const res = await request(app).get(BASE).set(headers).expect(200);

      expect(res.body[0].title).toBe('Early Event');
      expect(res.body[res.body.length - 1].title).toBe('Late Event');
    });

    it('validates range query parameters and academic year', async () => {
      await request(app).get(`${BASE}?startDate=2025-07-01`).set(headers).expect(400);
      await request(app)
        .get(`${BASE}?startDate=2025-07-10&endDate=2025-07-01`)
        .set(headers)
        .expect(400);
      await request(app)
        .get(`${BASE}?startDate=2025-07-01&endDate=2025-07-10&academicYear=bad`)
        .set(headers)
        .expect(400);
    });

    it('applies endCount from the series start instead of restarting it per query window', async () => {
      await request(app)
        .post(BASE)
        .set(headers)
        .send({
          title: 'Three days only',
          date: '2025-01-01',
          recurrence: { freq: 'daily', endCount: 3 },
        });

      const finalOccurrence = await request(app)
        .get(`${BASE}?startDate=2025-01-03&endDate=2025-01-10`)
        .set(headers)
        .expect(200);
      expect(finalOccurrence.body.map((event) => event.date)).toEqual(['2025-01-03']);

      const afterSeries = await request(app)
        .get(`${BASE}?startDate=2025-01-04&endDate=2025-01-10`)
        .set(headers)
        .expect(200);
      expect(afterSeries.body).toHaveLength(0);
    });

    it('keeps the original day anchor when a monthly recurrence crosses February', async () => {
      await request(app)
        .post(BASE)
        .set(headers)
        .send({
          title: 'Month end',
          date: '2025-01-31',
          recurrence: { freq: 'monthly', endCount: 3 },
        });

      const response = await request(app)
        .get(`${BASE}?startDate=2025-01-01&endDate=2025-03-31`)
        .set(headers)
        .expect(200);
      expect(response.body.map((event) => event.date)).toEqual([
        '2025-01-31',
        '2025-02-28',
        '2025-03-31',
      ]);
    });

    it('filters explicit academic years while retaining legacy unscoped events', async () => {
      await request(app).post(BASE).set(headers).send({
        title: 'Current year',
        date: '2025-06-01',
        academicYear: '2025-26',
      });
      await request(app).post(BASE).set(headers).send({
        title: 'Other year',
        date: '2025-06-02',
        academicYear: '2024-25',
      });
      await request(app).post(BASE).set(headers).send({
        title: 'Legacy event',
        date: '2025-06-03',
      });

      const response = await request(app)
        .get(`${BASE}?startDate=2025-06-01&endDate=2025-06-30&academicYear=2025-26`)
        .set(headers)
        .expect(200);
      expect(response.body.map((event) => event.title)).toEqual(['Current year', 'Legacy event']);
    });
  });

  describe('recurring occurrence and series operations', () => {
    it('edits one occurrence without changing the rest of the series', async () => {
      await request(app)
        .post(BASE)
        .set(headers)
        .send({
          title: 'Weekly assembly',
          date: '2025-01-01',
          description: 'Original',
          recurrence: { freq: 'weekly', endCount: 3 },
        });
      const before = await request(app)
        .get(`${BASE}?startDate=2025-01-01&endDate=2025-01-31`)
        .set(headers);
      const occurrence = before.body.find((event) => event.date === '2025-01-08');
      expect(occurrence.id).toMatch(/_2025-01-08$/);

      const update = await request(app)
        .put(`${BASE}/${occurrence.id}?scope=occurrence`)
        .set(headers)
        .send({ title: 'Special assembly', description: 'Only this date' })
        .expect(200);
      expect(update.body).toMatchObject({
        title: 'Special assembly',
        date: '2025-01-08',
        isRecurrenceOverride: true,
      });

      const after = await request(app)
        .get(`${BASE}?startDate=2025-01-01&endDate=2025-01-31`)
        .set(headers);
      expect(after.body.map((event) => [event.date, event.title])).toEqual([
        ['2025-01-01', 'Weekly assembly'],
        ['2025-01-08', 'Special assembly'],
        ['2025-01-15', 'Weekly assembly'],
      ]);
    });

    it('keeps recurrence metadata when an occurrence is moved beyond the series end date', async () => {
      await request(app)
        .post(BASE)
        .set(headers)
        .send({
          title: 'Short weekly series',
          date: '2025-01-01',
          recurrence: { freq: 'weekly', endDate: '2025-01-08' },
        });
      const january = await request(app)
        .get(`${BASE}?startDate=2025-01-01&endDate=2025-01-31`)
        .set(headers)
        .expect(200);

      await request(app)
        .put(`${BASE}/${january.body[1].id}?scope=occurrence`)
        .set(headers)
        .send({ date: '2025-02-15', title: 'Moved occurrence' })
        .expect(200);

      const february = await request(app)
        .get(`${BASE}?startDate=2025-02-01&endDate=2025-02-28`)
        .set(headers)
        .expect(200);
      expect(february.body).toHaveLength(1);
      expect(february.body[0]).toMatchObject({
        title: 'Moved occurrence',
        date: '2025-02-15',
        seriesStartDate: '2025-01-01',
        isRecurrenceOverride: true,
        recurrence: expect.objectContaining({ freq: 'weekly', endDate: '2025-01-08' }),
      });
    });

    it('updates an entire series when series scope is explicit', async () => {
      await request(app)
        .post(BASE)
        .set(headers)
        .send({
          title: 'Old series title',
          date: '2025-02-01',
          recurrence: { freq: 'weekly', endCount: 2 },
        });
      const list = await request(app)
        .get(`${BASE}?startDate=2025-02-01&endDate=2025-02-28`)
        .set(headers);

      await request(app)
        .put(`${BASE}/${list.body[1].id}?scope=series`)
        .set(headers)
        .send({ title: 'New series title' })
        .expect(200);

      const after = await request(app)
        .get(`${BASE}?startDate=2025-02-01&endDate=2025-02-28`)
        .set(headers);
      expect(after.body.map((event) => event.title)).toEqual([
        'New series title',
        'New series title',
      ]);
    });

    it('deletes one occurrence by default and deletes the series only when requested', async () => {
      await request(app)
        .post(BASE)
        .set(headers)
        .send({
          title: 'Daily series',
          date: '2025-03-01',
          recurrence: { freq: 'daily', endCount: 3 },
        });
      const before = await request(app)
        .get(`${BASE}?startDate=2025-03-01&endDate=2025-03-10`)
        .set(headers);

      await request(app).delete(`${BASE}/${before.body[1].id}`).set(headers).expect(200);
      const afterOccurrenceDelete = await request(app)
        .get(`${BASE}?startDate=2025-03-01&endDate=2025-03-10`)
        .set(headers);
      expect(afterOccurrenceDelete.body.map((event) => event.date)).toEqual([
        '2025-03-01',
        '2025-03-03',
      ]);

      await request(app)
        .delete(`${BASE}/${afterOccurrenceDelete.body[0].id}?scope=series`)
        .set(headers)
        .expect(200);
      const afterSeriesDelete = await request(app)
        .get(`${BASE}?startDate=2025-03-01&endDate=2025-03-10`)
        .set(headers);
      expect(afterSeriesDelete.body).toHaveLength(0);
    });

    it('returns a validation error for malformed synthetic IDs instead of a cast error', async () => {
      await request(app)
        .put(`${BASE}/not-an-object-id_2025-03-01?scope=occurrence`)
        .set(headers)
        .send({ title: 'Bad reference' })
        .expect(400);
      await request(app)
        .delete(`${BASE}/not-an-object-id_2025-03-01?scope=occurrence`)
        .set(headers)
        .expect(400);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /calendar/events/:id — update
  // ───────────────────────────────────────────────────────────────
  describe('PUT /calendar/events/:id', () => {
    it('updates a calendar event and returns the updated document', async () => {
      const createRes = await request(app)
        .post(BASE)
        .set(headers)
        .send({ title: 'Original Title', date: '2025-07-04', type: 'meeting' });

      const eventId = createRes.body.id;

      const res = await request(app)
        .put(`${BASE}/${eventId}`)
        .set(headers)
        .send({ title: 'Updated Title', startTime: '10:00' })
        .expect(200);

      expect(res.body.title).toBe('Updated Title');
      expect(res.body.startTime).toBe('10:00');
      expect(res.body.id).toBe(eventId);
    });

    it('returns 404 for a non-existent event ID', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();

      await request(app)
        .put(`${BASE}/${fakeId}`)
        .set(headers)
        .send({ title: 'Ghost Update' })
        .expect(404);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // DELETE /calendar/events/:id — delete
  // ───────────────────────────────────────────────────────────────
  describe('DELETE /calendar/events/:id', () => {
    it('deletes a calendar event and returns success message', async () => {
      const createRes = await request(app)
        .post(BASE)
        .set(headers)
        .send({ title: 'Delete Me', date: '2025-08-01' });

      const eventId = createRes.body.id;

      const res = await request(app).delete(`${BASE}/${eventId}`).set(headers).expect(200);

      expect(res.body.message).toMatch(/deleted/i);
    });

    it('returns 404 when deleting a non-existent event', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();

      await request(app).delete(`${BASE}/${fakeId}`).set(headers).expect(404);
    });

    it('deletes only the specified event, leaving others intact', async () => {
      const r1 = await request(app)
        .post(BASE)
        .set(headers)
        .send({ title: 'Keep Me', date: '2025-09-01' });

      const r2 = await request(app)
        .post(BASE)
        .set(headers)
        .send({ title: 'Remove Me', date: '2025-09-15' });

      await request(app).delete(`${BASE}/${r2.body.id}`).set(headers).expect(200);

      const listRes = await request(app).get(BASE).set(headers).expect(200);
      const titles = listRes.body.map((e) => e.title);
      expect(titles).toContain('Keep Me');
      expect(titles).not.toContain('Remove Me');
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /calendar/templates
  // ───────────────────────────────────────────────────────────────
  describe('GET /api/calendar/templates', () => {
    it('returns template list with id, name, board, and eventCount', async () => {
      const res = await request(app).get('/api/calendar/templates').set(headers).expect(200);

      expect(Array.isArray(res.body.templates)).toBe(true);
      expect(res.body.templates.length).toBeGreaterThan(0);

      const t = res.body.templates[0];
      expect(t).toHaveProperty('id');
      expect(t).toHaveProperty('name');
      expect(t).toHaveProperty('board');
      expect(t).toHaveProperty('eventCount');
      expect(typeof t.eventCount).toBe('number');
    });

    it('returns 401 without token', async () => {
      await request(app).get('/api/calendar/templates').expect(401);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // POST /calendar/templates/:templateId/import
  // ───────────────────────────────────────────────────────────────
  describe('POST /api/calendar/templates/:templateId/import', () => {
    it('imports events from a valid template and returns created/skipped counts', async () => {
      const res = await request(app)
        .post('/api/calendar/templates/cbse/import')
        .set(headers)
        .send({ year: 2025 })
        .expect(200);

      expect(res.body).toHaveProperty('message');
      expect(Array.isArray(res.body.created)).toBe(true);
      expect(Array.isArray(res.body.skipped)).toBe(true);
      expect(res.body.created.length).toBeGreaterThan(0);
    });

    it('skips duplicate events on second import', async () => {
      await request(app)
        .post('/api/calendar/templates/cbse/import')
        .set(headers)
        .send({ year: 2025 });

      const res = await request(app)
        .post('/api/calendar/templates/cbse/import')
        .set(headers)
        .send({ year: 2025 })
        .expect(200);

      expect(res.body.skipped.length).toBeGreaterThan(0);
      expect(res.body.created.length).toBe(0);
    });

    it('returns 404 for an unknown templateId', async () => {
      await request(app)
        .post('/api/calendar/templates/unknown_board/import')
        .set(headers)
        .send({ year: 2025 })
        .expect(404);
    });

    it('returns 400 for an out-of-range year', async () => {
      await request(app)
        .post('/api/calendar/templates/cbse/import')
        .set(headers)
        .send({ year: 1990 })
        .expect(400);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // POST /calendar/conflict-check
  // ───────────────────────────────────────────────────────────────
  describe('POST /api/calendar/conflict-check', () => {
    it('returns no conflicts when no holidays exist in range', async () => {
      const res = await request(app)
        .post('/api/calendar/conflict-check')
        .set(headers)
        .send({ startDate: '2025-06-01', endDate: '2025-06-30' })
        .expect(200);

      expect(res.body).toHaveProperty('hasConflicts');
      expect(res.body).toHaveProperty('conflicts');
      expect(res.body).toHaveProperty('count');
      expect(Array.isArray(res.body.conflicts)).toBe(true);
    });

    it('detects holiday conflicts within the date range', async () => {
      // Create a holiday event in the range
      await request(app)
        .post(BASE)
        .set(headers)
        .send({ title: 'Test Holiday', date: '2025-07-15', type: 'holiday', allDay: true });

      const res = await request(app)
        .post('/api/calendar/conflict-check')
        .set(headers)
        .send({ startDate: '2025-07-01', endDate: '2025-07-31' })
        .expect(200);

      expect(res.body.hasConflicts).toBe(true);
      expect(res.body.count).toBeGreaterThanOrEqual(1);
      const titles = res.body.conflicts.map((c) => c.title);
      expect(titles).toContain('Test Holiday');
    });

    it('returns 400 when startDate is missing', async () => {
      await request(app)
        .post('/api/calendar/conflict-check')
        .set(headers)
        .send({ endDate: '2025-07-31' })
        .expect(400);
    });

    it('returns 400 when endDate is missing', async () => {
      await request(app)
        .post('/api/calendar/conflict-check')
        .set(headers)
        .send({ startDate: '2025-07-01' })
        .expect(400);
    });

    it('returns 400 for invalid date format', async () => {
      await request(app)
        .post('/api/calendar/conflict-check')
        .set(headers)
        .send({ startDate: '01-07-2025', endDate: '31-07-2025' })
        .expect(400);
    });

    it('returns 400 when startDate is after endDate', async () => {
      await request(app)
        .post('/api/calendar/conflict-check')
        .set(headers)
        .send({ startDate: '2025-07-31', endDate: '2025-07-01' })
        .expect(400);
    });

    it('respects custom types filter', async () => {
      await request(app)
        .post(BASE)
        .set(headers)
        .send({ title: 'Staff Meeting', date: '2025-08-10', type: 'meeting', allDay: true });

      const res = await request(app)
        .post('/api/calendar/conflict-check')
        .set(headers)
        .send({ startDate: '2025-08-01', endDate: '2025-08-31', types: ['meeting'] })
        .expect(200);

      expect(res.body.count).toBeGreaterThanOrEqual(1);
      expect(res.body.conflicts.some((c) => c.title === 'Staff Meeting')).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /calendar/exam-suggestions
  // ───────────────────────────────────────────────────────────────
  describe('GET /api/calendar/exam-suggestions', () => {
    it('returns suggestions array with date and dayOfWeek', async () => {
      const res = await request(app)
        .get('/api/calendar/exam-suggestions')
        .set(headers)
        .query({ startDate: '2025-09-01', endDate: '2025-11-30', examCount: 3, gapDays: 7 })
        .expect(200);

      expect(res.body).toHaveProperty('suggestions');
      expect(Array.isArray(res.body.suggestions)).toBe(true);
      expect(res.body).toHaveProperty('totalCandidateDays');
      expect(res.body).toHaveProperty('message');

      if (res.body.suggestions.length > 0) {
        const s = res.body.suggestions[0];
        expect(s).toHaveProperty('date');
        expect(s).toHaveProperty('dayOfWeek');
        expect(/^\d{4}-\d{2}-\d{2}$/.test(s.date)).toBe(true);
      }
    });

    it('returns 400 when startDate is missing', async () => {
      await request(app)
        .get('/api/calendar/exam-suggestions')
        .set(headers)
        .query({ endDate: '2025-11-30' })
        .expect(400);
    });

    it('returns 400 when endDate is missing', async () => {
      await request(app)
        .get('/api/calendar/exam-suggestions')
        .set(headers)
        .query({ startDate: '2025-09-01' })
        .expect(400);
    });

    it('returns 400 when startDate is not before endDate', async () => {
      await request(app)
        .get('/api/calendar/exam-suggestions')
        .set(headers)
        .query({ startDate: '2025-11-30', endDate: '2025-09-01' })
        .expect(400);
    });

    it('returns 401 without token', async () => {
      await request(app)
        .get('/api/calendar/exam-suggestions')
        .query({ startDate: '2025-09-01', endDate: '2025-11-30' })
        .expect(401);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /calendar/working-days
  // ───────────────────────────────────────────────────────────────
  describe('GET /api/calendar/working-days', () => {
    it('returns working day counts for a date range', async () => {
      // 2025-06-02 (Mon) to 2025-06-06 (Fri) = 5 working days, 0 holidays
      const res = await request(app)
        .get('/api/calendar/working-days')
        .set(headers)
        .query({ startDate: '2025-06-02', endDate: '2025-06-06' })
        .expect(200);

      expect(res.body).toHaveProperty('startDate', '2025-06-02');
      expect(res.body).toHaveProperty('endDate', '2025-06-06');
      expect(res.body).toHaveProperty('totalDays');
      expect(res.body).toHaveProperty('workingDays');
      expect(res.body).toHaveProperty('holidayCount');
      expect(res.body).toHaveProperty('weekendDays');
      expect(res.body.totalDays).toBe(5);
      expect(res.body.workingDays).toBe(5);
      expect(res.body.holidayCount).toBe(0);
    });

    it('excludes holidays from working day count', async () => {
      // Create a holiday on a weekday
      await request(app)
        .post(BASE)
        .set(headers)
        .send({ title: 'Working Day Holiday', date: '2025-06-04', type: 'holiday', allDay: true });

      const res = await request(app)
        .get('/api/calendar/working-days')
        .set(headers)
        .query({ startDate: '2025-06-02', endDate: '2025-06-06' })
        .expect(200);

      expect(res.body.holidayCount).toBe(1);
      expect(res.body.workingDays).toBe(4);
    });

    it('returns 400 when startDate is missing', async () => {
      await request(app)
        .get('/api/calendar/working-days')
        .set(headers)
        .query({ endDate: '2025-06-06' })
        .expect(400);
    });

    it('returns 400 when endDate is missing', async () => {
      await request(app)
        .get('/api/calendar/working-days')
        .set(headers)
        .query({ startDate: '2025-06-02' })
        .expect(400);
    });

    it('returns 400 for invalid date format', async () => {
      await request(app)
        .get('/api/calendar/working-days')
        .set(headers)
        .query({ startDate: '02-06-2025', endDate: '06-06-2025' })
        .expect(400);
    });

    it('returns 400 when startDate is after endDate', async () => {
      await request(app)
        .get('/api/calendar/working-days')
        .set(headers)
        .query({ startDate: '2025-06-10', endDate: '2025-06-02' })
        .expect(400);
    });

    it('returns 401 without token', async () => {
      await request(app)
        .get('/api/calendar/working-days')
        .query({ startDate: '2025-06-02', endDate: '2025-06-06' })
        .expect(401);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /calendar/events/export.ics
  // ───────────────────────────────────────────────────────────────
  describe('GET /api/calendar/events/export.ics', () => {
    it('returns a valid iCalendar file with correct Content-Type', async () => {
      // Create an event to export
      await request(app)
        .post(BASE)
        .set(headers)
        .send({ title: 'ICS Export Event', date: '2025-12-01', type: 'event', allDay: true });

      const res = await request(app)
        .get('/api/calendar/events/export.ics')
        .set(headers)
        .expect(200);

      expect(res.headers['content-type']).toMatch(/text\/calendar/);
      expect(res.text).toContain('BEGIN:VCALENDAR');
      expect(res.text).toContain('END:VCALENDAR');
      expect(res.text).toContain('BEGIN:VEVENT');
      expect(res.text).toContain('ICS Export Event');
    });

    it('returns an ICS file with no events when calendar is empty', async () => {
      const res = await request(app)
        .get('/api/calendar/events/export.ics')
        .set(headers)
        .expect(200);

      expect(res.text).toContain('BEGIN:VCALENDAR');
      expect(res.text).toContain('END:VCALENDAR');
      expect(res.text).not.toContain('BEGIN:VEVENT');
    });

    it('filters events by date range when startDate and endDate are provided', async () => {
      await request(app)
        .post(BASE)
        .set(headers)
        .send({ title: 'In Range Event', date: '2025-10-15', type: 'event', allDay: true });

      await request(app)
        .post(BASE)
        .set(headers)
        .send({ title: 'Out of Range Event', date: '2025-12-25', type: 'event', allDay: true });

      const res = await request(app)
        .get('/api/calendar/events/export.ics')
        .set(headers)
        .query({ startDate: '2025-10-01', endDate: '2025-10-31' })
        .expect(200);

      expect(res.text).toContain('In Range Event');
      expect(res.text).not.toContain('Out of Range Event');
    });

    it('returns 401 without token', async () => {
      await request(app).get('/api/calendar/events/export.ics').expect(401);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // Multi-tenancy
  // ───────────────────────────────────────────────────────────────
  describe('multi-tenancy', () => {
    it('admin of school A cannot see events created by school B', async () => {
      const schoolB = await createSchoolRecord({ name: 'School B', code: 'CLB' });
      const adminB = await createStaffUser({
        name: 'Cal Admin B',
        email: 'cal.b@example.com',
        schoolId: schoolB._id,
        staffRole: ['Admin'],
        permissionRole: 'admin',
      });
      const headersB = authHeadersFor(adminB, 'admin');

      // School B creates an event
      await request(app)
        .post(BASE)
        .set(headersB)
        .send({ title: 'School B Event', date: '2025-10-10' });

      // School A creates an event
      await request(app)
        .post(BASE)
        .set(headers)
        .send({ title: 'School A Event', date: '2025-10-10' });

      // School A admin should only see their own events
      const res = await request(app).get(BASE).set(headers).expect(200);
      const titles = res.body.map((e) => e.title);
      expect(titles).toContain('School A Event');
      expect(titles).not.toContain('School B Event');
    });
  });
});
