/**
 * Unit tests for services/couponService.js — pure function: calculateDiscount
 *
 * The async CRUD functions (createCoupon, validateCoupon, etc.) require
 * a database and are tested in integration tests.
 * This file tests the pure calculateDiscount function.
 */

import { describe, it, expect } from 'vitest';
import { calculateDiscount } from '../services/couponService.js';

describe('calculateDiscount', () => {
  it('calculates percentage discount correctly', () => {
    const coupon = { discountType: 'percentage', discountValue: 20 };
    const result = calculateDiscount(coupon, 10000);
    expect(result.discountAmount).toBe(2000);
    expect(result.finalAmount).toBe(8000);
  });

  it('calculates 100% discount', () => {
    const coupon = { discountType: 'percentage', discountValue: 100 };
    const result = calculateDiscount(coupon, 5000);
    expect(result.discountAmount).toBe(5000);
    expect(result.finalAmount).toBe(0);
  });

  it('calculates fixed discount correctly', () => {
    const coupon = { discountType: 'fixed', discountValue: 500 };
    const result = calculateDiscount(coupon, 2000);
    expect(result.discountAmount).toBe(500);
    expect(result.finalAmount).toBe(1500);
  });

  it('caps fixed discount at original amount', () => {
    const coupon = { discountType: 'fixed', discountValue: 5000 };
    const result = calculateDiscount(coupon, 2000);
    expect(result.discountAmount).toBe(2000); // min(5000, 2000)
    expect(result.finalAmount).toBe(0);
  });

  it('rounds percentage discount to nearest integer', () => {
    const coupon = { discountType: 'percentage', discountValue: 33 };
    const result = calculateDiscount(coupon, 1000);
    expect(result.discountAmount).toBe(330); // Math.round(330)
    expect(result.finalAmount).toBe(670);
  });

  it('handles 0% discount', () => {
    const coupon = { discountType: 'percentage', discountValue: 0 };
    const result = calculateDiscount(coupon, 1000);
    expect(result.discountAmount).toBe(0);
    expect(result.finalAmount).toBe(1000);
  });

  it('handles 0 amount with percentage', () => {
    const coupon = { discountType: 'percentage', discountValue: 50 };
    const result = calculateDiscount(coupon, 0);
    expect(result.discountAmount).toBe(0);
    expect(result.finalAmount).toBe(0);
  });

  it('ensures discountAmount is never negative', () => {
    const coupon = { discountType: 'fixed', discountValue: -100 };
    const result = calculateDiscount(coupon, 1000);
    expect(result.discountAmount).toBeGreaterThanOrEqual(0);
    expect(result.finalAmount).toBeGreaterThanOrEqual(0);
  });
});
