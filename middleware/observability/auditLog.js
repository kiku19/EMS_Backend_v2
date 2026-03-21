import AuditTrail from '../../models/AuditTrail.js';
import { createLogger } from '../../utils/logger.js';

const auditLogger = createLogger('AuditTrail');

const METHOD_TO_ACTION = {
  POST: 'created',
  PUT: 'updated',
  PATCH: 'updated',
  DELETE: 'deleted',
};

// Derive a human-readable entity name from the URL path segment
function extractEntity(path) {
  // Strip query string, then split on '/'
  const clean = path.split('?')[0];
  const segments = clean.split('/').filter(Boolean);

  // Skip common prefix segments like 'api', 'v1'
  const skip = new Set(['api', 'v1', 'v2']);
  const meaningful = segments.filter((s) => !skip.has(s));

  if (meaningful.length === 0) return 'unknown';

  // For /settings/* paths, use the sub-resource name for specificity
  // e.g. /settings/school → 'school', /settings/academic-year → 'academic-year'
  if (meaningful[0] === 'settings' && meaningful[1]) {
    return meaningful[1].toLowerCase();
  }

  // First meaningful segment is the entity (e.g. 'students' → 'student')
  const raw = meaningful[0].toLowerCase();
  // Simple singularization: strip trailing 's' for common plural nouns
  if (raw.endsWith('ies')) return raw.slice(0, -3) + 'y'; // categories → category
  if (raw.endsWith('es') && raw.length > 4) return raw.slice(0, -2); // classes → class
  if (raw.endsWith('s') && raw.length > 3) return raw.slice(0, -1); // students → student
  return raw;
}

// Derive entityId from URL (last path segment if it looks like a Mongo ObjectId or UUID)
function extractEntityId(path) {
  const clean = path.split('?')[0];
  const segments = clean.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (last && /^[a-f0-9]{24}$/i.test(last)) return last;
  return null;
}

// Compute field-level diff between two flat/shallow objects.
// Returns an array of { field, oldValue, newValue } for every changed top-level key.
const DIFF_SKIP_KEYS = new Set(['__v', '_id', 'createdAt', 'updatedAt', 'schoolId']);

function computeChanges(oldObj, newObj) {
  if (!oldObj || !newObj || typeof oldObj !== 'object' || typeof newObj !== 'object') return [];
  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
  const changes = [];
  for (const key of allKeys) {
    if (DIFF_SKIP_KEYS.has(key)) continue;
    const oldVal = oldObj[key];
    const newVal = newObj[key];
    try {
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changes.push({ field: key, oldValue: oldVal, newValue: newVal });
      }
    } catch {
      // Non-serializable value — skip field
    }
  }
  return changes;
}

// Strip sensitive fields before storing
const SENSITIVE_FIELDS = new Set([
  'password',
  'token',
  'secret',
  'pin',
  'otp',
  'cvv',
  'cardNumber',
]);

function sanitize(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const result = Array.isArray(obj) ? [] : {};
  for (const key of Object.keys(obj)) {
    if (SENSITIVE_FIELDS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      result[key] = sanitize(obj[key]);
    } else {
      result[key] = obj[key];
    }
  }
  return result;
}

async function createAuditEntry(req, responseBody) {
  try {
    const user = req.user;
    if (!user?.id || !user?.schoolId) return; // unauthenticated — skip

    // Allow routes to override action via req._auditAction (e.g. 'settings_changed', 'role_changed')
    let action = req._auditAction || METHOD_TO_ACTION[req.method];

    // Auto-promote settings mutations to 'settings_changed' for clearer audit trail
    if (!req._auditAction && action && req.path?.includes('/settings/')) {
      action = 'settings_changed';
    }

    if (!action) return;

    const entity = extractEntity(req.path);
    const entityId = extractEntityId(req.path) || responseBody?._id?.toString() || null;

    const ip =
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.connection?.remoteAddress ||
      req.ip;

    const sanitizedOld = req._auditOldValue ? sanitize(req._auditOldValue) : undefined;
    const sanitizedNew = sanitize(req.body);
    const changes =
      action === 'updated' && sanitizedOld ? computeChanges(sanitizedOld, sanitizedNew) : undefined;

    await AuditTrail.create({
      schoolId: user.schoolId,
      userId: user.id,
      userName: user.name || user.email || null,
      action,
      entity,
      entityId,
      method: req.method,
      path: req.path,
      changes: changes?.length ? changes : undefined,
      oldValue: sanitizedOld,
      newValue: sanitizedNew,
      ipAddress: ip,
      userAgent: req.headers['user-agent'] || null,
    });
  } catch (err) {
    // Audit logging must never break the main request
    auditLogger.error({ err }, 'Failed to write audit entry');
  }
}

/**
 * Express middleware that intercepts the response and writes an audit entry
 * for every successful (non-4xx/5xx) mutation request.
 *
 * Usage in server.js (mount BEFORE route handlers):
 *   app.use(auditLogMiddleware);
 *
 * Routes can attach pre-mutation snapshot via:
 *   req._auditOldValue = existingDocument.toObject();
 */
export function auditLogMiddleware(req, res, next) {
  if (!METHOD_TO_ACTION[req.method]) return next();

  const originalJson = res.json.bind(res);

  res.json = function (data) {
    // Only log successful mutations
    if (res.statusCode >= 200 && res.statusCode < 300) {
      createAuditEntry(req, data).catch(() => {});
    }
    return originalJson(data);
  };

  next();
}
