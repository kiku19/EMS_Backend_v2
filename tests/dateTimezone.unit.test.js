import { describe, expect, it } from 'vitest';
import { localDateString, localTodayString } from '../utils/dateTimezone.js';

describe('dateTimezone helpers', () => {
  it('returns the local date in Asia/Kolkata for UTC instants that span midnight', () => {
    // 30-Mar-2026 19:45 UTC → 01:15 IST on 31-Mar-2026
    const afterUtcMidnightIst = new Date(Date.UTC(2026, 2, 30, 19, 45));
    expect(localDateString(afterUtcMidnightIst)).toBe('2026-03-31');
    expect(localDateString(afterUtcMidnightIst, 'UTC')).toBe('2026-03-30');

    // 31-Mar-2026 00:30 UTC → 06:00 IST on 31-Mar-2026
    const istMorning = new Date(Date.UTC(2026, 2, 31, 0, 30));
    expect(localDateString(istMorning)).toBe('2026-03-31');

    // 31-Mar-2026 18:30 UTC → 00:00 IST on 01-Apr-2026 — the evening rollover
    // that made /today-snapshot show yesterday's data.
    const evening = new Date(Date.UTC(2026, 2, 31, 18, 30));
    expect(localDateString(evening)).toBe('2026-04-01');
    expect(localDateString(evening, 'UTC')).toBe('2026-03-31');
  });

  it('localTodayString returns an ISO-shaped date string', () => {
    const today = localTodayString();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('accepts an explicit timezone override for multi-region tenants', () => {
    // 01-Apr-2026 02:30 UTC
    const instant = new Date(Date.UTC(2026, 3, 1, 2, 30));
    expect(localDateString(instant, 'America/New_York')).toBe('2026-03-31'); // 22:30 EDT prior day
    expect(localDateString(instant, 'Asia/Kolkata')).toBe('2026-04-01'); // 08:00 IST same day
  });
});
