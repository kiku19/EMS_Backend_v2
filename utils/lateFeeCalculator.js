import LateFeeRule from '../models/LateFeeRule.js';

/**
 * Calculate late fee for a student's overdue fee head.
 *
 * @param {Object} options
 * @param {string} options.schoolId
 * @param {string} options.academicYear
 * @param {Date}   options.dueDate        - Original due date for the fee
 * @param {Date}   [options.paymentDate]  - Actual payment date (defaults to now)
 * @param {number} options.feeAmount      - Original fee amount (used for percentage caps, not currently used)
 * @param {string} [options.feeHeadId]    - If provided, checks whether the rule applies to this head
 * @returns {Promise<{ lateFee: number, daysLate: number, ruleApplied: string|null }>}
 */
export async function calculateLateFee({
  schoolId,
  academicYear,
  dueDate,
  paymentDate,
  feeAmount: _feeAmount,
  feeHeadId,
}) {
  const rule = await LateFeeRule.findOne({ schoolId, academicYear });

  // No rule configured or rule disabled
  if (!rule || !rule.enabled) {
    return { lateFee: 0, daysLate: 0, ruleApplied: null };
  }

  // If rule is scoped to specific fee heads, check applicability
  if (
    rule.applicableFeeHeads &&
    rule.applicableFeeHeads.length > 0 &&
    feeHeadId &&
    !rule.applicableFeeHeads.some((id) => id.toString() === feeHeadId.toString())
  ) {
    return { lateFee: 0, daysLate: 0, ruleApplied: null };
  }

  const due = new Date(dueDate);
  const paid = paymentDate ? new Date(paymentDate) : new Date();

  // Calculate days late (rounded up to whole days)
  const diffMs = paid.getTime() - due.getTime();
  const daysLate = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  // Not late, or within grace period
  if (daysLate <= (rule.gracePeriod || 0)) {
    return { lateFee: 0, daysLate: Math.max(0, daysLate), ruleApplied: null };
  }

  const effectiveDaysLate = daysLate - (rule.gracePeriod || 0);
  let lateFee = 0;

  switch (rule.fineType) {
    case 'per_day':
      lateFee = effectiveDaysLate * (rule.perDayAmount || 0);
      break;

    case 'slab': {
      // Find the matching slab for the number of days late
      const sortedSlabs = [...(rule.slabs || [])].sort((a, b) => a.fromDay - b.fromDay);
      for (const slab of sortedSlabs) {
        if (effectiveDaysLate >= slab.fromDay && effectiveDaysLate <= slab.toDay) {
          lateFee = slab.amount;
          break;
        }
      }
      // If beyond all slabs, use the last slab's amount
      if (lateFee === 0 && sortedSlabs.length > 0) {
        const lastSlab = sortedSlabs[sortedSlabs.length - 1];
        if (effectiveDaysLate > lastSlab.toDay) {
          lateFee = lastSlab.amount;
        }
      }
      break;
    }

    case 'flat':
      lateFee = rule.flatAmount || 0;
      break;

    default:
      lateFee = 0;
  }

  // Apply maximum cap if set
  if (rule.maximumCap && lateFee > rule.maximumCap) {
    lateFee = rule.maximumCap;
  }

  return {
    lateFee: Math.round(lateFee * 100) / 100,
    daysLate,
    ruleApplied: rule.fineType,
  };
}

/**
 * Calculate concession discount for a student.
 *
 * @param {Object} concession - FeeConcession document
 * @param {number} feeAmount  - The fee amount to apply discount on
 * @returns {number} The discount amount
 */
export function calculateConcessionDiscount(concession, feeAmount) {
  if (!concession || !concession.isActive) return 0;

  if (concession.discountType === 'percentage') {
    return Math.round(((feeAmount * concession.discountValue) / 100) * 100) / 100;
  }

  if (concession.discountType === 'flat') {
    return Math.min(concession.discountValue, feeAmount);
  }

  return 0;
}
