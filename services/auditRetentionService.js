/**
 * Audit Log Retention Service
 *
 * Purges audit trail records older than the configured retention window.
 * AuditTrail records are normally immutable (Mongoose hooks block delete/update),
 * but data retention is an authorized system operation that bypasses those guards
 * by going directly through the MongoDB collection driver.
 */

import AuditTrail from '../models/AuditTrail.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('AuditRetention');

/**
 * Purge audit logs older than the specified number of months.
 * Operates at the MongoDB driver level to bypass the immutability Mongoose hooks.
 *
 * @param {number} retentionMonths - Months to retain (default: 12). Records older than this are purged.
 * @returns {Promise<{purged: number, cutoffDate: string}>}
 */
export async function purgeExpiredAuditLogs(retentionMonths = 12) {
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - retentionMonths);

  // Use the raw MongoDB collection to bypass the Mongoose immutability pre-hooks.
  // This is intentional: data retention is a system-level operation, not a user mutation.
  const result = await AuditTrail.collection.deleteMany({
    createdAt: { $lt: cutoffDate },
  });

  const purged = result.deletedCount || 0;
  logger.info(
    { purged, retentionMonths, cutoffDate: cutoffDate.toISOString() },
    'Purged expired audit logs'
  );
  return { purged, cutoffDate: cutoffDate.toISOString() };
}
