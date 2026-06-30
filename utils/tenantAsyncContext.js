import { AsyncLocalStorage } from 'async_hooks';

/**
 * Request-scoped tenant context.
 *
 * The authentication middlewares set the current schoolId here; the global
 * Mongoose tenant-scope plugin reads it and automatically injects schoolId
 * into every query for models that own that field. This guarantees
 * multi-tenant isolation end-to-end without relying on every route author
 * remembering to add { schoolId } to every query.
 */
const tenantStorage = new AsyncLocalStorage();

/**
 * Run a callback with the given schoolId as the active tenant.
 * @param {string|null} schoolId
 * @param {() => any} callback
 */
export function runWithTenant(schoolId, callback) {
  return tenantStorage.run({ schoolId: schoolId || null }, callback);
}

/**
 * @returns {{ schoolId: string|null }|undefined}
 */
export function getCurrentTenant() {
  return tenantStorage.getStore();
}

/**
 * @returns {string|null}
 */
export function getCurrentSchoolId() {
  return tenantStorage.getStore()?.schoolId || null;
}
