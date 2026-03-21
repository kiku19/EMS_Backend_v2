/**
 * Retention Policy Enforcement Service
 *
 * Reads per-school retention policies and purges records that have exceeded
 * the configured retention window. Falls back to system defaults if no
 * school-specific policy is configured.
 *
 * This service operates at the MongoDB driver level for purge operations to
 * avoid triggering Mongoose hooks that guard against accidental deletion.
 * It is intended to be called only by the scheduled Agenda job.
 */

import { Attendance, Result, FeePayment, FeeRefund, Student, Staff } from '../database.js';
import RetentionPolicy, { DEFAULT_RETENTION_MONTHS } from '../models/RetentionPolicy.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('RetentionEnforcement');
import School from '../models/School.js';
import Message from '../models/Message.js';
import Notification from '../models/Notification.js';
import StaffAttendance from '../models/StaffAttendance.js';
import PayrollRecord from '../models/PayrollRecord.js';
import TeacherLeave from '../models/TeacherLeave.js';
import Remark from '../models/Remark.js';
import Visitor from '../models/Visitor.js';
import GatePass from '../models/GatePass.js';
import { purgeExpiredAuditLogs } from './auditRetentionService.js';

/**
 * Compute the cutoff date for a retention window.
 * Records created before this date are eligible for purging.
 */
function cutoffDate(retentionMonths) {
  const d = new Date();
  d.setMonth(d.getMonth() - retentionMonths);
  return d;
}

/**
 * Build the effective retention map for a school, merging saved policies
 * with system defaults.
 */
function buildRetentionMap(savedPolicies) {
  const map = { ...DEFAULT_RETENTION_MONTHS };
  for (const policy of savedPolicies) {
    map[policy.entityType] = policy.retentionMonths;
  }
  return map;
}

/**
 * Purge aged records for a single school using the provided retention map.
 * Only operates on models that have a schoolId field.
 */
async function enforceForSchool(schoolId, retentionMap) {
  const results = {};

  // attendance
  const attendanceCutoff = cutoffDate(retentionMap.attendance);
  results.attendance =
    (
      await Attendance.collection.deleteMany({
        schoolId,
        date: { $lt: attendanceCutoff },
      })
    ).deletedCount || 0;

  // academics (exam results)
  const academicsCutoff = cutoffDate(retentionMap.academics);
  results.results =
    (
      await Result.collection.deleteMany({
        schoolId,
        createdAt: { $lt: academicsCutoff },
      })
    ).deletedCount || 0;
  results.remarks =
    (
      await Remark.collection.deleteMany({
        schoolId,
        createdAt: { $lt: academicsCutoff },
      })
    ).deletedCount || 0;

  // fees (financial records — longer retention)
  const feesCutoff = cutoffDate(retentionMap.fees);
  results.feePayments =
    (
      await FeePayment.collection.deleteMany({
        schoolId,
        createdAt: { $lt: feesCutoff },
      })
    ).deletedCount || 0;
  results.feeRefunds =
    (
      await FeeRefund.collection.deleteMany({
        schoolId,
        createdAt: { $lt: feesCutoff },
      })
    ).deletedCount || 0;

  // payroll
  const payrollCutoff = cutoffDate(retentionMap.payroll);
  results.payroll =
    (
      await PayrollRecord.collection.deleteMany({
        schoolId,
        createdAt: { $lt: payrollCutoff },
      })
    ).deletedCount || 0;
  results.teacherLeaves =
    (
      await TeacherLeave.collection.deleteMany({
        schoolId,
        createdAt: { $lt: payrollCutoff },
      })
    ).deletedCount || 0;

  // frontDesk
  const frontDeskCutoff = cutoffDate(retentionMap.frontDesk);
  results.visitors =
    (
      await Visitor.collection.deleteMany({
        schoolId,
        createdAt: { $lt: frontDeskCutoff },
      })
    ).deletedCount || 0;
  results.gatePasses =
    (
      await GatePass.collection.deleteMany({
        schoolId,
        createdAt: { $lt: frontDeskCutoff },
      })
    ).deletedCount || 0;

  // staff attendance (reuses staff retention window)
  const staffCutoff = cutoffDate(retentionMap.staff);
  results.staffAttendance =
    (
      await StaffAttendance.collection.deleteMany({
        schoolId,
        createdAt: { $lt: staffCutoff },
      })
    ).deletedCount || 0;

  return results;
}

/**
 * Purge global collections that have no schoolId (Message, Notification).
 * Uses the minimum messaging retention across all active schools — safest default.
 */
async function enforceGlobalMessagingRetention(minMessagingMonths) {
  const messagingCutoff = cutoffDate(minMessagingMonths);
  const messages =
    (
      await Message.collection.deleteMany({
        createdAt: { $lt: messagingCutoff },
      })
    ).deletedCount || 0;
  const notifications =
    (
      await Notification.collection.deleteMany({
        createdAt: { $lt: messagingCutoff },
      })
    ).deletedCount || 0;
  return { messages, notifications };
}

/**
 * Run retention enforcement across all active schools.
 * Called by the Agenda job on a monthly schedule.
 */
export async function enforceRetentionPolicies() {
  const schools = await School.find({ status: 'active' }).select('_id').lean();
  const schoolResults = [];
  let minMessagingMonths = DEFAULT_RETENTION_MONTHS.messaging;

  for (const school of schools) {
    try {
      const schoolId = school._id;
      const savedPolicies = await RetentionPolicy.find({ schoolId }).lean();
      const retentionMap = buildRetentionMap(savedPolicies);

      // Track minimum messaging retention to use for global purge
      if (retentionMap.messaging < minMessagingMonths) {
        minMessagingMonths = retentionMap.messaging;
      }

      const purged = await enforceForSchool(schoolId, retentionMap);
      const total = Object.values(purged).reduce((sum, n) => sum + n, 0);
      schoolResults.push({ schoolId: schoolId.toString(), purged, total });

      if (total > 0) {
        logger.info({ schoolId: schoolId.toString(), total }, 'Purged records for school');
      }
    } catch (err) {
      logger.error({ err, schoolId: school._id }, 'Retention enforcement error for school');
      schoolResults.push({ schoolId: school._id.toString(), error: err.message });
    }
  }

  // Purge global collections (no schoolId) using the most conservative window
  const globalMessaging = await enforceGlobalMessagingRetention(minMessagingMonths);

  // Also enforce global audit log retention
  const auditResult = await purgeExpiredAuditLogs(DEFAULT_RETENTION_MONTHS.auditLogs);

  const totalPurged = schoolResults.reduce((sum, r) => sum + (r.total || 0), 0);
  return {
    summary: {
      schoolsProcessed: schools.length,
      totalPurged,
      globalMessagingPurged: globalMessaging.messages + globalMessaging.notifications,
      auditLogsPurged: auditResult.purged,
    },
    details: schoolResults,
  };
}
