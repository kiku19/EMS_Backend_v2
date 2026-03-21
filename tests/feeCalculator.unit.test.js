/**
 * Unit tests for utils/feeCalculator.js
 *
 * These tests run in isolation — no database, no HTTP.  They verify that the
 * shared calculation helpers produce correct numbers for every edge case so
 * that every route that calls them inherits correct behaviour automatically.
 */

import { describe, expect, it } from 'vitest';
import { computeFeeBalance, computeFeeHeadStatus } from '../utils/feeCalculator.js';

// ---------------------------------------------------------------------------
// computeFeeBalance
// ---------------------------------------------------------------------------

describe('computeFeeBalance', () => {
  it('returns pending with full balance when nothing is paid', () => {
    const result = computeFeeBalance({ totalFee: 10000, totalPaid: 0, discountApplied: 0 });
    expect(result.totalBalance).toBe(10000);
    expect(result.overallStatus).toBe('pending');
  });

  it('returns partial when some amount is paid', () => {
    const result = computeFeeBalance({ totalFee: 10000, totalPaid: 3000, discountApplied: 0 });
    expect(result.totalBalance).toBe(7000);
    expect(result.overallStatus).toBe('partial');
  });

  it('returns paid when full amount is paid', () => {
    const result = computeFeeBalance({ totalFee: 10000, totalPaid: 10000, discountApplied: 0 });
    expect(result.totalBalance).toBe(0);
    expect(result.overallStatus).toBe('paid');
  });

  it('returns paid when discount covers remaining balance', () => {
    const result = computeFeeBalance({ totalFee: 10000, totalPaid: 8000, discountApplied: 2000 });
    expect(result.totalBalance).toBe(0);
    expect(result.overallStatus).toBe('paid');
  });

  it('clamps totalBalance to 0 on overpayment (never goes negative)', () => {
    const result = computeFeeBalance({ totalFee: 5000, totalPaid: 6000, discountApplied: 0 });
    expect(result.totalBalance).toBe(0);
    expect(result.overallStatus).toBe('paid');
  });

  it('clamps totalBalance to 0 when discount + paid exceeds totalFee', () => {
    const result = computeFeeBalance({ totalFee: 5000, totalPaid: 3000, discountApplied: 3000 });
    expect(result.totalBalance).toBe(0);
    expect(result.overallStatus).toBe('paid');
  });

  it('handles zero-amount fee (no fee assigned)', () => {
    const result = computeFeeBalance({ totalFee: 0, totalPaid: 0, discountApplied: 0 });
    expect(result.totalBalance).toBe(0);
    // No fee owed AND no payment → treated as paid
    expect(result.overallStatus).toBe('paid');
  });

  it('handles missing fields gracefully (all undefined)', () => {
    const result = computeFeeBalance({});
    expect(result.totalBalance).toBe(0);
    expect(result.overallStatus).toBe('paid');
  });

  it('factors in concession (discountApplied) reducing balance', () => {
    const result = computeFeeBalance({ totalFee: 10000, totalPaid: 2000, discountApplied: 3000 });
    expect(result.totalBalance).toBe(5000);
    expect(result.overallStatus).toBe('partial');
  });

  it('mid-year class change: re-running with new totalFee recalculates correctly', () => {
    // Student moved from Class 5 (fee: 5000) to Class 8 (fee: 8000) mid-year.
    // They already paid 5000.  New totalFee is now 8000.
    const result = computeFeeBalance({ totalFee: 8000, totalPaid: 5000, discountApplied: 0 });
    expect(result.totalBalance).toBe(3000);
    expect(result.overallStatus).toBe('partial');
  });
});

// ---------------------------------------------------------------------------
// computeFeeHeadStatus
// ---------------------------------------------------------------------------

describe('computeFeeHeadStatus', () => {
  it('returns pending when nothing is paid', () => {
    const result = computeFeeHeadStatus({ amount: 5000, paidAmount: 0 });
    expect(result.balanceAmount).toBe(5000);
    expect(result.status).toBe('pending');
  });

  it('returns partial when some amount is paid', () => {
    const result = computeFeeHeadStatus({ amount: 5000, paidAmount: 2000 });
    expect(result.balanceAmount).toBe(3000);
    expect(result.status).toBe('partial');
  });

  it('returns paid when full amount is paid', () => {
    const result = computeFeeHeadStatus({ amount: 5000, paidAmount: 5000 });
    expect(result.balanceAmount).toBe(0);
    expect(result.status).toBe('paid');
  });

  it('clamps balanceAmount to 0 on overpayment of a fee head', () => {
    const result = computeFeeHeadStatus({ amount: 1000, paidAmount: 1500 });
    expect(result.balanceAmount).toBe(0);
    expect(result.status).toBe('paid');
  });

  it('handles zero-amount fee head (e.g., waived fee)', () => {
    const result = computeFeeHeadStatus({ amount: 0, paidAmount: 0 });
    expect(result.balanceAmount).toBe(0);
    expect(result.status).toBe('paid');
  });

  it('handles missing fields gracefully', () => {
    const result = computeFeeHeadStatus({});
    expect(result.balanceAmount).toBe(0);
    expect(result.status).toBe('paid');
  });
});
