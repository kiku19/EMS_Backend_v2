import FeePaymentAudit from '../models/FeePaymentAudit.js';
import { createLogger } from './logger.js';

const logger = createLogger('FeePaymentAudit');

/**
 * Create a fee-payment audit entry.
 *
 * @param {Object} params
 * @param {string|ObjectId} params.schoolId
 * @param {string} params.entityType   — 'FeePayment' | 'StudentFeeStructure'
 * @param {string|ObjectId} params.entityId
 * @param {string} params.action       — enum from FeePaymentAudit schema
 * @param {string|ObjectId} params.performedBy
 * @param {string} [params.performedByName]
 * @param {string|ObjectId} [params.studentId]
 * @param {Object} [params.changes]    — { before, after }
 * @param {Object} [params.context]    — { receiptNumber, amount, academicYear, reason, paymentMode, refundNumber }
 * @param {Object} [params.req]        — Express request (for ipAddress / userAgent)
 * @param {string} [params.status]     — 'success' | 'failure'
 * @param {string} [params.errorMessage]
 */
export async function createFeePaymentAuditEntry(params) {
  try {
    const {
      schoolId,
      entityType,
      entityId,
      action,
      performedBy,
      performedByName,
      studentId,
      changes,
      context,
      req,
      status = 'success',
      errorMessage,
    } = params;

    const ipAddress =
      req?.headers?.['x-forwarded-for']?.split(',')?.[0]?.trim() ||
      req?.connection?.remoteAddress ||
      req?.ip;

    await FeePaymentAudit.create({
      schoolId,
      entityType,
      entityId,
      action,
      performedBy,
      performedByName: performedByName || null,
      studentId: studentId || null,
      changes: changes || undefined,
      context: context || undefined,
      ipAddress: ipAddress || null,
      userAgent: req?.headers?.['user-agent'] || null,
      status,
      errorMessage: errorMessage || undefined,
    });
  } catch (err) {
    // Audit logging must never break the main request
    logger.error({ err }, 'Failed to write fee payment audit entry');
  }
}
