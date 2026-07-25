/**
 * Central fee calculation utilities.
 *
 * All fee total/balance/status logic must go through these helpers so that
 * every route (studentFees, fees, parentData) produces identical numbers.
 */

import { Student } from '../database.js';
import { applyLateFeeToFeeStructure, calculateConcessionDiscount } from './lateFeeCalculator.js';

/**
 * Recompute the top-level totals for a StudentFeeStructure document.
 *
 * Rules:
 *   totalBalance = max(totalFee + lateFeeApplied - totalPaid - discountApplied, 0)
 *   overallStatus:
 *     - 'paid'    if totalBalance === 0
 *     - 'overdue' if totalBalance > 0 AND `sfs.dueDate` exists and is in the past
 *     - 'partial' if totalBalance > 0 AND totalPaid > 0
 *     - 'pending' otherwise
 *
 * `lateFeeApplied` is a liability added to what the student owes (computed by
 * utils/lateFeeCalculator#applyLateFeeToFeeStructure from the school's LateFeeRule).
 * It must be included in the balance, otherwise configured late fees are silently
 * dropped — a direct money loss on every overdue account.
 *
 * @param {{ totalFee?: number, totalPaid?: number, discountApplied?: number, lateFeeApplied?: number, dueDate?: Date|string }} sfs
 * @returns {{ totalBalance: number, overallStatus: 'paid'|'overdue'|'partial'|'pending' }}
 */
export function computeFeeBalance(sfs) {
  const totalFee = sfs.totalFee || 0;
  const totalPaid = sfs.totalPaid || 0;
  const discountApplied = sfs.discountApplied || 0;
  const lateFeeApplied = sfs.lateFeeApplied || 0;

  const totalBalance = Math.max(totalFee + lateFeeApplied - totalPaid - discountApplied, 0);

  let overallStatus;
  if (totalBalance <= 0) {
    overallStatus = 'paid';
  } else if (sfs.dueDate && new Date(sfs.dueDate) < new Date()) {
    // Any outstanding balance past the due date is overdue. Previously
    // the helper never returned 'overdue' even though StudentFeeStructure
    // and the defaulters query both considered the enum — overdue was a
    // dead status and defaulters never lit up past the due date.
    overallStatus = 'overdue';
  } else if (totalPaid > 0) {
    overallStatus = 'partial';
  } else {
    overallStatus = 'pending';
  }

  return { totalBalance, overallStatus };
}

/**
 * Async, self-contained balance computation that also wires in the late-fee
 * rule and an optional concession. This is the single integration point that
 * connects `utils/lateFeeCalculator` (calculateLateFee / concession discount)
 * to the balance math — previously those helpers were exported but never
 * called from any balance path, so configured late fees and concessions were
 * silently dropped from totals.
 *
 * It stamps `sfs.lateFeeApplied` (via applyLateFeeToFeeStructure →
 * calculateLateFee), optionally folds a concession into `sfs.discountApplied`
 * (via calculateConcessionDiscount), then delegates to the synchronous
 * computeFeeBalance(). Both external touches are wrapped in try/catch so a
 * rule-lookup or calculation error can never break balance computation — the
 * balance simply excludes the uncomputable adjustment, matching the pre-rule
 * behavior when no LateFeeRule is configured.
 *
 * Callers that already stamp lateFeeApplied themselves (most payment/refund
 * routes) can keep using the synchronous computeFeeBalance() directly. This
 * helper exists for paths that compute a balance without a payment mutation —
 * e.g. the Students agent's class-change resync (helpers.js) and read paths.
 *
 * @param {Object} sfs - StudentFeeStructure document (mutated in place)
 * @param {Object} [options]
 * @param {Date}   [options.asOf]      - Reference "now" for the late-fee calc
 * @param {Object} [options.concession] - Optional FeeConcession doc applied to
 *                                        the whole structure (entire_fee) when
 *                                        no per-head discount is already set
 * @returns {Promise<{ totalBalance: number, overallStatus: string }>}
 */
export async function computeFeeBalanceWithLateFee(sfs, { asOf, concession } = {}) {
  if (!sfs) return { totalBalance: 0, overallStatus: 'pending' };

  // 1) Late fee — never let a rule-lookup failure corrupt the balance.
  try {
    await applyLateFeeToFeeStructure(sfs, { asOf });
  } catch (err) {
    // Defensive: no LateFeeRule configured (or DB hiccup) → treat as no late
    // fee so balance computation stays correct.
    if (sfs && typeof sfs.lateFeeApplied === 'number') {
      // leave whatever was already stamped; don't zero it on a transient error
    }
    // Swallow intentionally — balance must still compute.
  }

  // 2) Concession — only when an entire-fee concession is supplied and the
  //    structure doesn't already carry a discount (avoid double-discounting).
  if (concession && !(Number(sfs.discountApplied) > 0)) {
    try {
      const base = Number(sfs.totalFee || 0);
      const discount = calculateConcessionDiscount(concession, base);
      if (discount > 0) {
        sfs.discountApplied = discount;
        if (!sfs.discountReason && concession.name) sfs.discountReason = concession.name;
      }
    } catch {
      // A concession calc error must never block balance computation.
    }
  }

  return computeFeeBalance(sfs);
}

/**
 * Recompute balance and status for a single fee-head subdocument.
 *
 * Rules:
 *   balanceAmount = max(amount - paidAmount, 0)
 *   status:
 *     - 'paid'    if balanceAmount === 0
 *     - 'partial' if balanceAmount > 0 AND paidAmount > 0
 *     - 'pending' otherwise
 *
 * @param {{ amount?: number, paidAmount?: number }} head
 * @returns {{ balanceAmount: number, status: 'paid'|'partial'|'pending' }}
 */
export function computeFeeHeadStatus(head) {
  const amount = head.amount || 0;
  const paidAmount = head.paidAmount || 0;

  const balanceAmount = Math.max(amount - paidAmount, 0);
  const status = balanceAmount <= 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'pending';

  return { balanceAmount, status };
}

/**
 * Sync StudentFeeStructure totals back to the Student document's feeDetails
 * and feeStatus fields.  Call this after every mutation that changes a
 * student's fee balance.
 *
 * @param {string|import('mongoose').Types.ObjectId} studentId
 * @param {{ totalFee: number, totalPaid: number, totalBalance: number, discountApplied?: number, overallStatus: string, lastPaymentDate?: Date }} feeStructure
 */
export async function syncStudentFeeDetails(studentId, feeStructure, session) {
  const filter = {
    _id: studentId,
    // Student.feeDetails is a current-year convenience projection, not a
    // historical ledger. Never let a backdated payment/refund overwrite the
    // summary for the student's active academic year.
    academicYear: feeStructure.academicYear,
    ...(feeStructure.schoolId ? { schoolId: feeStructure.schoolId } : {}),
  };
  await Student.findOneAndUpdate(
    filter,
    {
      feeStatus: feeStructure.overallStatus,
      feeDetails: {
        totalFee: feeStructure.totalFee,
        paidAmount: feeStructure.totalPaid,
        balanceAmount: feeStructure.totalBalance,
        discountApplied: feeStructure.discountApplied || 0,
        lastPaymentDate: feeStructure.lastPaymentDate || null,
      },
    },
    { session: session || undefined }
  );
}
