/**
 * Unit tests for utils/examStatus.js
 *
 * Pure function tests — no database, no HTTP. We pass an explicit `now` to
 * every call so assertions are deterministic and don't depend on the test
 * suite's fake clock (tests/clockSetup.js freezes Date but we want the
 * helper's own `now` parameter to be the lever).
 */
import { describe, expect, it } from 'vitest';
import {
  effectiveExamStatus,
  withEffectiveStatus,
  EXAM_EFFECTIVE_STATUSES,
} from '../utils/examStatus.js';

const NOW = new Date('2026-06-15T12:00:00Z');
const day = (offsetMs) => new Date(NOW.getTime() + offsetMs);

describe('effectiveExamStatus', () => {
  // ── Precedence: isPublished wins over everything ──────────────────────────
  describe('published precedence', () => {
    it("returns 'results_published' when isPublished is true, even if endDate is in the future", () => {
      const exam = {
        isPublished: true,
        startDate: day(-1 * 86_400_000), // yesterday
        endDate: day(2 * 86_400_000), // day after tomorrow — still "ongoing" by dates
      };
      expect(effectiveExamStatus(exam, NOW)).toBe('results_published');
    });

    it("returns 'results_published' regardless of stored status when isPublished is true", () => {
      // Legacy row whose stored status is still 'scheduled' but results were
      // published (isPublished was set). The flag is the source of truth.
      const exam = { status: 'scheduled', isPublished: true };
      expect(effectiveExamStatus(exam, NOW)).toBe('results_published');
    });

    it('treats isPublished truthy-but-not-true (e.g. 1) as NOT published — strict boolean check', () => {
      // Only the literal `true` should count; this guards against accidental
      // coercion (e.g. a string "false" being truthy).
      const exam = { isPublished: 1, startDate: day(7 * 86_400_000) };
      expect(effectiveExamStatus(exam, NOW)).toBe('scheduled');
    });

    it('falls back to date logic when isPublished is false (unpublished exam)', () => {
      // The unpublish route clears isPublished and resets stored status to
      // 'completed'; we want the effective status to be date-derived instead.
      const exam = {
        status: 'completed',
        isPublished: false,
        startDate: day(-2 * 86_400_000),
        endDate: day(-1 * 86_400_000),
      };
      expect(effectiveExamStatus(exam, NOW)).toBe('completed');
    });
  });

  // ── Date-driven states ───────────────────────────────────────────────────
  describe('date-driven states', () => {
    it("returns 'scheduled' when now is before startDate", () => {
      const exam = { startDate: day(7 * 86_400_000), endDate: day(8 * 86_400_000) };
      expect(effectiveExamStatus(exam, NOW)).toBe('scheduled');
    });

    it("returns 'ongoing' when now is between startDate and endDate", () => {
      const exam = { startDate: day(-1 * 86_400_000), endDate: day(1 * 86_400_000) };
      expect(effectiveExamStatus(exam, NOW)).toBe('ongoing');
    });

    it("returns 'ongoing' at the exact startDate boundary", () => {
      const exam = { startDate: NOW, endDate: day(1 * 86_400_000) };
      expect(effectiveExamStatus(exam, NOW)).toBe('ongoing');
    });

    it("returns 'ongoing' at the exact endDate boundary (inclusive range)", () => {
      // An exam ending at 23:59 on the current day should still read as
      // ongoing through the end of that minute, not flip to completed early.
      const exam = { startDate: day(-1 * 86_400_000), endDate: NOW };
      expect(effectiveExamStatus(exam, NOW)).toBe('ongoing');
    });

    it("returns 'completed' when now is after endDate", () => {
      const exam = { startDate: day(-2 * 86_400_000), endDate: day(-1 * 86_400_000) };
      expect(effectiveExamStatus(exam, NOW)).toBe('completed');
    });
  });

  // ── Same-day exam ─────────────────────────────────────────────────────────
  describe('same-day exam (startDate === endDate)', () => {
    it("reads 'ongoing' at the start instant", () => {
      const moment = new Date('2026-06-15T09:00:00Z');
      const exam = { startDate: moment, endDate: moment };
      expect(effectiveExamStatus(exam, moment)).toBe('ongoing');
    });

    it("reads 'completed' once the instant has passed", () => {
      const moment = new Date('2026-06-15T09:00:00Z');
      const exam = { startDate: moment, endDate: moment };
      expect(effectiveExamStatus(exam, new Date('2026-06-15T10:00:00Z'))).toBe('completed');
    });

    it("reads 'scheduled' before the instant", () => {
      const moment = new Date('2026-06-15T09:00:00Z');
      const exam = { startDate: moment, endDate: moment };
      expect(effectiveExamStatus(exam, new Date('2026-06-15T08:00:00Z'))).toBe('scheduled');
    });
  });

  // ── Missing endDate ───────────────────────────────────────────────────────
  describe('missing endDate', () => {
    it("returns 'scheduled' before startDate", () => {
      const exam = { startDate: day(3 * 86_400_000) };
      expect(effectiveExamStatus(exam, NOW)).toBe('scheduled');
    });

    it("returns 'completed' after startDate when no end is recorded", () => {
      const exam = { startDate: day(-1 * 86_400_000) };
      expect(effectiveExamStatus(exam, NOW)).toBe('completed');
    });

    it("returns 'ongoing' exactly at startDate when there is no endDate", () => {
      const exam = { startDate: NOW };
      expect(effectiveExamStatus(exam, NOW)).toBe('ongoing');
    });

    it('ignores an invalid endDate string and falls back to start-only logic', () => {
      const exam = { startDate: day(-1 * 86_400_000), endDate: 'not-a-date' };
      expect(effectiveExamStatus(exam, NOW)).toBe('completed');
    });
  });

  // ── Missing / malformed inputs ────────────────────────────────────────────
  describe('missing or malformed inputs', () => {
    it("returns 'scheduled' for a null exam", () => {
      expect(effectiveExamStatus(null, NOW)).toBe('scheduled');
    });

    it("returns 'scheduled' for an undefined exam", () => {
      expect(effectiveExamStatus(undefined, NOW)).toBe('scheduled');
    });

    it("returns 'scheduled' when both dates are absent", () => {
      expect(effectiveExamStatus({}, NOW)).toBe('scheduled');
    });

    it("returns 'scheduled' when startDate is unparseable", () => {
      const exam = { startDate: 'banana' };
      expect(effectiveExamStatus(exam, NOW)).toBe('scheduled');
    });

    it("returns 'scheduled' when startDate is absent but isPublished is false", () => {
      const exam = { isPublished: false };
      expect(effectiveExamStatus(exam, NOW)).toBe('scheduled');
    });

    it('accepts a non-Date now (timestamp number/string) by coercing it', () => {
      const exam = { startDate: day(7 * 86_400_000) };
      // Pass the same instant as a numeric timestamp.
      expect(effectiveExamStatus(exam, NOW.getTime())).toBe('scheduled');
    });
  });

  // ── Accepts Date instances and ISO strings interchangeably ────────────────
  describe('date input formats', () => {
    it('derives correctly from ISO string dates', () => {
      const exam = {
        startDate: '2026-06-10T00:00:00Z',
        endDate: '2026-06-20T00:00:00Z',
      };
      expect(effectiveExamStatus(exam, new Date('2026-06-15T00:00:00Z'))).toBe('ongoing');
    });

    it('does not mutate the input exam object', () => {
      const exam = { startDate: day(-1 * 86_400_000), endDate: day(1 * 86_400_000) };
      const snapshot = { ...exam };
      effectiveExamStatus(exam, NOW);
      expect(exam).toEqual(snapshot);
    });
  });
});

describe('withEffectiveStatus', () => {
  it('adds effectiveStatus without overwriting the stored status', () => {
    const exam = {
      status: 'scheduled', // stored — must be preserved
      isPublished: false,
      startDate: day(-2 * 86_400_000),
      endDate: day(-1 * 86_400_000),
    };
    const out = withEffectiveStatus(exam, NOW);
    expect(out.status).toBe('scheduled'); // untouched
    expect(out.effectiveStatus).toBe('completed'); // derived
  });

  it('returns null/undefined input unchanged', () => {
    expect(withEffectiveStatus(null)).toBeNull();
    expect(withEffectiveStatus(undefined)).toBeUndefined();
  });

  it('always produces a value inside EXAM_EFFECTIVE_STATUSES', () => {
    const exam = { startDate: day(-1 * 86_400_000), endDate: day(1 * 86_400_000) };
    const out = withEffectiveStatus(exam, NOW);
    expect(EXAM_EFFECTIVE_STATUSES).toContain(out.effectiveStatus);
  });

  it('does not mutate the original object', () => {
    const exam = { status: 'scheduled', startDate: day(-1 * 86_400_000) };
    withEffectiveStatus(exam, NOW);
    expect(exam).not.toHaveProperty('effectiveStatus');
  });
});
