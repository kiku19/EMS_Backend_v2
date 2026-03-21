import crypto from 'crypto';
import FeatureFlag from '../models/FeatureFlag.js';
import FeatureFlagAuditLog from '../models/FeatureFlagAuditLog.js';
import School from '../models/School.js';
import { ensureSchoolSubscription, getEffectivePlan } from './billingService.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('FeatureFlags');

// Plan hierarchy: higher index = more capable
const PLAN_ORDER = ['starter', 'growth', 'scale'];

function isPlanSufficient(schoolPlanKey, minimumPlan) {
  const schoolIdx = PLAN_ORDER.indexOf(schoolPlanKey || 'starter');
  const requiredIdx = PLAN_ORDER.indexOf(minimumPlan || 'starter');
  return schoolIdx >= requiredIdx;
}

/**
 * Consistent hash for rollout bucketing.
 * Returns an integer 0–99 that is stable for the same (featureKey, schoolId) pair.
 */
function rolloutBucket(featureKey, schoolId) {
  const hash = crypto.createHash('sha256').update(`${featureKey}:${schoolId}`).digest('hex');
  return parseInt(hash.slice(0, 8), 16) % 100;
}

/**
 * Evaluate a single FeatureFlag document for a given school.
 * Priority order:
 *   1. Per-school override (highest — bypasses everything else)
 *   2. Time gate (availableFrom / availableUntil)
 *   3. status === 'disabled' → false
 *   4. Plan gate (minimumPlan)
 *   5. status === 'rollout' → hash-based percentage
 *   6. status === 'enabled' → true
 */
function evaluateFlag(flag, schoolId, effectivePlanKey) {
  // 1. Per-school override
  const override = flag.overrideSchools?.find((o) => String(o.schoolId) === String(schoolId));
  if (override !== undefined) {
    return override.enabled;
  }

  // 2. Time gate
  const now = new Date();
  if (flag.availableFrom && now < new Date(flag.availableFrom)) return false;
  if (flag.availableUntil && now > new Date(flag.availableUntil)) return false;

  // 3. Disabled
  if (flag.status === 'disabled') return false;

  // 4. Plan gate
  if (!isPlanSufficient(effectivePlanKey, flag.minimumPlan)) return false;

  // 5. Rollout
  if (flag.status === 'rollout') {
    return rolloutBucket(flag.key, schoolId) < flag.rolloutPercentage;
  }

  // 6. Enabled
  return flag.status === 'enabled';
}

/**
 * Check whether a single feature is enabled for a school.
 * Priority: dynamic FeatureFlag document > plan capabilities.
 * If no FeatureFlag document exists, falls back to the plan's built-in
 * capabilities so that plan-level gates work without requiring seed data.
 */
export async function isFeatureEnabled(featureKey, schoolId) {
  const [flag, subscription] = await Promise.all([
    FeatureFlag.findOne({ key: featureKey }).lean(),
    ensureSchoolSubscription(schoolId),
  ]);

  const effectivePlan = getEffectivePlan(subscription);

  if (!flag) {
    // Fall back to plan capabilities (e.g. advancedReports, aiAssistant)
    return Boolean(effectivePlan.capabilities?.[featureKey]);
  }

  return evaluateFlag(flag, schoolId, effectivePlan.key);
}

/**
 * Returns a merged feature map for a school:
 *   { features: { featureKey: boolean }, planKey, planCapabilities }
 *
 * The map starts from the plan's built-in capabilities and any dynamic
 * FeatureFlag documents layer on top (override or extend).
 */
export async function getSchoolFeatures(schoolId) {
  const [flags, subscription] = await Promise.all([
    FeatureFlag.find({}).lean(),
    ensureSchoolSubscription(schoolId),
  ]);

  const effectivePlan = getEffectivePlan(subscription);
  const planCapabilities = effectivePlan.capabilities || {};

  // Seed with plan capabilities
  const features = { ...planCapabilities };

  for (const flag of flags) {
    features[flag.key] = evaluateFlag(flag, schoolId, effectivePlan.key);
  }

  return {
    features,
    planKey: effectivePlan.key,
    planCapabilities,
  };
}

// ─── Audit Logging ─────────────────────────────────────────────────────────────

function computeChanges(oldObj, newObj) {
  if (!oldObj || !newObj) return [];
  const SKIP = new Set(['_id', '__v', 'createdAt', 'updatedAt', 'overrideSchools']);
  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
  const changes = [];
  for (const key of allKeys) {
    if (SKIP.has(key)) continue;
    try {
      if (JSON.stringify(oldObj[key]) !== JSON.stringify(newObj[key])) {
        changes.push({ field: key, oldValue: oldObj[key], newValue: newObj[key] });
      }
    } catch {
      // skip non-serializable
    }
  }
  return changes;
}

async function writeAuditLog(actor, action, flagKey, changes, metadata) {
  try {
    await FeatureFlagAuditLog.create({
      actorId: actor?.id || 'system',
      actorEmail: actor?.email || null,
      action,
      flagKey,
      changes: changes?.length ? changes : undefined,
      metadata: metadata || undefined,
    });
  } catch (err) {
    // Audit logging must never break the main operation
    logger.warn({ err, flagKey }, 'Failed to write feature flag audit entry');
  }
}

// ─── Admin CRUD ────────────────────────────────────────────────────────────────

export async function listFlags() {
  return FeatureFlag.find({}).sort({ key: 1 }).lean();
}

export async function createFlag(data, actor) {
  const flag = await FeatureFlag.create(data);
  await writeAuditLog(actor, 'created', flag.key, undefined, { data });
  return flag;
}

export async function updateFlag(key, updates, actor) {
  const existing = await FeatureFlag.findOne({ key }).lean();

  const flag = await FeatureFlag.findOneAndUpdate(
    { key },
    { $set: updates },
    { new: true, runValidators: true }
  );

  if (!flag) {
    const err = new Error('Feature flag not found');
    err.status = 404;
    throw err;
  }

  const changes = computeChanges(existing, flag.toObject());
  await writeAuditLog(actor, 'updated', key, changes, undefined);

  return flag;
}

export async function deleteFlag(key, actor) {
  const result = await FeatureFlag.findOneAndDelete({ key });

  if (!result) {
    const err = new Error('Feature flag not found');
    err.status = 404;
    throw err;
  }

  await writeAuditLog(actor, 'deleted', key, undefined, undefined);
  return result;
}

/**
 * Add or update a per-school override on a flag.
 * Pass enabled=null to remove the override.
 */
export async function setSchoolOverride(key, schoolId, enabled, actor) {
  const flag = await FeatureFlag.findOne({ key });

  if (!flag) {
    const err = new Error('Feature flag not found');
    err.status = 404;
    throw err;
  }

  // Validate that the target school actually exists
  if (enabled !== null && enabled !== undefined) {
    const schoolExists = await School.exists({ _id: schoolId });
    if (!schoolExists) {
      const err = new Error('School not found');
      err.status = 404;
      throw err;
    }
  }

  const existingIdx = flag.overrideSchools.findIndex(
    (o) => String(o.schoolId) === String(schoolId)
  );

  const action = enabled === null || enabled === undefined ? 'override_removed' : 'override_set';

  if (enabled === null || enabled === undefined) {
    // Remove override
    if (existingIdx !== -1) {
      flag.overrideSchools.splice(existingIdx, 1);
    }
  } else if (existingIdx !== -1) {
    flag.overrideSchools[existingIdx].enabled = enabled;
  } else {
    flag.overrideSchools.push({ schoolId, enabled });
  }

  await flag.save();
  await writeAuditLog(actor, action, key, undefined, { schoolId: String(schoolId), enabled });

  return flag;
}

// ─── Audit Log Queries ─────────────────────────────────────────────────────────

/**
 * List recent audit log entries.
 * @param {object} filters - Optional { flagKey, actorId }
 * @param {number} limit - Max entries to return (default 100)
 */
export async function listAuditLogs({ flagKey, actorId } = {}, limit = 100) {
  const query = {};
  if (flagKey) query.flagKey = flagKey;
  if (actorId) query.actorId = actorId;
  return FeatureFlagAuditLog.find(query).sort({ createdAt: -1 }).limit(limit).lean();
}
