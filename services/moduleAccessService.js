/**
 * moduleAccessService — resolves (and caches) a school's effective enabled-module
 * set. The result is read on every authenticated /api request by the
 * moduleAccess middleware, so it MUST be cheap. We cache per schoolId with a
 * short TTL and invalidate explicitly whenever Settings → Modules is saved.
 */
import School from '../models/School.js';
import { resolveEnabledModules } from '../config/moduleRegistry.js';

const TTL_MS = 30_000;

/** @type {Map<string, { expiresAt: number, value: { managed: boolean, enabled: Set<string> } }>} */
const cache = new Map();

/**
 * Returns { managed, enabled } for a school. `managed=false` means the school
 * predates the feature → caller should allow everything (no gating).
 */
export async function getEnabledModules(schoolId) {
  if (!schoolId) {
    // No tenant context — fail open here; auth/tenant middleware is responsible
    // for rejecting tenant-less requests. Gating a missing school would 403 the
    // whole API.
    return { managed: false, enabled: null };
  }

  const key = String(schoolId);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const school = await School.findById(schoolId).select('enabledModules').lean();
  const value = resolveEnabledModules(school?.enabledModules);
  cache.set(key, { expiresAt: now + TTL_MS, value });
  return value;
}

/** Drop the cached entry for a school (call after updating enabledModules). */
export function invalidateModuleCache(schoolId) {
  if (schoolId) cache.delete(String(schoolId));
}

/** Test/maintenance helper. */
export function clearModuleCache() {
  cache.clear();
}
