/**
 * GROWTH-07: Growth Analytics Service
 *
 * Computes product-led growth signals per school:
 *  - Health score (0–100): composite of feature breadth, activity recency, and trend
 *  - Churn risk: high / medium / low based on health score and recency
 *  - Feature activation funnel: % of schools that have used each module
 *  - Growth trend: DAU direction over rolling windows
 *
 * All reads come from SchoolMetricSnapshot and UserDayActivity (already populated
 * by the existing businessMetricsTracker middleware). No additional writes needed.
 */

import mongoose from 'mongoose';
import SchoolMetricSnapshot from '../models/SchoolMetricSnapshot.js';
import UserDayActivity from '../models/UserDayActivity.js';
import School from '../models/School.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('GrowthAnalytics');

// All feature modules tracked in SchoolMetricSnapshot
const ALL_FEATURES = [
  'students',
  'classes',
  'attendance',
  'exams',
  'fees',
  'staff',
  'messaging',
  'timetable',
  'homework',
  'library',
  'transport',
  'frontDesk',
  'payroll',
  'parentApp',
  'staffApp',
];

// Core features expected of an "activated" school
const CORE_FEATURES = ['students', 'classes', 'attendance', 'fees'];

function dateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Compute a 0–100 health score for one school using recent snapshots.
 *
 * Scoring breakdown:
 *  - Feature breadth  (0–40): how many of 15 modules were used in last 30 days
 *  - Activity recency (0–30): decays linearly as days-since-last-active increases
 *  - DAU trend        (0–20): last-7d DAU vs prev-7d DAU
 *  - Mobile adoption  (0–10): mobile share of API calls
 */
function computeHealthScore({ snapshots30d, dauLast7, dauPrev7, daysSinceLastActive }) {
  // ── Feature breadth ─────────────────────────────────────────────────────────
  const featureSet = new Set();
  for (const snap of snapshots30d) {
    for (const [mod, count] of Object.entries(snap.features || {})) {
      if (count > 0) featureSet.add(mod);
    }
  }
  const breadthScore = Math.round((featureSet.size / ALL_FEATURES.length) * 40);

  // ── Activity recency ────────────────────────────────────────────────────────
  const recencyScore = Math.max(0, 30 - Math.min(30, daysSinceLastActive * 2));

  // ── DAU trend ───────────────────────────────────────────────────────────────
  let trendScore = 10; // neutral baseline
  if (dauLast7 > dauPrev7 * 1.1)
    trendScore = 20; // growing >10%
  else if (dauLast7 < dauPrev7 * 0.8)
    trendScore = 0; // declining >20%
  else if (dauPrev7 === 0 && dauLast7 > 0) trendScore = 20; // first users

  // ── Mobile adoption ─────────────────────────────────────────────────────────
  const totalCalls = snapshots30d.reduce((acc, s) => acc + (s.apiCalls || 0), 0);
  const mobileCalls = snapshots30d.reduce((acc, s) => acc + (s.clients?.mobile || 0), 0);
  const mobilePct = totalCalls > 0 ? mobileCalls / totalCalls : 0;
  const mobileScore = Math.round(Math.min(1, mobilePct / 0.1) * 10);

  const total = breadthScore + recencyScore + trendScore + mobileScore;
  return {
    score: Math.min(100, total),
    breadthScore,
    recencyScore,
    trendScore,
    mobileScore,
    featuresUsed: [...featureSet],
  };
}

/**
 * Determine churn risk level from health score and recency.
 */
function churnRisk(healthScore, daysSinceLastActive) {
  if (healthScore < 30 || daysSinceLastActive > 21) return 'high';
  if (healthScore < 60 || daysSinceLastActive > 7) return 'medium';
  return 'low';
}

/**
 * Returns a per-school growth report for one school.
 */
export async function getSchoolGrowthReport(schoolId) {
  const oid = new mongoose.Types.ObjectId(schoolId);
  const t = today();
  const since30d = dateNDaysAgo(30);
  const since14d = dateNDaysAgo(14);
  const since7d = dateNDaysAgo(7);

  const [snapshots30d, activityLast7, activityPrev7, lastActive] = await Promise.all([
    SchoolMetricSnapshot.find({ schoolId: oid, date: { $gte: since30d, $lte: t } }).lean(),
    // DAU counts for last 7 days
    UserDayActivity.aggregate([
      { $match: { schoolId: oid, date: { $gte: since7d, $lte: t } } },
      { $group: { _id: '$date', count: { $sum: 1 } } },
    ]),
    // DAU counts for previous 7-day window (7–14 days ago)
    UserDayActivity.aggregate([
      { $match: { schoolId: oid, date: { $gte: since14d, $lt: since7d } } },
      { $group: { _id: '$date', count: { $sum: 1 } } },
    ]),
    // Most recent activity date
    UserDayActivity.findOne({ schoolId: oid }).sort({ date: -1 }).select('date').lean(),
  ]);

  const dauLast7 = activityLast7.reduce((acc, r) => acc + r.count, 0);
  const dauPrev7 = activityPrev7.reduce((acc, r) => acc + r.count, 0);

  const lastActiveDate = lastActive?.date || null;
  const daysSinceLastActive = lastActiveDate
    ? Math.floor((new Date(t) - new Date(lastActiveDate)) / (1000 * 60 * 60 * 24))
    : 999;

  const healthResult = computeHealthScore({
    snapshots30d,
    dauLast7,
    dauPrev7,
    daysSinceLastActive,
  });
  const risk = churnRisk(healthResult.score, daysSinceLastActive);

  // Core feature activation: has this school used all 4 core features?
  const activatedCoreFeatures = CORE_FEATURES.filter((f) => healthResult.featuresUsed.includes(f));
  const isFullyActivated = activatedCoreFeatures.length === CORE_FEATURES.length;

  // Growth trend label
  let trend = 'stable';
  if (dauLast7 > dauPrev7 * 1.1) trend = 'growing';
  else if (dauLast7 < dauPrev7 * 0.8) trend = 'declining';

  return {
    schoolId,
    healthScore: healthResult.score,
    churnRisk: risk,
    trend,
    daysSinceLastActive,
    lastActiveDate,
    dauLast7d: dauLast7,
    dauPrev7d: dauPrev7,
    featuresUsed: healthResult.featuresUsed,
    featuresUsedCount: healthResult.featuresUsed.length,
    activatedCoreFeatures,
    isFullyActivated,
    scoreBreakdown: {
      breadth: healthResult.breadthScore,
      recency: healthResult.recencyScore,
      trend: healthResult.trendScore,
      mobile: healthResult.mobileScore,
    },
  };
}

/**
 * Returns the feature activation funnel across all active schools.
 * For each module, shows how many schools used it in the last 30 days.
 */
export async function getFeatureActivationFunnel() {
  const schools = await School.find({ status: 'active' }).select('_id').lean();
  const schoolIds = schools.map((s) => s._id);
  const totalSchools = schoolIds.length;

  if (totalSchools === 0) return { totalSchools: 0, funnel: [] };

  const since30d = dateNDaysAgo(30);
  const t = today();

  // Aggregate feature totals per school over last 30 days
  const snapshots = await SchoolMetricSnapshot.aggregate([
    { $match: { schoolId: { $in: schoolIds }, date: { $gte: since30d, $lte: t } } },
    {
      $group: {
        _id: '$schoolId',
        ...Object.fromEntries(ALL_FEATURES.map((f) => [`feat_${f}`, { $sum: `$features.${f}` }])),
      },
    },
  ]);

  // Count schools that used each feature at least once
  const featureCounts = Object.fromEntries(ALL_FEATURES.map((f) => [f, 0]));
  for (const snap of snapshots) {
    for (const feat of ALL_FEATURES) {
      if ((snap[`feat_${feat}`] || 0) > 0) featureCounts[feat]++;
    }
  }

  const funnel = ALL_FEATURES.map((feat) => ({
    feature: feat,
    schoolsUsed: featureCounts[feat],
    adoptionPct: totalSchools > 0 ? Math.round((featureCounts[feat] / totalSchools) * 100) : 0,
    isCore: CORE_FEATURES.includes(feat),
  })).sort((a, b) => b.schoolsUsed - a.schoolsUsed);

  return { totalSchools, funnel };
}

/**
 * Returns growth reports for all active schools, sorted by health score ascending
 * (lowest-health schools first, i.e. most at-risk).
 */
export async function getAllSchoolsGrowthReport() {
  const schools = await School.find({ status: 'active' })
    .select('_id name code plan planStatus trialEndsAt')
    .lean();

  const reports = await Promise.all(
    schools.map(async (school) => {
      try {
        const report = await getSchoolGrowthReport(String(school._id));
        return {
          ...report,
          name: school.name,
          schoolName: school.name,
          code: school.code,
          plan: school.plan,
          planStatus: school.planStatus,
          trialEndsAt: school.trialEndsAt,
        };
      } catch (err) {
        logger.warn({ err: err.message, schoolId: school._id }, 'Growth report failed for school');
        return {
          schoolId: String(school._id),
          name: school.name,
          code: school.code,
          plan: school.plan,
          planStatus: school.planStatus,
          healthScore: 0,
          churnRisk: 'high',
          trend: 'unknown',
          daysSinceLastActive: 999,
          lastActiveDate: null,
          featuresUsed: [],
          featuresUsedCount: 0,
          isFullyActivated: false,
        };
      }
    })
  );

  // Sort by health score ascending (at-risk first)
  reports.sort((a, b) => a.healthScore - b.healthScore);

  const summary = {
    totalSchools: reports.length,
    highRisk: reports.filter((r) => r.churnRisk === 'high').length,
    mediumRisk: reports.filter((r) => r.churnRisk === 'medium').length,
    lowRisk: reports.filter((r) => r.churnRisk === 'low').length,
    growing: reports.filter((r) => r.trend === 'growing').length,
    declining: reports.filter((r) => r.trend === 'declining').length,
    fullyActivated: reports.filter((r) => r.isFullyActivated).length,
    avgHealthScore:
      reports.length > 0
        ? Math.round(reports.reduce((acc, r) => acc + r.healthScore, 0) / reports.length)
        : 0,
  };

  return { summary, schools: reports };
}
