import School from '../../models/School.js';

// schoolStatusGuard — blocks API access for suspended/locked/churned schools.
//
// Runs after authenticate (so req.user.schoolId is known). Super-admin has no
// school and bypasses entirely. Billing stays reachable so a suspended school
// can still pay and self-reactivate. Everything else returns 403 SCHOOL_SUSPENDED.
//
// 'inactive' is intentionally NOT blocked — it's a legacy dormant state and
// blocking it would lock out schools that have always been marked inactive.
//
// School status is cached per-process for a short window to avoid a DB lookup
// on every request. Lifecycle endpoints call invalidateSchoolStatusCache() so a
// suspend/reactivate takes effect immediately on this process; other processes
// converge within TTL_SECONDS.

const TTL_SECONDS = 30;
const BLOCKED_STATUSES = new Set(['suspended', 'locked', 'churned']);
const cache = new Map(); // schoolId(string) -> { status, expiresAt }

// Paths a blocked school must still reach (billing = pay to reactivate).
// /auth and /public mount BEFORE the authenticate barrier so never reach here.
function isExemptPath(path) {
  return typeof path === 'string' && path.includes('/billing');
}

export async function getCachedSchoolStatus(schoolId) {
  const key = String(schoolId);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.status;

  const school = await School.findById(schoolId).select('status').lean();
  const status = school?.status || 'active';
  cache.set(key, { status, expiresAt: now + TTL_SECONDS * 1000 });
  return status;
}

export function invalidateSchoolStatusCache(schoolId) {
  if (schoolId) cache.delete(String(schoolId));
}

export async function schoolStatusGuard(req, res, next) {
  try {
    // No school on the request → super-admin / platform-level → bypass.
    if (!req.user?.schoolId) return next();
    if (isExemptPath(req.path)) return next();

    const status = await getCachedSchoolStatus(req.user.schoolId);
    if (BLOCKED_STATUSES.has(status)) {
      return res.status(403).json({
        error: 'School access is suspended',
        code: 'SCHOOL_SUSPENDED',
        status,
        message:
          'This school’s access is currently suspended. Please contact support or clear outstanding dues.',
      });
    }
    next();
  } catch {
    // Fail open: a cache/DB error must never lock out a healthy school.
    next();
  }
}

export default schoolStatusGuard;
