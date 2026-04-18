/**
 * Local-date helpers for attendance / date-bounded business logic.
 *
 * Why this exists: `new Date().toISOString().split('T')[0]` returns the UTC
 * date, so between UTC midnight (~5:30 IST) and the next local midnight every
 * endpoint that compared against "today" / "past" / "future" was off by a
 * day for Indian users. Attendance got rejected as "future date" in the
 * IST morning, and the /today-snapshot dashboard showed yesterday's data
 * after ~6:30pm IST.
 *
 * Default timezone is Asia/Kolkata — the platform's current target market.
 * If/when multi-region tenants land, hang a `timezone` field off
 * SchoolSettings and pass it in per call. The helpers already accept an
 * optional `timeZone` arg so that migration is one-line.
 */

const DEFAULT_TIMEZONE = process.env.DEFAULT_SCHOOL_TIMEZONE || 'Asia/Kolkata';

/**
 * Get the YYYY-MM-DD date string in the given timezone (defaults to
 * DEFAULT_TIMEZONE). Stable format — Intl.DateTimeFormat with
 * `en-CA` yields ISO-shaped dates on every Node version.
 */
export function localDateString(date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Today in the given timezone as YYYY-MM-DD. Convenience wrapper.
 */
export function localTodayString(timeZone = DEFAULT_TIMEZONE) {
  return localDateString(new Date(), timeZone);
}
