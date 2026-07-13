import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { School, Staff, Student } from '../database.js';
import { authenticate, requireSuperAdmin } from '../middleware/auth.js';
import {
  validateZod,
  superAdminCreateSchoolSchema,
  superAdminUpdateSchoolSchema,
  superAdminProvisionSchoolSchema,
  superAdminModulesSchema,
  mongoIdParamSchema,
} from '../validators/index.js';
import {
  onboardSchool,
  provisionSchoolResources,
  serializeProvisionedAdmin,
  serializeProvisioningResult,
} from '../services/schoolProvisioningService.js';
import { normalizeSchoolCode, serializeSchool } from '../utils/schoolContext.js';
import { getAllSchoolsUsage, BILLING_PLANS } from '../services/billingService.js';
import { getSchoolFeatures } from '../services/featureFlagsService.js';
import { invalidateModuleCache } from '../services/moduleAccessService.js';
import FeatureFlag from '../models/FeatureFlag.js';
import {
  TOGGLEABLE_MODULES,
  resolveEnabledModules,
  normalizeToggleableSelection,
} from '../config/moduleRegistry.js';
import {
  getAllSchoolsMetricsSummary,
  getDauMauWau,
  getFeatureAdoption,
  getDauTrend,
} from '../services/businessMetricsService.js';
import {
  getAllSchoolsGrowthReport,
  getSchoolGrowthReport,
  getFeatureActivationFunnel,
} from '../services/growthAnalyticsService.js';
import { getRateLimitViolationStats } from '../middleware/tenantRateLimit.js';
import agenda from '../config/agenda.js';

const router = express.Router();

async function loadSchoolSummary(schools) {
  const schoolIds = schools.map((school) => school._id);
  const [staffCounts, admins] = await Promise.all([
    Staff.aggregate([
      { $match: { schoolId: { $in: schoolIds } } },
      { $group: { _id: '$schoolId', total: { $sum: 1 } } },
    ]),
    Staff.find({ schoolId: { $in: schoolIds }, role: 'Admin' })
      .select('schoolId name email phone status createdAt')
      .sort({ createdAt: 1 })
      .lean(),
  ]);

  const countsBySchoolId = new Map(staffCounts.map((entry) => [String(entry._id), entry.total]));
  const adminBySchoolId = new Map();

  admins.forEach((admin) => {
    const schoolId = String(admin.schoolId);
    if (!adminBySchoolId.has(schoolId)) {
      adminBySchoolId.set(schoolId, admin);
    }
  });

  return schools.map((school) => ({
    ...serializeSchool(school),
    counts: {
      staff: countsBySchoolId.get(String(school._id)) || 0,
    },
    admin: serializeProvisionedAdmin(adminBySchoolId.get(String(school._id))),
  }));
}

function buildOverview(schools) {
  return schools.reduce(
    (summary, school) => {
      summary.totalSchools += 1;

      if (school.status === 'active') {
        summary.activeSchools += 1;
      }

      if (school.planStatus === 'trialing') {
        summary.trialingSchools += 1;
      }

      if (school.planStatus === 'cancelled' || school.status === 'inactive') {
        summary.attentionNeeded += 1;
      }

      return summary;
    },
    {
      totalSchools: 0,
      activeSchools: 0,
      trialingSchools: 0,
      attentionNeeded: 0,
    }
  );
}

router.use(authenticate, requireSuperAdmin);

router.get('/overview', async (_req, res) => {
  try {
    const schools = await School.find().lean();
    res.json(buildOverview(schools));
  } catch (error) {
    console.error('Error loading super admin overview:', error);
    res.status(500).json({ error: 'Failed to load overview' });
  }
});

router.get('/schools', async (_req, res) => {
  try {
    const schools = await School.find().sort({ createdAt: -1 });
    res.json(await loadSchoolSummary(schools));
  } catch (error) {
    console.error('Error loading schools:', error);
    res.status(500).json({ error: 'Failed to load schools' });
  }
});

router.post(
  '/schools',
  (req, res, next) => {
    process.stdout.write(`[SUPERADMIN-DEBUG] validateZod middleware reached\n`);
    next();
  },
  validateZod(superAdminCreateSchoolSchema),
  async (req, res) => {
    process.stdout.write('[SUPERADMIN-DEBUG] POST /schools handler called\n');
    try {
      const result = await onboardSchool({
        ...req.body,
        provisionedBy: req.user.email || req.user.name || 'super-admin',
        source: 'super-admin-dashboard',
      });

      res.status(201).json(serializeProvisioningResult(result));
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({ error: 'A school with these details already exists' });
      }

      process.stdout.write(
        `[SUPERADMIN-DEBUG] Error onboarding school: ${error.message}\n${error.stack}\n`
      );
      res.status(500).json({ error: 'Failed to onboard school', detail: error.message });
    }
  }
);

router.patch(
  '/schools/:id',
  validateZod(mongoIdParamSchema, 'params'),
  validateZod(superAdminUpdateSchoolSchema),
  async (req, res) => {
    try {
      const school = await School.findById(req.params.id);

      if (!school) {
        return res.status(404).json({ error: req.t('common:errors.schoolNotFound') });
      }

      if (req.body.schoolName) {
        school.name = req.body.schoolName.trim();
      }

      if (req.body.schoolCode) {
        school.code = normalizeSchoolCode(req.body.schoolCode);
      }

      Object.assign(school, {
        ...(req.body.status ? { status: req.body.status } : {}),
        ...(req.body.plan ? { plan: req.body.plan } : {}),
        ...(req.body.planStatus ? { planStatus: req.body.planStatus } : {}),
        ...(req.body.trialEndsAt !== undefined
          ? { trialEndsAt: req.body.trialEndsAt || null }
          : {}),
        ...(req.body.contactEmail !== undefined
          ? { contactEmail: req.body.contactEmail || null }
          : {}),
        ...(req.body.contactPhone !== undefined
          ? { contactPhone: req.body.contactPhone || null }
          : {}),
        ...(req.body.frontendUrl !== undefined
          ? { frontendUrl: req.body.frontendUrl || null }
          : {}),
        ...(req.body.backendUrl !== undefined ? { backendUrl: req.body.backendUrl || null } : {}),
      });

      await school.save();
      res.json({ school: serializeSchool(school) });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({ error: 'School code is already in use' });
      }

      console.error('Error updating school:', error);
      res.status(500).json({ error: 'Failed to update school' });
    }
  }
);

router.post(
  '/schools/:id/provision',
  validateZod(mongoIdParamSchema, 'params'),
  validateZod(superAdminProvisionSchoolSchema),
  async (req, res) => {
    try {
      const school = await School.findById(req.params.id);

      if (!school) {
        return res.status(404).json({ error: req.t('common:errors.schoolNotFound') });
      }

      const result = await provisionSchoolResources({
        school,
        adminName: req.body.adminName,
        adminEmail: req.body.adminEmail || school.contactEmail,
        adminPassword: req.body.adminPassword,
        contactPhone: req.body.contactPhone || school.contactPhone,
        schoolSettings: req.body.schoolSettings,
        provisionedBy: req.user.email || req.user.name || 'super-admin',
        source: 'super-admin-reprovision',
      });

      res.json(serializeProvisioningResult(result));
    } catch (error) {
      console.error('Error provisioning school:', error);
      res.status(500).json({ error: 'Failed to provision school' });
    }
  }
);

// ─── Phase 4: unified feature control plane ────────────────────────────────
// Returns one school's full feature posture: which modules are on/off, the
// effective plan + its built-in capabilities, and every feature flag's
// effective state + whether a per-school override is in force. This is the
// single read the ops console needs to render the per-school control panel.

router.get('/schools/:id/features', validateZod(mongoIdParamSchema, 'params'), async (req, res) => {
  try {
    const school = await School.findById(req.params.id).lean();
    if (!school) {
      return res.status(404).json({ error: req.t('common:errors.schoolNotFound') });
    }

    const { managed, enabled } = resolveEnabledModules(school.enabledModules);
    const modules = TOGGLEABLE_MODULES.map((m) => ({
      key: m.key,
      label: m.label,
      group: m.group,
      description: m.description,
      enabled: enabled.has(m.key),
    }));

    // Effective feature values + plan (getSchoolFeatures auto-provisions a
    // subscription if one doesn't exist yet, so this never 404s on billing).
    const { features, planKey, planCapabilities } = await getSchoolFeatures(school._id);
    const plan = BILLING_PLANS[planKey] || BILLING_PLANS.starter;

    // Flag metadata + override presence per flag for this school.
    const flagDocs = await FeatureFlag.find({}).sort({ key: 1 }).lean();
    const flags = flagDocs.map((flag) => {
      const override = flag.overrideSchools?.find((o) => String(o.schoolId) === String(school._id));
      return {
        key: flag.key,
        name: flag.name,
        description: flag.description,
        status: flag.status,
        minimumPlan: flag.minimumPlan,
        effectiveEnabled: Boolean(features[flag.key]),
        hasOverride: Boolean(override),
        overrideEnabled: override ? override.enabled : null,
      };
    });

    res.json({
      school: {
        id: school._id,
        name: school.name,
        code: school.code,
        status: school.status,
        plan: planKey,
        planStatus: school.planStatus,
      },
      managed,
      modules,
      plan: {
        key: plan.key,
        name: plan.name,
        capabilities: planCapabilities,
        limits: plan.limits,
      },
      flags,
    });
  } catch (error) {
    console.error('Error loading school features:', error);
    res.status(500).json({ error: 'Failed to load school features' });
  }
});

router.patch(
  '/schools/:id/modules',
  validateZod(mongoIdParamSchema, 'params'),
  validateZod(superAdminModulesSchema),
  async (req, res) => {
    try {
      const school = await School.findById(req.params.id);
      if (!school) {
        return res.status(404).json({ error: req.t('common:errors.schoolNotFound') });
      }

      // Normalize so core keys can never be stored and unknown keys are dropped.
      school.enabledModules = normalizeToggleableSelection(req.body.enabledModules);
      await school.save();

      // Bust the module-access cache so the change takes effect immediately on
      // gated /api/* requests. Without this, moduleAccessGuard serves stale
      // results for up to its TTL (30s) — the self-service PUT /settings/modules
      // route already does this; the super-admin path must match.
      invalidateModuleCache(school._id);

      const { enabled } = resolveEnabledModules(school.enabledModules);
      res.json({
        school: { id: school._id, name: school.name, code: school.code },
        enabledModules: school.enabledModules,
        modules: TOGGLEABLE_MODULES.map((m) => ({ key: m.key, enabled: enabled.has(m.key) })),
      });
    } catch (error) {
      console.error('Error updating school modules:', error);
      res.status(500).json({ error: 'Failed to update modules' });
    }
  }
);

router.get('/usage', async (_req, res) => {
  try {
    const usageData = await getAllSchoolsUsage();
    res.json({ schools: usageData, total: usageData.length });
  } catch (error) {
    console.error('Error loading super admin usage:', error);
    res.status(500).json({ error: 'Failed to load usage data' });
  }
});

/**
 * GET /super-admin/rate-limit-stats
 * Returns per-school rate-limit violation counts (rolling 15-minute window).
 * Only schools that have triggered at least one 429 appear in the results.
 */
router.get('/rate-limit-stats', authenticate, requireSuperAdmin, async (_req, res) => {
  try {
    const schools = await School.find({}).select('_id name').lean();
    const schoolIds = schools.map((s) => String(s._id));
    const violationCounts = await getRateLimitViolationStats(schoolIds);

    const results = schools
      .map((school) => ({
        schoolId: String(school._id),
        name: school.name,
        violations: violationCounts[String(school._id)] || 0,
      }))
      .filter((entry) => entry.violations > 0)
      .sort((a, b) => b.violations - a.violations);

    res.json({ schools: results, total: results.length });
  } catch (error) {
    console.error('Error loading rate limit stats:', error);
    res.status(500).json({ error: 'Failed to load rate limit stats' });
  }
});

// ─── Per-School Health Monitor (AUDIT-18) ────────────────────────────────────

/**
 * GET /super-admin/school-health
 * Returns per-school health monitoring data combining:
 *  - Health score, churn risk, trend (from growth analytics)
 *  - Student and staff counts
 *  - Rate-limit violations (rolling 15-min window)
 * Covers all schools (active and inactive), not just active ones.
 */
router.get('/school-health', async (_req, res) => {
  try {
    const schools = await School.find().sort({ createdAt: -1 }).lean();
    const schoolIds = schools.map((s) => s._id);
    const schoolIdStrings = schoolIds.map(String);

    const [staffCounts, studentCounts, rateLimitStats, growthReport] = await Promise.all([
      Staff.aggregate([
        { $match: { schoolId: { $in: schoolIds } } },
        { $group: { _id: '$schoolId', total: { $sum: 1 } } },
      ]),
      Student.aggregate([
        { $match: { schoolId: { $in: schoolIds }, isDeleted: { $ne: true } } },
        { $group: { _id: '$schoolId', total: { $sum: 1 } } },
      ]),
      getRateLimitViolationStats(schoolIdStrings),
      getAllSchoolsGrowthReport(),
    ]);

    const staffMap = new Map(staffCounts.map((e) => [String(e._id), e.total]));
    const studentMap = new Map(studentCounts.map((e) => [String(e._id), e.total]));
    const growthMap = new Map((growthReport.schools || []).map((s) => [s.schoolId, s]));

    const result = schools.map((school) => {
      const id = String(school._id);
      const health = growthMap.get(id);
      return {
        schoolId: id,
        name: school.name,
        code: school.code,
        status: school.status,
        plan: school.plan,
        planStatus: school.planStatus,
        trialEndsAt: school.trialEndsAt || null,
        studentsCount: studentMap.get(id) || 0,
        staffCount: staffMap.get(id) || 0,
        rateLimitViolations: rateLimitStats[id] || 0,
        healthScore: health?.healthScore ?? null,
        churnRisk: health?.churnRisk ?? null,
        trend: health?.trend ?? null,
        daysSinceLastActive: health?.daysSinceLastActive ?? null,
        dauLast7d: health?.dauLast7d ?? null,
        featuresUsedCount: health?.featuresUsedCount ?? null,
        isFullyActivated: health?.isFullyActivated ?? false,
        scoreBreakdown: health?.scoreBreakdown ?? null,
      };
    });

    res.json({ schools: result, total: result.length });
  } catch (err) {
    console.error('School health monitor error:', err);
    res.status(500).json({ error: 'Failed to load school health data' });
  }
});

// ─── Business Metrics Dashboard (OBS-04) ─────────────────────────────────────

/**
 * GET /super-admin/business-metrics
 * Returns DAU/WAU/MAU and API call summary for all active schools.
 */
router.get('/business-metrics', async (_req, res) => {
  try {
    const summary = await getAllSchoolsMetricsSummary();
    res.json({ schools: summary, total: summary.length });
  } catch (err) {
    console.error('Business metrics overview error:', err);
    res.status(500).json({ error: 'Failed to load business metrics' });
  }
});

/**
 * GET /super-admin/business-metrics/:schoolId
 * Returns detailed engagement + feature adoption + DAU trend for one school.
 * Query param: days (default 30, max 90)
 */
router.get('/business-metrics/:schoolId', async (req, res) => {
  try {
    const { schoolId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return res.status(400).json({ error: 'Invalid school ID' });
    }

    const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));

    const [engagement, adoption, trend] = await Promise.all([
      getDauMauWau(schoolId),
      getFeatureAdoption(schoolId, days),
      getDauTrend(schoolId, days),
    ]);

    res.json({ schoolId, days, engagement, ...adoption, dauTrend: trend });
  } catch (err) {
    console.error('Business metrics school detail error:', err);
    res.status(500).json({ error: 'Failed to load school business metrics' });
  }
});

// ─── Growth Analytics (GROWTH-07) ────────────────────────────────────────────

/**
 * GET /super-admin/growth-analytics
 * Returns health scores, churn risk, and trend for all active schools.
 * Sorted by health score ascending (most at-risk first).
 */
router.get('/growth-analytics', async (_req, res) => {
  try {
    const report = await getAllSchoolsGrowthReport();
    res.json(report);
  } catch (err) {
    console.error('Growth analytics overview error:', err);
    res.status(500).json({ error: 'Failed to load growth analytics' });
  }
});

/**
 * GET /super-admin/growth-analytics/funnel
 * Returns feature activation funnel across all active schools.
 */
router.get('/growth-analytics/funnel', async (_req, res) => {
  try {
    const funnel = await getFeatureActivationFunnel();
    res.json(funnel);
  } catch (err) {
    console.error('Growth funnel error:', err);
    res.status(500).json({ error: 'Failed to load feature activation funnel' });
  }
});

/**
 * GET /super-admin/growth-analytics/:schoolId
 * Returns detailed growth report for one school.
 */
router.get('/growth-analytics/:schoolId', async (req, res) => {
  try {
    const { schoolId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return res.status(400).json({ error: 'Invalid school ID' });
    }
    const report = await getSchoolGrowthReport(schoolId);
    res.json(report);
  } catch (err) {
    console.error('Growth analytics school detail error:', err);
    res.status(500).json({ error: 'Failed to load school growth report' });
  }
});

// ─── Background Job Dashboard (super-admin only) ───────────────────────────

function getJobsCollection() {
  return mongoose.connection.db.collection(process.env.AGENDA_DB_COLLECTION || 'jobs');
}

function computeJobStatus(job) {
  if (job.lockedAt && !job.lastFinishedAt) return 'running';
  if (job.failedAt) return 'failed';
  if (job.nextRunAt && new Date(job.nextRunAt) > new Date()) return 'scheduled';
  return 'completed';
}

function serializeAgendaJob(job) {
  return {
    _id: job._id,
    name: job.name,
    type: job.type || 'normal',
    priority: job.priority,
    data: job.data,
    nextRunAt: job.nextRunAt,
    lastRunAt: job.lastRunAt,
    lastFinishedAt: job.lastFinishedAt,
    lockedAt: job.lockedAt,
    failedAt: job.failedAt,
    failReason: job.failReason,
    repeatInterval: job.repeatInterval,
    repeatTimezone: job.repeatTimezone,
    status: computeJobStatus(job),
  };
}

const scheduleJobSchema = z
  .object({
    name: z.string().min(1),
    data: z.record(z.string(), z.unknown()).optional(),
    when: z.string().optional(),
    interval: z.string().optional(),
  })
  .refine((d) => d.when || d.interval, { message: 'Either when or interval is required' });

// GET /super-admin/jobs/metrics
router.get('/jobs/metrics', async (_req, res) => {
  try {
    const col = getJobsCollection();
    const now = new Date();
    const [total, running, failed, scheduled, completedSample] = await Promise.all([
      col.countDocuments({}),
      col.countDocuments({ lockedAt: { $ne: null }, lastFinishedAt: null }),
      col.countDocuments({ failedAt: { $ne: null } }),
      col.countDocuments({ nextRunAt: { $gt: now }, failedAt: null }),
      col
        .find({ lastRunAt: { $ne: null }, lastFinishedAt: { $ne: null } })
        .project({ lastRunAt: 1, lastFinishedAt: 1 })
        .limit(100)
        .toArray(),
    ]);

    let avgExecutionMs = null;
    if (completedSample.length > 0) {
      const sum = completedSample.reduce(
        (acc, j) => acc + (new Date(j.lastFinishedAt) - new Date(j.lastRunAt)),
        0
      );
      avgExecutionMs = Math.round(sum / completedSample.length);
    }

    res.json({
      total,
      running,
      failed,
      scheduled,
      completed: Math.max(0, total - running - failed - scheduled),
      avgExecutionMs,
      failureRate: total > 0 ? Math.round((failed / total) * 100) : 0,
      queueDepth: scheduled,
    });
  } catch (err) {
    console.error('Job metrics error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /super-admin/jobs/dead-letter
router.get('/jobs/dead-letter', async (_req, res) => {
  try {
    const col = getJobsCollection();
    const jobs = await col
      .find({ failedAt: { $ne: null } })
      .sort({ failedAt: -1 })
      .limit(100)
      .toArray();
    res.json({ jobs: jobs.map(serializeAgendaJob), total: jobs.length });
  } catch (err) {
    console.error('Dead letter queue error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /super-admin/jobs/schedule
router.post('/jobs/schedule', validateZod(scheduleJobSchema), async (req, res) => {
  try {
    const { name, data = {}, when, interval } = req.body;
    if (interval) {
      await agenda.every(interval, name, data);
    } else {
      await agenda.schedule(when, name, data);
    }
    res.status(201).json({ message: `Job '${name}' scheduled successfully` });
  } catch (err) {
    console.error('Schedule job error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /super-admin/jobs
router.get('/jobs', async (req, res) => {
  try {
    const { status, name, page = 1, limit = 20 } = req.query;
    const filter = {};
    const now = new Date();

    if (name) filter.name = { $regex: String(name), $options: 'i' };
    if (status === 'running') {
      filter.lockedAt = { $ne: null };
      filter.lastFinishedAt = null;
    } else if (status === 'failed') {
      filter.failedAt = { $ne: null };
    } else if (status === 'scheduled') {
      filter.nextRunAt = { $gt: now };
      filter.failedAt = null;
    } else if (status === 'completed') {
      filter.lastFinishedAt = { $ne: null };
      filter.failedAt = null;
      filter.nextRunAt = null;
    }

    const col = getJobsCollection();
    const skip = (Number(page) - 1) * Number(limit);
    const [jobs, total] = await Promise.all([
      col
        .find(filter)
        .sort({ lastRunAt: -1, nextRunAt: 1 })
        .skip(skip)
        .limit(Number(limit))
        .toArray(),
      col.countDocuments(filter),
    ]);

    res.json({
      jobs: jobs.map(serializeAgendaJob),
      total,
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err) {
    console.error('Jobs list error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /super-admin/jobs/:jobId
router.get('/jobs/:jobId', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.jobId)) {
      return res.status(400).json({ error: 'Invalid job ID' });
    }
    const col = getJobsCollection();
    const job = await col.findOne({ _id: new mongoose.Types.ObjectId(req.params.jobId) });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({ job: serializeAgendaJob(job) });
  } catch (err) {
    console.error('Job detail error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /super-admin/jobs/:jobId/retry
router.post('/jobs/:jobId/retry', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.jobId)) {
      return res.status(400).json({ error: 'Invalid job ID' });
    }
    const col = getJobsCollection();
    const job = await col.findOne({ _id: new mongoose.Types.ObjectId(req.params.jobId) });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!job.failedAt) return res.status(400).json({ error: 'Only failed jobs can be retried' });

    await col.updateOne(
      { _id: new mongoose.Types.ObjectId(req.params.jobId) },
      {
        $set: { failedAt: null, failReason: null, nextRunAt: new Date() },
        $unset: { lockedAt: '' },
      }
    );
    res.json({ message: 'Job queued for retry' });
  } catch (err) {
    console.error('Retry job error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /super-admin/jobs/:jobId
router.delete('/jobs/:jobId', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.jobId)) {
      return res.status(400).json({ error: 'Invalid job ID' });
    }
    const col = getJobsCollection();
    const result = await col.deleteOne({ _id: new mongoose.Types.ObjectId(req.params.jobId) });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Job not found' });
    res.json({ message: 'Job cancelled and removed' });
  } catch (err) {
    console.error('Cancel job error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
