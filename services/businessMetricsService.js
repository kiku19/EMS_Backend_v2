/**
 * OBS-04: Business Metrics Service
 *
 * Tracks DAU/WAU/MAU, feature adoption, and client-type split per school.
 *
 * Design:
 *  - In-memory buffer accumulates feature and client counters between flushes.
 *  - Every 5 minutes (configurable), the buffer is flushed to SchoolMetricSnapshot
 *    using atomic $inc + upsert — never blocks a request.
 *  - UserDayActivity gets an upserted doc per (school, user, day) for DAU/WAU/MAU.
 *  - All documents have a 90-day TTL, keeping storage bounded.
 */

import mongoose from 'mongoose';
import UserDayActivity from '../models/UserDayActivity.js';
import SchoolMetricSnapshot from '../models/SchoolMetricSnapshot.js';
import School from '../models/School.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('BusinessMetrics');

// ─── Module detection ─────────────────────────────────────────────────────────

const FEATURE_PREFIXES = [
  ['/students', 'students'],
  ['/classes', 'classes'],
  ['/attendance', 'attendance'],
  ['/academics', 'exams'],
  ['/exam-schedule', 'exams'],
  ['/fees', 'fees'],
  ['/fee-heads', 'fees'],
  ['/student-fees', 'fees'],
  ['/fee-templates', 'fees'],
  ['/fee-structure', 'fees'],
  ['/fee-settings', 'fees'],
  ['/staff', 'staff'],
  ['/staff-attendance', 'staff'],
  ['/messages', 'messaging'],
  ['/announcements', 'messaging'],
  ['/notifications', 'messaging'],
  ['/timetable', 'timetable'],
  ['/teacher-timetable', 'timetable'],
  ['/homework', 'homework'],
  ['/library', 'library'],
  ['/transport', 'transport'],
  ['/front-desk', 'frontDesk'],
  ['/visitors', 'frontDesk'],
  ['/gate-passes', 'frontDesk'],
  ['/payroll', 'payroll'],
  ['/payslips', 'payroll'],
  ['/parent', 'parentApp'],
  ['/mobile', 'staffApp'],
];

export function detectModule(path) {
  for (const [prefix, module] of FEATURE_PREFIXES) {
    if (path.startsWith(prefix)) return module;
  }
  return 'other';
}

export function detectClient(path, userAgent = '') {
  // Path-based detection takes precedence (most reliable)
  if (path.startsWith('/parent')) return 'mobile';
  if (path.startsWith('/mobile')) return 'mobile';

  const ua = userAgent.toLowerCase();
  if (
    ua.includes('okhttp') ||
    ua.includes('android') ||
    ua.includes('iphone') ||
    ua.includes('ipad') ||
    ua.includes('react-native')
  ) {
    return 'mobile';
  }

  // No user-agent = likely a raw API client
  if (!userAgent) return 'api';

  return 'web';
}

// ─── In-memory buffer ─────────────────────────────────────────────────────────
// key: "schoolId:date" → { schoolId, date, features: {}, clients: {}, apiCalls }

const buffer = new Map();
let flushTimer = null;

function getDateString() {
  return new Date().toISOString().slice(0, 10);
}

function getOrCreate(schoolId, date) {
  const key = `${schoolId}:${date}`;
  if (!buffer.has(key)) {
    buffer.set(key, { schoolId, date, features: {}, clients: {}, apiCalls: 0 });
  }
  return buffer.get(key);
}

/** Called by the middleware for every tracked request (synchronous — no I/O). */
export function recordRequest(schoolId, path, userAgent) {
  const date = getDateString();
  const entry = getOrCreate(String(schoolId), date);
  const mod = detectModule(path);
  const client = detectClient(path, userAgent);

  entry.apiCalls += 1;
  entry.features[mod] = (entry.features[mod] || 0) + 1;
  entry.clients[client] = (entry.clients[client] || 0) + 1;
}

/** Flush the in-memory buffer to MongoDB. Called on a timer or on shutdown. */
export async function flushBuffer() {
  if (buffer.size === 0) return;

  const entries = [...buffer.entries()];
  buffer.clear();

  for (const [, snap] of entries) {
    try {
      const inc = { apiCalls: snap.apiCalls };
      for (const [mod, count] of Object.entries(snap.features)) {
        inc[`features.${mod}`] = count;
      }
      for (const [client, count] of Object.entries(snap.clients)) {
        inc[`clients.${client}`] = count;
      }

      await SchoolMetricSnapshot.updateOne(
        { schoolId: snap.schoolId, date: snap.date },
        { $inc: inc, $setOnInsert: { recordedAt: new Date() } },
        { upsert: true }
      );
    } catch (err) {
      logger.warn({ err: err.message, schoolId: snap.schoolId }, 'Metric snapshot flush failed');
    }
  }
}

/** Start the periodic flush timer. Call once after DB is ready. */
export function startFlushTimer(intervalMs = 5 * 60 * 1000) {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flushBuffer().catch((err) =>
      logger.warn({ err: err.message }, 'Business metrics periodic flush error')
    );
  }, intervalMs);
  // Don't hold the process open if everything else shuts down
  if (flushTimer.unref) flushTimer.unref();
}

// ─── Query helpers ────────────────────────────────────────────────────────────

function dateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Returns DAU (today), WAU (last 7 days), and MAU (last 30 days) for one school.
 * Uses distinct userId counts to avoid double-counting repeat visitors.
 */
export async function getDauMauWau(schoolId) {
  const today = getDateString();
  const weekAgo = dateNDaysAgo(7);
  const monthAgo = dateNDaysAgo(30);
  const oid = new mongoose.Types.ObjectId(schoolId);

  const [dau, wauIds, mauIds] = await Promise.all([
    UserDayActivity.countDocuments({ schoolId: oid, date: today }),
    UserDayActivity.distinct('userId', { schoolId: oid, date: { $gte: weekAgo, $lte: today } }),
    UserDayActivity.distinct('userId', { schoolId: oid, date: { $gte: monthAgo, $lte: today } }),
  ]);

  return { dau, wau: wauIds.length, mau: mauIds.length };
}

/**
 * Returns per-module feature adoption and client-type breakdown for one school
 * over the last `days` days, aggregated from SchoolMetricSnapshot.
 */
export async function getFeatureAdoption(schoolId, days = 30) {
  const since = dateNDaysAgo(days);
  const today = getDateString();
  const oid = new mongoose.Types.ObjectId(schoolId);

  const snapshots = await SchoolMetricSnapshot.find({
    schoolId: oid,
    date: { $gte: since, $lte: today },
  }).lean();

  const featureTotals = {};
  const clientTotals = { web: 0, mobile: 0, api: 0 };
  let totalApiCalls = 0;

  for (const snap of snapshots) {
    totalApiCalls += snap.apiCalls || 0;
    for (const [mod, count] of Object.entries(snap.features || {})) {
      featureTotals[mod] = (featureTotals[mod] || 0) + count;
    }
    for (const [client, count] of Object.entries(snap.clients || {})) {
      if (client in clientTotals) clientTotals[client] += count;
    }
  }

  const totalFeatureCalls = Object.values(featureTotals).reduce((a, b) => a + b, 0);
  const featureAdoption = {};
  for (const [mod, count] of Object.entries(featureTotals)) {
    featureAdoption[mod] = {
      calls: count,
      pct: totalFeatureCalls > 0 ? Math.round((count / totalFeatureCalls) * 100) : 0,
    };
  }

  return { featureAdoption, clients: clientTotals, totalApiCalls };
}

/**
 * Returns per-day DAU trend for one school over the last `days` days.
 */
export async function getDauTrend(schoolId, days = 30) {
  const since = dateNDaysAgo(days);
  const today = getDateString();
  const oid = new mongoose.Types.ObjectId(schoolId);

  const results = await UserDayActivity.aggregate([
    { $match: { schoolId: oid, date: { $gte: since, $lte: today } } },
    { $group: { _id: '$date', dau: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  return results.map((r) => ({ date: r._id, dau: r.dau }));
}

/**
 * Returns a summary of DAU/WAU/MAU and client split for all active schools.
 * Used by the super-admin business metrics dashboard and weekly report.
 */
export async function getAllSchoolsMetricsSummary() {
  const today = getDateString();
  const weekAgo = dateNDaysAgo(7);
  const monthAgo = dateNDaysAgo(30);

  const schools = await School.find({ status: 'active' }).select('_id name code').lean();
  const schoolIds = schools.map((s) => s._id);

  const [dauCounts, wauCounts, mauCounts, featureData] = await Promise.all([
    UserDayActivity.aggregate([
      { $match: { schoolId: { $in: schoolIds }, date: today } },
      { $group: { _id: '$schoolId', dau: { $sum: 1 } } },
    ]),
    UserDayActivity.aggregate([
      { $match: { schoolId: { $in: schoolIds }, date: { $gte: weekAgo, $lte: today } } },
      { $group: { _id: { school: '$schoolId', user: '$userId' } } },
      { $group: { _id: '$_id.school', wau: { $sum: 1 } } },
    ]),
    UserDayActivity.aggregate([
      { $match: { schoolId: { $in: schoolIds }, date: { $gte: monthAgo, $lte: today } } },
      { $group: { _id: { school: '$schoolId', user: '$userId' } } },
      { $group: { _id: '$_id.school', mau: { $sum: 1 } } },
    ]),
    SchoolMetricSnapshot.aggregate([
      { $match: { schoolId: { $in: schoolIds }, date: { $gte: weekAgo, $lte: today } } },
      {
        $group: {
          _id: '$schoolId',
          totalApiCalls: { $sum: '$apiCalls' },
          webCalls: { $sum: '$clients.web' },
          mobileCalls: { $sum: '$clients.mobile' },
        },
      },
    ]),
  ]);

  const dauMap = new Map(dauCounts.map((r) => [String(r._id), r.dau]));
  const wauMap = new Map(wauCounts.map((r) => [String(r._id), r.wau]));
  const mauMap = new Map(mauCounts.map((r) => [String(r._id), r.mau]));
  const featMap = new Map(featureData.map((r) => [String(r._id), r]));

  return schools.map((school) => {
    const id = String(school._id);
    const feat = featMap.get(id) || {};
    const totalCalls = feat.totalApiCalls || 0;
    const webCalls = feat.webCalls || 0;
    const mobileCalls = feat.mobileCalls || 0;

    return {
      schoolId: id,
      name: school.name,
      code: school.code,
      dau: dauMap.get(id) || 0,
      wau: wauMap.get(id) || 0,
      mau: mauMap.get(id) || 0,
      apiCallsLast7d: totalCalls,
      clientSplit: {
        webPct: totalCalls > 0 ? Math.round((webCalls / totalCalls) * 100) : 0,
        mobilePct: totalCalls > 0 ? Math.round((mobileCalls / totalCalls) * 100) : 0,
      },
    };
  });
}
