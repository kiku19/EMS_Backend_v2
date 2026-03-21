/**
 * Archival Service — DR-05
 *
 * Implements the data archival strategy for schools older than 3 years.
 *
 * Strategy:
 *  - Only schools whose `createdAt` is more than SCHOOL_AGE_THRESHOLD_YEARS ago
 *    are candidates for archival.
 *  - For each eligible school, records older than ARCHIVE_CUTOFF_YEARS are moved
 *    from primary collections into `ArchiveRecord` documents.
 *  - Archived records are removed from primary collections to reduce storage
 *    pressure on hot data.
 *  - Each archival run produces a summary of what was archived per school.
 *
 * Collections archived:
 *  attendance, results, feePayments, feeRefunds, remarks
 *
 * Runs as an Agenda scheduled job (quarterly, 3rd of Jan/Apr/Jul/Oct at 1 AM).
 */

import School from '../models/School.js';
import ArchiveRecord from '../models/ArchiveRecord.js';
import { Attendance, Result, FeePayment, FeeRefund } from '../database.js';
import Remark from '../models/Remark.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ArchivalService');

// A school must be at least this old (years) before its data is archived
const SCHOOL_AGE_THRESHOLD_YEARS = 3;

// Data older than this (years) is moved to the archive
const ARCHIVE_CUTOFF_YEARS = 3;

/**
 * Returns the cutoff date: records created before this date are archive-eligible.
 */
function archiveCutoffDate() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - ARCHIVE_CUTOFF_YEARS);
  return d;
}

/**
 * Returns the date before which a school must have been created to be eligible.
 */
function schoolEligibilityCutoffDate() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - SCHOOL_AGE_THRESHOLD_YEARS);
  return d;
}

/**
 * Fetch, store, and delete records from a primary collection for a given school.
 *
 * @param {object} collection  - Mongoose model
 * @param {string} archiveType - ArchiveRecord.archiveType value
 * @param {object} filter      - MongoDB filter (must include schoolId + date range)
 * @param {ObjectId} schoolId
 * @param {Date} cutoff
 * @param {string} triggeredBy
 * @returns {Promise<{archived: number, skipped: boolean}>}
 */
async function archiveCollection(collection, archiveType, filter, schoolId, cutoff, triggeredBy) {
  const docs = await collection.find(filter).lean();

  if (docs.length === 0) {
    return { archived: 0, skipped: true };
  }

  const periodStart = new Date(
    Math.min(...docs.map((d) => new Date(d.createdAt || d.date || 0).getTime()))
  );
  const periodEnd = cutoff;
  const dataStr = JSON.stringify(docs);
  const sizeBytes = Buffer.byteLength(dataStr, 'utf8');

  try {
    await ArchiveRecord.create({
      schoolId,
      archiveType,
      periodStart,
      periodEnd,
      recordCount: docs.length,
      sizeBytes,
      status: 'completed',
      triggeredBy,
      data: docs,
    });

    // Remove from primary collection after successful archive
    const ids = docs.map((d) => d._id);
    await collection.collection.deleteMany({ _id: { $in: ids } });

    return { archived: docs.length, skipped: false };
  } catch (err) {
    // If archiving fails, record the failure without touching source data
    await ArchiveRecord.create({
      schoolId,
      archiveType,
      periodStart,
      periodEnd,
      recordCount: 0,
      sizeBytes: 0,
      status: 'failed',
      triggeredBy,
      failReason: err.message,
      data: [],
    });
    throw err;
  }
}

/**
 * Archive all eligible historical data for a single school.
 *
 * @param {ObjectId} schoolId
 * @param {Date} cutoff
 * @param {string} triggeredBy
 */
async function archiveSchool(schoolId, cutoff, triggeredBy) {
  const results = {};

  // Attendance uses `date` field, not `createdAt`
  const attendanceResult = await archiveCollection(
    Attendance,
    'attendance',
    { schoolId, date: { $lt: cutoff } },
    schoolId,
    cutoff,
    triggeredBy
  );
  results.attendance = attendanceResult.archived;

  // Results
  const resultsResult = await archiveCollection(
    Result,
    'results',
    { schoolId, createdAt: { $lt: cutoff } },
    schoolId,
    cutoff,
    triggeredBy
  );
  results.results = resultsResult.archived;

  // Fee payments
  const feePaymentsResult = await archiveCollection(
    FeePayment,
    'feePayments',
    { schoolId, createdAt: { $lt: cutoff } },
    schoolId,
    cutoff,
    triggeredBy
  );
  results.feePayments = feePaymentsResult.archived;

  // Fee refunds
  const feeRefundsResult = await archiveCollection(
    FeeRefund,
    'feeRefunds',
    { schoolId, createdAt: { $lt: cutoff } },
    schoolId,
    cutoff,
    triggeredBy
  );
  results.feeRefunds = feeRefundsResult.archived;

  // Remarks
  const remarksResult = await archiveCollection(
    Remark,
    'remarks',
    { schoolId, createdAt: { $lt: cutoff } },
    schoolId,
    cutoff,
    triggeredBy
  );
  results.remarks = remarksResult.archived;

  return results;
}

/**
 * Run the full archival pass.
 *
 * Finds schools older than SCHOOL_AGE_THRESHOLD_YEARS, then archives their
 * records older than ARCHIVE_CUTOFF_YEARS.
 *
 * @param {string} [triggeredBy='system']
 * @returns {Promise<{summary, details}>}
 */
export async function runArchival(triggeredBy = 'system') {
  const schoolCutoff = schoolEligibilityCutoffDate();
  const dataCutoff = archiveCutoffDate();

  const eligibleSchools = await School.find({
    createdAt: { $lt: schoolCutoff },
  })
    .select('_id name createdAt')
    .lean();

  const details = [];
  let totalArchived = 0;

  for (const school of eligibleSchools) {
    try {
      const archived = await archiveSchool(school._id, dataCutoff, triggeredBy);
      const schoolTotal = Object.values(archived).reduce((s, n) => s + n, 0);
      totalArchived += schoolTotal;
      details.push({
        schoolId: school._id.toString(),
        schoolName: school.name,
        archived,
        total: schoolTotal,
      });

      if (schoolTotal > 0) {
        logger.info(
          { schoolId: school._id, schoolName: school.name, total: schoolTotal },
          'Archived records for school'
        );
      }
    } catch (err) {
      logger.error({ err, schoolId: school._id }, 'Archival error for school');
      details.push({
        schoolId: school._id.toString(),
        schoolName: school.name,
        error: err.message,
      });
    }
  }

  return {
    summary: {
      eligibleSchools: eligibleSchools.length,
      totalArchived,
      schoolAgeThresholdYears: SCHOOL_AGE_THRESHOLD_YEARS,
      archiveCutoffYears: ARCHIVE_CUTOFF_YEARS,
      dataCutoff: dataCutoff.toISOString(),
      triggeredBy,
    },
    details,
  };
}

/**
 * List schools eligible for archival (created > 3 years ago).
 */
export async function getEligibleSchools() {
  const cutoff = schoolEligibilityCutoffDate();
  return School.find({ createdAt: { $lt: cutoff } })
    .select('_id name code status createdAt')
    .sort({ createdAt: 1 })
    .lean();
}
