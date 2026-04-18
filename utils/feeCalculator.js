/**
 * Central fee calculation utilities.
 *
 * All fee total/balance/status logic must go through these helpers so that
 * every route (studentFees, fees, parentData) produces identical numbers.
 */

import { Student } from '../database.js';

/**
 * Recompute the top-level totals for a StudentFeeStructure document.
 *
 * Rules:
 *   totalBalance = max(totalFee - totalPaid - discountApplied, 0)
 *   overallStatus:
 *     - 'paid'    if totalBalance === 0
 *     - 'overdue' if totalBalance > 0 AND `sfs.dueDate` exists and is in the past
 *     - 'partial' if totalBalance > 0 AND totalPaid > 0
 *     - 'pending' otherwise
 *
 * @param {{ totalFee?: number, totalPaid?: number, discountApplied?: number, dueDate?: Date|string }} sfs
 * @returns {{ totalBalance: number, overallStatus: 'paid'|'overdue'|'partial'|'pending' }}
 */
export function computeFeeBalance(sfs) {
  const totalFee = sfs.totalFee || 0;
  const totalPaid = sfs.totalPaid || 0;
  const discountApplied = sfs.discountApplied || 0;

  const totalBalance = Math.max(totalFee - totalPaid - discountApplied, 0);

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
export async function syncStudentFeeDetails(studentId, feeStructure) {
  await Student.findByIdAndUpdate(studentId, {
    feeStatus: feeStructure.overallStatus,
    feeDetails: {
      totalFee: feeStructure.totalFee,
      paidAmount: feeStructure.totalPaid,
      balanceAmount: feeStructure.totalBalance,
      discountApplied: feeStructure.discountApplied || 0,
      lastPaymentDate: feeStructure.lastPaymentDate || null,
    },
  });
}
